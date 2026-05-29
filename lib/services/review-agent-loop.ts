import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { aiService } from "@/lib/services/ai";
import { contextRetrieverService, type RetrievedAgentContext } from "@/lib/services/context-retriever";
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

const MEMORY_WRITE_CONFIDENCE = 0.85;
const ADDITIONAL_AGENT_FINDINGS_THRESHOLD = 3;

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
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
  requestedAgentNames?: string[];
  additionalAgentTask?: string;
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

interface AdditionalAgentToolResult {
  agentId: string;
  agentName: string;
  status: "completed" | "failed";
  summary: string;
  findings: Array<ReviewComment & { confidence: number }>;
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
    requestedAgentNames: Array.isArray(data.requestedAgentNames) ? data.requestedAgentNames.filter((item): item is string => typeof item === "string") : [],
    additionalAgentTask: typeof data.additionalAgentTask === "string" ? data.additionalAgentTask : "",
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
      const key = [
        item.filePath,
        item.lineNumber,
        item.lineRangeEnd || "",
        item.severity,
        item.content.replace(/\s+/g, " ").trim(),
      ].join("|");
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

function selectAdditionalAgents(
  plan: AgentPlan,
  agents: AdditionalReviewAgent[],
  executedAgentIds: Set<string>,
): AdditionalReviewAgent[] {
  if (!(plan.requestedTools || []).includes("run_additional_review_agents")) return [];

  const requestedNames = plan.requestedAgentNames || [];
  if (requestedNames.length === 0) {
    throw new Error("主 Agent 请求 run_additional_review_agents 时必须指定 requestedAgentNames");
  }
  if (!plan.additionalAgentTask?.trim()) {
    throw new Error("主 Agent 请求 run_additional_review_agents 时必须指定 additionalAgentTask");
  }

  const candidates = agents.filter((agent) => (
    requestedNames.includes(agent.id) || requestedNames.includes(agent.name)
  ));
  const selected = candidates.filter((agent) => !executedAgentIds.has(agent.id));
  const selectedKeys = new Set(selected.flatMap((agent) => [agent.id, agent.name]));
  const missingNames = requestedNames.filter((name) => !selectedKeys.has(name));

  if (missingNames.length > 0) {
    throw new Error(`主 Agent 请求了不可用或已执行的辅助 Agent：${missingNames.join("、")}`);
  }

  return selected;
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

function buildFindingsThresholdTask(findings: Array<ReviewComment & { confidence: number }>): string {
  const findingLines = findings.slice(0, 12).map((finding, index) => (
    `${index + 1}. [${finding.severity}] ${finding.filePath}:${finding.lineNumber} ${finding.content}`
  ));

  return [
    `主 Agent 已发现 ${findings.length} 条问题或建议，达到辅助 Agent 复核阈值 ${ADDITIONAL_AGENT_FINDINGS_THRESHOLD}。`,
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

    while (true) {
      const remainingIterations = budget.maxIterations - iteration;
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

      const planResponse = await aiService.reviewCode(planPrompt, input.modelConfig, REVIEW_AGENT_PLAN_SYSTEM_PROMPT);
      finalPlan = safePlan(aiService.parseJsonObject<AgentPlan>(planResponse));
      const additionalAgents = selectAdditionalAgents(
        finalPlan,
        input.availableAdditionalAgents || [],
        executedAdditionalAgentIds,
      );
      let additionalAgentObservation = "";

      if ((finalPlan.requestedTools || []).includes("run_additional_review_agents")) {
        additionalAgents.forEach((agent) => executedAdditionalAgentIds.add(agent.id));
        const additionalAgentResults = await this.runAdditionalReviewAgents(
          input,
          additionalAgents,
          findings,
          finalPlan.additionalAgentTask || "",
        );
        const additionalFindings = additionalAgentResults.flatMap((result) => result.findings);
        findings = dedupeFindings([...findings, ...additionalFindings], budget.maxFindings);
        additionalAgentObservation = summarizeAdditionalAgentResults(additionalAgentResults);
        toolCalls.push({
          tool: "run_additional_review_agents",
          status: additionalAgents.length > 0 ? "available" : "unavailable",
          args: {
            agents: additionalAgents.map((agent) => agent.name),
            task: finalPlan.additionalAgentTask || "",
          },
          resultCount: additionalFindings.length,
          observation: additionalAgentObservation,
        });
      }

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

      const reviewResponse = await aiService.reviewCode(reviewPrompt, input.modelConfig, REVIEW_AGENT_REVIEW_SYSTEM_PROMPT);
      const parsedReview = aiService.parseStructuredReview(reviewResponse, {
        maxItems: Math.max(budget.maxFindings - findings.length, 0),
      });
      const previousCount = findings.length;
      findings = dedupeFindings([
        ...findings,
        ...parsedReview.commentItems,
      ], budget.maxFindings);
      const newFindings = findings.length - previousCount;

      const shouldRunAdditionalAgentsByFindings = Boolean(
        findings.length >= ADDITIONAL_AGENT_FINDINGS_THRESHOLD &&
        (input.availableAdditionalAgents || []).length > 0 &&
        selectRemainingAdditionalAgents(input.availableAdditionalAgents || [], executedAdditionalAgentIds).length > 0
      );

      if (shouldRunAdditionalAgentsByFindings) {
        const thresholdAgents = selectRemainingAdditionalAgents(
          input.availableAdditionalAgents || [],
          executedAdditionalAgentIds,
        );
        thresholdAgents.forEach((agent) => executedAdditionalAgentIds.add(agent.id));
        const thresholdTask = buildFindingsThresholdTask(findings);
        const additionalAgentResults = await this.runAdditionalReviewAgents(
          input,
          thresholdAgents,
          findings,
          thresholdTask,
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
            threshold: ADDITIONAL_AGENT_FINDINGS_THRESHOLD,
            agents: thresholdAgents.map((agent) => agent.name),
            task: thresholdTask,
          },
          resultCount: additionalFindings.length,
          observation: additionalAgentObservation,
        });
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

      const criticResponse = await aiService.reviewCode(criticPrompt, input.modelConfig, REVIEW_AGENT_CRITIC_SYSTEM_PROMPT);
      latestCritic = safeCritic(aiService.parseJsonObject<AgentCriticResult>(criticResponse));
      loopIterations.push({
        iteration,
        budget,
        requestedFiles,
        toolCalls,
        plan: finalPlan,
        review: {
          newFindings,
          totalFindings: findings.length,
          response: reviewResponse,
        },
        critic: latestCritic,
        contextSummary,
      });

      const hasBudget = iteration < budget.maxIterations;
      const hasFindingBudget = findings.length < budget.maxFindings;
      const requestedTools = finalPlan.requestedTools || [];
      const nextFiles = finalPlan.contextFiles?.filter((file) => !requestedFiles.includes(file)) || [];
      const shouldContinue = Boolean(
        hasBudget &&
        hasFindingBudget &&
        latestCritic.shouldContinue &&
        newFindings > 0 &&
        finalPlan.needsMoreContext &&
        requestedTools.length > 0 &&
        nextFiles.length > 0
      );

      if (!shouldContinue) break;
      requestedFiles = [...new Set([...requestedFiles, ...nextFiles])];
      iteration += 1;
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

    return prisma.$transaction((tx) => {
      return tx.reviewAgentTrace.upsert({
        where: { reviewBotRunId: input.reviewBotRunId },
        update: {
          reviewLogId: input.reviewLogId,
          reviewBotRunId: input.reviewBotRunId,
          memorySnapshotId: input.memorySnapshotId || null,
          loopIterationsJson: toJsonInput(loopIterations),
          retrievedContextJson: toJsonInput(latestContext || {}),
          finalPlanJson: toJsonInput(finalPlan),
          criticJson: toJsonInput(latestCritic),
          memoryUpdatesJson: toJsonInput(memoryUpdates),
        },
        create: {
          reviewLogId: input.reviewLogId,
          reviewBotRunId: input.reviewBotRunId,
          memorySnapshotId: input.memorySnapshotId || null,
          loopIterationsJson: toJsonInput(loopIterations),
          retrievedContextJson: toJsonInput(latestContext || {}),
          finalPlanJson: toJsonInput(finalPlan),
          criticJson: toJsonInput(latestCritic),
          memoryUpdatesJson: toJsonInput(memoryUpdates),
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
        return this.run({
          ...input,
          reviewBotRunId: botRun.id,
          modelConfig: agent.modelConfig,
          budget: agentBudget,
          botName: agent.name,
          botPrompt: buildAdditionalAgentPrompt(agent, task),
          botPromptMode: agent.promptMode,
          existingFindings,
          availableAdditionalAgents: [],
        }).then((result) => {
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
          }).then(() => ({
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
          }).then(() => ({
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
