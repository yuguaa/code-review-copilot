import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('审查活动卡布局', () => {
  it('把最新编排放在消息滚动区之外，并从消息 parts 中剔除活动数据', () => {
    const chatPage = source('../../pages/Chat.tsx');
    const messageParts = source('../chat/message-parts.tsx');

    expect(chatPage).toContain('<ReviewActivityCard key={latestActivity.runId} data={latestActivity} />');
    expect(messageParts).toContain('!isReviewActivityPart(part)');
    expect(chatPage.indexOf('<ReviewActivityCard')).toBeLessThan(chatPage.indexOf('<Conversation'));
  });

  it('Agent 轨迹通过 Sheet 打开，且只在选中 Agent 时渲染', () => {
    const card = source('../chat/review-activity-card.tsx');

    expect(card).toContain('<Sheet');
    expect(card).toContain('{selectedAgent ? <AgentTracePanel agent={selectedAgent} /> : null}');
  });
});
