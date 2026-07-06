import { prisma } from '../../infrastructure/prisma/prisma.service';

export const BUILTIN_TOOL_KEYS = [
  'bash',
  'read_file',
  'read_memory',
  'git_diff',
  'write_memory',
  'post_review_comment',
  'post_inline_comment',
  'record_evidence',
  'delegate_security',
  'delegate_architecture',
  'delegate_performance',
] as const;

export type ToolKey = (typeof BUILTIN_TOOL_KEYS)[number];

type BuiltinTool = {
  key: ToolKey;
  name: string;
  description: string;
  category: string;
  defaultEnabled: boolean;
};

export type ToolSettingsPayload = Array<{ key?: string; defaultEnabled?: boolean; isActive?: boolean }>;

export const builtinTools: BuiltinTool[] = [
  { key: 'bash', name: '只读命令', description: '在仓库工作区执行 grep/rg/find/cat/sed/git log 等只读探索命令。', category: 'read', defaultEnabled: true },
  { key: 'read_file', name: '读取文件', description: '读取工作区内文本文件的完整内容。', category: 'read', defaultEnabled: true },
  { key: 'read_memory', name: '读取项目记忆', description: '读取本仓库跨次审查沉淀的项目记忆。', category: 'memory', defaultEnabled: true },
  { key: 'git_diff', name: '查看审查变更', description: '查看本次 MR/Push 审查对应的 git diff。', category: 'read', defaultEnabled: true },
  { key: 'write_memory', name: '更新项目记忆', description: '审查结束后更新本仓库项目记忆。', category: 'memory', defaultEnabled: true },
  { key: 'post_review_comment', name: '发布总评评论', description: '把审查总评发布到 GitLab MR 或 Push commit。', category: 'publish', defaultEnabled: true },
  { key: 'post_inline_comment', name: '发布行级评论', description: '把问题精准发布到 MR/commit 的指定文件行。', category: 'publish', defaultEnabled: true },
  { key: 'record_evidence', name: '记录运行期证据', description: '把本轮审查已确认的证据写入运行期 CodeMem，供 verify loop 复核。', category: 'memory', defaultEnabled: true },
  { key: 'delegate_security', name: '安全专项委派', description: '委派安全专项 Agent 独立复核注入、鉴权、敏感信息等风险。', category: 'delegate', defaultEnabled: true },
  { key: 'delegate_architecture', name: '架构专项委派', description: '委派架构专项 Agent 独立复核分层、依赖、职责和可维护性。', category: 'delegate', defaultEnabled: true },
  { key: 'delegate_performance', name: '性能专项委派', description: '委派性能专项 Agent 独立复核查询、IO、内存和前端性能风险。', category: 'delegate', defaultEnabled: true },
];

function asToolKey(key: string): ToolKey | null {
  return (BUILTIN_TOOL_KEYS as readonly string[]).includes(key) ? (key as ToolKey) : null;
}

export function assertKnownToolKeys(keys: unknown[], allowedKeys: Set<string>) {
  for (const key of keys) {
    if (typeof key === 'string' && !allowedKeys.has(key)) throw new Error(`未知 Tool：${key}`);
  }
}

export function filterToolKeys(keys: unknown[]): Set<string> {
  return new Set(keys.filter((key): key is string => typeof key === 'string'));
}

export async function syncBuiltinTools() {
  await Promise.all(
    builtinTools.map((item) =>
      prisma.agentTool.upsert({
        where: { key: item.key },
        create: { ...item, builtin: true, isActive: true },
        update: { name: item.name, description: item.description, category: item.category, builtin: true },
      }),
    ),
  );
}

export async function listActiveTools() {
  await syncBuiltinTools();
  return prisma.agentTool.findMany({
    where: { isActive: true },
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });
}

export async function listToolSettings() {
  const tools = await listActiveTools();
  return tools.map((item) => ({
    id: item.id,
    key: item.key,
    name: item.name,
    description: item.description,
    category: item.category,
    defaultEnabled: item.defaultEnabled,
    builtin: item.builtin,
    isActive: item.isActive,
  }));
}

export async function updateToolSettings(tools: ToolSettingsPayload) {
  await syncBuiltinTools();
  await Promise.all(
    (Array.isArray(tools) ? tools : [])
      .filter((item) => item.key)
      .map((item) =>
        prisma.agentTool.update({
          where: { key: item.key },
          data: {
            ...(item.defaultEnabled !== undefined ? { defaultEnabled: item.defaultEnabled } : {}),
            ...(item.isActive !== undefined ? { isActive: item.isActive } : {}),
          },
        }),
      ),
  );
}

export async function resolveRepositoryTools(repositoryId: string): Promise<Set<ToolKey>> {
  await syncBuiltinTools();
  const tools = await prisma.agentTool.findMany({
    where: { isActive: true },
    include: { repoSettings: { where: { repositoryId }, select: { enabled: true } } },
  });

  return new Set(
    tools
      .filter((item) => item.repoSettings[0]?.enabled ?? item.defaultEnabled)
      .map((item) => asToolKey(item.key))
      .filter((key): key is ToolKey => key !== null),
  );
}
