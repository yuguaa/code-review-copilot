import { Hono } from 'hono';
import { prisma } from '../lib/prisma';
import { matchesWatchBranches } from '../lib/branch-match';
import { runReviewSession } from '../agent/run-review';
import { createLogger } from '../lib/logger';

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

const REVIEW_ACTIONS = new Set(['open', 'reopen', 'update']);

webhookRoutes.post('/gitlab', async (c) => {
  const event = c.req.header('X-Gitlab-Event');
  const token = c.req.header('X-Gitlab-Token');

  if (event !== 'Merge Request Hook') {
    // 精干版只处理 MR；其余事件确认收到但不动作。
    return c.json({ ignored: true, reason: `暂不处理事件：${event}` });
  }

  let body: MergeRequestHook;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '无效的 webhook 载荷' }, 400);
  }

  const projectId = body.project?.id;
  const attrs = body.object_attributes;
  if (!projectId || !attrs?.iid) {
    return c.json({ error: '缺少 project.id 或 MR iid' }, 400);
  }

  // 按 project id 找仓库（含账号），用账号的 webhookSecret 验签
  const repo = await prisma.repository.findFirst({
    where: { gitLabProjectId: projectId, isActive: true },
    include: { gitLabAccount: true },
  });
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
  if (attrs.action && !REVIEW_ACTIONS.has(attrs.action)) {
    return c.json({ ignored: true, reason: `忽略 MR action：${attrs.action}` });
  }
  if (!matchesWatchBranches(repo.watchBranches, attrs.target_branch)) {
    return c.json({ ignored: true, reason: `目标分支 ${attrs.target_branch} 不在监听范围` });
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

  log.info(`已触发审查 project=${projectId} mr=!${attrs.iid} session=${session.id}`);
  return c.json({ triggered: true, sessionId: session.id });
});

/** 种子提示词：把 MR 上下文交给 agent，指引它走「列变更→审查→发评论」。 */
function buildSeedPrompt(attrs: MergeRequestHook['object_attributes']): string {
  return [
    '请审查本次 Merge Request 的代码变更。',
    '',
    `- 标题：${attrs.title}`,
    attrs.description ? `- 描述：${attrs.description}` : '',
    `- 分支：${attrs.source_branch} → ${attrs.target_branch}`,
    attrs.last_commit?.id ? `- 最新提交：${attrs.last_commit.id}` : '',
    '',
    '请先用 list_changed_files 查看变更范围，再用 fetch_diff / read_file 审查关键文件，',
    '最后用 post_review_comment 把结论作为一条 Markdown 总评发布到本 MR。',
  ]
    .filter(Boolean)
    .join('\n');
}
