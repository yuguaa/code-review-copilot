import type { UIMessage } from 'ai';
import type { MessageFeedbackValue, MessageFindingFeedback } from '../../lib/types';
import { normalizeFindingText, parseReviewFindings } from '../../../shared/review-findings';

export type ReviewFinding = {
  id: string;
  severity: string;
  text: string;
  feedback: MessageFeedbackValue | null;
};

export function extractReviewFindings(text: string, feedbacks: MessageFindingFeedback[] = []): ReviewFinding[] {
  const feedbackByText = new Map(feedbacks.map((item) => [normalizeFindingText(item.text), item.feedback]));
  return parseReviewFindings(text).map((finding) => ({
    id: finding.id,
    severity: finding.severity,
    text: finding.title,
    feedback: feedbackByText.get(normalizeFindingText(finding.title)) ?? null,
  }));
}

/** 一条审查消息只允许在最终 Verify 结论上反馈；旧消息则回退到最后一个含问题的文本块。 */
export function findingFeedbackPartIndex(parts: UIMessage['parts']): number {
  const verifyIndex = parts.findLastIndex((part) =>
    part.type === 'text' && /^\s*##\s+Verify\s+结论(?:\s|$)/m.test(part.text),
  );
  if (verifyIndex >= 0) return extractReviewFindings((parts[verifyIndex] as { text: string }).text).length > 0 ? verifyIndex : -1;
  return parts.findLastIndex((part) => part.type === 'text' && extractReviewFindings(part.text).length > 0);
}

export { normalizeFindingText } from '../../../shared/review-findings';
