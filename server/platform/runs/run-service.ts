import { randomUUID } from 'node:crypto';

import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

import { prisma } from '@server/infrastructure/prisma/prisma.service';
import { assertCommit, cleanupRunWorkspaces, prepareRunWorkspace } from '@server/infrastructure/workspace/workspace.service';
import { loadGlobalDefaultModel, resolveRepositoryModelConfig } from '@server/modules/ai-models/ai-models.service';
import { nonNegativeInteger } from '@server/modules/settings/config-input';
import { publishSessionError, publishSessionListChanged, publishSessionMessages, publishSessionProgress, publishSessionStatus } from '@server/modules/sessions/session-events.service';
import { busySessionStatuses } from '@server/modules/sessions/session-lifecycle.service';
import { buildSessionMessageTree, getSessionWithRepository, lockSession } from '@server/modules/sessions/session-message-store.service';
import { isChatSessionActive } from '@server/platform/chat/chat-runtime';
import { redactSecrets, runOcr, verifyOcrVersion } from '@server/platform/engines/ocr-engine';
import { withRunSpan, withSpan } from '@server/platform/telemetry/telemetry.service';
import { createLogger } from '@server/shared/logger/logger.service';
import { isPublishableRunStatus, PublicationError, publishRun, recoverRunPublications } from './run-publication';
import { withDefaultReviewRule } from './review-rule';

import type { Prisma, Run } from '@prisma/client';

export const busyRunStatuses = [...busySessionStatuses];

const log = createLogger('run-worker');
const active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
const failures = new Set<unknown>();
/* 交互事务只执行短写操作，连接等待与事务执行分别设置明确上限。 */
const transactionOptions = { maxWait: 10_000, timeout: 20_000 };
const inputSchema = z.object({
  context: z.string(),
  background: z.string(),
  reviewRule: z.string().default(''),
  concurrency: z.number().int().positive(),
  timeoutMinutes: z.number().int().positive(),
  maxTokensBudget: nonNegativeInteger,
  model: z.object({ provider: z.string(), modelId: z.string(), apiBaseUrl: z.string().nullable() }),
});
let timer: NodeJS.Timeout | undefined;
let cleanupTimer: NodeJS.Timeout | undefined;
let cleanup: Promise<void> = Promise.resolve();
let pumpTask: Promise<void> | undefined;
let started = false;
let stopping = false;
let engineVersion = '';
let fatalHandler: ((error: unknown) => void) | undefined;

