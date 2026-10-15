import { describe, expect, it } from 'vitest';
import { buildRssDingtalkMessage } from './rss-notification';

describe('RSS 钉钉消息模板', () => {
  it('用订阅名做分组标题，并把正文放在标题与链接之间', () => {
    const message = buildRssDingtalkMessage('前端周刊', {
      guid: 'post-1',
      title: 'React 19 正式发布',
      link: 'https://example.com/posts/1',
      publishedAt: new Date('2026-02-03T08:00:00Z'),
      summary: '新版本带来 Actions 与 use 语法。',
    });

    expect(message.title).toBe('RSS 更新 · 前端周刊 · React 19 正式发布');
    expect(message.text).toContain('### 📰 前端周刊');
    expect(message.text).toContain('**React 19 正式发布**');
    expect(message.text).toContain('> 发布时间：');
    expect(message.text).toContain('[阅读全文](https://example.com/posts/1)');
  });

  it('摘要里的 HTML 标签被清除，并限制在 180 个字符以内', () => {
    const summary = `<p>${'内容'.repeat(200)}</p>`;
    const message = buildRssDingtalkMessage('后端观察', {
      guid: 'post-2',
      title: '关于连接池',
      link: null,
      publishedAt: null,
      summary,
    });

    expect(message.text).not.toContain('<p>');
    expect(message.text).toContain('…');
    expect(message.text).toContain('发布时间：未提供发布时间');
    expect(message.text).not.toContain('[阅读全文]');
  });
});
