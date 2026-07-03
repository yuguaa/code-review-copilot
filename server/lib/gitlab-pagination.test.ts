import { describe, expect, it, vi } from 'vitest';
import { fetchGitLabPages } from './gitlab-pagination';

describe('fetchGitLabPages', () => {
  it('持续分页直到返回数量小于 perPage', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }] })
      .mockResolvedValueOnce({ data: [{ id: 3 }] });

    const items = await fetchGitLabPages<{ id: number }>({
      client: { get } as never,
      path: '/projects/1/repository/commits',
      params: { ref_name: 'main' },
      perPage: 2,
      maxPages: 5,
    });

    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(get).toHaveBeenNthCalledWith(1, '/projects/1/repository/commits', {
      params: { ref_name: 'main', per_page: 2, page: 1 },
    });
    expect(get).toHaveBeenNthCalledWith(2, '/projects/1/repository/commits', {
      params: { ref_name: 'main', per_page: 2, page: 2 },
    });
  });

  it('达到 maxPages 后停止', async () => {
    const get = vi.fn().mockResolvedValue({ data: [{ id: 1 }] });

    await fetchGitLabPages<{ id: number }>({
      client: { get } as never,
      path: '/items',
      perPage: 1,
      maxPages: 2,
    });

    expect(get).toHaveBeenCalledTimes(2);
  });
});
