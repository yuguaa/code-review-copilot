import { HTTPException } from "hono/http-exception";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { sendDingtalk as sendDingtalkNotification } from "@server/shared/dingtalk/dingtalk.service";
import { dingtalkConnectionConfigured } from "@server/modules/settings/dingtalk-robot-settings.service";

import type { Prisma } from "@prisma/client";
import type { DingtalkConfig } from "@server/shared/dingtalk/dingtalk.service";

export type DingtalkRepositoryConfig = {
  enableDingtalk: boolean;
  dingtalkRobotId: string | null;
};

export { sendDingtalk as sendDingtalkNotification } from "@server/shared/dingtalk/dingtalk.service";

export function validateDingtalkTarget(client: Pick<Prisma.TransactionClient, "dingtalkRobot">, id: string | null | undefined, required: boolean): Promise<void> {
  if (!id) return required ? Promise.reject(new HTTPException(400, { message: "请选择钉钉机器人" })) : Promise.resolve();
  return client.dingtalkRobot.findUnique({ where: { id } }).then((robot) => {
    if (!robot) throw new HTTPException(400, { message: "所选钉钉机器人不存在" });
    if (robot.transport === 'cli') throw new HTTPException(400, { message: '共享 CLI 自动通知所有仓库，不需也不能关联单个仓库、订阅或安全目标' });
    if (required && !robot.enabled) throw new HTTPException(400, { message: "所选钉钉机器人已停用" });
    if (required && !dingtalkConnectionConfigured(robot)) throw new HTTPException(400, { message: "所选钉钉连接配置不完整" });
  });
}

export function loadRepositoryDingtalkConfig(repo: DingtalkRepositoryConfig): Promise<DingtalkConfig | null> {
  if (!repo.enableDingtalk) return Promise.resolve(null);
  if (!repo.dingtalkRobotId) return Promise.reject(new Error("仓库尚未选择钉钉机器人"));
  return loadDingtalkConfig(repo.dingtalkRobotId);
}

export function loadDingtalkConfig(id: string): Promise<DingtalkConfig> {
  return prisma.dingtalkRobot.findUnique({ where: { id } }).then((robot) => {
    if (!robot) throw new Error("所选钉钉机器人不存在");
    if (!robot.enabled) throw new Error("所选钉钉机器人已停用");
    if (!dingtalkConnectionConfigured(robot)) throw new Error("所选钉钉连接配置不完整");
    if (robot.transport === 'cli') throw new Error('共享 CLI 由 Pi 通知链路使用，不作为仓库 Webhook 机器人配置');
    return { webhook: robot.webhookUrl!, secret: robot.secret };
  });
}

export function sendRepositoryDingtalkNotification(
  repo: DingtalkRepositoryConfig,
  title: string,
  text: string,
): Promise<"sent" | "skipped"> {
  return loadRepositoryDingtalkConfig(repo).then((config) => config
    ? sendDingtalkNotification(config, title, text).then(() => "sent" as const)
    : "skipped" as const);
}
