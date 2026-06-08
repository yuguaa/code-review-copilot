# Code Review Copilot 架构说明

本文档记录当前项目的实现架构，作为后续开发和审查策略调整的工程基准。系统目标是把 GitLab 代码审查从一次性 diff 审查，升级为带长期记忆、代码图谱和主 Agent + 条件辅助 Agent 的审查系统。

## 设计目标

- 应用作为私有工作台部署，除登录接口和外部回调入口外，页面和业务 API 都要先经过登录校验。
- 一个仓库可以配置多个审查机器人，每个机器人有独立模型、Prompt、启停状态、排序和审查预算。
- 一次触发只创建一个 `ReviewLog`，排序第一的启用机器人作为主 Agent 执行审查，其余启用机器人作为可被条件调用的辅助 Agent。
- 审查结果要可追溯到机器人、模型、Prompt 快照、Memory Snapshot、检索上下文、Finding 校验报告和 Agent Loop 轨迹。
- Memory Wiki 保存项目架构摘要、代码图谱和高置信事实，减少每次审查重复读取全仓库的成本。
- PostgreSQL 是运行数据库，Prisma 是唯一 ORM。
- Docker 可以直接启动完整应用，容器入口只自动执行 PostgreSQL migration，不自动导入历史 SQLite 数据。

## 非目标

- 第一版不自动修改代码，不生成补丁，不执行自动修复。
- Agent Loop 只使用只读工具，不允许写代码仓库。
- 审查评论第一版合并成一条 GitLab 总评，不做行内评论。
- Memory 刷新失败时审查快速失败，不降级成裸 diff 审查。
- 辅助 Agent 不默认执行，只有主 Agent 明确请求或主 Agent 发现的问题达到复核阈值时才会运行。

## 总体链路

```text
GitLab Webhook / 手动触发 / Retry
        │
        ▼
ReviewTriggerService
        │
        ▼
ReviewService
        │
        ▼
Review Steps
        │
        ├── fetch_diff
        ├── refresh_memory
        ├── generate_summary
        ├── run_review_bots
        ├── aggregate_results
        └── publish_comment
        │
        ▼
PostgreSQL + GitLab 评论
```

`ReviewTriggerService` 是统一入口。手动触发、Webhook 和 Retry 都走这里，避免重复创建审查日志和重复实现触发逻辑。

审查主链路直接写在 `ReviewService.performReview` 中，通过 `if/else` 根据状态进入下一步；步骤函数位于 `lib/review/steps/`，共享类型位于 `lib/review/types.ts`。运行时不依赖任何图编排库或额外编排层，Agent Loop 内部使用 `while (true)` 加预算条件控制。

## 认证边界

认证由 `proxy.ts` 统一拦截，页面和业务 API 默认都需要登录。公开路径只保留三类：

- `/login`
- `/api/auth/*`
- 外部回调入口：`/api/webhook/gitlab` 和 `/api/code-graph/refresh-scheduled`

登录账号不落库，由环境变量提供：

```text
APP_AUTH_USERNAME
APP_AUTH_SECRET
APP_AUTH_SESSION_SECRET
APP_AUTH_IP_WHITELIST
```

`APP_AUTH_SECRET` 用于登录校验，`APP_AUTH_SESSION_SECRET` 用 HMAC-SHA256 签名会话 Cookie。Cookie 名为 `code_review_copilot_session`，HTTP-only，默认有效期 7 天。

IP 白名单为空时不启用限制。配置后，系统先读取 `x-forwarded-for` 的第一个 IP，再读取 `x-real-ip`。部署在反向代理后时，代理层必须覆盖这两个请求头，不能透传客户端伪造的值。

根布局通过 `AppShell` 分流：`/login` 直接渲染登录页，其余页面进入带侧边栏的工作台。侧边栏提供退出登录，调用 `/api/auth/logout` 清理 Cookie 后回到登录页。

## 审查步骤

### fetch_diff

读取 MR 或 Commit diff，只获取一次并写入审查状态。Webhook、手动审查和 Retry 共用同一条 diff 获取链路。

### refresh_memory

