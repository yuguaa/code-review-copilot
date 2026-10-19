import { useState } from 'react';
import { ArrowRightIcon, ScanSearchIcon } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '@web/App';
import { Button } from '@web/components/ui/button';
import { Field, FieldGroup, Input } from '@web/components/ui/forms';
import { useAction } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

export function Login() {
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const action = useAction();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const destination = from?.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login') ? from : '/';
  if (auth.ready && auth.authed) return <Navigate to={destination} replace />;
  return <main className="app-grid grid min-h-dvh overflow-hidden lg:grid-cols-[1.08fr_0.92fr]">
    <section className="relative hidden flex-col justify-between border-r border-border/70 bg-sidebar/55 p-10 lg:flex lg:p-14">
      <div className="flex items-center gap-3 text-sm font-semibold">
        <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
          <ScanSearchIcon className="size-4" />
        </span>
        Review Copilot
      </div>
      <div className="max-w-xl">
        <div className="mb-6 flex items-center gap-3 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          <span className="h-px w-8 bg-foreground/30" />
          Self-hosted review workspace
        </div>
        <h1 className="text-4xl leading-[1.15] font-semibold tracking-[-0.04em] xl:text-5xl">
          把每次变更<br />
          <span className="text-muted-foreground">变成可追溯的审查记录。</span>
        </h1>
        <p className="mt-6 max-w-sm text-sm leading-7 text-muted-foreground">
          连接代码仓库，查看 OCR 报告，围绕提交继续提问。
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-success" />
        Open Code Review · 自主管理的工作空间
      </div>
    </section>
    <section className="flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-[380px] rounded-lg border border-border bg-card/90 p-6 shadow-sm backdrop-blur-sm sm:p-8">
        <span className="mb-6 flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground lg:hidden">
          <ScanSearchIcon className="size-4" />
        </span>
        <p className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">Secure sign in</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">登录工作空间</h2>
        <p className="mt-2 mb-8 text-sm leading-6 text-muted-foreground">使用项目账号访问审查记录和遥测。</p>
        <form className="flex flex-col gap-6" onSubmit={(event) => {
          event.preventDefault();
          action.execute('login', () => api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username: username.trim(), secret }),
          }).then(auth.refresh).then(() => navigate(destination, { replace: true })));
        }}>
          <FieldGroup>
            <Field label="账号"><Input name="username" autoComplete="username" required autoFocus value={username} onChange={(event) => setUsername(event.target.value)} /></Field>
            <Field label="密码"><Input name="password" type="password" autoComplete="current-password" required value={secret} onChange={(event) => setSecret(event.target.value)} /></Field>
          </FieldGroup>
          <Button type="submit" size="lg" disabled={Boolean(action.pending)}>
            {action.pending ? '正在登录…' : '登录'}
            <ArrowRightIcon />
          </Button>
        </form>
      </div>
    </section>
  </main>;
}
