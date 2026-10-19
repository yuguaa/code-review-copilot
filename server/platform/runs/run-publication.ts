import { createHash, randomUUID } from 'node:crypto';

import { isAxiosError } from 'axios';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { loadRepositoryDingtalkConfig, sendDingtalkNotification } from '@server/modules/notifications/notifications.service';
import { publishSessionListChanged } from '@server/modules/sessions/session-events.service';
import { parseOcrResult } from '@server/platform/engines/ocr-result';
import { withSpan } from '@server/platform/telemetry/telemetry.service';
import { createGitLabService } from '@server/shared/gitlab/gitlab.service';

import type { Prisma } from '@prisma/client';

const deliverySchema = z.object({
  status: z.enum(['sending', 'sent', 'skipped', 'failed', 'unknown']),
  attemptId: z.string().optional(),
  remoteIds: z.array(z.string()).optional(),
  noteIds: z.array(z.number().int()).optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
});
const deliveriesSchema = z.record(deliverySchema);
const publicationLocks = new Map<string, Promise<void>>();

export function isPublishableRunStatus(status: string): boolean {
  return ['completed', 'partial', 'skipped'].includes(status);
}

export function buildDingtalkReviewMessage(input: {
  report: string;
  runId: string;
  triggerType: string;
  baseSha: string;
  headSha: string;
  repository: { name: string; path: string; gitLabUrl: string };
  session: { author: string | null; sourceBranch: string | null; targetBranch: string | null; mrIid: number | null };
  publicUrl: string;
}): { title: string; text: string } {
  const projectUrl = `${input.repository.gitLabUrl.replace(/\/+$/, '')}/${input.repository.path}`;
  const gitLabUrl = input.session.mrIid === null
    ? `${projectUrl}/-/commit/${input.headSha}`
    : `${projectUrl}/-/merge_requests/${input.session.mrIid}`;
  const reviewUrl = `${input.publicUrl.replace(/\/+$/, '')}/runs/${input.runId}`;
  const trigger = input.session.mrIid === null ? input.triggerType : `Merge Request !${input.session.mrIid}`;
  const branch = input.session.sourceBranch && input.session.targetBranch
    ? `${input.session.sourceBranch} → ${input.session.targetBranch}`
    : input.session.targetBranch ?? input.session.sourceBranch ?? '未记录';
  const title = `[代码审查] ${input.repository.name}`;
  const metadata = [
    `### ${title}`,
    `- 项目：${input.repository.name}（${input.repository.path}）`,
    `- 提交人：${input.session.author ?? '未记录'}`,
    `- 触发方式：${trigger}`,
    `- 分支：${branch}`,
    `- 提交范围：${input.baseSha} → ${input.headSha}`,
    `- GitLab：[查看代码变更](${gitLabUrl})`,
    `- 审查平台：[查看报告与追问](${reviewUrl})`,
  ].join('\n');
  return { title, text: `${metadata}\n\n---\n\n${input.report}` };
}

