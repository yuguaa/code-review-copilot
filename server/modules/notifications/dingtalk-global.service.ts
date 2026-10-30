import { randomUUID } from 'node:crypto';

import { HTTPException } from 'hono/http-exception';
import QRCode from 'qrcode';
import { z } from 'zod';

import { dingtalkAuthStatus, dingtalkLoginState } from '@shared/dingtalk';
import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { callDingtalkCli } from '@server/shared/dingtalk/dingtalk-cli.service';

export function ensureGlobalDingtalkCli() {
  return prisma.dingtalkRobot.upsert({ where: { cliSingleton: true }, update: {},
    create: { name: '平台共享钉钉 CLI', transport: 'cli', cliSingleton: true, enabled: false } });
}

export function getGlobalDingtalkState(signal?: AbortSignal) {
  return ensureGlobalDingtalkCli().then((connection) => callDingtalkCli({ action: 'login-state' }, signal)
    .then((body) => dingtalkLoginState.nullable().parse(body)).then((login) => {
      const clearFinishedIntent = login && (login.status === 'failed' || login.status === 'cancelled')
        ? prisma.dingtalkRobot.updateMany({ where: { id: connection.id, cliLoginId: login.id, cliEnableAfterLogin: true }, data: { cliEnableAfterLogin: false } })
        : Promise.resolve();
      const authentication = clearFinishedIntent.then(() => login?.status === 'pending'
        ? Promise.resolve({ authenticated: false, tokenValid: false, profile: null, userName: null, corpName: null, reason: 'login_pending' })
        : callDingtalkCli({ action: 'auth-status' }, signal).then((body) => dingtalkAuthStatus.parse(body)));
      return authentication.then((auth) => {
        const sync = auth.authenticated && auth.tokenValid && auth.profile
          ? prisma.$transaction((tx) => tx.$queryRaw`SELECT id FROM dingtalk_robots WHERE id = ${connection.id} FOR UPDATE`
            .then(() => tx.dingtalkRobot.findUniqueOrThrow({ where: { id: connection.id } }))
            .then((current) => {
              if (current.cliLoginId !== connection.cliLoginId
                || (current.cliProfile !== connection.cliProfile && current.cliProfile !== auth.profile)) {
                throw new HTTPException(409, { message: '钉钉登录状态已变化，请刷新后重试' });
              }
              const completedLogin = login?.status === 'completed' && current.cliLoginId === login.id && current.cliEnableAfterLogin;
              const changedIdentity = current.cliProfile !== auth.profile;
              if (!completedLogin && !changedIdentity) return current;
              return (changedIdentity ? tx.dingtalkContact.updateMany({ where: { connectionId: connection.id }, data: { enabled: false, employeeNo: null } }) : Promise.resolve())
                .then(() => tx.dingtalkRobot.update({ where: { id: connection.id }, data: { cliProfile: auth.profile,
                  ...(completedLogin ? { cliEnableAfterLogin: false, enabled: true } : {}) } }));
            }), { maxWait: 10000, timeout: 10000 })
          : Promise.resolve(connection);
        return sync.then((current) => (login?.status === 'pending' && login.authorizationUrl
          ? QRCode.toDataURL(login.authorizationUrl, { width: 240, margin: 2 }) : Promise.resolve(null))
          .then((qrCode) => ({ connection: { id: current.id, enabled: current.enabled }, auth, login, qrCode })));
      });
    }));
}

export function startGlobalDingtalkLogin() {
  const operationId = randomUUID();
  return ensureGlobalDingtalkCli().then((connection) => prisma.dingtalkRobot.update({ where: { id: connection.id },
    data: { cliLoginId: operationId, cliEnableAfterLogin: true, enabled: false } }).then(() => callDingtalkCli({ action: 'login-start' })
      .then((body) => dingtalkLoginState.parse(body)).then((login) => {
        if (login.status !== 'pending') throw new HTTPException(409, { message: '上次登录仍在结束，请稍后重试' });
        /* 关闭通知或新发起登录后，迟到的 Worker 响应不能恢复旧的启用意图。 */
        return prisma.dingtalkRobot.updateMany({ where: { id: connection.id, cliLoginId: operationId, cliEnableAfterLogin: true },
          data: { cliLoginId: login.id } });
      }).catch((error: unknown) => prisma.dingtalkRobot.updateMany({ where: { id: connection.id, cliLoginId: operationId },
        data: { cliEnableAfterLogin: false } }).then(() => { throw error; })))).then(() => getGlobalDingtalkState());
}

export function cancelGlobalDingtalkLogin(body: unknown) {
  const { loginId } = z.object({ loginId: z.string().uuid() }).strict().parse(body);
  return callDingtalkCli({ action: 'login-cancel', loginId }).then(() => prisma.dingtalkRobot.updateMany({
    where: { cliSingleton: true, cliLoginId: loginId }, data: { cliEnableAfterLogin: false },
  })).then(() => getGlobalDingtalkState());
}

export function updateGlobalDingtalk(body: unknown) {
  const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(body);
  return ensureGlobalDingtalkCli().then((row) => prisma.dingtalkRobot.update({ where: { id: row.id }, data: { enabled, cliEnableAfterLogin: false } }))
    .then(() => getGlobalDingtalkState());
}

export function requireGlobalDingtalkCli(signal?: AbortSignal) {
  return getGlobalDingtalkState(signal).then((state) => {
    if (!state.auth.authenticated || !state.auth.tokenValid || !state.auth.profile) throw new HTTPException(409, { message: '请先扫码登录并完成钉钉 CLI 授权' });
    if (!state.connection.enabled) throw new HTTPException(409, { message: '平台共享钉钉 CLI 已停用' });
    return { id: state.connection.id, profile: state.auth.profile };
  });
}
