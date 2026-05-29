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
}

interface AgentPlan {
  changeType?: string;
  riskLevel?: "low" | "medium" | "high";
  focusAreas?: string[];
  contextFiles?: string[];
  reviewStrategy?: string;
  needsMoreContext?: boolean;
  requestedTools?: string[];
  shouldUseAdditionalAgents?: boolean;
  additionalAgentReason?: string;
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
    shouldUseAdditionalAgents: Boolean(data.shouldUseAdditionalAgents),
    additionalAgentReason: typeof data.additionalAgentReason === "string" ? data.additionalAgentReason : "",
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
    search_memory_facts: context.memoryFacts.length,
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
        memoryFacts: context.memoryFacts.map((fact) => fact.content),
        toolCatalog: context.tools,
        codeGraph: context.codeGraph,
        contextSummary: context.summary,
        existingFindingsCount: findings.length,
        remainingIterations,
        botName: input.botName,
        botPrompt: input.botPrompt,
        botPromptMode: input.botPromptMode,
      });

      const planResponse = await aiService.reviewCode(planPrompt, input.modelConfig, REVIEW_AGENT_PLAN_SYSTEM_PROMPT);
      finalPlan = safePlan(aiService.parseJsonObject<AgentPlan>(planResponse));
      const reviewPrompt = buildReviewAgentReviewPrompt({
        title: input.title,
        description: input.description,
        changedFiles: input.changedFiles,
        diffs: input.diffs,
        plan: finalPlan as Record<string, unknown>,
        contextSummary: context.summary,
        existingFindings: findings,
        maxFindings: budget.maxFindings - findings.length,
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
      const criticPrompt = buildReviewAgentCriticPrompt({
        findings: findings.map((item) => ({
          filePath: item.filePath,
          lineNumber: item.lineNumber,
          severity: item.severity,
          content: item.content,
          confidence: item.confidence,
        })),
        contextSummary: context.summary,
        remainingIterations,
        maxFindings: budget.maxFindings,
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
        contextSummary: context.summary,
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
}

export const reviewAgentLoopService = new ReviewAgentLoopService();