export function publishRun(id: string, channel: Channel, manual: boolean): Promise<void> {
  return withSpan(`connector.${channel}.publish`, { 'review.run.id': id, channel }, () => claimRunDelivery(id, channel, manual)
    .then((claim) => {
      if (!claim) return;
      let mayHaveSent = false;
      const previous = deliveriesSchema.parse(claim.run.deliveries)[channel];
      const remoteIds = new Set(previous?.remoteIds ?? []);
      const noteIds = new Set(previous?.noteIds ?? []);
      const checkpoint = () => saveRunDelivery(id, channel, claim.attemptId, {
        status: 'sending', remoteIds: [...remoteIds], noteIds: [...noteIds],
      });
      const repo = claim.run.session.repository!;
      const target = channel === 'gitlab'
        ? `${repo.id}:${claim.run.session.mrIid == null ? `commit:${claim.run.headSha}` : `mr:${claim.run.session.mrIid}`}`
        : repo.id;
      return withPublicationLock(`${channel}:${target}`, () => {
        if (channel === 'dingtalk') {
          return loadRepositoryDingtalkConfig(repo).then((config) => {
            if (!config) return 'skipped' as const;
            const publicUrl = process.env.APP_PUBLIC_URL;
            if (!publicUrl) throw new Error('APP_PUBLIC_URL 未配置，无法生成钉钉审查链接');
            const message = buildDingtalkReviewMessage({
              report: claim.report, runId: claim.run.id, triggerType: claim.run.triggerType,
              baseSha: claim.run.baseSha!, headSha: claim.run.headSha!, publicUrl,
              repository: { name: repo.name, path: repo.path, gitLabUrl: repo.gitLabAccount.url },
              session: { author: claim.run.session.author, sourceBranch: claim.run.session.sourceBranch,
                targetBranch: claim.run.session.targetBranch, mrIid: claim.run.session.mrIid },
            });
            mayHaveSent = true;
            return sendDingtalkNotification(config, message.title, message.text).then(() => 'sent' as const);
          });
        }
        const run = claim.run;
        const gitlab = createGitLabService(repo.gitLabAccount.url, repo.gitLabAccount.accessToken);
        const project = repo.gitLabProjectId;
        const marker = (content: string) => `<!-- code-review:${createHash('sha256').update(JSON.stringify([
          repo.id, run.session.mrIid, run.baseSha, run.startSha, run.headSha, content,
        ])).digest('hex')} -->`;
        if (run.session.mrIid == null) {
          const tag = marker(claim.report);
          return gitlab.getCommitComments(project, run.headSha!).then((comments) => {
            const existing = comments.find((comment) => comment.note.includes(tag));
            if (existing) return existing;
            mayHaveSent = true;
            return gitlab.createCommitComment(project, run.headSha!, `${claim.report}\n\n${tag}`);
          }).then((comment) => {
            remoteIds.add(comment.discussion_id);
            noteIds.add(comment.note_id);
            return checkpoint().then(() => 'sent' as const);
          });
        }
        const mrIid = run.session.mrIid;
        const assertCurrentMr = () => gitlab.getMergeRequest(project, mrIid).then((mr) => {
          const refs = mr.diff_refs;
          if (!refs || refs.base_sha !== run.baseSha || refs.start_sha !== run.startSha || refs.head_sha !== run.headSha) {
            throw new HTTPException(409, { message: 'MR 已经出现新版本，本次报告保留在平台' });
          }
        });
        const result = parseOcrResult(JSON.stringify(run.rawResult));
        return assertCurrentMr().then(() => Promise.all([
          gitlab.listMergeRequestDiscussions(project, mrIid),
          gitlab.getMergeRequestVersions(project, mrIid),
        ])).then(([discussions, versions]) => {
          const version = versions.find((item) => item.base_commit_sha === run.baseSha && item.start_commit_sha === run.startSha && item.head_commit_sha === run.headSha);
          if (!version) throw new HTTPException(409, { message: 'GitLab 没有提供本次运行的 diff 版本' });
          const notes = discussions.flatMap((discussion) => discussion.notes.map((note) => ({ body: note.body, id: note.id, discussionId: discussion.id })));
          return gitlab.getMergeRequestDiffs(project, mrIid, version.id).then((diffs) => {
            const post = (text: string, tag: string, position?: Parameters<typeof gitlab.createMergeRequestComment>[3]) => {
              const existing = notes.find((note) => note.body.includes(tag));
              if (existing) {
                remoteIds.add(existing.discussionId);
                noteIds.add(existing.id);
                return checkpoint();
              }
              return assertCurrentMr().then(() => {
                mayHaveSent = true;
                return gitlab.createMergeRequestComment(project, mrIid, `${text}\n\n${tag}`, position);
              }).then((posted) => {
                remoteIds.add(posted.id);
                for (const note of posted.notes) {
                  noteIds.add(note.id);
                  notes.push({ body: note.body, id: note.id, discussionId: posted.id });
                }
                return checkpoint();
              });
            };
            return result.comments.reduce<Promise<void>>((pending, comment) => pending.then(() => {
              if (comment.start_line === 0) return;
              const diff = diffs.find((file) => file.new_path === comment.path && !file.deleted_file);
              if (!diff) throw new HTTPException(409, { message: `评论文件不属于当前变更：${comment.path}` });
              const text = [comment.content, comment.suggestion_code ? `\n建议代码：\n\n\`\`\`\n${comment.suggestion_code}\n\`\`\`` : ''].join('\n');
              return post(text, marker(JSON.stringify([comment.path, comment.start_line, comment.end_line, text])), {
                base_sha: run.baseSha!, start_sha: run.startSha!, head_sha: run.headSha!,
                new_path: diff.new_path, old_path: diff.old_path, new_line: comment.start_line, position_type: 'text',
              });
            }), Promise.resolve()).then(() => post(claim.report, marker(claim.report))).then(() => 'sent' as const);
          });
        });
      }).then((status) => saveRunDelivery(id, channel, claim.attemptId, {
        status, remoteIds: [...remoteIds], noteIds: [...noteIds], finishedAt: new Date().toISOString(),
      })).catch((error: unknown) => {
        if (error instanceof DeliveryStorageError) throw error;
        const { status, error: message } = classifyDeliveryError(error, mayHaveSent, previous?.status === 'unknown');
        return saveRunDelivery(id, channel, claim.attemptId, {
          status, error: message, remoteIds: [...remoteIds], noteIds: [...noteIds], finishedAt: new Date().toISOString(),
        }).then(() => { throw new PublicationError(error instanceof HTTPException ? error.status : 502, { message, cause: error }); });
      });
    }));
}

export function classifyDeliveryError(error: unknown, mayHaveSent: boolean, previouslyUnknown = false): { status: 'failed' | 'unknown'; error: string } {
  const definiteRejection = error instanceof HTTPException || (isAxiosError(error)
    && error.response != null && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 408)
    || (error instanceof Error && /^钉钉发送失败：\d+$/.test(error.message));
  const status = previouslyUnknown || (mayHaveSent && !definiteRejection) ? 'unknown' : 'failed';
  return { status, error: error instanceof HTTPException ? error.message : status === 'unknown'
    ? '渠道发送结果无法确认，请检查远端结果后决定是否再次发送' : '渠道配置、查询或发送失败' };
}

