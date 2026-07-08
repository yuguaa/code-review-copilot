import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../infrastructure/prisma/prisma.service';
import { readRepositoryMemory, updateRepository, writeRepositoryMemory } from './repositories.service';

vi.mock('../../infrastructure/prisma/prisma.service', () => ({
  prisma: {
    repository: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../tools/tools.service', () => ({
  assertKnownToolKeys: vi.fn(),
  filterToolKeys: vi.fn((keys: string[]) => new Set(keys)),
  listActiveTools: vi.fn().mockResolvedValue([]),
}));

vi.mock('../skills/skills.service', () => ({
  assertKnownSkillKeys: vi.fn(),
  filterSkillKeys: vi.fn((keys: string[]) => new Set(keys)),
  listActiveSkills: vi.fn().mockResolvedValue([]),
}));

describe('repositories.service memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('读取仓库记忆并清理首尾空白', async () => {
    vi.mocked(prisma.repository.findUnique).mockResolvedValue({ memory: '  ## 约定\n' } as never);

    await expect(readRepositoryMemory('repo-1')).resolves.toBe('## 约定');
    expect(prisma.repository.findUnique).toHaveBeenCalledWith({
      where: { id: 'repo-1' },
      select: { memory: true },
    });
  });

  it('没有记忆时返回明确空状态文本', async () => {
    vi.mocked(prisma.repository.findUnique).mockResolvedValue({ memory: '  ' } as never);

    await expect(readRepositoryMemory('repo-1')).resolves.toBe('（暂无项目记忆）');
  });

  it('写入仓库记忆由仓库模块统一落库', async () => {
    vi.mocked(prisma.repository.update).mockResolvedValue({} as never);

    await expect(writeRepositoryMemory('repo-1', '新的记忆')).resolves.toEqual({ saved: true });
    expect(prisma.repository.update).toHaveBeenCalledWith({
      where: { id: 'repo-1' },
      data: { memory: '新的记忆' },
    });
  });
});

describe('repositories.service update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('更新仓库时把空字符串默认模型归一化为 null', async () => {
    vi.mocked(prisma.repository.update).mockResolvedValue({ id: 'repo-1', defaultAIModel: null } as never);

    await updateRepository('repo-1', { defaultAIModelId: '' });

    expect(prisma.repository.update).toHaveBeenCalledWith({
      where: { id: 'repo-1' },
      data: { defaultAIModelId: null },
    });
  });
});
