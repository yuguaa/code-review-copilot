import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function verifyReport(reportPath: string): Promise<void> {
  return realpath(reportPath).then((actual) => {
    if (!actual.startsWith(`${join(projectRoot, '.verification')}/`)) throw new Error('报告必须位于项目验证目录');
    return readFile(actual, 'utf8');
  }).then((text) => {
    const report = JSON.parse(text) as { success?: boolean; cleanupCompleted?: boolean; checks?: Array<{ status: string }> };
    if (report.success !== true || report.cleanupCompleted !== true || !report.checks?.length
      || report.checks.some((check) => check.status !== 'passed')) throw new Error('验证报告未通过');
  });
}

function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('运行：node --import tsx scripts/verify-platform.ts');
    console.log('使用 .verification 中的全新 PostgreSQL，端口 55433；各项验证最长 60 秒。');
    console.log('只验证本地应用、配置保存与 OCR preview；不调用外部模型或通知。');
    console.log('检查既有报告：node --import tsx scripts/verify-platform.ts --report .verification/platform-目录/report.json');
    return Promise.resolve();
  }
  if (process.argv[2] === '--report' && process.argv.length === 4) return verifyReport(resolve(process.argv[3]));
  if (process.argv.length > 2) return Promise.reject(new Error('验证脚本不接受数据库地址或其他运行参数'));
  const directory = join(projectRoot, '.verification');
  return mkdir(directory, { recursive: true, mode: 0o700 })
    .then(() => realpath(directory))
    .then((actual) => {
      if (actual !== directory) throw new Error('验证目录必须位于当前项目，不能使用符号链接');
      return mkdtemp(join(directory, 'platform-'));
    })
    .then((runDirectory) => Promise.all(['temporary', 'home', 'cache', 'prisma'].map((name) =>
      mkdir(join(runDirectory, name), { mode: 0o700 }))).then(() => runDirectory))
    .then((runDirectory) => Promise.all([
      cp(join(projectRoot, 'prisma/schema.prisma'), join(runDirectory, 'prisma/schema.prisma')),
      cp(join(projectRoot, 'prisma/migrations'), join(runDirectory, 'prisma/migrations'), {
        recursive: true, filter: (source) => ![
          '20261016160000_platform_runs',
          '20261019120000_dingtalk_robots',
          '20261019130000_add_security_testing',
          '20261030120000_allow_unlimited_ocr_tokens',
          '20261030150000_default_ocr_token_budget',
          '20261030160000_set_ocr_token_budget_two_million',
          '20261030170000_add_dingtalk_cli_connections',
          '20261030190000_global_dingtalk_cli',
        ].some((name) => source.endsWith(`/${name}`)),
      }),
      writeFile(join(runDirectory, 'package.json'), '{"private":true,"type":"module"}\n', { mode: 0o600 }),
    ]).then(() => runDirectory))
    .then((runDirectory) => new Promise<void>((accept, reject) => {
      /* 验证进程只接收必要环境，项目凭证和已有数据库地址不会传入。 */
      const child = spawn(process.execPath, [
        '--import', 'tsx', join(projectRoot, 'server/platform/verification/platform-verification.ts'),
        projectRoot, runDirectory,
      ], {
        cwd: runDirectory,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          LANG: 'C.UTF-8',
          LC_ALL: 'C',
          NODE_ENV: 'test',
          HOME: join(runDirectory, 'home'),
          USERPROFILE: join(runDirectory, 'home'),
          TMPDIR: join(runDirectory, 'temporary'),
          TMP: join(runDirectory, 'temporary'),
          TEMP: join(runDirectory, 'temporary'),
          XDG_CACHE_HOME: join(runDirectory, 'cache'),
          XDG_CONFIG_HOME: join(runDirectory, 'home', '.config'),
          TSX_TSCONFIG_PATH: join(projectRoot, 'tsconfig.json'),
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: join(runDirectory, 'home', '.gitconfig'),
          GIT_TERMINAL_PROMPT: '0',
          OCR_NO_UPDATE: '1',
          OCR_ENABLE_TELEMETRY: '0',
          OCR_CONTENT_LOGGING: '0',
          OTEL_SDK_DISABLED: 'true',
          CHECKPOINT_DISABLE: '1',
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
        },
        stdio: 'inherit', shell: false,
      });
      const interrupt = () => { child.kill('SIGINT'); };
      const terminate = () => { child.kill('SIGTERM'); };
      process.once('SIGINT', interrupt);
      process.once('SIGTERM', terminate);
      const cleanup = () => {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', terminate);
      };
      child.once('error', (error) => { cleanup(); reject(error); });
      child.once('close', (code, signal) => {
        cleanup();
        console.log(`验证记录：${join(runDirectory, 'report.json')}`);
        verifyReport(join(runDirectory, 'report.json')).then(() => {
          if (code !== 0 || signal) throw new Error(`验证进程未完成，退出状态 ${code ?? signal}`);
        }).then(accept, reject);
      });
    }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '验证启动失败');
  process.exitCode = 1;
});
