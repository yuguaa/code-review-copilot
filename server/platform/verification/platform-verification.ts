import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

import { executeProcess } from '@server/infrastructure/process/process.service';
import { verifyPlatformRequests } from './request-verification';
import { preserveConfigurationAcrossMigration } from './migration-verification';

import type { VerificationContext } from './request-verification';

const databasePort = 55433;
const latestMigration = '20261030120000_allow_unlimited_ocr_tokens';
const require = createRequire(import.meta.url);

function assertPortAvailable(): Promise<void> {
  return new Promise((accept, reject) => {
    const listener = createServer();
    listener.once('error', () => reject(new Error(`验证端口 ${databasePort} 已被占用，未连接该端口上的数据库`)));
    listener.listen(databasePort, '127.0.0.1', () => listener.close((error) => error ? reject(error) : accept()));
  });
}

function main(): Promise<void> {
  const projectRoot = resolve(process.argv[2]);
  const directory = resolve(process.argv[3]);
  assert.equal(resolve(directory, '..'), join(projectRoot, '.verification'), '验证目录超出授权范围');
  assert.equal(process.cwd(), directory, '验证必须在独立目录运行');
  assert.equal(process.env.TMPDIR, join(directory, 'temporary'), '临时文件目录没有隔离');
  assert.equal(process.env.DATABASE_URL, undefined, '验证进程不能继承数据库地址');

  const secrets = [randomBytes(24).toString('hex'), randomBytes(24).toString('hex'), randomBytes(32).toString('hex')];
  const abort = new AbortController();
  const interrupt = () => abort.abort(new Error('用户终止验证'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let postgres: EmbeddedPostgres | undefined;
  let databaseState: 'not-started' | 'starting' | 'started' | 'failed' = 'not-started';
  let prisma: VerificationContext['prisma'] | undefined;
  let cleanupCompleted = false;
  let currentStep = '初始化';
  const checks: Array<{ name: string; status: 'passed' | 'failed'; durationMs: number }> = [];
  const databaseLogs: string[] = [];
  const limitations = [
    '真实模型审查、报告完成事务与继续对话需要用户指定模型和调用目标，本脚本没有调用模型。',
    'GitLab 的真实 Webhook 投递、远端 diff 与评论发布需要指定 GitLab 项目；本脚本仅通过应用接口提交本地 Git 提交范围。',
    '钉钉发布与 RSS 抓取发送需要指定通知目标；本脚本只验证配置持久化和凭证处理。',
    'Grafana、Collector、Tempo 和 Prometheus 的真实联通需要独立容器环境；本脚本只验证未认证访问被拒绝。',
    '活动进程的取消与重启恢复需要真实 OCR 执行；本脚本验证排队取消、重复请求和重新排队。',
    'OCR preview 只验证本地执行和 Git 范围解析，不代表已执行模型审查。',
  ];
  const redact = (value: string) => secrets.filter(Boolean).reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
  const check: VerificationContext['check'] = (name, operation) => {
    currentStep = name;
    abort.signal.throwIfAborted();
    console.log(`验证：${name}`);
    const start = Date.now();
    let timer: NodeJS.Timeout;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort(new Error('单项验证超过 60 秒'));
        reject(new Error('单项验证超过 60 秒'));
      }, 60_000);
    });
    return Promise.race([Promise.resolve().then(operation), deadline]).then((result) => {
      checks.push({ name, status: 'passed', durationMs: Date.now() - start });
      console.log(`通过：${name}`);
      return result;
    }, (error: unknown) => {
      checks.push({ name, status: 'failed', durationMs: Date.now() - start });
      throw error;
    }).finally(() => clearTimeout(timer));
  };
  const command = (name: string, executable: string, args: string[], cwd = directory) => executeProcess(executable, args, {
    cwd, env: { ...process.env }, signal: abort.signal, timeoutMs: 55_000, maxBytes: 4 * 1024 * 1024,
  }).then((result) => writeFile(join(directory, `${name}.log`), redact(result.stdout + result.stderr), { mode: 0o600 }).then(() => {
    if (result.error) throw result.error;
    assert.equal(result.code, 0, `${name} 执行失败，请查看该项验证日志`);
    return result.stdout.trim();
  }));

  /* 环境变量仅在专用子进程内部设置，所有值在本次验证中生成。 */
  const databaseUrl = `postgresql://platform_verification:${secrets[0]}@127.0.0.1:${databasePort}/platform_verification?connect_timeout=5&socket_timeout=10`;
  secrets.push(databaseUrl);
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    APP_AUTH_USERNAME: 'platform-verification',
    APP_AUTH_SECRET: secrets[1],
    APP_AUTH_SESSION_SECRET: secrets[2],
    APP_PUBLIC_URL: 'http://localhost',
    WORKSPACE_ROOT: join(directory, 'workspaces'),
    LOG_LEVEL: 'silent',
  });

  return check('验证目录与端口隔离', () => realpath(directory).then((actual) => {
    assert.equal(actual, directory);
    return assertPortAvailable();
  }))
    .then(() => check('初始化独立 PostgreSQL', () => {
      postgres = new EmbeddedPostgres({
        databaseDir: join(directory, 'database'), user: 'platform_verification', password: secrets[0],
        port: databasePort, persistent: true, createPostgresUser: false, authMethod: 'scram-sha-256',
        postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='],
        onLog: (message) => databaseLogs.push(message),
        onError: (error) => databaseLogs.push(error instanceof Error ? error.message : String(error)),
      });
      return postgres.initialise().then(() => {
        databaseState = 'starting';
        return postgres!.start().then(() => { databaseState = 'started'; }, (error: unknown) => {
          databaseState = 'failed';
          throw error ?? new Error('验证 PostgreSQL 启动失败');
        });
      }).then(() => {
        return postgres!.createDatabase('platform_verification');
      });
    }))
    .then(() => check('Prisma CLI 部署历史迁移', () => command('migrate-before', process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(directory, 'prisma')])))
    .then(() => preserveConfigurationAcrossMigration(postgres!, check, secrets, () =>
      Promise.all(['20261016160000_platform_runs', '20261019120000_dingtalk_robots', '20261019130000_add_security_testing', latestMigration].map((name) =>
        cp(join(projectRoot, 'prisma/migrations', name), join(directory, 'prisma/migrations', name), { recursive: true })))
        .then(() => command('migrate-deploy', process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(directory, 'prisma')]))))
    .then(() => import('@server/infrastructure/prisma/prisma.service'))
    .then((database) => {
      prisma = database.prisma;
      return check('迁移记录与审查历史清理', () => prisma!.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name
      `.then((migrations) => {
        assert.equal(migrations.at(-1)?.migration_name, latestMigration, '最新迁移没有成功部署');
        return Promise.all([prisma!.session.count(), prisma!.run.count(), prisma!.gitLabAccount.count(), prisma!.aIModel.count(), prisma!.rssSubscription.count(), prisma!.repository.count()]);
      }).then((counts) => assert.deepEqual(counts, [0, 0, 1, 1, 1, 2], '配置必须保留，审查历史必须清除')));
    })
    .then(() => check('重复部署迁移保持幂等', () => command('migrate-deploy-repeat', process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(directory, 'prisma/schema.prisma')]).then(() => undefined)))
    .then(() => check('建立独立 Git 提交范围', () => {
      const repoDirectory = join(directory, 'repository');
      return mkdir(repoDirectory).then(() => command('git-init', 'git', ['init', '--initial-branch=main', repoDirectory]))
        .then(() => writeFile(join(repoDirectory, 'sample.ts'), 'export const reviewLimit = 1;\n'))
        .then(() => command('git-add-base', 'git', ['add', 'sample.ts'], repoDirectory))
        .then(() => command('git-commit-base', 'git', ['-c', 'user.name=Platform Verification', '-c', 'user.email=verification@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', '创建验证输入'], repoDirectory))
        .then(() => command('git-base', 'git', ['rev-parse', 'HEAD'], repoDirectory))
        .then((baseSha) => writeFile(join(repoDirectory, 'sample.ts'), 'export const reviewLimit = 2;\n')
          .then(() => command('git-add-head', 'git', ['add', 'sample.ts'], repoDirectory))
          .then(() => command('git-commit-head', 'git', ['-c', 'user.name=Platform Verification', '-c', 'user.email=verification@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', '更新验证输入'], repoDirectory))
          .then(() => command('git-head', 'git', ['rev-parse', 'HEAD'], repoDirectory))
          .then((headSha) => ({ baseSha, headSha, repoDirectory })));
    }))
    .then((range) => check('原生 OCR 版本、帮助与 preview', () => import('@server/platform/engines/ocr-engine').then(({ ocrBinary }) => {
      const binary = ocrBinary();
      return command('ocr-version', binary, ['version'])
        .then((version) => {
          const dependency = require('@alibaba-group/open-code-review/package.json') as { version: string };
          assert.ok(version.includes(`v${dependency.version} `), 'OCR 版本与依赖声明不一致');
          return command('ocr-help', binary, ['review', '--help']);
        })
        .then((help) => {
          assert.ok(help.includes('--preview'), '当前 OCR 没有 preview 参数');
          return command('ocr-preview', binary, ['review', '--repo', range.repoDirectory, '--from', range.baseSha, '--to', range.headSha, '--preview', '--color', 'never']);
        })
        .then((preview) => assert.ok(preview.includes('sample.ts'), 'OCR preview 没有包含本地变更文件'));
    })).then(() => range))
    .then((range) => import('@server/app').then(({ createApp }) => verifyPlatformRequests({
      app: createApp(), prisma: prisma!, check, secrets, signal: abort.signal,
      username: 'platform-verification', password: secrets[1], ...range,
    })))
    .catch((error: unknown) => {
      console.error(`验证未通过：${currentStep}`);
      return writeFile(join(directory, 'failure.log'), redact(error instanceof Error ? error.message : String(error)), { mode: 0o600 })
        .then(() => { process.exitCode = 1; });
    })
    .finally(() => {
      /* 无论验证结果如何，都先释放连接，再等待数据库退出。 */
      return Promise.resolve().then(() => prisma?.$disconnect())
        .finally(() => ['starting', 'started'].includes(databaseState) ? postgres!.stop() : undefined)
        .finally(() => databaseState === 'started' ? assertPortAvailable() : undefined)
        .then(() => {
          cleanupCompleted = true;
          console.log('验证数据库资源已经释放');
        })
        .catch((error: unknown) => {
          process.exitCode = 1;
          console.error('验证数据库资源清理未完成');
          return writeFile(join(directory, 'cleanup-failure.log'), redact(error instanceof Error ? error.message : String(error)), { mode: 0o600 });
        })
        .finally(() => {
          process.removeListener('SIGINT', interrupt);
          process.removeListener('SIGTERM', interrupt);
          return Promise.all([writeFile(join(directory, 'database.log'), redact(databaseLogs.join('')), { mode: 0o600 }), writeFile(join(directory, 'report.json'), JSON.stringify({
            finishedAt: new Date().toISOString(), success: process.exitCode !== 1 && cleanupCompleted && !abort.signal.aborted,
            cleanupCompleted,
            databasePort, latestMigration, checks, limitations,
            evidence: '真实 PostgreSQL、完整 Prisma 迁移、createApp 应用请求、本地 Git 和 OCR preview。未调用外部模型、GitLab 或钉钉。',
          }, null, 2), { mode: 0o600 })]).then(() => undefined);
        });
    });
}

main().catch((error: unknown) => {
  console.error(`验证资源清理失败：${error instanceof Error ? error.name : '未知错误'}`);
  process.exitCode = 1;
});
