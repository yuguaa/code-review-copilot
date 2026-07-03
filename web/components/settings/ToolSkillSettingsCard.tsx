import { ToolSkillList } from '../ToolSkillList';
import { Button, Card } from '../ui';
import type { AgentSkillItem, AgentToolItem } from '../../lib/types';

export function ToolSkillSettingsCard({
  tools,
  skills,
  enabledTools,
  enabledSkills,
  saving,
  onToolsChange,
  onSkillsChange,
  onSave,
}: {
  tools: AgentToolItem[];
  skills: AgentSkillItem[];
  enabledTools: string[];
  enabledSkills: string[];
  saving: boolean;
  onToolsChange: (next: string[]) => void;
  onSkillsChange: (next: string[]) => void;
  onSave: () => void;
}) {
  return (
    <Card className="space-y-4">
      <h2 className="font-display text-lg text-[var(--ink)]">Tools / Skills 管理</h2>
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        这里控制平台默认启用能力；仓库配置里可以再覆盖。`brooks-sweep` 默认关闭，因为它是修复模式，本平台目前不授予写文件工具。
      </p>
      <ToolSkillList title="Tools 默认启用" items={tools} selected={enabledTools} onChange={onToolsChange} />
      <ToolSkillList title="Skills 默认启用" items={skills} selected={enabledSkills} onChange={onSkillsChange} />
      <Button onClick={onSave} disabled={saving}>
        {saving ? '保存中…' : '保存 Tools / Skills'}
      </Button>
    </Card>
  );
}
