import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import GitPullRequest from 'lucide-react/dist/esm/icons/git-pull-request';
import ScanSearch from 'lucide-react/dist/esm/icons/scan-search';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
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
    <div ref={rootRef} className="login-shell line-canvas measure-rails blueprint-backdrop min-h-full">
      <div className="login-layout mx-auto grid min-h-full max-w-6xl items-center gap-14 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="mx-auto w-full max-w-md">
          <span data-login-copy className="login-mark flex h-12 w-12 items-center justify-center rounded-[var(--r-pill)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)]">
            <ScanSearch size={19} />
          </span>
          <p data-login-copy className="caption mt-8 text-[var(--accent)]">代码审查 Agent</p>
          <h1 data-login-copy className="font-display mt-3 text-[54px] leading-[1.02] text-[var(--ink)] max-sm:text-[40px]">
            让每次评审
            <span className="login-heading-accent block">都有证据可追问。</span>
          </h1>
          <p data-login-copy className="mt-5 text-base leading-7 text-[var(--muted)]">
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

        <div data-login-panel className="login-visual technical-panel hidden h-[430px] overflow-hidden rounded-[var(--r-lg)] lg:flex lg:flex-col lg:justify-between">
          <div className="login-visual-grid" />
          <div className="relative z-10 flex items-center justify-between px-8 pt-7">
            <div>
              <p className="caption text-[var(--muted)]">Review orchestration</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ink)]">多 Agent 证据链</p>
            </div>
            <span className="caption rounded-[var(--r-pill)] border border-[var(--line-default)] bg-[var(--surface-soft)]/80 px-2.5 py-1 text-[var(--body)]">实时</span>
          </div>

          <div className="login-pipeline relative z-10 flex items-center justify-center px-9">
            <div data-login-tile className="pipeline-node will-change-transform">
              <GitPullRequest size={19} />
              <span>MR</span>
            </div>
            <div className="pipeline-beam"><span /></div>
            <div data-login-tile className="pipeline-node is-center will-change-transform">
              <ScanSearch size={22} />
              <span>审查</span>
            </div>
            <div className="pipeline-beam is-reversed"><span /></div>
            <div data-login-tile className="pipeline-node will-change-transform">
              <ShieldCheck size={19} />
              <span>Verify</span>
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-3 border-t border-[var(--line-subtle)] bg-[var(--canvas)]/38">
            {[
              ['01', '并行取证'],
              ['02', '多模型复核'],
              ['03', '结论发布'],
            ].map(([index, label]) => (
              <div key={index} className="border-r border-[var(--line-subtle)] px-5 py-4 last:border-r-0">
                <p className="caption text-[var(--muted-soft)]">{index}</p>
                <p className="mt-1 text-[13px] font-medium text-[var(--body-strong)]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
