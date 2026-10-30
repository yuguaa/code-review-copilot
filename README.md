# Review Copilot

代码审查管理平台，集中管理仓库、模型、GitLab、钉钉和 RSS。OCR 执行代码审查，平台保存每次运行的报告、提交范围、会话消息和渠道发布结果。

## 使用方式

- 活动：按时间查看审查运行，筛选仓库、触发来源和状态。
- 运行详情：阅读 Markdown 报告，查看固定的提交范围、执行状态和发布结果。
- 继续对话：基于选中的运行继续提问，只读工具读取对应提交的代码；失败运行也可以查询错误、报告和执行信息。
- 普通仓库对话：首次提问固定仓库默认分支的提交，后续提问使用相同版本。
- 仓库：配置监听分支、模型、审查背景、OCR 并发、超时、Token 预算和通知渠道。
- 模型：管理 OpenAI、Anthropic 和 OpenAI-compatible 端点，提供连通性检查。
- 连接器：管理 GitLab 凭证和钉钉机器人。配置读取接口仅返回凭证是否已配置。
- RSS：按间隔抓取，发送成功后登记条目，保留未发送内容。
- 安全测试：登记授权目标、范围、测试身份和计划，工单进入 Pi Agent Runtime 后调用 agent-browser 和 HTTP 工具，保存流量、截图、漏洞与报告。
- 遥测：使用同一个项目账号访问 Grafana，查看运行指标与完整 trace。

前端使用 React、TypeScript、Vite、shadcn 和 NeUI Base UI 组件。内网 NeUI registry 配置在 `components.json`，可通过 shadcn MCP 检索组件。后端使用 Hono、Prisma 和 PostgreSQL。

## Agent 与服务边界

通用 Agent 统一使用 Pi；OCR 保留为专用代码审查引擎，发布、通知、RSS 和数据同步仍是确定性的普通 Service。

- `server/platform/agent` 集中管理 Pi 的模型注册、内存会话、工具白名单、取消和超时；继续问答和安全测试共用这一入口。
- 继续问答从数据库当前分支恢复文本历史，每轮创建内存 Pi 会话。模型循环和工具执行由 Pi 负责；AI SDK 只用于 `useChat` 消息格式和流式传输。
- 问答开放固定提交范围内的 `read_file`、`search`、`git_diff` 和 `review_run_context`。没有提交范围的失败运行仍可读取诊断信息，不会改读其他版本的代码。
- 共享钉钉身份、查人和待确认消息草稿作为 Pi 自定义工具调用，复用平台 Service；审查问题通知使用受限的 Pi 通知 Agent。新增能力同样通过显式工具接入，不向模型开放任意 Shell 或 CLI。
- Pi 的文字、推理和工具开始/结束事件按顺序展示在继续对话中，并随回答持久化。取消、超时或步骤上限保留已生成内容和已完成工具结果。
- 不自动加载宿主机的项目指令、扩展和凭据文件；安全测试仅加载配置允许的 Skills，原有授权范围和证据门禁不变。

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

安全测试执行器单独运行：

```bash
npm run dev:security-worker
```

## 审查执行

GitLab Webhook 地址为 `/api/webhook/gitlab`，接收 Merge Request 和 Push 事件。生产环境保存仓库配置时会使用 GitLab 账号的 Access Token 自动创建或更新项目 Hook；Access Token 必须具备管理项目 Hook 的权限。账号的 `webhookSecret` 用于验证 `X-Gitlab-Token`，项目 Hook 的 Secret Token 必须与该值一致。

每个 MR 运行保存触发提交对应的 `baseSha`、`startSha` 和 `headSha`。Push 保存 before/after。工作区在该提交创建独立 worktree。非祖先关系的 Push 明确失败，报告不使用其他提交范围。

OCR 固定使用 `@alibaba-group/open-code-review@1.9.10` 的原生可执行文件。调用参数包括 `--format json`、`--audience human`、确定的提交范围、并发数、任务超时和 Token 预算；stderr 的进度通过平台 SSE 展示，平台从 stdout 读取最终 JSON。

新仓库的 OCR Token 预算默认为 `2,000,000`；设置为 `0` 时不限制总 Token 用量。

OpenAI-compatible 的 DeepSeek 模型默认关闭 thinking 请求字段，以兼容不支持 thinking 与 tool_choice 同时使用的网关；如需覆盖该行为，可在部署环境设置 `OCR_DISABLE_THINKING=1` 或 `OCR_DISABLE_THINKING=0`。

这类运行使用独立 HOME 下完整的 OCR 原生模型配置，避免不完整的 `llm.extra_body` 被 OCR 忽略或并发任务串用模型。密钥通过固定命令从运行环境读取，不写入配置文件；仅将会话目录链接至仓库原有的持久化目录，保留历史会话和共享配置原文。

