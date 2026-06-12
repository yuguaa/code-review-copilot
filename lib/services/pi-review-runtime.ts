import { Sandbox, SandboxException } from "@alibaba-group/opensandbox";
import type { RepositorySandboxBinding, ReviewSandboxSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReviewState, FileReviewResult } from "@/lib/review/types";
import { generatePatch, toPrismaJsonInput } from "@/lib/review/utils";
import { createOpenSandboxConnectionConfig, readPiRuntimeConfig, type PiRuntimeConfig } from "@/lib/services/pi-runtime-config";
import {
  bindRunningPiCommandId,
  registerRunningPiCommand,
  unregisterRunningPiCommand,
} from "@/lib/services/pi-runtime-command-registry";
import { assertReviewNotCancelled, isReviewCancelledStatus, REVIEW_CANCELLED_STATUS } from "@/lib/services/review-cancellation";
import { createLogger, logWarn } from "@/lib/logger";
import type { ReviewComment } from "@/lib/types";
import { PI_REVIEW_JSON_OUTPUT_FORMAT } from "@/lib/prompts";

const log = createLogger("PiReviewRuntime");
const SANDBOX_SESSION_RESERVABLE_STATUSES = ["running", "paused", "error"];
const SANDBOX_SESSION_ACTIVE_STATUSES = ["running", "cancelling"];

export type PiReviewInput = {
  reviewLogId: string;
  repositoryId: string;
  repositoryPath: string;
  gitLabUrl: string;
  gitLabProjectId: number;
  sourceBranch: string;
  targetBranch: string;
  commitSha: string;
  mergeRequestIid: number;
  title: string;
  description: string | null;
  summary: string;
  changedFiles: Array<{
    filePath: string;
    patch: string;
  }>;
};

export type PiReviewResult = {
  summary: string;
  comments: ReviewComment[];
  rawResponse: string;
};

type PiModelConfig = {
  provider: string;
  modelId: string;
  apiKey: string;
  apiEndpoint: string | null;
};

export type RunPiReviewParams = {
  input: PiReviewInput;
  gitLabAccessToken: string;
  modelConfig: PiModelConfig;
  profilePrompt: string | null;
  profilePromptMode: string;
};

type PiFindingPayload = {
  filePath?: unknown;
  lineNumber?: unknown;
  lineRangeEnd?: unknown;
  severity?: unknown;
  content?: unknown;
  confidence?: unknown;
};

type PiReviewPayload = {
  summary?: unknown;
  findings?: unknown;
  comments?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stdoutText(execution: Awaited<ReturnType<Sandbox["commands"]["run"]>>): string {
  return execution.logs.stdout.map((item) => item.text).join("");
}

function stderrText(execution: Awaited<ReturnType<Sandbox["commands"]["run"]>>): string {
  return execution.logs.stderr.map((item) => item.text).join("");
}

function ensureSuccessfulCommand(execution: Awaited<ReturnType<Sandbox["commands"]["run"]>>, label: string): typeof execution {
  if (execution.exitCode && execution.exitCode !== 0) {
    throw new Error(`${label} failed: ${stderrText(execution) || stdoutText(execution) || `exitCode=${execution.exitCode}`}`);
  }
  if (execution.error) {
    throw new Error(`${label} failed: ${execution.error.value}`);
  }
  return execution;
}

function modelProvider(provider: string): string {
  if (provider === "claude") return "anthropic";
  if (provider === "openai") return "openai";
  throw new Error(`Pi runtime does not support AI provider: ${provider}`);
}

function modelEnv(provider: string, apiKey: string): Record<string, string> {
  if (provider === "openai") return { OPENAI_API_KEY: apiKey };
  if (provider === "claude") return { ANTHROPIC_API_KEY: apiKey };
  throw new Error(`Pi runtime does not support AI provider: ${provider}`);
}

function piCommand(config: PiRuntimeConfig, modelConfig: PiModelConfig): string {
  if (modelConfig.apiEndpoint) {
    throw new Error("Pi runtime does not support custom AI apiEndpoint yet");
  }
  return [
    shellQuote(`${config.piSandboxMountPath}/bin/pi`),
    "-p",
    "--no-context-files",
    "--no-session",
    "--provider",
    shellQuote(modelProvider(modelConfig.provider)),
    "--model",
    shellQuote(modelConfig.modelId),
  ].join(" ");
}

function repositoryCloneUrl(input: PiReviewInput): string {
  const base = input.gitLabUrl.replace(/\/+$/, "");
  return `${base}/${input.repositoryPath}.git`;
}

function reviewPrompt(input: PiReviewInput, profilePrompt: string | null, profilePromptMode: string): string {
  return [
    "你是运行在隔离 sandbox 内的代码审查 Pi 智能体。",
    "只审查当前变更，不要修改代码，不要执行破坏性命令。",
    "输出必须是严格 JSON，不要使用 Markdown 代码块，不要输出 JSON 以外的文字。",
    "",
    PI_REVIEW_JSON_OUTPUT_FORMAT,
    "",
    `仓库：${input.repositoryPath}`,
    `标题：${input.title}`,
    `提交：${input.commitSha}`,
    `源分支：${input.sourceBranch}`,
    `目标分支：${input.targetBranch || "N/A"}`,
    `变更摘要：${input.summary || "无"}`,
    `MR IID：${input.mergeRequestIid}`,
    "",
    "审查要求：",
    profilePromptMode === "replace" && profilePrompt ? profilePrompt : [
      "优先找真实 bug、安全问题、并发问题、数据一致性问题和会导致线上故障的问题。",
      "不要输出风格偏好、泛泛建议或无法从代码证明的问题。",
      profilePrompt ? `额外要求：${profilePrompt}` : "",
    ].filter(Boolean).join("\n"),
    "",
    "必须先读取 /tmp/pi-review-input.json 中的变更文件和 patch，再按需读取工作区文件进行上下文确认。",
  ].join("\n");
}

function extractJsonOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error("Pi review output is empty");
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const candidate = trimmed.slice(start, end + 1);
      JSON.parse(candidate);
      return candidate;
    }
    throw new Error("Pi review output does not contain valid JSON");
  }
}

