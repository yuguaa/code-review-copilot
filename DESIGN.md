# Design System: Code Review Console

## 1. Visual Theme & Atmosphere

一个冷静、克制、偏工程气质的代码审查工作台。整体密度为 Daily App Balanced，布局保持工作台效率，视觉记忆点来自低饱和墨绿色、柔和纸感表面、审查状态光点和工程制图式细线。

界面不做营销页式 hero，也不使用装饰性渐变卡片。所有页面优先服务于读取、追问、定位状态和执行审查指令。

## 2. Color Palette & Roles

- **Review Canvas** (#F5F7F2) — 页面主背景，带轻微自然绿倾向。
- **Soft Rail** (#EEF2EC) — 侧边栏和二级区域背景。
- **Paper Surface** (#FBFCF8) — 卡片、输入器、弹窗和消息块表面。
- **Pressed Surface** (#E8EDE5) — hover、选中和轻交互状态。
- **Charcoal Ink** (#17201C) — 主文字、标题和关键操作。
- **Steel Moss** (#758078) — 次级文字、说明、metadata。
- **Moss Accent** (#6E9B59) — 唯一强调色，用于焦点、状态光点和关键激活态。
- **Signal Coral** (#C25F52) — 错误和危险动作，仅用于语义状态。

禁止紫蓝霓虹、纯黑、大面积高饱和色块和多 accent 并存。

## 3. Typography Rules

- **Display:** Geist, Satoshi fallback — 620 weight，紧凑字距，用于页面标题和工作台品牌。
- **Body:** Geist, system sans fallback — 14px 到 15px 为主，行高保持 1.6 到 1.72。
- **Mono:** JetBrains Mono — 用于分支、hash、工具名、JSON 和 taxonomy 文本。
- **Banned:** Inter 作为优先字体、Dashboard 中的衬线字体、过大的营销标题。

## 4. Component Stylings

- **Buttons:** 8px radius，深墨主按钮白字，次级按钮使用 Paper Surface。active 使用轻微 translate/scale，不能只变透明度。
- **Cards:** 只在需要区分层级时使用。表面为 Paper Surface，配合白色内边和 moss-tinted diffusion shadow。
- **Inputs:** label 在上方，表面与卡片一致，focus 使用 Moss Accent ring。
- **Messages:** 用户消息使用 Charcoal Ink；assistant 消息使用轻表面，像审查文档块，而不是聊天泡泡墙。
- **Status:** running 状态使用 breathing pulse，但只动画 transform 和 opacity。
- **Line Decoration:** 页面背景使用极淡 128px 工程网格、角标线、坐标式测量线和淡斜纹背景层；宽屏可使用两侧斜纹标尺；重点面板可叠加细扫描线和一条 accent rule。
- **Loaders:** 使用当前组件尺寸内的轻量加载文本或状态点，避免突兀的大 spinner。

## 5. Layout Principles

应用是 sidebar + main workspace，不使用营销 AIDA 页面结构。侧边栏负责导航和审查会话，主区域负责阅读与追问。

背景装饰必须服务结构感：用于边界、比例、分隔和技术语境，不作为花纹堆叠。移动端隐藏侧边标尺，降低背景装饰透明度，保留网格即可。

桌面端主内容约束在 4xl/7xl 宽度内，移动端强制单列，不允许横向滚动。布局用 CSS Grid 和现有 Tailwind 工具类，不使用复杂 flex 百分比计算。

## 6. Motion & Interaction

动效强度为 Fluid CSS。只动画 transform、opacity、background-color、box-shadow。列表和状态使用轻微呼吸/进入动效，避免无限高成本动画。

所有可点击元素应有 hover 与 active 反馈。复杂动画库不是默认依赖，除非业务确实需要可视化叙事。

## 7. Anti-Patterns

- 不使用 emoji 作为 UI 内容或装饰。
- 不使用 Inter 作为优先字体。
- 不使用纯黑 `#000000`。
- 不使用紫蓝霓虹、外发光、渐变文字。
- 不做 3 等分营销卡片布局。
- 不添加无业务意义的 hero、badge、stamp 或滚动提示。
- 不使用泛化文案，例如 “Next-Gen”“Elevate”“Seamless”。
- 不为视觉效果新增未安装的大型动画依赖。
