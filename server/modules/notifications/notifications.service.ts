import axios from "axios";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { signedUrl } from "@server/shared/dingtalk/dingtalk.service";

import type { Prisma } from "@prisma/client";
import type { DingtalkConfig } from "@server/shared/dingtalk/dingtalk.service";

export type DingtalkRepositoryConfig = {
  enableDingtalk: boolean;
  dingtalkRobotId: string | null;
};

const dingtalkResponse = z.object({ errcode: z.number().int(), errmsg: z.string().optional() });

export function validateDingtalkTarget(client: Pick<Prisma.TransactionClient, "dingtalkRobot">, id: string | null | undefined, required: boolean): Promise<void> {
  if (!id) return required ? Promise.reject(new HTTPException(400, { message: "请选择钉钉机器人" })) : Promise.resolve();
  return client.dingtalkRobot.findUnique({ where: { id }, select: { enabled: true } }).then((robot) => {
    if (!robot) throw new HTTPException(400, { message: "所选钉钉机器人不存在" });
    if (required && !robot.enabled) throw new HTTPException(400, { message: "所选钉钉机器人已停用" });
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
    return { webhook: robot.webhookUrl, secret: robot.secret };
  });
}

/** HTTP 成功且机器人确认成功后，调用方才可以登记发送结果。 */
export function sendDingtalkNotification(config: DingtalkConfig, title: string, text: string): Promise<void> {
  return axios.post(signedUrl(config.webhook, config.secret), {
    msgtype: "markdown", markdown: { title, text },
  }, { timeout: 10_000, maxRedirects: 0 }).then((response) => {
    const result = dingtalkResponse.parse(response.data);
    if (result.errcode !== 0) throw new Error(`钉钉发送失败：${result.errcode}`);
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
