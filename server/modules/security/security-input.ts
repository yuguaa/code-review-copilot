import { z } from "zod";

import { httpUrl, positiveInteger } from "../settings/config-input";

const identifier = z.string().trim().min(1).max(200);
const optionalIdentifier = identifier.nullable().optional();
const shortText = z.string().trim().min(1).max(200);
const authorizationText = z.string().trim().min(1).max(1000);
const isoDateTime = z.string().trim().datetime({ offset: true }).transform((value) => new Date(value));

const scopeDomain = z.string().trim().min(1).max(253).refine((value) => {
  const normalized = value.toLowerCase();
  if (normalized.includes("://") || /[/\\?#@]/.test(normalized) || normalized.startsWith(".")) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)
    || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized);
}, "测试范围域名格式无效");

export const securityScopeDomains = z.array(scopeDomain).min(1).max(1000)
  .transform((domains) => [...new Set(domains.map((domain) => domain.toLowerCase()))]);

export const securityTargetInput = z.object({
  name: shortText,
  baseUrl: httpUrl,
  repositoryId: optionalIdentifier,
  scopeDomains: securityScopeDomains,
  authorizationOwner: authorizationText,
  authorizationReference: authorizationText,
  authorizedUntil: isoDateTime,
  scheduleEnabled: z.boolean().default(false),
  scheduleIntervalMinutes: positiveInteger.default(1440),
  isActive: z.boolean().default(true),
  maxDurationMinutes: positiveInteger.default(30),
  defaultAIModelId: optionalIdentifier,
  dingtalkRobotId: optionalIdentifier,
}).strict();

export const securityTargetUpdateInput = securityTargetInput.partial().strict();

export const securityIdentityInput = z.object({
  name: shortText,
  role: z.string().trim().min(1).max(100).default("user"),
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(4096),
  isActive: z.boolean().default(true),
}).strict();

export const securityIdentityUpdateInput = z.object({
  name: shortText.optional(),
  role: z.string().trim().min(1).max(100).optional(),
  username: z.string().trim().min(1).max(256).optional(),
  password: z.string().max(4096).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const securityTicketInput = z.object({
  targetId: identifier,
}).strict();

export const securityExecutionInput = z.object({
  ticketId: identifier,
  agentSessionId: optionalIdentifier,
  traceId: optionalIdentifier,
}).strict();

export const securityActiveTicketStatuses = ["queued", "running", "cancelling"] as const;
export const securityTerminalTicketStatuses = ["completed", "failed", "cancelled", "interrupted"] as const;
export const securityTicketStatus = z.enum([...securityActiveTicketStatuses, ...securityTerminalTicketStatuses] as const);
export const securityTicketFinishStatus = z.enum(securityTerminalTicketStatuses);
export const securityExecutionFinishStatus = z.enum(securityTerminalTicketStatuses);

export const securityTicketFinishInput = z.object({
  status: securityTicketFinishStatus,
  error: z.string().max(20_000).nullable().optional(),
  report: z.string().max(2_000_000).nullable().optional(),
  summary: z.string().max(20_000).nullable().optional(),
  riskScore: z.number().int().min(0).max(100).nullable().optional(),
  modelProvider: z.string().trim().min(1).max(100).nullable().optional(),
  modelId: z.string().trim().min(1).max(200).nullable().optional(),
  skillVersion: z.string().trim().min(1).max(100).nullable().optional(),
}).strict();

export const securityExecutionFinishInput = z.object({
  status: securityExecutionFinishStatus,
  error: z.string().max(20_000).nullable().optional(),
  rawResult: z.unknown().optional(),
}).strict();

export const securityEventInput = z.object({
  ticketId: identifier,
  executionId: optionalIdentifier,
  type: z.string().trim().regex(/^[A-Za-z0-9_.:-]{1,100}$/, "事件类型格式无效"),
  message: z.string().trim().min(1).max(20_000),
  data: z.unknown().optional(),
}).strict();

export type SecurityTargetInput = z.infer<typeof securityTargetInput>;
export type SecurityTargetUpdateInput = z.infer<typeof securityTargetUpdateInput>;
export type SecurityIdentityInput = z.infer<typeof securityIdentityInput>;
export type SecurityIdentityUpdateInput = z.infer<typeof securityIdentityUpdateInput>;
export type SecurityTicketFinishInput = z.infer<typeof securityTicketFinishInput>;
export type SecurityExecutionFinishInput = z.infer<typeof securityExecutionFinishInput>;
