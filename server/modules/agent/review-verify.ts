import { generateText, hasToolCall, stepCountIs, tool, type LanguageModel, type UIMessage } from 'ai';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildReadTools, readWorkspaceLine, type ReviewContext } from './tools';
import { renderReviewBlueprint, type ReviewBlueprint } from './review-blueprint';
import { renderReviewRuntimeMemory, type ReviewRuntimeMemory } from './review-runtime-memory';
import {
  extractReviewFileReferences,
  isExplicitNoFindingReview,
  parseReviewFindings,
  reviewFindingSeverities,
  type ParsedReviewFinding,
  type ReviewFindingSeverity,
} from '../../../shared/review-findings';

export const VERIFY_INSTRUCTIONS = `你是代码审查 verify agent。你的任务是复核主审查草稿是否可信，而不是重新写一篇泛泛总结。

工作要求：
- 只能基于只读工具取证：read_memory、git_diff、read_file、bash。
- 必须同时对照审查蓝图和运行期 CodeMem；蓝图约束复核范围，CodeMem 提供本轮已记录证据，但两者都不能替代代码取证。
- 对“待裁决问题清单”中的每条问题逐条核验：文件、行号、影响、修复建议是否能被代码和 diff 支撑。
- 删除无法取证、证据不足、重复、夸大或与「用户反馈阈值沉淀」冲突的问题；单次 findingFeedbacks 不是可采信证据。
- 如发现草稿漏掉了高置信问题，可以补充，但必须给出文件:行和清晰证据。
- 完成全部取证后，必须调用 submit_verified_review；普通文本不会被当作完成结果。
- decisions 必须覆盖清单中的每个 findingId，不能遗漏、重复或增加未知 ID。
- 每条裁决前必须调用 record_verify_evidence 读取真实文件行，并在裁决中引用它返回的 evidenceId。
- confirmed 必须提交核验后的最终问题字段；rejected 必须说明能够推翻原问题的反证。
- additionalFindings 只能补充草稿漏掉的高置信问题，并完整填写位置、问题、影响、修复建议和代码证据。
- 最终审查总评由系统根据 confirmed 问题确定性生成，你不能自由重写或直接宣布“无问题”。
- 全程使用简体中文。`;

const singleLineTextSchema = z.string().trim().min(1).max(2_000).refine((value) => !/[\r\n]/.test(value), '字段不能包含换行');
const evidenceIdsSchema = z.array(z.string().uuid()).min(1);
const finalFindingSchema = z.object({
  title: singleLineTextSchema,
  problem: singleLineTextSchema,
  impact: singleLineTextSchema,
  remedy: singleLineTextSchema,
  evidenceIds: evidenceIdsSchema,
});
const decisionSchema = z.discriminatedUnion('verdict', [
  z.object({
    findingId: z.string().min(1),
    verdict: z.literal('confirmed'),
    finalFinding: finalFindingSchema,
  }),
  z.object({
    findingId: z.string().min(1),
    verdict: z.literal('rejected'),
    reason: singleLineTextSchema,
    evidenceIds: evidenceIdsSchema,
  }),
]);
const additionalFindingSchema = finalFindingSchema.extend({ severity: z.enum(reviewFindingSeverities) });
const verifiedReviewSubmissionSchema = z.object({
  decisions: z.array(decisionSchema),
  additionalFindings: z.array(additionalFindingSchema).default([]),
});

type VerifiedReviewSubmission = z.infer<typeof verifiedReviewSubmissionSchema>;

export type VerifyEvidence = {
  id: string;
  path: string;
  line: number;
  claim: string;
  sourceLine: string;
};

const submitVerifiedReview = tool({
  description: '完成全部复核后，逐条提交主审查问题的裁决和证据。只有调用此工具，本次 Verify 才算完成。',
  inputSchema: verifiedReviewSubmissionSchema,
  execute: ({ decisions, additionalFindings }) => ({
    accepted: true,
    decisionCount: decisions.length,
    additionalFindingCount: additionalFindings.length,
  }),
});

