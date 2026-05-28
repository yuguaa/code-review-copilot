#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import "dotenv/config";

const execFileAsync = promisify(execFile);

const REQUIRED_TABLES = [
  "gitlab_accounts",
  "ai_models",
  "repositories",
  "review_logs",
  "review_comments",
  "notification_settings",
];

const MIGRATION_TABLES = [
  {
    name: "GitLabAccount",
    sourceTable: "gitlab_accounts",
    targetModel: "gitLabAccount",
    requiredColumns: [
      "id",
      "url",
      "accessToken",
      "webhookSecret",
      "isActive",
      "createdAt",
      "updatedAt",
    ],
    map: (row) => ({
      id: row.id,
      url: row.url,
      accessToken: row.accessToken,
      webhookSecret: row.webhookSecret,
      isActive: toBoolean(row.isActive),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    }),
  },
  {
    name: "AIModel",
    sourceTable: "ai_models",
    targetModel: "aIModel",
    requiredColumns: [
      "id",
      "provider",
      "modelId",
      "apiKey",
      "apiEndpoint",
      "maxTokens",
      "temperature",
      "isActive",
      "createdAt",
      "updatedAt",
    ],
    map: (row) => ({
      id: row.id,
      provider: row.provider,
      modelId: row.modelId,
      apiKey: row.apiKey,
      apiEndpoint: row.apiEndpoint,
      maxTokens: toNullableNumber(row.maxTokens),
      temperature: toNullableNumber(row.temperature),
      isActive: toBoolean(row.isActive),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    }),
  },
  {
    name: "Repository",
    sourceTable: "repositories",
    targetModel: "repository",
    requiredColumns: [
      "id",
      "gitLabProjectId",
      "name",
      "path",
      "description",
      "gitLabAccountId",
      "isActive",
      "autoReview",
      "defaultAIModelId",
      "watchBranches",
      "customPrompt",
      "customPromptMode",
      "customProvider",
      "customModelId",
      "customApiKey",
      "customApiEndpoint",
      "customMaxTokens",
      "customTemperature",
      "createdAt",
      "updatedAt",
    ],
    map: (row) => ({
      id: row.id,
      gitLabProjectId: Number(row.gitLabProjectId),
      name: row.name,
      path: row.path,
      description: row.description,
      gitLabAccountId: row.gitLabAccountId,
      isActive: toBoolean(row.isActive),
      autoReview: toBoolean(row.autoReview),
      defaultAIModelId: row.defaultAIModelId,
      watchBranches: row.watchBranches,
      customPrompt: row.customPrompt,
      customPromptMode: row.customPromptMode ?? "extend",
      customProvider: row.customProvider,
      customModelId: row.customModelId,
      customApiKey: row.customApiKey,
      customApiEndpoint: row.customApiEndpoint,
      customMaxTokens: toNullableNumber(row.customMaxTokens),
      customTemperature: toNullableNumber(row.customTemperature),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    }),
  },
  {
    name: "ReviewLog",
    sourceTable: "review_logs",
    targetModel: "reviewLog",
    requiredColumns: [
      "id",
      "repositoryId",
      "mergeRequestId",
      "mergeRequestIid",
      "sourceBranch",
      "targetBranch",
      "author",
      "authorUsername",
      "title",
      "description",
      "commitSha",
      "commitShortId",
      "status",
      "error",
      "totalFiles",
      "reviewedFiles",
      "criticalIssues",
      "normalIssues",
      "suggestions",
      "aiSummary",
      "aiResponse",
      "reviewPrompts",
      "aiModelProvider",
      "aiModelId",
      "gitlabDiscussionId",
      "gitlabNoteId",
      "startedAt",
      "completedAt",
    ],
    map: (row) => ({
      id: row.id,
      repositoryId: row.repositoryId,
      mergeRequestId: Number(row.mergeRequestId),
      mergeRequestIid: Number(row.mergeRequestIid),
      sourceBranch: row.sourceBranch,
      targetBranch: row.targetBranch,
      author: row.author,
      authorUsername: row.authorUsername,
      title: row.title,
      description: row.description,
      commitSha: row.commitSha,
      commitShortId: row.commitShortId,
      status: row.status,
      error: row.error,
      totalFiles: Number(row.totalFiles),
      reviewedFiles: Number(row.reviewedFiles ?? 0),
      criticalIssues: Number(row.criticalIssues ?? 0),
      normalIssues: Number(row.normalIssues ?? 0),
      suggestions: Number(row.suggestions ?? 0),
      aiSummary: row.aiSummary,
      aiResponse: row.aiResponse,
      reviewPrompts: row.reviewPrompts,
      aiModelProvider: row.aiModelProvider,
      aiModelId: row.aiModelId,
      gitlabDiscussionId: row.gitlabDiscussionId,
      gitlabNoteId: toNullableNumber(row.gitlabNoteId),
      startedAt: toDate(row.startedAt),
      completedAt: toNullableDate(row.completedAt),
    }),
  },
  {
    name: "ReviewComment",
    sourceTable: "review_comments",
    targetModel: "reviewComment",
    requiredColumns: [
      "id",
      "reviewLogId",
      "filePath",
      "lineNumber",
      "lineRangeEnd",
      "severity",
      "content",
      "diffHunk",
      "gitlabCommentId",
      "isPosted",
      "createdAt",
      "updatedAt",
    ],
    map: (row) => ({
      id: row.id,
      reviewLogId: row.reviewLogId,
      filePath: row.filePath,
      lineNumber: Number(row.lineNumber),
      lineRangeEnd: toNullableNumber(row.lineRangeEnd),
      severity: row.severity,
      content: row.content,
      diffHunk: row.diffHunk,
      confidence: null,
      gitlabCommentId: row.gitlabCommentId,
      isPosted: toBoolean(row.isPosted),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    }),
  },
  {
    name: "NotificationSetting",
    sourceTable: "notification_settings",
    targetModel: "notificationSetting",
    requiredColumns: [
      "id",
      "scope",
      "dingtalkWebhookUrl",
      "dingtalkSecret",
      "dingtalkEnabled",
      "createdAt",
      "updatedAt",
    ],
    map: (row) => ({
      id: row.id,
      scope: row.scope,
      dingtalkWebhookUrl: row.dingtalkWebhookUrl,
      dingtalkSecret: row.dingtalkSecret,
      dingtalkEnabled: toBoolean(row.dingtalkEnabled),
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    }),
  },
];