审查前为当前审查提交刷新 Code Graph。命中相同 `repositoryId + sourceBranch + commitSha` 的 ready snapshot 时复用；否则基于当前 diff 和仓库信息生成新的 Snapshot、Code File Node、Symbol Node 和 Relation Edge。

刷新失败时，`ReviewLog` 标记为 failed。这里不做裸 diff 降级，因为裸 diff 审查会改变用户对 Agent 审查能力的预期，也会让结果不可追溯。

### generate_summary

使用排序第一的启用机器人生成公共变更摘要。这个摘要会被主 Agent 审查链路复用，避免重复总结同一份 diff。

### run_review_bots

加载当前仓库所有启用机器人，排序第一的机器人作为主 Agent 执行 Agent Loop，其余机器人作为辅助 Agent 暴露给主 Agent。

辅助 Agent 只有在主 Agent 明确请求且存在可调用辅助 Agent，或主 Agent 已发现严重/可处理问题达到复核阈值时才会创建 `ReviewBotRun` 并运行。主 Agent 失败时本次审查失败；辅助 Agent 失败只记录自己的失败状态，不阻塞主 Agent 的结果汇总。

如果当前主 Agent 没有可调用辅助 Agent，Plan Prompt 会明确写入“可调用辅助 Agent：无”，并禁止请求 `run_additional_review_agents`。服务端仍会做二次保护：模型误请求该工具时不创建空的辅助运行，只把本轮工具状态记录为 `unavailable`，然后继续走当前主 Agent 的审查链路。

### aggregate_results

汇总主 Agent 和已运行辅助 Agent 的 findings。重复问题按以下 key 去重：

```text
filePath + lineNumber + lineRangeEnd + severity + normalized content
```

去重前会校验 finding 必须命中本次 diff 的文件和行号，并过滤 `confidence < 0.6` 的低置信问题。Agent Loop 内部会保存 Finding 校验报告，记录 `low_confidence`、`file_not_in_diff`、`invalid_line_range` 三类丢弃原因。辅助 Agent 产出的 finding 会保留自己的 `reviewBotRunId`、来源机器人、模型和 `sourceBots` 列表，不会在主 Agent 汇总阶段被覆盖。长期 Memory 写回仍使用高置信阈值，避免污染项目记忆。

### publish_comment

发布一条 GitLab 总评。评论中标注来源机器人，例如：

```text
来源：安全审查机器人 / anthropic/claude-sonnet-4.5 confidence=0.78
```

## 多机器人模型

```text
Repository
  └── RepositoryReviewBot[]
        ├── name
        ├── aiModelId
        ├── prompt / promptMode
        ├── isActive / sortOrder
        └── Agent Loop budget

ReviewLog
  └── ReviewBotRun[]
        ├── status
        ├── model snapshot
        ├── prompt snapshot
        ├── summary / error
        └── ReviewAgentTrace
```

机器人只引用 `AIModel`，不重复保存 API Key。运行时会把模型、Prompt 和 Prompt 模式写入 `ReviewBotRun` 快照，保证历史审查可追溯。

每个机器人有独立审查预算：

- `maxIterations`：Agent Loop 最大轮次，默认 5，运行时限制 1 到 10。
- `maxContextFiles`：单次上下文检索最多文件数，默认 12，运行时限制 1 到 200。
- `maxCallGraphDepth`：调用图上下游检索深度，默认 2，运行时限制 0 到 4。
- `maxFindings`：单机器人最多 findings，默认 50，运行时限制 1 到 200。

最终合并 findings 的上限按已启用机器人预算求和，并有全局硬上限 500；未被调用的辅助 Agent 不会产生结果。

## Agent Loop

每个机器人独立运行一个有界 Agent Loop。

```text
while (true)
  observe
  plan_next
  tool_call
  review
  critic

  if budget exhausted
    break

  if critic says stop
    break

  if no new context requested
    break
```

每轮包含五个步骤：

1. `observe` 读取 diff、已有 findings、预算和 Memory 摘要。
2. `plan_next` 判断还缺什么上下文，决定是否继续检索。
3. `tool_call` 只读检索 Memory、Code Graph、文件上下文和历史审查。
4. `review` 基于新增上下文输出结构化 findings。
5. `critic` 去重、判断是否继续，并提取可写回 Memory 的高置信事实。

