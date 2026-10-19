import { Prisma } from "@prisma/client";
import { generateText } from "ai";
import { HTTPException } from "hono/http-exception";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { resolveModel } from "../ai-models/ai-models.service";
import { aiModelInput } from "./config-input";

import type { AIModel } from "@prisma/client";

export function maskModel(model: AIModel) {
  const { apiKey, ...rest } = model;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

function validateModel(model: Pick<AIModel, "apiKey" | "provider" | "apiBaseUrl">) {
  if (!model.apiKey.trim()) throw new HTTPException(400, { message: "请填写模型 apiKey" });
  if (model.provider === "openai-compatible" && !model.apiBaseUrl) {
    throw new HTTPException(400, { message: "openai-compatible 必须配置 apiBaseUrl" });
  }
}

export function listAIModels() {
  return prisma.aIModel.findMany({ orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] })
    .then((models) => models.map(maskModel));
}

export function getAIModel(id: string) {
  return prisma.aIModel.findUnique({ where: { id } }).then((model) => model ? maskModel(model) : null);
}

export function testAIModel(id: string): Promise<boolean | null> {
  return prisma.aIModel.findUnique({ where: { id } }).then((model) => {
    if (!model) return null;
    return generateText({
      model: resolveModel(model),
      prompt: "请只回复 OK。",
      maxOutputTokens: 8,
      maxRetries: 0,
      timeout: 15_000,
    }).then(() => true);
  });
}

export function createAIModel(body: unknown) {
  const input = aiModelInput.parse(body);
  const data = { ...input, apiKey: input.apiKey ?? "", apiBaseUrl: input.apiBaseUrl ?? null };
  validateModel(data);
  if (data.isDefault && !data.isActive) throw new HTTPException(400, { message: "默认模型必须处于启用状态" });
  return prisma.$transaction((tx) => {
    const clearDefault = data.isDefault
      ? tx.aIModel.updateMany({ data: { isDefault: false } })
      : Promise.resolve();
    return clearDefault.then(() => tx.aIModel.create({ data }));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then(maskModel);
}

export function updateAIModel(id: string, body: unknown) {
  const input = aiModelInput.partial().parse(body);
  return prisma.$transaction((tx) => tx.aIModel.findUniqueOrThrow({ where: { id } }).then((current) => {
    const data = { ...input, apiKey: input.apiKey ?? current.apiKey };
    const next = { ...current, ...data };
    validateModel(next);
    if (input.isActive === false) data.isDefault = false;
    if (input.isDefault === true && !next.isActive) throw new HTTPException(400, { message: "默认模型必须处于启用状态" });
    const clearDefault = input.isDefault === true
      ? tx.aIModel.updateMany({ where: { id: { not: id } }, data: { isDefault: false } })
      : Promise.resolve();
    return clearDefault.then(() => tx.aIModel.update({ where: { id }, data }));
  }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then(maskModel);
}

export function deleteAIModel(id: string) {
  return prisma.aIModel.delete({ where: { id } }).then(() => ({ success: true }));
}
