import { describe, expect, it } from 'vitest';
import { extractReviewFindings } from '../../web/components/message/review-findings';

describe('extractReviewFindings', () => {
  it('从审查总评分组里提取可反馈的单条发现', () => {
    const findings = extractReviewFindings(
      [
        '## 严重',
        '- server/a.ts:10 问题：空指针 影响：运行崩溃 修复建议：增加判空',
        '## 一般',
        '1. web/b.tsx:2 问题：重复请求 影响：浪费资源 修复建议：收敛请求入口',
      ].join('\n'),
      [
        {
          text: 'server/a.ts:10 问题：空指针 影响：运行崩溃 修复建议：增加判空',
          feedback: 'up',
        },
      ],
    );

    expect(findings).toEqual([
      {
        id: '严重-0',
        severity: '严重',
        text: 'server/a.ts:10 问题：空指针 影响：运行崩溃 修复建议：增加判空',
        feedback: 'up',
      },
      {
        id: '一般-1',
        severity: '一般',
        text: 'web/b.tsx:2 问题：重复请求 影响：浪费资源 修复建议：收敛请求入口',
        feedback: null,
      },
    ]);
  });

  it('忽略分组下的普通说明文字', () => {
    const findings = extractReviewFindings(['## 建议', '这里是整体说明，不是单条发现。', '- web/a.ts:1 问题：命名不清晰'].join('\n'));

    expect(findings).toHaveLength(1);
    expect(findings[0].text).toBe('web/a.ts:1 问题：命名不清晰');
  });
});
