import type { CodeHighlighterPlugin, ThemeInput } from 'streamdown';
import {
  bundledLanguages,
  bundledLanguagesInfo,
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
} from 'shiki/bundle/web';
import type { TokensResult } from 'shiki';

type HighlightResult = NonNullable<ReturnType<CodeHighlighterPlugin['highlight']>>;

const defaultThemes: [BundledTheme, BundledTheme] = ['github-dark', 'github-dark'];
const plainLanguages = new Set(['', 'text', 'txt', 'plain', 'plaintext']);
const supportedLanguageIds = new Set<BundledLanguage>(
  Object.entries(bundledLanguages)
    .filter(([, loader]) => typeof loader === 'function')
    .map(([id]) => id as BundledLanguage),
);
const languageAliases = new Map<string, BundledLanguage>();

for (const info of bundledLanguagesInfo) {
  if (!supportedLanguageIds.has(info.id as BundledLanguage)) continue;
  languageAliases.set(info.id.toLowerCase(), info.id as BundledLanguage);
  for (const alias of info.aliases ?? []) {
    languageAliases.set(alias.toLowerCase(), info.id as BundledLanguage);
  }
}

let highlighterPromise: Promise<Highlighter> | null = null;
const resultCache = new Map<string, HighlightResult>();
const pendingResults = new Map<string, Promise<HighlightResult | null>>();
const loadingLanguages = new Map<BundledLanguage, Promise<void>>();

function normalizeLanguage(language: string): BundledLanguage | 'text' {
  const raw = language.trim().toLowerCase();
  if (plainLanguages.has(raw)) return 'text';
  return languageAliases.get(raw) ?? (supportedLanguageIds.has(raw as BundledLanguage) ? (raw as BundledLanguage) : 'text');
}

function highlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: ['bash', 'css', 'html', 'javascript', 'json', 'jsx', 'markdown', 'python', 'shell', 'tsx', 'typescript', 'vue', 'yaml'],
      themes: defaultThemes,
    });
  }
  return highlighterPromise;
}

function ensureLanguage(instance: Highlighter, language: BundledLanguage) {
  if (instance.getLoadedLanguages().includes(language)) return Promise.resolve();
  const loading = loadingLanguages.get(language);
  if (loading) return loading;
  const next = instance.loadLanguage(language).finally(() => loadingLanguages.delete(language));
  loadingLanguages.set(language, next);
  return next;
}

function cacheKey(code: string, language: string, themes: [ThemeInput, ThemeInput]) {
  return JSON.stringify([language, themes[0], themes[1], code]);
}

function toHighlightResult(result: TokensResult): HighlightResult {
  return {
    bg: result.bg,
    fg: result.fg,
    rootStyle: result.rootStyle,
    tokens: result.tokens.map((line) =>
      line.map((token) => ({
        bgColor: token.bgColor,
        color: token.color,
        content: token.content,
        htmlAttrs: token.htmlAttrs,
        htmlStyle: token.htmlStyle,
        offset: token.offset,
      })),
    ),
  };
}

function loadHighlightResult(
  code: string,
  language: BundledLanguage,
  key: string,
): Promise<HighlightResult | null> {
  const pending = pendingResults.get(key);
  if (pending) return pending;

  const next = highlighter()
    .then((instance) => ensureLanguage(instance, language).then(() => instance))
    .then((instance) => toHighlightResult(
      instance.codeToTokens(code, {
        lang: language,
        theme: defaultThemes[0],
        tokenizeMaxLineLength: 600,
        tokenizeTimeLimit: 80,
      }),
    ))
    .then((result) => {
      resultCache.set(key, result);
      return result;
    })
    .catch((error) => {
      console.error('代码高亮失败', error);
      return null;
    })
    .finally(() => pendingResults.delete(key));

  pendingResults.set(key, next);
  return next;
}

export const shikiCodeHighlighter: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => [...supportedLanguageIds],
  getThemes: () => defaultThemes,
  supportsLanguage: (language) => normalizeLanguage(language) !== 'text' || plainLanguages.has(language),
  highlight: ({ code, language, themes }, callback) => {
    const lang = normalizeLanguage(language);
    const key = cacheKey(code, lang, themes);
    const cached = resultCache.get(key);
    if (cached) return cached;
    if (lang === 'text') return null;

    loadHighlightResult(code, lang, key).then((result) => {
      if (result) callback?.(result);
    });

    return null;
  },
};
