import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type EmbeddedPostgres from 'embedded-postgres';
import type { VerificationContext } from './request-verification';

export function preserveConfigurationAcrossMigration(
  postgres: EmbeddedPostgres,
  check: VerificationContext['check'],
  secrets: string[],
  deploy: () => Promise<unknown>,
): Promise<void> {
  const client = postgres.getPgClient('platform_verification', '127.0.0.1');
  const credential = () => {
    const value = randomBytes(24).toString('hex');
    secrets.push(value);
    return value;
  };
  const snapshot = (migrated = false) => [
    'SELECT * FROM gitlab_accounts ORDER BY id',
    'SELECT * FROM ai_models ORDER BY id',
    `SELECT id, "gitLabAccountId", "gitLabProjectId", name, path, description, "watchBranches", "autoReview",
      "defaultAIModelId", "customProvider", "customModelId", "customApiKey", "customApiBaseUrl", "customMaxSteps",
      "defaultReviewPrompt", "enableMrComment", "enableDingtalk", ${migrated
        ? '(SELECT "webhookUrl" FROM dingtalk_robots WHERE id = repositories."dingtalkRobotId") AS "dingtalkWebhook", (SELECT secret FROM dingtalk_robots WHERE id = repositories."dingtalkRobotId") AS "dingtalkSecret"'
        : '"dingtalkWebhook", "dingtalkSecret"'}, "isActive", "createdAt", "updatedAt"
      FROM repositories ORDER BY id`,
    'SELECT id, name, url, enabled, "intervalMinutes", "lastFetchedAt", "lastError", "createdAt", "updatedAt" FROM rss_subscriptions ORDER BY id',
    migrated
      ? 'SELECT enabled AS "dingtalkEnabled", "webhookUrl" AS "dingtalkWebhookUrl", secret AS "dingtalkSecret", "createdAt", "updatedAt" FROM dingtalk_robots WHERE id = \'notification-preserved-notification\''
      : 'SELECT "dingtalkEnabled", "dingtalkWebhookUrl", "dingtalkSecret", "createdAt", "updatedAt" FROM notification_settings ORDER BY id',
  ].reduce<Promise<unknown[][]>>((pending, sql) => pending.then((tables) =>
    client.query(sql).then(({ rows }: { rows: unknown[] }) => [...tables, rows])), Promise.resolve([]));
  let before: Awaited<ReturnType<typeof snapshot>>;

  return client.connect().then(() => check('迁移前保存仓库、模型、GitLab、RSS 与通知配置', () =>
    client.query(`INSERT INTO gitlab_accounts (id, url, "accessToken", "webhookSecret", "isActive", "updatedAt")
      VALUES ('preserved-gitlab', 'https://preserved-gitlab.example.invalid', $1, $2, false, CURRENT_TIMESTAMP)`, [credential(), credential()])
      .then(() => client.query(`INSERT INTO ai_models (id, provider, "modelId", "apiKey", "apiBaseUrl", "maxSteps", "isDefault", "isActive", "updatedAt")
        VALUES ('preserved-model', 'openai-compatible', 'preserved-model', $1, 'https://preserved-model.example.invalid/v1', 12, false, false, CURRENT_TIMESTAMP)`, [credential()]))
      .then(() => client.query(`INSERT INTO repositories (id, "gitLabAccountId", "gitLabProjectId", name, path, description, "watchBranches", "autoReview",
        "defaultAIModelId", "customProvider", "customModelId", "customApiKey", "customApiBaseUrl", "customMaxSteps", "defaultReviewPrompt",
        "enableMrComment", "enableDingtalk", "dingtalkWebhook", "dingtalkSecret", memory, "isActive", "updatedAt")
        VALUES ('preserved-repository', 'preserved-gitlab', 99, '保留仓库', 'preserved/repository', '验证迁移前配置', 'main,release/*', false,
          'preserved-model', 'openai-compatible', 'preserved-custom', $1, 'https://preserved-custom.example.invalid/v1', 8, '保留审查要求',
          false, false, $2, $3, '旧项目记忆', false, CURRENT_TIMESTAMP)`, [credential(), `https://preserved-notification.example.invalid/?token=${credential()}`, credential()]))
      .then(() => client.query(`INSERT INTO rss_subscriptions (id, name, url, enabled, "intervalMinutes", "lastFetchedAt", "lastError", "updatedAt")
        VALUES ('preserved-rss', '保留 RSS', 'https://preserved-rss.example.invalid/feed.xml', false, 45, CURRENT_TIMESTAMP, '验证迁移前状态', CURRENT_TIMESTAMP)`))
      .then(() => client.query(`INSERT INTO notification_settings (id, scope, "dingtalkEnabled", "dingtalkWebhookUrl", "dingtalkSecret", "updatedAt")
        VALUES ('preserved-notification', 'global', true, $1, $2, CURRENT_TIMESTAMP)`, [`https://preserved-global.example.invalid/?token=${credential()}`, credential()]))
      .then(() => snapshot()).then((tables: unknown[][]) => {
        assert.ok(tables.every((table: unknown[]) => table.length === 1), '迁移前配置数量不符合预期');
        before = tables;
      })))
    .then(() => check('迁移前建立审查历史与消息关联', () => client.query(`INSERT INTO sessions (id, kind, title, "repositoryId", status, "updatedAt")
      VALUES ('preserved-history', 'review', '迁移验证历史', 'preserved-repository', 'running', CURRENT_TIMESTAMP)`)
      .then(() => client.query(`INSERT INTO messages (id, "sessionId", role, parts)
        VALUES ('preserved-message', 'preserved-history', 'user', $1::jsonb)`, [JSON.stringify([{ type: 'text', text: '迁移验证输入' }])]))
      .then(() => client.query(`UPDATE sessions SET "activeLeafMessageId" = 'preserved-message' WHERE id = 'preserved-history'`))
      .then(() => client.query(`INSERT INTO review_runs (id, "sessionId", "repositoryId", "engineKey", status, "updatedAt")
        VALUES ('preserved-review-run', 'preserved-history', 'preserved-repository', 'ocr-review', 'running', CURRENT_TIMESTAMP)`))
      .then(() => client.query('SELECT (SELECT COUNT(*) FROM sessions)::int AS sessions, (SELECT COUNT(*) FROM messages)::int AS messages, (SELECT COUNT(*) FROM review_runs)::int AS runs'))
      .then(({ rows }: { rows: unknown[] }) => assert.deepEqual(rows[0], { sessions: 1, messages: 1, runs: 1 }))))
    .then(() => check('建立使用全局机器人的仓库', () => client.query(`
      INSERT INTO repositories (id, "gitLabAccountId", "gitLabProjectId", name, path, "autoReview", "enableDingtalk", "isActive", "updatedAt")
      VALUES ('global-target-repository', 'preserved-gitlab', 100, '全局通知仓库', 'preserved/global', false, true, false, CURRENT_TIMESTAMP)
    `).then(() => undefined)))
    .then(() => check('Prisma CLI 应用平台迁移', deploy))
    .then(() => check('迁移后配置数量、内容、凭证和关联完全保留', () => snapshot(true).then((after) => {
      after[2] = after[2].filter((row) => (row as { id: string }).id !== 'global-target-repository');
      assert.ok(isDeepStrictEqual(before, after), '迁移后配置内容、凭证或关联发生变化');
      return client.query(`SELECT "ocrConcurrency", "ocrTimeoutMinutes", "ocrMaxTokensBudget" FROM repositories WHERE id = 'preserved-repository'`);
    }).then(({ rows }: { rows: unknown[] }) => assert.deepEqual(rows[0], { ocrConcurrency: 2, ocrTimeoutMinutes: 10, ocrMaxTokensBudget: 1_000_000 }))))
    .then(() => check('独立机器人与全局机器人凭证分别保留，仓库和 RSS 绑定正确', () => client.query(`
      SELECT (SELECT "dingtalkRobotId" FROM repositories WHERE id = 'preserved-repository') AS repository_robot,
        (SELECT "dingtalkRobotId" FROM rss_subscriptions WHERE id = 'preserved-rss') AS rss_robot,
        (SELECT COUNT(*)::int FROM dingtalk_robots) AS robots,
        (SELECT enabled FROM dingtalk_robots WHERE id = 'notification-preserved-notification') AS global_enabled,
        (SELECT "dingtalkRobotId" FROM repositories WHERE id = 'global-target-repository') AS global_repository_robot,
        (SELECT "enableDingtalk" FROM repositories WHERE id = 'global-target-repository') AS global_repository_enabled
    `).then(({ rows }: { rows: unknown[] }) => assert.deepEqual(rows[0], {
      repository_robot: 'repository-preserved-repository', rss_robot: 'notification-preserved-notification', robots: 2, global_enabled: true,
      global_repository_robot: 'notification-preserved-notification', global_repository_enabled: true,
    }))))
    .then(() => check('迁移后移除旧审查历史与旧配置结构', () => client.query(`
      SELECT (SELECT COUNT(*)::int FROM sessions) AS sessions, (SELECT COUNT(*)::int FROM messages) AS messages,
        (SELECT COUNT(*)::int FROM runs) AS runs,
        (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema = 'public'
          AND table_name IN ('notification_settings', 'review_runs', 'agent_tools', 'agent_skills', 'repository_tool_settings', 'repository_skill_settings')) AS legacy_tables,
        (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'repositories' AND column_name IN ('memory', 'dingtalkWebhook', 'dingtalkSecret')) AS memory_columns
    `).then(({ rows }: { rows: unknown[] }) => assert.deepEqual(rows[0], { sessions: 0, messages: 0, runs: 0, legacy_tables: 0, memory_columns: 0 }))))
    .finally(() => client.end());
}
