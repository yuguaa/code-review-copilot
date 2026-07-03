import { createGitLabService } from '../../shared/gitlab/gitlab.service';
import { prisma } from '../../infrastructure/prisma/prisma.service';
import type { GitLabAccountPayload } from './settings.types';

function maskAccount(account: { accessToken?: string; webhookSecret?: string | null; [key: string]: unknown }) {
  const { accessToken, webhookSecret, ...rest } = account;
  return { ...rest, hasAccessToken: Boolean(accessToken), hasWebhookSecret: Boolean(webhookSecret) };
}

export async function listGitLabAccounts() {
  const accounts = await prisma.gitLabAccount.findMany({ orderBy: { createdAt: 'desc' } });
  return accounts.map(maskAccount);
}

export async function createGitLabAccount(body: GitLabAccountPayload) {
  const account = await prisma.gitLabAccount.create({
    data: { url: body.url ?? '', accessToken: body.accessToken ?? '', webhookSecret: body.webhookSecret ?? null },
  });
  return maskAccount(account);
}

export async function updateGitLabAccount(id: string, body: GitLabAccountPayload) {
  const data: Record<string, unknown> = {};
  if (body.url !== undefined) data.url = body.url;
  if (body.webhookSecret !== undefined) data.webhookSecret = body.webhookSecret;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (typeof body.accessToken === 'string' && body.accessToken.length > 0) data.accessToken = body.accessToken;
  const account = await prisma.gitLabAccount.update({ where: { id }, data });
  return maskAccount(account);
}

export async function deleteGitLabAccount(id: string) {
  await prisma.gitLabAccount.delete({ where: { id } }).catch(() => undefined);
  return { success: true };
}

export async function testGitLabAccount(id: string) {
  const account = await prisma.gitLabAccount.findUnique({ where: { id } });
  if (!account) return null;
  const gitlab = createGitLabService(account.url, account.accessToken);
  return gitlab.testConnection().catch(() => false);
}

export async function listGitLabProjects(id: string, search?: string) {
  const account = await prisma.gitLabAccount.findUnique({ where: { id } });
  if (!account) return null;
  const gitlab = createGitLabService(account.url, account.accessToken);
  const projects = await gitlab.getProjects(search, { membership: true, per_page: 50 });
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path_with_namespace,
    defaultBranch: project.default_branch,
  }));
}
