import Parser from "rss-parser";
import { afterEach, describe, expect, it } from "vitest";

import { collectRssItems, drainRssFetches, fetchRssSubscription, resumeRssFetching, rssSubscriptionInput } from "./rss.service";
import { buildRssDingtalkMessage } from "./rss-notification";

afterEach(() => resumeRssFetching());

describe("RSS Feed 处理", () => {
  it("摘要 HTML 由 parse5 解析，保留文本与实体并移除脚本内容", () => {
    const message = buildRssDingtalkMessage("订阅", {
      guid: "entry", title: "标题", link: null, publishedAt: null,
      summary: "<p>2 &lt; 3 &amp; 5</p><script>unwanted()</script><style>body{display:none}</style>",
    });
    expect(message.text).toContain("2 < 3 & 5");
    expect(message.text).not.toContain("unwanted");
    expect(message.text).not.toContain("display:none");
  });
  it("使用真实 XML 解析器读取同次响应，按 GUID 去重并按时间排序", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>测试订阅</title><link>https://example.com</link><description>测试</description>
      <item><guid>b</guid><title>较新文章</title><pubDate>Fri, 16 Oct 2026 10:00:00 GMT</pubDate></item>
      <item><guid>a</guid><title>较早文章</title><pubDate>Thu, 15 Oct 2026 10:00:00 GMT</pubDate></item>
      <item><guid>b</guid><title>较新文章</title></item></channel></rss>`;
    return new Parser().parseString(xml).then((feed) => {
      expect(collectRssItems(feed.items).map((item) => item.guid)).toEqual(["a", "b"]);
    });
  });
  it("缺少标识的无效条目不会发送，非法日期不会进入数据库", () => {
    expect(collectRssItems([{ guid: "empty" }, { title: "文章", guid: "valid", pubDate: "invalid" }]))
      .toEqual([{ guid: "valid", title: "文章", link: null, publishedAt: null, summary: null }]);
  });
  it("订阅的部分更新不会改变抓取间隔与启用状态", () => {
    expect(rssSubscriptionInput.partial().parse({ name: "新名称" })).toEqual({ name: "新名称" });
  });
  it("订阅输入保存明确选择的机器人，关闭订阅可以清除关联", () => {
    expect(rssSubscriptionInput.parse({ name: "订阅", url: "https://feed.example.invalid/rss", dingtalkRobotId: "robot-a" }))
      .toMatchObject({ enabled: true, dingtalkRobotId: "robot-a" });
    expect(rssSubscriptionInput.partial().parse({ enabled: false, dingtalkRobotId: null }))
      .toEqual({ enabled: false, dingtalkRobotId: null });
    expect(rssSubscriptionInput.safeParse({ name: "订阅", url: "https://feed.example.invalid/rss", dingtalkRobotId: 123 }).success).toBe(false);
  });
  it("停止后拒绝新增抓取请求", () => {
    return drainRssFetches().then(() => expect(fetchRssSubscription("subscription")).rejects.toThrow("停止"));
  });
});
