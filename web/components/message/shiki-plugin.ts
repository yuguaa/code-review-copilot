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
const supportedLanguageIds = new Set<string>(Object.keys(bundledLanguages));
const languageAliases = new Map<string, BundledLanguage>();

for (const info of bundledLanguagesInfo) {
  languageAliases.set(info.id.toLowerCase(), info.id as BundledLanguage);
  for (const alias of info.aliases ?? []) {
    languageAliases.set(alias.toLowerCase(), info.id as BundledLanguage);
  }
}

let highlighterPromise: Promise<Highlighter> | null = null;
const resultCache = new Map<string, HighlightResult>();
const pendingKeys = new Set<string>();
const loadingLanguages = new Map<BundledLanguage, Promise<void>>();

function normalizeLanguage(language: string): BundledLanguage | 'text' {
  const raw = language.trim().toLowerCase();
  if (plainLanguages.has(raw)) return 'text';
  return languageAliases.get(raw) ?? (supportedLanguageIds.has(raw) ? (raw as BundledLanguage) : 'text');
}

function highlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      langs: ['bash', 'css', 'diff', 'html', 'javascript', 'json', 'jsx', 'markdown', 'python', 'shell', 'tsx', 'typescript', 'vue', 'yaml'],
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

export const shikiCodeHighlighter: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => Object.keys(bundledLanguages) as BundledLanguage[],
  getThemes: () => defaultThemes,
  supportsLanguage: (language) => normalizeLanguage(language) !== 'text' || plainLanguages.has(language),
  highlight: ({ code, language, themes }, callback) => {
    const lang = normalizeLanguage(language);
    const key = cacheKey(code, lang, themes);
    const cached = resultCache.get(key);
    if (cached) return cached;
    if (lang === 'text') return null;

    if (!pendingKeys.has(key)) {
      pendingKeys.add(key);
      highlighter()
        .then((instance) => ensureLanguage(instance, lang).then(() => instance))
        .then((instance) => {
          const next = toHighlightResult(
            instance.codeToTokens(code, {
              lang,
              theme: defaultThemes[0],
              tokenizeMaxLineLength: 600,
              tokenizeTimeLimit: 80,
            }),
          );
          resultCache.set(key, next);
          callback?.(next);
        })
        .catch(() => undefined)
        .finally(() => pendingKeys.delete(key));
    }

    return null;
  },
};
