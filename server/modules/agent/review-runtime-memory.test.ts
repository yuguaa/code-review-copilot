import { describe, expect, it } from 'vitest';
import { createReviewRuntimeMemory, recordRuntimeEvidence, renderReviewRuntimeMemory } from './review-runtime-memory';

describe('review runtime memory', () => {
  it('记录本轮证据并去重，不写入仓库长期记忆', () => {
    const memory = createReviewRuntimeMemory();
    recordRuntimeEvidence(memory, {
      fileSummary: 'tools.ts 暴露只读工具',
      evidence: 'tools.ts:120 read_memory 只读',
      dependencyNote: 'verify loop 复用 buildReadTools',
    });
    recordRuntimeEvidence(memory, {
      evidence: 'tools.ts:120 read_memory 只读',
      delegateFinding: '安全专项：未发现越权',
    });

    expect(memory.evidenceItems).toEqual(['tools.ts:120 read_memory 只读']);
    expect(renderReviewRuntimeMemory(memory)).toContain('这只代表本轮审查已记录的取证材料，不是仓库级长期记忆');
    expect(renderReviewRuntimeMemory(memory)).toContain('安全专项：未发现越权');
  });
});
