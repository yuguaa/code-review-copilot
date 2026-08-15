import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import ScanSearch from 'lucide-react/dist/esm/icons/scan-search';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../App';
import { Button } from '../components/ui/button';
import { Field, Input } from '../components/ui/forms';

export function Login() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
      timeline
        .fromTo(
          '[data-login-copy]',
          { y: 18, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.72,
            stagger: 0.07,
            clearProps: 'transform,opacity',
          },
        )
        .fromTo(
          '[data-login-panel]',
          { x: 24, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.72, clearProps: 'transform,opacity' },
          '-=0.46',
        );
    },
    { scope: rootRef },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !secret.trim()) {
      setFormError('请输入账号和密钥');
      return;
    }
    setFormError(null);
    setLoading(true);
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, secret }) })
      .then(() => refresh())
      .then(() => navigate('/', { replace: true }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : '登录失败';
        setFormError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };

  return (
    <main ref={rootRef} className="grid min-h-dvh overflow-hidden bg-[var(--canvas)] lg:grid-cols-[1.05fr_0.95fr]">
      <section className="login-brand-panel relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <div className="login-brand-grid absolute inset-0" />
        <div data-login-copy className="relative z-10 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[var(--r-lg)] bg-white text-[var(--primary)] shadow-sm">
            <ScanSearch size={18} />
          </span>
          <div>
            <strong className="block text-sm">代码审查工作台</strong>
            <span className="text-xs text-white/65">Review Console</span>
          </div>
        </div>
        <div className="relative z-10 my-auto max-w-xl">
          <p data-login-copy className="mb-5 text-sm font-semibold text-white/65">Review Agent</p>
          <h1 data-login-copy className="font-display text-5xl leading-[1.12] text-white">
            让每次评审，
            <br />
            都有证据可追问。
          </h1>
          <p data-login-copy className="mt-6 max-w-lg text-base leading-8 text-white/72">
            Webhook 触发审查，结论沉淀成可对话的会话。上下文、风险和结论，随时接着问。
          </p>
        </div>
        <p data-login-copy className="relative z-10 text-xs text-white/55">多 Agent 代码审查系统</p>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-6 py-12 sm:px-12">
        <div data-login-panel className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-[var(--r-lg)] bg-[var(--primary)] text-white">
              <ScanSearch size={19} />
            </span>
            <p className="text-sm font-medium text-[var(--primary-hover)]">代码审查工作台</p>
          </div>
          <div className="mb-8">
            <h2 className="font-display text-3xl text-[var(--ink)]">欢迎回来</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">使用平台分配的账号与密钥登录</p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <Field label="账号">
              <Input
                placeholder="请输入账号"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setFormError(null);
                }}
                className="h-12"
                autoFocus
              />
            </Field>
            <Field label="密钥" error={formError}>
              <Input
                placeholder="请输入密钥"
                type="password"
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setFormError(null);
                }}
                className="h-12"
              />
            </Field>
            <Button type="submit" disabled={loading} className="h-12 w-full text-base">
              {loading ? '登录中…' : '登录'}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
