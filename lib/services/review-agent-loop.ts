import { prisma } from "@/lib/prisma";
import { aiService } from "@/lib/services/ai";
import { contextRetrieverService, type RetrievedAgentContext } from "@/lib/services/context-retriever";
import { validateReviewFindingsWithReport } from "@/lib/review/finding-validation";
import { buildFindingKey, toPrismaJsonInput } from "@/lib/review/utils";
import {
  buildReviewAgentCriticPrompt,
  buildReviewAgentPlanPrompt,
  buildReviewAgentReviewPrompt,
  REVIEW_AGENT_CRITIC_SYSTEM_PROMPT,
  REVIEW_AGENT_PLAN_SYSTEM_PROMPT,
  REVIEW_AGENT_REVIEW_SYSTEM_PROMPT,
} from "@/lib/prompts";
import type { AIModelConfig, ReviewComment } from "@/lib/types";
import { normalizeAgentLoopBudget, type AgentLoopBudget } from "@/lib/services/review-budget";
import { reviewWorkflowRecorder } from "@/lib/services/review-workflow-recorder";

const MEMORY_WRITE_CONFIDENCE = 0.85;
const ADDITIONAL_AGENT_CRITICAL_FINDINGS_THRESHOLD = 1;
const ADDITIONAL_AGENT_ACTIONABLE_FINDINGS_THRESHOLD = 1;
const MAX_REPEATED_PROGRESS_SIGNATURES = 2;

function toValidationDiff(diff: AgentLoopInput["diffs"][number]) {
  return {
    old_path: diff.filePath,
    new_path: diff.filePath,
    diff: diff.diff,
    new_file: false,
    renamed_file: false,
    deleted_file: false,
  };
}

export interface AgentLoopInput {
  reviewLogId: string;
  reviewBotRunId: string;
  repositoryId: string;
  branch: string;
  commitSha: string;
  title: string;
  description?: string | null;
  changedFiles: string[];
  diffs: Array<{ filePath: string; diff: string }>;
  modelConfig: AIModelConfig;
  memorySnapshotId?: string | null;
  existingFindings: Array<ReviewComment & { confidence?: number }>;
  budget?: Partial<AgentLoopBudget>;
  botName?: string;
  botPrompt?: string | null;
  botPromptMode?: string | null;
  availableAdditionalAgents?: AdditionalReviewAgent[];
}

export interface AdditionalReviewAgent {
  id: string;
  name: string;
  description?: string | null;
  prompt?: string | null;
  promptMode?: string | null;
  modelConfig: AIModelConfig;
  budget?: Partial<AgentLoopBudget>;
}

interface AgentPlan {
  changeType?: string;
  riskLevel?: "low" | "medium" | "high";
  focusAreas?: string[];
  contextFiles?: string[];
  reviewStrategy?: string;
  needsMoreContext?: boolean;
  requestedTools?: string[];
}

interface AgentCriticResult {
  shouldContinue?: boolean;
  reason?: string;
  newHighConfidenceFindings?: number;
  duplicatesRemoved?: number;
  memoryFacts?: Array<{
    type: string;
    content: string;
    confidence: number;
    evidence: string;
  }>;
}

type AgentLoopStopReason =
  | "continue"
  | "max_iterations"
  | "max_findings"
  | "critic_stop"
  | "no_new_findings"
  | "no_more_context"
  | "no_requested_tools"
  | "no_progress";

interface AdditionalAgentToolResult {
  agentId: string;
  agentName: string;
  status: "completed" | "failed";
  summary: string;
  findings: Array<ReviewComment & { confidence: number }>;
}

type AgentTraceEventStage =
  | "initializing"
  | "context"
  | "plan"
  | "tool"
  | "review"
  | "validation"
  | "critic"
  | "finish"
  | "error";

type AgentTraceEventStatus = "running" | "completed" | "failed" | "skipped";

type AgentTraceEventInput = {
  iteration: number;
  stage: AgentTraceEventStage;
  status: AgentTraceEventStatus;
  title: string;
  detail?: string;
  durationMs?: number;
  metrics?: Record<string, unknown>;
  parentNodeKey?: string;
};

const stageSequence: Record<AgentTraceEventStage, number> = {
  initializing: 0,
  context: 2,
  plan: 4,
  review: 6,
  validation: 8,
  tool: 12,
  critic: 14,
  finish: 16,
  error: 18,
};

function completedWorkflowStatus(status: Exclude<AgentTraceEventStatus, "running">) {
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  return "success";
}

function workflowStageNodeKey(botRunId: string, iteration: number, stage: AgentTraceEventStage) {
  return `agent:${botRunId}:iteration:${iteration}:${stage}`;
}

function workflowStageParentKey(botRunId: string, iteration: number, stage: AgentTraceEventStage) {
  if (stage === "initializing") return `agent:${botRunId}`;
  if (stage === "context") return workflowStageNodeKey(botRunId, iteration, "initializing");
  if (stage === "plan") return workflowStageNodeKey(botRunId, iteration, "context");
  if (stage === "review") return workflowStageNodeKey(botRunId, iteration, "plan");
  if (stage === "validation") return workflowStageNodeKey(botRunId, iteration, "review");
  if (stage === "tool") return workflowStageNodeKey(botRunId, iteration, "validation");
  if (stage === "critic") return workflowStageNodeKey(botRunId, iteration, "validation");
  if (stage === "finish") return workflowStageNodeKey(botRunId, iteration, "critic");
  return workflowStageNodeKey(botRunId, iteration, "critic");
}