OCR 原生规则由仓库中的 `.opencodereview/rule.json` 管理。平台审查背景通过 `--background-file` 传入。OCR 会话与运行期上下文保存在每个仓库独立的 `ocr-home`；平台不维护另一套规则、Skills 或长期记忆。

PostgreSQL 保存排队任务，单实例执行器最多并行处理两个运行。取消时终止进程组并等待退出，再释放运行资格。服务重新启动后，在途任务保存为 `interrupted`，排队任务继续等待领取。

运行状态包括 `queued`、`running`、`cancelling`、`completed`、`partial`、`skipped`、`failed`、`cancelled` 和 `interrupted`。部分完成的报告保留实际覆盖警告。

完整报告保存成功后，平台按仓库配置执行自动发布。GitLab 和钉钉各自保存发送状态；网络中断且无法确认远端结果时记录 `unknown`，由用户确认远端状态后再次发起。GitLab 发布校验当前 MR 版本，并使用内容标记识别已有评论。

## 钉钉连接

在连接器的钉钉页面配置 Webhook 或 DWS CLI。已有机器人自动保留为 Webhook 连接，不改变凭证、启用状态和仓库/RSS/安全目标关联。Webhook 编辑时凭证留空保留原值，Secret 可明确清除。

DWS CLI 是平台唯一的共享登录连接，所有仓库自动使用，不需要逐仓库绑定。CLI 固定为 `1.0.66`，在独立 Debian/glibc 容器中执行；网页不能指定可执行文件、任意命令或凭据目录。Worker 不开放宿主机端口、不访问应用数据库，只接受带内部密钥的登录管理、授权检查、人员搜索和消息发送请求。

在 `.env` 设置至少 32 位随机 `DINGTALK_WORKER_TOKEN`，然后启动可选服务：

```bash
docker compose --profile dingtalk up -d --build dingtalk-worker
```

在连接器的钉钉页面点击“扫码登录并授权”。Worker 运行原生 `dws auth login --device --no-browser --recommend --yes --format=json`，页面显示官方授权链接和本地生成的二维码，扫码后等待 CLI 完成登录与权限授权。组织和用户身份从 CLI 实际返回中获取，不提供手填 Profile、Robot Code 或群 ID 的入口。企业需要允许 CLI 数据访问；用户仍须在钉钉官方页面确认权限。

认证状态保存在专用 `dingtalk_auth` 卷，不复制个人电脑登录态，不通过平台 API 返回 Token。更换登录身份时停用旧身份的收件人缓存，消息草稿和最终发送都会重新核对 Profile。数据库约束确保平台最多只有一条 CLI 连接；历史环境存在多条 CLI 时，迁移会明确失败，必须先由管理员核对，不能静默删除配置。

发起扫码时暂停全局 CLI 通知，仅在对应登录与授权完整成功后启用一次；取消、失败或手动关闭后保持停用。迟到的登录与身份查询响应不能覆盖后来的关闭操作或新身份。

OCR 审查结果存在问题时，平台独立触发 Pi 通知 Agent，不依赖仓库的 Webhook 开关。Pi 按已保存的 GitLab 用户名查询对应工号，只在工号明确匹配且候选唯一时调用 CLI，以登录用户身份私聊提交人。没有问题时跳过。缺少用户名、工号不匹配、多个候选或授权不足时停止并记录原因，不根据姓名、GitLab User ID 或模型猜测收件人。通知正文由平台固定生成，Agent 不能改变收件人或消息内容。

通知发送资格、Pi 工具步骤和投递回执保存在 Run 的 `dingtalk-cli` 发布记录，在发布结果中查看。发送使用固定幂等键和 `--wait-delivery`，只认可明确投递回执；失败或重启后结果未知时不自动重发。正文以纯文本通过 stdin 传递，不解析报告中的本地文件或图片指令。

继续问答也可让 Pi 搜索收件人并准备私聊草稿，或点击回答下的“发到钉钉”。页面不再提供人员名单管理 Tab；通讯录查询结果只作为按登录身份隔离的收件人缓存。交互式发送仍须用户确认收件人和正文，使用共享 CLI 登录用户身份，单次私聊一人。此版本不监听钉钉入站消息。

Webhook 群通知保持独立配置：仓库、RSS 订阅和安全目标可选择已启用的 Webhook 机器人，不能将全局 CLI 作为单独仓库的机器人关联。停用 Webhook 不会停用全局 CLI；全局 CLI 有自己的启用开关。

迁移 `20261019120000_dingtalk_robots` 保留已有公共机器人及仓库独立机器人的凭证，建立仓库与 RSS 订阅的机器人关联。

