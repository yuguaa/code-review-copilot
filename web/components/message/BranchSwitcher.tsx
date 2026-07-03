import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import { cn } from '../../lib/cn';
import type { BranchInfo } from './message-types';

export function BranchSwitcher({ branch, onSelectSibling }: { branch?: BranchInfo; onSelectSibling?: (messageId: string) => void }) {
  if (!branch || branch.siblingCount <= 1 || !onSelectSibling) return null;
  const previous = branch.siblingIds[branch.siblingIndex - 1];
  const next = branch.siblingIds[branch.siblingIndex + 1];
  return (
    <div className="caption flex shrink-0 items-center gap-1 rounded-[var(--r-pill)] border border-[var(--hairline)] bg-white px-1.5 py-1 text-[var(--body-strong)] shadow-[var(--shadow-sm)]">
      <button type="button" disabled={!previous} onClick={() => previous && onSelectSibling(previous)} className="rounded-[var(--r-pill)] p-0.5 hover:bg-white disabled:opacity-30" aria-label="上一条分支">
        <ChevronLeft size={12} />
      </button>
      <span className="min-w-8 text-center">{branch.siblingIndex + 1}/{branch.siblingCount}</span>
      <button type="button" disabled={!next} onClick={() => next && onSelectSibling(next)} className="rounded-[var(--r-pill)] p-0.5 hover:bg-white disabled:opacity-30" aria-label="下一条分支">
        <ChevronRight size={12} />
      </button>
    </div>
  );
}