function workflowStageSequence(iteration: number, stage: AgentTraceEventStage) {
  return 420 + iteration * 30 + stageSequence[stage];
}

export interface AgentLoopResult {
  traceId: string;
  finalPlan: AgentPlan;
  context: RetrievedAgentContext;
  critic: AgentCriticResult;
  agentFindings: Array<ReviewComment & { confidence: number }>;
  memoryUpdates: Array<{
    type: string;
    content: string;
    confidence: number;
    evidence: string;
  }>;
}

function safePlan(value: unknown): AgentPlan {
  if (!value || typeof value !== "object") return {};
  const data = value as AgentPlan;
  return {
    changeType: typeof data.changeType === "string" ? data.changeType : "unknown_change",
    riskLevel: data.riskLevel === "high" || data.riskLevel === "medium" || data.riskLevel === "low" ? data.riskLevel : "medium",
    focusAreas: Array.isArray(data.focusAreas) ? data.focusAreas.filter((item): item is string => typeof item === "string") : [],
    contextFiles: Array.isArray(data.contextFiles) ? data.contextFiles.filter((item): item is string => typeof item === "string") : [],
    reviewStrategy: typeof data.reviewStrategy === "string" ? data.reviewStrategy : "file_then_global_critic",
    needsMoreContext: Boolean(data.needsMoreContext),
    requestedTools: Array.isArray(data.requestedTools) ? data.requestedTools.filter((item): item is string => typeof item === "string") : [],
  };
}

function safeCritic(value: unknown): AgentCriticResult {
  if (!value || typeof value !== "object") {
    return { shouldContinue: false, reason: "critic returned invalid shape", memoryFacts: [] };
  }
  const data = value as AgentCriticResult;
  return {
    shouldContinue: Boolean(data.shouldContinue),
    reason: typeof data.reason === "string" ? data.reason : "critic completed",
    newHighConfidenceFindings: typeof data.newHighConfidenceFindings === "number" ? data.newHighConfidenceFindings : 0,
    duplicatesRemoved: typeof data.duplicatesRemoved === "number" ? data.duplicatesRemoved : 0,
    memoryFacts: Array.isArray(data.memoryFacts)
      ? data.memoryFacts
        .filter((item) => {
          return Boolean(
            item &&
            typeof item.content === "string" &&
            typeof item.confidence === "number" &&
            Number.isFinite(item.confidence) &&
            item.confidence >= MEMORY_WRITE_CONFIDENCE &&
            item.confidence <= 1,
          );
        })
        .map((item) => ({
          type: typeof item.type === "string" ? item.type : "review_lesson",
          content: item.content,
          confidence: item.confidence,
          evidence: typeof item.evidence === "string" ? item.evidence : "agent critic",
        }))
      : [],
  };
}

