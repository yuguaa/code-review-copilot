import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { chromium, expect } from "@playwright/test";

const execute = promisify(execFile);
const baseUrl = process.env.PLATFORM_URL;
if (!baseUrl) throw new Error("请通过 PLATFORM_URL 指定部署地址");
const origin = new URL(baseUrl).origin;
const { stdout } = await execute("ssh", ["-o", "BatchMode=yes", "liuchang", "docker inspect code-review-copilot-platform-app-1"], { timeout: 15_000, maxBuffer: 1024 * 1024 });
const environment = JSON.parse(stdout)[0].Config.Env;
const valueOf = (key) => environment.find((value) => value.startsWith(`${key}=`))?.slice(key.length + 1);
const username = valueOf("APP_AUTH_USERNAME");
const password = valueOf("APP_AUTH_SECRET");
assert(username && password, "部署服务缺少登录配置");
const browser = await chromium.launch({ headless: true, ...(process.platform === "darwin" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const createdRobotIds = [];
page.on("pageerror", (error) => errors.push(error.message));
const waitForData = (paths) => Promise.all(paths.map((path) => page.waitForResponse((response) =>
  response.request().method() === "GET" && new URL(response.url()).origin === origin && new URL(response.url()).pathname === path,
{ timeout: 15_000 }).then((response) => {
  assert.equal(response.status(), 200, `${path} 数据加载失败`);
  return response.finished().then((error) => { assert.equal(error, null, `${path} 响应没有完成`); });
})));
const assertLoaded = () => expect(page.getByRole("status", { name: "正在加载", exact: true })).toHaveCount(0)
  .then(() => expect(page.getByText("加载失败", { exact: true })).toHaveCount(0))
  .then(() => expect(page.getByText("请求失败", { exact: true })).toHaveCount(0));
let createdSession;
try {
  await page.goto(`${origin}/login`);
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const activitiesLoaded = waitForData(["/api/runs", "/api/repositories"]);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await activitiesLoaded;
  await page.waitForURL(`${origin}/`, { timeout: 15_000 });
  await page.getByRole("heading", { name: "Review 历史记录", exact: true }).waitFor();
  await assertLoaded();
  const primaryNavigation = page.getByRole("navigation", { name: "一级导航" });
  for (const label of ["Code Review", "仓库", "模型", "连接器", "RSS"]) {
    await expect(primaryNavigation.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  const historyNavigation = page.locator('aside[aria-label="Review 历史记录"]');
  await expect(historyNavigation).toBeVisible();
  const historyResponse = await context.request.get(`${origin}/api/runs?page=1`);
  assert.equal(historyResponse.status(), 200);
  const historyRuns = (await historyResponse.json()).runs;
  const sidebarRunIds = await historyNavigation.locator('a[href^="/runs/"]').evaluateAll((links) =>
    links.map((link) => new URL(link.href).pathname.split("/").at(-1)));
  assert.deepEqual(sidebarRunIds, historyRuns.map((run) => run.id), "Review 历史记录与运行数据不一致");
  console.info("浏览器：登录、Code Review 与 Review 历史记录通过");
  const repositoriesResponse = await context.request.get(`${origin}/api/repositories`);
  assert.equal(repositoriesResponse.status(), 200);
  const { repositories } = await repositoriesResponse.json();
  assert.equal(repositories.length, 17, "仓库配置数量不一致");
  assert(repositories.every((repository) => !("customApiKey" in repository) && !("dingtalkWebhook" in repository) && !("dingtalkSecret" in repository)));
  const reviewRequests = [];
  const recordReviewRequest = (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/runs") reviewRequests.push(request);
  };
  page.on("request", recordReviewRequest);
  await page.getByRole("button", { name: "新建审查", exact: true }).click();
  const reviewDialog = page.getByRole("dialog", { name: "新建代码审查", exact: true });
  await expect(reviewDialog).toBeVisible();
  await expect(reviewDialog.getByLabel("审查仓库").locator("option")).toHaveCount(repositories.length + 1);
  await reviewDialog.getByLabel("审查仓库").selectOption(repositories[0].id);
  await expect(reviewDialog.getByLabel("审查类型")).toHaveValue("commit");
  await expect(reviewDialog.getByLabel("Commit SHA")).toBeVisible();
  await expect(reviewDialog.getByRole("button", { name: "开始审查", exact: true })).toBeEnabled();
  await reviewDialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(reviewDialog).toHaveCount(0);
  assert.equal(page.url(), `${origin}/`, "取消新建审查后没有停留在首页");
  assert.equal(reviewRequests.length, 0, "取消新建审查仍然提交了运行请求");
  page.off("request", recordReviewRequest);
  console.info("浏览器：首页新建审查弹窗与取消检查通过");
  for (const [path, label, dataPaths] of [
    ["/repositories", "仓库", ["/api/repositories", "/api/settings/gitlab", "/api/settings/models"]],
    ["/models", "模型", ["/api/settings/models"]],
    ["/connections", "连接器", ["/api/settings/gitlab"]],
    ["/rss", "RSS", ["/api/rss/subscriptions"]],
  ]) {
    await Promise.all([waitForData(dataPaths), page.goto(`${origin}${path}`)]);
    await page.locator("h1").first().waitFor();
    await assertLoaded();
    await expect(page.locator('aside[aria-label="Review 历史记录"]')).toHaveCount(0);
    assert((await page.locator("main").innerText()).includes(label));
    assert.equal(await page.getByText("请求失败", { exact: true }).count(), 0);
    console.info(`浏览器：${label} 页面通过`);
  }
  await page.goto(`${origin}/runs/b75d0514-396c-41fa-85a9-06a8a1e88bee`);
  const codeBlock = page.locator('[data-streamdown="code-block"]').first();
  await codeBlock.waitFor();
  const codeContrast = await codeBlock.evaluate((block) => {
    const foreground = getComputedStyle(block.querySelector('code') ?? block).color;
    const background = getComputedStyle(block).backgroundColor;
    const channels = (color) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (color) => channels(color).map((value) => value / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
    const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
    return { foreground, background, ratio: (values[0] + 0.05) / (values[1] + 0.05) };
  });
  assert(codeContrast.ratio >= 4.5, `报告代码块对比度不足：${JSON.stringify(codeContrast)}`);
  await page.getByRole('tab', { name: '追问', exact: true }).click();
  await page.locator('[data-ai-element="conversation"]').waitFor();
  await page.locator('[data-ai-element="message"]').first().waitFor();
  await page.locator('[data-ai-element="prompt-input"]').waitFor();
  console.info(`浏览器：报告代码块对比度 ${codeContrast.ratio.toFixed(2)}，AI Elements 对话组件通过`);
  await page.goto(`${origin}/connections`);
  await Promise.all([waitForData(["/api/settings/dingtalk"]), page.getByRole("tab", { name: "钉钉", exact: true }).click()]);
  const robotsBeforeResponse = await context.request.get(`${origin}/api/settings/dingtalk`);
  assert.equal(robotsBeforeResponse.status(), 200);
  const robotsBefore = (await robotsBeforeResponse.json()).robots;
  for (const suffix of ["A", "B"]) {
    const name = `部署验证机器人-${Date.now()}-${suffix}`;
    await page.getByRole("button", { name: "添加机器人", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "添加钉钉机器人", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("机器人名称", { exact: true }).fill(name);
    await dialog.getByLabel("Webhook URL", { exact: true }).fill(`https://browser-robot.example.invalid/${suffix}`);
    await dialog.getByLabel("签名 Secret", { exact: true }).fill(`browser-verification-${suffix}`);
    await dialog.getByRole("checkbox", { name: "启用机器人", exact: true }).uncheck();
    const [savedResponse] = await Promise.all([
      page.waitForResponse((result) => result.request().method() === "POST" && new URL(result.url()).pathname === "/api/settings/dingtalk"),
      dialog.getByRole("button", { name: "保存配置", exact: true }).click(),
    ]);
    assert.equal(savedResponse.status(), 201);
    const { robot } = await savedResponse.json();
    createdRobotIds.push(robot.id);
    assert.equal(robot.name, name);
    assert.equal(robot.enabled, false);
    assert.equal(robot.repositoryCount, 0);
    assert.equal(robot.rssSubscriptionCount, 0);
    assert.equal(robot.hasWebhookUrl, true);
    assert.equal(robot.hasSecret, true);
    assert(!("webhookUrl" in robot) && !("secret" in robot));
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-slot="card"]').filter({ hasText: name })).toBeVisible();
  }
  const robotsAfterResponse = await context.request.get(`${origin}/api/settings/dingtalk`);
  assert.equal(robotsAfterResponse.status(), 200);
  const robotsAfter = (await robotsAfterResponse.json()).robots;
  assert.deepEqual(robotsAfter.filter((robot) => !createdRobotIds.includes(robot.id)), robotsBefore);
  for (const robotId of createdRobotIds) {
    assert.equal((await context.request.delete(`${origin}/api/settings/dingtalk/${robotId}`)).status(), 200);
  }
  createdRobotIds.length = 0;
  console.info("浏览器：多个停用机器人表单、凭证隐藏和清理通过");
  const response = await context.request.post(`${origin}/api/sessions`, { data: { repositoryId: repositories[0].id, title: "部署流程验证" } });
  createdSession = (await response.json()).session?.id;
  assert.equal(response.status(), 201);
  await page.goto(`${origin}/c/${createdSession}`);
  await page.getByLabel("追问内容").waitFor();
  assert((await page.locator("main").innerText()).includes("部署流程验证"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("dialog").waitFor();
  console.info("浏览器：会话详情与移动端导航通过");
  const grafanaUserResponse = await context.request.get(`${origin}/observability/api/user`);
  assert.equal(grafanaUserResponse.status(), 200);
  assert.equal((await grafanaUserResponse.json()).login, username);
  for (const uid of ["prometheus", "tempo"]) {
    const health = await context.request.get(`${origin}/observability/api/datasources/uid/${uid}/health`);
    assert.equal(health.status(), 200, `遥测数据源 ${uid} 未就绪`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/observability/d/review-platform`);
  await page.getByText("代码审查运行", { exact: true }).first().waitFor({ timeout: 30_000 });
  console.info("浏览器：Grafana 统一登录、仪表盘和数据源通过");
  const deleted = await context.request.delete(`${origin}/api/sessions/${createdSession}`);
  assert.equal(deleted.status(), 200);
  createdSession = undefined;
  const cookies = await context.cookies();
  const copied = cookies.find((cookie) => cookie.name === "code_review_copilot_session");
  assert(copied);
  assert.equal((await context.request.post(`${origin}/api/auth/logout`)).status(), 200);
  const revoked = await fetch(`${origin}/observability/api/user`, { headers: { Cookie: `${copied.name}=${copied.value}` } });
  assert.equal(revoked.status, 401);
  assert.deepEqual(errors, [], "浏览器出现运行异常");
  console.info("浏览器：退出、复制凭证撤销和运行异常检查通过");
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [password, valueOf("APP_AUTH_SESSION_SECRET")].filter(Boolean)) message = message.replaceAll(secret, "[REDACTED]");
  console.error(message);
  process.exitCode = 1;
} finally {
  for (const robotId of createdRobotIds) await context.request.delete(`${origin}/api/settings/dingtalk/${robotId}`);
  if (createdSession) await context.request.delete(`${origin}/api/sessions/${createdSession}`);
  await context.request.post(`${origin}/api/auth/logout`);
  await browser.close();
}
