import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * 本地开发数据库：在 5433 端口起一个自带数据目录的 PostgreSQL。
 * 数据保存在 .dev-postgres，进程退出后数据保留，重复启动会复用已有实例。
 */
const POSTGRES_DIR = './.dev-postgres';
const DATABASE_NAME = 'code_review_copilot';

const postgres = new EmbeddedPostgres({
  databaseDir: POSTGRES_DIR,
  user: 'code_review',
  password: 'code_review',
  port: 5433,
  persistent: true,
});

/** 数据目录里出现 PG_VERSION 说明已经初始化过，再次 initdb 会直接失败。 */
async function ensureInitialised() {
  if (existsSync(`${POSTGRES_DIR}/PG_VERSION`)) return;
  await postgres.initialise();
}

async function ensureDatabase() {
  const client = postgres.getPgClient('postgres');
  await client.connect();
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DATABASE_NAME]);
  await client.end();
  if (existing.rowCount === 0) {
    await postgres.createDatabase(DATABASE_NAME);
  }
}

async function main() {
  await ensureInitialised();
  await postgres.start();
  await ensureDatabase();
  console.log(`dev postgres ready on 5433，数据库 ${DATABASE_NAME}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
