export interface AgentLoopBudget {
  maxIterations: number;
  maxContextFiles: number;
  maxCallGraphDepth: number;
  maxFindings: number;
}

export const DEFAULT_AGENT_LOOP_BUDGET: AgentLoopBudget = {
  maxIterations: 5,
  maxContextFiles: 12,
  maxCallGraphDepth: 2,
  maxFindings: 50,
};

const BUDGET_LIMITS = {
  maxIterations: { min: 1, max: 10 },
  maxContextFiles: { min: 1, max: 200 },
  maxCallGraphDepth: { min: 0, max: 4 },
  maxFindings: { min: 1, max: 200 },
} as const;

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numberValue)));
}

export function normalizeAgentLoopBudget(budget?: Partial<AgentLoopBudget>): AgentLoopBudget {
  return {
    maxIterations: clampInteger(
      budget?.maxIterations,
      DEFAULT_AGENT_LOOP_BUDGET.maxIterations,
      BUDGET_LIMITS.maxIterations.min,
      BUDGET_LIMITS.maxIterations.max,
    ),
    maxContextFiles: clampInteger(
      budget?.maxContextFiles,
      DEFAULT_AGENT_LOOP_BUDGET.maxContextFiles,
      BUDGET_LIMITS.maxContextFiles.min,
      BUDGET_LIMITS.maxContextFiles.max,
    ),
    maxCallGraphDepth: clampInteger(
      budget?.maxCallGraphDepth,
      DEFAULT_AGENT_LOOP_BUDGET.maxCallGraphDepth,
      BUDGET_LIMITS.maxCallGraphDepth.min,
      BUDGET_LIMITS.maxCallGraphDepth.max,
    ),
    maxFindings: clampInteger(
      budget?.maxFindings,
      DEFAULT_AGENT_LOOP_BUDGET.maxFindings,
      BUDGET_LIMITS.maxFindings.min,
      BUDGET_LIMITS.maxFindings.max,
    ),
  };
}

export function totalFindingsBudget(budgets: Array<Partial<AgentLoopBudget>>): number {
  const total = budgets.reduce((sum, budget) => {
    return sum + normalizeAgentLoopBudget(budget).maxFindings;
  }, 0);
  return clampInteger(total, DEFAULT_AGENT_LOOP_BUDGET.maxFindings, 1, 500);
}
