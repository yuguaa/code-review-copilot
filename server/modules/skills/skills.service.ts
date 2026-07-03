import { prisma } from '../../infrastructure/prisma/prisma.service';

export const BUILTIN_SKILL_KEYS = [
  'brooks-review',
  'brooks-audit',
  'brooks-debt',
  'brooks-health',
  'brooks-test',
  'brooks-sweep',
] as const;

export type SkillKey = (typeof BUILTIN_SKILL_KEYS)[number];

export type BuiltinSkill = {
  key: SkillKey;
  name: string;
  description: string;
  mode: string;
  prompt: string;
  defaultEnabled: boolean;
};

export type SkillSettingsPayload = Array<{ key?: string; defaultEnabled?: boolean; isActive?: boolean }>;

const brooksBasePrompt = `## Brooks-Lint 审查框架
你必须按 brooks-lint 的 Iron Law 输出：先完成风险诊断，再给修复建议；每个 finding 必须包含 Symptom / Source / Consequence / Remedy。
诊断应覆盖六类生产代码衰退风险：R1 Cognitive Overload、R2 Change Propagation、R3 Knowledge Duplication、R4 Accidental Complexity、R5 Dependency Disorder、R6 Domain Model Distortion。
若涉及测试质量，再覆盖 T1–T6 测试衰退风险。所有结论必须有代码证据，不要只引用书名造势。`;

export const builtinSkills: BuiltinSkill[] = [
  {
    key: 'brooks-review',
    name: 'Brooks PR Review',
    description: '基于 brooks-lint 的 PR/diff 衰退风险审查。',
    mode: 'review',
    defaultEnabled: true,
    prompt: `${brooksBasePrompt}
模式：PR Review。
对本次 diff 执行 brooks-lint 风格审查：按严重度排序，输出健康分 0–100，并只报告真实影响可定位的衰退风险。`,
  },
  {
    key: 'brooks-audit',
    name: 'Brooks Architecture Audit',
    description: '基于 brooks-lint 的架构与模块依赖审计。',
    mode: 'review',
    defaultEnabled: false,
    prompt: `${brooksBasePrompt}
模式：Architecture Audit。
审查模块边界、依赖方向、循环依赖、分层完整性和测试接缝。需要时在报告前给 Mermaid 模块依赖图。`,
  },
  {
    key: 'brooks-debt',
    name: 'Brooks Tech Debt',
    description: '基于 brooks-lint 的技术债分类与优先级评估。',
    mode: 'review',
    defaultEnabled: false,
    prompt: `${brooksBasePrompt}
模式：Tech Debt Assessment。
识别并按 Pain × Spread 给技术债排序，说明哪些债务最值得先还，避免把局部风格问题夸大成债务。`,
  },
  {
    key: 'brooks-health',
    name: 'Brooks Health Dashboard',
    description: '基于 brooks-lint 的综合代码健康评分。',
    mode: 'review',
    defaultEnabled: false,
    prompt: `${brooksBasePrompt}
模式：Health Dashboard。
给出 PR 质量、架构、技术债、测试质量四个维度的简版健康评分和综合健康分。`,
  },
  {
    key: 'brooks-test',
    name: 'Brooks Test Quality',
    description: '基于 brooks-lint 的测试套件质量审查。',
    mode: 'review',
    defaultEnabled: false,
    prompt: `${brooksBasePrompt}
模式：Test Quality Review。
重点诊断测试脆弱性、mock 滥用、覆盖幻觉、慢测试、不可诊断失败和夹具过载。`,
  },
  {
    key: 'brooks-sweep',
    name: 'Brooks Full Sweep',
    description: '基于 brooks-lint 的全维度扫描与修复模式；因涉及写代码默认禁用。',
    mode: 'review',
    defaultEnabled: false,
    prompt: `${brooksBasePrompt}
模式：Full Sweep。
只允许输出诊断和修复计划；本平台不授予写文件工具，因此不得声称已自动修复。`,
  },
];

export type SkillState = BuiltinSkill[];

export function assertKnownSkillKeys(keys: unknown[], allowedKeys: Set<string>) {
  for (const key of keys) {
    if (typeof key === 'string' && !allowedKeys.has(key)) throw new Error(`未知 Skill：${key}`);
  }
}

export function filterSkillKeys(keys: unknown[]): Set<string> {
  return new Set(keys.filter((key): key is string => typeof key === 'string'));
}

export async function syncBuiltinSkills() {
  await Promise.all(
    builtinSkills.map((item) =>
      prisma.agentSkill.upsert({
        where: { key: item.key },
        create: { ...item, builtin: true, isActive: true },
        update: { name: item.name, description: item.description, mode: item.mode, prompt: item.prompt, builtin: true },
      }),
    ),
  );
}

export async function listActiveSkills() {
  await syncBuiltinSkills();
  return prisma.agentSkill.findMany({
    where: { isActive: true },
    orderBy: [{ mode: 'asc' }, { key: 'asc' }],
  });
}

export async function listSkillSettings() {
  const skills = await listActiveSkills();
  return skills.map((item) => ({
    id: item.id,
    key: item.key,
    name: item.name,
    description: item.description,
    mode: item.mode,
    defaultEnabled: item.defaultEnabled,
    builtin: item.builtin,
    isActive: item.isActive,
  }));
}

export async function updateSkillSettings(skills: SkillSettingsPayload) {
  await syncBuiltinSkills();
  await Promise.all(
    (Array.isArray(skills) ? skills : [])
      .filter((item) => item.key)
      .map((item) =>
        prisma.agentSkill.update({
          where: { key: item.key },
          data: {
            ...(item.defaultEnabled !== undefined ? { defaultEnabled: item.defaultEnabled } : {}),
            ...(item.isActive !== undefined ? { isActive: item.isActive } : {}),
          },
        }),
      ),
  );
}

export async function resolveRepositorySkills(repositoryId: string): Promise<SkillState> {
  await syncBuiltinSkills();
  const skills = await prisma.agentSkill.findMany({
    where: { isActive: true },
    include: { repoSettings: { where: { repositoryId }, select: { enabled: true } } },
  });

  return skills
    .filter((item) => item.repoSettings[0]?.enabled ?? item.defaultEnabled)
    .map((item) => ({
      key: item.key as SkillKey,
      name: item.name,
      description: item.description,
      mode: item.mode,
      prompt: item.prompt,
      defaultEnabled: item.defaultEnabled,
    }));
}

export function renderSkillInstructions(skills: Pick<BuiltinSkill, 'name' | 'prompt'>[]): string {
  if (skills.length === 0) return '';
  return [
    '## 启用的仓库 Skills',
    '以下 skill 是本仓库配置启用的审查方法，必须并入本轮审查标准：',
    ...skills.map((skill) => `### ${skill.name}\n${skill.prompt}`),
  ].join('\n\n');
}
