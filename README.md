# Code Review Copilot

私有化部署的 GitLab 代码审查工具。应用监听 GitLab MR / Push 事件，
为每次审查拉起独立 Pi 进程，并通过 OpenSandbox 把仓库运行时隔离在宿主机
Docker sandbox 中。

## 功能特性

### 核心功能

- **私有工作台登录**：由环境变量初始化唯一登录账号，页面和业务 API 默认需要登录。
- **GitLab 集成**：支持多个 GitLab 实例、多个仓库、MR 事件和 Push 事件。
- **Pi 审查运行时**：排序第一的启用 Pi Profile 提供模型、Prompt 和输出限制，Pi 在 sandbox 内执行审查。
- **OpenSandbox 隔离**：应用不挂载 Docker socket，只通过 OpenSandbox API 创建、恢复、暂停 review sandbox。
- **仓库 VM 复用**：不同仓库绑定不同 sandbox；同仓库复用同一 sandbox，并发 review 使用不同 worktree 和 Pi 进程。
- **三级问题分类**：严重 / 一般 / 建议。
- **审查历史**：保存 ReviewLog、PiReviewRun、ReviewComment、Workflow 和 sandbox session。
- **终态通知**：审查完成、失败或停止后，发布一条 GitLab 总评并发送钉钉通知。
- **健康检查与监控**：提供 `/api/health`、`/api/metrics`，可叠加 Prometheus + Grafana 监控栈。

### UI 特性

- 基于 shadcn/ui、Tailwind CSS 和 React Flow。
- 独立登录页，登录成功后进入带侧边栏的工作台。
- 审查详情页展示过程图、问题清单、Pi Runtime 会话、OpenSandbox 状态和原始材料。

## 技术栈

- **框架**：Next.js 16 App Router
- **数据库**：PostgreSQL + Prisma ORM
- **运行时隔离**：OpenSandbox Server + Docker runtime
- **审查智能体**：Pi
- **模型连通性测试**：OpenAI SDK + Anthropic HTTP API
- **UI**：shadcn/ui + Tailwind CSS

## 快速开始

### 1. 启动应用和数据库

```bash
cp .env.example .env
docker compose up --build -d
```

启动前至少替换登录配置：

```env
APP_AUTH_USERNAME="admin"
APP_AUTH_SECRET="replace-with-login-secret"
APP_AUTH_SESSION_SECRET="replace-with-long-random-session-secret"
```

访问 http://localhost:3000。

应用容器启动时会执行 `prisma migrate deploy`，然后启动 Next.js。

### 1.1 启动监控栈

可选叠加 Prometheus、Grafana、cAdvisor、node_exporter 和 postgres_exporter：

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

访问：

- App：http://localhost:3000
- Grafana：http://localhost:3001

Prometheus、cAdvisor、node_exporter 和 postgres_exporter 不发布宿主机端口，
只在 Docker 内网中供 Prometheus 采集，避免内网端口扫描时出现无记名访问入口。

Grafana 账号密码来自环境变量：

```env
GRAFANA_ADMIN_USER="admin"
GRAFANA_ADMIN_PASSWORD="change-me-grafana-password"
```

### 2. 单机部署 OpenSandbox + Pi

推荐在同一台服务器上部署：

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

基础依赖：

- Docker / Docker Compose
- Python 3.10+
- Node.js，用于安装 Pi
- `uv` 或 `pipx`，用于运行 OpenSandbox Server
- `opensandbox-cli`，用于执行 `osb` 验证命令

初始化并启动 OpenSandbox Server：

```bash
sudo mkdir -p /etc/opensandbox
uvx opensandbox-server init-config /etc/opensandbox/sandbox.toml --example docker
uvx opensandbox-server --config /etc/opensandbox/sandbox.toml
```

确认可用后交给 systemd：

```bash
sudo cp deploy/systemd/opensandbox-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now opensandbox-server
sudo systemctl status opensandbox-server
```

安装 `osb`：

```bash
pipx install opensandbox-cli
```

安装 Pi：

```bash
sudo mkdir -p /opt/pi
sudo npm install -g --prefix /opt/pi --ignore-scripts @earendil-works/pi-coding-agent
/opt/pi/bin/pi --version
```

在 `.env` 中补充运行时配置：

