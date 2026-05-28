# Code Review Copilot - GitLab 智能代码审查工具

一个基于 Next.js 的私有化部署 GitLab 代码审查工具，支持 AI 自动审查代码并提交评论。

## 功能特性

### 核心功能
- **多仓库管理**: 支持连接多个 GitLab 实例和仓库
- **AI 模型集成**: 支持 OpenAI、Claude 和自定义 AI 模型
- **智能代码审查**: 自动分析 GitLab Merge Request 的 Staged Diff
- **三级问题分类**: 严重 / 一般 / 建议
- **分支配置**: 为不同分支配置不同的审查策略
- **审查历史**: 完整的审查日志和历史记录
- **Webhook 集成**: 自动监听 GitLab MR 事件并触发审查
- **统计仪表盘**: 仓库维度和用户维度的审查统计

### UI 特性
- 基于 **shadcn/ui** 的现代化界面
- 完全响应式设计
- 暗色模式支持

## 技术栈

- **框架**: Next.js 16 (App Router)
- **数据库**: PostgreSQL + Prisma ORM
- **UI 库**: shadcn/ui + Tailwind CSS
- **AI SDK**: Vercel AI SDK (@ai-sdk/openai, @ai-sdk/anthropic)
- **HTTP 客户端**: Axios

## 快速开始

### 1. Docker 一键启动

```bash
cp .env.example .env
docker compose up --build -d
```

访问 http://localhost:3000

应用容器启动时会自动执行 `prisma migrate deploy`，然后启动 Next.js。

### 2. SQLite 历史数据迁移

```bash
# 只启动 PostgreSQL
docker compose up -d postgres
```

如果你是从旧版 SQLite 升级，需要先迁移历史数据：

```bash
# 本机已安装 npm 依赖时，可直接在宿主机校验和迁移
npm run db:migrate:sqlite -- --dry-run
npm run db:migrate:sqlite -- --source prisma/dev.db --force

# 或者使用 Docker 容器执行迁移，并挂载旧 SQLite 文件
docker compose run --rm \
  -v "$PWD/prisma/dev.db:/app/prisma/dev.db:ro" \
  app npm run db:migrate:sqlite -- --source prisma/dev.db --force
```

### 3. 本地开发

```bash
npm install
docker compose up -d postgres
npm run db:deploy
npm run dev
```

访问 http://localhost:3000

## 使用指南

### 第一步：配置 GitLab 账号

1. 进入"配置"页面
2. 点击"添加账号"
3. 填写 GitLab 信息：
   - 名称：例如"GitLab.com"或"公司内部 GitLab"
   - URL：GitLab 实例地址（如 https://gitlab.com）
   - Access Token：个人访问令牌（需要 api 权限）

### 第二步：配置 AI 模型

1. 在"配置"页面切换到"AI 模型"标签
2. 点击"添加模型"
3. 填写模型信息：
   - 名称：例如"GPT-4"或"Claude 3.5"
   - 提供商：OpenAI / Claude / 自定义
   - 模型 ID：如 gpt-4, claude-3-5-sonnet
   - API 密钥：对应的 API 密钥

### 第三步：添加仓库

1. 进入"仓库列表"页面
2. 选择 GitLab 账号
3. 从列表中选择要添加的仓库
4. 配置分支审查规则：
   - 分支模式：如 "main", "develop", "feature/*"
   - AI 模型：选择要使用的模型
   - 系统 Prompt：自定义审查指令

### 第四步：配置 Webhook（可选）

#### 生产环境

如需自动审查，在 GitLab 仓库中配置 Webhook：

- URL: `http://your-server/api/webhook/gitlab`
- 触发事件: Merge Request events + Push events
- Secret: （如果配置了）

#### 本地开发配置

本地开发时 GitLab 无法直接访问 `localhost`，需要使用内网穿透工具：

**方案 1：使用 ngrok（推荐）**

```bash
# 安装 ngrok
brew install ngrok  # macOS
# 或访问 https://ngrok.com 下载

# 启动隧道
ngrok http 3000
```

启动后会得到一个公网地址，如 `https://abc123.ngrok.io`

**GitLab Webhook 配置：**
- URL: `https://abc123.ngrok.io/api/webhook/gitlab`
- 触发事件: Merge Request events + Push events

**方案 2：使用 Cloudflare Tunnel**

```bash
# 安装 cloudflared
brew install cloudflared  # macOS

# 启动隧道
cloudflared tunnel --url http://localhost:3000
```

**方案 3：使用 localtunnel**

```bash
npx localtunnel --port 3000
```

**方案 4：自建 GitLab 允许本地地址**

如果是自建 GitLab，可以配置允许本地网络地址：

GitLab Omnibus 配置 (`/etc/gitlab/gitlab.rb`)：

```ruby
gitlab_rails['webhook_timeout'] = 10
gitlab_rails['outbound_local_requests_whitelist'] = ['localhost', '127.0.0.1', 'host.docker.internal']
```

重启 GitLab 后，Webhook URL 可以是：
- `http://localhost:3000/api/webhook/gitlab`
- `http://host.docker.internal:3000/api/webhook/gitlab`（GitLab 在 Docker 中）

