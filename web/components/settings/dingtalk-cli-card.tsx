import { useEffect } from 'react';

import { ActionError } from '@web/components/common/resource-state';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@web/components/ui/card';
import { Checkbox } from '@web/components/ui/forms';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { DingtalkGlobalState } from '@shared/dingtalk';

export function DingtalkCliCard() {
  const resource = useResource<DingtalkGlobalState>('/api/settings/dingtalk/cli');
  const action = useAction();
  const state = resource.data;
  const pendingLogin = state?.login?.status === 'pending';
  const authenticated = Boolean(state?.auth.authenticated && state.auth.tokenValid && state.auth.profile);
  const update = (path: string, method: string, body?: unknown) => api<DingtalkGlobalState>(`/api/settings/dingtalk/cli${path}`, {
    method, ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(() => resource.reload());
  useEffect(() => {
    if (!pendingLogin) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => { timer = setTimeout(() => { void resource.reload().finally(() => { if (active) poll(); }); }, 3000); };
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [pendingLogin, resource.reload]);
  return <Card>
    <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">平台共享钉钉 CLI<Badge variant={authenticated ? 'outline' : 'secondary'}>{pendingLogin ? '等待扫码授权' : authenticated ? '已登录' : '未登录'}</Badge></CardTitle>
      <CardDescription>全平台仅一条连接，所有仓库共用。作为 Pi 的通用技能，支持在继续对话中查人、核对并确认发送消息；OCR 发现问题后仍在原机器人群报告里 @ 提交人。</CardDescription>
      {authenticated && <p className="text-sm">登录身份：{state?.auth.corpName} / {state?.auth.userName}</p>}
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <ActionError error={resource.error ?? action.error} />
      <p className="text-xs leading-6 text-muted-foreground">扫码后在钉钉官方页面完成 CLI 授权。群内 @ 沿用仓库的机器人配置，无需另填群 ID 或人员名单。对话消息在展示收件人和正文、由你回复“确认发送”后执行；明确要求私聊时使用当前登录身份。OCR 自动审查仍只发一条群报告。</p>
      {state && <Checkbox label="启用共享钉钉 CLI" checked={state.connection.enabled} disabled={Boolean(action.pending) || pendingLogin}
        onChange={(enabled) => action.execute('toggle', () => update('', 'PATCH', { enabled }))} />}
      <div className="flex flex-wrap gap-2">
        <Button disabled={Boolean(action.pending) || pendingLogin} onClick={() => action.execute('login', () => update('/login', 'POST'))}>{action.pending === 'login' ? '正在发起授权…' : authenticated ? '重新扫码登录' : '扫码登录并授权'}</Button>
        <Button variant="outline" disabled={Boolean(action.pending) || resource.loading} onClick={() => void resource.reload()}>检查状态</Button>
        {pendingLogin && <Button variant="outline" disabled={Boolean(action.pending)} onClick={() => action.execute('cancel', () => update('/cancel', 'POST', { loginId: state.login!.id }))}>取消本次登录</Button>}
      </div>
      {pendingLogin && <section aria-live="polite" className="flex flex-col items-start gap-3 rounded-lg border p-4">
        {state.qrCode ? <img src={state.qrCode} alt="钉钉 CLI 登录授权二维码" width={240} height={240} className="max-w-full rounded-md bg-white" /> : <p className="text-sm">正在通过钉钉 CLI 获取授权二维码…</p>}
        {state.login?.authorizationUrl && <a className="text-sm underline underline-offset-4" href={state.login.authorizationUrl} target="_blank" rel="noreferrer">打开钉钉官方授权页</a>}
        {state.login?.userCode && <p className="text-xs">设备授权码：<span className="font-mono">{state.login.userCode}</span></p>}
        <p className="text-xs text-muted-foreground">用钉钉扫码后完成确认；授权状态会自动更新。二维码到期后可重新发起。</p>
      </section>}
      {state?.login?.status === 'failed' && <ActionError error={state.login.error} />}
      {state?.login?.status === 'failed' && state.login.authorizationUrl && <a className="text-sm underline underline-offset-4" href={state.login.authorizationUrl} target="_blank" rel="noreferrer">打开 CLI 返回的官方授权入口检查权限</a>}
    </CardContent>
  </Card>;
}
