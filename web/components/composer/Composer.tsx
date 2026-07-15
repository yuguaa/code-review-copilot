import { useCallback, useEffect, useRef, useState } from 'react';
import Command from 'lucide-react/dist/esm/icons/command';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle';
import SendHorizontal from 'lucide-react/dist/esm/icons/send-horizontal';
import Square from 'lucide-react/dist/esm/icons/square';
import type { ChatModelOption } from '../../lib/types';
import { Select } from '../ui/forms';
import { CommandPalette } from './CommandPalette';
import type { ComposerCommand } from './composer-types';
import { RichComposerEditor, type RichComposerEditorHandle } from './RichComposerEditor';
import { useComposerCommands } from './useComposerCommands';

export type { ComposerCommand } from './composer-types';

type ComposerProps = {
  busy?: boolean;
  commands: ComposerCommand[];
  disabled?: boolean;
  modelOptions: ChatModelOption[];
  modelsLoading?: boolean;
  onModelChange: (modelId: string) => void;
  onStop: () => void;
  onSubmit: (text: string) => void;
  placeholder: string;
  selectedModelId: string;
  stoppable?: boolean;
  stopping?: boolean;
  stopLabel?: string;
};

export function Composer({
  placeholder,
  disabled,
  busy,
  commands,
  modelOptions,
  modelsLoading,
  onModelChange,
  onSubmit,
  onStop,
  stoppable,
  stopping,
  selectedModelId,
  stopLabel = '停止生成',
}: ComposerProps) {
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
  const canStop = Boolean(busy || stoppable);

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
    <div className="composer-shell relative flex min-h-[70px] items-end gap-2 rounded-[var(--r-lg)] border border-[var(--line-default)] bg-[var(--surface-card)] p-2 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] focus-within:border-[var(--line-accent)] focus-within:shadow-[var(--shadow-sm),0_0_0_3px_var(--ring)]">
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
        <div className="flex min-w-0 items-center px-2 pb-1">
          <Select
            aria-label="选择追问模型"
            title="选择追问模型"
            value={selectedModelId}
            disabled={editorDisabled || modelsLoading || modelOptions.length === 0}
            onChange={(event) => onModelChange(event.target.value)}
            className="h-10 min-w-0 w-full max-w-[260px] truncate py-0 text-sm"
          >
            <option value="">{modelsLoading ? '加载可用模型…' : '默认（按会话配置）'}</option>
            {modelOptions.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {open && <CommandPalette activeCommand={activeCommand} commands={availableCommands} onSelect={selectCommand} />}
      <button
        type="button"
        onClick={openCommands}
        disabled={!hasCommand || editorDisabled}
        aria-label="打开指令"
        title="打开指令"
        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--r-sm)] border border-transparent text-[var(--muted)] transition-[background-color,border-color,color,transform] hover:border-[var(--line-default)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
      >
        <Command size={16} />
      </button>
      {canStop ? (
        <button
          onClick={onStop}
          disabled={Boolean(stopping)}
          aria-label={stopLabel}
          title={stopLabel}
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--r-sm)] border border-[var(--primary)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)] transition-[background-color,border-color,transform,opacity] hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:scale-[0.98] disabled:cursor-wait disabled:opacity-65"
        >
          {stopping ? <Loader2 size={16} className="animate-spin" /> : <Square size={14} className="fill-current" />}
        </button>
      ) : (
        <button
          onClick={submit}
          disabled={editorDisabled || empty}
          aria-label="发送"
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--r-sm)] border border-[var(--primary)] bg-[var(--primary)] text-white shadow-[var(--shadow-sm)] transition-[background-color,border-color,transform,opacity] hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal size={16} />
        </button>
      )}
    </div>
  );
}
