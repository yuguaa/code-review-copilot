import { Prisma } from "@prisma/client";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { Context } from "hono";

export const httpUrl = z.string().trim().url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "地址必须使用 HTTP 或 HTTPS，且不能包含用户名和密码");

export const positiveInteger = z.number().int().positive().max(2_147_483_647);
export const nonNegativeInteger = z.number().int().nonnegative().max(2_147_483_647);

/** 密码表单留空时保留已保存的值，null 明确清除可选凭证。 */
export const credentialInput = z.string().transform((value) => value.trim() ? value : undefined).optional();
export const optionalCredentialInput = credentialInput.nullable();

export const modelProvider = z.enum(["openai", "anthropic", "openai-compatible"]);

export const aiModelInput = z.object({
  provider: modelProvider,
  modelId: z.string().trim().min(1),
  apiKey: credentialInput,
  apiBaseUrl: httpUrl.nullable().optional(),
  maxSteps: positiveInteger.default(16),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
}).strict();

export const gitLabAccountInput = z.object({
  url: httpUrl,
  accessToken: credentialInput,
  webhookSecret: optionalCredentialInput,
  isActive: z.boolean().default(true),
}).strict();

export const dingtalkRobotInput = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  webhookUrl: credentialInput.refine(
    (value) => value === undefined || httpUrl.safeParse(value).success,
    "钉钉 webhook 必须是 HTTP 或 HTTPS 地址",
  ),
  secret: optionalCredentialInput,
}).strict();

export function configurationError(error: Error, context: Context) {
  if (error instanceof SyntaxError) return context.json({ error: "请求内容必须是有效的 JSON" }, 400);
  if (error instanceof z.ZodError) {
    return context.json({ error: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；") }, 400);
  }
  if (error instanceof HTTPException) return context.json({ error: error.message }, error.status);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return context.json({ error: "配置记录不存在" }, 404);
    if (error.code === "P2002") return context.json({ error: "配置已经存在" }, 409);
    if (["P2003", "P2014"].includes(error.code)) return context.json({ error: "关联配置不存在或仍在使用" }, 409);
    if (error.code === "P2034") return context.json({ error: "配置正在被其他请求修改，请重新提交" }, 409);
  }
  return context.json({ error: "配置操作失败" }, 500);
}
