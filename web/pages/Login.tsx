import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../App';
import { Button } from '../components/ui/button';
import { SectionLabel } from '../components/ui/surface';

export function Login() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
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
          { y: 18, filter: 'blur(4px)' },
          {
            y: 0,
            filter: 'blur(0px)',
            duration: 0.72,
            stagger: 0.07,
            clearProps: 'transform,filter',
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
    setLoading(true);
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, secret }) })
      .then(() => refresh())
      .then(() => navigate('/', { replace: true }))
      .catch((err) => toast.error(err instanceof Error ? err.message : '登录失败'))
      .finally(() => setLoading(false));
  };

  const fieldClass =
    'w-full rounded-[var(--r-md)] border border-[var(--line-default)] bg-[var(--surface-card)] px-4 py-3 text-sm text-[var(--ink)] shadow-[var(--shadow-sm)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--muted)] hover:border-[var(--line-strong)] focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--ring)]';

  return (
    <div ref={rootRef} className="line-canvas measure-rails blueprint-backdrop min-h-full">
      <div className="mx-auto grid min-h-full max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="mx-auto w-full max-w-md">
          <span data-login-copy className="flex h-12 w-12 items-center justify-center rounded-[var(--r-md)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)]">
            <span className="font-display text-xl">R</span>
          </span>
          <SectionLabel data-login-copy className="mt-8 block">代码审查 AGENT</SectionLabel>
          <h1 data-login-copy className="font-display mt-3 text-[44px] leading-[1.05] text-[var(--ink)] max-sm:text-[36px]">
            让每次评审
            <br />
            都可以追问
          </h1>
          <p data-login-copy className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">
            Webhook 触发审查，结论沉淀成一次可对话的会话——上下文、风险、结论，随时接着问。
          </p>

          <form data-login-copy onSubmit={submit} className="mt-8 space-y-3">
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

        <div data-login-panel className="technical-panel hidden h-[430px] overflow-hidden rounded-[var(--r-lg)] lg:grid lg:grid-cols-2 lg:grid-rows-2">
          <div data-login-tile className="bg-[var(--brand-lime)] p-8 will-change-transform">
            <p className="eyebrow text-[var(--ink)]">WEBHOOK</p>
            <p className="mt-20 font-display text-4xl leading-none text-[var(--ink)]">MR 触发</p>
          </div>
          <div data-login-tile className="bg-[var(--brand-lilac)] p-8 will-change-transform">
            <p className="eyebrow text-[var(--ink)]">REVIEW</p>
            <p className="mt-20 font-display text-4xl leading-none text-[var(--ink)]">结论沉淀</p>
          </div>
          <div data-login-tile className="bg-[var(--brand-navy)] p-8 text-white will-change-transform">
            <p className="eyebrow text-white/70">THREAD</p>
            <p className="mt-20 font-display text-4xl leading-none">继续追问</p>
          </div>
          <div data-login-tile className="bg-[var(--brand-mint)] p-8 will-change-transform">
            <p className="eyebrow text-[var(--ink)]">MEMORY</p>
            <p className="mt-20 font-display text-4xl leading-none text-[var(--ink)]">上下文复用</p>
          </div>
        </div>
      </div>
    </div>
  );
}