export function buildVerifiedReview(
  input: unknown,
  draftFindings: ParsedReviewFinding[],
  evidenceRecords: VerifyEvidence[],
): string {
  const submission = verifiedReviewSubmissionSchema.parse(input);
  const expectedIds = new Set(draftFindings.map((finding) => finding.id));
  const decisionIds = submission.decisions.map((decision) => decision.findingId);
  const duplicates = decisionIds.filter((id, index) => decisionIds.indexOf(id) !== index);
  const unknown = decisionIds.filter((id) => !expectedIds.has(id));
  const missing = draftFindings.filter((finding) => !decisionIds.includes(finding.id)).map((finding) => finding.id);
  if (duplicates.length > 0 || unknown.length > 0 || missing.length > 0) {
    throw new Error([
      duplicates.length ? `重复裁决：${[...new Set(duplicates)].join('、')}` : '',
      unknown.length ? `未知问题：${[...new Set(unknown)].join('、')}` : '',
      missing.length ? `遗漏问题：${missing.join('、')}` : '',
    ].filter(Boolean).join('；'));
  }

  const evidenceById = new Map(evidenceRecords.map((evidence) => [evidence.id, evidence]));
  const usedEvidenceIds = submission.decisions.flatMap((decision) =>
    decision.verdict === 'confirmed' ? decision.finalFinding.evidenceIds : decision.evidenceIds,
  ).concat(submission.additionalFindings.flatMap((finding) => finding.evidenceIds));
  const reusedEvidenceIds = usedEvidenceIds.filter((id, index) => usedEvidenceIds.indexOf(id) !== index);
  const unknownEvidenceIds = usedEvidenceIds.filter((id) => !evidenceById.has(id));
  if (reusedEvidenceIds.length > 0 || unknownEvidenceIds.length > 0) {
    throw new Error([
      reusedEvidenceIds.length ? `证据被重复用于多个裁决：${[...new Set(reusedEvidenceIds)].join('、')}` : '',
      unknownEvidenceIds.length ? `引用了未签发证据：${[...new Set(unknownEvidenceIds)].join('、')}` : '',
    ].filter(Boolean).join('；'));
  }

  const draftById = new Map(draftFindings.map((finding) => [finding.id, finding]));
  const rejectionCoverageErrors = submission.decisions
    .filter((decision) => decision.verdict === 'rejected')
    .flatMap((decision) => {
      const required = extractReviewFileReferences(draftById.get(decision.findingId)?.markdown ?? '');
      const actual = new Set(
        decision.evidenceIds
          .map((id) => evidenceById.get(id))
          .filter((item): item is VerifyEvidence => Boolean(item))
          .map((item) => `${item.path}:${item.line}`),
      );
      const uncovered = required.filter((reference) => !actual.has(`${reference.path}:${reference.line}`));
      return uncovered.length > 0
        ? [`${decision.findingId} 缺少 ${uncovered.map((reference) => `${reference.path}:${reference.line}`).join('、')}`]
        : [];
    });
  if (rejectionCoverageErrors.length > 0) {
    throw new Error(`驳回未核验原始证据：${rejectionCoverageErrors.join('；')}`);
  }

  return renderVerifiedReview(draftFindings, submission, evidenceById);
}

export function assertReviewDraftIsDecidable(draft: string, findings: ParsedReviewFinding[]): void {
  if (findings.length > 0 || isExplicitNoFindingReview(draft)) return;
  throw new Error('主审查草稿未明确声明无问题，且无法提取待裁决问题，Verify 已中止');
}

function latestAssistantText(messages: UIMessage[]): string {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) =>
      message.parts
        .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean)
        .join('\n\n')
        .trim(),
    )
    .filter(Boolean)
    .at(-1) ?? '';
}

