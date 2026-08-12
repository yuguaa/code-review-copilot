import type { SessionWithRepository } from '../sessions/session-message-store.service';
import { sendRepositoryDingtalkNotification } from '../notifications/notifications.service';
import type { ReviewContext } from './tools';
import { readRepositoryMemory, writeRepositoryMemory } from '../repositories/repositories.service';

type RepositoryForDingtalk = NonNullable<SessionWithRepository['repository']>;
function titleOf(session: SessionWithRepository): string {
  const repo = session.repository?.path ?? '未绑定仓库';
  const title = session.mrIid ? `!${session.mrIid} ${session.mrTitle ?? session.title ?? ''}` : session.title ?? '审查完成';
  return `[代码审查] ${repo} ${title}`.trim();
}

function contextOf(session: SessionWithRepository): string {
  const branch =
    session.sourceBranch && session.targetBranch
      ? `${session.sourceBranch} → ${session.targetBranch}`
      : session.sourceBranch ?? session.targetBranch ?? '-';
  return [
    `- 仓库：${session.repository?.path ?? '未绑定仓库'}`,
    `- 分支：${branch}`,
    session.commitSha ? `- Commit：${session.commitSha}` : '',
    session.mrIid ? `- MR：!${session.mrIid}` : '- 类型：Push',
    session.author ? `- 提交者：${session.author}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 后台审查完成后的确定性通知。
 * 钉钉开关仍由仓库控制；机器人配置优先仓库级，缺省走全局配置。
 */
export function notifyReviewCompleted(session: SessionWithRepository, publicationText: string): Promise<'sent' | 'skipped'> {
  const repo = session.repository;
  if (!repo?.enableDingtalk) return Promise.resolve('skipped');

  const title = titleOf(session);
  const text = [`## ${title}`, '', contextOf(session), '', '---', '', publicationText].join('\n');
  return sendRepositoryDingtalkNotification(repo, title, text);
}

export function publishReviewComment(ctx: ReviewContext, markdown: string): Promise<'posted' | 'skipped'> {
  if (!ctx.enableMrComment) return Promise.resolve('skipped');
  if (ctx.mrIid == null) {
    if (!ctx.commitSha) return Promise.resolve('skipped');
    return ctx.gitlab.createCommitComment(ctx.projectId, ctx.commitSha, markdown).then(() => 'posted');
  }
  return ctx.gitlab.createMergeRequestComment(ctx.projectId, ctx.mrIid, markdown).then(() => 'posted');
}

export function rememberVerifiedReview(ctx: ReviewContext, markdown: string): Promise<string> {
  const entry = buildVerifiedMemoryEntry(markdown);
  return readRepositoryMemory(ctx.repoId)
    .then((current) => mergeVerifiedReviewMemory(current, entry))
    .then((next) => writeRepositoryMemory(ctx.repoId, next).then(() => next));
}

export type ReviewCompletionIntegrationFailure = {
  integration: 'memory' | 'gitlab' | 'dingtalk';
  error: unknown;
};

/** 发布最终可用总评；仅 verified 结论写入记忆，单个渠道失败不能反向污染审查状态。 */
export function runReviewCompletionIntegrations(
  ctx: ReviewContext,
  session: SessionWithRepository,
  publicationText: string,
  verifiedMarkdown: string | null,
): Promise<ReviewCompletionIntegrationFailure[]> {
  const verifiedText = verifiedMarkdown?.trim() ?? '';
  const integrations: Array<{
    integration: ReviewCompletionIntegrationFailure['integration'];
    run: () => Promise<unknown>;
  }> = [];
  if (verifiedText) integrations.push({ integration: 'memory', run: () => rememberVerifiedReview(ctx, verifiedText) });
  integrations.push(
    { integration: 'gitlab', run: () => publishReviewComment(ctx, publicationText) },
    { integration: 'dingtalk', run: () => notifyReviewCompleted(session, publicationText) },
  );
  return Promise.allSettled(integrations.map(({ run }) => Promise.resolve().then(run))).then((results) =>
    results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ integration: integrations[index]!.integration, error: result.reason }]
        : [],
    ),
  );
}

export function buildVerifiedMemoryEntry(markdown: string): string {
  const text = markdown.replace(/\s+/g, ' ').trim();
  const summary = text.length > 600 ? `${text.slice(0, 600)}…` : text;
  return `- ${new Date().toISOString()} verified 审查结论：${summary || '未发现需要阻塞的实质问题。'}`;
}

export function mergeVerifiedReviewMemory(current: string, entry: string): string {
  const header = '## Verified 审查沉淀';
  const body = current === '（暂无项目记忆）' ? '' : current.trim();
  if (!body) return `${header}\n${entry}`;
  if (!body.includes(header)) return `${body}\n\n${header}\n${entry}`;
  return `${body}\n${entry}`;
}
