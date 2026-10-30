import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { dingtalkPerson, dingtalkSearch } from '@shared/dingtalk';
import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { callDingtalkCli } from '@server/shared/dingtalk/dingtalk-cli.service';

export function getCliConnection(id: string) {
  return prisma.dingtalkRobot.findUniqueOrThrow({ where: { id } }).then((connection) => {
    if (!connection.enabled || connection.transport !== 'cli' || !connection.cliProfile) {
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

export function searchDingtalkPeople(id: string, body: unknown) {
  const input = dingtalkSearch.parse(body);
  return getCliConnection(id).then((connection) => callDingtalkCli({ action: 'search', profile: connection.cliProfile, ...input }))
    .then((result) => z.object({ people: z.array(dingtalkPerson), returnedCount: z.number().int() }).parse(result));
}

export function listDingtalkContacts(connectionId: string) {
  return prisma.dingtalkContact.findMany({ where: { connectionId }, orderBy: [{ enabled: 'desc' }, { name: 'asc' }] });
}

export function saveDingtalkContact(connectionId: string, body: unknown) {
  const input = dingtalkSearch.extend({ userId: dingtalkPerson.shape.userId }).parse(body);
  /* 在同一 Profile 下重新解析选中的候选，不接受客户端伪造的姓名或用户 ID。 */
  return getCliConnection(connectionId).then((connection) => searchDingtalkPeople(connectionId, { query: input.query, dimension: input.dimension }).then(({ people }) => {
    const person = people.find((item) => item.userId === input.userId);
    if (!person) throw new HTTPException(409, { message: '人员已不在查询结果中，请重新搜索并选择' });
    return prisma.$transaction((tx) => tx.dingtalkRobot.findUniqueOrThrow({ where: { id: connectionId } }).then((current) => {
      if (!current.enabled || current.updatedAt.getTime() !== connection.updatedAt.getTime()) {
        throw new HTTPException(409, { message: '连接配置已变化，请重新搜索人员' });
      }
      return tx.dingtalkContact.upsert({
        where: { connectionId_userId: { connectionId, userId: person.userId } },
        create: { connectionId, ...person, employeeNo: input.dimension === 'jobNumber' ? input.query : null },
        update: { name: person.name, enabled: true, ...(input.dimension === 'jobNumber' ? { employeeNo: input.query } : {}) },
      });
    }), { isolationLevel: 'Serializable' });
  }));
}

export function updateDingtalkContact(connectionId: string, id: string, body: unknown) {
  const input = z.object({ enabled: z.boolean() }).strict().parse(body);
  return prisma.dingtalkContact.update({ where: { id, connectionId }, data: input });
}