`WORKSPACE_TTL_HOURS` 控制已完成运行的工作区保留时间，默认 72 小时。清理流程检查工作区最近使用时间。OCR 原生会话目录和数据库报告独立保存。

## 安全测试

安全测试菜单包含工单和测试目标。每个目标必须登记授权人、授权依据、授权截止时间和完整域名范围，子域名需要分别登记。测试身份的用户名可以读取，密码使用 AES-256-GCM 加密保存，接口只返回是否已经配置。

手动工单和自动计划工单都只创建 PostgreSQL 排队记录。`security-worker` 单实例领取工单，使用 `@earendil-works/pi-coding-agent` 加载 `SECURITY_SKILLS` 指定的 Skill 目录，只开放四个自定义工具：HTTP 请求、浏览器、记录发现、完成报告。浏览器通过 `agent-browser` 执行，域名范围由 Runtime 校验，并同时启用 `--allowed-domains` 和静态 action policy。

每次执行保存 `SecurityExecution`、工具事件、HTTP 与浏览器网络流量、结构化发现、截图和 Markdown/HTML 报告。浏览器网络事件会按授权域名筛选、对敏感请求头做遮蔽并写入 `SecurityTraffic`。证据文件写入 `security_artifacts` Docker 持久卷；PostgreSQL 保存索引、SHA-256 和文件元数据。工单失败、取消和进程中断都保留执行记录与部分报告。

完成门禁要求至少保存一条成功的 HTTP 或浏览器网络请求和一张页面截图。优先调用 `security_finish` 保存最终摘要；没有调用时，Runtime 根据已经保存的流量、结构化发现和证据生成报告，并写入 `agent.protocol-warning` 事件。完全没有执行任何工具的工单直接失败。

`security-skills/hack` 是基于 `yaklang/hack-skills` 的精简授权 Web/API 入口，固定上游提交，只保留授权检查、范围控制、影响优先、证据和报告流程。新增 Skill 时把目录放入 `security-skills/`，再通过逗号分隔的 `SECURITY_SKILLS` 启用；`SECURITY_SKILL_VERSION` 会记录到工单。安装第三方 Skill 前需要通过静态审查和 Skill 安全扫描。

## Docker 与遥测

在 `.env` 中填写 `POSTGRES_PASSWORD`、三个 `APP_AUTH_*` 字段、`APP_PORT` 和实际的 `APP_PUBLIC_URL`。数据库密码使用 URL 安全字符。

```bash
docker compose up -d --build --wait
```

Compose 部署应用、安全测试执行器、PostgreSQL、Collector、Tempo、Prometheus 和 Grafana。仅应用端口对外开放。Grafana 通过应用的 `/observability/` 认证代理访问；每次请求验证数据库会话，退出登录或更改凭证后已有会话失效。

平台向 OCR 传递 W3C `TRACEPARENT`，运行记录保存 trace ID。Collector 通过 OTLP/gRPC 接收平台与 OCR 的 trace 和指标；指标仅保留有限取值的属性。Tempo 保留 14 天 trace，Prometheus 保留 30 天指标。源码、模型凭证和完整请求正文不由平台遥测导出。

运行详情展示 OCR 汇总的输入、输出、总 Token 和缓存读取 Token；Grafana 看板提供按模型统计的 Token 消耗与趋势，并通过 PostgreSQL 数据源按 Run 展示单次任务的完整 Token 明细。

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
npm run verify:security-tools
npm run verify:security-api
npm run verify:security-browser
npm run verify:security-deployed
npm run verify:platform
npm run verify:components
```

`verify:security-tools` 使用真实 agent-browser 验证页面快照、HTTP 请求、截图和 action policy。`verify:security-api` 使用当前开发数据库创建目标、身份和工单。`verify:security-browser` 需要设置 `SECURITY_TICKET_ID` 与 `SECURITY_BROWSER_URL`，验证安全菜单、目标、工单详情、报告和移动端导航。`verify:security-deployed` 在部署环境创建平台自测目标和真实工单，等待 Pi Agent 完成后检查报告。

`verify:platform` 使用 `.verification` 中的独立 PostgreSQL，在端口 55433 验证迁移、认证、配置保存、Webhook 幂等、运行取消和原生 OCR preview。它不会连接现有开发或部署数据库，也不会发送外部通知。每项验证上限为 60 秒，报告保存为对应运行目录中的 `report.json`。

`verify:components` 通过真实 shadcn MCP 连接读取项目 registry 和 NeUI Timeline 信息。`deploy/verify-telemetry.ts` 使用真实 Collector 检查 OTLP、W3C 上下文、运行指标及属性过滤。
