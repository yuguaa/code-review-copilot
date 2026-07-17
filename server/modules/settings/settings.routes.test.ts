import { beforeEach, describe, expect, it, vi } from 'vitest';

const testAIModelMock = vi.hoisted(() => vi.fn());

vi.mock('./ai-model-settings.service', () => ({
  createAIModel: vi.fn(),
  deleteAIModel: vi.fn(),
  getAIModel: vi.fn(),
  listAIModels: vi.fn(),
  testAIModel: testAIModelMock,
  updateAIModel: vi.fn(),
}));

import { settingsRoutes } from './settings.routes';

beforeEach(() => {
  testAIModelMock.mockReset();
});

describe('POST /models/:id/test', () => {
  it('返回模型连接成功状态', async () => {
    testAIModelMock.mockResolvedValue(true);

    const response = await settingsRoutes.request('http://localhost/models/model-1/test', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(testAIModelMock).toHaveBeenCalledWith('model-1');
  });

  it('返回模型连接失败状态', async () => {
    testAIModelMock.mockResolvedValue(false);

    const response = await settingsRoutes.request('http://localhost/models/model-1/test', { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });

  it('模型不存在时返回 404', async () => {
    testAIModelMock.mockResolvedValue(null);

    const response = await settingsRoutes.request('http://localhost/models/missing-model/test', { method: 'POST' });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: '模型不存在' });
  });
});
