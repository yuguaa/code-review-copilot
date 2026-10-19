import { describe, expect, it } from "vitest";

import { repositoryRoutes } from "../repositories/repositories.routes";
import { rssRoutes } from "../rss/rss.routes";
import { settingsRoutes } from "./settings.routes";

describe("管理接口输入校验", () => {
  it.each([
    [settingsRoutes, "/models", { provider: "invalid" }],
    [settingsRoutes, "/gitlab", { url: "file:///etc/passwd" }],
    [settingsRoutes, "/gitlab", { url: "https://example.com", accessToken: "token", isActive: true }],
    [settingsRoutes, "/dingtalk", { name: "机器人", enabled: "false" }],
    [repositoryRoutes, "/", { ocrConcurrency: 0 }],
    [rssRoutes, "/subscriptions", { name: "rss", url: "ftp://example.com", enabled: "false" }],
  ] as const)("无效输入在数据库操作前返回 400", (routes, path, body) => {
    const method = "POST";
    return Promise.resolve(routes.request(`http://localhost${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })).then((response) => {
      expect(response.status).toBe(400);
      return response.json().then((data) => expect(data).toHaveProperty("error"));
    });
  });
  it("Tools 和 Skills 管理地址已经移除", () => {
    return Promise.resolve(settingsRoutes.request("http://localhost/tool-skills")).then((response) => expect(response.status).toBe(404));
  });
});
