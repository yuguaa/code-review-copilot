import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { withVerifiedReviewText } from './review-verify';

describe('withVerifiedReviewText', () => {
  it('用 verified 文本替换最后一条 assistant 结论', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '未验证草稿' },
          { type: 'tool-bash', state: 'output-available', toolCallId: 'tool-1', input: {}, output: 'ok' } as UIMessage['parts'][number],
        ],
      },
    ];

    expect(withVerifiedReviewText(messages, 'verified 总评')).toEqual([
      messages[0],
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'verified 总评' }] },
    ]);
  });

  it('没有 assistant 消息时追加 verified 结论', () => {
    const result = withVerifiedReviewText([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] }], 'verified 总评');

    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('assistant');
    expect(result[1].parts).toEqual([{ type: 'text', text: 'verified 总评' }]);
  });
});
