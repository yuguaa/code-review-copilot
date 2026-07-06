import Loader2 from 'lucide-react/dist/esm/icons/loader-circle';
import RefreshCcw from 'lucide-react/dist/esm/icons/refresh-ccw';
import { cn } from '../../lib/cn';
import type { ComposerCommand } from './composer-types';

type CommandPaletteProps = {
  activeCommand?: ComposerCommand;
  commands: ComposerCommand[];
  onSelect: (command: ComposerCommand) => void;
};

export function CommandPalette({ activeCommand, commands, onSelect }: CommandPaletteProps) {
  return (
    <div className="command-palette bottom-[calc(100%+0.5rem)] left-0 right-0 overflow-hidden rounded-[var(--r-lg)] border border-[var(--line-default)] bg-[rgba(255,255,255,0.96)] shadow-[var(--shadow-popover)] backdrop-blur-xl">
      <div className="border-b border-[var(--line-subtle)] bg-[rgba(247,250,247,0.82)] px-3 py-2">
        <span className="caption text-[var(--muted)]">输入 / 选择指令</span>
      </div>
      {commands.length === 0 && (
        <div className="px-3 py-5 text-center text-xs text-[var(--muted)]">没有匹配的指令</div>
      )}
      {commands.map((command) => {
        const selected = activeCommand?.id === command.id;
        return (
          <button
            key={command.id}
            type="button"
            onClick={() => onSelect(command)}
            disabled={command.disabled}
            className={cn(
              'relative flex w-full cursor-pointer items-start gap-3 border-b border-[var(--line-subtle)] px-3 py-3 text-left transition-[background-color,border-color] last:border-b-0 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50',
              selected && 'bg-[var(--surface-hover)] before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[2px] before:rounded-r-full before:bg-[var(--accent)]',
            )}
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)]">
              {command.loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--ink)]">{command.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted)]">{command.description}</span>
            </span>
            <span className="ml-auto rounded-[var(--r-sm)] border border-[var(--line-default)] bg-[var(--surface-soft)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted)]">
              Enter
            </span>
          </button>
        );
      })}
    </div>
  );
}
