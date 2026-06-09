import type { Prisma } from "@prisma/client";
import type { AIModelConfig, GitLabDiff, ReviewComment } from "@/lib/types";

type ReviewAIModel = {
  id: string;
  provider: string;
  modelId: string;
  apiKey: string;
  apiEndpoint: string | null;
  maxTokens: number | null;
  temperature: number | null;
  isActive: boolean;
};

export function generatePatch(diff: GitLabDiff): string {
  return `--- a/${diff.old_path}
+++ b/${diff.new_path}
${diff.diff}`;
}

export function buildFindingKey(finding: Pick<ReviewComment, "filePath" | "lineNumber" | "lineRangeEnd" | "severity" | "content">): string {
  return [
    finding.filePath,
    finding.lineNumber,
    finding.lineRangeEnd || "",
    finding.severity,
    finding.content.replace(/\s+/g, " ").trim(),
  ].join("|");
}

export function toModelConfig(model: ReviewAIModel): AIModelConfig {
  return {
    id: model.id,
    name: model.modelId,
    provider: model.provider as AIModelConfig["provider"],
    modelId: model.modelId,
    apiKey: model.apiKey,
    apiEndpoint: model.apiEndpoint || undefined,
    maxTokens: model.maxTokens || undefined,
    temperature: model.temperature || undefined,
    isActive: model.isActive,
  };
}

export function toPrismaJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
