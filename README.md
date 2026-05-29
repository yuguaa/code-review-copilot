# Code Review Copilot - GitLab 智能代码审查工具

一个基于 Next.js 的私有化部署 GitLab 代码审查工具，支持 AI 自动审查代码并提交评论。

## 功能特性

### 核心功能
- **多仓库管理**: 支持连接多个 GitLab 实例和仓库
- **AI 模型集成**: 支持 OpenAI、Claude 和自定义 AI 模型
- **智能代码审查**: 自动分析 GitLab Merge Request 的 Staged Diff
- **多机器人并发审查**: 每个仓库可配置多个审查机器人，独立模型和 Prompt 并发运行
- **Code Graph Memory**: 保存项目架构摘要、代码图谱、符号节点和高置信审查事实，减少重复全量读取
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
- **UI 库**: shadcn/ui + Tailwind CSS + @relation-graph/react
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
5. 配置审查机器人：
   - 机器人名称：例如“安全审查机器人”“架构审查机器人”
   - AI 模型：选择已有 `AIModel`
   - Prompt 模式：扩展内置 Prompt 或完全替换
   - 启用状态和排序：启用的机器人会在同一次审查中并发执行

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

### RepositoryReviewBot
仓库审查机器人配置，保存机器人名称、描述、绑定模型、Prompt、启停状态和排序

### ReviewBotRun
单次审查中每个机器人的执行记录，保存状态、模型快照、Prompt 快照、摘要和错误

### ReviewComment
审查评论，存储具体的代码问题，并记录来源机器人和合并后的来源列表

### RepositoryMemorySnapshot
仓库 Code Graph 快照，保存架构摘要和索引状态

### CodeFileNode / CodeSymbolNode / CodeRelationEdge
代码调用图节点与关系边，用于跨文件上下文检索

### RepositoryMemoryFact
可持续更新的仓库记忆事实

### ReviewAgentTrace
每个机器人独立的 Agent Loop 轨迹，包括每轮工具调用、上下文和 Critic 结果

## Code Graph 架构

Code Graph 是仓库级的代码关系记忆，和单次 ReviewLog 解耦。审查前系统会先确认目标分支的图谱状态，再把可用的文件角色、调用关系和架构摘要作为 Agent Tools 上下文提供给审查机器人。

### 存储结构

- `RepositoryMemorySnapshot` 保存分支级 Code Graph 快照，包括架构摘要、索引状态、索引 HEAD 和更新模式。
- `CodeFileNode` 保存文件节点，包括文件路径、语言、角色、摘要、imports、exports 和 hash。
- `CodeSymbolNode` 保存文件内符号节点，用于后续扩展到函数、类、接口级定位。
- `CodeRelationEdge` 保存跨文件关系边，包括 from、to、relationType、confidence 和 evidence。
- `RepositoryMemoryFact` 保存高置信仓库事实，和 Code Graph 一起组成审查时的长期记忆。

### 更新策略

- 首次没有 Code Graph 时，系统基于目标远端分支 HEAD 全量建立分支级图谱。
- 普通刷新或审查前刷新时，会读取上次 `lastIndexedCommitSha`，和当前远端 source branch HEAD 做 compare，只重建发生变化的可索引文件。
- 如果远端分支 HEAD 没变化，直接复用已有快照，不重复扫描仓库。
- 如果本次变更没有可索引源码文件，也复用已有快照，只更新快照状态说明。
- 仓库详情页的“重建 Code Graph”按钮会强制全量重建，用于索引逻辑升级、图谱数据异常或需要人工刷新基线的场景。

### Agent Tools 使用方式

审查机器人不会直接假设自己知道项目结构，而是通过上下文工具读取 Code Graph：

- `get_code_graph_status` 检查图谱是否可用、索引模式和 HEAD 状态。
- `get_architecture_summary` 读取基于 Code Graph 生成的项目架构摘要。
- `get_file_context` 读取变更文件在图谱中的角色、imports、exports 和摘要。
- `get_call_graph_neighbors` 读取变更文件附近的跨文件关系。
- `rebuild_code_graph` 只作为图谱缺失时的系统准备动作。工具观测显示 Code Graph 可用后，机器人才能基于调用链下结论。

### Web 页面展示

仓库详情页会从 `/api/repositories/[id]/memory/graph` 读取数据库中的文件节点、符号节点和关系边，并使用 `@relation-graph/react` 渲染图谱。页面不手绘 SVG，也不在前端重新发明布局算法；缩放、拖拽、关系线、迷你地图和节点点击交互由开源图谱组件负责。点击节点后，页面展示该文件的角色、语言、摘要和相关关系，方便直接查看 Code Graph 数据。

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
7. 默认审查机器人

迁移规则：

- 保留旧数据的 `id`、创建时间、更新时间和外键关系。
- 目标库已存在相同 `id` 时跳过，不覆盖已有记录。
- 每个旧仓库会创建一个“默认审查机器人”，继承旧仓库级模型、Prompt 和 Prompt 模式。
- 旧仓库自定义模型会迁移为专用 `AIModel`，再绑定到默认机器人。
- 如果旧仓库没有可迁移模型配置，dry-run 和正式迁移都会快速失败。
- 旧 SQLite schema 不匹配当前可迁移结构时快速失败。
- 迁移不会自动生成 Code Graph 数据，这些数据会在后续审查或手动刷新 Code Graph 时创建。

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
- `GET /api/repositories/[id]/bots` - 获取仓库审查机器人
- `POST /api/repositories/[id]/bots` - 新增审查机器人
- `PUT /api/repositories/[id]/bots` - 更新审查机器人
- `DELETE /api/repositories/[id]/bots?id=xxx` - 删除审查机器人
- `GET /api/repositories/[id]/memory` - 获取仓库 Code Graph 元信息和高置信风险
- `GET /api/repositories/[id]/memory/graph` - 获取 Code Graph 文件节点和关系边
- `POST /api/repositories/[id]/memory/refresh` - 增量刷新 Code Graph，传 `force=true` 时强制全量重建

### 配置管理
- `GET /api/settings/gitlab` - 获取 GitLab 账号
- `POST /api/settings/gitlab` - 添加 GitLab 账号
- `GET /api/settings/models` - 获取 AI 模型
- `POST /api/settings/models` - 添加 AI 模型

### 代码审查
- `POST /api/review` - 手动触发审查
- `GET /api/review?logId=xxx` - 获取审查状态
- `POST /api/review/[id]/retry` - 清理旧评论、机器人运行和 Trace 后重试审查
- `GET /api/reviews/[id]/agent-trace` - 获取所有机器人 Agent Trace

### Webhook
- `POST /api/webhook/gitlab` - GitLab Webhook

## 审查流程

1. **触发方式**：
   - 手动触发：在界面点击"开始审查"
   - 自动触发：GitLab Webhook 检测到 MR 或 Push 事件

2. **审查步骤**：
   - 只获取一次 MR/Commit Diff
   - 刷新或复用 Code Graph
   - 使用排序第一的启用机器人生成公共变更摘要
   - 为每个启用机器人创建 `ReviewBotRun`
   - 通过 `Promise.allSettled` 并发执行机器人 Agent Loop
   - 合并重复问题，保留来源机器人和各自 confidence
   - 保存评论和 Trace，只发布一条 GitLab 总评

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
- [ ] 支持机器人模板市场

## License

MIT
