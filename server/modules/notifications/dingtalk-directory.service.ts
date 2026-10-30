import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { dingtalkPerson, dingtalkSearch } from '@shared/dingtalk';
import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { dingtalkConnectionConfigured } from '@server/modules/settings/dingtalk-robot-settings.service';
import { callDingtalkCli } from '@server/shared/dingtalk/dingtalk-cli.service';
import { requireGlobalDingtalkCli } from './dingtalk-global.service';

export function listDingtalkCliConnections() {
  return prisma.dingtalkRobot.findMany({ where: { enabled: true, transport: 'cli', cliSingleton: true }, orderBy: { name: 'asc' },
    select: { id: true, name: true, transport: true, webhookUrl: true, cliProfile: true, cliRobotCode: true, cliGroupId: true },
  }).then((connections) => connections.filter(dingtalkConnectionConfigured)
    .map(({ id, name, cliProfile, cliGroupId }) => ({ id, name, cliProfile, cliGroupId })));
}

export function getCliConnection(id: string, signal?: AbortSignal) {
  return requireGlobalDingtalkCli(signal).then((global) => {
    if (global.id !== id) throw new HTTPException(400, { message: '只能使用平台共享 CLI' });
    return prisma.dingtalkRobot.findUniqueOrThrow({ where: { id } });
  }).then((connection) => {
    if (!connection.enabled || connection.transport !== 'cli' || !connection.cliSingleton || !connection.cliProfile) {
      throw new HTTPException(400, { message: '请选择已启用的钉钉 CLI 连接' });
    }
    return { ...connection, cliProfile: connection.cliProfile };
  });
}

export function checkDingtalkConnection(id: string) {
  return getCliConnection(id).then((connection) => callDingtalkCli({ action: 'status', profile: connection.cliProfile }))
    .then((body) => z.object({ authenticated: z.boolean(), tokenValid: z.boolean(),
      userName: z.string().nullable(), corpName: z.string().nullable(), reason: z.string().nullable() }).parse(body));
}

export function searchDingtalkPeople(id: string, body: unknown, signal?: AbortSignal) {
  const input = dingtalkSearch.parse(body);
  return getCliConnection(id, signal).then((connection) => callDingtalkCli({ action: 'search', profile: connection.cliProfile, ...input }, signal))
    .then((result) => z.object({ people: z.array(dingtalkPerson), returnedCount: z.number().int() }).parse(result));
}

export function listDingtalkContacts(connectionId: string) {
  return getCliConnection(connectionId).then((connection) => prisma.dingtalkContact.findMany({ where: { connectionId, cliProfile: connection.cliProfile, enabled: true }, orderBy: { name: 'asc' } }));
}

export function saveDingtalkContact(connectionId: string, body: unknown, signal?: AbortSignal) {
  const input = dingtalkSearch.extend({ userId: dingtalkPerson.shape.userId }).parse(body);
  /* 在同一 Profile 下重新解析选中的候选，不接受客户端伪造的姓名或用户 ID。 */
  return getCliConnection(connectionId, signal).then((connection) => searchDingtalkPeople(connectionId, { query: input.query, dimension: input.dimension }, signal).then(({ people }) => {
    const person = people.find((item) => item.userId === input.userId);
    if (!person) throw new HTTPException(409, { message: '人员已不在查询结果中，请重新搜索并选择' });
    return prisma.$transaction((tx) => tx.dingtalkRobot.findUniqueOrThrow({ where: { id: connectionId } }).then((current) => {
      if (!current.enabled || current.updatedAt.getTime() !== connection.updatedAt.getTime()) {
        throw new HTTPException(409, { message: '连接配置已变化，请重新搜索人员' });
      }
      return tx.dingtalkContact.upsert({
        where: { connectionId_userId: { connectionId, userId: person.userId } },
        create: { connectionId, ...person, cliProfile: connection.cliProfile, employeeNo: input.dimension === 'jobNumber' ? input.query : null },
        update: { name: person.name, enabled: true, cliProfile: connection.cliProfile, ...(input.dimension === 'jobNumber' ? { employeeNo: input.query } : {}) },
      });
    }), { isolationLevel: 'Serializable' });
  }));
}

export function updateDingtalkContact(connectionId: string, id: string, body: unknown) {
  const input = z.object({ enabled: z.boolean() }).strict().parse(body);
  return prisma.dingtalkContact.update({ where: { id, connectionId }, data: input });
}
