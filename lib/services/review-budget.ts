export interface PiReviewLimits {
  maxFindings: number;
}

export const DEFAULT_PI_REVIEW_LIMITS: PiReviewLimits = {
  maxFindings: 50,
};

const PI_REVIEW_LIMITS = {
  maxFindings: { min: 1, max: 200 },
} as const;

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numberValue)));
}

export function normalizePiReviewLimits(limits?: Partial<PiReviewLimits>): PiReviewLimits {
  return {
    maxFindings: clampInteger(
      limits?.maxFindings,
      DEFAULT_PI_REVIEW_LIMITS.maxFindings,
      PI_REVIEW_LIMITS.maxFindings.min,
      PI_REVIEW_LIMITS.maxFindings.max,
    ),
  };
}

export function totalFindingsLimit(limits: Array<Partial<PiReviewLimits>>): number {
  const total = limits.reduce((sum, limit) => {
    return sum + normalizePiReviewLimits(limit).maxFindings;
  }, 0);
  return clampInteger(total, DEFAULT_PI_REVIEW_LIMITS.maxFindings, 1, 500);
}
