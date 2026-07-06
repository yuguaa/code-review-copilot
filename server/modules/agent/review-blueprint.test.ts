import { describe, expect, it } from 'vitest';
import { BLUEPRINT_INSTRUCTIONS, parseReviewBlueprint, renderReviewBlueprint } from './review-blueprint';

describe('review blueprint', () => {
  it('解析简单低风险蓝图时不建议 subagents', () => {
    const blueprint = parseReviewBlueprint(
      JSON.stringify({
        scope: ['web/components/ui/surface.tsx'],
        riskAreas: ['样式表层改动，低风险'],
        requiredEvidence: ['确认 Card children/className 仍透传'],
        delegatePlan: [],
        verificationChecklist: ['确认没有业务逻辑变更'],
      }),
    );

    expect(blueprint.delegatePlan).toEqual([]);
    expect(renderReviewBlueprint(blueprint)).toContain('web/components/ui/surface.tsx');
  });

  it('安全/架构/性能风险明确时保留 subagent 计划', () => {
    const blueprint = parseReviewBlueprint(`前置说明
{
  "scope": ["server/modules/agent"],
  "riskAreas": ["鉴权边界变化", "多智能体流程变化", "重复读取大 diff"],
  "requiredEvidence": ["检查工具权限", "检查副作用顺序"],
  "delegatePlan": ["security", "architecture", "performance"],
  "verificationChecklist": ["逐条核验行号"]
}`);

    expect(blueprint.delegatePlan).toEqual(['security', 'architecture', 'performance']);
    expect(blueprint.riskAreas).toContain('鉴权边界变化');
  });

  it('蓝图 agent 不把单次反馈作为证据', () => {
    expect(BLUEPRINT_INSTRUCTIONS).toContain('用户反馈阈值沉淀');
    expect(BLUEPRINT_INSTRUCTIONS).toContain('单次 findingFeedbacks 不是证据');
  });
});
