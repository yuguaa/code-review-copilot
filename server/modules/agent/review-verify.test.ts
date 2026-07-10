import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { parseReviewFindings } from '../../../shared/review-findings';
import {
  assertReviewDraftIsDecidable,
  buildVerifiedReview,
  VERIFY_INSTRUCTIONS,
  withVerifiedReviewText,
} from './review-verify';

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

  it('要求通过完成工具提交最终结论', () => {
    expect(VERIFY_INSTRUCTIONS).toContain('submit_verified_review');
    expect(VERIFY_INSTRUCTIONS).toContain('普通文本不会被当作完成结果');
    expect(VERIFY_INSTRUCTIONS).toContain('每个 findingId');
    expect(VERIFY_INSTRUCTIONS).toContain('反证');
  });
});

describe('buildVerifiedReview', () => {
  const evidence = [
    { id: '00000000-0000-4000-8000-000000000001', path: 'src/api/files.py', line: 56, claim: '调用了不存在的函数', sourceLine: 'service.upload_file(...)' },
    { id: '00000000-0000-4000-8000-000000000002', path: 'src/files/repository.py', line: 25, claim: '当前查询已使用 schema 中存在的 location 字段', sourceLine: 'location = row["location"]' },
    { id: '00000000-0000-4000-8000-000000000003', path: 'src/files/service.py', line: 68, claim: '先写磁盘', sourceLine: 'await storage.write(...)' },
    { id: '00000000-0000-4000-8000-000000000004', path: 'src/api/files.py', line: 56, claim: '路由实际调用已导出的批量上传函数', sourceLine: 'service.upload_files(...)' },
  ];
  const draftFindings = parseReviewFindings([
    '## 审查总评',
    '健康评分：38/100。',
    '## 严重',
    '1. src/api/files.py:56：API 调用了不存在的 service 函数',
    'Symptom：首次请求会触发 AttributeError。',
    'Consequence：核心文件接口返回 500。',
    'Remedy：统一 API 与 service 合同。',
    '2. src/files/repository.py:25：repository 与表结构不匹配',
    'Consequence：插入文件记录会失败。',
    'Remedy：字段级对齐 schema。',
    '## 一般',
    '未发现一般问题。',
    '## 建议',
    '暂无。',
  ].join('\n'));

  it('严重问题确认后由后端保留，不能生成无问题结论', () => {
    const markdown = buildVerifiedReview({
      decisions: [
        {
          findingId: '严重-0',
          verdict: 'confirmed',
          finalFinding: {
            title: 'API 与 service 合同不一致',
            problem: '路由调用了不存在的 upload_file',
            impact: '上传接口首次调用返回 500',
            remedy: '统一路由与 service 导出名称',
            evidenceIds: [evidence[0].id],
          },
        },
        {
          findingId: '严重-1',
          verdict: 'rejected',
          reason: '当前迁移已经补齐对应字段',
          evidenceIds: [evidence[1].id],
        },
      ],
      additionalFindings: [],
    }, draftFindings, evidence);

    expect(markdown).toContain('复核确认 1 个问题，排除 1 个');
    expect(markdown).toContain('API 与 service 合同不一致');
    expect(markdown).toContain('## 核验排除');
    expect(markdown).toContain('当前迁移已经补齐对应字段');
    expect(markdown).not.toContain('未发现需要阻塞的实质问题');
  });

  it('拒绝漏掉主审查问题的裁决', () => {
    expect(() => buildVerifiedReview({
      decisions: [
        {
          findingId: '严重-0',
          verdict: 'confirmed',
          finalFinding: {
            title: '合同不一致',
            problem: '函数不存在',
            impact: '请求失败',
            remedy: '统一合同',
            evidenceIds: [evidence[0].id],
          },
        },
      ],
      additionalFindings: [],
    }, draftFindings, evidence)).toThrow('遗漏问题：严重-1');
  });

  it('拒绝引用未由服务端签发的反证', () => {
    expect(() => buildVerifiedReview({
      decisions: [
        {
          findingId: '严重-0',
          verdict: 'rejected',
          reason: '我认为不存在',
          evidenceIds: ['00000000-0000-4000-8000-000000000099'],
        },
        {
          findingId: '严重-1',
          verdict: 'rejected',
          reason: '字段存在',
          evidenceIds: [evidence[1].id],
        },
      ],
      additionalFindings: [],
    }, draftFindings, evidence)).toThrow('引用了未签发证据');
  });

  it('全部问题均有反证时才允许输出无实质问题', () => {
    const markdown = buildVerifiedReview({
      decisions: [
        {
          findingId: '严重-0',
          verdict: 'rejected',
          reason: 'service 实际导出了兼容函数',
          evidenceIds: [evidence[3].id],
        },
        {
          findingId: '严重-1',
          verdict: 'rejected',
          reason: 'schema 已包含写入字段',
          evidenceIds: [evidence[1].id],
        },
      ],
      additionalFindings: [],
    }, draftFindings, evidence);

    expect(markdown).toContain('未发现需要阻塞的实质问题。');
    expect(markdown).toContain('未发现需要阻塞的严重问题。');
    expect(markdown).toContain('源码：service.upload');
    expect(markdown).toContain('files(...)');
  });

  it('驳回问题前必须核验原问题引用的每个代码位置', () => {
    expect(() => buildVerifiedReview({
      decisions: [
        {
          findingId: '严重-0',
          verdict: 'rejected',
          reason: '函数实际存在',
          evidenceIds: [evidence[1].id],
        },
        {
          findingId: '严重-1',
          verdict: 'rejected',
          reason: '字段已经存在',
          evidenceIds: [evidence[0].id],
        },
      ],
      additionalFindings: [],
    }, draftFindings, evidence)).toThrow('驳回未核验原始证据');
  });

  it('补充问题由后端按固定字段生成', () => {
    const markdown = buildVerifiedReview({
      decisions: [
        { findingId: '严重-0', verdict: 'rejected', reason: '已有反证', evidenceIds: [evidence[3].id] },
        { findingId: '严重-1', verdict: 'rejected', reason: '已有反证', evidenceIds: [evidence[1].id] },
      ],
      additionalFindings: [
        {
          severity: '一般',
          title: '缺少事务边界',
          problem: '先写磁盘再写数据库',
          impact: '失败后产生孤儿文件',
          remedy: '增加失败补偿',
          evidenceIds: [evidence[2].id],
        },
      ],
    }, draftFindings, evidence);

    expect(markdown).toContain('## 一般');
    expect(markdown).toContain('**缺少事务边界**');
    expect(markdown).toContain('- 修复建议：增加失败补偿');
  });

  it('输出始终包含完整分组', () => {
    const markdown = buildVerifiedReview({ decisions: [], additionalFindings: [] }, [], []);

    expect(markdown).toContain('## 审查总评');
    expect(markdown).toContain('## 严重');
    expect(markdown).toContain('## 一般');
    expect(markdown).toContain('## 建议');
  });

  it('拒绝在最终问题字段中注入新的 Markdown 分组', () => {
    expect(() => buildVerifiedReview({
      decisions: [
        {
          findingId: '严重-0',
          verdict: 'confirmed',
          finalFinding: {
            title: '合同不一致\n## 审查总评',
            problem: '函数不存在',
            impact: '请求失败',
            remedy: '统一合同',
            evidenceIds: [evidence[0].id],
          },
        },
        { findingId: '严重-1', verdict: 'rejected', reason: '已有反证', evidenceIds: [evidence[1].id] },
      ],
      additionalFindings: [],
    }, draftFindings, evidence)).toThrow('字段不能包含换行');
  });
});

describe('assertReviewDraftIsDecidable', () => {
  it('拒绝把无法解析的过程文本当成无问题草稿', () => {
    expect(() => assertReviewDraftIsDecidable('Let me inspect the service files.', [])).toThrow(
      '无法提取待裁决问题',
    );
  });

  it('允许结构完整的无问题报告', () => {
    const draft = '## 审查总评\n未发现需要阻塞的实质问题。\n## 严重\n未发现严重问题。\n## 一般\n未发现一般问题。\n## 建议\n暂无建议。';
    expect(() => assertReviewDraftIsDecidable(draft, [])).not.toThrow();
  });

  it('拒绝用无问题短语掩盖未解析的问题', () => {
    const draft = '## 审查总评\n未发现需要阻塞的实质问题。\n## 严重\nsrc/auth.ts:10：接口缺少鉴权\n## 一般\n未发现一般问题。\n## 建议\n暂无。';
    expect(() => assertReviewDraftIsDecidable(draft, [])).toThrow('无法提取待裁决问题');
  });
});
