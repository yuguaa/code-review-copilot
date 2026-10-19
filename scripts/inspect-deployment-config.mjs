import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const accounts = await prisma.gitLabAccount.findMany({ include: { repositories: true } });
  for (const account of accounts) {
    console.info(JSON.stringify({ accountId: account.id, origin: new URL(account.url).origin, hasWebhookSecret: Boolean(account.webhookSecret), repositoryCount: account.repositories.length }));
    const project = account.repositories.find((repository) => repository.isActive);
    if (!project) continue;
    const response = await fetch(`${account.url.replace(/\/$/, "")}/api/v4/projects/${project.gitLabProjectId}/hooks`, { headers: { "PRIVATE-TOKEN": account.accessToken }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { console.info(JSON.stringify({ projectId: project.gitLabProjectId, hookReadStatus: response.status })); continue; }
    const hooks = await response.json();
    console.info(JSON.stringify({ projectId: project.gitLabProjectId, hooks: hooks.map((hook) => ({ id: hook.id, origin: new URL(hook.url).origin, path: new URL(hook.url).pathname, push: hook.push_events, mergeRequests: hook.merge_requests_events })) }));
  }
} finally {
  await prisma.$disconnect();
}
