import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScanSearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../App';
import { Button } from '../components/ui/button';
import { Field, Input } from '../components/ui/forms';

const BRAND_GRID =
  'bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:28px_28px]';

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
          { y: 0, opacity: 1, duration: 0.72, stagger: 0.07, clearProps: 'transform,opacity' },
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

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !secret.trim()) {
      setFormError('请输入账号和密钥');
      return;
    }
    setFormError(null);
    setLoading(true);
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, secret }) })
      .then(() => refresh())
      .then(() => navigate('/', { replace: true }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : '登录失败';
        setFormError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  };

  return (
    <main ref={rootRef} className="grid min-h-dvh overflow-hidden bg-background lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col">
        <div className={`absolute inset-0 ${BRAND_GRID}`} />
        <div data-login-copy className="relative z-10 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-background text-primary">
            <ScanSearchIcon size={18} />
          </span>
          <div>
            <strong className="block text-sm">代码审查工作台</strong>
            <span className="text-xs opacity-70">Review Console</span>
          </div>
        </div>
        <div className="relative z-10 my-auto max-w-xl">
          <p data-login-copy className="mb-5 text-sm font-medium opacity-70">
            Review Agent
          </p>
          <h1 data-login-copy className="text-4xl font-semibold leading-tight tracking-tight">
            让每次评审，
            <br />
            都有证据可追问。
          </h1>
          <p data-login-copy className="mt-6 max-w-lg text-base leading-8 opacity-80">
            Webhook 触发审查，结论沉淀成可对话的会话。上下文、风险和结论，随时接着问。
          </p>
        </div>
        <p data-login-copy className="relative z-10 text-xs opacity-60">
          多 Agent 代码审查系统
        </p>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-6 py-12 sm:px-12">
        <div data-login-panel className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <span className="mb-5 flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ScanSearchIcon size={19} />
            </span>
            <p className="text-sm font-medium">代码审查工作台</p>
          </div>
          <div className="mb-8">
            <h2 className="text-3xl font-semibold tracking-tight">欢迎回来</h2>
            <p className="mt-2 text-sm text-muted-foreground">使用平台分配的账号与密钥登录</p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <Field label="账号">
              <Input
                placeholder="请输入账号"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
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
                onChange={(event) => {
                  setSecret(event.target.value);
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