function dedupeFindings(
  findings: Array<ReviewComment & { confidence?: number }>,
  maxFindings: number,
): Array<ReviewComment & { confidence: number }> {
  const seen = new Set<string>();
  return findings
    .filter((item) => {
      const confidence = item.confidence ?? 0.5;
      return Number.isFinite(confidence);
    })
    .filter((item) => {
      const key = buildFindingKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxFindings)
    .map((item) => ({
      ...item,
      confidence: Math.min(1, Math.max(0, item.confidence ?? 0.5)),
    }));
}

function buildProgressSignature(params: {
  requestedFiles: string[];
  requestedTools: string[];
  contextFiles: string[];
  findings: Array<ReviewComment & { confidence?: number }>;
}): string {
  return JSON.stringify({
    requestedFiles: [...new Set(params.requestedFiles)].sort(),
    requestedTools: [...new Set(params.requestedTools)].sort(),
    contextFiles: [...new Set(params.contextFiles)].sort(),
    findingKeys: params.findings.map(buildFindingKey).sort(),
  });
}

function resolveStopReason(params: {
  hasBudget: boolean;
  hasFindingBudget: boolean;
  critic: AgentCriticResult;
  newFindings: number;
  needsMoreContext?: boolean;
  requestedTools: string[];
  nextFiles: string[];
  repeatedProgressCount: number;
}): AgentLoopStopReason {
  if (!params.hasBudget) return "max_iterations";
  if (!params.hasFindingBudget) return "max_findings";
  if (params.repeatedProgressCount >= MAX_REPEATED_PROGRESS_SIGNATURES) return "no_progress";
  if (!params.critic.shouldContinue) return "critic_stop";
  if (params.newFindings <= 0) return "no_new_findings";
  if (!params.needsMoreContext || params.nextFiles.length === 0) return "no_more_context";
  if (params.requestedTools.length === 0) return "no_requested_tools";
  return "continue";
}

function summarizeToolCalls(context: RetrievedAgentContext, requestedFiles: string[], maxDepth: number) {
  const resultCounts: Record<string, number> = {
    get_code_graph_status: context.codeGraph.available ? 1 : 0,
    get_architecture_summary: context.architectureSummary ? 1 : 0,
    get_memory_snapshot: context.architectureSummary ? 1 : 0,
    get_changed_files: requestedFiles.length,
    get_file_context: context.fileContexts.length,
    get_call_graph_neighbors: context.graphNeighbors.length,
    get_related_review_history: context.relatedReviews.length,
    rebuild_code_graph: context.codeGraph.available ? 0 : 1,
  };
  const argsByTool: Record<string, Record<string, unknown>> = {
    get_changed_files: { files: requestedFiles },
    get_file_context: { files: requestedFiles },
    get_call_graph_neighbors: { maxDepth },
  };

  return context.tools.map((tool) => ({
    tool: tool.name,
    status: tool.status,
    args: argsByTool[tool.name] || {},
    resultCount: resultCounts[tool.name] ?? 0,
    observation: tool.observation,
  }));
}

function modelName(modelConfig: AIModelConfig): string {
  return `${modelConfig.provider}/${modelConfig.modelId}`;
}

function sourceFor(botRunId: string, botName: string, botModel: string, confidence?: number) {
  return { reviewBotRunId: botRunId, botName, model: botModel, confidence };
}

function buildAdditionalAgentPrompt(agent: AdditionalReviewAgent, task?: string): string | null {
  const parts = [
    agent.prompt || "",
    task ? `【主 Agent 委托任务】\n${task}` : "",
  ].filter((item) => item.trim());

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function summarizeAdditionalAgentResults(results: AdditionalAgentToolResult[]): string {
  if (results.length === 0) return "未执行辅助 Agent。";

  return results
    .map((result) => `${result.agentName}(${result.status})：${result.summary}，findings=${result.findings.length}`)
    .join("；");
}

function selectRemainingAdditionalAgents(
  agents: AdditionalReviewAgent[],
  executedAgentIds: Set<string>,
): AdditionalReviewAgent[] {
  return agents.filter((agent) => !executedAgentIds.has(agent.id));
}

function ensureLoopIteration(
  loopIterations: Array<Record<string, unknown>>,
  iteration: number,
): Record<string, unknown> {
  const existing = loopIterations.find((item) => Number(item.iteration) === iteration);
  if (existing) {
    if (!Array.isArray(existing.events)) {
      existing.events = [];
    }
    return existing;
  }

  const nextIteration: Record<string, unknown> = {
    iteration,
    events: [],
  };
  loopIterations.push(nextIteration);
  return nextIteration;
}

function mergeLoopIterationSnapshot(
  loopIterations: Array<Record<string, unknown>>,
  iteration: number,
  snapshot: Record<string, unknown>,
) {
  const target = ensureLoopIteration(loopIterations, iteration);
  const events = Array.isArray(target.events) ? target.events : [];
  Object.assign(target, snapshot);
  target.events = events;
}

function getAdditionalAgentTrigger(findings: Array<ReviewComment & { confidence: number }>): {
  enabled: boolean;
  criticalCount: number;
  actionableCount: number;
  reason: string;
} {
  const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
  const actionableCount = findings.filter((finding) => (
    finding.severity === "critical" || finding.severity === "normal"
  )).length;

  if (criticalCount >= ADDITIONAL_AGENT_CRITICAL_FINDINGS_THRESHOLD) {
    return {
      enabled: true,
      criticalCount,
      actionableCount,
      reason: `发现 ${criticalCount} 个严重问题`,
    };
  }

  if (actionableCount >= ADDITIONAL_AGENT_ACTIONABLE_FINDINGS_THRESHOLD) {
    return {
      enabled: true,
      criticalCount,
      actionableCount,
      reason: `发现 ${actionableCount} 个需处理问题`,
    };
  }

  return {
    enabled: false,
    criticalCount,
    actionableCount,
    reason: "未达到辅助 Agent 触发条件",
  };
}

function buildFindingsThresholdTask(findings: Array<ReviewComment & { confidence: number }>): string {
  const trigger = getAdditionalAgentTrigger(findings);
  const findingLines = findings.slice(0, 12).map((finding, index) => (
    `${index + 1}. [${finding.severity}] ${finding.filePath}:${finding.lineNumber} ${finding.content}`
  ));

  return [
    `主 Agent ${trigger.reason}，达到辅助 Agent 复核条件。`,
    `当前统计：严重 ${trigger.criticalCount} 个，需处理问题 ${trigger.actionableCount} 个，总发现 ${findings.length} 条。`,
    "请基于你的专属审查视角复核本次变更，重点判断是否存在主 Agent 漏掉的跨文件、架构、安全、性能、测试或可维护性问题。",
    "不要重复下面已有问题；只有发现新的可定位、可修复问题才输出 comments。",
    `【已有问题】\n${findingLines.join("\n")}`,
  ].join("\n");
}

export class ReviewAgentLoopService {
  async run(input: AgentLoopInput): Promise<AgentLoopResult> {
    const budget = normalizeAgentLoopBudget(input.budget);
    const loopIterations: Array<Record<string, unknown>> = [];
    let finalPlan: AgentPlan = {};
    let latestContext: RetrievedAgentContext | null = null;
    let latestCritic: AgentCriticResult = { shouldContinue: false, reason: "not started", memoryFacts: [] };
    let findings = dedupeFindings(input.existingFindings, budget.maxFindings);
    let requestedFiles = [...input.changedFiles];
    let iteration = 1;
    const executedAdditionalAgentIds = new Set<string>();
    const progressSignatures = new Map<string, number>();
    let eventSequence = 0;
    const persistTraceProgress = (memoryUpdates: unknown[] = []) => {
      return prisma.reviewAgentTrace.upsert({
        where: { reviewBotRunId: input.reviewBotRunId },
        update: {
          reviewLogId: input.reviewLogId,
          reviewBotRunId: input.reviewBotRunId,
          memorySnapshotId: input.memorySnapshotId || null,
          loopIterationsJson: toPrismaJsonInput(loopIterations),
          retrievedContextJson: toPrismaJsonInput(latestContext || {}),
          finalPlanJson: toPrismaJsonInput(finalPlan),
          criticJson: toPrismaJsonInput(latestCritic),
          memoryUpdatesJson: toPrismaJsonInput(memoryUpdates),
        },
        create: {
          reviewLogId: input.reviewLogId,
          reviewBotRunId: input.reviewBotRunId,
          memorySnapshotId: input.memorySnapshotId || null,
          loopIterationsJson: toPrismaJsonInput(loopIterations),
          retrievedContextJson: toPrismaJsonInput(latestContext || {}),
          finalPlanJson: toPrismaJsonInput(finalPlan),
          criticJson: toPrismaJsonInput(latestCritic),
          memoryUpdatesJson: toPrismaJsonInput(memoryUpdates),
        },
      }).then(() => undefined);
    };
    const recordTraceEvent = (event: AgentTraceEventInput) => {
      const target = ensureLoopIteration(loopIterations, event.iteration);
      const events = Array.isArray(target.events)
        ? target.events as Array<Record<string, unknown>>
        : [];
      events.push({
        id: `${input.reviewBotRunId}-${++eventSequence}`,
        at: new Date().toISOString(),
        ...event,
      });
      target.events = events;
      const nodeKey = workflowStageNodeKey(input.reviewBotRunId, event.iteration, event.stage);
      const parentNodeKey = event.parentNodeKey || workflowStageParentKey(input.reviewBotRunId, event.iteration, event.stage);
      const nodeInput = {
        reviewLogId: input.reviewLogId,
        reviewBotRunId: input.reviewBotRunId,
        nodeKey,
        parentNodeKey,
        kind: "iteration_stage" as const,
        title: event.title,
        summary: `${input.botName || "Agent"} · 第 ${event.iteration} 轮`,
        detail: event.detail || null,
        sequence: workflowStageSequence(event.iteration, event.stage),
        metrics: event.metrics,
        raw: event,
      };

      const workflowPromise = event.status === "running"
        ? reviewWorkflowRecorder.startNode(nodeInput)
        : reviewWorkflowRecorder.completeNode({
          ...nodeInput,
          status: completedWorkflowStatus(event.status),
          completedAt: new Date(),
          durationMs: event.durationMs,
        });

      return Promise.all([
        persistTraceProgress(),
        workflowPromise,
      ]).then(() => undefined);
    };

    try {
      await recordTraceEvent({
        iteration,
        stage: "initializing",
        status: "completed",
        title: "Agent Loop 初始化",
        detail: `${input.botName || "Agent"} 使用 ${modelName(input.modelConfig)} 开始审查`,
        metrics: {
          changedFiles: input.changedFiles.length,
          maxIterations: budget.maxIterations,
          maxContextFiles: budget.maxContextFiles,
          maxFindings: budget.maxFindings,
        },
      });

      while (true) {
        const remainingIterations = budget.maxIterations - iteration;
        const contextStartedAt = Date.now();
        await recordTraceEvent({
          iteration,
          stage: "context",
          status: "running",
          title: "获取代码上下文",
          detail: `准备检索 ${requestedFiles.length || input.changedFiles.length} 个文件的上下文`,
          metrics: {
            requestedFiles: requestedFiles.length,
            maxDepth: budget.maxCallGraphDepth,
          },
        });
        const context = await contextRetrieverService.getContext({
          repositoryId: input.repositoryId,
          branch: input.branch,
          commitSha: input.commitSha,
          changedFiles: requestedFiles.length ? requestedFiles : input.changedFiles,
          maxFiles: budget.maxContextFiles,
          maxDepth: budget.maxCallGraphDepth,
        });
        latestContext = context;
        const toolCalls = summarizeToolCalls(context, requestedFiles, budget.maxCallGraphDepth);
        await recordTraceEvent({
          iteration,
          stage: "context",
          status: "completed",
          title: "上下文获取完成",
          detail: context.summary || "已完成上下文检索",
          durationMs: Date.now() - contextStartedAt,
          metrics: {
            selectedFiles: context.metrics.selectedFilesCount,
            fileContexts: context.metrics.fileContextCount,
            graphNeighbors: context.metrics.graphNeighborCount,
            relatedReviews: context.metrics.relatedReviewCount,
          },
        });

        const planPrompt = buildReviewAgentPlanPrompt({
          title: input.title,
          description: input.description,
          changedFiles: input.changedFiles,
          architectureSummary: context.architectureSummary,
          toolCatalog: context.tools,
          codeGraph: context.codeGraph,
          contextSummary: context.summary,
          existingFindingsCount: findings.length,
          remainingIterations,
          botName: input.botName,
          botPrompt: input.botPrompt,
          botPromptMode: input.botPromptMode,
          availableAdditionalAgents: input.availableAdditionalAgents || [],
        });

        const planStartedAt = Date.now();
        await recordTraceEvent({
          iteration,
          stage: "plan",
          status: "running",
          title: "生成审查计划",
          detail: "正在请求模型判断风险、焦点文件和工具需求",
          metrics: {
            existingFindings: findings.length,
            remainingIterations,
          },
        });
        const planResponse = await aiService.reviewCode(
          planPrompt,
          input.modelConfig,
          REVIEW_AGENT_PLAN_SYSTEM_PROMPT,
          { responseFormat: "jsonObject" },
        );
        finalPlan = safePlan(aiService.parseJsonObject<AgentPlan>(planResponse));
        await recordTraceEvent({
          iteration,
          stage: "plan",
          status: "completed",
          title: "审查计划完成",
          detail: finalPlan.reviewStrategy || finalPlan.changeType || "已生成审查计划",
          durationMs: Date.now() - planStartedAt,
          metrics: {
            riskLevel: finalPlan.riskLevel,
            focusAreas: finalPlan.focusAreas?.length || 0,
            contextFiles: finalPlan.contextFiles?.length || 0,
            requestedTools: finalPlan.requestedTools || [],
          },
        });

        let additionalAgentObservation = "";

        let contextSummary = [
          context.summary,
          additionalAgentObservation ? `辅助 Agent 工具结果：${additionalAgentObservation}` : "",
        ].filter(Boolean).join("\n");
        const reviewPrompt = buildReviewAgentReviewPrompt({
          title: input.title,
          description: input.description,
          changedFiles: input.changedFiles,
          diffs: input.diffs,
          plan: finalPlan as Record<string, unknown>,
          contextSummary,
          existingFindings: findings,
          botName: input.botName,
          botPrompt: input.botPrompt,
          botPromptMode: input.botPromptMode,
        });

        const reviewStartedAt = Date.now();
        await recordTraceEvent({
          iteration,
          stage: "review",
          status: "running",
          title: "生成审查结果",
          detail: "正在请求模型输出可定位 Finding",
          metrics: {
            currentFindings: findings.length,
            remainingFindingBudget: Math.max(budget.maxFindings - findings.length, 0),
          },
        });
        const reviewResponse = await aiService.reviewCode(
          reviewPrompt,
          input.modelConfig,
          REVIEW_AGENT_REVIEW_SYSTEM_PROMPT,
          { responseFormat: "jsonObject" },
        );
        await recordTraceEvent({
          iteration,
          stage: "review",
          status: "completed",
          title: "模型审查完成",
          detail: "已收到模型审查结果，准备解析和校验",
          durationMs: Date.now() - reviewStartedAt,
        });

        const validationStartedAt = Date.now();
        await recordTraceEvent({
          iteration,
          stage: "validation",
          status: "running",
          title: "校验 Finding",
          detail: "正在过滤非 Diff 文件、无效行号和低置信结果",
        });
        const parsedReview = aiService.parseStructuredReview(reviewResponse, {
          maxItems: Math.max(budget.maxFindings - findings.length, 0),
        });
        const validationReport = validateReviewFindingsWithReport(parsedReview.commentItems, input.diffs.map(toValidationDiff));
        const previousCount = findings.length;
        findings = dedupeFindings([
          ...findings,
          ...validationReport.accepted,
        ], budget.maxFindings);
        const newFindings = findings.length - previousCount;
        await recordTraceEvent({
          iteration,
          stage: "validation",
          status: "completed",
          title: "Finding 校验完成",
          detail: `接受 ${validationReport.accepted.length} 条，丢弃 ${validationReport.rejected.length} 条`,
          durationMs: Date.now() - validationStartedAt,
          metrics: {
            rawFindings: parsedReview.commentItems.length,
            acceptedFindings: validationReport.accepted.length,
            rejectedFindings: validationReport.rejected.length,
            newFindings,
            totalFindings: findings.length,
          },
        });

        const availableAdditionalAgents = input.availableAdditionalAgents || [];
        const remainingAdditionalAgents = selectRemainingAdditionalAgents(
          availableAdditionalAgents,
          executedAdditionalAgentIds,
        );
        const thresholdTrigger = getAdditionalAgentTrigger(findings);
        const shouldRunAdditionalAgentsByFindings = Boolean(
          thresholdTrigger.enabled &&
          remainingAdditionalAgents.length > 0
        );
        const decisionNodeKey = `agent:${input.reviewBotRunId}:iteration:${iteration}:decision:additional_agents`;
        let criticParentNodeKey = workflowStageNodeKey(input.reviewBotRunId, iteration, "validation");

        if (availableAdditionalAgents.length > 0) {
          await reviewWorkflowRecorder.upsertNode({
            reviewLogId: input.reviewLogId,
            reviewBotRunId: input.reviewBotRunId,
            nodeKey: decisionNodeKey,
            parentNodeKey: workflowStageNodeKey(input.reviewBotRunId, iteration, "validation"),
            kind: "decision",
            status: shouldRunAdditionalAgentsByFindings ? "running" : "skipped",
            title: "是否调用辅助 Agent",
            summary: shouldRunAdditionalAgentsByFindings ? "主 Agent 触发辅助复核" : thresholdTrigger.reason,
            detail: shouldRunAdditionalAgentsByFindings
              ? buildFindingsThresholdTask(findings)
              : "主 Agent 未发现需要辅助复核的问题，直接输出自身审查结果。",
            sequence: workflowStageSequence(iteration, "validation") + 1,
            metrics: {
              trigger: thresholdTrigger,
              availableAgents: availableAdditionalAgents.length,
              remainingAgents: remainingAdditionalAgents.length,
            },
            raw: {
              trigger: thresholdTrigger,
              findings: findings.map((finding) => ({
                filePath: finding.filePath,
                lineNumber: finding.lineNumber,
                severity: finding.severity,
                confidence: finding.confidence,
              })),
            },
          });
          criticParentNodeKey = decisionNodeKey;
        }

        if (shouldRunAdditionalAgentsByFindings) {
          const thresholdAgents = remainingAdditionalAgents;
          thresholdAgents.forEach((agent) => executedAdditionalAgentIds.add(agent.id));
          const thresholdTask = buildFindingsThresholdTask(findings);
          const toolStartedAt = Date.now();
          await recordTraceEvent({
            iteration,
            stage: "tool",
            status: "running",
            title: "问题阈值触发辅助 Agent",
            detail: thresholdTrigger.reason,
            parentNodeKey: decisionNodeKey,
            metrics: {
              agents: thresholdAgents.map((agent) => agent.name),
              currentFindings: findings.length,
            },
          });
          const additionalAgentResults = await this.runAdditionalReviewAgents(
            input,
            thresholdAgents,
            findings,
            thresholdTask,
            workflowStageNodeKey(input.reviewBotRunId, iteration, "tool"),
            workflowStageSequence(iteration, "tool") + 1,
          );
          const additionalFindings = additionalAgentResults.flatMap((result) => result.findings);
          findings = dedupeFindings([...findings, ...additionalFindings], budget.maxFindings);
          additionalAgentObservation = summarizeAdditionalAgentResults(additionalAgentResults);
          contextSummary = [
            context.summary,
            `辅助 Agent 工具结果：${additionalAgentObservation}`,
          ].filter(Boolean).join("\n");
          toolCalls.push({
            tool: "run_additional_review_agents",
            status: thresholdAgents.length > 0 ? "available" : "unavailable",
            args: {
              trigger: "findings_threshold",
              threshold: {
                critical: ADDITIONAL_AGENT_CRITICAL_FINDINGS_THRESHOLD,
                actionable: ADDITIONAL_AGENT_ACTIONABLE_FINDINGS_THRESHOLD,
              },
              reason: thresholdTrigger.reason,
              agents: thresholdAgents.map((agent) => agent.name),
              task: thresholdTask,
            },
            resultCount: additionalFindings.length,
            observation: additionalAgentObservation,
          });
          await recordTraceEvent({
            iteration,
            stage: "tool",
            status: "completed",
            title: "问题阈值辅助 Agent 完成",
            detail: additionalAgentObservation,
            durationMs: Date.now() - toolStartedAt,
            parentNodeKey: decisionNodeKey,
            metrics: {
              agents: thresholdAgents.length,
              findings: additionalFindings.length,
              totalFindings: findings.length,
            },
          });
          await reviewWorkflowRecorder.completeNode({
            reviewLogId: input.reviewLogId,
            reviewBotRunId: input.reviewBotRunId,
            nodeKey: decisionNodeKey,
            kind: "decision",
            status: "success",
            title: "辅助 Agent 已调用",
            summary: `调用 ${thresholdAgents.length} 个辅助 Agent`,
            detail: additionalAgentObservation,
            sequence: workflowStageSequence(iteration, "validation") + 1,
            metrics: {
              trigger: thresholdTrigger,
              agents: thresholdAgents.map((agent) => agent.name),
              findings: additionalFindings.length,
              totalFindings: findings.length,
            },
          });
          criticParentNodeKey = workflowStageNodeKey(input.reviewBotRunId, iteration, "tool");
        }

        const criticPrompt = buildReviewAgentCriticPrompt({
          findings: findings.map((item) => ({
            filePath: item.filePath,
            lineNumber: item.lineNumber,
            severity: item.severity,
            content: item.content,
            confidence: item.confidence,
          })),
          contextSummary,
          remainingIterations,
        });

        const criticStartedAt = Date.now();
        await recordTraceEvent({
          iteration,
          stage: "critic",
          status: "running",
          title: "Critic 判断是否继续",
          detail: "正在评估是否需要更多上下文或下一轮审查",
          parentNodeKey: criticParentNodeKey,
          metrics: {
            findings: findings.length,
            remainingIterations,
          },
        });
        const criticResponse = await aiService.reviewCode(
          criticPrompt,
          input.modelConfig,
          REVIEW_AGENT_CRITIC_SYSTEM_PROMPT,
          { responseFormat: "jsonObject" },
        );
        latestCritic = safeCritic(aiService.parseJsonObject<AgentCriticResult>(criticResponse));

        const hasBudget = iteration < budget.maxIterations;
        const hasFindingBudget = findings.length < budget.maxFindings;
        const requestedTools = finalPlan.requestedTools || [];
        const nextFiles = finalPlan.contextFiles?.filter((file) => !requestedFiles.includes(file)) || [];
        const progressSignature = buildProgressSignature({
          requestedFiles,
          requestedTools,
          contextFiles: finalPlan.contextFiles || [],
          findings,
        });
        const repeatedProgressCount = (progressSignatures.get(progressSignature) || 0) + 1;
        progressSignatures.set(progressSignature, repeatedProgressCount);
        const stopReason = resolveStopReason({
          hasBudget,
          hasFindingBudget,
          critic: latestCritic,
          newFindings,
          needsMoreContext: finalPlan.needsMoreContext,
          requestedTools,
          nextFiles,
          repeatedProgressCount,
        });
        const shouldContinue = Boolean(
          stopReason === "continue"
        );
        await recordTraceEvent({
          iteration,
          stage: "critic",
          status: "completed",
          title: shouldContinue ? "Critic 要求继续" : "Critic 判定停止",
          detail: latestCritic.reason || stopReason,
          durationMs: Date.now() - criticStartedAt,
          parentNodeKey: criticParentNodeKey,
          metrics: {
            stopReason,
            repeatedProgressCount,
            shouldContinue,
          },
        });

        mergeLoopIterationSnapshot(loopIterations, iteration, {
          iteration,
          budget,
          requestedFiles,
          toolCalls,
          plan: finalPlan,
          review: {
            rawFindings: parsedReview.commentItems.length,
            acceptedFindings: validationReport.accepted.length,
            rejectedFindings: validationReport.rejected.length,
            rejectionCounts: validationReport.counts,
            newFindings,
            totalFindings: findings.length,
            response: reviewResponse,
          },
          contextMetrics: context.metrics,
          progress: {
            signature: progressSignature,
            repeatedCount: repeatedProgressCount,
            stopReason,
          },
          critic: latestCritic,
          contextSummary,
        });
        await persistTraceProgress();

        if (!shouldContinue) break;
        requestedFiles = [...new Set([...requestedFiles, ...nextFiles])];
        iteration += 1;
      }
    } catch (error) {
      await recordTraceEvent({
        iteration,
        stage: "error",
        status: "failed",
        title: "Agent Loop 异常中断",
        detail: error instanceof Error ? error.message : "Unknown agent loop error",
      });
      throw error;
    }

    const memoryUpdates = (latestCritic.memoryFacts || [])
      .filter((fact) => fact.confidence >= MEMORY_WRITE_CONFIDENCE)
      .slice(0, 10);
    const agentFindings = findings.filter((finding) => {
      return !input.existingFindings.some((existing) => (
        existing.filePath === finding.filePath &&
        existing.lineNumber === finding.lineNumber &&
        (existing.lineRangeEnd || null) === (finding.lineRangeEnd || null) &&
        existing.severity === finding.severity &&
        existing.content === finding.content
      ));
    });
    await recordTraceEvent({
      iteration,
      stage: "finish",
      status: "completed",
      title: "Agent Loop 完成",
      detail: `最终新增 ${agentFindings.length} 条 Finding，记忆更新 ${memoryUpdates.length} 条`,
      metrics: {
        findings: agentFindings.length,
        memoryUpdates: memoryUpdates.length,
      },
    });

    return prisma.$transaction((tx) => {
      return tx.reviewAgentTrace.upsert({
        where: { reviewBotRunId: input.reviewBotRunId },
        update: {
          reviewLogId: input.reviewLogId,
          reviewBotRunId: input.reviewBotRunId,
          memorySnapshotId: input.memorySnapshotId || null,
          loopIterationsJson: toPrismaJsonInput(loopIterations),
          retrievedContextJson: toPrismaJsonInput(latestContext || {}),
          finalPlanJson: toPrismaJsonInput(finalPlan),
          criticJson: toPrismaJsonInput(latestCritic),
          memoryUpdatesJson: toPrismaJsonInput(memoryUpdates),
        },
        create: {
          reviewLogId: input.reviewLogId,
          reviewBotRunId: input.reviewBotRunId,
          memorySnapshotId: input.memorySnapshotId || null,
          loopIterationsJson: toPrismaJsonInput(loopIterations),
          retrievedContextJson: toPrismaJsonInput(latestContext || {}),
          finalPlanJson: toPrismaJsonInput(finalPlan),
          criticJson: toPrismaJsonInput(latestCritic),
          memoryUpdatesJson: toPrismaJsonInput(memoryUpdates),
        },
      }).then((trace) => {
        if (memoryUpdates.length === 0) return trace;
        return tx.repositoryMemoryFact.createMany({
          data: memoryUpdates.map((fact) => ({
            repositoryId: input.repositoryId,
            branch: input.branch,
            type: fact.type,
            content: fact.content,
            source: `review_agent:${input.reviewLogId}`,
            confidence: fact.confidence,
            evidence: fact.evidence,
            lastVerifiedCommit: input.commitSha,
          })),
          skipDuplicates: true,
        }).then(() => trace);
      });
    }).then((trace) => ({
      traceId: trace.id,
      finalPlan,
      context: latestContext!,
      critic: latestCritic,
      agentFindings,
      memoryUpdates,
    }));
  }

  private runAdditionalReviewAgents(
    input: AgentLoopInput,
    agents: AdditionalReviewAgent[],
    existingFindings: Array<ReviewComment & { confidence: number }>,
    task: string,
    parentNodeKey?: string,
    sequenceBase = 560,
  ): Promise<AdditionalAgentToolResult[]> {
    if (agents.length === 0) return Promise.resolve([]);

    return Promise.all(agents.map((agent) => {
      const agentBudget = normalizeAgentLoopBudget(agent.budget);
      const botModel = modelName(agent.modelConfig);

      return prisma.reviewBotRun.upsert({
        where: {
          reviewLogId_reviewBotId: {
            reviewLogId: input.reviewLogId,
            reviewBotId: agent.id,
          },
        },
        update: {
          status: "running",
          error: null,
          summary: null,
          aiModelProvider: agent.modelConfig.provider,
          aiModelId: agent.modelConfig.modelId,
          aiModelName: botModel,
          promptSnapshot: agent.prompt || null,
          promptMode: agent.promptMode || "extend",
          startedAt: new Date(),
          completedAt: null,
        },
        create: {
          reviewLogId: input.reviewLogId,
          reviewBotId: agent.id,
          status: "running",
          aiModelProvider: agent.modelConfig.provider,
          aiModelId: agent.modelConfig.modelId,
          aiModelName: botModel,
          promptSnapshot: agent.prompt || null,
          promptMode: agent.promptMode || "extend",
        },
      }).then((botRun) => {
        const agentNodeKey = `agent:${botRun.id}`;
        return reviewWorkflowRecorder.startNode({
          reviewLogId: input.reviewLogId,
          reviewBotRunId: botRun.id,
          nodeKey: agentNodeKey,
          parentNodeKey: parentNodeKey || `agent:${input.reviewBotRunId}`,
          kind: "agent",
          title: `辅助 Agent：${agent.name}`,
          summary: botModel,
          detail: task,
          sequence: sequenceBase,
          metrics: {
            delegatedBy: input.reviewBotRunId,
            maxIterations: agentBudget.maxIterations,
            maxFindings: agentBudget.maxFindings,
          },
        }).then(() => this.run({
          ...input,
          reviewBotRunId: botRun.id,
          modelConfig: agent.modelConfig,
          budget: agentBudget,
          botName: agent.name,
          botPrompt: buildAdditionalAgentPrompt(agent, task),
          botPromptMode: agent.promptMode,
          existingFindings,
          availableAdditionalAgents: [],
        })).then((result) => {
          const findings = result.agentFindings.map((item) => ({
            ...item,
            reviewBotRunId: botRun.id,
            sourceBotName: agent.name,
            sourceBotModel: botModel,
            sourceBots: [sourceFor(botRun.id, agent.name, botModel, item.confidence)],
          }));

          return prisma.reviewBotRun.update({
            where: { id: botRun.id },
            data: {
              status: "completed",
              summary: [
                result.critic.reason || result.finalPlan.reviewStrategy || "completed",
                `findings=${findings.length}`,
              ].join("; "),
              completedAt: new Date(),
            },
          }).then(() => reviewWorkflowRecorder.completeNode({
            reviewLogId: input.reviewLogId,
            reviewBotRunId: botRun.id,
            nodeKey: agentNodeKey,
            kind: "agent",
            title: `辅助 Agent：${agent.name}`,
            summary: `新增 ${findings.length} 条问题`,
            detail: result.critic.reason || result.finalPlan.reviewStrategy || "辅助 Agent 完成",
            sequence: sequenceBase,
            metrics: {
              findings: findings.length,
              delegatedBy: input.reviewBotRunId,
            },
          })).then(() => ({
            agentId: agent.id,
            agentName: agent.name,
            status: "completed" as const,
            summary: result.critic.reason || result.finalPlan.reviewStrategy || "辅助 Agent 完成",
            findings,
          }));
        }).catch((error) => {
          return prisma.reviewBotRun.update({
            where: { id: botRun.id },
            data: {
              status: "failed",
              error: error instanceof Error ? error.message : "辅助 Agent 执行失败",
              completedAt: new Date(),
            },
          }).then(() => reviewWorkflowRecorder.failNode({
            reviewLogId: input.reviewLogId,
            reviewBotRunId: botRun.id,
            nodeKey: agentNodeKey,
            kind: "agent",
            title: `辅助 Agent：${agent.name}`,
            summary: "辅助 Agent 执行失败",
            detail: error instanceof Error ? error.message : "辅助 Agent 执行失败",
            sequence: sequenceBase,
          })).then(() => ({
            agentId: agent.id,
            agentName: agent.name,
            status: "failed" as const,
            summary: error instanceof Error ? error.message : "辅助 Agent 执行失败",
            findings: [],
          }));
        });
      }).catch((error) => ({
        agentId: agent.id,
        agentName: agent.name,
        status: "failed" as const,
        summary: error instanceof Error ? error.message : "辅助 Agent 执行失败",
        findings: [],
      }));
    }));
  }
}

export const reviewAgentLoopService = new ReviewAgentLoopService();
