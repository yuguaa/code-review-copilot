import { describe, expect, it } from 'vitest';
import { extractReviewFindings, findingFeedbackPartIndex } from '../../web/components/message/review-findings';
import { extractReviewFileReferences } from '../../shared/review-findings';

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

  it('识别没有具体行号的目录级测试缺口', () => {
    const findings = extractReviewFindings('## 建议\n1. tests/：缺少 FileCenter 覆盖');

    expect(findings).toEqual([
      {
        id: '建议-0',
        severity: '建议',
        text: 'tests/：缺少 FileCenter 覆盖',
        feedback: null,
      },
    ]);
  });

  it('把结构化问题的字段合并为一个可反馈问题', () => {
    const findings = extractReviewFindings([
      '## 一般',
      '1. **请求可控字段未约束直接进入系统提示词**',
      '   - 位置: `src/prompt.py:143`',
      '   - 问题: 请求数据未经校验直接拼接',
      '   - 影响: 调用方可以注入指令',
      '   - 修复建议: 使用固定 Schema',
    ].join('\n'));

    expect(findings).toEqual([
      {
        id: '一般-0',
        severity: '一般',
        text: '请求可控字段未约束直接进入系统提示词',
        feedback: null,
      },
    ]);
  });

  it('不把问题说明里的编号和字段拆成独立 finding', () => {
    const findings = extractReviewFindings([
      '## 建议',
      'src/workflow.py:2340 - compact 触发条件变更',
      '1. 默认配置下第 2 次尝试会启用 compact',
      '2. 高重试配置只在最后一次启用 compact',
      '- 影响：可能改变输出策略',
      '- 修复建议：确认行为是否符合预期',
    ].join('\n'));

    expect(findings).toEqual([]);
  });

  it('有 Verify 结论时只选择最终结论文本块反馈', () => {
    const parts = [
      { type: 'text', text: '## 一般\n- src/draft.ts:1 问题：草稿问题' },
      { type: 'text', text: '## Verify 结论\n## 一般\n1. **最终确认的问题**\n   - 位置: `src/final.ts:2`\n   - 问题: 确认存在缺陷' },
    ] as Parameters<typeof findingFeedbackPartIndex>[0];

    expect(findingFeedbackPartIndex(parts)).toBe(1);
  });
});

describe('extractReviewFileReferences', () => {
  it('提取中文分隔的全部代码位置并去重', () => {
    expect(extractReviewFileReferences(
      'src/api/files.py:56、src/api/files.py:118、docker-compose.yml:57，src/api/files.py:56',
    )).toEqual([
      { path: 'src/api/files.py', line: 56 },
      { path: 'src/api/files.py', line: 118 },
      { path: 'docker-compose.yml', line: 57 },
    ]);
  });
});
