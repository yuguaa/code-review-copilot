import type { UIMessage } from 'ai';
import type { MessageTreeNode } from '../../lib/types';

export type MessagePart = UIMessage['parts'][number];
export type BranchInfo = Pick<MessageTreeNode, 'siblingIds' | 'siblingIndex' | 'siblingCount'>;

export function isBoundaryPart(part: MessagePart): boolean {
  const type = String(part.type);
  return type === 'step-start' || type === 'step-finish';
}
