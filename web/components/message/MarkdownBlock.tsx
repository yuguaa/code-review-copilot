import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { StreamingCursor } from './StreamingCursor';
import { shikiCodeHighlighter } from './shiki-plugin';

export function MarkdownBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text.trim() && !streaming) return null;
  return (
    <div className="streamdown-body min-w-0">
      {text.trim() ? (
        <Streamdown
          animated
          controls={{ code: { copy: true, download: false }, mermaid: true, table: true }}
          isAnimating={Boolean(streaming)}
          lineNumbers
          plugins={{ cjk, code: shikiCodeHighlighter }}
          shikiTheme={shikiCodeHighlighter.getThemes()}
        >
          {text}
        </Streamdown>
      ) : null}
      {streaming && <StreamingCursor />}
    </div>
  );
}