export function enqueueSessionReview(sessionId: string): Promise<void> {
  return getSessionWithRepository(sessionId).then((session) => {
    if (!session?.repository) throw new HTTPException(404, { message: '审查会话或仓库不存在' });
    if (session.kind !== 'review') throw new HTTPException(400, { message: '该会话不支持重新审查' });
    return prisma.run.findFirst({ where: { sessionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }).then((previous) => {
      const baseSha = previous?.baseSha ?? session.baseCommitSha;
      const headSha = previous?.headSha ?? session.commitSha;
      if (!baseSha || !headSha) throw new HTTPException(400, { message: '缺少提交范围' });
      return enqueueRun({
        sessionId, baseSha, headSha, startSha: previous?.startSha ?? baseSha, triggerType: 'manual',
        background: previous ? inputSchema.parse(previous.input).context : session.mrTitle ?? '',
      });
    });
  });
}

export function enqueueRun(request: EnqueueRequest): Promise<void> {
  [request.baseSha, request.startSha, request.headSha].forEach(assertCommit);
  return loadGlobalDefaultModel().then((globalModel) => prisma.$transaction((tx) => lockSession(tx, request.sessionId)
    .then(() => tx.session.findUniqueOrThrow({
      where: { id: request.sessionId },
      include: { repository: { include: { defaultAIModel: true, gitLabAccount: true } } },
    }))
    .then((session) => {
      if (isChatSessionActive(session.id)) throw new HTTPException(409, { message: '当前会话正在生成回答' });
      const repo = session.repository;
      if (session.kind !== 'review' || !repo?.isActive || !repo.gitLabAccount.isActive) {
        throw new HTTPException(400, { message: '审查会话或仓库不可用' });
      }
      if (busyRunStatuses.includes(session.status as typeof busyRunStatuses[number])) {
        throw new HTTPException(409, { message: '会话已有执行任务' });
      }
      return tx.run.count({ where: { sessionId: session.id, status: { in: busyRunStatuses } } }).then((count) => {
        if (count) throw new HTTPException(409, { message: '会话已有执行任务' });
        const model = resolveRepositoryModelConfig(repo, globalModel);
        const context = request.background ?? session.mrTitle ?? '';
        const input = inputSchema.parse({
          context,
          background: ['请使用简体中文审查代码，依据仓库内 OCR 原生规则与项目上下文提出有证据的问题。', context].filter(Boolean).join('\n\n'),
          reviewRule: withDefaultReviewRule(repo.defaultReviewPrompt),
          model: { provider: model.provider, modelId: model.modelId, apiBaseUrl: model.apiBaseUrl ?? null },
          concurrency: repo.ocrConcurrency, timeoutMinutes: repo.ocrTimeoutMinutes, maxTokensBudget: repo.ocrMaxTokensBudget,
        });
        return tx.message.create({ data: {
          sessionId: session.id, parentId: session.activeLeafMessageId, role: 'user',
          parts: [{ type: 'text', text: request.triggerType === 'manual' ? '重新审查本次提交范围。' : '审查本次代码变更。' }],
        } }).then((message) => tx.run.create({ data: {
          id: randomUUID(), sessionId: session.id, repositoryId: repo.id, engineKey: 'ocr-review', engineVersion: engineVersion || null,
          baseSha: request.baseSha, startSha: request.startSha, headSha: request.headSha,
          provider: model.provider, modelId: model.modelId, triggerType: request.triggerType,
          eventKey: request.eventKey, input, inputMessageId: message.id,
        } }).then(() => tx.session.update({ where: { id: session.id }, data: { status: 'queued', error: null, activeLeafMessageId: message.id } })));
      });
    }), transactionOptions)).then(() => publishCurrentSession(request.sessionId));
}

/** 领取与取消都先锁定 Session，随后在同一事务更新 Run 和 Session。 */
export function claimNextRun(): Promise<Run | null> {
  return prisma.$transaction((tx) => tx.$queryRaw<Array<{ id: string }>>`
      SELECT s.id FROM sessions s
      WHERE EXISTS (SELECT 1 FROM runs r WHERE r."sessionId" = s.id AND r.status = 'queued')
        AND NOT EXISTS (SELECT 1 FROM runs r WHERE r."sessionId" = s.id AND r.status IN ('running', 'cancelling'))
      ORDER BY (SELECT MIN(r."createdAt") FROM runs r WHERE r."sessionId" = s.id AND r.status = 'queued'), s.id
      FOR UPDATE OF s SKIP LOCKED LIMIT 1
    `.then((sessions) => {
      const session = sessions[0];
      if (!session || stopping || isChatSessionActive(session.id)) return null;
      return tx.run.findFirst({ where: { sessionId: session.id, status: 'queued' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
        .then((run) => {
          if (!run) return null;
          return tx.run.update({ where: { id: run.id }, data: { status: 'running', startedAt: new Date(), error: null } })
            .then((claimed) => tx.session.update({ where: { id: session.id }, data: { status: 'running', error: null } }).then(() => claimed));
        });
    }), transactionOptions)
    .then((run) => run ? publishCurrentSession(run.sessionId).then(() => run) : null);
}

export function cancelSessionReview(sessionId: string): Promise<void> {
  return prisma.$transaction((tx) => lockSession(tx, sessionId)
    .then(() => tx.run.findFirst({ where: { sessionId, status: { in: busyRunStatuses } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }))
    .then((run) => {
      if (!run) throw new HTTPException(409, { message: '当前没有可取消任务' });
      if (run.status === 'queued') return finishRunInTransaction(tx, run, 'cancelled', '用户取消排队任务');
      return tx.run.update({ where: { id: run.id }, data: { status: 'cancelling' } })
        .then((updated) => tx.session.update({ where: { id: sessionId }, data: { status: 'cancelling' } }).then(() => updated));
    }), transactionOptions)
    .then((run) => publishCurrentSession(sessionId).then(() => {
      const running = active.get(run.id);
      running?.controller.abort(new Error('用户取消审查'));
      return running?.promise;
    }));
}

export function finishRun(id: string, status: string, error: string | null, report?: EngineReport): Promise<Run> {
  return prisma.run.findUniqueOrThrow({ where: { id }, select: { sessionId: true } })
    .then(({ sessionId }) => prisma.$transaction((tx) => lockSession(tx, sessionId)
      .then(() => tx.run.findUniqueOrThrow({ where: { id } }))
      .then((run) => finishRunInTransaction(tx, run, status, error, report)), transactionOptions))
    .then((run) => publishCurrentSession(run.sessionId).then(() => run));
}

function finishRunInTransaction(tx: Prisma.TransactionClient, run: Run, status: string, error: string | null, report?: EngineReport): Promise<Run> {
  if (!busyRunStatuses.includes(run.status as typeof busyRunStatuses[number])) return Promise.resolve(run);
  const finalStatus = status === 'interrupted' ? status : run.status === 'cancelling' ? 'cancelled' : status;
  const reportMessageId = randomUUID();
  const text = report?.report ?? `执行状态：${finalStatus}\n\n${error ?? '执行已经结束'}`;
  return (run.inputMessageId ? tx.message.findFirst({ where: { id: run.inputMessageId, sessionId: run.sessionId, role: 'user' } }).then((message) => {
    if (!message) throw new Error('运行输入消息不存在于当前会话');
  }) : Promise.resolve())
    .then(() => tx.message.create({ data: { id: reportMessageId, sessionId: run.sessionId, parentId: run.inputMessageId, role: 'assistant', parts: [{ type: 'text', text }] } }))
    .then(() => tx.run.update({ where: { id: run.id }, data: {
      status: finalStatus, error, finishedAt: new Date(), reportMessageId,
      ...(report ? { rawResult: report.rawResult as Prisma.InputJsonValue, engineSessionId: report.engineSessionId, exitCode: report.exitCode } : {}),
    } }))
    .then((finished) => tx.run.findFirst({ where: { sessionId: run.sessionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }).then((latest) => {
      if (latest?.id !== run.id) return finished;
      return tx.session.update({ where: { id: run.sessionId }, data: { status: finalStatus, error, activeLeafMessageId: reportMessageId } }).then(() => finished);
    }));
}

export function executeRun(id: string, signal: AbortSignal): Promise<void> {
  let secrets: Array<string | null | undefined> = [];
  return withRunSpan(id, (traceId, traceparent) => prisma.run.findUniqueOrThrow({ where: { id } }).then((run) => {
    if (!['running', 'cancelling'].includes(run.status)) throw new Error('任务尚未领取或已经结束');
    return Promise.all([getSessionWithRepository(run.sessionId), loadGlobalDefaultModel()]).then(([session, globalModel]) => {
      if (!session?.repository || !run.baseSha || !run.headSha) throw new Error('运行缺少仓库或提交范围');
      const repo = session.repository;
      secrets = [repo.gitLabAccount.accessToken, repo.customApiKey, repo.defaultAIModel?.apiKey, globalModel?.apiKey];
      const model = resolveRepositoryModelConfig(repo, globalModel);
      const input = inputSchema.parse(run.input);
      if (JSON.stringify(input.model) !== JSON.stringify({ provider: model.provider, modelId: model.modelId, apiBaseUrl: model.apiBaseUrl ?? null })) {
        throw new Error('模型配置已变更，请重新创建任务');
      }
      signal.throwIfAborted();
      if (run.status === 'cancelling') throw new Error('任务已取消');
      return prisma.run.update({ where: { id }, data: { traceId: traceId || null, engineVersion: engineVersion || run.engineVersion } })
        .then(() => {
          publishSessionProgress(run.sessionId, id, '正在准备 OCR 审查工作区');
          return withSpan('workspace.prepare', { 'review.run.id': id }, () => prepareRunWorkspace(session, run, signal));
        })
        .then((workspace) => withSpan('engine.process', { 'review.run.id': id, 'engine.key': run.engineKey }, () => runOcr({
          ...input, id, repositoryId: repo.id, model, workdir: workspace.dir, baseSha: run.baseSha!, headSha: run.headSha!, signal, traceparent,
          onProgress: (message) => publishSessionProgress(run.sessionId, id, message),
        }).then((result) => {
          if (result.status === 'failed') throw new EngineResultError(result);
          return result;
        })))
        .then((result) => withSpan('engine.result.persist', { 'review.run.id': id }, () => finishRun(id, result.status,
          result.status === 'failed' ? 'OCR 审查失败，已保存返回结果' : null, result)))
        .then((finished) => {
          if (finished.status === 'failed') throw new Error(finished.error ?? 'OCR 审查失败');
        });
    });
  }).catch((error: unknown) => {
    const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
    const status = signal.reason instanceof WorkerShutdownError ? 'interrupted' : signal.aborted ? 'cancelled' : 'failed';
    return withSpan('engine.result.persist', { 'review.run.id': id }, () => finishRun(id, status, message,
      error instanceof EngineResultError ? error.result : undefined))
      .then(() => { throw new RunExecutionError(message, { cause: error }); });
  }).then(() => prisma.run.findUnique({ where: { id } })).then((run) => {
    if (!run || !isPublishableRunStatus(run.status)) return;
    return Promise.allSettled([publishRun(id, 'gitlab', false), publishRun(id, 'dingtalk', false, signal)]).then((results) => {
      const unexpected: unknown[] = [];
      for (const result of results) {
        if (result.status !== 'rejected') continue;
        if (result.reason instanceof PublicationError) log.warn('报告发布结果已经保存', { runId: id, error: result.reason.message });
        else unexpected.push(result.reason);
      }
      if (unexpected.length) return prisma.run.findUnique({ where: { id }, select: { id: true } }).then((existing) => {
        if (existing) throw new AggregateError(unexpected, '报告发布流程失败');
      });
    }).then(() => publishCurrentSession(run.sessionId));
  }));
}

export function recoverRunWorkerState(): Promise<void> {
  return prisma.run.findMany({ where: { status: { in: ['running', 'cancelling'] } }, select: { id: true } })
    .then((runs) => runs.reduce<Promise<void>>((pending, run) => pending.then(() => finishRun(run.id, 'interrupted', '执行进程已中断')).then(() => undefined), Promise.resolve()))
    .then(recoverRunPublications);
}

function publishCurrentSession(sessionId: string): Promise<void> {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  })
    .then((session) => session ? { status: session.status, error: session.error, tree: buildSessionMessageTree(session.messages, session.activeLeafMessageId) } : null)
    .then((snapshot) => {
      if (!snapshot) return;
      const { tree, ...session } = snapshot;
      publishSessionStatus(sessionId, session.status);
      publishSessionMessages(sessionId, tree);
      if (session.error) publishSessionError(sessionId, session.error);
      publishSessionListChanged();
    });
}

function failWorker(error: unknown): void {
  failures.add(error);
  stopping = true;
  clearInterval(timer);
  clearInterval(cleanupTimer);
  log.error('运行调度已经停止', { error: error instanceof Error ? error.message : String(error) });
  fatalHandler?.(error);
}

function pump(): Promise<void> {
  if (pumpTask) return pumpTask;
  const fill = (): Promise<void> => {
    if (stopping || active.size >= 2) return Promise.resolve();
    return claimNextRun().then((run) => {
      if (!run) return;
      if (stopping) return finishRun(run.id, 'interrupted', '服务正在关闭').then(() => undefined);
      const controller = new AbortController();
      const promise = executeRun(run.id, controller.signal).catch((error: unknown) => {
        if (!(error instanceof RunExecutionError)) throw error;
        log.warn('运行已经结束，错误已经保存', { runId: run.id, error: error.message });
      }).finally(() => {
        active.delete(run.id);
        if (!stopping) void pump().catch(failWorker);
      });
      active.set(run.id, { controller, promise });
      void promise.catch(failWorker);
      return fill();
    });
  };
  pumpTask = fill().finally(() => { pumpTask = undefined; });
  return pumpTask;
}

export function startRunWorker(onFailure?: (error: unknown) => void): Promise<void> {
  if (started) return Promise.reject(new Error('运行执行器已经启动'));
  started = true;
  fatalHandler = onFailure;
  stopping = false;
  failures.clear();
  cleanup = Promise.resolve();
  return recoverRunWorkerState().then(verifyOcrVersion).then((version) => {
    if (stopping) throw new Error('运行执行器启动已取消');
    engineVersion = version;
    timer = setInterval(() => { void pump().catch(failWorker); }, 1000);
    cleanupTimer = setInterval(() => {
      cleanup = cleanup.then(cleanupRunWorkspaces);
      void cleanup.catch(failWorker);
    }, 60 * 60_000);
    timer.unref();
    cleanupTimer.unref();
    return pump();
  }).catch((error: unknown) => { started = false; failWorker(error); throw error; });
}

export function stopRunWorker(): Promise<void> {
  stopping = true;
  clearInterval(timer);
  clearInterval(cleanupTimer);
  return Promise.allSettled([pumpTask ?? Promise.resolve()]).then((results) => {
    for (const result of results) if (result.status === 'rejected') failures.add(result.reason);
    for (const run of active.values()) run.controller.abort(new WorkerShutdownError('服务正在关闭'));
    return Promise.allSettled([cleanup, ...Array.from(active.values(), (run) => run.promise)]);
  }).then((results) => {
    for (const result of results) if (result.status === 'rejected') failures.add(result.reason);
    if (failures.size) throw new AggregateError([...failures], '运行执行器关闭时存在错误');
  }).finally(() => { started = false; });
}

class RunExecutionError extends Error {}
class WorkerShutdownError extends Error {}
class EngineResultError extends Error {
  constructor(readonly result: Awaited<ReturnType<typeof runOcr>>) {
    super('OCR 审查失败，已保存返回结果');
  }
}

type EngineReport = { rawResult: object; report: string; engineSessionId?: string; exitCode: number | null };
export type EnqueueRequest = { sessionId: string; baseSha: string; startSha: string; headSha: string; triggerType: string; eventKey?: string; background?: string };