function renderDecisionChecklist(findings: ParsedReviewFinding[]): string {
  if (findings.length === 0) return '- 主审查草稿没有提取到问题；decisions 必须提交空数组。';
  return findings.map((finding) => [
    `### ${finding.id} [${finding.severity}] ${finding.title}`,
    finding.markdown,
  ].join('\n')).join('\n\n');
}

function renderVerifiedReview(
  draftFindings: ParsedReviewFinding[],
  submission: VerifiedReviewSubmission,
  evidenceById: Map<string, VerifyEvidence>,
): string {
  const draftById = new Map(draftFindings.map((finding) => [finding.id, finding]));
  const confirmed = submission.decisions.filter((decision) => decision.verdict === 'confirmed');
  const rejected = submission.decisions.filter((decision) => decision.verdict === 'rejected');
  const additions = submission.additionalFindings;
  const total = confirmed.length + additions.length;
  const rejectedCount = rejected.length;
  const summary = total === 0
    ? '未发现需要阻塞的实质问题。'
    : `复核确认 ${total} 个问题，排除 ${rejectedCount} 个证据不足或不成立的问题。`;
  return [
    '## 审查总评',
    summary,
    ...reviewFindingSeverities.flatMap((severity) => [
      `## ${severity}`,
      renderSeverityFindings(severity, confirmed, additions, draftById, evidenceById),
    ]),
    '## 核验排除',
    renderRejectedFindings(rejected, draftById, evidenceById),
  ].join('\n\n');
}

function renderSeverityFindings(
  severity: ReviewFindingSeverity,
  confirmed: Extract<VerifiedReviewSubmission['decisions'][number], { verdict: 'confirmed' }>[],
  additions: VerifiedReviewSubmission['additionalFindings'],
  draftById: Map<string, ParsedReviewFinding>,
  evidenceById: Map<string, VerifyEvidence>,
): string {
  const items = [
    ...confirmed
      .filter((decision) => draftById.get(decision.findingId)?.severity === severity)
      .map((decision) => renderFinalFinding(decision.finalFinding, evidenceById)),
    ...additions
      .filter((finding) => finding.severity === severity)
      .map((finding) => renderFinalFinding(finding, evidenceById)),
  ];
  if (items.length === 0) {
    if (severity === '严重') return '未发现需要阻塞的严重问题。';
    if (severity === '一般') return '未发现需要单列的一般问题。';
    return '暂无其他建议。';
  }
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n\n');
}

function renderFinalFinding(
  finding: z.infer<typeof finalFindingSchema>,
  evidenceById: Map<string, VerifyEvidence>,
): string {
  const evidence = finding.evidenceIds.map((id) => evidenceById.get(id)).filter((item): item is VerifyEvidence => Boolean(item));
  return [
    `**${escapeMarkdownInline(finding.title)}**`,
    `- 位置：${evidence.map((item) => `${item.path}:${item.line}`).join('、')}`,
    `- 问题：${escapeMarkdownInline(finding.problem)}`,
    `- 影响：${escapeMarkdownInline(finding.impact)}`,
    `- 修复建议：${escapeMarkdownInline(finding.remedy)}`,
    `- 核验证据：${renderEvidence(evidence)}`,
  ].join('\n');
}

function renderRejectedFindings(
  rejected: Extract<VerifiedReviewSubmission['decisions'][number], { verdict: 'rejected' }>[],
  draftById: Map<string, ParsedReviewFinding>,
  evidenceById: Map<string, VerifyEvidence>,
): string {
  if (rejected.length === 0) return '无。';
  return rejected.map((decision, index) => {
    const evidence = decision.evidenceIds.map((id) => evidenceById.get(id)).filter((item): item is VerifyEvidence => Boolean(item));
    return [
      `${index + 1}. **[${decision.findingId}] ${escapeMarkdownInline(draftById.get(decision.findingId)?.title ?? decision.findingId)}**`,
      `- 驳回原因：${escapeMarkdownInline(decision.reason)}`,
      `- 反证：${renderEvidence(evidence)}`,
    ].join('\n');
  }).join('\n\n');
}