每轮停止原因会归一成 `stopReason` 写入 `ReviewAgentTrace.loopIterationsJson`：

- `continue`：本轮继续扩展上下文。
- `max_iterations`：达到 `maxIterations`。
- `max_findings`：达到 `maxFindings`。
- `critic_stop`：Critic 判定不需要继续。
- `no_new_findings`：本轮没有新增问题。
- `no_more_context`：计划没有更多上下文或没有新的目标文件。
- `no_requested_tools`：计划没有请求工具。
- `no_progress`：连续两次进展指纹相同。

进展指纹由已请求文件、请求工具、计划上下文文件和已接受 finding 组成。这个保险丝用来阻止 Agent 在相同上下文、相同工具和相同发现上反复循环。

每轮还会写入两类可观测指标：

- `review.rawFindings / acceptedFindings / rejectedFindings / rejectionCounts`：说明模型原始输出和校验过滤结果。
- `contextMetrics`：记录请求文件数、选中文件数、文件上下文命中数、调用关系数、历史审查数和缺失文件列表。

Agent Loop 的工具权限第一版只读：

- `get_memory_snapshot`
- `search_memory_facts`
- `get_changed_files`
- `get_file_context`
- `get_call_graph_neighbors`
- `get_related_review_history`
- `get_architecture_summary`
- `run_additional_review_agents`

不允许修改代码、生成补丁、执行写操作或自动修复。

`run_additional_review_agents` 只会运行当前主 Agent 之外、尚未执行过的启用机器人。没有候选机器人时快速跳过并记录 `unavailable`，不进入空辅助 Agent 流程。

## 大仓库如何处理

`maxContextFiles` 不是仓库索引文件数，也不是说大仓库只能看 12 个文件。系统分成两层：

```text
仓库长期层：Memory Wiki + Code Graph
        │
        ├── 存项目架构
        ├── 存文件摘要
        ├── 存符号和调用边
        └── 存高置信事实

单次审查层：Agent Loop 检索预算
        │
        ├── 从 diff 出发
        ├── 查相关文件
        ├── 沿调用图上下游扩展
        └── 把有限上下文交给模型
```

大仓库不应该在每次审查时把所有文件塞进模型上下文。正确做法是先把仓库结构沉淀到 Memory Wiki 和 Code Graph，再在审查时按预算精准检索。普通机器人保持轻量预算，安全或架构类机器人可以调高 `maxContextFiles` 和 `maxCallGraphDepth`。

## Memory Wiki

Memory Wiki 是仓库级长期记忆，核心数据包括：

- `RepositoryMemorySnapshot`：某个分支和 commit 的架构快照。
- `CodeFileNode`：文件节点，保存文件路径、语言、角色、摘要、imports 和 exports。
- `CodeSymbolNode`：符号节点，保存函数、组件、API route 等结构。
- `CodeRelationEdge`：文件或符号之间的关系边。
- `RepositoryMemoryFact`：可持续更新的高置信事实。

Memory Snapshot 以 `repositoryId + branch + commitSha` 唯一定位。审查时优先复用 ready snapshot，避免重复索引。

Memory Fact 只允许高置信写回，当前阈值是 `confidence >= 0.85`。写回只追加或跳过重复事实，不覆盖旧事实。每条事实必须带 evidence、来源 reviewLogId 和最后验证 commit。

## Code Graph

Code Graph 第一版重点支持 TypeScript 和 TSX，主要识别：

- import / export
- 函数和组件
- API route
- 审查步骤
- service、page、component、data model 等文件角色

上下文检索从变更文件对应的 `CodeFileNode` 出发，按 `maxCallGraphDepth` 逐跳查找上下游关系。`maxCallGraphDepth = 0` 时不查调用图，只返回 Memory、文件摘要和历史审查。

## 数据模型

核心实体关系如下：

```text
GitLabAccount
  └── Repository
        ├── RepositoryReviewBot
        │     └── AIModel
        ├── ReviewLog
        │     ├── ReviewBotRun
        │     │     ├── ReviewComment
        │     │     └── ReviewAgentTrace
        │     └── ReviewComment
        ├── RepositoryMemorySnapshot
        ├── CodeFileNode
        │     └── CodeSymbolNode
        ├── CodeRelationEdge
        └── RepositoryMemoryFact
```

