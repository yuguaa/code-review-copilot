import type { GitLabDiff, ReviewComment } from "@/lib/types";

const MIN_FINDING_CONFIDENCE = 0.6;

type FindingRejectionReason = "low_confidence" | "file_not_in_diff" | "invalid_line_range";

export type ReviewFindingValidationReport<T extends ReviewComment> = {
  accepted: T[];
  rejected: Array<{
    finding: T;
    reason: FindingRejectionReason;
  }>;
  counts: Record<FindingRejectionReason, number>;
};

type DiffLineType = "new" | "old";

type DiffLineLocation = {
  type: DiffLineType;
  lineNumber: number;
};

type DiffIndexEntry = {
  diff: GitLabDiff;
  reviewPath: string;
  lineLocations: DiffLineLocation[];
};

function getReviewPath(diff: GitLabDiff): string {
  return diff.deleted_file ? diff.old_path : diff.new_path;
}

function parseHunkHeader(line: string): { oldLine: number; newLine: number } | null {
  const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[2]),
  };
}

function collectDiffLineLocations(diffText: string): DiffLineLocation[] {
  const locations: DiffLineLocation[] = [];
  let oldLine = 0;
  let newLine = 0;

  diffText.split("\n").forEach((line) => {
    const hunk = parseHunkHeader(line);
    if (hunk) {
      oldLine = hunk.oldLine;
      newLine = hunk.newLine;
      return;
    }

    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("\\")) {
      return;
    }

    if (line.startsWith("+")) {
      locations.push({ type: "new", lineNumber: newLine });
      newLine += 1;
      return;
    }

    if (line.startsWith("-")) {
      locations.push({ type: "old", lineNumber: oldLine });
      oldLine += 1;
      return;
    }

    if (line.startsWith(" ")) {
      locations.push({ type: "old", lineNumber: oldLine });
      locations.push({ type: "new", lineNumber: newLine });
      oldLine += 1;
      newLine += 1;
    }
  });

  return locations.filter((location) => Number.isInteger(location.lineNumber) && location.lineNumber > 0);
}

function buildDiffIndex(diffs: GitLabDiff[]): Map<string, DiffIndexEntry> {
  return diffs.reduce((index, diff) => {
    const reviewPath = getReviewPath(diff);
    index.set(reviewPath, {
      diff,
      reviewPath,
      lineLocations: collectDiffLineLocations(diff.diff),
    });
    return index;
  }, new Map<string, DiffIndexEntry>());
}

function isLineInDiff(entry: DiffIndexEntry, lineNumber: number): boolean {
  const allowedLineTypes: DiffLineType[] = entry.diff.deleted_file ? ["old"] : ["new", "old"];
  return entry.lineLocations.some((location) => (
    allowedLineTypes.includes(location.type) &&
    location.lineNumber === lineNumber
  ));
}

function isLineRangeValid(entry: DiffIndexEntry, lineNumber: number, lineRangeEnd?: number): boolean {
  if (!Number.isInteger(lineNumber) || lineNumber <= 0) return false;
  if (lineRangeEnd !== undefined && (!Number.isInteger(lineRangeEnd) || lineRangeEnd < lineNumber)) {
    return false;
  }

  if (!isLineInDiff(entry, lineNumber)) return false;
  if (lineRangeEnd === undefined) return true;

  for (let line = lineNumber; line <= lineRangeEnd; line += 1) {
    if (!isLineInDiff(entry, line)) return false;
  }
  return true;
}

function createEmptyRejectionCounts(): Record<FindingRejectionReason, number> {
  return {
    low_confidence: 0,
    file_not_in_diff: 0,
    invalid_line_range: 0,
  };
}

export function getReviewFilePath(diff: GitLabDiff): string {
  return getReviewPath(diff);
}

export function getReviewableDiffs(diffs: GitLabDiff[]): GitLabDiff[] {
  return diffs.filter((diff) => Boolean(getReviewPath(diff)));
}

export function validateReviewFindings<T extends ReviewComment>(
  findings: T[],
  diffs: GitLabDiff[],
  options?: { minConfidence?: number },
): T[] {
  return validateReviewFindingsWithReport(findings, diffs, options).accepted;
}

export function validateReviewFindingsWithReport<T extends ReviewComment>(
  findings: T[],
  diffs: GitLabDiff[],
  options?: { minConfidence?: number },
): ReviewFindingValidationReport<T> {
  const minConfidence = options?.minConfidence ?? MIN_FINDING_CONFIDENCE;
  const diffIndex = buildDiffIndex(diffs);
  const accepted: T[] = [];
  const rejected: ReviewFindingValidationReport<T>["rejected"] = [];
  const counts = createEmptyRejectionCounts();

  findings.forEach((finding) => {
    const confidence = finding.confidence ?? 0.5;
    if (!Number.isFinite(confidence) || confidence < minConfidence) {
      counts.low_confidence += 1;
      rejected.push({ finding, reason: "low_confidence" });
      return;
    }

    const entry = diffIndex.get(finding.filePath);
    if (!entry) {
      counts.file_not_in_diff += 1;
      rejected.push({ finding, reason: "file_not_in_diff" });
      return;
    }

    if (!isLineRangeValid(entry, finding.lineNumber, finding.lineRangeEnd)) {
      counts.invalid_line_range += 1;
      rejected.push({ finding, reason: "invalid_line_range" });
      return;
    }

    accepted.push(finding);
  });

  return { accepted, rejected, counts };
}
