import { prisma } from '../../infrastructure/prisma/prisma.service';
import type { AIModelPayload } from './settings.types';

function maskModel(model: { apiKey?: string; [key: string]: unknown }) {
  const { apiKey, ...rest } = model;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

function modelUpdateData(body: AIModelPayload) {
  const data: Record<string, unknown> = {};
  for (const key of ['provider', 'modelId', 'apiBaseUrl', 'maxSteps', 'isDefault', 'isActive'] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (typeof body.apiKey === 'string' && body.apiKey.length > 0) data.apiKey = body.apiKey;
  return data;
}

export async function listAIModels() {
  const models = await prisma.aIModel.findMany({ orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
  return models.map(maskModel);
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
        isActive: body.isActive ?? true,
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
