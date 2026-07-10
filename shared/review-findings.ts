export const reviewFindingSeverities = ['严重', '一般', '建议'] as const;

export type ReviewFindingSeverity = (typeof reviewFindingSeverities)[number];

export type ParsedReviewFinding = {
  id: string;
  severity: ReviewFindingSeverity;
  title: string;
  markdown: string;
};

export type ReviewFileReference = {
  path: string;
  line: number;
};

export const verifiedReviewPartKind = 'verified-review' as const;

export type VerifiedReviewPart = {
  type: 'text';
  text: string;
  reviewPartKind: typeof verifiedReviewPartKind;
};

const severityHeadings = new Set<string>(reviewFindingSeverities);
const detailLabelPattern = /^(?:位置|问题|影响|修复建议|症状|来源|后果|建议|symptom|source|consequence|remedy)\s*(?:（[^）]*）)?\s*[:：]/i;
const fileReferencePattern = /(?:^|[\s`])(?:(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]+|[\w.-]+\.(?:ts|tsx|js|jsx|vue|css|scss|less|json|md|ya?ml|toml|lock|txt|prisma|sql|go|py|java|kt|rs|php|rb|sh)|Dockerfile|Makefile):\d+/i;
const fileReferenceGlobalPattern = /(?:^|[\s`、，,(（])((?:(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]+|[\w.-]+\.(?:ts|tsx|js|jsx|vue|css|scss|less|json|md|ya?ml|toml|lock|txt|prisma|sql|go|py|java|kt|rs|php|rb|sh)|Dockerfile|Makefile):(\d+))/gim;
const pathFindingPattern = /^(?:(?:[\w.-]+\/)+|Dockerfile\b|Makefile\b)[^：:]*[：:]/i;

type ParsedListItem = {
  indent: number;
  text: string;
  lineIndex: number;
};

export function parseReviewFindings(text: string): ParsedReviewFinding[] {
  const findings: ParsedReviewFinding[] = [];
  const lines = text.split('\n');

  for (let index = 0; index < lines.length;) {
    const severity = headingOf(lines[index]);
    if (!severity) {
      index += 1;
      continue;
    }

    const sectionStart = index + 1;
    let sectionEnd = sectionStart;
    while (sectionEnd < lines.length && !isReviewSectionBoundary(lines[sectionEnd])) sectionEnd += 1;
    const items = lines
      .slice(sectionStart, sectionEnd)
      .map((line, offset) => listItemOf(line, sectionStart + offset))
      .filter((item): item is ParsedListItem => item !== null);
    const topLevelIndent = Math.min(...items.filter((item) => !isDetailItem(item.text)).map((item) => item.indent));
    const topLevelItems = items.filter((item) => item.indent === topLevelIndent && !isDetailItem(item.text));

    for (let itemIndex = 0; itemIndex < topLevelItems.length; itemIndex += 1) {
      const item = topLevelItems[itemIndex];
      const nextLine = topLevelItems[itemIndex + 1]?.lineIndex ?? sectionEnd;
      const blockItems = items.filter((candidate) => candidate.lineIndex > item.lineIndex && candidate.lineIndex < nextLine);
      const hasStructuredDetails = blockItems.some((child) => child.indent > item.indent && isDetailItem(child.text));
      if (!hasStructuredDetails && !isStandaloneFinding(item.text)) continue;

      const title = cleanFindingLabel(item.text);
      if (normalizeFindingText(title).length < 4) continue;
      findings.push({
        id: `${severity}-${findings.length}`,
        severity,
        title,
        markdown: lines.slice(item.lineIndex, nextLine).join('\n').trim(),
      });
    }
    index = sectionEnd;
  }

  return findings;
}

export function normalizeFindingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function isVerifiedReviewPart(part: unknown): part is VerifiedReviewPart {
  if (!part || typeof part !== 'object') return false;
  const record = part as { type?: unknown; text?: unknown; reviewPartKind?: unknown };
  return record.type === 'text'
    && typeof record.text === 'string'
    && record.reviewPartKind === verifiedReviewPartKind;
}

export function hasReviewFileReference(text: string): boolean {
  return fileReferencePattern.test(stripMarkdownDecoration(text));
}

export function extractReviewFileReferences(text: string): ReviewFileReference[] {
  const references = [...text.matchAll(fileReferenceGlobalPattern)].map((match) => ({
    path: match[1].slice(0, match[1].lastIndexOf(':')),
    line: Number(match[2]),
  }));
  return references.filter((reference, index) =>
    references.findIndex((candidate) => candidate.path === reference.path && candidate.line === reference.line) === index,
  );
}

export function isExplicitNoFindingReview(text: string): boolean {
  if (parseReviewFindings(text).length > 0 || hasReviewFileReference(text)) return false;
  const normalized = text.replace(/[*_`：:]/g, '').replace(/\s+/g, ' ');
  return reviewFindingSeverities.every((severity) => normalized.includes(severity))
    && /未发现需要阻塞的实质问题|未发现严重问题/.test(normalized)
    && /未发现一般问题|未发现需要单列的一般问题/.test(normalized)
    && /暂无/.test(normalized);
}

function headingOf(line: string): ReviewFindingSeverity | null {
  const text = line.replace(/^#+\s*/, '').replace(/[*_`：:]/g, '').trim();
  return severityHeadings.has(text) ? text as ReviewFindingSeverity : null;
}

function isReviewSectionBoundary(line: string): boolean {
  return headingOf(line) !== null || /^\s*#{1,2}\s+\S/.test(line);
}

function listItemOf(line: string, lineIndex: number): ParsedListItem | null {
  const match = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/);
  if (!match?.[2]) return null;
  return {
    indent: (match[1] ?? '').replace(/\t/g, '    ').length,
    text: match[2].trim(),
    lineIndex,
  };
}

function isDetailItem(text: string): boolean {
  return detailLabelPattern.test(stripMarkdownDecoration(text));
}

function isStandaloneFinding(text: string): boolean {
  const plain = stripMarkdownDecoration(text);
  return /^\*\*.+\*\*/.test(text.trim()) || hasReviewFileReference(plain) || pathFindingPattern.test(plain) || /(?:问题|风险)\s*[:：]/.test(plain);
}

function cleanFindingLabel(text: string): string {
  return stripMarkdownDecoration(text).replace(/\s*[:：]\s*$/, '').trim();
}

function stripMarkdownDecoration(text: string): string {
  return text
    .replace(/^\*\*(.+?)\*\*\s*$/, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}
