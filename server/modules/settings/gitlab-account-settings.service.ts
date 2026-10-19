import { Prisma } from "@prisma/client";
import { HTTPException } from "hono/http-exception";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { createGitLabService } from "@server/shared/gitlab/gitlab.service";
import { gitLabAccountInput } from "./config-input";

import type { GitLabAccount } from "@prisma/client";

function maskAccount(account: GitLabAccount) {
  const { accessToken, webhookSecret, ...rest } = account;
  return { ...rest, hasAccessToken: Boolean(accessToken), hasWebhookSecret: Boolean(webhookSecret) };
}

export function listGitLabAccounts() {
  return prisma.gitLabAccount.findMany({ orderBy: { createdAt: "desc" } })
    .then((accounts) => accounts.map(maskAccount));
}

export function createGitLabAccount(body: unknown) {
  const input = gitLabAccountInput.parse(body);
  if (!input.accessToken) throw new HTTPException(400, { message: "请填写 GitLab accessToken" });
  if (input.isActive && !input.webhookSecret) throw new HTTPException(400, { message: "启用 GitLab 账号必须配置 Webhook Secret" });
  return prisma.gitLabAccount.create({ data: { ...input, accessToken: input.accessToken } }).then(maskAccount);
}

export function updateGitLabAccount(id: string, body: unknown) {
  const data = gitLabAccountInput.partial().parse(body);
  return prisma.$transaction((tx) => tx.gitLabAccount.findUniqueOrThrow({ where: { id } }).then((current) => {
    const secret = data.webhookSecret === undefined ? current.webhookSecret : data.webhookSecret;
    if ((data.isActive ?? current.isActive) && !secret?.trim()) {
      throw new HTTPException(400, { message: "启用 GitLab 账号必须配置 Webhook Secret" });
    }
    return tx.gitLabAccount.update({ where: { id }, data });
  }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then(maskAccount);
}

export function deleteGitLabAccount(id: string) {
  return prisma.gitLabAccount.delete({ where: { id } }).then(() => ({ success: true }));
}

export function testGitLabAccount(id: string) {
  return prisma.gitLabAccount.findUnique({ where: { id } }).then((account) => {
    if (!account) return null;
    return createGitLabService(account.url, account.accessToken).testConnection();
  });
}

export function listGitLabProjects(id: string, search?: string) {
  return prisma.gitLabAccount.findUnique({ where: { id } }).then((account) => {
    if (!account) return null;
    return createGitLabService(account.url, account.accessToken).getProjects(search, { membership: true, per_page: 100 })
      .then((projects) => projects.map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path_with_namespace,
        defaultBranch: project.default_branch,
      })));
  });
}
