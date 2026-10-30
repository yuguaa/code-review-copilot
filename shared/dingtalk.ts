import { z } from 'zod';

export const dingtalkId = z.string().trim().min(1).max(256).regex(/^[^\s,@\u0000]+$/, '请输入单个钉钉 ID');
export const dingtalkProfile = z.string().trim().regex(/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/, 'Profile 必须为 corpId:userId');
export const dingtalkText = z.string().trim().min(1).max(60_000);
export const dingtalkSearch = z.object({ query: z.string().trim().min(1).max(100), dimension: z.enum(['name', 'jobNumber']) }).strict();
export const dingtalkPerson = z.object({ userId: dingtalkId, name: z.string().min(1).max(256), employeeNo: z.string().optional() });
export const dingtalkMessageDraft = z.object({
  connectionId: z.string().min(1),
  profile: dingtalkProfile.optional(),
  contactIds: z.array(z.string().min(1)).max(20).transform((ids) => [...new Set(ids)].sort()),
  targetKind: z.enum(['group', 'direct']), title: z.string().trim().min(1).max(200), text: dingtalkText,
}).strict();
export const dingtalkCliRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('auth-status') }).strict(),
  z.object({ action: z.literal('login-start') }).strict(),
  z.object({ action: z.literal('login-state') }).strict(),
  z.object({ action: z.literal('login-cancel'), loginId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('status'), profile: dingtalkProfile }).strict(),
  z.object({ action: z.literal('search'), profile: dingtalkProfile, ...dingtalkSearch.shape }).strict(),
  z.object({ action: z.literal('send'), profile: dingtalkProfile, robotCode: dingtalkId,
    groupId: dingtalkId.optional(), userIds: z.array(dingtalkId).max(20),
    title: z.string().trim().min(1).max(200), text: dingtalkText,
  }).strict(),
  z.object({ action: z.literal('send-user'), profile: dingtalkProfile, userId: dingtalkId,
    title: z.string().trim().min(1).max(200), text: dingtalkText, idempotencyKey: z.string().min(1).max(200),
  }).strict(),
]);

export const dingtalkAuthStatus = z.object({ authenticated: z.boolean(), tokenValid: z.boolean(), profile: dingtalkProfile.nullable(),
  userName: z.string().nullable(), corpName: z.string().nullable(), reason: z.string().nullable() });
export const dingtalkLoginState = z.object({ id: z.string().uuid(), status: z.enum(['pending', 'completed', 'failed', 'cancelled']),
  authorizationUrl: z.string().url().nullable(), userCode: z.string().nullable(), expiresAt: z.string(), error: z.string().nullable() });

export type DingtalkPerson = z.infer<typeof dingtalkPerson>;
export type DingtalkCliRequest = z.infer<typeof dingtalkCliRequest>;
export type DingtalkMessageDraft = z.infer<typeof dingtalkMessageDraft>;
export type DingtalkAuthStatus = z.infer<typeof dingtalkAuthStatus>;
export type DingtalkLoginState = z.infer<typeof dingtalkLoginState>;
export type DingtalkGlobalState = { connection: { id: string; enabled: boolean }; auth: DingtalkAuthStatus;
  login: DingtalkLoginState | null; qrCode: string | null };
