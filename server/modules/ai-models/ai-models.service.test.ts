import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirstMock = vi.hoisted(() => vi.fn());

vi.mock('../../infrastructure/prisma/prisma.service', () => ({
  prisma: { aIModel: { findFirst: findFirstMock } },
}));

import { loadActiveModelConfig } from './ai-models.service';

beforeEach(() => {
  findFirstMock.mockReset();
});

describe('loadActiveModelConfig', () => {
  it('resolves the exact active record by database id', async () => {
    findFirstMock.mockResolvedValue({
      id: 'model-2',
      provider: 'openai-compatible',
      modelId: 'same-name',
      apiKey: 'second-key',
      apiBaseUrl: 'https://second.test/v1',
      maxSteps: 24,
      isActive: true,
    });

    await expect(loadActiveModelConfig('model-2')).resolves.toEqual({
      provider: 'openai-compatible',
      modelId: 'same-name',
      apiKey: 'second-key',
      apiBaseUrl: 'https://second.test/v1',
      maxSteps: 24,
    });
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: 'model-2', isActive: true } });
  });

  it('returns null when the record does not exist or is inactive', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(loadActiveModelConfig('inactive-model')).resolves.toBeNull();
  });
});
