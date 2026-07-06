import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { VERIFY_INSTRUCTIONS, withVerifiedReviewText } from './review-verify';

describe('withVerifiedReviewText', () => {
  it('保留最后一条 assistant 的全部 parts 并追加 verified 结论', () => {
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
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: '未验证草稿' },
          { type: 'tool-bash', state: 'output-available', toolCallId: 'tool-1', input: {}, output: 'ok' } as UIMessage['parts'][number],
          { type: 'text', text: '## Verify 结论\nverified 总评' },
        ],
      },
    ]);
  });

  it('没有 assistant 消息时追加 verified 结论', () => {
    const result = withVerifiedReviewText([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '请审查' }] }], 'verified 总评');

    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('assistant');
    expect(result[1].parts).toEqual([{ type: 'text', text: '## Verify 结论\nverified 总评' }]);
  });
});

describe('VERIFY_INSTRUCTIONS', () => {
  it('只把阈值反馈沉淀作为复核依据', () => {
    expect(VERIFY_INSTRUCTIONS).toContain('用户反馈阈值沉淀');
    expect(VERIFY_INSTRUCTIONS).toContain('单次 findingFeedbacks 不是可采信证据');
  });

  it('要求对照审查蓝图与运行期 CodeMem', () => {
    expect(VERIFY_INSTRUCTIONS).toContain('审查蓝图');
    expect(VERIFY_INSTRUCTIONS).toContain('运行期 CodeMem');
    expect(VERIFY_INSTRUCTIONS).toContain('不能替代代码取证');
  });
});
