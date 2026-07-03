import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Command, SendHorizontal, Square } from 'lucide-react';
import { cn } from '../lib/cn';
import { CommandPalette } from './composer/CommandPalette';
import type { ComposerCommand } from './composer/composer-types';
import { useComposerCommands } from '../hooks/useComposerCommands';

export type { ComposerCommand } from './composer/composer-types';

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
  const editorDisabled = Boolean(disabled || busy);
  const activeCommandRef = useRef<ComposerCommand | undefined>(activeCommand);
  const submitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    activeCommandRef.current = activeCommand;
  }, [activeCommand]);

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
        if (event.key === 'Escape' && openRef.current) {
          event.preventDefault();
          setCommandOpen(false);
          return true;
        }
        if (openRef.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          moveSelection(direction);
          return true;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          const command = activeCommandRef.current;
          if (openRef.current && command) {
            command.onSelect();
            editor?.commands.clearContent();
            resetCommands();
            return true;
          }
          if (openRef.current) return true;
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
  }, [placeholder, hasCommand, moveSelection, resetCommands]);

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

  const selectCommand = (command: ComposerCommand) => {
    if (command.disabled) return;
    command.onSelect();
    editor?.commands.clearContent();
    setEmpty(true);
    resetCommands();
  };

  return (
    <div className="relative flex items-end gap-2 rounded-[var(--r-lg)] border border-[var(--hairline)] bg-white p-1.5 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] focus-within:border-[var(--ink)] focus-within:shadow-[0_0_0_1px_rgba(0,0,0,0.08)]">
      <div className="min-w-0 flex-1">
        <EditorContent editor={editor} />
      </div>
      {open && (
        <CommandPalette
          activeCommand={activeCommand}
          commands={availableCommands}
          onSelect={selectCommand}
        />
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
