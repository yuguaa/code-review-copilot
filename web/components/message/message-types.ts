import type { UIMessage } from 'ai';
import { isReviewActivityState, type ReviewActivityState } from '@shared/review-activity';
import type { MessageTreeNode } from '../../lib/types';

export type MessagePart = UIMessage['parts'][number];
export type BranchInfo = Pick<MessageTreeNode, 'siblingIds' | 'siblingIndex' | 'siblingCount'>;

export type ReviewActivityPart = MessagePart & {
  type: 'data-review-activity';
  data: ReviewActivityState;
};

export function isBoundaryPart(part: MessagePart): boolean {
  const type = String(part.type);
  return type === 'step-start' || type === 'step-finish';
}

export function isReviewActivityPart(part: MessagePart): part is ReviewActivityPart {
  if (part.type !== 'data-review-activity') return false;
  return isReviewActivityState((part as { data?: unknown }).data);
}
