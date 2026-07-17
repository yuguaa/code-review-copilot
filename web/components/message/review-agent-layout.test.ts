import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Agent 编排悬浮布局', () => {
  it('将最新编排提升到滚动区外，并在详情打开时隐藏悬浮卡', () => {
    expect(source('../../pages/Chat.tsx')).toContain(
      '<ReviewAgentActivity key={latestReviewActivity.runId} data={latestReviewActivity} />',
    );
    expect(source('./MessageBubble.tsx')).toContain('!isReviewActivityPart(part)');
    expect(source('./ReviewAgentActivity.tsx')).toContain('{!selection && (');
    expect(source('../../index.css')).toContain('scrollbar-gutter: stable both-edges;');
    expect(source('../../index.css')).toMatch(/\.review-agent-floating\s*{[\s\S]*?position: absolute;/);
  });
});
