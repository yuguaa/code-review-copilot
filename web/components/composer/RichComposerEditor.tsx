import { forwardRef, useImperativeHandle, useRef } from 'react';
import { cn } from '../../lib/cn';

export type RichComposerEditorHandle = {
  clear: () => void;
  getText: () => string;
  insertSlashAndFocus: () => void;
};

type RichComposerEditorProps = {
  disabled: boolean;
  onEmptyChange: (empty: boolean) => void;
  onEnter: () => boolean;
  onEscape: () => boolean;
  onMoveSelection: (direction: 1 | -1) => boolean;
  onTextChange: (text: string) => void;
  placeholder: string;
};

const editorClass =
  'composer-editor min-h-10 max-h-40 w-full resize-none overflow-y-auto bg-transparent px-3 py-2 text-sm leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--muted-soft)]';

function syncHeight(element: HTMLTextAreaElement) {
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
}

export const RichComposerEditor = forwardRef<RichComposerEditorHandle, RichComposerEditorProps>(
  function RichComposerEditor(
    {
      disabled,
      onEmptyChange,
      onEnter,
      onEscape,
      onMoveSelection,
      onTextChange,
      placeholder,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const setValue = (value: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.value = value;
      syncHeight(textarea);
      onTextChange(value);
      onEmptyChange(!value.trimStart());
    };

    useImperativeHandle(
      ref,
      () => ({
        clear: () => setValue(''),
        getText: () => textareaRef.current?.value ?? '',
        insertSlashAndFocus: () => {
          setValue('/');
          textareaRef.current?.focus();
        },
      }),
      [onEmptyChange, onTextChange],
    );

    return (
      <textarea
        ref={textareaRef}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(editorClass, disabled && 'cursor-not-allowed opacity-60')}
        onChange={(event) => {
          const text = event.currentTarget.value;
          syncHeight(event.currentTarget);
          onTextChange(text);
          onEmptyChange(!text.trimStart());
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && onEscape()) {
            event.preventDefault();
            return;
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const handled = onMoveSelection(event.key === 'ArrowDown' ? 1 : -1);
            if (handled) event.preventDefault();
            return;
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onEnter();
          }
        }}
      />
    );
  },
);
