import { HTTPException } from "hono/http-exception";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { dingtalkRobotInput } from "@server/modules/settings/config-input";

import type { Prisma } from "@prisma/client";

const robotInclude = { _count: { select: { repositories: true, rssSubscriptions: true, securityTargets: true, contacts: true, messages: true } } } satisfies Prisma.DingtalkRobotInclude;

export function dingtalkConnectionConfigured(robot: { transport: string; webhookUrl: string | null;
  cliProfile: string | null; cliRobotCode: string | null; cliGroupId: string | null }) {
  return robot.transport === 'webhook' ? Boolean(robot.webhookUrl) : robot.transport === 'cli'
    && Boolean(robot.cliProfile && robot.cliRobotCode && robot.cliGroupId);
}

function maskRobot(robot: Prisma.DingtalkRobotGetPayload<{ include: typeof robotInclude }>) {
  const { webhookUrl, secret, _count, ...rest } = robot;
  return { ...rest, hasWebhookUrl: Boolean(webhookUrl), hasSecret: Boolean(secret), isConfigured: dingtalkConnectionConfigured(robot),
    repositoryCount: _count.repositories, rssSubscriptionCount: _count.rssSubscriptions,
    securityTargetCount: _count.securityTargets };
}

export function listDingtalkRobots() {
  return prisma.dingtalkRobot.findMany({ orderBy: { createdAt: "asc" }, include: robotInclude })
    .then((robots) => robots.map(maskRobot));
}

export function createDingtalkRobot(body: unknown) {
  const input = dingtalkRobotInput.parse(body);
  if (input.transport === "webhook" && !input.webhookUrl) throw new HTTPException(400, { message: "请填写钉钉机器人 Webhook" });
  if (input.transport === "cli" && (!input.cliProfile || !input.cliRobotCode || !input.cliGroupId)) {
    throw new HTTPException(400, { message: "钉钉 CLI 连接需要 Profile、Robot Code 和群 ID" });
  }
  return prisma.dingtalkRobot.create({ data: { ...input, webhookUrl: input.webhookUrl ?? null }, include: robotInclude }).then(maskRobot);
}

export function updateDingtalkRobot(id: string, body: unknown) {
  const input = dingtalkRobotInput.partial().parse(body);
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  return prisma.$transaction((tx) => tx.dingtalkRobot.findUniqueOrThrow({ where: { id }, include: robotInclude }).then((current) => {
    if (input.transport && input.transport !== current.transport) throw new HTTPException(409, { message: "请新建其他类型的连接，不要改变已有连接身份" });
    if (input.cliProfile && input.cliProfile !== current.cliProfile && (current._count.contacts || current._count.messages)) {
      throw new HTTPException(409, { message: "已有名单或发送记录的连接不能更换 Profile，请创建新连接" });
    }
    if (!dingtalkConnectionConfigured({ ...current, ...data })) throw new HTTPException(400, { message: "钉钉连接配置不完整" });
    return tx.dingtalkRobot.update({ where: { id }, data, include: robotInclude });
  }), { isolationLevel: 'Serializable' }).then(maskRobot);
}

export function deleteDingtalkRobot(id: string) {
  return prisma.$transaction((transaction) => transaction.dingtalkRobot.findUniqueOrThrow({
    where: { id }, include: robotInclude,
  }).then((robot) => {
    if (robot._count.repositories || robot._count.rssSubscriptions || robot._count.securityTargets || robot._count.contacts || robot._count.messages) {
      throw new HTTPException(409, { message: "机器人仍被仓库、RSS 订阅或安全测试目标使用" });
    }
    return transaction.dingtalkRobot.delete({ where: { id } });
  })).then(() => ({ success: true }));
}
