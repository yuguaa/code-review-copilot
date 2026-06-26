/** 统一 fetch：同源带 Cookie；401 抛特定错误供路由守卫识别。 */
export class UnauthorizedError extends Error {}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401) throw new UnauthorizedError('未登录');
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((msg as { error?: string }).error ?? `请求失败：${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function checkAuth(): Promise<boolean> {
  try {
    await api('/api/auth/me');
    return true;
  } catch {
    return false;
  }
}