```env
OPEN_SANDBOX_DOMAIN="host.docker.internal:8080"
OPEN_SANDBOX_PROTOCOL="http"
OPEN_SANDBOX_API_KEY=""

PI_HOST_PATH="/opt/pi"
PI_SANDBOX_MOUNT_PATH="/opt/pi"
PI_SANDBOX_IMAGE="node:24-bookworm"
PI_SANDBOX_TIMEOUT_SECONDS="7200"
```

验证 OpenSandbox：

```bash
osb config set connection.domain localhost:8080
osb sandbox create --image node:24-bookworm --timeout 10m -o json
docker compose exec app sh -lc 'wget -qO- http://host.docker.internal:8080/health || true'
```

创建 review sandbox 时，应用会把宿主机 `/opt/pi` 只读挂载到 sandbox 内
`/opt/pi`。可在 sandbox 内验证：

```bash
/opt/pi/bin/pi --version
```

### 3. 本地开发

```bash
npm install
docker compose up -d postgres
npm run db:deploy
npm run dev
```

访问 http://localhost:3000。

## 运行时策略

- 不同仓库对应不同 OpenSandbox sandbox。
- 同仓库复用同一个 sandbox。
- 同仓库并发 review 共享 VM，但每次 review 使用独立 `git worktree` 和独立 Pi 进程。
- VM 内用 bare repo 保存仓库；fetch、worktree add/remove 通过仓库级 `flock` 串行化。
- 每次 review 创建 `ReviewSandboxSession`，记录独立 worktree 和 Pi command，完成后清理 worktree。
- sandbox 空闲后执行 `pause`，不 `kill`，以保留仓库绑定和降低下一次启动成本。
- GitLab Token 和模型 API Key 只通过命令环境变量传入 sandbox，不写入 clone URL、prompt 或 review input JSON。
- Pi 输出必须是严格 JSON；provider 不支持、自定义 endpoint 未接入或 JSON 不合法时快速失败。

## 使用指南

### 1. 登录工作台

使用 `.env` 中的 `APP_AUTH_USERNAME` 和 `APP_AUTH_SECRET` 登录。
登录会话由 HTTP-only Cookie 保存，有效期 7 天。

### 2. 配置 GitLab 账号

进入“配置”页面，添加 GitLab URL 和 Access Token。Token 需要 `api` 权限。

### 3. 配置模型凭据

进入“配置”页面的“Pi Runtime 模型凭据”区域，添加 OpenAI 或 Claude 模型。
当前 Pi runtime 支持 `openai` 和 `claude` provider；自定义 endpoint 会快速失败。

### 4. 添加仓库和 Pi Profile

1. 进入“仓库列表”页面。
2. 选择 GitLab 账号和仓库。
3. 配置分支监听规则。
4. 新增 Pi Profile：
   - Profile 名称
   - 模型凭据
   - Prompt 模式：扩展内置 Prompt 或替换内置 Prompt
   - 启用状态和排序
   - Pi 输出条数限制

排序第一的启用 Profile 会被用于本次 Pi 审查。其他 Profile 可以保留给后续排序切换，
但当前一次 review 只运行一个 Pi。

### 5. 配置 Webhook

GitLab Webhook：

- URL：`http://your-server/api/webhook/gitlab`
- 触发事件：Merge Request events + Push events
- Secret：按需配置

本地开发可使用 ngrok、Cloudflare Tunnel 或 localtunnel 暴露 `localhost:3000`。

### 6. 查看审查结果

- **仪表盘**：查看整体统计和趋势。
- **审查历史**：查看每次审查的详情。
- **过程图**：查看 fetch diff、summary、Pi review、aggregate、publish 等步骤。
- **Pi Runtime**：查看 OpenSandbox sandbox、worktree、会话状态和错误。
- **GitLab**：审查完成、失败或停止后，总评会发布到 MR 或 Commit。

## 数据库模型

- `GitLabAccount`：GitLab 账号配置。
- `AIModel`：供 Pi Profile 引用的模型凭据。
- `Repository`：仓库配置，关联 GitLab 账号。
- `RepositoryPiProfile`：Pi Profile 配置，保存模型、Prompt、启停状态、排序和输出限制。
- `RepositorySandboxBinding`：仓库到 OpenSandbox sandbox 的唯一绑定。
- `ReviewSandboxSession`：单次 review 在 sandbox 内的 worktree、Pi command 和状态。
- `ReviewLog`：审查日志，记录每次审查的统计信息。
- `PiReviewRun`：单次审查中的 Pi 运行快照。
- `ReviewComment`：审查评论和来源信息。
- `ReviewWorkflowNode`：动态审查过程图节点。

