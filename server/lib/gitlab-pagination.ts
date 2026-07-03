import type { AxiosInstance } from 'axios';

type FetchGitLabPagesOptions = {
  client: AxiosInstance;
  path: string;
  params?: Record<string, unknown>;
  perPage?: number;
  maxPages?: number;
};

export async function fetchGitLabPages<T>({
  client,
  path,
  params,
  perPage = 100,
  maxPages = 20,
}: FetchGitLabPagesOptions): Promise<T[]> {
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await client.get(path, {
      params: {
        ...params,
        per_page: perPage,
        page,
      },
    });
    const batch = Array.isArray(response.data) ? response.data as T[] : [];
    items.push(...batch);
    if (batch.length < perPage) break;
  }

  return items;
}
