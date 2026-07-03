import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
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
  'composer-editor min-h-10 max-h-40 overflow-y-auto px-3 py-2 text-sm leading-6 text-[var(--ink)] outline-none';

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
    const editor = useEditor({
      content: '',
      editable: !disabled,
      editorProps: {
        attributes: {
          class: editorClass,
        },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape') {
            return onEscape();
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const handled = onMoveSelection(event.key === 'ArrowDown' ? 1 : -1);
            if (handled) event.preventDefault();
            return handled;
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            return onEnter();
          }
          return false;
        },
      },
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
      onUpdate: ({ editor }) => {
        const text = editor.getText();
        onTextChange(text);
        onEmptyChange(!text.trimStart());
      },
    }, [placeholder, onEnter, onEscape, onMoveSelection, onTextChange, onEmptyChange]);

    useImperativeHandle(
      ref,
      () => ({
        clear: () => editor?.commands.clearContent(),
        getText: () => editor?.getText() ?? '',
        insertSlashAndFocus: () => {
          editor?.chain().focus().setContent('/').run();
        },
      }),
      [editor],
    );

    useEffect(() => {
      if (!editor) return;
      editor.setOptions({
        editable: !disabled,
        editorProps: {
          ...editor.options.editorProps,
          attributes: {
            class: cn(editorClass, disabled && 'cursor-not-allowed opacity-60'),
          },
        },
      });
    }, [editor, disabled]);

    return <EditorContent editor={editor} />;
  },
);
