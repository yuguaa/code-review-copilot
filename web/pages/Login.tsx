import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../App';
import { Button, SectionLabel } from '../components/ui';

export function Login() {
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, secret }) })
      .then(() => refresh())
      .then(() => navigate('/', { replace: true }))
      .catch((err) => toast.error(err instanceof Error ? err.message : '登录失败'))
      .finally(() => setLoading(false));
  };

  const fieldClass =
    'w-full rounded-[var(--r-md)] border border-[var(--hairline)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--muted-soft)] focus:border-[var(--ink)] focus:ring-4 focus:ring-[var(--ring)]';

  return (
    <div className="min-h-full bg-[var(--canvas)]">
      <div className="mx-auto grid min-h-full max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="animate-fade-in mx-auto w-full max-w-md">
          <span className="flex h-12 w-12 items-center justify-center rounded-[var(--r-pill)] bg-[var(--primary)] text-white">
            <span className="font-display text-xl">R</span>
          </span>
          <SectionLabel className="mt-8 block">代码审查 AGENT</SectionLabel>
          <h1 className="font-display mt-3 text-[44px] leading-[1.05] text-[var(--ink)] max-sm:text-[36px]">
            让每次评审
            <br />
            都可以追问
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">
            Webhook 触发审查，结论沉淀成一次可对话的会话——上下文、风险、结论，随时接着问。
          </p>

          <form onSubmit={submit} className="mt-8 space-y-3">
            <input
              className={fieldClass}
              placeholder="账号"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
            <input
              className={fieldClass}
              placeholder="密钥"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <Button type="submit" disabled={loading} className="w-full py-3">
              {loading ? '登录中…' : '登录'}
            </Button>
          </form>
        </div>

        <div className="hidden h-[430px] overflow-hidden rounded-[var(--r-xl)] lg:grid lg:grid-cols-2 lg:grid-rows-2">
          <div className="bg-[var(--brand-lime)] p-8">
            <p className="eyebrow text-[var(--ink)]">WEBHOOK</p>
            <p className="mt-20 font-display text-4xl leading-none text-[var(--ink)]">MR 触发</p>
          </div>
          <div className="bg-[var(--brand-lilac)] p-8">
            <p className="eyebrow text-[var(--ink)]">REVIEW</p>
            <p className="mt-20 font-display text-4xl leading-none text-[var(--ink)]">结论沉淀</p>
          </div>
          <div className="bg-[var(--brand-navy)] p-8 text-white">
            <p className="eyebrow text-white/70">THREAD</p>
            <p className="mt-20 font-display text-4xl leading-none">继续追问</p>
          </div>
          <div className="bg-[var(--brand-mint)] p-8">
            <p className="eyebrow text-[var(--ink)]">MEMORY</p>
            <p className="mt-20 font-display text-4xl leading-none text-[var(--ink)]">上下文复用</p>
          </div>
        </div>
      </div>
    </div>
  );
}
