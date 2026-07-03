import { prisma } from '../../infrastructure/prisma/prisma.service';

export async function loadSettingsStats() {
  const [
    repositoryCount,
    activeRepositoryCount,
    modelCount,
    gitLabAccountCount,
    sessionCount,
    reviewSessionCount,
    chatSessionCount,
    messageCount,
    latestSession,
  ] = await prisma.$transaction([
    prisma.repository.count(),
    prisma.repository.count({ where: { isActive: true } }),
    prisma.aIModel.count({ where: { isActive: true } }),
    prisma.gitLabAccount.count({ where: { isActive: true } }),
    prisma.session.count(),
    prisma.session.count({ where: { kind: 'review' } }),
    prisma.session.count({ where: { kind: 'chat' } }),
    prisma.message.count(),
    prisma.session.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ]);
  return {
    repositoryCount,
    activeRepositoryCount,
    modelCount,
    gitLabAccountCount,
    sessionCount,
    reviewSessionCount,
    chatSessionCount,
    messageCount,
    latestSessionAt: latestSession?.updatedAt ?? null,
  };
}
