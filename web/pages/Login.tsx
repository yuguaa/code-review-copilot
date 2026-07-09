import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
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
          { x: 28, scale: 0.98 },
          {
            x: 0,
            scale: 1,
            duration: 0.82,
            clearProps: 'transform',
          },
          '-=0.48',
        )
        .fromTo(
          '[data-login-tile]',
          { y: 18, scale: 0.96 },
          {
            y: 0,
            scale: 1,
            duration: 0.62,
            stagger: 0.06,
            clearProps: 'transform',
          },
          '-=0.46',
        );

      const tiles = gsap.utils.toArray<HTMLElement>('[data-login-tile]');
      const cleanups = tiles.map((tile) => {
        const xTo = gsap.quickTo(tile, 'x', { duration: 0.36, ease: 'power3.out' });
        const yTo = gsap.quickTo(tile, 'y', { duration: 0.36, ease: 'power3.out' });
        const scaleTo = gsap.quickTo(tile, 'scale', { duration: 0.36, ease: 'power3.out' });

        const onMove = (event: MouseEvent) => {
          const rect = tile.getBoundingClientRect();
          const x = (event.clientX - rect.left - rect.width / 2) / rect.width;
          const y = (event.clientY - rect.top - rect.height / 2) / rect.height;
          xTo(x * 8);
          yTo(y * 8);
          scaleTo(1.025);
        };
        const onLeave = () => {
          xTo(0);
          yTo(0);
          scaleTo(1);
        };

        tile.addEventListener('mousemove', onMove);
        tile.addEventListener('mouseleave', onLeave);
        return () => {
          tile.removeEventListener('mousemove', onMove);
          tile.removeEventListener('mouseleave', onLeave);
        };
      });

      return () => cleanups.forEach((cleanup) => cleanup());
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
    <div ref={rootRef} className="line-canvas measure-rails blueprint-backdrop min-h-full">
      <div className="mx-auto grid min-h-full max-w-6xl items-center gap-14 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="mx-auto w-full max-w-md">
          <span data-login-copy className="flex h-12 w-12 items-center justify-center rounded-[var(--r-sm)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)]">
            <span className="font-display text-2xl leading-none">审</span>
          </span>
          <p data-login-copy className="caption mt-8 text-[var(--brand-magenta)]">代码审查 Agent</p>
          <h1 data-login-copy className="font-display mt-3 text-[56px] leading-[0.98] text-[var(--ink)] max-sm:text-[42px]">
            让每次
            <br />
            <span className="italic text-[var(--muted)]">评审</span>
            <br />
            <span className="text-[var(--brand-magenta)]">都可追问。</span>
          </h1>
          <p data-login-copy className="mt-5 text-[15px] leading-relaxed text-[var(--muted)]">
            Webhook 触发审查，结论沉淀成一次可对话的会话。上下文、风险和结论，随时接着问。
          </p>

          <form data-login-copy onSubmit={submit} className="mt-8 space-y-4 border-t border-[var(--line-default)] pt-5">
            <Field label="账号" hint="使用平台分配的审查工作台账号登录。">
              <Input
                placeholder="请输入账号"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setFormError(null);
                }}
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
              />
            </Field>
            <Button type="submit" disabled={loading} className="w-full py-3">
              {loading ? '登录中…' : '登录'}
            </Button>
          </form>
        </div>

        <div data-login-panel className="technical-panel hidden h-[430px] overflow-hidden rounded-[var(--r-lg)] lg:grid lg:grid-cols-2 lg:grid-rows-2">
          <div data-login-tile className="bg-[var(--brand-magenta)] p-8 text-white will-change-transform">
            <p className="caption text-white/72">触发源</p>
            <p className="mt-20 font-display text-[42px] leading-none">MR 触发</p>
          </div>
          <div data-login-tile className="bg-[var(--surface-card)] p-8 will-change-transform">
            <p className="caption text-[var(--ink)]">审查流</p>
            <p className="mt-20 font-display text-[42px] leading-none text-[var(--ink)]">结论沉淀</p>
          </div>
          <div data-login-tile className="bg-[var(--brand-navy)] p-8 text-white will-change-transform">
            <p className="caption text-white/70">会话</p>
            <p className="mt-20 font-display text-[42px] leading-none">继续追问</p>
          </div>
          <div data-login-tile className="bg-[var(--brand-cyan)] p-8 will-change-transform">
            <p className="caption text-[var(--ink)]">上下文</p>
            <p className="mt-20 font-display text-[42px] leading-none text-[var(--ink)]">上下文复用</p>
          </div>
        </div>
      </div>
    </div>
  );
}
