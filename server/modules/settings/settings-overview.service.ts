import { prisma } from "@server/infrastructure/prisma/prisma.service";

export function loadSettingsStats() {
  return prisma.$transaction([
    prisma.repository.count(),
    prisma.repository.count({ where: { isActive: true } }),
    prisma.aIModel.count({ where: { isActive: true } }),
    prisma.gitLabAccount.count({ where: { isActive: true } }),
    prisma.rssSubscription.count(),
  ]).then(([repositoryCount, activeRepositoryCount, modelCount, gitLabAccountCount, rssSubscriptionCount]) => ({
    repositoryCount, activeRepositoryCount, modelCount, gitLabAccountCount, rssSubscriptionCount,
  }));
}
