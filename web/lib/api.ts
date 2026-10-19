import { toast } from 'sonner';

export class UnauthorizedError extends Error {}

/* 所有接口错误统一展示；请求取消由调用方处理。 */
export function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('Content-Type', 'application/json');
  return fetch(path, { ...init, credentials: 'same-origin', headers }).then((response) => {
    if (response.status === 401) {
      window.dispatchEvent(new Event('auth-expired'));
      throw new UnauthorizedError('登录已过期，请重新登录');
    }
    if (!response.ok) {
      return response.text().then((text) => {
        let message = `请求失败（${response.status}）`;
        if (response.headers.get('content-type')?.includes('application/json') && text) {
          const body = JSON.parse(text) as { error?: string };
          if (body.error) message = body.error;
        }
        throw new Error(message);
      });
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name !== 'AbortError') toast.error(error.message);
    throw error;
  });
}

export function checkAuth(): Promise<boolean> {
  return fetch('/api/auth/me', { credentials: 'same-origin' }).then((response) => {
    if (response.status === 401) return false;
    if (!response.ok) throw new Error('登录状态读取失败');
    return true;
  });
}