const args = parseArgs(process.argv.slice(2));
const sourcePath = path.resolve(args.source ?? "prisma/dev.db");
const dryRun = args.dryRun;
const force = args.force;

if (args.help) {
  printHelp();
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  fail("缺少 DATABASE_URL，请先配置 PostgreSQL 连接字符串。");
}

if (!process.env.DATABASE_URL.startsWith("postgresql://") && !process.env.DATABASE_URL.startsWith("postgres://")) {
  fail("DATABASE_URL 必须指向 PostgreSQL，不能指向 SQLite。");
}

if (!existsSync(sourcePath)) {
  fail(`SQLite 源文件不存在：${sourcePath}`);
}

await assertReadable(sourcePath);
await assertSqliteCli();

console.log(`SQLite 源库：${sourcePath}`);
console.log(`PostgreSQL：${maskDatabaseUrl(process.env.DATABASE_URL)}`);
console.log(`执行模式：${dryRun ? "dry-run（只校验不写入）" : "write（写入 PostgreSQL）"}`);

const sourceSchema = await loadSourceSchema(sourcePath);
validateSourceSchema(sourceSchema);

const sourceCounts = await loadSourceCounts(sourcePath);
printCounts("源库记录数", sourceCounts);

if (dryRun) {
  console.log("dry-run 校验通过，没有写入 PostgreSQL。");
  process.exit(0);
}

if (!force) {
  fail("写入 PostgreSQL 需要显式传入 --force。建议先运行 npm run db:migrate:sqlite -- --dry-run。");
}

const prisma = new PrismaClient();

try {
  await prisma.$connect();
  await assertTargetSchema(prisma);
  await prisma.$transaction(
    (tx) => migrate(tx, sourcePath),
    {
      maxWait: 10_000,
      timeout: 60_000,
    },
  );
  const targetCounts = await loadTargetCounts(prisma);
  printCounts("目标库记录数", targetCounts);
} finally {
  await prisma.$disconnect();
}

