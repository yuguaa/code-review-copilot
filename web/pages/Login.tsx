import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuth } from '../App';
import { Button, SectionLabel } from '../components/ui';

/** 暖调「3D 黏土」近似插画：奶油天光下的圆润山脉与漂浮形状（纯 SVG 近似，非商用委托资产）。 */
function ClayScene() {
  return (
    <svg viewBox="0 0 400 360" className="h-full w-full" role="img" aria-label="奶油色山脉插画">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff4e0" />
          <stop offset="100%" stopColor="#faf5e8" />
        </linearGradient>
        <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffc59a" />
          <stop offset="100%" stopColor="#ffb084" />
        </linearGradient>
        <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c9b6f2" />
          <stop offset="100%" stopColor="#b8a4ed" />
        </linearGradient>
        <linearGradient id="m3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2b5050" />
          <stop offset="100%" stopColor="#1a3a3a" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="400" height="360" rx="24" fill="url(#sky)" />
      {/* 太阳 */}
      <circle cx="300" cy="96" r="40" fill="#e8b94a" />
      <circle cx="300" cy="96" r="40" fill="#fff" opacity="0.12" />
      {/* 漂浮圆点 */}
      <circle cx="78" cy="70" r="12" fill="#a4d4c5" />
      <circle cx="128" cy="46" r="7" fill="#ff6b5a" />
      <circle cx="342" cy="180" r="9" fill="#ff4d8b" />
      {/* 远山 */}
      <path d="M0 250 Q90 150 180 250 T400 250 V360 H0 Z" fill="url(#m2)" />
      {/* 中山 */}
      <path d="M0 300 Q120 190 250 300 T400 290 V360 H0 Z" fill="url(#m1)" />
      {/* 近山（深 teal，带雪顶） */}
      <path d="M120 360 Q230 205 360 360 Z" fill="url(#m3)" />
      <path d="M215 250 Q240 228 265 250 Q250 262 240 262 Q230 262 215 250 Z" fill="#f5f0e0" />
    </svg>
  );
}

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
      <div className="mx-auto grid min-h-full max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1fr_1.05fr]">
        {/* 左：hero 文案 + 登录表单 */}
        <div className="animate-fade-in mx-auto w-full max-w-md">
          <span className="flex h-12 w-12 items-center justify-center rounded-[var(--r-md)] bg-[var(--primary)] text-white">
            <span className="font-display text-xl">C</span>
          </span>
          <SectionLabel className="mt-8 block">代码审查 AGENT</SectionLabel>
          <h1 className="font-display mt-3 text-[44px] leading-[1.05] text-[var(--ink)]">
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

        {/* 右：暖调插画卡 */}
        <div className="hidden h-[420px] overflow-hidden rounded-[var(--r-xl)] bg-[var(--surface-soft)] lg:block">
          <ClayScene />
        </div>
      </div>
    </div>
  );
}
