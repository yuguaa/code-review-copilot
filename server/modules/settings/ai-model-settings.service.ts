import { generateText } from 'ai';
import { prisma } from '../../infrastructure/prisma/prisma.service';
import { resolveModel } from '../ai-models/ai-models.service';
import type { AIModelPayload } from './settings.types';

const MODEL_TEST_TIMEOUT_MS = 15_000;

function maskModel(model: { apiKey?: string; [key: string]: unknown }) {
  const { apiKey, ...rest } = model;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

function modelUpdateData(body: AIModelPayload) {
  const data: Record<string, unknown> = {};
  for (const key of ['provider', 'modelId', 'apiBaseUrl', 'maxSteps', 'isDefault', 'isActive'] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.isActive === false) data.isDefault = false;
  if (body.isDefault === true) data.isActive = true;
  if (typeof body.apiKey === 'string' && body.apiKey.length > 0) data.apiKey = body.apiKey;
  return data;
}

export async function listAIModels() {
  const models = await prisma.aIModel.findMany({ orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
  return models.map(maskModel);
}

export function getAIModel(id: string) {
  return prisma.aIModel.findUnique({ where: { id } });
}

export function testAIModel(id: string): Promise<boolean | null> {
  return getAIModel(id).then((storedModel) => {
    if (!storedModel) return null;
    return Promise.resolve()
      .then(() => resolveModel(storedModel))
      .then((model) => generateText({
        model,
        prompt: '请只回复 OK。',
        maxOutputTokens: 8,
        maxRetries: 0,
        timeout: MODEL_TEST_TIMEOUT_MS,
      }))
      .then(() => true)
      .catch(() => false);
  });
}

export async function createAIModel(body: AIModelPayload) {
  const model = await prisma.$transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.aIModel.updateMany({ data: { isDefault: false } });
    }
    return tx.aIModel.create({
      data: {
        provider: body.provider ?? '',
        modelId: body.modelId ?? '',
        apiKey: body.apiKey ?? '',
        apiBaseUrl: body.apiBaseUrl || null,
        maxSteps: body.maxSteps ?? 16,
        isDefault: body.isDefault ?? false,
        isActive: body.isDefault === true ? true : body.isActive ?? true,
      },
    });
  });
  return maskModel(model);
}

export async function updateAIModel(id: string, body: AIModelPayload) {
  const model = await prisma.$transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.aIModel.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }
    return tx.aIModel.update({ where: { id }, data: modelUpdateData(body) });
  });
  return maskModel(model);
}

export async function deleteAIModel(id: string) {
  await prisma.aIModel.delete({ where: { id } }).catch(() => undefined);
  return { success: true };
}
