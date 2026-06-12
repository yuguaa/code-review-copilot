# Code Review Copilot 架构说明

本文档记录当前项目的实现架构。系统目标是：在私有化部署环境中，把 GitLab
MR / Push 事件转换为可追溯、可复用 sandbox、可发布到 GitLab 和钉钉的 Pi 代码审查。

## 设计目标

- 页面和业务 API 默认需要登录，外部回调入口保持可调用。
- 手动触发、Webhook 和 Retry 都进入同一个 `ReviewTriggerService`。
- 每次 review 只运行一个 Pi 进程，模型和 Prompt 来自排序第一的启用 Pi Profile。
- 不同仓库绑定不同 OpenSandbox sandbox，同仓库复用同一个 sandbox。
- 同仓库并发 review 共享 VM，但使用独立 `git worktree`、独立 Pi 进程和独立 `ReviewSandboxSession`。
- 应用不挂载 Docker socket，不直接管理宿主机容器，只调用 OpenSandbox API。
- PostgreSQL 是运行数据库，Prisma 是唯一 ORM。

## 非目标

- 不自动修改代码。
- 不生成补丁。
- 不做行内评论，当前只发布一条 GitLab 总评。
- 不在 app 容器中运行 Docker runtime。
- 不在一个 review 完成后删除仓库 sandbox。
- 不支持 Pi 自定义模型 endpoint；配置了 endpoint 时快速失败。

## 总体链路

```text
GitLab Webhook / 手动触发 / Retry
        │
        ▼
ReviewTriggerService
        │
        ▼
ReviewService.performReview
        │
        ├── fetch_diff
        ├── generate_summary
        ├── run_pi_runtime
        ├── aggregate_results
        └── publish_comment
        │
        ▼
PostgreSQL + GitLab 终态总评 + 钉钉终态通知
```

`ReviewService.performReview` 是主编排。步骤函数位于 `lib/review/steps/`，
共享状态类型位于 `lib/review/types.ts`。过程可视化统一写入 `ReviewWorkflowNode`。
触发阶段只创建 `ReviewLog` 和过程节点，不向 GitLab 发送评论。

## 认证边界

认证由 `proxy.ts` 统一拦截。公开路径只有：

- `/login`
- `/api/auth/*`
- `/api/webhook/gitlab`

登录账号不落库，由环境变量提供：

```text
APP_AUTH_USERNAME
APP_AUTH_SECRET
APP_AUTH_SESSION_SECRET
APP_AUTH_IP_WHITELIST
```

`APP_AUTH_SECRET` 用于登录校验，`APP_AUTH_SESSION_SECRET` 用 HMAC-SHA256
签名会话 Cookie。Cookie 名为 `code_review_copilot_session`，HTTP-only，
默认有效期 7 天。

配置 IP 白名单后，系统先读取 `x-forwarded-for` 的第一个 IP，再读取
`x-real-ip`。部署在反向代理后时，代理层必须覆盖这两个请求头，不能透传客户端
伪造的值。

## 审查步骤

### fetch_diff

读取 MR 或 Commit diff，只获取一次并写入审查状态。Webhook、手动审查和 Retry
共用同一条 diff 获取链路。

### generate_summary

根据本次 diff 生成确定性公共变更摘要。摘要写入 `ReviewLog.changeSummary`，
并作为 Pi 审查输入的一部分；app 进程不直接调用模型生成审查内容。

### run_pi_runtime

当前运行时只选择排序第一的启用 Profile：

1. 创建或连接 `RepositorySandboxBinding` 对应的 OpenSandbox sandbox。
2. 创建 `ReviewSandboxSession`，记录当前 review 的 worktree、Pi command 和运行状态。
3. 在 sandbox 内准备 bare repo，并 fetch 最新 refs。
4. 为本次 review 创建独立 `git worktree`。
5. 写入 `/tmp/pi-review-input.json` 和 Pi prompt 文件。
6. 在 worktree 中执行 `/opt/pi/bin/pi -p --no-context-files --no-session`。
7. 解析 Pi 严格 JSON 输出。
8. 校验 finding 是否命中本次 diff。
9. 完成后清理 worktree；若没有其他 running session，则 pause sandbox。

