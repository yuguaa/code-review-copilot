import { HTTPException } from "hono/http-exception";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { dingtalkRobotInput } from "@server/modules/settings/config-input";

import type { Prisma } from "@prisma/client";

const robotInclude = { _count: { select: { repositories: true, rssSubscriptions: true } } } satisfies Prisma.DingtalkRobotInclude;

function maskRobot(robot: Prisma.DingtalkRobotGetPayload<{ include: typeof robotInclude }>) {
  const { webhookUrl, secret, _count, ...rest } = robot;
  return { ...rest, hasWebhookUrl: Boolean(webhookUrl), hasSecret: Boolean(secret),
    repositoryCount: _count.repositories, rssSubscriptionCount: _count.rssSubscriptions };
}

export function listDingtalkRobots() {
  return prisma.dingtalkRobot.findMany({ orderBy: { createdAt: "asc" }, include: robotInclude })
    .then((robots) => robots.map(maskRobot));
}

export function createDingtalkRobot(body: unknown) {
  const input = dingtalkRobotInput.parse(body);
  if (!input.webhookUrl) throw new HTTPException(400, { message: "请填写钉钉机器人 Webhook" });
  return prisma.dingtalkRobot.create({ data: { ...input, webhookUrl: input.webhookUrl }, include: robotInclude }).then(maskRobot);
}

export function updateDingtalkRobot(id: string, body: unknown) {
  const input = dingtalkRobotInput.partial().parse(body);
  return prisma.dingtalkRobot.update({ where: { id }, data: input, include: robotInclude }).then(maskRobot);
}

export function deleteDingtalkRobot(id: string) {
  return prisma.$transaction((transaction) => transaction.dingtalkRobot.findUniqueOrThrow({
    where: { id }, include: robotInclude,
  }).then((robot) => {
    if (robot._count.repositories || robot._count.rssSubscriptions) {
      throw new HTTPException(409, { message: "机器人仍被仓库或 RSS 订阅使用" });
    }
    return transaction.dingtalkRobot.delete({ where: { id } });
  })).then(() => ({ success: true }));
}
