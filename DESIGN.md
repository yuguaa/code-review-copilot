# Design System: Code Review Console

## 1. Visual Theme & Atmosphere

工作台采用 shadcn 的 `base-nova` 中性主题，叠加 ReUI 的扩展语义色。界面保持低彩度：画布为白色，分隔线仅用 1px 边框，颜色只出现在状态、图表序列和当前上下文。

整体观感接近 reui.io 的 app shell：紧凑、克制、以任务为中心。不使用装饰渐变、光晕和玻璃拟态。

## 2. Color Tokens

颜色全部通过 shadcn CSS 变量表达（`web/index.css` 的 `:root` 与 `@theme inline`）：

- **background / foreground**：`oklch(1 0 0)` / `oklch(0.145 0 0)`，画布与正文。
- **card / popover**：白色表面，配合 `border` 与阴影区分层级。
- **primary**：`oklch(0.205 0 0)`，主要动作与当前上下文。
- **muted / accent**：`oklch(0.97 0 0)`，次级表面、hover 与选中背景。
- **border / input / ring**：`oklch(0.922 0 0)` 与 `oklch(0.708 0 0)`，分隔线与焦点环。
- **sidebar 系列**：侧栏与主区共用白色，靠边框分隔。
- **chart-1..5**：图表序列色板，顺序为橙、青、深蓝、黄、琥珀。
- **语义色**：`success`、`warning`、`info`、`destructive` 以及对应的 `-foreground`，来自 ReUI 的扩展 token。

语义色只表达真实状态。图表以外不使用彩色填充大面积区域。

## 3. Typography

- **UI**：`Inter Variable`，中文回退到 `PingFang SC` 与 `Microsoft YaHei`。
- **Mono**：`SFMono-Regular`、`Roboto Mono`、`Consolas`，仅用于分支、提交、工具名、JSON 与编号。
- 页面标题 `text-xl / 600`；区块标题 `text-base / 500`；正文 `text-sm`；辅助信息 `text-xs`。
- 不引入额外的字体文件，靠字重与颜色建立层级。

## 4. Components

- 全部基础控件来自 shadcn（`web/components/ui/`）：Button、Input、Select、Checkbox、Switch、Card、Badge、Tabs、Dialog、Sheet、Tooltip、DropdownMenu、Collapsible、Resizable、Sidebar、Item、Empty、InputGroup 等。
- 对话界面来自 ai-elements（`web/components/ai-elements/`）：Conversation、Message、Reasoning、Tool、PromptInput、CodeBlock、Loader、Shimmer。
- ReUI 提供扩展组件（`web/components/reui/badge.tsx`），并使用其扩展语义 token。
- 业务封装保持在 `web/components/chat/`、`web/components/settings/`、`web/components/dashboard/`、`web/components/repositories/`、`web/components/rss/`。
- 圆角统一为 `--radius: 0.625rem`，按钮高 32px，输入框高 32px。
- 阴影只用于浮层：`shadow-xs` 用于卡片，`shadow-md` 用于弹层。

## 5. Layout

应用外壳复刻 reui 的 app-shell-21：

- 侧栏默认 248px，可拖拽到最多 380px，拖到 48px 时折叠为图标栏。
- 侧栏自上而下是品牌区、会话/仓库标签、新建对话、分组会话列表、导航与账号菜单。
- 主区顶栏固定 56px，左侧是当前对象标题与元信息，右侧是页面操作。
- 主区内容自适应：聊天页为消息流 + 输入器，业务页为可滚动内容区。
- 移动端侧栏切换为抽屉，顶栏左端提供打开导航的按钮。

## 6. Motion & Interaction

- 颜色、边框与背景过渡约 150ms；侧栏宽度过渡 200ms。
- 所有可点击元素具备 hover、active 与键盘 focus 反馈；分隔线支持方向键调整宽度。
- 运行中的状态点使用 `animate-pulse`，加载态使用同尺寸的 Loader。
- 遵守 `prefers-reduced-motion`。

## 7. Do's and Don'ts

Do：

- 复用 shadcn token 与组件，不在页面内自定义色板。
- 每个页面明确当前对象、关键状态与一个主要动作。
- 审查结论按文档流阅读：标题、段落、代码块、列表，不套聊天气泡。
- 为加载、空数据、错误与进行中提供明确反馈。

Don't：

- 不在业务页使用渐变、网格背景、玻璃拟态或装饰图形（登录页左侧品牌面板除外）。
- 不用语义色装饰非状态内容。
- 不新增未使用的依赖或组件。