## 环境变量

```env
DATABASE_URL="postgresql://code_review:code_review@localhost:5432/code_review_copilot?schema=public"

APP_AUTH_USERNAME="admin"
APP_AUTH_SECRET="change-me-login-secret"
APP_AUTH_SESSION_SECRET="change-me-session-signing-secret"
APP_AUTH_IP_WHITELIST="127.0.0.1,::1"

OPEN_SANDBOX_DOMAIN="host.docker.internal:8080"
OPEN_SANDBOX_PROTOCOL="http"
OPEN_SANDBOX_API_KEY=""

PI_HOST_PATH="/opt/pi"
PI_SANDBOX_MOUNT_PATH="/opt/pi"
PI_SANDBOX_IMAGE="node:24-bookworm"
PI_SANDBOX_TIMEOUT_SECONDS="7200"

DINGTALK_WEBHOOK_URL="https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN"
DINGTALK_SECRET="YOUR_DINGTALK_SECRET"
```

`/api/webhook/gitlab` 是外部回调入口，不要求登录 Cookie。`/api/health` 和
`/api/metrics` 是监控入口，不要求登录 Cookie，也不走页面 IP 白名单。
`/api/health`、`/api/health?scope=liveness` 和 `/api/metrics` 都需要
`Authorization: Bearer <APP_AUTH_SECRET>` 或 `?token=<APP_AUTH_SECRET>`。
Docker healthcheck 和 Prometheus 会自动使用同一个 `APP_AUTH_SECRET`。

## SQLite 历史数据迁移

```bash
docker compose up -d postgres
npm run db:migrate:sqlite -- --dry-run
npm run db:migrate:sqlite -- --source prisma/dev.db --force
```

迁移规则：

- 保留旧数据的 `id`、创建时间、更新时间和外键关系。
- 目标库已存在相同 `id` 时跳过。
- 每个旧仓库会创建一个默认 Pi Profile。
- 旧仓库自定义模型会迁移为专用 `AIModel`。
- 旧 SQLite schema 不匹配当前可迁移结构时快速失败。
- 升级到当前版本会删除旧 Code Graph / Memory 表；生产库升级前先保留 PostgreSQL
  `pg_dump` 备份。

## API 端点

### 认证

- `POST /api/auth/login`
- `POST /api/auth/logout`

### 仓库管理

- `GET /api/repositories`
- `POST /api/repositories`
- `PUT /api/repositories`
- `DELETE /api/repositories`
- `GET /api/repositories/[id]/pi-profiles`
- `POST /api/repositories/[id]/pi-profiles`
- `PUT /api/repositories/[id]/pi-profiles`
- `DELETE /api/repositories/[id]/pi-profiles?id=xxx`

### 配置管理

- `GET /api/settings/gitlab`
- `POST /api/settings/gitlab`
- `GET /api/settings/models`
- `POST /api/settings/models`

### 代码审查

- `POST /api/review`
- `GET /api/review?logId=xxx`
- `POST /api/review/[id]/retry`
- `POST /api/review/[id]/stop`
- `GET /api/reviews`
- `GET /api/reviews/[id]`
- `GET /api/reviews/[id]/workflow`

### Webhook

- `POST /api/webhook/gitlab`

### 监控

- `GET /api/health`
- `GET /api/health?scope=liveness`
- `GET /api/metrics`

## 审查流程

1. 手动触发、Webhook 或 Retry 进入 `ReviewTriggerService`，创建 `ReviewLog` 后直接启动审查。
2. `ReviewService.performReview` 串行执行 review steps，触发阶段不向 GitLab 发送评论。
3. `fetch_diff` 获取 MR / Commit diff。
4. `generate_summary` 根据 diff 生成确定性公共变更摘要。
5. `run_pi_runtime` 选择排序第一的启用 Profile，连接仓库 sandbox，创建 worktree，运行 Pi。
6. `aggregate_results` 校验 finding 是否命中本次 diff，并写入评论。
7. `publish_comment` 是唯一终态通知出口，`completed` / `failed` / `cancelled` 都会发布 GitLab 总评并发送钉钉通知。
8. sandbox 内 worktree 清理完成后，如果没有 running session，暂停仓库 VM。

## 质量门禁

```bash
npx prisma validate
npx prisma generate
npx tsc --noEmit --pretty false
npm run lint
npm run build
docker compose --env-file .env.example config
```

## License

MIT
