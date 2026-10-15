# 代码审查 Agent（Code Review Agent）

一个**会话式**的 GitLab 代码审查 Agent：每个 webhook 触发的审查都是一个**可追问的会话**，由真正的 agent loop 驱动（真 tool calls + 多 subagent），用 [Vercel AI SDK](https://sdk.vercel.ai) v7 原生能力从零构建。

> 不是「单次调用大模型」——agent 会自己 `list_changed_files → fetch_diff → read_file`，按需委派安全/架构/性能 subagent，最后把结论回写 MR；你还能在会话里继续追问。

## 使用的技术

- **后端**：[Hono](https://hono.dev)（web 标准 Request/Response，AI SDK 的 `toUIMessageStreamResponse()` 直接 return）
- **前端**：Vite + React 19 + [shadcn/ui](https://ui.shadcn.com)（`base-nova` 风格）+ [ReUI](https://reui.io) + [ai-elements](https://elements.ai-sdk.dev)
- **Agent**：`ai` v7（`streamText` + `stopWhen` + subagent 委派）
- **数据**：Prisma + PostgreSQL
- **鉴权**：HMAC 签名 Cookie + 可选 IP 白名单，全局守卫所有 `/api/*`

## 工程结构

```
server/                     # Hono 后端
  index.ts                  # 装配：全局鉴权 + 静态托管 + 启动 RSS 调度
  modules/
    auth sessions repositories settings chat webhook dashboard
    rss/                     # RSS 订阅：抓取、去重、钉钉推送、调度器
  shared/                    # gitlab · dingtalk · logger
web/                         # Vite + React SPA
  components/
    ui/                      # shadcn 组件
    reui/                    # ReUI 组件
    ai-elements/             # 对话界面组件
    layout/                  # 应用外壳：可拖拽侧栏 + 顶栏
    chat/ settings/ dashboard/ repositories/ rss/
  pages/                     # Chat · Dashboard · Repositories · Settings · Rss · Help · Login
  hooks/ lib/
shared/                      # 前后端共享类型与解析逻辑
prisma/schema.prisma
```

## 本地开发

```bash
# 1. 起一个本地 PostgreSQL（自带数据目录，监听 5433）
npm run dev:db

# 2. 配置 .env（见 .env.example）
cp .env.example .env

npm install
npm run db:deploy          # 应用迁移
npm run dev                # 同时起 Hono(:8787) 与 Vite(:5173)
```

打开 `http://localhost:5173`，用 `.env` 里的 `APP_AUTH_USERNAME/SECRET` 登录。也可以直接用 `docker compose up -d postgres` 代替第一步。

## 配置流程

1. **设置 → 添加 GitLab 账号**：实例地址 + 访问令牌（api 权限）+ Webhook 密钥。
2. **设置 → Tools / Skills 管理**：调整平台默认工具与审查方法。
3. **仓库配置 → 添加仓库**：选账号 → 拉取并选项目 → 配模型（provider/modelId/apiKey）→ 监听分支 / 默认审查提示词 / 自动审查 / 仓库级 Tools 和 Skills 覆盖。
4. 在 GitLab 项目里加 Webhook（**Merge Request events** 与 **Push events**），URL 指向 `<部署地址>/api/webhook/gitlab`，Secret Token 与账号的 Webhook 密钥一致。
5. **数据看板**：查看 14 天趋势、状态分布、仓库热度、人员维度、失败样本和最近活动。

之后每次 MR 打开/更新都会自动生成一个审查会话，agent 审查并回写 MR，你可在左侧会话里继续追问。

## RSS 订阅推送

「RSS 订阅」页维护订阅源：名称、Feed 地址、抓取间隔（5 到 1440 分钟）与启用开关。

- 调度器每分钟检查一次到期订阅，抓取到的**新条目**推送到**全局钉钉机器人**，与代码审查通知共用同一个机器人。
- RSS 使用独立消息模板：标题为 `RSS 更新 · 订阅名 · 条目标题`，正文包含订阅名、发布时间、摘要与原文链接。
- 首次抓取只建立基线，不会把历史条目全部推送；单次抓取最多推送 5 条，避免长时间停用后一次性刷屏。
- 推送记录按 Feed 条目标识去重，同一条内容只推送一次；抓取失败会记录在订阅卡片上。

## 核心数据模型

- `GitLabAccount` —— 接入凭证
- `Repository` —— 仓库 + 按仓库的模型/提示词/通知配置
- `AgentTool` / `AgentSkill` —— 平台级工具与 skill 注册表
- `RepositoryToolSetting` / `RepositorySkillSetting` —— 仓库级能力覆盖
- `Session` —— 一次会话（`kind=review|chat`，审查会话带 MR 元信息）
- `Message` —— message tree 持久化（`parts` 为 `UIMessage.parts`）
- `NotificationSetting` —— 全局钉钉配置
- `RssSubscription` / `RssPushedItem` —— RSS 订阅源与已推送条目

## 测试与门禁

```bash
npm run typecheck   # tsc 服务端 + 前端
npm test            # vitest
npm run build       # prisma generate + vite build
```

## Docker 部署

单镜像单容器（Hono 同进程托管前端静态产物 + `/api`）：

```bash
cp .env.example .env   # 至少填好 APP_AUTH_*
docker compose up -d --build
# 访问 http://localhost:8787
```

容器启动时自动执行 `prisma migrate deploy`。
