export type ReviewRuntimeMemory = {
  fileSummaries: string[];
  evidenceItems: string[];
  dependencyNotes: string[];
  delegateFindings: string[];
};

export function createReviewRuntimeMemory(): ReviewRuntimeMemory {
  return {
    fileSummaries: [],
    evidenceItems: [],
    dependencyNotes: [],
    delegateFindings: [],
  };
}

function pushUnique(items: string[], value: string) {
  const text = value.trim();
  if (!text || items.includes(text)) return;
  items.push(text);
}

export function recordRuntimeEvidence(
  memory: ReviewRuntimeMemory,
  input: {
    fileSummary?: string;
    evidence?: string;
    dependencyNote?: string;
    delegateFinding?: string;
  },
) {
  if (input.fileSummary) pushUnique(memory.fileSummaries, input.fileSummary);
  if (input.evidence) pushUnique(memory.evidenceItems, input.evidence);
  if (input.dependencyNote) pushUnique(memory.dependencyNotes, input.dependencyNote);
  if (input.delegateFinding) pushUnique(memory.delegateFindings, input.delegateFinding);
}

function section(title: string, items: string[]): string {
  if (!items.length) return `${title}\n- 暂无`;
  return `${title}\n${items.map((item) => `- ${item}`).join('\n')}`;
}

export function renderReviewRuntimeMemory(memory: ReviewRuntimeMemory): string {
  return [
    '## 运行期 CodeMem',
    '这只代表本轮审查已记录的取证材料，不是仓库级长期记忆。',
    section('### 关键文件摘要', memory.fileSummaries),
    section('### 已确认证据', memory.evidenceItems),
    section('### 调用关系与依赖笔记', memory.dependencyNotes),
    section('### Subagent 复核材料', memory.delegateFindings),
  ].join('\n\n');
}