GitLab Token 通过 `GITLAB_PRIVATE_TOKEN` 环境变量传入 git 命令。模型 API Key
通过 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY` 传给 Pi。两类密钥都不写入 clone URL、
prompt 或 review input JSON。

### aggregate_results

汇总 Pi findings。重复问题按以下 key 去重：

```text
filePath + lineNumber + lineRangeEnd + severity + normalized content
```

写入前会校验：

- finding 必须命中本次 diff 的文件。
- 行号必须落在 diff 可评论范围。
- `confidence < 0.6` 的低置信问题会被过滤。
- 输出条数最多保留 Pi Profile 配置的 `maxFindings`。

### publish_comment

发布一条 GitLab 终态总评，并发送同口径钉钉通知。`completed`、`failed`、
`cancelled` 都通过这个出口发布，不存在触发阶段评论更新链路。

完成态评论包含：

- 审查结论。
- 变更范围。
- 问题统计。
- 全部问题清单。
- 文件风险排行。
- 技术走查。
- Pi 运行结果。

失败或停止态评论包含：

- 失败或停止原因。
- 已完成的变更范围和摘要。
- Pi Profile 运行状态。
- 后续处理建议。

## Pi + OpenSandbox Runtime

单机部署拓扑：

```text
[同一台服务器]
├── Docker daemon
│   ├── code-review-copilot-app
│   ├── code-review-copilot-postgres
│   └── OpenSandbox 创建的 review sandbox 容器
├── OpenSandbox Server
│   └── localhost:8080
├── Pi 安装目录
│   └── /opt/pi
└── 持久化目录
    ├── postgres_data
    └── OpenSandbox / Docker volumes
```

OpenSandbox Server 跑在宿主机 systemd 中，不放进本项目 `docker compose`。
app 容器通过 `host.docker.internal:8080` 调用 OpenSandbox API。Linux 下
`docker-compose.yml` 使用 `extra_hosts: host.docker.internal:host-gateway`
固定宿主机访问入口。

Pi 安装在宿主机 `/opt/pi`，创建 sandbox 时以 host volume 只读挂载到 sandbox 内
`/opt/pi`。app 不需要 Docker socket。

关键环境变量：

```text
OPEN_SANDBOX_DOMAIN
OPEN_SANDBOX_PROTOCOL
OPEN_SANDBOX_API_KEY
PI_HOST_PATH
PI_SANDBOX_MOUNT_PATH
PI_SANDBOX_IMAGE
PI_SANDBOX_TIMEOUT_SECONDS
```

## 并发模型

不同仓库：

```text
repo A -> sandbox A
repo B -> sandbox B
```

同仓库并发：

```text
repo A -> sandbox A
        ├── review 1 -> worktree 1 -> Pi process 1
        └── review 2 -> worktree 2 -> Pi process 2
```

sandbox 内仓库结构：

```text
/workspace/repos/{repositoryId}/repo.git
/workspace/repos/{repositoryId}/repo.lock
/workspace/reviews/{reviewLogId}
```

`git fetch`、`git worktree add`、`git worktree remove` 和 `git worktree prune`
通过 `flock` 串行化，避免同仓库并发 review 争用 Git lock。Pi 进程本身并发运行，
因为每个进程都有独立 worktree。

pause 策略：

- session 创建后立即标记 `running`。
- session 完成或失败后更新状态和完成时间。
- 清理 worktree 后检查同一 binding 下是否还有 running session。
- 没有 running session 时 `sandbox.pause()` 并把 binding 标记为 `paused`。

## 数据模型

```text
GitLabAccount
  └── Repository
        ├── RepositoryPiProfile
        │     └── AIModel
        ├── RepositorySandboxBinding
        │     └── ReviewSandboxSession
        ├── ReviewLog
        │     ├── PiReviewRun
        │     ├── ReviewComment
        │     ├── ReviewWorkflowNode
        │     └── ReviewSandboxSession