function parseArgs(rawArgs) {
  const parsed = {
    source: undefined,
    dryRun: false,
    force: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      parsed.force = true;
      continue;
    }

    if (arg === "--source") {
      parsed.source = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--source=")) {
      parsed.source = arg.slice("--source=".length);
      continue;
    }

    fail(`未知参数：${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`
用法：
  npm run db:migrate:sqlite -- --dry-run
  npm run db:migrate:sqlite -- --source prisma/dev.db --force

参数：
  --source <path>   SQLite 源文件，默认 prisma/dev.db
  --dry-run         只校验源库结构和统计，不写 PostgreSQL
  --force           确认写入 PostgreSQL
`);
}

async function assertReadable(filePath) {
  try {
    await access(filePath, constants.R_OK);
  } catch {
    fail(`SQLite 源文件不可读：${filePath}`);
  }
}

async function assertSqliteCli() {
  try {
    await execFileAsync("sqlite3", ["-version"]);
  } catch {
    fail("未找到 sqlite3 CLI。请先安装 sqlite3，再运行迁移脚本。");
  }
}

async function loadSourceSchema(sqlitePath) {
  const rows = await sqliteJson(sqlitePath, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  const schema = new Map();

  for (const row of rows) {
    const table = row.name;
    const columns = await sqliteJson(sqlitePath, `PRAGMA table_info(${quoteIdentifier(table)})`);
    schema.set(
      table,
      new Set(columns.map((column) => column.name)),
    );
  }

  return schema;
}

function validateSourceSchema(schema) {
  const missingTables = REQUIRED_TABLES.filter((table) => !schema.has(table));

  if (missingTables.length > 0) {
    fail(`SQLite 源库缺少必要表：${missingTables.join(", ")}。请使用最新旧版 SQLite 数据库文件。`);
  }

  if (schema.has("branch_configs")) {
    fail("SQLite 源库仍包含已废弃的 branch_configs 表。该旧结构无法无损迁移到当前 PostgreSQL schema。");
  }

  for (const table of MIGRATION_TABLES) {
    const columns = schema.get(table.sourceTable);
    const missingColumns = table.requiredColumns.filter((column) => !columns.has(column));

    if (missingColumns.length > 0) {
      fail(`${table.sourceTable} 缺少必要字段：${missingColumns.join(", ")}`);
    }
  }
}

async function loadSourceCounts(sqlitePath) {
  const counts = {};

  for (const table of MIGRATION_TABLES) {
    const rows = await sqliteJson(sqlitePath, `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.sourceTable)}`);
    counts[table.name] = Number(rows[0]?.count ?? 0);
  }

  return counts;
}

async function assertTargetSchema(prisma) {
  for (const table of MIGRATION_TABLES) {
    if (!prisma[table.targetModel]) {
      fail(`Prisma Client 缺少模型：${table.targetModel}。请先运行 npx prisma generate。`);
    }
  }

  await prisma.$queryRaw`SELECT 1`;
}

async function migrate(prisma, sqlitePath) {
  const runId = randomUUID();
  console.log(`迁移批次：${runId}`);

  for (const table of MIGRATION_TABLES) {
    const rows = await sqliteJson(sqlitePath, `SELECT * FROM ${quoteIdentifier(table.sourceTable)} ORDER BY id`);
    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const exists = await prisma[table.targetModel].findUnique({
        where: { id: row.id },
        select: { id: true },
      });

      if (exists) {
        skipped += 1;
        continue;
      }

      await prisma[table.targetModel].create({
        data: table.map(row),
      });

      inserted += 1;
    }

    console.log(`${table.name}: inserted=${inserted}, skipped=${skipped}`);
  }
}

async function loadTargetCounts(prisma) {
  const counts = {};

  for (const table of MIGRATION_TABLES) {
    counts[table.name] = await prisma[table.targetModel].count();
  }

  return counts;
}

async function sqliteJson(sqlitePath, sql) {
  const { stdout, stderr } = await execFileAsync("sqlite3", ["-json", sqlitePath, sql], {
    maxBuffer: 1024 * 1024 * 64,
  });

  if (stderr.trim()) {
    fail(stderr.trim());
  }

  const text = stdout.trim();
  return text ? JSON.parse(text) : [];
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return Number(value);
}

function toNullableDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return toDate(value);
}

function toDate(value) {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number") {
    return new Date(value);
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return new Date(Number(value));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    fail(`无法解析日期：${value}`);
  }

  return parsed;
}

function printCounts(title, counts) {
  console.log(title);
  for (const [name, count] of Object.entries(counts)) {
    console.log(`  ${name}: ${count}`);
  }
}

function maskDatabaseUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "<invalid DATABASE_URL>";
  }
}

function fail(message) {
  console.error(`迁移失败：${message}`);
  process.exit(1);
}
