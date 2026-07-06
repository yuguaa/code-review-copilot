import { useCallback, useEffect, useRef, useState } from 'react';
import Command from 'lucide-react/dist/esm/icons/command';
import SendHorizontal from 'lucide-react/dist/esm/icons/send-horizontal';
import Square from 'lucide-react/dist/esm/icons/square';
import { CommandPalette } from './CommandPalette';
import type { ComposerCommand } from './composer-types';
import { RichComposerEditor, type RichComposerEditorHandle } from './RichComposerEditor';
import { useComposerCommands } from './useComposerCommands';

export type { ComposerCommand } from './composer-types';

type ComposerProps = {
  busy?: boolean;
  commands: ComposerCommand[];
  disabled?: boolean;
  onStop: () => void;
  onSubmit: (text: string) => void;
  placeholder: string;
};

export function Composer({ placeholder, disabled, busy, commands, onSubmit, onStop }: ComposerProps) {
  const [empty, setEmpty] = useState(true);
  const {
    activeCommand,
    availableCommands,
    hasCommand,
    moveSelection,
    open,
    openRef,
    reset: resetCommands,
    setOpen: setCommandOpen,
    setQuery,
  } = useComposerCommands(commands);
  const activeCommandRef = useRef<ComposerCommand | undefined>(activeCommand);
  const editorRef = useRef<RichComposerEditorHandle>(null);
  const editorDisabled = Boolean(disabled || busy);

  useEffect(() => {
    activeCommandRef.current = activeCommand;
  }, [activeCommand]);

  const submit = useCallback(() => {
    if (editorDisabled) return;
    const text = editorRef.current?.getText().trim() ?? '';
    if (!text) return;
    if (text.startsWith('/') && activeCommandRef.current) {
      setCommandOpen(true);
      return;
    }
    onSubmit(text);
    editorRef.current?.clear();
    setEmpty(true);
    setCommandOpen(false);
  }, [editorDisabled, onSubmit, setCommandOpen]);

  const handleTextChange = useCallback(
    (text: string) => {
      const commandText = text.trimStart();
      if (commandText.startsWith('/') && hasCommand) {
        setQuery(commandText.slice(1).trim());
        setCommandOpen(true);
        return;
      }
      setQuery('');
      setCommandOpen(false);
    },
    [hasCommand, setCommandOpen, setQuery],
  );

  const handleEnter = useCallback(() => {
    const command = activeCommandRef.current;
    if (openRef.current && command) {
      command.onSelect();
      editorRef.current?.clear();
      setEmpty(true);
      resetCommands();
      return true;
    }
    if (openRef.current) return true;
    submit();
    return true;
  }, [openRef, resetCommands, submit]);

  const handleEscape = useCallback(() => {
    if (!openRef.current) return false;
    setCommandOpen(false);
    return true;
  }, [openRef, setCommandOpen]);

  const handleMoveSelection = useCallback(
    (direction: 1 | -1) => {
      if (!openRef.current) return false;
      moveSelection(direction);
      return true;
    },
    [moveSelection, openRef],
  );

  const openCommands = () => {
    if (!hasCommand) return;
    setCommandOpen(true);
    editorRef.current?.insertSlashAndFocus();
    setEmpty(false);
    setQuery('');
  };

  const selectCommand = (command: ComposerCommand) => {
    if (command.disabled) return;
    command.onSelect();
    editorRef.current?.clear();
    setEmpty(true);
    resetCommands();
  };

  return (
    <div className="composer-shell relative flex min-h-[70px] items-end gap-2 rounded-[var(--r-lg)] border border-[var(--line-default)] bg-[rgba(255,255,255,0.74)] p-2 shadow-[0_8px_18px_-14px_rgba(7,26,18,0.38),0_1px_0_rgba(255,255,255,0.74)_inset] backdrop-blur-xl transition-[border-color,box-shadow] focus-within:border-[var(--line-accent)] focus-within:shadow-[0_10px_22px_-16px_rgba(7,26,18,0.42),0_0_0_3px_var(--ring)]">
      <div className="min-w-0 flex-1">
        <RichComposerEditor
          ref={editorRef}
          disabled={editorDisabled}
          onEmptyChange={setEmpty}
          onEnter={handleEnter}
          onEscape={handleEscape}
          onMoveSelection={handleMoveSelection}
          onTextChange={handleTextChange}
          placeholder={placeholder}
        />
      </div>
      {open && <CommandPalette activeCommand={activeCommand} commands={availableCommands} onSelect={selectCommand} />}
      <button
        type="button"
        onClick={openCommands}
        disabled={!hasCommand || editorDisabled}
        aria-label="打开指令"
        title="打开指令"
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--r-sm)] border border-transparent text-[var(--muted)] transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <Command size={16} />
      </button>
      {busy ? (
        <button
          onClick={onStop}
          aria-label="停止生成"
          title="停止生成"
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--r-pill)] border border-[var(--line-strong)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)] transition-[background-color,transform,opacity] hover:bg-[var(--body-strong)] active:translate-y-px active:scale-95"
        >
          <Square size={14} className="fill-current" />
        </button>
      ) : (
        <button
          onClick={submit}
          disabled={editorDisabled || empty}
          aria-label="发送"
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--r-pill)] border border-[var(--line-strong)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)] transition-[background-color,transform,opacity] hover:bg-[var(--body-strong)] active:translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal size={16} />
        </button>
      )}
    </div>
  );
}
