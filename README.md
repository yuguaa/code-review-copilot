# Review Copilot

代码审查管理平台，集中管理仓库、模型、GitLab、钉钉和 RSS。OCR 执行代码审查，平台保存每次运行的报告、提交范围、会话消息和渠道发布结果。

## 使用方式

- 活动：按时间查看审查运行，筛选仓库、触发来源和状态。
- 运行详情：阅读 Markdown 报告，查看固定的提交范围、执行状态和发布结果。
- 追问：基于报告所在消息分支继续提问，只读工具读取对应提交的代码。
- 普通仓库对话：首次提问固定仓库默认分支的提交，后续提问使用相同版本。
- 仓库：配置监听分支、模型、审查背景、OCR 并发、超时、Token 预算和通知渠道。
- 模型：管理 OpenAI、Anthropic 和 OpenAI-compatible 端点，提供连通性检查。
- 连接器：管理 GitLab 凭证和钉钉机器人。配置读取接口仅返回凭证是否已配置。
- RSS：按间隔抓取，发送成功后登记条目，保留未发送内容。
- 遥测：使用同一个项目账号访问 Grafana，查看运行指标与完整 trace。

前端使用 React、TypeScript、Vite、shadcn 和 NeUI Base UI 组件。内网 NeUI registry 配置在 `components.json`，可通过 shadcn MCP 检索组件。后端使用 Hono、Prisma 和 PostgreSQL。

## 本地开发

需要 Node.js 24、Git 2.41 或更新版本，以及 ripgrep。

```bash
npm ci
cp .env.example .env
npm run dev:db
```

在 `.env` 中填写登录账号、密码和会话密钥。开发数据库数据保存在 `.dev-postgres`。另开终端执行：

```bash
npm run db:deploy
APP_PUBLIC_URL=http://localhost:5173 npm run dev
```

浏览器访问 `http://localhost:5173`。Hono 在端口 8787 提供 API，Vite 代理 `/api` 和 `/observability`。

## 审查执行

GitLab Webhook 地址为 `/api/webhook/gitlab`，接收 Merge Request 和 Push 事件。GitLab 账号的 `webhookSecret` 用于验证 `X-Gitlab-Token`；GitLab 项目 Hook 的 Secret Token 必须与该值一致。

每个 MR 运行保存触发提交对应的 `baseSha`、`startSha` 和 `headSha`。Push 保存 before/after。工作区在该提交创建独立 worktree。非祖先关系的 Push 明确失败，报告不使用其他提交范围。

OCR 固定使用 `@alibaba-group/open-code-review@1.9.10` 的原生可执行文件。调用参数包括 `--format json`、`--audience agent`、确定的提交范围、并发数、任务超时和 Token 预算。平台从 stdout 读取 JSON，独立处理进程退出状态。

OCR 原生规则由仓库中的 `.opencodereview/rule.json` 管理。平台审查背景通过 `--background-file` 传入。OCR 会话与运行期上下文保存在每个仓库独立的 `ocr-home`；平台不维护另一套规则、Skills 或长期记忆。

PostgreSQL 保存排队任务，单实例执行器最多并行处理两个运行。取消时终止进程组并等待退出，再释放运行资格。服务重新启动后，在途任务保存为 `interrupted`，排队任务继续等待领取。

运行状态包括 `queued`、`running`、`cancelling`、`completed`、`partial`、`skipped`、`failed`、`cancelled` 和 `interrupted`。部分完成的报告保留实际覆盖警告。

完整报告保存成功后，平台按仓库配置执行自动发布。GitLab 和钉钉各自保存发送状态；网络中断且无法确认远端结果时记录 `unknown`，由用户确认远端状态后再次发起。GitLab 发布校验当前 MR 版本，并使用内容标记识别已有评论。

## 钉钉机器人

在连接器的钉钉页面管理多个机器人，每个机器人分别设置名称、Webhook、Secret 和启用状态。已保存的凭证不会通过接口返回，编辑时留空保留原值；Secret 可以明确清除。

每个仓库和每个 RSS 订阅分别选择一个机器人。启用仓库通知或 RSS 订阅时必须选择已启用的机器人。机器人停用后停止接收新通知，引用它的配置需要选择可用机器人或关闭发送。仍被仓库或 RSS 订阅引用的机器人不能删除。

迁移 `20261019120000_dingtalk_robots` 保留已有公共机器人及仓库独立机器人的凭证，建立仓库与 RSS 订阅的机器人关联。

`WORKSPACE_TTL_HOURS` 控制已完成运行的工作区保留时间，默认 72 小时。清理流程检查工作区最近使用时间。OCR 原生会话目录和数据库报告独立保存。

## Docker 与遥测

在 `.env` 中填写 `POSTGRES_PASSWORD`、三个 `APP_AUTH_*` 字段、`APP_PORT` 和实际的 `APP_PUBLIC_URL`。数据库密码使用 URL 安全字符。

```bash
docker compose up -d --build --wait
```

Compose 部署应用、PostgreSQL、Collector、Tempo、Prometheus 和 Grafana。仅应用端口对外开放。Grafana 通过应用的 `/observability/` 认证代理访问；每次请求验证数据库会话，退出登录或更改凭证后已有会话失效。

平台向 OCR 传递 W3C `TRACEPARENT`，运行记录保存 trace ID。Collector 通过 OTLP/gRPC 接收平台与 OCR 的 trace 和指标；指标仅保留有限取值的属性。Tempo 保留 14 天 trace，Prometheus 保留 30 天指标。源码、模型凭证和完整请求正文不由平台遥测导出。

## 配置与数据迁移

迁移 `20261016160000_platform_runs` 保留 GitLab、模型、仓库、钉钉和 RSS 配置，清除历史审查会话、消息及运行数据。平台规则、Skills 和记忆结构由 OCR 原生功能接替。独立验证脚本会在迁移前插入配置，迁移后逐项比较内容、凭证和关联。

`deploy/deploy-remote.sh` 用于目标 `ssh liuchang` 的首次平台部署。它在新部署目录构建镜像，保存配置备份和指纹，停止旧应用与旧 PostgreSQL，再使用已有数据库卷启动平台。配置指纹在部署后再次检查。

```bash
ssh liuchang sh /home/newcap/code-review-copilot-platform/deploy/deploy-remote.sh \
  /home/newcap/code-review-copilot-platform http://192.168.0.81:3000
```

部署目录中的 `.env` 和 `.deployment` 属于运行数据，不提交到 Git。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run verify:platform
npm run verify:components
```

`verify:platform` 使用 `.verification` 中的独立 PostgreSQL，在端口 55433 验证迁移、认证、配置保存、Webhook 幂等、运行取消和原生 OCR preview。它不会连接现有开发或部署数据库，也不会发送外部通知。每项验证上限为 60 秒，报告保存为对应运行目录中的 `report.json`。

`verify:components` 通过真实 shadcn MCP 连接读取项目 registry 和 NeUI Timeline 信息。`deploy/verify-telemetry.ts` 使用真实 Collector 检查 OTLP、W3C 上下文、运行指标及属性过滤。
