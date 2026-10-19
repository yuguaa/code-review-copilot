import { useState } from 'react';
import { ActivityIcon, ArrowRightIcon } from 'lucide-react';
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
  return <main className="grid min-h-dvh lg:grid-cols-2"><section className="hidden flex-col justify-between border-r bg-sidebar p-12 lg:flex"><div className="flex items-center gap-3 font-semibold"><ActivityIcon className="size-7 text-primary" />Review Copilot</div><div className="max-w-lg"><p className="mb-5 text-xs font-semibold tracking-[0.2em] text-primary">CODE REVIEW WORKSPACE</p><h1 className="text-4xl font-semibold leading-snug tracking-tight">每次变更，<br />都有清楚的审查记录。</h1><p className="mt-6 max-w-sm text-sm leading-7 text-muted-foreground">连接代码仓库，查看 OCR 报告，围绕提交继续提问。</p></div><p className="text-xs text-muted-foreground">Open Code Review · 自主管理的工作空间</p></section><section className="flex items-center justify-center px-6 py-16"><div className="w-full max-w-sm"><ActivityIcon className="mb-8 size-8 text-primary lg:hidden" /><h2 className="text-2xl font-semibold tracking-tight">登录工作空间</h2><p className="mb-8 mt-2 text-sm text-muted-foreground">使用项目账号访问审查记录和遥测。</p><form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); action.execute('login', () => api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: username.trim(), secret }) }).then(auth.refresh).then(() => navigate(destination, { replace: true }))); }}><FieldGroup><Field label="账号"><Input name="username" autoComplete="username" required autoFocus value={username} onChange={(event) => setUsername(event.target.value)} /></Field><Field label="密码"><Input name="password" type="password" autoComplete="current-password" required value={secret} onChange={(event) => setSecret(event.target.value)} /></Field></FieldGroup><Button type="submit" size="lg" disabled={Boolean(action.pending)}>{action.pending ? '正在登录…' : '登录'}<ArrowRightIcon /></Button></form></div></section></main>;
}
