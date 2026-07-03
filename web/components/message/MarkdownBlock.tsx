import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { cjk } from '@streamdown/cjk';
import { StreamingCursor } from './StreamingCursor';

export function MarkdownBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text.trim() && !streaming) return null;
  return (
    <div className="streamdown-body min-w-0">
      {text.trim() ? (
        <Streamdown animated plugins={{ code, cjk }} isAnimating={Boolean(streaming)}>
          {text}
        </Streamdown>
      ) : null}
      {streaming && <StreamingCursor />}
    </div>
  );
}
