import Parser from 'rss-parser';
import { prisma } from '../../infrastructure/prisma/prisma.service';
import { createLogger } from '../../shared/logger/logger.service';
import { sendDingtalk } from '../../shared/dingtalk/dingtalk.service';
import { loadGlobalDingtalkConfig } from '../notifications/notifications.service';
import { buildRssDingtalkMessage, type RssItem } from './rss-notification';

const log = createLogger('rss');

/** 单次抓取最多推送的条数，避免长时间未抓取后一次性刷屏。 */
const MAX_PUSH_PER_FETCH = 5;

const parser = new Parser({ timeout: 15_000 });

export type RssSubscriptionInput = {
  name: string;
  url: string;
  enabled: boolean;
  intervalMinutes: number;
};

export type RssFetchResult = {
  /** 首次抓取建立的基线条目数 */
  baseline: number;
  /** 本次推送的条目数 */
  pushed: number;
  /** 已推送过或超出单次上限而跳过的条目数 */
  skipped: number;
};

export type RssSubscriptionView = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  intervalMinutes: number;
  lastFetchedAt: string | null;
  lastError: string | null;
  pushedCount: number;
};

function toRssItem(item: Parser.Item): RssItem | null {
  const title = item.title?.trim();
  const guid = (item.guid || item.link || title)?.trim();
  if (!title || !guid) return null;

  const publishedRaw = item.isoDate ?? item.pubDate;
  const publishedAt = publishedRaw ? new Date(publishedRaw) : null;
  return {
    guid,
    title,
    link: item.link?.trim() || null,
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    summary: item.contentSnippet ?? item.summary ?? item.content ?? null,
  };
}

function toView(
  subscription: {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    intervalMinutes: number;
    lastFetchedAt: Date | null;
    lastError: string | null;
  },
  pushedCount: number,
): RssSubscriptionView {
  return {
    id: subscription.id,
    name: subscription.name,
    url: subscription.url,
    enabled: subscription.enabled,
    intervalMinutes: subscription.intervalMinutes,
    lastFetchedAt: subscription.lastFetchedAt?.toISOString() ?? null,
    lastError: subscription.lastError,
    pushedCount,
  };
}

export async function listRssSubscriptions(): Promise<RssSubscriptionView[]> {
  const subscriptions = await prisma.rssSubscription.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { items: true } } },
  });
  return subscriptions.map((subscription) => toView(subscription, subscription._count.items));
}

export async function createRssSubscription(input: RssSubscriptionInput): Promise<RssSubscriptionView> {
  const subscription = await prisma.rssSubscription.create({
    data: {
      name: input.name,
      url: input.url,
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes,
    },
  });
  return toView(subscription, 0);
}

export async function updateRssSubscription(
  id: string,
  input: Partial<RssSubscriptionInput>,
): Promise<RssSubscriptionView> {
  const subscription = await prisma.rssSubscription.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.intervalMinutes !== undefined ? { intervalMinutes: input.intervalMinutes } : {}),
    },
  });
  const pushedCount = await prisma.rssPushedItem.count({ where: { subscriptionId: id } });
  return toView(subscription, pushedCount);
}

export async function deleteRssSubscription(id: string): Promise<void> {
  await prisma.rssSubscription.delete({ where: { id } });
}

/**
 * 抓取一个订阅：首次抓取只建立基线，后续抓取把新条目推送到全局钉钉机器人。
 * 同一订阅的并发抓取共享同一次执行，避免调度器与手动抓取重复推送。
 */
export function fetchRssSubscription(subscriptionId: string): Promise<RssFetchResult> {
  const running = inFlightFetches.get(subscriptionId);
  if (running) return running;

  const task = runRssFetch(subscriptionId).finally(() => {
    inFlightFetches.delete(subscriptionId);
  });
  inFlightFetches.set(subscriptionId, task);
  return task;
}

const inFlightFetches = new Map<string, Promise<RssFetchResult>>();

async function runRssFetch(subscriptionId: string): Promise<RssFetchResult> {
  const subscription = await prisma.rssSubscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription) throw new Error('订阅不存在');

  const parsed = await parser.parseURL(subscription.url);
  const items = parsed.items
    .map((item) => toRssItem(item))
    .filter((item): item is RssItem => item !== null);

  const known = await prisma.rssPushedItem.findMany({
    where: { subscriptionId, guid: { in: items.map((item) => item.guid) } },
    select: { guid: true },
  });
  const knownGuids = new Set(known.map((row) => row.guid));
  const fresh = items
    .filter((item) => !knownGuids.has(item.guid))
    .sort((left, right) => (left.publishedAt?.getTime() ?? 0) - (right.publishedAt?.getTime() ?? 0));

  if (!subscription.lastFetchedAt) {
    await prisma.rssPushedItem.createMany({
      data: fresh.map((item) => ({
        subscriptionId,
        guid: item.guid,
        title: item.title,
        link: item.link,
        publishedAt: item.publishedAt,
      })),
      skipDuplicates: true,
    });
    await prisma.rssSubscription.update({
      where: { id: subscriptionId },
      data: { lastFetchedAt: new Date(), lastError: null },
    });
    return { baseline: fresh.length, pushed: 0, skipped: items.length - fresh.length };
  }

  const toPush = fresh.slice(-MAX_PUSH_PER_FETCH);
  const skippedByLimit = fresh.length - toPush.length;

  // 没有新内容时不需要钉钉配置，避免未推送场景被误报为失败。
  if (toPush.length > 0) {
    const config = await loadGlobalDingtalkConfig();
    if (!config) throw new Error('全局钉钉推送未启用，无法推送 RSS 新条目');

    for (const item of toPush) {
      const message = buildRssDingtalkMessage(subscription.name, item);
      await sendDingtalk(config, message.title, message.text);
      await prisma.rssPushedItem.create({
        data: {
          subscriptionId,
          guid: item.guid,
          title: item.title,
          link: item.link,
          publishedAt: item.publishedAt,
        },
      });
    }
  }

  await prisma.rssPushedItem.createMany({
    data: fresh.map((item) => ({
      subscriptionId,
      guid: item.guid,
      title: item.title,
      link: item.link,
      publishedAt: item.publishedAt,
    })),
    skipDuplicates: true,
  });
  await prisma.rssSubscription.update({
    where: { id: subscriptionId },
    data: { lastFetchedAt: new Date(), lastError: null },
  });

  log.info(`订阅「${subscription.name}」推送 ${toPush.length} 条新内容`);  return {
    baseline: 0,
    pushed: toPush.length,
    skipped: items.length - fresh.length + skippedByLimit,
  };
}

/** 调度器入口：执行所有到期订阅，单个订阅失败不影响其他订阅。 */
export async function runDueRssSubscriptions(): Promise<{ checked: number; failed: number }> {
  const subscriptions = await prisma.rssSubscription.findMany({ where: { enabled: true } });
  const now = Date.now();
  let failed = 0;

  for (const subscription of subscriptions) {
    const dueAt = (subscription.lastFetchedAt?.getTime() ?? 0) + subscription.intervalMinutes * 60_000;
    if (subscription.lastFetchedAt && now < dueAt) continue;

    try {
      await fetchRssSubscription(subscription.id);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : '抓取失败';
      await prisma.rssSubscription.update({
        where: { id: subscription.id },
        data: { lastError: message },
      });
      log.error(`订阅「${subscription.name}」抓取失败：${message}`);
    }
  }

  return { checked: subscriptions.length, failed };
}
