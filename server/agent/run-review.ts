import { prisma } from '../lib/prisma';
import { getSessionWithRepository, loadMessages, saveMessages } from '../lib/chat-store';
import { createReviewStream } from './review-agent';
import { createLogger } from '../lib/logger';

const log = createLogger('run-review');

/**
 * 后台跑一次完整审查：加载会话与种子消息 → 跑主 agent → 流式落库 → 更新状态。
 * 由 webhook fire-and-forget 调用；自身吞掉异常并落 failed 状态。
 */
export async function runReviewSession(sessionId: string): Promise<void> {
  const session = await getSessionWithRepository(sessionId);
  if (!session) {
    log.error(`审查会话不存在：${sessionId}`);
    return;
  }

  try {
    const initial = await loadMessages(sessionId);
    const result = await createReviewStream({ session, messages: initial });

    // 复用 chat route 的同一条 UI message 流；read 到底以驱动 onFinish 落库。
    const response = result.toUIMessageStreamResponse({
      originalMessages: initial,
      onFinish: async ({ messages }) => {
        await saveMessages(sessionId, messages);
      },
    });
    await response.text();

    await prisma.session.update({ where: { id: sessionId }, data: { status: 'completed' } });
    log.info(`审查完成 session=${sessionId}`);
  } catch (err) {
    log.error(`审查失败 session=${sessionId}`, err);
    await prisma.session
      .update({
        where: { id: sessionId },
        data: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
      })
      .catch(() => undefined);
  }
}
