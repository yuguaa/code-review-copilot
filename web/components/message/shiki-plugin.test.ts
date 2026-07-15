import type { ThemeInput } from 'streamdown';
import { describe, expect, it } from 'vitest';
import { shikiCodeHighlighter } from './shiki-plugin';

type HighlightResult = NonNullable<ReturnType<typeof shikiCodeHighlighter.highlight>>;

describe('shikiCodeHighlighter', () => {
  it('只暴露可加载语言，并把共享高亮结果通知给所有订阅者', () => {
    expect(shikiCodeHighlighter.getSupportedLanguages()).not.toContain('diff');

    const request = {
      code: 'const id = courseId.value\nif (id !== courseId.value) return',
      language: 'javascript' as const,
      themes: ['github-dark', 'github-dark'] as [ThemeInput, ThemeInput],
    };
    const results: HighlightResult[] = [];

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('代码高亮回调超时')), 5_000);
      const collect = (result: HighlightResult) => {
        results.push(result);
        if (results.length !== 2) return;
        clearTimeout(timeout);
        resolve();
      };

      expect(shikiCodeHighlighter.highlight(request, collect)).toBeNull();
      expect(shikiCodeHighlighter.highlight(request, collect)).toBeNull();
    }).then(() => {
      const colors = new Set(results.flatMap((result) =>
        result.tokens.flatMap((line) => line.map((token) => token.color)),
      ));

      expect(results).toHaveLength(2);
      expect(results[0]).toBe(results[1]);
      expect([...colors]).toEqual(expect.arrayContaining(['#F97583', '#E1E4E8']));
      expect(results[0]?.tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(request.code);
    });
  });
});
