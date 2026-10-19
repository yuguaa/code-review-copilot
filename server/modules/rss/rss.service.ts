import { isAxiosError } from "axios";
import { HTTPException } from "hono/http-exception";
import Parser from "rss-parser";
import { z } from "zod";

import { prisma } from "@server/infrastructure/prisma/prisma.service";
import { createLogger } from "@server/shared/logger/logger.service";
import { loadDingtalkConfig, sendDingtalkNotification, validateDingtalkTarget } from "@server/modules/notifications/notifications.service";
import { httpUrl } from "../settings/config-input";
import { buildRssDingtalkMessage } from "./rss-notification";

import type { RssSubscription } from "@prisma/client";
import type { RssItem } from "./rss-notification";

const log = createLogger("rss");
const parser = new Parser({ timeout: 15_000 });
const inFlightFetches = new Map<string, Promise<RssFetchResult>>();
const changingSubscriptions = new Set<string>();
let acceptingFetches = true;

export const rssSubscriptionInput = z.object({
  name: z.string().trim().min(1),
  url: httpUrl,
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().min(5).max(1440).default(30),
  dingtalkRobotId: z.string().trim().min(1).nullable().optional(),
}).strict();

export type RssSubscriptionInput = z.output<typeof rssSubscriptionInput>;
export type RssFetchResult = { baseline: number; pushed: number; skipped: number };

function toView(subscription: RssSubscription, pushedCount: number) {
  return {
    ...subscription,
    lastFetchedAt: subscription.lastFetchedAt?.toISOString() ?? null,
    pushedCount,
  };
}

/** rss-parser 负责解析 Feed，同次响应中的重复 GUID 只保留一次。 */
export function collectRssItems(items: Parser.Item[]): RssItem[] {
  const unique = new Map<string, RssItem>();
  for (const item of items) {
    const title = item.title?.trim();
    const guid = (item.guid || item.link || title)?.trim();
    if (!title || !guid || unique.has(guid)) continue;
    const date = item.isoDate ?? item.pubDate;
    const publishedAt = date ? new Date(date) : null;
    unique.set(guid, {
      guid, title,
      link: item.link?.trim() || null,
      publishedAt: publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null,
      summary: item.contentSnippet ?? item.summary ?? item.content ?? null,
    });
  }
  return [...unique.values()].sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0));
}

export function listRssSubscriptions() {
  return prisma.rssSubscription.findMany({
    orderBy: { createdAt: "asc" }, include: { _count: { select: { items: true } } },
  }).then((subscriptions) => subscriptions.map(({ _count, ...subscription }) => toView(subscription, _count.items)));
}

export function createRssSubscription(body: unknown) {
  const data = rssSubscriptionInput.parse(body);
  return prisma.$transaction((tx) => validateDingtalkTarget(tx, data.dingtalkRobotId, data.enabled)
    .then(() => tx.rssSubscription.create({ data }))).then((subscription) => toView(subscription, 0));
}

export function updateRssSubscription(id: string, body: unknown) {
  const data = rssSubscriptionInput.partial().parse(body);
  if (inFlightFetches.has(id) || changingSubscriptions.has(id)) throw new HTTPException(409, { message: "订阅正在处理，请等待完成后修改" });
  changingSubscriptions.add(id);
  return prisma.$transaction((tx) => tx.rssSubscription.findUniqueOrThrow({ where: { id } }).then((current) =>
    validateDingtalkTarget(tx, data.dingtalkRobotId === undefined ? current.dingtalkRobotId : data.dingtalkRobotId, data.enabled ?? current.enabled)
      .then(() => tx.rssSubscription.update({ where: { id }, data, include: { _count: { select: { items: true } } } }))))
    .then(({ _count, ...subscription }) => toView(subscription, _count.items))
    .finally(() => changingSubscriptions.delete(id));
}

export function deleteRssSubscription(id: string): Promise<void> {
  if (inFlightFetches.has(id) || changingSubscriptions.has(id)) throw new HTTPException(409, { message: "订阅正在处理，请等待完成后删除" });
  changingSubscriptions.add(id);
  return prisma.rssSubscription.delete({ where: { id } }).then(() => undefined)
    .finally(() => changingSubscriptions.delete(id));
}

