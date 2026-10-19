import { parseFragment } from "parse5";

import type { DefaultTreeAdapterMap } from "parse5";

export type RssItem = {
  guid: string;
  title: string;
  link: string | null;
  publishedAt: Date | null;
  summary: string | null;
};

function compactSummary(summary: string | null): string {
  if (!summary) return "";
  const nodes: DefaultTreeAdapterMap["node"][] = [...parseFragment(summary).childNodes].reverse();
  const parts: string[] = [];
  while (nodes.length) {
    const node = nodes.pop()!;
    if ("tagName" in node && ["script", "style", "template"].includes(node.tagName)) continue;
    if ("value" in node) parts.push(node.value);
    if ("childNodes" in node) {
      parts.push(" ");
      nodes.push(...[...node.childNodes].reverse());
    }
  }
  const compact = parts.join("").replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}…` : compact;
}

export function buildRssDingtalkMessage(subscriptionName: string, item: RssItem): { title: string; text: string } {
  const summary = compactSummary(item.summary);
  const date = item.publishedAt?.toLocaleString("zh-CN", { hour12: false }) ?? "未提供发布时间";
  const lines = [
    `### 📰 ${subscriptionName}`, "", `**${item.title}**`, "",
    ...(summary ? [summary, ""] : []), `> 发布时间：${date}`,
  ];
  if (item.link) lines.push("", `[阅读全文](${item.link})`);
  return { title: `RSS 更新 · ${subscriptionName} · ${item.title}`, text: lines.join("\n") };
}
