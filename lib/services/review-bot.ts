import { prisma } from "@/lib/prisma";
import { DEFAULT_AGENT_LOOP_BUDGET } from "@/lib/services/review-budget";

export const DEFAULT_REVIEW_BOT_NAME = "默认审查机器人";

export function ensureDefaultReviewBot(repositoryId: string) {
  return prisma.repositoryReviewBot.findFirst({
    where: {
      repositoryId,
      name: DEFAULT_REVIEW_BOT_NAME,
    },
    orderBy: { createdAt: "asc" },
  }).then((existingBot) => {
    if (existingBot) return existingBot;

    return prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        defaultAIModelId: true,
        customPrompt: true,
        customPromptMode: true,
      },
    }).then((repository) => {
      if (!repository) throw new Error("Repository not found");
      if (!repository.defaultAIModelId) {
        throw new Error("No AI model configured for default review bot");
      }

      return prisma.repositoryReviewBot.create({
        data: {
          repositoryId,
          aiModelId: repository.defaultAIModelId,
          name: DEFAULT_REVIEW_BOT_NAME,
          description: "由旧仓库级审查配置迁移生成，可按需编辑或禁用",
          prompt: repository.customPrompt || null,
          promptMode: repository.customPromptMode === "replace" ? "replace" : "extend",
          isActive: true,
          sortOrder: 0,
          ...DEFAULT_AGENT_LOOP_BUDGET,
        },
      });
    });
  });
}
