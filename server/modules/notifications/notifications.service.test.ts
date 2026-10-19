import { describe, expect, it } from "vitest";

import { loadRepositoryDingtalkConfig, sendRepositoryDingtalkNotification } from "./notifications.service";

const repository = { enableDingtalk: true, dingtalkRobotId: null };

describe("钉钉发送配置", () => {
  it("开启通知但未选择机器人立即失败", () => {
    return expect(loadRepositoryDingtalkConfig(repository)).rejects.toThrow("选择钉钉机器人");
  });
  it("关闭仓库通知立即返回 skipped，不读取数据库或发送请求", () => {
    return sendRepositoryDingtalkNotification({ ...repository, enableDingtalk: false }, "标题", "正文")
      .then((result) => expect(result).toBe("skipped"));
  });
  it("关闭通知不要求选择机器人", () => {
    return expect(loadRepositoryDingtalkConfig({ ...repository, enableDingtalk: false })).resolves.toBeNull();
  });
});
