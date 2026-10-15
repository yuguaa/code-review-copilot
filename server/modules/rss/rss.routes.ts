import { Hono } from 'hono';
import { Prisma } from '@prisma/client';
import {
  createRssSubscription,
  deleteRssSubscription,
  fetchRssSubscription,
  listRssSubscriptions,
  updateRssSubscription,
  type RssSubscriptionInput,
} from './rss.service';

export const rssRoutes = new Hono();

/** 把 Prisma 约束错误转成用户能看懂的原因，其余错误保留原始信息。 */
function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return '该 Feed 地址已经被订阅';
    if (error.code === 'P2025') return '订阅不存在';
  }
  return error instanceof Error ? error.message : fallback;
}

/** 请求体规范化：地址必须可解析，间隔限制在 5 分钟到 24 小时之间。 */
function parseSubscriptionInput(body: Record<string, unknown>): RssSubscriptionInput {
  const name = String(body.name ?? '').trim();
  const url = String(body.url ?? '').trim();
  const intervalMinutes = Number(body.intervalMinutes ?? 30);
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

  if (!name) throw new Error('订阅名称不能为空');
  if (!url) throw new Error('订阅地址不能为空');
  try {
    new URL(url);
  } catch {
    throw new Error('订阅地址不是合法链接');
  }
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 1440) {
    throw new Error('抓取间隔需要是 5 到 1440 之间的整数分钟');
  }

  return { name, url, enabled, intervalMinutes };
}

rssRoutes.get('/subscriptions', async (c) => {
  return c.json({ subscriptions: await listRssSubscriptions() });
});

rssRoutes.post('/subscriptions', async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    return c.json({ subscription: await createRssSubscription(parseSubscriptionInput(body)) });
  } catch (error) {
    return c.json({ error: toErrorMessage(error, '创建订阅失败') }, 400);
  }
});

rssRoutes.patch('/subscriptions/:id', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const input: Partial<RssSubscriptionInput> = {};
  if (body.name !== undefined) input.name = String(body.name).trim();
  if (body.url !== undefined) input.url = String(body.url).trim();
  if (body.enabled !== undefined) input.enabled = Boolean(body.enabled);
  if (body.intervalMinutes !== undefined) input.intervalMinutes = Number(body.intervalMinutes);

  if (input.name !== undefined && !input.name) return c.json({ error: '订阅名称不能为空' }, 400);
  if (input.url !== undefined) {
    if (!input.url) return c.json({ error: '订阅地址不能为空' }, 400);
    try {
      new URL(input.url);
    } catch {
      return c.json({ error: '订阅地址不是合法链接' }, 400);
    }
  }
  if (
    input.intervalMinutes !== undefined &&
    (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 5 || input.intervalMinutes > 1440)
  ) {
    return c.json({ error: '抓取间隔需要是 5 到 1440 之间的整数分钟' }, 400);
  }

  try {
    return c.json({ subscription: await updateRssSubscription(c.req.param('id'), input) });
  } catch (error) {
    return c.json({ error: toErrorMessage(error, '更新订阅失败') }, 400);
  }
});

rssRoutes.delete('/subscriptions/:id', async (c) => {
  try {
    await deleteRssSubscription(c.req.param('id'));
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: toErrorMessage(error, '删除订阅失败') }, 400);
  }
});

/** 立即抓取并推送；首次抓取只建立基线，返回结果里如实说明。 */
rssRoutes.post('/subscriptions/:id/fetch', async (c) => {
  try {
    return c.json({ result: await fetchRssSubscription(c.req.param('id')) });
  } catch (error) {
    return c.json({ error: toErrorMessage(error, '抓取失败') }, 400);
  }
});
