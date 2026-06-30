import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { matchesWatchBranches } from '../lib/branch-match';
import { runReviewSession } from '../agent/run-review';
import { createLogger } from '../lib/logger';
import { publishSessionListChanged } from '../lib/session-events';

const log = createLogger('webhook');
export const webhookRoutes = new Hono();

/** GitLab Merge Request Hook 载荷（仅取用到的字段）。 */
type MergeRequestHook = {
  object_kind: string;
  project: { id: number; path_with_namespace?: string };
  user?: { name?: string; username?: string };
  object_attributes: {
    iid: number;
    title: string;
    description?: string | null;
    source_branch: string;
    target_branch: string;
    action?: string; // open | reopen | update | merge | close | approved ...
    last_commit?: { id: string };
  };
};

/** GitLab Push Hook 载荷（仅取用到的字段）。 */
type PushHook = {
  object_kind: string;
  project: { id: number; path_with_namespace?: string };
  user_name?: string;
  user_username?: string;
  ref: string;
  before: string;
  after: string;
  checkout_sha?: string | null;
  total_commits_count?: number;
  commits?: Array<{
    id: string;
    message?: string;
    title?: string;
    author?: { name?: string; email?: string };
    timestamp?: string;
  }>;
};

const REVIEW_ACTIONS = new Set(['open', 'reopen', 'update']);
const ZERO_SHA = /^0{40}$/;

async function loadRepositoryForWebhook(projectId: number) {
  return prisma.repository.findFirst({
    where: { gitLabProjectId: projectId, isActive: true },
    include: { gitLabAccount: true },
  });
}

type RepositoryForWebhook = NonNullable<Awaited<ReturnType<typeof loadRepositoryForWebhook>>>;

webhookRoutes.post('/gitlab', async (c) => {
  const event = c.req.header('X-Gitlab-Event');
  const token = c.req.header('X-Gitlab-Token');

  if (event !== 'Merge Request Hook' && event !== 'Push Hook') {
    return c.json({ ignored: true, reason: `暂不处理事件：${event}` });
  }

  let body: MergeRequestHook | PushHook;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '无效的 webhook 载荷' }, 400);
  }

  const projectId = body.project?.id;
  if (!projectId) {
    return c.json({ error: '缺少 project.id' }, 400);
  }

  const repo = await loadRepositoryForWebhook(projectId);
  if (!repo) {
    return c.json({ ignored: true, reason: `未配置该项目（id=${projectId}）` });
  }

  const secret = repo.gitLabAccount.webhookSecret;
  if (secret && token !== secret) {
    log.warn(`webhook 验签失败 project=${projectId}`);
    return c.json({ error: '验签失败' }, 401);
  }

  if (!repo.autoReview) {
    return c.json({ ignored: true, reason: '该仓库未开启自动审查' });
  }

  return event === 'Merge Request Hook'
    ? handleMergeRequestHook(body as MergeRequestHook, repo)
    : handlePushHook(body as PushHook, repo);
});

async function handleMergeRequestHook(body: MergeRequestHook, repo: RepositoryForWebhook) {
  const attrs = body.object_attributes;
  if (!attrs?.iid) {
    return new Response(JSON.stringify({ error: '缺少 MR iid' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  if (attrs.action && !REVIEW_ACTIONS.has(attrs.action)) {
    return json({ ignored: true, reason: `忽略 MR action：${attrs.action}` });
  }
  if (!matchesWatchBranches(repo.watchBranches, attrs.target_branch)) {
    return json({ ignored: true, reason: `目标分支 ${attrs.target_branch} 不在监听范围` });
  }

  const commitSha = attrs.last_commit?.id ?? null;

  // 建审查会话 + 种子用户消息
  const session = await prisma.session.create({
    data: {
      kind: 'review',
      title: attrs.title,
      repositoryId: repo.id,
      mrIid: attrs.iid,
      mrTitle: attrs.title,
      sourceBranch: attrs.source_branch,
      targetBranch: attrs.target_branch,
      baseCommitSha: null,
      commitSha,
      author: body.user?.name ?? body.user?.username ?? null,
      status: 'running',
    },
  });

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: 'user',
      parts: [{ type: 'text', text: buildSeedPrompt(attrs) }],
    },
  });

  // 后台跑审查，不阻塞 GitLab 回调
  void runReviewSession(session.id);
  publishSessionListChanged();

  log.info(`已触发 MR 审查 project=${repo.gitLabProjectId} mr=!${attrs.iid} session=${session.id}`);
  return json({ triggered: true, kind: 'merge_request', sessionId: session.id });
}

async function handlePushHook(body: PushHook, repo: RepositoryForWebhook) {
  const branch = parseBranch(body.ref);
  const after = body.checkout_sha || body.after;
  if (!branch || !after || ZERO_SHA.test(after)) {
    return json({ ignored: true, reason: '忽略删除分支或无 checkout_sha 的 Push 事件' });
  }
  if (!body.before || ZERO_SHA.test(body.before)) {
    return json({ ignored: true, reason: '忽略新分支首次 Push（缺少有效 before sha）' });
  }
  if (!matchesWatchBranches(repo.watchBranches, branch)) {
    return json({ ignored: true, reason: `分支 ${branch} 不在监听范围` });
  }

  const title = buildPushTitle(branch, body);
  const session = await prisma.session.create({
    data: {
      kind: 'review',
      title,
      repositoryId: repo.id,
      mrIid: null,
      mrTitle: null,
      sourceBranch: branch,
      targetBranch: branch,
      baseCommitSha: body.before,
      commitSha: after,
      author: body.user_name ?? body.user_username ?? body.commits?.[0]?.author?.name ?? null,
      status: 'running',
    },
  });

  await prisma.message.create({
    data: {
      sessionId: session.id,
      role: 'user',
      parts: [{ type: 'text', text: buildPushSeedPrompt(branch, body) }],
    },
  });

  void runReviewSession(session.id);
  publishSessionListChanged();

  log.info(`已触发 Push 审查 project=${repo.gitLabProjectId} branch=${branch} session=${session.id}`);
  return json({ triggered: true, kind: 'push', sessionId: session.id });
}

/** 种子提示词：只给 MR 上下文，审查策略由 agent 自主决定（不写死步骤）。 */
function buildSeedPrompt(attrs: MergeRequestHook['object_attributes']): string {
  return [
    '请审查本次 Merge Request。工作区已就绪，当前目录即仓库根。',
    '',
    `- 标题：${attrs.title}`,
    attrs.description ? `- 描述：${attrs.description}` : '',
    `- 分支：${attrs.source_branch} → ${attrs.target_branch}`,
    attrs.last_commit?.id ? `- 最新提交：${attrs.last_commit.id}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPushSeedPrompt(branch: string, body: PushHook): string {
  const commits = body.commits?.slice(0, 10).map((c) => `  - ${c.id.slice(0, 8)} ${firstLine(c.message ?? c.title ?? '')}`).join('\n');
  return [
    '请审查本次 Push。工作区已就绪，当前目录即仓库根。',
    '',
    `- 分支：${branch}`,
    `- 提交范围：${body.before}...${body.after}`,
    `- 提交数：${body.total_commits_count ?? body.commits?.length ?? 0}`,
    commits ? `- 提交列表：\n${commits}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseBranch(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? '';
}

function buildPushTitle(branch: string, body: PushHook): string {
  const count = body.total_commits_count ?? body.commits?.length ?? 0;
  return `Push ${branch} (${count} commits)`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
