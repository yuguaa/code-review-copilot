# 代码审查 Agent（Code Review Agent）

一个**会话式**的 GitLab 代码审查 Agent：每个 webhook 触发的审查都是一个**可追问的会话**，由真正的 agent loop 驱动（真 tool calls + 多 subagent），用 [Vercel AI SDK](https://sdk.vercel.ai) v7 原生能力从零构建。

> 不是「单次调用大模型」——agent 会自己 `list_changed_files → fetch_diff → read_file`，按需委派安全/架构/性能 subagent，最后把结论回写 MR；你还能在会话里继续追问。

## 技术栈

- **后端**：[Hono](https://hono.dev)（web 标准 Request/Response，AI SDK 的 `toUIMessageStreamResponse()` 直接 return）
- **前端**：Vite + React + `@ai-sdk/react` 的 `useChat`
- **Agent**：`ai` v7（`streamText` + `stopWhen` + `ToolLoopAgent` subagent 委派）
- **数据**：Prisma + PostgreSQL（4 张表）
- **鉴权**：HMAC 签名 Cookie + 可选 IP 白名单，全局守卫所有 `/api/*`

## 工程结构

```
server/            # Hono 后端
  index.ts         # app 装配 + 全局鉴权 + 生产托管前端
  routes/          # auth / sessions / repositories / settings / chat / webhook
  agent/           # model · tools · subagents · review-agent · run-review
  lib/             # gitlab · auth · prompts · prisma · chat-store · branch-match
web/               # Vite + React SPA（Chat / Settings / Repositories / Login）
shared/            # 前后端共享类型
prisma/schema.prisma
```

## 本地开发

```bash
# 1. 起一个 Postgres（或用 docker compose up -d postgres）
# 2. 配置 .env（见 .env.example）
cp .env.example .env

npm install
npm run db:migrate          # 建表
npm run dev                 # 同时起 Hono(:8787) 与 Vite(:5173)
```

打开 `http://localhost:5173`，用 `.env` 里的 `APP_AUTH_USERNAME/SECRET` 登录。

## 配置流程

1. **设置 → 添加 GitLab 账号**：实例地址 + 访问令牌（api 权限）+ Webhook 密钥。
2. **仓库配置 → 添加仓库**：选账号 → 拉取并选项目 → 配模型（provider/modelId/apiKey）→ 监听分支 / 默认审查提示词 / 自动审查。
3. 在 GitLab 项目里加 Webhook（**Merge Request events**），URL 指向 `<部署地址>/api/webhook/gitlab`，Secret Token 与账号的 Webhook 密钥一致。

之后每次 MR 打开/更新都会自动生成一个审查会话，agent 审查并回写 MR，你可在左侧会话里继续追问。

## 核心数据模型

- `GitLabAccount` —— 接入凭证
- `Repository` —— 仓库 + 按仓库的模型/提示词配置
- `Session` —— 一次会话（`kind=review|chat`，审查会话带 MR 元信息）
- `Message` —— 线性 `UIMessage` 持久化

## 测试与门禁

```bash
npm run typecheck   # tsc 服务端 + 前端
npm test            # vitest（工具执行 / provider 解析 / 分支匹配）
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