function readSeverity(value: unknown): ReviewComment["severity"] {
  if (value === "critical" || value === "normal" || value === "suggestion") {
    return value;
  }
  throw new Error("Pi finding severity must be critical, normal or suggestion");
}

function readPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Pi finding ${name} must be a positive integer`);
  }
  return value;
}

function readOptionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return readPositiveInteger(value, name);
}

function readConfidence(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error("Pi finding confidence must be a number");
  }
  return Math.min(1, Math.max(0, value));
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Pi finding ${name} must be a non-empty string`);
  }
  return value.trim();
}

function parseFinding(value: unknown): ReviewComment {
  if (!isObject(value)) {
    throw new Error("Pi finding must be an object");
  }

  const finding = value as PiFindingPayload;
  return {
    filePath: readString(finding.filePath, "filePath"),
    lineNumber: readPositiveInteger(finding.lineNumber, "lineNumber"),
    lineRangeEnd: readOptionalPositiveInteger(finding.lineRangeEnd, "lineRangeEnd"),
    severity: readSeverity(finding.severity),
    content: readString(finding.content, "content"),
    confidence: readConfidence(finding.confidence),
  };
}

export function parsePiReviewResult(rawResponse: string): PiReviewResult {
  const payload = JSON.parse(rawResponse) as PiReviewPayload;
  if (!isObject(payload)) {
    throw new Error("Pi review output must be a JSON object");
  }

  const rawFindings = Array.isArray(payload.findings)
    ? payload.findings
    : Array.isArray(payload.comments)
      ? payload.comments
      : [];

  return {
    summary: typeof payload.summary === "string" ? payload.summary : "",
    comments: rawFindings.map(parseFinding),
    rawResponse,
  };
}

export function toPiFileReviewResult(result: PiReviewResult): FileReviewResult[] {
  if (result.comments.length === 0) {
    return [];
  }

  return [{
    filePath: "Pi Review",
    piRawOutput: result.rawResponse,
    prompt: "",
    counts: {
      critical: result.comments.filter((item) => item.severity === "critical").length,
      normal: result.comments.filter((item) => item.severity === "normal").length,
      suggestion: result.comments.filter((item) => item.severity === "suggestion").length,
    },
    criticalItems: result.comments
      .filter((item) => item.severity === "critical")
      .map((item) => ({
        filePath: item.filePath,
        lineNumber: item.lineNumber,
        lineRangeEnd: item.lineRangeEnd,
        content: item.content,
      })),
    reviewItems: result.comments,
  }];
}

