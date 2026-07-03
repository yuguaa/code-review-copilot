import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Command, Loader2, RefreshCcw, SendHorizontal, Square } from 'lucide-react';
import { cn } from '../lib/cn';

export type ComposerCommand = {
  id: string;
  title: string;
  description: string;
  disabled?: boolean;
  loading?: boolean;
  onSelect: () => void;
};

type ComposerProps = {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  commands: ComposerCommand[];
  onSubmit: (text: string) => void;
  onStop: () => void;
};

const editorClass =
  'composer-editor min-h-10 max-h-40 overflow-y-auto px-3 py-2 text-sm leading-6 text-[var(--ink)] outline-none';

export function Composer({ placeholder, disabled, busy, commands, onSubmit, onStop }: ComposerProps) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [empty, setEmpty] = useState(true);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const editorDisabled = Boolean(disabled || busy);
  const availableCommands = useMemo(
    () =>
      commands.filter((command) => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return true;
        return `${command.title} ${command.description}`.toLowerCase().includes(normalized);
      }),
    [commands, query],
  );
  const selectableCommands = availableCommands.filter((command) => !command.disabled);
  const activeCommand = selectableCommands[selectedIndex] ?? selectableCommands[0];
  const hasCommand = commands.some((command) => !command.disabled);
  const activeCommandRef = useRef<ComposerCommand | undefined>(activeCommand);
  const submitRef = useRef<() => void>(() => undefined);
  const commandOpenRef = useRef(false);

  useEffect(() => {
    activeCommandRef.current = activeCommand;
  }, [activeCommand]);

  useEffect(() => {
    commandOpenRef.current = commandOpen;
  }, [commandOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex > selectableCommands.length - 1) {
      setSelectedIndex(Math.max(0, selectableCommands.length - 1));
    }
  }, [selectableCommands.length, selectedIndex]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        codeBlock: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        orderedList: false,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: editorClass,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape' && commandOpenRef.current) {
          event.preventDefault();
          setCommandOpen(false);
          return true;
        }
        if (commandOpenRef.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          setSelectedIndex((current) => {
            if (selectableCommands.length <= 1) return 0;
            return (current + direction + selectableCommands.length) % selectableCommands.length;
          });
          return true;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          const command = activeCommandRef.current;
          if (commandOpenRef.current && command) {
            command.onSelect();
            editor?.commands.clearContent();
            setCommandOpen(false);
            return true;
          }
          if (commandOpenRef.current) return true;
          submitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText().trimStart();
      setEmpty(!text);
      if (text.startsWith('/') && hasCommand) {
        setQuery(text.slice(1).trim());
        setCommandOpen(true);
        return;
      }
      setQuery('');
      setCommandOpen(false);
    },
  }, [placeholder, hasCommand, selectableCommands.length]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editable: !editorDisabled,
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          class: cn(editorClass, editorDisabled && 'cursor-not-allowed opacity-60'),
        },
      },
    });
  }, [editor, editorDisabled]);

  const submit = () => {
    if (!editor || editorDisabled) return;
    const text = editor.getText().trim();
    if (!text) return;
    if (text.startsWith('/') && activeCommand) {
      setCommandOpen(true);
      return;
    }
    onSubmit(text);
    editor.commands.clearContent();
    setEmpty(true);
    setCommandOpen(false);
  };

  useEffect(() => {
    submitRef.current = submit;
  });

  const openCommands = () => {
    if (!hasCommand) return;
    setCommandOpen(true);
    editor?.chain().focus().setContent('/').run();
    setEmpty(false);
    setQuery('');
  };

  return (
    <div className="relative flex items-end gap-2 rounded-[var(--r-lg)] border border-[var(--hairline)] bg-white p-1.5 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] focus-within:border-[var(--ink)] focus-within:shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
      <div className="min-w-0 flex-1">
        <EditorContent editor={editor} />
      </div>
      {commandOpen && (
        <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 overflow-hidden rounded-[var(--r-md)] border border-[var(--hairline)] bg-[var(--canvas)] shadow-[var(--shadow-popover)]">
          <div className="border-b border-[var(--hairline)] px-3 py-2">
            <span className="caption text-[var(--muted)]">输入 / 选择指令</span>
          </div>
          {availableCommands.length === 0 && (
            <div className="px-3 py-5 text-center text-xs text-[var(--muted)]">没有匹配的指令</div>
          )}
          {availableCommands.map((command) => {
            const selected = activeCommand?.id === command.id;
            return (
              <button
                key={command.id}
                type="button"
                onClick={() => {
                  if (command.disabled) return;
                  command.onSelect();
                  editor?.commands.clearContent();
                  setEmpty(true);
                  setCommandOpen(false);
                }}
                disabled={command.disabled}
                className={cn(
                  'flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50',
                  selected && 'bg-[var(--surface-hover)]',
                )}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-[var(--ink)] text-white">
                  {command.loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--ink)]">{command.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted)]">{command.description}</span>
                </span>
                <span className="ml-auto rounded-[var(--r-sm)] border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted)]">
                  Enter
                </span>
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={openCommands}
        disabled={!hasCommand || editorDisabled}
        aria-label="打开指令"
        title="打开指令"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-sm)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] disabled:opacity-35"
      >
        <Command size={16} />
      </button>
      {busy ? (
        <button
          onClick={onStop}
          aria-label="停止生成"
          title="停止生成"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-[var(--primary)] text-white transition-opacity hover:opacity-90 active:scale-95"
        >
          <Square size={14} className="fill-current" />
        </button>
      ) : (
        <button
          onClick={submit}
          disabled={editorDisabled || empty}
          aria-label="发送"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-[var(--primary)] text-white transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-40"
        >
          <SendHorizontal size={16} />
        </button>
      )}
    </div>
  );
}
