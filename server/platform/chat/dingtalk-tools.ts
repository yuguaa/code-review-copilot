import { Type } from 'typebox';

import { getCliConnection, listDingtalkCliConnections, listDingtalkContacts, searchDingtalkPeople } from '@server/modules/notifications/dingtalk-directory.service';
import { prepareDingtalkMessageDraft } from '@server/modules/notifications/dingtalk-messages.service';
import { definePiServiceTool } from '@server/platform/agent';

const connectionId = Type.String({ minLength: 1, maxLength: 256 });

export function createDingtalkTools() {
  return [
    definePiServiceTool({ name: 'dingtalk_connections', label: '查询钉钉连接',
      description: '列出已启用且配置完整的钉钉 CLI 连接，不返回凭据。多个连接必须让用户明确选择，禁止默认选第一个。',
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: () => listDingtalkCliConnections(),
    }),
    definePiServiceTool({ name: 'dingtalk_contacts', label: '读取钉钉名单',
      description: '读取指定 CLI 连接的启用人员名单。发送草稿的 contactIds 只能来自此连接返回的名单 id，不是工号或 GitLab ID。',
      parameters: Type.Object({ connectionId }, { additionalProperties: false }),
      execute: ({ connectionId: id }) => getCliConnection(id).then(() => listDingtalkContacts(id))
        .then((contacts) => contacts.filter((contact) => contact.enabled)
          .map(({ id, userId, name, employeeNo }) => ({ id, userId, name, employeeNo }))),
    }),
    definePiServiceTool({ name: 'dingtalk_people_search', label: '搜索钉钉人员',
      description: '通过配置的 DWS CLI 按姓名或工号搜索真实钉钉人员。结果只是候选；重名时须询问用户，未入名单的候选须由用户在发送弹窗中选择保存。',
      parameters: Type.Object({ connectionId, query: Type.String({ minLength: 1, maxLength: 100 }),
        dimension: Type.Union([Type.Literal('name'), Type.Literal('jobNumber')]),
      }, { additionalProperties: false }),
      execute: ({ connectionId: id, ...query }, signal) => searchDingtalkPeople(id, query, signal),
    }),
    definePiServiceTool({ name: 'dingtalk_message_draft', label: '准备钉钉消息',
      description: '仅在用户明确要求发钉钉消息时准备待确认草稿，不实际发送。contactIds 必须来自所选连接的启用名单，不能猜测。用户仍需在平台按钮核对并确认发送，禁止声称已发送。',
      parameters: Type.Object({ connectionId,
        contactIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 20 }),
        targetKind: Type.Union([Type.Literal('group'), Type.Literal('direct')]),
        title: Type.String({ minLength: 1, maxLength: 200 }), text: Type.String({ minLength: 1, maxLength: 60_000 }),
      }, { additionalProperties: false }),
      execute: (input) => prepareDingtalkMessageDraft(input).then(({ input: draft, contacts }) => ({
        requiresConfirmation: true as const, draft,
        recipients: contacts.map(({ name, employeeNo }) => ({ name, employeeNo })),
        message: '尚未发送。请点击确认钉钉消息按钮，核对连接、收件人和正文后发送。',
      })),
    }),
  ];
}