export function buildPiReviewInput(state: ReviewState): PiReviewInput {
  const reviewLog = state.reviewLog;
  if (!reviewLog) {
    throw new Error("Review log is required before running Pi review");
  }

  return {
    reviewLogId: state.reviewLogId,
    repositoryId: reviewLog.repositoryId,
    repositoryPath: reviewLog.repository.path,
    gitLabUrl: reviewLog.repository.gitLabAccount.url,
    gitLabProjectId: reviewLog.repository.gitLabProjectId,
    sourceBranch: reviewLog.sourceBranch,
    targetBranch: reviewLog.targetBranch,
    commitSha: reviewLog.commitSha,
    mergeRequestIid: reviewLog.mergeRequestIid,
    title: reviewLog.title,
    description: reviewLog.description,
    summary: state.summary,
    changedFiles: state.relevantDiffs.map((diff) => ({
      filePath: diff.new_path || diff.old_path,
      patch: generatePatch(diff),
    })),
  };
}

function createSandbox(input: PiReviewInput, config: PiRuntimeConfig): Promise<Sandbox> {
  return Sandbox.create({
    connectionConfig: createOpenSandboxConnectionConfig(config),
    image: config.piSandboxImage,
    timeoutSeconds: config.piSandboxTimeoutSeconds,
    metadata: {
      app: "code-review-copilot",
      repositoryId: input.repositoryId,
      repositoryPath: input.repositoryPath,
    },
    volumes: [{
      name: "pi",
      host: { path: config.piHostPath },
      mountPath: config.piSandboxMountPath,
      readOnly: true,
    }],
    env: {
      PI_OFFLINE: "0",
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
    },
  });
}

function connectSandbox(sandboxId: string, config: PiRuntimeConfig): Promise<Sandbox> {
  return Sandbox.connect({
    sandboxId,
    connectionConfig: createOpenSandboxConnectionConfig(config),
    readyTimeoutSeconds: 60,
  });
}

function resumeSandbox(sandboxId: string, config: PiRuntimeConfig): Promise<Sandbox> {
  return Sandbox.resume({
    sandboxId,
    connectionConfig: createOpenSandboxConnectionConfig(config),
    readyTimeoutSeconds: 60,
  });
}

function markBindingError(repositoryId: string, error: unknown) {
  return prisma.repositorySandboxBinding.updateMany({
    where: { repositoryId },
    data: {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown sandbox error",
    },
  });
}