export function fetchRssSubscription(subscriptionId: string): Promise<RssFetchResult> {
  if (!acceptingFetches) return Promise.reject(new HTTPException(503, { message: "RSS 调度正在停止" }));
  if (changingSubscriptions.has(subscriptionId)) return Promise.reject(new HTTPException(409, { message: "订阅配置正在修改" }));
  const existing = inFlightFetches.get(subscriptionId);
  if (existing) return existing;
  const task = runRssFetch(subscriptionId).finally(() => inFlightFetches.delete(subscriptionId));
  inFlightFetches.set(subscriptionId, task);
  return task;
}

function runRssFetch(subscriptionId: string): Promise<RssFetchResult> {
  return prisma.rssSubscription.findUniqueOrThrow({ where: { id: subscriptionId } }).then((subscription) => {
    return parser.parseURL(subscription.url).then((feed) => {
      const items = collectRssItems(feed.items);
      return prisma.rssPushedItem.findMany({
        where: { subscriptionId, guid: { in: items.map((item) => item.guid) } }, select: { guid: true },
      }).then((known) => {
        const knownGuids = new Set(known.map((item) => item.guid));
        const fresh = items.filter((item) => !knownGuids.has(item.guid));
        if (!subscription.lastFetchedAt) {
          return prisma.rssPushedItem.createMany({ data: fresh.map((item) => ({
            subscriptionId, guid: item.guid, title: item.title, link: item.link, publishedAt: item.publishedAt,
          })), skipDuplicates: true }).then(() => ({ baseline: fresh.length, pushed: 0, skipped: knownGuids.size }));
        }
        if (fresh.length === 0) return { baseline: 0, pushed: 0, skipped: items.length };
        const batch = fresh.slice(0, 5);
        if (!subscription.dingtalkRobotId) throw new Error("RSS 订阅尚未选择钉钉机器人");
        return loadDingtalkConfig(subscription.dingtalkRobotId).then((config) => {
          return batch.reduce((previous, item) => previous.then(() => {
            const message = buildRssDingtalkMessage(subscription.name, item);
            return sendDingtalkNotification(config, message.title, message.text)
              .then(() => prisma.rssPushedItem.create({ data: {
                subscriptionId, guid: item.guid, title: item.title,
                link: item.link, publishedAt: item.publishedAt,
              } })).then(() => undefined);
          }), Promise.resolve()).then(() => ({ baseline: 0, pushed: batch.length, skipped: knownGuids.size }));
        });
      });
    }).then((result) => prisma.rssSubscription.update({
      where: { id: subscriptionId }, data: { lastFetchedAt: new Date(), lastError: null },
    }).then(() => result)).catch((error: unknown) => {
      const message = rssFailureMessage(error);
      return prisma.rssSubscription.update({ where: { id: subscriptionId }, data: { lastError: message } })
        .then(() => { throw error; });
    });
  });
}

function rssFailureMessage(error: unknown): string {
  /* 请求对象可能包含机器人凭证，只保存不带地址和请求头的原因。 */
  if (isAxiosError(error)) return "RSS 请求或钉钉发送失败";
  return error instanceof Error ? error.message : "RSS 抓取失败";
}

export function runDueRssSubscriptions(): Promise<{ checked: number; failed: number }> {
  return prisma.rssSubscription.findMany({ where: { enabled: true } }).then((subscriptions) => {
    const now = Date.now();
    const due = subscriptions.filter((subscription) => !subscription.lastFetchedAt
      || now >= subscription.lastFetchedAt.getTime() + subscription.intervalMinutes * 60_000);
    return Promise.allSettled(due.map((subscription) => fetchRssSubscription(subscription.id))).then((results) => {
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed) log.warn(`RSS 检查失败：${failed} 个订阅`);
      return { checked: due.length, failed };
    });
  });
}

export function resumeRssFetching(): void {
  acceptingFetches = true;
}

export function drainRssFetches(): Promise<void> {
  acceptingFetches = false;
  return Promise.allSettled([...inFlightFetches.values()]).then(() => undefined);
}
