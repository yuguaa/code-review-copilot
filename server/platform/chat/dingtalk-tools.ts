import { Type } from 'typebox';

import { getCliConnection, listDingtalkCliConnections, listDingtalkContacts, searchDingtalkPeople } from '@server/modules/notifications/dingtalk-directory.service';
import { prepareDingtalkMessageDraft } from '@server/modules/notifications/dingtalk-messages.service';
import { definePiServiceTool } from '@server/platform/agent';
import { requireGlobalDingtalkCli } from '@server/modules/notifications/dingtalk-global.service';

const connectionId = Type.String({ minLength: 1, maxLength: 256 });

export function createDingtalkTools() {
  return [
    definePiServiceTool({ name: 'dingtalk_connections', label: '查询钉钉连接',
      description: '读取全平台唯一共享的钉钉 CLI 登录身份，不返回凭据。未登录时请用户到连接器扫码授权，不接受手填 Profile。',
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: (_input, signal) => requireGlobalDingtalkCli(signal).then(() => listDingtalkCliConnections()),
    }),
    definePiServiceTool({ name: 'dingtalk_contacts', label: '读取钉钉名单',
      description: '读取共享 CLI 已解析的收件人缓存，不是完整通讯录，不要求预先维护名单。新收件人请直接搜索通讯录。',
      parameters: Type.Object({ connectionId }, { additionalProperties: false }),
      execute: ({ connectionId: id }) => getCliConnection(id).then(() => listDingtalkContacts(id))
        .then((contacts) => contacts.filter((contact) => contact.enabled)
          .map(({ id, userId, name, employeeNo }) => ({ id, userId, name, employeeNo }))),
    }),
    definePiServiceTool({ name: 'dingtalk_people_search', label: '搜索钉钉人员',
      description: '通过共享 DWS CLI 按姓名或工号搜索真实钉钉人员。结果只是候选；重名时须询问用户。生成草稿时提供原查询、维度和候选 userId，无需手动维护名单。',
      parameters: Type.Object({ connectionId, query: Type.String({ minLength: 1, maxLength: 100 }),
        dimension: Type.Union([Type.Literal('name'), Type.Literal('jobNumber')]),
      }, { additionalProperties: false }),
      execute: ({ connectionId: id, ...query }, signal) => searchDingtalkPeople(id, query, signal),
    }),
    definePiServiceTool({ name: 'dingtalk_message_draft', label: '准备钉钉消息',
      description: '仅在用户明确要求发钉钉消息时准备待确认的个人私聊草稿，不实际发送。使用搜索得到的 recipient，或已经解析过的 contactIds，二者不能混用。禁止猜测收件人，禁止声称已发送。',
      parameters: Type.Object({ connectionId,
        contactIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 1 })),
        recipient: Type.Optional(Type.Object({ userId: Type.String({ minLength: 1, maxLength: 256 }), query: Type.String({ minLength: 1, maxLength: 100 }),
          dimension: Type.Union([Type.Literal('name'), Type.Literal('jobNumber')]) }, { additionalProperties: false })),
        targetKind: Type.Union([Type.Literal('group'), Type.Literal('direct')]),
        title: Type.String({ minLength: 1, maxLength: 200 }), text: Type.String({ minLength: 1, maxLength: 60_000 }),
      }, { additionalProperties: false }),
      execute: (input, signal) => prepareDingtalkMessageDraft(input, signal).then(({ input: draft, contacts }) => ({
        requiresConfirmation: true as const, draft,
        recipients: contacts.map(({ name, employeeNo }) => ({ name, employeeNo })),
        message: '尚未发送。请点击确认钉钉消息按钮，核对连接、收件人和正文后发送。',
      })),
    }),
  ];
}
