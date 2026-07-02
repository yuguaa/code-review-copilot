# Product

## Register

product

## Users

研发负责人、代码评审人和项目维护者。他们在浏览器里处理 GitLab Push / Merge Request 审查会话，需要快速看到审查状态、仓库上下文、分支和提交信息，并能继续追问 Agent。

## Product Purpose

Code Review Agent 把 webhook 触发的代码审查变成可追问的会话。它准备工作区、运行工具化 Agent、沉淀审查消息，并把结论同步到平台评论或钉钉。成功状态是用户能信任它像真实审查助手一样工作：触发清晰、回复可见、上下文明确、配置可控。

## Brand Personality

清晰、克制、带一点 Figma 式色块记忆点的专业工作台。主界面采用白色单画布、近黑主操作、1px hairline、Inter + JetBrains Mono 的 taxonomy 层级；lime / lilac / cream / mint / pink / coral / navy 只在空态、登录入口、失败横幅、Webhook 接入等少数高信号位置使用。识别度来自色块和字重，不来自营销式装饰。

## Anti-references

不要把 Figma 营销站结构（marquee、pricing、footer、超大 hero）搬进工作台。不要回到奶油暖底或整屏多色卡片墙。不要用粉色/红色作为默认焦点环，焦点和主操作必须中性。不要给 assistant 回复套普通聊天卡片；审查结论应像文档流一样可读。不要让仓库、分支、提交和作者等上下文藏得很深。

## Design Principles

1. 会话即工作台：首屏直接进入审查和追问，不做营销式入口。
2. 上下文贴着任务走：仓库、分支、提交、作者和状态靠近输入和消息流。
3. 单一画布：侧栏与主区只靠 hairline 区分，header 和 composer 融入画布。
4. 状态可被信任：运行中、失败、完成、工具调用和空回复都要有明确反馈。
5. 密度服务效率：保留工程工具需要的信息密度，用字重、mono 标签、8px 形状和少量色块解决层级。
6. 能力配置可追溯：Tools / Skills 有平台级事实源，仓库只能做显式覆盖；Agent 实际暴露能力必须由该配置解析，不能在 prompt 或工具注册处另起一套开关。

> 完整设计 token（颜色/字体/圆角/间距/组件）以当前 Figma app 化契约为准；本产品借用 Figma 的黑白 chrome、彩色色块和 mono taxonomy，不复刻营销落地页结构。

## Accessibility & Inclusion

默认目标为 WCAG AA。正文和表单文字保持足够对比度；交互控件提供清晰 hover、focus、disabled 状态；动画只表达状态变化，并遵守 reduced motion 偏好。
