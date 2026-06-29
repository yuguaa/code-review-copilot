import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../App';

export function Login() {
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, secret }) });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl shadow-slate-200/80 ring-1 ring-slate-200"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold text-slate-950">代码审查 Agent</h1>
          <p className="text-sm text-slate-500">请输入账号与密钥登录</p>
        </div>
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          placeholder="账号"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          placeholder="密钥"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white shadow-sm transition-[background-color,transform] hover:bg-slate-800 active:scale-95 disabled:opacity-50"
        >
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