### 第五步：查看审查结果

- **仪表盘**: 查看整体统计和趋势
- **审查历史**: 查看每次审查的详细结果
- **GitLab MR**: AI 评论会自动发布到 MR

## 数据库模型

### GitLabAccount
GitLab 账号配置

### AIModel
AI 模型配置（OpenAI/Claude/自定义）

### Repository
仓库配置，关联 GitLab 账号

### ReviewLog
审查日志，记录每次审查的统计信息

### ReviewComment
审查评论，存储具体的代码问题

### RepositoryMemorySnapshot
仓库 Memory Wiki 快照，保存架构摘要和索引状态

### CodeFileNode / CodeSymbolNode / CodeRelationEdge
代码调用图节点与关系边，用于跨文件上下文检索

### RepositoryMemoryFact
可持续更新的仓库记忆事实

### ReviewAgentTrace
Agent Loop 的每轮工具调用、上下文和 Critic 轨迹

## 环境变量

创建 `.env` 文件：

```env
DATABASE_URL="postgresql://code_review:code_review@localhost:5432/code_review_copilot?schema=public"
DINGTALK_WEBHOOK_URL="https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN"
# 可选：开启加签时填写（钉钉机器人安全设置中的加签密钥）
DINGTALK_SECRET="YOUR_DINGTALK_SECRET"
```

## SQLite 历史数据迁移

从 SQLite 切换到 PostgreSQL 时，历史配置和审查记录不能丢。

迁移脚本默认读取 `prisma/dev.db`，并按依赖顺序写入 PostgreSQL：

1. GitLab 账号
2. AI 模型
3. 仓库配置
4. 审查日志
5. 审查评论
6. 通知配置

迁移规则：

- 保留旧数据的 `id`、创建时间、更新时间和外键关系。
- 目标库已存在相同 `id` 时跳过，不覆盖已有记录。
- 旧 SQLite schema 不匹配当前可迁移结构时快速失败。
- 迁移不会自动生成 Memory Wiki 或 Code Graph 数据，这些数据会在后续审查或手动刷新 Memory 时创建。

常用命令：

```bash
# 校验默认源库 prisma/dev.db
npm run db:migrate:sqlite -- --dry-run

# 指定其他 SQLite 文件校验
npm run db:migrate:sqlite -- --source ./backup/dev.db --dry-run

# 写入 PostgreSQL
npm run db:migrate:sqlite -- --source prisma/dev.db --force
```

## 目录结构

```
├── app/
│   ├── api/              # API 路由
│   │   ├── repositories/ # 仓库管理
│   │   ├── review/       # 代码审查
│   │   ├── settings/     # 配置管理
│   │   └── webhook/      # Webhook 处理
│   ├── layout.tsx        # 根布局
│   ├── page.tsx          # 仪表盘
│   ├── settings/         # 配置页面
│   └── repositories/     # 仓库页面
├── components/
│   ├── ui/               # shadcn/ui 组件
│   └── app-sidebar.tsx   # 侧边栏
├── lib/
│   ├── prisma.ts         # Prisma Client
│   ├── types.ts          # TypeScript 类型
│   ├── prompts.ts        # AI Prompt 模板
│   └── services/         # 业务逻辑服务
│       ├── gitlab.ts     # GitLab API
│       ├── ai.ts         # AI 模型服务
│       └── review.ts     # 审查服务
└── prisma/
    └── schema.prisma     # 数据库模型
```

## API 端点

### 仓库管理
- `GET /api/repositories` - 获取所有仓库
- `POST /api/repositories` - 添加仓库
- `PUT /api/repositories` - 更新仓库
- `DELETE /api/repositories` - 删除仓库

### 配置管理
- `GET /api/settings/gitlab` - 获取 GitLab 账号
- `POST /api/settings/gitlab` - 添加 GitLab 账号
- `GET /api/settings/models` - 获取 AI 模型
- `POST /api/settings/models` - 添加 AI 模型

### 代码审查
- `POST /api/review` - 手动触发审查
- `GET /api/review?logId=xxx` - 获取审查状态

### Webhook
- `POST /api/webhook/gitlab` - GitLab Webhook

## 审查流程

1. **触发方式**：
   - 手动触发：在界面点击"开始审查"
   - 自动触发：GitLab Webhook 检测到 MR 事件

2. **审查步骤**：
   - 获取 MR 最新提交的 Staged Diff
   - 调用 AI 模型进行代码分析
   - 生成问题评论（按严重级别分类）
   - 保存到数据库
   - 自动发布到 GitLab MR

3. **问题级别**：
   - **严重**: 安全漏洞、重大 bug、性能问题
   - **一般**: 代码质量问题、小 bug
   - **建议**: 最佳实践、优化建议

## 开发计划

- [ ] 完善仓库列表页面
- [ ] 添加审查历史查看界面
- [ ] 创建帮助中心页面
- [ ] 支持更多 GitLab 事件
- [ ] 添加审查报告导出功能
- [ ] 支持自定义 Prompt 模板

## License

MIT
