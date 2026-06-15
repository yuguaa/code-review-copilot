import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import type { RepositorySandboxBinding, ReviewSandboxSession } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReviewState, FileReviewResult } from "@/lib/review/types";
import { generatePatch, toPrismaJsonInput } from "@/lib/review/utils";
import { checkPiRuntimePaths, readPiRuntimeConfig, type PiRuntimeConfig } from "@/lib/services/pi-runtime-config";
import { runRuntimeCommand, type RuntimeCommandExecution } from "@/lib/services/pi-runtime-process";
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
const REPOSITORY_LOCK_TIMEOUT_SECONDS = 1800;
const WORKTREE_LOCK_TIMEOUT_SECONDS = 600;
const CLEANUP_TIMEOUT_SECONDS = 180;
const BUBBLEWRAP_RUNTIME_LABEL = "bubblewrap";
const SANDBOX_REVIEW_INPUT_PATH = "/tmp/pi-review-input.json";
const SANDBOX_REVIEW_PROMPT_PATH = "/tmp/pi-review-prompt.txt";

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

type RuntimePaths = {
  workspaceRoot: string;
  repositoryRoot: string;
  bareRepoPath: string;
  lockPath: string;
  reviewsRoot: string;
  worktreePath: string;
  inputPath: string;
  promptPath: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandOutput(execution: RuntimeCommandExecution): string {
  return execution.stderr || execution.stdout || `exitCode=${execution.exitCode ?? "null"}`;
}

function ensureSuccessfulCommand(execution: RuntimeCommandExecution, label: string): RuntimeCommandExecution {
  if (execution.exitCode !== 0) {
    throw new Error(`${label} failed: ${commandOutput(execution)}`);
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

function piCommand(config: PiRuntimeConfig, modelConfig: PiModelConfig): string[] {
  if (modelConfig.apiEndpoint) {
    throw new Error("Pi runtime does not support custom AI apiEndpoint yet");
  }
  return [
    `${config.piSandboxMountPath}/bin/pi`,
    "-p",
    "--no-context-files",
    "--no-session",
    "--provider",
    modelProvider(modelConfig.provider),
    "--model",
    modelConfig.modelId,
  ];
}

function repositoryCloneUrl(input: PiReviewInput): string {
  const base = input.gitLabUrl.replace(/\/+$/, "");
  return `${base}/${input.repositoryPath}.git`;
}

function reviewPrompt(input: PiReviewInput, profilePrompt: string | null, profilePromptMode: string): string {
  return [
    "你是运行在 Bubblewrap 隔离环境内的代码审查 Pi 智能体。",
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
    `必须先读取 ${SANDBOX_REVIEW_INPUT_PATH} 中的变更文件和 patch，再按需读取工作区文件进行上下文确认。`,
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

function runtimePaths(config: PiRuntimeConfig, input: PiReviewInput): RuntimePaths {
  const workspaceRoot = path.resolve(config.bubblewrapWorkspaceRoot);
  const repositoryRoot = path.join(workspaceRoot, "repos", input.repositoryId);
  return {
    workspaceRoot,
    repositoryRoot,
    bareRepoPath: path.join(repositoryRoot, "repo.git"),
    lockPath: path.join(repositoryRoot, "repo.lock"),
    reviewsRoot: path.join(workspaceRoot, "reviews"),
    worktreePath: path.join(workspaceRoot, "reviews", input.reviewLogId),
    inputPath: path.join(workspaceRoot, "tmp", input.reviewLogId, "pi-review-input.json"),
    promptPath: path.join(workspaceRoot, "tmp", input.reviewLogId, "pi-review-prompt.txt"),
  };
}

function createWorkspace(config: PiRuntimeConfig, input: PiReviewInput): Promise<RuntimePaths> {
  const paths = runtimePaths(config, input);
  return mkdir(paths.repositoryRoot, { recursive: true })
    .then(() => mkdir(paths.reviewsRoot, { recursive: true }))
    .then(() => mkdir(path.dirname(paths.inputPath), { recursive: true }))
    .then(() => paths);
}

function runShell(command: string, timeoutSeconds: number, env?: Record<string, string>): Promise<RuntimeCommandExecution> {
  return runRuntimeCommand("sh", ["-lc", command], {
    timeoutSeconds,
    env: {
      ...process.env,
      ...env,
    } as NodeJS.ProcessEnv,
  });
}

function bubblewrapSandboxPath(config: PiRuntimeConfig, hostPath: string): string {
  const workspaceRoot = path.resolve(config.bubblewrapWorkspaceRoot);
  const resolvedHostPath = path.resolve(hostPath);
  if (resolvedHostPath === workspaceRoot) {
    return workspaceRoot;
  }
  const relative = path.relative(workspaceRoot, resolvedHostPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside Bubblewrap workspace: ${hostPath}`);
  }
  return path.posix.join(workspaceRoot.split(path.sep).join(path.posix.sep), relative.split(path.sep).join(path.posix.sep));
}

function bubblewrapParentDirMounts(paths: string[]): string[] {
  const dirs = new Set<string>();
  paths.forEach((targetPath) => {
    const parts = path.resolve(targetPath).split(path.sep).filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      dirs.add(path.sep + parts.slice(0, index).join(path.sep));
    }
  });
  return [...dirs].sort((a, b) => a.length - b.length).flatMap((dir) => ["--dir", dir]);
}

function bubblewrapArgs(
  config: PiRuntimeConfig,
  repositoryRoot: string,
  worktreePath: string,
  inputPath: string,
  promptPath: string,
  modelConfig: PiModelConfig,
): string[] {
  const workdir = bubblewrapSandboxPath(config, worktreePath);
  const piArgs = piCommand(config, modelConfig);

  return [
    "--clearenv",
    "--die-with-parent",
    "--new-session",
    "--unshare-pid",
    "--unshare-ipc",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind-try",
    "/bin",
    "/bin",
    "--ro-bind-try",
    "/lib",
    "/lib",
    "--ro-bind-try",
    "/lib64",
    "/lib64",
    "--ro-bind",
    "/etc",
    "/etc",
    "--ro-bind",
    config.piHostPath,
    config.piSandboxMountPath,
    ...bubblewrapParentDirMounts([repositoryRoot, worktreePath]),
    "--ro-bind",
    repositoryRoot,
    repositoryRoot,
    "--ro-bind",
    worktreePath,
    worktreePath,
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/run",
    "--ro-bind",
    inputPath,
    SANDBOX_REVIEW_INPUT_PATH,
    "--ro-bind",
    promptPath,
    SANDBOX_REVIEW_PROMPT_PATH,
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "PATH",
    "/usr/local/bin:/usr/bin:/bin",
    "--setenv",
    "PI_SKIP_VERSION_CHECK",
    "1",
    "--setenv",
    "PI_TELEMETRY",
    "0",
    ...Object.entries(modelEnv(modelConfig.provider, modelConfig.apiKey)).flatMap(([key, value]) => [
      "--setenv",
      key,
      value,
    ]),
    "--chdir",
    workdir,
    "--",
    ...piArgs,
  ];
}

function bindingId(input: PiReviewInput): string {
  return `bwrap:${input.repositoryId}`;
}

function markBindingError(repositoryId: string, error: unknown) {
  return prisma.repositorySandboxBinding.updateMany({
    where: { repositoryId },
    data: {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown Bubblewrap runtime error",
    },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureRepositorySandboxBinding(input: PiReviewInput, config: PiRuntimeConfig): Promise<RepositorySandboxBinding> {
  return prisma.repositorySandboxBinding.findUnique({
    where: { repositoryId: input.repositoryId },
  }).then((binding) => {
    if (binding) {
      return prisma.repositorySandboxBinding.update({
        where: { id: binding.id },
        data: {
          sandboxId: binding.sandboxId.startsWith("bwrap:") ? binding.sandboxId : bindingId(input),
          status: "running",
          image: BUBBLEWRAP_RUNTIME_LABEL,
          piHostPath: config.piHostPath,
          piSandboxMountPath: config.piSandboxMountPath,
          lastUsedAt: new Date(),
          pausedAt: null,
          error: null,
          metadataJson: toPrismaJsonInput({
            repositoryPath: input.repositoryPath,
            gitLabProjectId: input.gitLabProjectId,
            workspaceRoot: config.bubblewrapWorkspaceRoot,
            runtime: BUBBLEWRAP_RUNTIME_LABEL,
          }),
        },
      });
    }

    return prisma.repositorySandboxBinding.create({
      data: {
        repositoryId: input.repositoryId,
        sandboxId: bindingId(input),
        status: "running",
        image: BUBBLEWRAP_RUNTIME_LABEL,
        piHostPath: config.piHostPath,
        piSandboxMountPath: config.piSandboxMountPath,
        metadataJson: toPrismaJsonInput({
          repositoryPath: input.repositoryPath,
          gitLabProjectId: input.gitLabProjectId,
          workspaceRoot: config.bubblewrapWorkspaceRoot,
          runtime: BUBBLEWRAP_RUNTIME_LABEL,
        }),
      },
    }).catch((error) => {
      return prisma.repositorySandboxBinding.findUnique({
        where: { repositoryId: input.repositoryId },
      }).then((existingBinding) => {
        if (!existingBinding) return Promise.reject(error);
        logWarn(log, error, "Repository sandbox binding create raced, reusing existing binding", {
          repositoryId: input.repositoryId,
          sandboxId: existingBinding.sandboxId,
        });
        return existingBinding;
      });
    });
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

function prepareRepository(input: PiReviewInput, gitLabToken: string, paths: RuntimePaths): Promise<void> {
  const cloneUrl = repositoryCloneUrl(input);
  const lockedCommand = [
    `mkdir -p ${shellQuote(paths.repositoryRoot)}`,
    `if [ ! -d ${shellQuote(paths.bareRepoPath)} ]; then git -c "http.extraHeader=PRIVATE-TOKEN: $GITLAB_PRIVATE_TOKEN" clone --bare ${shellQuote(cloneUrl)} ${shellQuote(paths.bareRepoPath)}; fi`,
    `git -C ${shellQuote(paths.bareRepoPath)} -c "http.extraHeader=PRIVATE-TOKEN: $GITLAB_PRIVATE_TOKEN" fetch --prune origin '+refs/heads/*:refs/heads/*' '+refs/merge-requests/*/head:refs/merge-requests/*/head'`,
  ].join("\n");
  const command = `flock -w ${REPOSITORY_LOCK_TIMEOUT_SECONDS} ${shellQuote(paths.lockPath)} sh -lc ${shellQuote(lockedCommand)}`;

  return runShell(command, REPOSITORY_LOCK_TIMEOUT_SECONDS, {
    GIT_TERMINAL_PROMPT: "0",
    GITLAB_PRIVATE_TOKEN: gitLabToken,
  }).then((execution) => {
    ensureSuccessfulCommand(execution, "Prepare sandbox repository");
  });
}

function createReviewWorktree(input: PiReviewInput, paths: RuntimePaths): Promise<string> {
  const lockedCommand = [
    `git -C ${shellQuote(paths.bareRepoPath)} worktree remove --force ${shellQuote(paths.worktreePath)} 2>/dev/null || rm -rf ${shellQuote(paths.worktreePath)}`,
    `git -C ${shellQuote(paths.bareRepoPath)} worktree prune`,
    `git -C ${shellQuote(paths.bareRepoPath)} worktree add --detach ${shellQuote(paths.worktreePath)} ${shellQuote(input.commitSha)}`,
  ].join("\n");
  const command = [
    `mkdir -p ${shellQuote(paths.reviewsRoot)}`,
    `flock -w ${WORKTREE_LOCK_TIMEOUT_SECONDS} ${shellQuote(paths.lockPath)} sh -lc ${shellQuote(lockedCommand)}`,
  ].join("\n");

  return runShell(command, WORKTREE_LOCK_TIMEOUT_SECONDS).then((execution) => {
    ensureSuccessfulCommand(execution, "Create review worktree");
    return paths.worktreePath;
  });
}

function writeReviewInput(input: PiReviewInput, paths: RuntimePaths): Promise<void> {
  return writeFile(paths.inputPath, JSON.stringify(input, null, 2), { mode: 0o600 });
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
  params: RunPiReviewParams,
  config: PiRuntimeConfig,
  paths: RuntimePaths,
): Promise<PiReviewResult> {
  const prompt = reviewPrompt(params.input, params.profilePrompt, params.profilePromptMode);
  const controller = registerRunningPiCommand(params.input.reviewLogId, bindingId(params.input));
  return writeFile(paths.promptPath, prompt, { mode: 0o600 }).then(() => {
    return runRuntimeCommand(config.bubblewrapBin, bubblewrapArgs(
      config,
      paths.repositoryRoot,
      paths.worktreePath,
      paths.inputPath,
      paths.promptPath,
      params.modelConfig,
    ), {
      timeoutSeconds: config.piSandboxTimeoutSeconds,
      stdinPath: paths.promptPath,
      signal: controller.signal,
      onStart: (commandId) => bindRunningPiCommandId(params.input.reviewLogId, commandId)
        .then(() => bindReviewSandboxCommandId(params.input.reviewLogId, commandId)),
    });
  }).then((execution) => {
    ensureSuccessfulCommand(execution, "Pi review");
    return parsePiReviewResult(extractJsonOutput(execution.stdout));
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

function cleanupWorktree(input: PiReviewInput, paths: RuntimePaths): Promise<void> {
  const lockedCommand = [
    `git -C ${shellQuote(paths.bareRepoPath)} worktree remove --force ${shellQuote(paths.worktreePath)} 2>/dev/null || rm -rf ${shellQuote(paths.worktreePath)}`,
    `git -C ${shellQuote(paths.bareRepoPath)} worktree prune`,
  ].join("\n");
  return runShell(`flock -w 120 ${shellQuote(paths.lockPath)} sh -lc ${shellQuote(lockedCommand)}`, CLEANUP_TIMEOUT_SECONDS)
    .then((execution) => {
      ensureSuccessfulCommand(execution, "Cleanup review worktree");
    })
    .catch((error) => {
      logWarn(log, error, "Failed to cleanup review worktree", {
        reviewLogId: input.reviewLogId,
        worktreePath: paths.worktreePath,
      });
    })
    .then(() => rm(path.dirname(paths.inputPath), { recursive: true, force: true }).catch((error) => {
      logWarn(log, error, "Failed to cleanup review runtime files", { reviewLogId: input.reviewLogId });
    }));
}

function pauseSandboxIfIdle(bindingId: string): Promise<void> {
  return prisma.repositorySandboxBinding.updateMany({
    where: {
      id: bindingId,
      status: "running",
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
  }).then(() => undefined).catch((error) => {
    logWarn(log, error, "Failed to mark idle sandbox", { bindingId });
  });
}

export function runPiReview(params: RunPiReviewParams): Promise<PiReviewResult> {
  const config = readPiRuntimeConfig();
  let activeBindingId: string | null = null;
  let activeSessionId: string | null = null;
  let activePaths: RuntimePaths | null = null;
  const finalizeReviewRuntime = (status: "completed" | "failed", error?: unknown): Promise<void> => {
    const binding = activeBindingId;
    const session = activeSessionId;
    const paths = activePaths;
    const completeActiveSession = session
      ? () => completeSession(session, params.input.reviewLogId, status, error)
      : () => Promise.resolve();

    if (!binding || !paths) {
      return completeActiveSession();
    }

    return cleanupWorktree(params.input, paths)
      .then(() => completeActiveSession())
      .then(() => pauseSandboxIfIdle(binding));
  };

  return createWorkspace(config, params.input)
    .then((paths) => checkPiRuntimePaths(config).then(() => paths))
    .then((paths) => {
      activePaths = paths;
      return ensureRepositorySandboxBinding(params.input, config).then((binding) => {
        activeBindingId = binding.id;
        return reserveReviewSandboxSession(binding, params.input, paths.worktreePath).then((session) => {
          activeSessionId = session.id;
          return assertReviewNotCancelled(params.input.reviewLogId)
            .then(() => prepareRepository(params.input, params.gitLabAccessToken, paths))
            .then(() => assertReviewNotCancelled(params.input.reviewLogId))
            .then(() => createReviewWorktree(params.input, paths))
            .then(() => assertReviewNotCancelled(params.input.reviewLogId))
            .then(() => writeReviewInput(params.input, paths))
            .then(() => assertReviewNotCancelled(params.input.reviewLogId))
            .then(() => runPiCommand(params, config, paths));
        });
      });
    }).then((result) => {
      return finalizeReviewRuntime("completed").then(() => result);
    }).catch((error) => {
      return markBindingError(params.input.repositoryId, error)
        .then(() => finalizeReviewRuntime("failed", error))
        .then(() => Promise.reject(error));
    });
}
