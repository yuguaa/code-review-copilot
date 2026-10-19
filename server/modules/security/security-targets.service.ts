import { Prisma } from "@prisma/client";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { assertUrlInScope } from "@server/platform/security/security-scope";
import {
  securityIdentityInput,
  securityIdentityUpdateInput,
  securityScopeDomains,
  securityTargetInput,
  securityTargetUpdateInput,
} from "./security-input";
import { encryptSecret } from "./security-secret.service";

const securityTargetSelect = {
  id: true,
  repositoryId: true,
  name: true,
  baseUrl: true,
  scopeDomains: true,
  authorizationOwner: true,
  authorizationReference: true,
  authorizedUntil: true,
  scheduleEnabled: true,
  scheduleIntervalMinutes: true,
  nextScheduledAt: true,
  lastScheduledAt: true,
  isActive: true,
  maxDurationMinutes: true,
  defaultAIModelId: true,
  dingtalkRobotId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SecurityTargetSelect;

const securityIdentitySelect = {
  id: true,
  targetId: true,
  name: true,
  role: true,
  username: true,
  secretCiphertext: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SecurityIdentitySelect;

type SecurityTargetRecord = Prisma.SecurityTargetGetPayload<{ select: typeof securityTargetSelect }>;
type SecurityIdentityRecord = Prisma.SecurityIdentityGetPayload<{ select: typeof securityIdentitySelect }>;
const millisecondsPerMinute = 60_000;

export type SecurityTargetView = Omit<SecurityTargetRecord, "scopeDomains"> & { scopeDomains: string[] };
export type SecurityIdentityView = Omit<SecurityIdentityRecord, "secretCiphertext"> & { hasPassword: boolean };

function toSecurityTargetView(record: SecurityTargetRecord): SecurityTargetView {
  return {
    ...record,
    scopeDomains: securityScopeDomains.parse(record.scopeDomains),
  };
}

function toSecurityIdentityView(record: SecurityIdentityRecord): SecurityIdentityView {
  const { secretCiphertext, ...identity } = record;
  return { ...identity, hasPassword: Boolean(secretCiphertext) };
}

export function securityNextScheduledAt(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * millisecondsPerMinute);
}

export function assertSecurityTargetScope(baseUrl: string, scopeDomains: readonly string[]): void {
  assertUrlInScope(baseUrl, scopeDomains);
}

export function listSecurityTargets(): Promise<SecurityTargetView[]> {
  return prisma.securityTarget.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: securityTargetSelect })
    .then((targets) => targets.map(toSecurityTargetView));
}

export function getSecurityTarget(id: string): Promise<SecurityTargetView> {
  return prisma.securityTarget.findUniqueOrThrow({ where: { id }, select: securityTargetSelect }).then(toSecurityTargetView);
}

export function createSecurityTarget(body: unknown): Promise<SecurityTargetView> {
  const input = securityTargetInput.parse(body);
  assertSecurityTargetScope(input.baseUrl, input.scopeDomains);
  const now = new Date();
  return prisma.securityTarget.create({
    data: {
      ...input,
      nextScheduledAt: input.scheduleEnabled ? securityNextScheduledAt(now, input.scheduleIntervalMinutes) : null,
    },
    select: securityTargetSelect,
  }).then(toSecurityTargetView);
}

export function updateSecurityTarget(id: string, body: unknown): Promise<SecurityTargetView> {
  const input = securityTargetUpdateInput.parse(body);
  return prisma.$transaction((transaction) => transaction.securityTarget.findUniqueOrThrow({ where: { id } })
    .then((current) => {
      const scheduleChanged = input.scheduleEnabled !== undefined || input.scheduleIntervalMinutes !== undefined;
      const scheduleEnabled = input.scheduleEnabled ?? current.scheduleEnabled;
      const scheduleIntervalMinutes = input.scheduleIntervalMinutes ?? current.scheduleIntervalMinutes;
      assertSecurityTargetScope(
        input.baseUrl ?? current.baseUrl,
        input.scopeDomains ?? securityScopeDomains.parse(current.scopeDomains),
      );
      return transaction.securityTarget.update({
        where: { id },
        data: {
          ...input,
          ...(scheduleChanged ? {
            nextScheduledAt: scheduleEnabled ? securityNextScheduledAt(new Date(), scheduleIntervalMinutes) : null,
          } : {}),
        },
        select: securityTargetSelect,
      });
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then(toSecurityTargetView);
}

export function deleteSecurityTarget(id: string): Promise<{ success: true }> {
  return prisma.securityTarget.delete({ where: { id } }).then(() => ({ success: true }));
}

export function listSecurityIdentities(targetId: string): Promise<SecurityIdentityView[]> {
  return prisma.securityTarget.findUniqueOrThrow({ where: { id: targetId }, select: { id: true } })
    .then(() => prisma.securityIdentity.findMany({
      where: { targetId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: securityIdentitySelect,
    }))
    .then((identities) => identities.map(toSecurityIdentityView));
}

export function getSecurityIdentity(id: string): Promise<SecurityIdentityView> {
  return prisma.securityIdentity.findUniqueOrThrow({ where: { id }, select: securityIdentitySelect }).then(toSecurityIdentityView);
}

export function createSecurityIdentity(targetId: string, body: unknown): Promise<SecurityIdentityView> {
  const { password, ...input } = securityIdentityInput.parse(body);
  const secretCiphertext = encryptSecret(password);
  return prisma.$transaction((transaction) => transaction.securityTarget.findUniqueOrThrow({ where: { id: targetId }, select: { id: true } })
    .then(() => transaction.securityIdentity.create({
      data: { ...input, targetId, secretCiphertext },
      select: securityIdentitySelect,
    }))).then(toSecurityIdentityView);
}

export function updateSecurityIdentity(id: string, body: unknown): Promise<SecurityIdentityView> {
  const { password, ...input } = securityIdentityUpdateInput.parse(body);
  return prisma.securityIdentity.update({
    where: { id },
    data: {
      ...input,
      ...(password?.trim() ? { secretCiphertext: encryptSecret(password) } : {}),
    },
    select: securityIdentitySelect,
  }).then(toSecurityIdentityView);
}

export function deleteSecurityIdentity(id: string): Promise<{ success: true }> {
  return prisma.securityIdentity.delete({ where: { id } }).then(() => ({ success: true }));
}

export { securityIdentityInput, securityIdentityUpdateInput, securityTargetInput, securityTargetUpdateInput };