function renderEvidence(evidence: VerifyEvidence[]): string {
  return evidence
    .map((item) => `${item.path}:${item.line} ${escapeMarkdownInline(item.claim)}（源码：${escapeMarkdownInline(item.sourceLine.trim() || '空行')}）`)
    .join('；');
}

function escapeMarkdownInline(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

export function withVerifiedReviewText(messages: UIMessage[], verifiedText: string): UIMessage[] {
  const verifiedPart = { type: 'text', text: `## Verify 结论\n${verifiedText}` } as const;
  const index = messages.findLastIndex((message) => message.role === 'assistant');
  if (index < 0) {
    return [
      ...messages,
      { id: `verified-${Date.now()}`, role: 'assistant', parts: [verifiedPart] },
    ];
  }
  return messages.map((message, currentIndex) => {
    if (currentIndex !== index) return message;
    return {
      ...message,
      parts: [...message.parts, verifiedPart],
    };
  });
}

export function verifyReviewResult({
  ctx,
  messages,
  model,
  maxSteps,
  blueprint,
  runtimeMemory,
  abortSignal,
}: {
  ctx: ReviewContext;
  messages: UIMessage[];
  model: LanguageModel;
  maxSteps: number;
  blueprint?: ReviewBlueprint;
  runtimeMemory?: ReviewRuntimeMemory;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const draft = latestAssistantText(messages).trim();
  const draftFindings = parseReviewFindings(draft);
  assertReviewDraftIsDecidable(draft, draftFindings);
  const evidenceById = new Map<string, VerifyEvidence>();
  const prompt = [
    '请复核下面的主审查草稿，并逐条裁决待裁决问题清单。',
    '',
    blueprint ? renderReviewBlueprint(blueprint) : '## 审查蓝图\n暂无',
    '',
    runtimeMemory ? renderReviewRuntimeMemory(runtimeMemory) : '## 运行期 CodeMem\n暂无',
    '',
    '## 主审查草稿',
    draft || '（主审查没有返回可见草稿）',
    '',
    '## 待裁决问题清单',
    renderDecisionChecklist(draftFindings),
  ].join('\n');

  const recordVerifyEvidence = tool({
    description: '读取并登记一条用于 Verify 裁决的真实代码证据，返回只能在本轮使用的 evidenceId。',
    inputSchema: z.object({
      path: z.string().min(1).describe('仓库根目录下的相对文件路径'),
      line: z.number().int().positive().describe('需要核验的真实行号'),
      claim: singleLineTextSchema.describe('该代码行支持或推翻问题的具体说明'),
    }),
    execute: ({ path, line, claim }) => readWorkspaceLine(ctx.workdir, path, line).then((source) => {
      const evidence: VerifyEvidence = {
        id: randomUUID(),
        path: source.path,
        line: source.line,
        claim,
        sourceLine: source.text,
      };
      evidenceById.set(evidence.id, evidence);
      return evidence;
    }),
  });
  const tools = {
    ...buildReadTools(ctx),
    record_verify_evidence: recordVerifyEvidence,
    submit_verified_review: submitVerifiedReview,
  };
  return generateText({
    model,
    system: VERIFY_INSTRUCTIONS,
    prompt,
    tools,
    stopWhen: [hasToolCall('submit_verified_review'), stepCountIs(Math.max(1, maxSteps))],
    abortSignal,
  }).then((result) => {
    const submission = result.toolCalls.findLast((call) => call?.toolName === 'submit_verified_review');
    const input = submission?.input;
    if (!input || typeof input !== 'object') {
      throw new Error(
        `Verify Agent 未在 ${result.steps.length} 步内提交最终结论（结束原因：${result.finishReason}）`,
      );
    }
    return buildVerifiedReview(input, draftFindings, [...evidenceById.values()]);
  });
}
