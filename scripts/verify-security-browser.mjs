import assert from "node:assert/strict";

import "dotenv/config";
import { chromium, expect } from "@playwright/test";

const baseUrl = (process.env.SECURITY_BROWSER_URL ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const username = process.env.APP_AUTH_USERNAME;
const password = process.env.APP_AUTH_SECRET;
const ticketId = process.env.SECURITY_TICKET_ID;
assert(username && password, "缺少登录凭证");
assert(ticketId, "请通过 SECURITY_TICKET_ID 指定安全工单");

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "darwin" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(`${baseUrl}/`, { timeout: 15_000 });

  const primaryNavigation = page.getByRole("navigation", { name: "一级导航" });
  await expect(primaryNavigation.getByRole("link", { name: "安全测试", exact: true })).toBeVisible();
  assert.equal(await primaryNavigation.getByRole("link").first().getAttribute("aria-label"), "Code Review");

  await page.goto(`${baseUrl}/security`);
  await page.getByRole("heading", { name: "安全测试工单", exact: true }).waitFor();
  await expect(page.locator('aside[aria-label="安全测试导航"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "安全测试工单", exact: true })).toHaveClass(/bg-sidebar-accent/);
  await expect(page.getByText("平台安全测试验证目标", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("执行失败", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "测试目标", exact: true }).click();
  await page.waitForURL(`${baseUrl}/security/targets`);
  await page.getByRole("heading", { name: "测试目标", exact: true }).waitFor();
  await expect(page.getByRole("link", { name: "测试目标", exact: true })).toHaveClass(/bg-sidebar-accent/);
  await expect(page.getByText("平台安全测试验证目标", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("LOCAL-VERIFICATION", { exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/security/tickets/${ticketId}`);
  await page.getByRole("heading", { name: "平台安全测试验证目标", exact: true }).waitFor();
  await expect(page.getByText("测试报告", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("报告文件", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "report.md", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "report.html", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "安全测试工单", exact: true })).toHaveClass(/bg-sidebar-accent/);

  await page.goto(`${baseUrl}/security`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await expect(page.getByRole("link", { name: "安全测试", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "测试目标", exact: true })).toBeVisible();

  assert.deepEqual(errors, [], `页面存在运行错误：${errors.join("；")}`);
  console.info("安全测试前端：导航、工单、目标、详情、报告与移动端菜单通过");
} finally {
  await context.request.post(`${baseUrl}/api/auth/logout`).catch(() => undefined);
  await browser.close();
}
