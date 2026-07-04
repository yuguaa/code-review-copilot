import type { MessageFeedbackValue, MessageFindingFeedback } from '../../lib/types';

export type ReviewFinding = {
  id: string;
  severity: string;
  text: string;
  feedback: MessageFeedbackValue | null;
};

const severityHeadings = new Set(['严重', '一般', '建议']);

export function extractReviewFindings(text: string, feedbacks: MessageFindingFeedback[] = []): ReviewFinding[] {
  const feedbackByText = new Map(feedbacks.map((item) => [normalizeFindingText(item.text), item.feedback]));
  const findings: ReviewFinding[] = [];
  let severity = '';

  for (const rawLine of text.split('\n')) {
    const heading = headingOf(rawLine);
    if (heading) {
      severity = heading;
      continue;
    }
    const item = listItemOf(rawLine);
    if (!severity || !item) continue;
    const normalized = normalizeFindingText(item);
    if (!normalized || normalized.length < 8) continue;
    findings.push({
      id: `${severity}-${findings.length}`,
      severity,
      text: item,
      feedback: feedbackByText.get(normalized) ?? null,
    });
  }

  return findings;
}

export function normalizeFindingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function headingOf(line: string): string {
  const text = line.replace(/^#+\s*/, '').replace(/[*_`：:]/g, '').trim();
  return severityHeadings.has(text) ? text : '';
}

function listItemOf(line: string): string {
  const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
  return match?.[1]?.trim() ?? '';
}
