import type { AxiosInstance } from "axios";

export type FetchGitLabPagesOptions = {
  client: AxiosInstance;
  path: string;
  params?: Record<string, unknown>;
  perPage?: number;
  maxPages?: number;
};

/** 达到读取上限时明确失败，调用方不会收到缺少后续页面的列表。 */
export function fetchGitLabPages<T>({
  client, path, params, perPage = 100, maxPages = 200,
}: FetchGitLabPagesOptions): Promise<T[]> {
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) throw new Error("GitLab perPage 必须在 1 到 100 之间");
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error("GitLab maxPages 必须是正整数");
  const items: T[] = [];
  const readPage = (page: number): Promise<T[]> => client.get<unknown>(path, {
    params: { ...params, per_page: perPage, page },
  }).then((response) => {
    if (!Array.isArray(response.data)) throw new Error("GitLab 分页响应必须是数组");
    const batch = response.data as T[];
    items.push(...batch);
    const next = response.headers["x-next-page"];
    if (next === "" || (next === undefined && batch.length < perPage)) return items;
    const nextPage = next === undefined ? page + 1 : Number(next);
    if (!Number.isSafeInteger(nextPage) || nextPage !== page + 1) throw new Error("GitLab 返回无效的下一页编号");
    if (page >= maxPages) throw new Error(`GitLab 列表超过 ${maxPages} 页读取上限`);
    return readPage(nextPage);
  });
  return readPage(1);
}