关键约束：

- `ReviewLog(repositoryId, mergeRequestIid, commitSha)` 保证同一 commit 审查幂等。
- `ReviewBotRun(reviewLogId, reviewBotId)` 保证一次审查中一个机器人只运行一次。
- `RepositoryMemorySnapshot(repositoryId, branch, commitSha)` 保证快照可复用。
- `CodeFileNode(repositoryId, branch, commitSha, filePath)` 保证文件节点唯一。
- `RepositoryMemoryFact(repositoryId, branch, type, content)` 防止重复写入同一事实。

## API 和页面

### 认证

- `POST /api/auth/login`
- `POST /api/auth/logout`

登录接口校验环境变量账号和密钥，成功后写入 HTTP-only 会话 Cookie。退出登录接口清理 Cookie，不访问数据库。

### 审查入口

- `POST /api/review`
- `POST /api/webhook/gitlab`
- `POST /api/review/[id]/retry`

三类入口统一进入 `ReviewTriggerService`。

### Memory Wiki

- `POST /api/repositories/[id]/memory/refresh`
- `GET /api/repositories/[id]/memory`
- `GET /api/repositories/[id]/memory/graph`

仓库详情页展示当前分支、commit、刷新时间、架构摘要和高置信事实。

### 审查机器人

- `GET /api/repositories/[id]/bots`
- `POST /api/repositories/[id]/bots`
- `PUT /api/repositories/[id]/bots`
- `DELETE /api/repositories/[id]/bots?id=xxx`

仓库详情页支持新增、编辑、启用、禁用、排序、选择模型、配置 Prompt 和配置 Agent Loop 预算。

### Agent Trace

- `GET /api/reviews/[id]/agent-trace`

审查详情页可以查看每个机器人的 loop 轮次、工具调用、检索上下文、Finding 校验、Critic 停止原因、最终 findings 和 Memory 写回。页面会把每轮 Trace 可视化成五个阶段：计划、上下文、工具、Finding、Critic。

## Docker 和数据库迁移

项目支持 Docker 直接启动完整应用：

```bash
cp .env.example .env
docker compose up --build -d
```

`docker-entrypoint.sh` 只做两件事：

```text
prisma migrate deploy
npm run start
```

这里不使用 PM2。Docker 自身负责进程生命周期和重启策略，`docker-compose.yml` 中的 app 和 postgres 都配置了 `restart: unless-stopped`。

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

- 认证环境变量缺失：页面和业务 API 返回未授权，登录接口返回环境变量缺失。
- IP 不在白名单：页面和业务 API 返回 403。
- Memory 刷新失败：`ReviewLog` failed，不发布评论。
- 仓库没有启用机器人：`ReviewLog` failed，错误为 `No active review bots configured`。
- 单个机器人失败：对应 `ReviewBotRun` failed，不阻塞其他机器人。
- 所有机器人失败：`ReviewLog` failed，不发布空评论。
- AI JSON 解析失败：当前机器人失败，错误写入 `ReviewBotRun.error`。
- 主 Agent 请求辅助 Agent 但没有候选机器人：工具调用记为 `unavailable`，主 Agent 继续审查，不创建空的辅助运行。
- Agent Loop 重复无进展：停止原因记为 `no_progress`，本轮 Trace 保留重复次数。
- Retry：清理旧 comments、bot runs、agent traces，再按当前启用机器人重新运行。

## 质量门禁

当前工程质量门禁：

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
```

项目暂时没有 `npm test` 脚本。后续补测试时，应优先覆盖：

- 环境变量登录、会话过期、退出登录和 IP 白名单。
- Memory Snapshot 命中和刷新。
- Code Graph TS / TSX 解析。
- Agent Loop 预算停止、无新增问题停止、重复无进展停止。
- 主 Agent 条件调用辅助 Agent、无候选辅助 Agent 快速跳过，以及辅助 Agent 失败隔离。
- Finding 校验报告和 Trace 可视化字段。
- findings 去重和来源合并。
- Memory Fact 高置信写回和重复跳过。
- SQLite 到 PostgreSQL 历史数据迁移。