function cleanupDuplicateSandbox(sandbox: Sandbox): Promise<void> {
  return sandbox.kill()
    .catch((error) => {
      logWarn(log, error, "Failed to remove duplicate sandbox", { sandboxId: sandbox.id });
    })
    .then(() => closeSandboxClient(sandbox));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureRepositorySandboxBinding(input: PiReviewInput, config: PiRuntimeConfig): Promise<{
  binding: RepositorySandboxBinding;
  sandbox: Sandbox | null;
}> {
  return prisma.repositorySandboxBinding.findUnique({
    where: { repositoryId: input.repositoryId },
  }).then((binding) => {
    if (!binding) {
      return createSandbox(input, config).then((sandbox) => {
        return prisma.repositorySandboxBinding.create({
          data: {
            repositoryId: input.repositoryId,
            sandboxId: sandbox.id,
            status: "running",
            image: config.piSandboxImage,
            piHostPath: config.piHostPath,
            piSandboxMountPath: config.piSandboxMountPath,
            metadataJson: toPrismaJsonInput({
              repositoryPath: input.repositoryPath,
              gitLabProjectId: input.gitLabProjectId,
            }),
          },
        }).then((created) => ({ binding: created, sandbox }))
          .catch((error) => {
            return prisma.repositorySandboxBinding.findUnique({
              where: { repositoryId: input.repositoryId },
            }).then((existingBinding) => {
              if (!existingBinding) {
                return cleanupDuplicateSandbox(sandbox)
                  .then(() => Promise.reject(error));
              }
              return cleanupDuplicateSandbox(sandbox)
                .then(() => {
                  logWarn(log, error, "Repository sandbox binding create raced, reconnecting existing binding", {
                    repositoryId: input.repositoryId,
                    sandboxId: existingBinding.sandboxId,
                  });
                  return { binding: existingBinding, sandbox: null };
                });
              });
          });
      });
    }

    return { binding, sandbox: null };
  });
}

function connectRepositorySandbox(
  binding: RepositorySandboxBinding,
  input: PiReviewInput,
  config: PiRuntimeConfig,
  sandbox: Sandbox | null,
): Promise<Sandbox> {
  const connect = sandbox
    ? Promise.resolve(sandbox)
    : binding.status === "paused"
      ? resumeSandbox(binding.sandboxId, config)
      : connectSandbox(binding.sandboxId, config);

  return connect.then((connectedSandbox) => {
    return prisma.repositorySandboxBinding.update({
      where: { id: binding.id },
      data: {
        status: "running",
        lastUsedAt: new Date(),
        pausedAt: null,
        error: null,
      },
    }).then(() => connectedSandbox);
  }).catch((error) => {
    return markBindingError(input.repositoryId, error)
      .then(() => Promise.reject(error));
  });
}

function reserveReviewSandboxSession(
  binding: RepositorySandboxBinding,
  input: PiReviewInput,
  worktreePath: string,
  attempt = 0,
): Promise<ReviewSandboxSession> {
  return prisma.$transaction((tx) => {
    return tx.repositorySandboxBinding.updateMany({
      where: {
        id: binding.id,
        status: { in: SANDBOX_SESSION_RESERVABLE_STATUSES },
      },
      data: {
        status: "running",
        lastUsedAt: new Date(),
        pausedAt: null,
        error: null,
      },
    }).then((reserved) => {
      if (reserved.count === 0) {
        return Promise.reject(new Error("Repository sandbox is pausing"));
      }

      return tx.reviewSandboxSession.create({
        data: {
          reviewLogId: input.reviewLogId,
          repositorySandboxBindingId: binding.id,
          sandboxId: binding.sandboxId,
          worktreePath,
          status: "running",
        },
      });
    });
  }).catch((error) => {
    if (error instanceof Error && error.message === "Repository sandbox is pausing" && attempt < 30) {
      return delay(1000).then(() => reserveReviewSandboxSession(binding, input, worktreePath, attempt + 1));
    }
    return Promise.reject(error);
  });
}

function prepareRepository(sandbox: Sandbox, input: PiReviewInput, gitLabToken: string): Promise<void> {
  const repoRoot = `/workspace/repos/${input.repositoryId}`;
  const bareRepoPath = `${repoRoot}/repo.git`;
  const lockPath = `${repoRoot}/repo.lock`;
  const cloneUrl = repositoryCloneUrl(input);
  const lockedCommand = [
    `mkdir -p ${shellQuote(repoRoot)}`,
    `if [ ! -d ${shellQuote(bareRepoPath)} ]; then git -c "http.extraHeader=PRIVATE-TOKEN: $GITLAB_PRIVATE_TOKEN" clone --bare ${shellQuote(cloneUrl)} ${shellQuote(bareRepoPath)}; fi`,
    `git -C ${shellQuote(bareRepoPath)} -c "http.extraHeader=PRIVATE-TOKEN: $GITLAB_PRIVATE_TOKEN" fetch --prune origin '+refs/heads/*:refs/heads/*' '+refs/merge-requests/*/head:refs/merge-requests/*/head'`,
  ].join("\n");
  const command = [
    `mkdir -p ${shellQuote(repoRoot)}`,
    `flock -w 1800 ${shellQuote(lockPath)} sh -lc ${shellQuote(lockedCommand)}`,
  ].join("\n");

  return sandbox.commands.run(command, {
    timeoutSeconds: 1800,
    envs: {
      GIT_TERMINAL_PROMPT: "0",
      GITLAB_PRIVATE_TOKEN: gitLabToken,
    },
  }).then((execution) => {
    ensureSuccessfulCommand(execution, "Prepare sandbox repository");
  });
}

function reviewWorktreePath(input: PiReviewInput): string {
  return `/workspace/reviews/${input.reviewLogId}`;
}

function createReviewWorktree(sandbox: Sandbox, input: PiReviewInput): Promise<string> {
  const worktreePath = `/workspace/reviews/${input.reviewLogId}`;
  const bareRepoPath = `/workspace/repos/${input.repositoryId}/repo.git`;
  const lockPath = `/workspace/repos/${input.repositoryId}/repo.lock`;
  const lockedCommand = [
    `git -C ${shellQuote(bareRepoPath)} worktree remove --force ${shellQuote(worktreePath)} 2>/dev/null || rm -rf ${shellQuote(worktreePath)}`,
    `git -C ${shellQuote(bareRepoPath)} worktree prune`,
    `git -C ${shellQuote(bareRepoPath)} worktree add --detach ${shellQuote(worktreePath)} ${shellQuote(input.commitSha)}`,
  ].join("\n");
  const command = [
    `mkdir -p ${shellQuote("/workspace/reviews")}`,
    `flock -w 600 ${shellQuote(lockPath)} sh -lc ${shellQuote(lockedCommand)}`,
  ].join("\n");

  return sandbox.commands.run(command, { timeoutSeconds: 600 }).then((execution) => {
    ensureSuccessfulCommand(execution, "Create review worktree");
    return worktreePath;
  });
}

function writeReviewInput(sandbox: Sandbox, input: PiReviewInput): Promise<void> {
  return sandbox.files.writeFiles([
    {
      path: "/tmp/pi-review-input.json",
      data: JSON.stringify(input, null, 2),
      mode: 0o600,
    },
  ]).then(() => undefined);
}

function bindReviewSandboxCommandId(reviewLogId: string, commandId: string): Promise<void> {
  return prisma.reviewSandboxSession.updateMany({
    where: {
      reviewLogId,
      status: { in: SANDBOX_SESSION_ACTIVE_STATUSES },
    },
    data: {
      piCommandId: commandId,
    },
  }).then(() => undefined);
}

function runPiCommand(
  sandbox: Sandbox,
  params: RunPiReviewParams,
  config: PiRuntimeConfig,
  worktreePath: string,
): Promise<PiReviewResult> {
  const prompt = reviewPrompt(params.input, params.profilePrompt, params.profilePromptMode);
  const promptPath = "/tmp/pi-review-prompt.txt";
  const controller = registerRunningPiCommand(params.input.reviewLogId, sandbox.id);
  return sandbox.files.writeFiles([{
    path: promptPath,
    data: prompt,
    mode: 0o600,
  }]).then(() => {
    const command = `${piCommand(config, params.modelConfig)} < ${shellQuote(promptPath)}`;
    return sandbox.commands.run(command, {
      workingDirectory: worktreePath,
      timeoutSeconds: Math.min(config.piSandboxTimeoutSeconds, 3600),
      envs: {
        ...modelEnv(params.modelConfig.provider, params.modelConfig.apiKey),
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
      },
    }, {
      onInit: (init) => {
        bindRunningPiCommandId(params.input.reviewLogId, init.id);
        return bindReviewSandboxCommandId(params.input.reviewLogId, init.id);
      },
    }, controller.signal);
  }).then((execution) => {
    ensureSuccessfulCommand(execution, "Pi review");
    return parsePiReviewResult(extractJsonOutput(stdoutText(execution)));
  }).finally(() => {
    unregisterRunningPiCommand(params.input.reviewLogId);
  });
}

function finalSessionStatus(reviewLogId: string, fallback: "completed" | "failed"): Promise<"completed" | "failed" | "cancelled"> {
  return prisma.reviewLog.findUnique({
    where: { id: reviewLogId },
    select: { status: true },
  }).then((reviewLog) => {
    if (isReviewCancelledStatus(reviewLog?.status)) return REVIEW_CANCELLED_STATUS;
    return fallback;
  });
}

function completeSession(sessionId: string, reviewLogId: string, status: "completed" | "failed", error?: unknown) {
  return finalSessionStatus(reviewLogId, status).then((finalStatus) => {
    return prisma.reviewSandboxSession.updateMany({
      where: {
        id: sessionId,
        status: { in: SANDBOX_SESSION_ACTIVE_STATUSES },
      },
      data: {
        status: finalStatus,
        error: finalStatus === REVIEW_CANCELLED_STATUS
          ? "手动停止"
          : error instanceof Error ? error.message : error ? String(error) : null,
        completedAt: new Date(),
      },
    });
  }).then(() => undefined);
}

function cleanupWorktree(sandbox: Sandbox, input: PiReviewInput, worktreePath: string): Promise<void> {
  const bareRepoPath = `/workspace/repos/${input.repositoryId}/repo.git`;
  const lockPath = `/workspace/repos/${input.repositoryId}/repo.lock`;
  const lockedCommand = [
    `git -C ${shellQuote(bareRepoPath)} worktree remove --force ${shellQuote(worktreePath)} 2>/dev/null || rm -rf ${shellQuote(worktreePath)}`,
    `git -C ${shellQuote(bareRepoPath)} worktree prune`,
  ].join("\n");
  return sandbox.commands.run(`flock -w 120 ${shellQuote(lockPath)} sh -lc ${shellQuote(lockedCommand)}`, { timeoutSeconds: 180 })
    .then((execution) => {
      ensureSuccessfulCommand(execution, "Cleanup review worktree");
    })
    .catch((error) => {
      logWarn(log, error, "Failed to cleanup review worktree", { worktreePath });
    });
}

function pauseSandboxIfIdle(sandbox: Sandbox, bindingId: string): Promise<void> {
  return prisma.repositorySandboxBinding.updateMany({
    where: {
      id: bindingId,
      status: "running",
      sessions: {
        none: { status: { in: SANDBOX_SESSION_ACTIVE_STATUSES } },
      },
    },
    data: {
      status: "pausing",
      lastUsedAt: new Date(),
    },
  }).then((reserved) => {
    if (reserved.count === 0) return undefined;

    return sandbox.pause()
      .then(() => prisma.repositorySandboxBinding.updateMany({
        where: {
          id: bindingId,
          status: "pausing",
          sessions: {
            none: { status: { in: SANDBOX_SESSION_ACTIVE_STATUSES } },
          },
        },
        data: {
          status: "paused",
          pausedAt: new Date(),
          lastUsedAt: new Date(),
          error: null,
        },
      }))
      .then(() => undefined)
      .catch((error) => {
        return prisma.repositorySandboxBinding.updateMany({
          where: {
            id: bindingId,
            status: "pausing",
          },
          data: {
            status: "error",
            error: error instanceof Error ? error.message : "Failed to pause sandbox",
          },
        }).then(() => Promise.reject(error));
      })
      .then(() => undefined);
  }).catch((error) => {
    logWarn(log, error, "Failed to pause idle sandbox", { sandboxId: sandbox.id });
  });
}

function closeSandboxClient(sandbox: Sandbox): Promise<void> {
  return sandbox.close().catch((error) => {
    if (error instanceof SandboxException) {
      logWarn(log, error, "Failed to close sandbox client", { code: error.error.code });
      return;
    }
    logWarn(log, error, "Failed to close sandbox client");
  });
}

export function runPiReview(params: RunPiReviewParams): Promise<PiReviewResult> {
  const config = readPiRuntimeConfig();
  let activeSandbox: Sandbox | null = null;
  let activeBindingId: string | null = null;
  let activeSessionId: string | null = null;
  const activeWorktreePath = reviewWorktreePath(params.input);
  const finalizeReviewRuntime = (status: "completed" | "failed", error?: unknown): Promise<void> => {
    const sandbox = activeSandbox;
    const bindingId = activeBindingId;
    const sessionId = activeSessionId;
    const completeActiveSession = sessionId
      ? () => completeSession(sessionId, params.input.reviewLogId, status, error)
      : () => Promise.resolve();

    if (!sandbox || !bindingId) {
      return completeActiveSession();
    }

    return cleanupWorktree(sandbox, params.input, activeWorktreePath)
      .then(() => completeActiveSession())
      .then(() => pauseSandboxIfIdle(sandbox, bindingId))
      .then(() => closeSandboxClient(sandbox));
  };

  return ensureRepositorySandboxBinding(params.input, config).then(({ binding, sandbox }) => {
    activeSandbox = sandbox;
    activeBindingId = binding.id;
    return reserveReviewSandboxSession(binding, params.input, activeWorktreePath).then((session) => {
      activeSessionId = session.id;
      return connectRepositorySandbox(binding, params.input, config, sandbox)
        .then((connectedSandbox) => {
          activeSandbox = connectedSandbox;
          return connectedSandbox;
        })
        .then((connectedSandbox) => assertReviewNotCancelled(params.input.reviewLogId)
          .then(() => prepareRepository(connectedSandbox, params.input, params.gitLabAccessToken))
          .then(() => assertReviewNotCancelled(params.input.reviewLogId))
          .then(() => createReviewWorktree(connectedSandbox, params.input))
          .then(() => assertReviewNotCancelled(params.input.reviewLogId))
          .then(() => writeReviewInput(connectedSandbox, params.input))
          .then(() => assertReviewNotCancelled(params.input.reviewLogId))
          .then(() => runPiCommand(connectedSandbox, params, config, activeWorktreePath)));
    });
  }).then((result) => {
    return finalizeReviewRuntime("completed").then(() => result);
  }).catch((error) => {
    return finalizeReviewRuntime("failed", error).then(() => Promise.reject(error));
  });
}
