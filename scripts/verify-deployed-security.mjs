import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { chromium, expect } from "@playwright/test";

const execute = promisify(execFile);
const baseUrl = (process.env.PLATFORM_URL ?? "http://192.168.0.81:3000").replace(/\/$/, "");
const origin = new URL(baseUrl).origin;
const { stdout } = await execute("ssh", ["-o", "BatchMode=yes", "liuchang", "docker inspect code-review-copilot-platform-app-1"], {
  timeout: 15_000,
  maxBuffer: 1024 * 1024,
});
const environment = JSON.parse(stdout)[0].Config.Env;
const valueOf = (key) => environment.find((value) => value.startsWith(`${key}=`))?.slice(key.length + 1);
const username = valueOf("APP_AUTH_USERNAME");
const password = valueOf("APP_AUTH_SECRET");
assert(username && password, "部署服务缺少登录配置");
const runId = Date.now().toString(36);
const targetName = `平台安全测试部署验证 ${runId}`;
const authorizationReference = `DEPLOY-SECURITY-SELF-CHECK-${runId}`;

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "darwin" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(`${origin}/login`);
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(`${origin}/`, { timeout: 15_000 });

  const targetResponse = await context.request.post(`${origin}/api/security/targets`, {
    data: {
      name: targetName,
      baseUrl: "http://app.localhost:8787",
      scopeDomains: ["app.localhost"],
      authorizationOwner: "平台管理员",
      authorizationReference,
      authorizedUntil: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      scheduleEnabled: false,
      scheduleIntervalMinutes: 1440,
      isActive: true,
      maxDurationMinutes: 10,
    },
  });
  assert.equal(targetResponse.status(), 201, await targetResponse.text());
  const { target } = await targetResponse.json();
  const ticketResponse = await context.request.post(`${origin}/api/security/tickets`, { data: { targetId: target.id } });
  assert.equal(ticketResponse.status(), 201, await ticketResponse.text());
  const { ticket } = await ticketResponse.json();

  await page.goto(`${origin}/security`);
  await page.getByRole("heading", { name: "安全测试工单", exact: true }).waitFor();
  await expect(page.getByText(targetName, { exact: true }).first()).toBeVisible();
  await expect(page.locator('aside[aria-label="安全测试导航"]')).toBeVisible();
  await page.getByRole("link", { name: "测试目标", exact: true }).click();
  await page.getByRole("heading", { name: "测试目标", exact: true }).waitFor();
  await expect(page.getByText(authorizationReference, { exact: true }).first()).toBeVisible();
  await page.goto(`${origin}/security/tickets/${ticket.id}`);
  await page.getByRole("heading", { name: targetName, exact: true }).waitFor();

  let detail;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await context.request.get(`${origin}/api/security/tickets/${ticket.id}`);
    assert.equal(response.status(), 200);
    detail = (await response.json()).ticket;
    if (["completed", "failed", "cancelled", "interrupted"].includes(detail.status)) break;
    await page.waitForTimeout(2_000);
  }
  assert(detail, "没有读取到安全工单详情");
  assert(["completed", "failed", "cancelled", "interrupted"].includes(detail.status), `安全工单未结束：${detail.status}`);
  await page.reload();
  await expect(page.getByText("报告文件", { exact: true })).toBeVisible();
  const report = detail.artifacts.find((artifact) => artifact.type === "report" && artifact.filename === "report.md");
  assert(report, "安全工单没有生成 report.md");
  assert.deepEqual(errors, [], `页面存在运行错误：${errors.join("；")}`);
  console.log(JSON.stringify({
    targetId: target.id,
    ticketId: ticket.id,
    status: detail.status,
    summary: detail.summary,
    error: detail.error,
    findings: detail.findings.length,
    artifacts: detail.artifacts.length,
  }));
} finally {
  await context.request.post(`${origin}/api/auth/logout`).catch(() => undefined);
  await browser.close();
}