```

关键约束：

- `ReviewLog(repositoryId, mergeRequestIid, commitSha)` 支撑同一 commit 审查分组。
- `PiReviewRun(reviewLogId, piProfileId)` 保证一次审查中一个 Profile 只运行一次。
- `RepositorySandboxBinding(repositoryId)` 保证同仓库只有一个 sandbox 绑定。
- `RepositorySandboxBinding(sandboxId)` 保证一个 sandbox 不绑定多个仓库。
- `ReviewSandboxSession(reviewLogId)` 保证一个 review 只有一个 sandbox 会话记录。
- `ReviewWorkflowNode(reviewLogId, nodeKey)` 保证过程节点可幂等更新。

## API 和页面

### 认证

- `POST /api/auth/login`
- `POST /api/auth/logout`

### 审查入口

- `POST /api/review`
- `POST /api/webhook/gitlab`
- `POST /api/review/[id]/retry`
- `POST /api/review/[id]/stop`

三类触发入口统一进入 `ReviewTriggerService`。

### 审查详情

- `GET /api/reviews`
- `GET /api/reviews/[id]`
- `GET /api/reviews/[id]/workflow`

审查详情页展示：

- 动态过程图。
- 全部问题清单。
- 变更摘要与技术走查。
- OpenSandbox session。
- Pi Review Run。
- 原始回复、Prompt 和模型信息。

### Pi Profile

- `GET /api/repositories/[id]/pi-profiles`
- `POST /api/repositories/[id]/pi-profiles`
- `PUT /api/repositories/[id]/pi-profiles`
- `DELETE /api/repositories/[id]/pi-profiles?id=xxx`

仓库详情页支持新增、编辑、启用、禁用、排序、选择模型、配置 Prompt 和 Pi 输出限制。

## Docker 和数据库迁移

项目支持 Docker 启动 app 和 postgres：

```bash
cp .env.example .env
docker compose up --build -d
```

`docker-entrypoint.sh` 只做两件事：

```text
prisma migrate deploy
npm run start
```

SQLite 历史数据迁移必须显式执行：

```bash
npm run db:migrate:sqlite -- --source prisma/dev.db --force
```

Docker 中执行迁移时需要挂载旧 SQLite 文件：

```bash
docker compose run --rm \
  -v "$PWD/prisma/dev.db:/app/prisma/dev.db:ro" \
  app npm run db:migrate:sqlite -- --source prisma/dev.db --force
```

跨机器迁移 PostgreSQL 数据建议使用 `pg_dump` 和 `pg_restore`，不要直接拷贝 Docker volume：

```bash
pg_dump -Fc "$DATABASE_URL" > code-review-copilot.dump
pg_restore --clean --if-exists --no-owner --dbname "$TARGET_DATABASE_URL" code-review-copilot.dump
```

## 失败策略

- 认证环境变量缺失：页面和业务 API 返回未授权。
- IP 不在白名单：页面和业务 API 返回 403。
- 仓库没有启用 Profile：`ReviewLog` failed，错误为 `No active pi profiles configured`。
- OpenSandbox 连接失败：`ReviewSandboxSession` failed，binding 标记 error。
- Git clone / fetch / worktree 失败：session failed，本次 review failed。
- Pi provider 不支持：review failed。
- Pi 自定义 endpoint 未接入：review failed。
- Pi 输出非严格 JSON：review failed。
- Finding 校验后为空：review completed，发布低风险总评。
- review failed 或 cancelled 后仍发布 GitLab 和钉钉终态通知；通知失败只记录日志，不覆盖原始失败原因。
- Retry：清理旧 comments、Pi Review Runs、workflow nodes 和 sandbox session 后重新运行。

## 质量门禁

当前工程质量门禁：

```bash
npx prisma validate
npx prisma generate
npx tsc --noEmit --pretty false
npm run lint
npm run build
docker compose --env-file .env.example config
```

后续补测试时，应优先覆盖：

- 环境变量登录、会话过期、退出登录和 IP 白名单。
- OpenSandbox 配置读取和 provider 快速失败。
- 仓库 sandbox binding 创建、并发 race 和复用。
- 同仓库并发 review 的 session、worktree 和 pause 策略。
- Pi JSON 解析、finding 校验和输出限制。
- findings 去重和来源合并。
- GitLab 总评发布和钉钉通知。
- SQLite 到 PostgreSQL 历史数据迁移。