/** 同一 Run 的发送资格和报告归属在行锁中检查。 */
export function claimRunDelivery(id: string, channel: Channel, manual: boolean) {
  return prisma.$transaction((tx) => tx.$queryRaw`SELECT id FROM runs WHERE id = ${id} FOR UPDATE`
    .then(() => tx.run.findUnique({ where: { id }, include: { session: { include: { repository: { include: { gitLabAccount: true } } } } } }))
    .then((run) => {
      if (!run) throw new HTTPException(404, { message: '运行记录不存在' });
      if (!isPublishableRunStatus(run.status) || !run.reportMessageId) {
        throw new HTTPException(409, { message: '运行尚未生成可发布的报告' });
      }
      const repo = run.session.repository;
      if (!repo || run.repositoryId !== repo.id) throw new HTTPException(409, { message: '运行仓库已经删除或发生变化' });
      if (!run.baseSha || !run.headSha || (run.session.mrIid != null && !run.startSha)) {
        throw new HTTPException(409, { message: '运行缺少完整提交范围' });
      }
      const deliveries = deliveriesSchema.parse(run.deliveries);
      const previous = deliveries[channel];
      if (previous?.status === 'sent' || previous?.status === 'sending' || (!manual && previous)) return null;
      const enabled = channel === 'gitlab' ? repo.enableMrComment : repo.enableDingtalk;
      if (!enabled && previous) return null;
      if (!enabled) return tx.run.update({ where: { id }, data: {
        deliveries: { ...deliveries, [channel]: { status: 'skipped', finishedAt: new Date().toISOString() } },
      } }).then(() => null);
      return tx.message.findFirst({ where: { id: run.reportMessageId, sessionId: run.sessionId, role: 'assistant', parentId: run.inputMessageId } })
        .then((message) => {
          if (!message) throw new HTTPException(409, { message: '报告消息不存在于当前运行的消息分支' });
          const parts = z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).parse(message.parts);
          const report = parts.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n\n').trim();
          if (!report) throw new HTTPException(409, { message: '报告没有可以发布的正文' });
          const attemptId = randomUUID();
          return tx.run.update({ where: { id }, data: { deliveries: {
            ...deliveries, [channel]: { status: 'sending', attemptId, startedAt: new Date().toISOString() },
          } } }).then(() => ({ run, report, attemptId }));
        });
    }));
}

export function saveRunDelivery(id: string, channel: Channel, attemptId: string, delivery: Delivery): Promise<void> {
  return prisma.$transaction((tx) => tx.$queryRaw`SELECT id FROM runs WHERE id = ${id} FOR UPDATE`
    .then(() => tx.run.findUniqueOrThrow({ where: { id } }))
    .then((run) => {
      const deliveries = deliveriesSchema.parse(run.deliveries);
      const current = deliveries[channel];
      if (current?.attemptId !== attemptId || current.status !== 'sending') throw new Error('发送资格已经失效');
      return tx.run.update({ where: { id }, data: { deliveries: {
        ...deliveries, [channel]: { ...current, ...delivery, attemptId },
      } as Prisma.InputJsonValue } });
    }))
    .then(() => { publishSessionListChanged(); })
    .catch((error: unknown) => { throw new DeliveryStorageError('发布结果保存失败', { cause: error }); });
}

export function recoverRunPublications(): Promise<void> {
  return prisma.run.findMany({ where: { OR: [
    { deliveries: { path: ['gitlab', 'status'], equals: 'sending' } },
    { deliveries: { path: ['dingtalk', 'status'], equals: 'sending' } },
  ] }, select: { id: true } }).then((runs) => runs.reduce<Promise<void>>((pending, run) => pending.then(() => prisma.$transaction((tx) =>
    tx.$queryRaw`SELECT id FROM runs WHERE id = ${run.id} FOR UPDATE`
      .then(() => tx.run.findUniqueOrThrow({ where: { id: run.id } }))
      .then((current) => {
        const deliveries = deliveriesSchema.parse(current.deliveries);
        for (const delivery of Object.values(deliveries)) {
          if (delivery.status !== 'sending') continue;
          delivery.status = 'unknown';
          delivery.error = '服务重新启动，渠道发送结果需要确认';
          delivery.finishedAt = new Date().toISOString();
        }
        return tx.run.update({ where: { id: run.id }, data: { deliveries } });
      }))).then(() => { publishSessionListChanged(); }), Promise.resolve()));
}

function withPublicationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = publicationLocks.get(key) ?? Promise.resolve();
  const next = previous.then(operation);
  /* 队列尾部只负责释放顺序，调用方仍然接收原始任务的错误。 */
  const tail = next.then(() => undefined, () => undefined);
  publicationLocks.set(key, tail);
  void tail.then(() => { if (publicationLocks.get(key) === tail) publicationLocks.delete(key); });
  return next;
}

export class PublicationError extends HTTPException {}
class DeliveryStorageError extends Error {}

export type Channel = 'gitlab' | 'dingtalk';
export type Delivery = z.infer<typeof deliverySchema>;
