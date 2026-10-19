import { describe, expect, it } from 'vitest';

import { buildPathIds, buildSessionMessageTree, deriveChatTitle, pickLatestLeafId } from './session-message-store.service';

import type { MessageRow } from './session-message-store.service';

function row(id: string, parentId: string | null, role = 'assistant'): MessageRow {
  return { id, parentId, role, parts: [{ type: 'text', text: id }], createdAt: new Date() };
}

describe('消息分支', () => {
  const rows = [row('root', null, 'user'), row('a1', 'root'), row('u2', 'a1', 'user'), row('a2', 'u2'), row('a3', 'u2')];

  it('保留所有节点，同时按父子顺序返回选中分支', () => {
    const tree = buildSessionMessageTree(rows, 'a2');
    expect(tree.activePathIds).toEqual(['root', 'a1', 'u2', 'a2']);
    expect(tree.messages.map((message) => message.id)).toEqual(tree.activePathIds);
    expect(tree.messageTree).toHaveLength(5);
    expect(tree.messageTree.find((message) => message.id === 'a2')).toMatchObject({ siblingIds: ['a2', 'a3'], siblingIndex: 0, siblingCount: 2, active: true });
    expect(tree.messageTree.find((message) => message.id === 'a3')?.active).toBe(false);
  });

  it('选中父消息时进入其最新回答分支', () => {
    expect(pickLatestLeafId(rows, 'a1')).toBe('a3');
    expect(buildSessionMessageTree(rows, 'a1').activeLeafMessageId).toBe('a3');
  });

  it('父节点缺失、循环及无效的当前消息立即失败', () => {
    expect(() => buildPathIds([row('a', 'missing')], 'a')).toThrow('父节点不存在');
    expect(() => buildPathIds([row('a', 'b'), row('b', 'a')], 'a')).toThrow('循环');
    expect(() => pickLatestLeafId([row('a', 'b'), row('b', 'a')], 'a')).toThrow('循环');
    expect(() => buildSessionMessageTree(rows, 'unknown')).toThrow('当前分支消息不存在');
  });

  it('空消息树返回空分支', () => {
    expect(buildSessionMessageTree([], null)).toEqual({ messages: [], messageTree: [], activeLeafMessageId: null, activePathIds: [] });
  });

  it('标题只使用用户文本并保留长度限制', () => {
    expect(deriveChatTitle([{ id: 'a', role: 'assistant', parts: [{ type: 'text', text: '报告' }] }])).toBeNull();
    expect(deriveChatTitle([{ id: 'u', role: 'user', parts: [{ type: 'text', text: '请\n 解释问题' }] }])).toBe('请 解释问题');
  });
});
