import { z } from 'zod';

import { dingtalkCliRequest, dingtalkMessageReceipt, dingtalkPerson } from '@shared/dingtalk';
import { executeProcess } from '@server/infrastructure/process/process.service';

import type { DingtalkCliRequest } from '@shared/dingtalk';

export function dwsEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8',
    DWS_CONFIG_DIR: process.env.DWS_CONFIG_DIR, DWS_KEYCHAIN_DIR: process.env.DWS_KEYCHAIN_DIR, DWS_NO_UPDATE_CHECK: '1' };
}

export function buildDwsCommand(input: DingtalkCliRequest): { args: string[]; stdin?: string } {
  const request = dingtalkCliRequest.parse(input);
  if (request.action === 'auth-status') return { args: ['auth', 'status', '--format=json', '--timeout=30'] };
  if (request.action === 'login-start' || request.action === 'login-state' || request.action === 'login-cancel') throw new Error('登录须由 Worker 登录生命周期管理');
  const common = [`--profile=${request.profile}`, '--format=json', '--timeout=30'];
  if (request.action === 'status') return { args: ['auth', 'status', ...common] };
  if (request.action === 'search') return { args: ['aisearch', 'person', `--query=${request.query}`, `--dimension=${request.dimension}`, ...common] };
  if (request.action === 'person') return { args: ['contact', 'user', 'get', `--ids=${request.userId}`, ...common] };
  if (request.action === 'send-user') throw new Error('个人私聊已停用，审查通知仅支持机器人群消息');
  if (request.action === 'message-user') return { args: ['chat', '+messages-send', '--as=user', `--user=${request.userId}`,
    '--msg-type=text', '--text=-', '--body-stdin', '--wait-delivery', `--idempotency-key=${request.idempotencyKey}`, '--yes', ...common], stdin: request.text };
  if (!request.groupId) throw new Error('审查通知必须指定机器人群，不支持私聊');
  const mentions = request.groupId && request.userIds.length ? request.userIds.map((id) => `@${id}`).join(' ') + '\n\n' : '';
  return { args: ['chat', '+messages-send', '--as=bot', `--robot-code=${request.robotCode}`,
    `--group=${request.groupId}`, ...(request.userIds.length ? [`--at-user-ids=${request.userIds.join(',')}`] : []),
    `--title=${request.title}`, '--markdown=-', '--body-stdin', '--yes', ...common], stdin: mentions + request.text };
}

export function parseDwsResult(request: DingtalkCliRequest, value: unknown) {
  if (request.action === 'login-start' || request.action === 'login-state' || request.action === 'login-cancel') throw new Error('登录须由 Worker 登录生命周期管理');
  if (request.action === 'status' || request.action === 'auth-status') {
    const status = z.object({ authenticated: z.boolean(), token_valid: z.boolean().optional(),
      corp_id: z.string().optional(), user_id: z.string().optional(),
      user_name: z.string().optional(), corp_name: z.string().optional(), reason: z.string().optional() }).parse(value);
    return { authenticated: status.authenticated, tokenValid: status.token_valid ?? false,
      ...(request.action === 'auth-status' ? { profile: status.corp_id && status.user_id ? `${status.corp_id}:${status.user_id}` : null } : {}),
      userName: status.user_name ?? null, corpName: status.corp_name ?? null, reason: status.reason ?? null };
  }
  if (request.action === 'search') {
    const response = z.object({ success: z.literal(true), result: z.array(z.object({
      userId: z.string().min(1), title: z.string().min(1), jobNumber: z.string().optional(),
    }).passthrough()), searchEvidence: z.object({ returnedCandidateCount: z.number().int() }).optional() }).parse(value);
    return { people: response.result.map((person) => dingtalkPerson.parse({ userId: person.userId, name: person.title,
      ...(person.jobNumber ? { employeeNo: person.jobNumber } : {}) })),
      returnedCount: response.searchEvidence?.returnedCandidateCount ?? response.result.length };
  }
  if (request.action === 'person') {
    const response = z.object({ success: z.literal(true), result: z.array(z.object({ orgEmployeeModel: z.object({
      orgUserId: dingtalkPerson.shape.userId, orgUserName: dingtalkPerson.shape.name, jobNumber: z.string().nullish(),
    }) })).length(1) }).parse(value);
    const person = response.result[0].orgEmployeeModel;
    if (person.orgUserId !== request.userId) throw new Error('DWS 返回的人员与指定 userId 不一致');
    return dingtalkPerson.parse({ userId: person.orgUserId, name: person.orgUserName,
      ...(person.jobNumber ? { employeeNo: person.jobNumber } : {}) });
  }
  if (request.action === 'send-user') throw new Error('个人私聊已停用');
  if (request.action === 'message-user') {
    const receipt = z.object({ openMessageId: z.string(), conversationId: z.string(), deliveryStatus: z.enum(['delivered', 'unknown']),
      idempotencyKey: z.literal(request.idempotencyKey), dry_run: z.never().optional() }).parse(value);
    if (receipt.deliveryStatus === 'delivered' && !receipt.openMessageId.trim()) throw new Error('DWS 送达回执缺少消息 ID，请勿重发');
    return dingtalkMessageReceipt.parse({ status: receipt.deliveryStatus, remoteIds: receipt.openMessageId ? [receipt.openMessageId] : [],
      conversationId: receipt.conversationId, idempotencyKey: receipt.idempotencyKey });
  }
  const response = z.object({ ok: z.literal(true), identity: z.literal('bot'), tool: z.string(),
    result: z.unknown(), dry_run: z.never().optional() }).parse(value);
  const result = z.object({ success: z.boolean().optional(), processQueryKey: z.string().optional() }).passthrough().parse(response.result);
  const expectedTool = request.groupId ? 'send_robot_group_message' : 'batch_send_robot_msg_to_users';
  if (response.tool !== expectedTool) throw new Error('DWS 返回的发送目标类型不匹配');
  if (result.success === false) throw new Error('DWS 拒绝发送');
  return { status: 'accepted' as const, remoteIds: result.processQueryKey ? [result.processQueryKey] : [] };
}

export function runDws(request: DingtalkCliRequest) {
  const { args, stdin } = buildDwsCommand(request);
  return executeProcess(process.env.DWS_BIN || 'dws', args, {
    stdin, timeoutMs: 50_000, maxBytes: 2 * 1024 * 1024,
    env: dwsEnvironment(),
  }).then((result) => {
    if (result.error || result.code !== 0) {
      /* CLI 输出可能包含正文或凭据，只向平台返回稳定错误码。 */
      let reason = result.error ? 'process_timeout' : 'cli_failed';
      try {
        const error = z.object({ error: z.object({ reason: z.string().regex(/^[a-z_]+$/).optional() }) }).parse(JSON.parse(result.stderr));
        reason = error.error.reason ?? reason;
      } catch { /* 非结构化错误不透传。 */ }
      throw new Error(`DWS 调用失败：${reason}`);
    }
    return parseDwsResult(request, JSON.parse(result.stdout));
  });
}
