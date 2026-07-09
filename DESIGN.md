# Design System: Editorial Review Console

## 1. Visual Theme & Atmosphere

一个精密、纸面、偏编辑排版气质的代码审查工作台。整体密度保持 Daily App Balanced，视觉记忆点来自浅色网格纸、强衬线标题、极细分隔线，以及洋红 / 青色的小面积信号。

界面不做营销页式 hero，也不使用玻璃拟态和卡片墙。所有页面优先服务于读取、追问、定位状态和执行审查指令。

## 2. Color Palette & Roles

- **Paper Canvas** (#F4F1EA) — 页面主背景，像未涂布纸。
- **Soft Rail** (#E9E4DB) — 侧边栏、二级区域和 hover 背景。
- **Paper Surface** (#FBFAF6) — 卡片、输入器、弹窗和消息块表面。
- **Pressed Surface** (#DED8CD) — hover、选中和轻交互状态。
- **Ink Black** (#262330) — 主文字、标题和关键操作。
- **Ledger Gray** (#6E6874) — 次级文字、说明、metadata。
- **Magenta Signal** (#BE167F) — 品牌、主动作、焦点线。
- **Cyan Signal** (#2CAFCB) — 系统运行、成功或辅助信号。
- **Signal Coral** (#C6534A) — 错误和危险动作，仅用于语义状态。

禁止玻璃拟态、紫蓝霓虹大渐变、纯黑、大面积高饱和色块和多 accent 并存。

## 3. Typography Rules

- **Display:** ui-serif / Songti SC / Georgia — 650 weight，紧凑字距，用于页面标题、品牌和关键数值。
- **Body:** system sans fallback — 14px 到 15px 为主，行高保持 1.6 到 1.72。
- **Mono:** JetBrains Mono — 用于分支、hash、工具名、JSON 和 taxonomy 文本。
- **Banned:** Inter 作为优先 display 字体、过大的营销标题、纯装饰性斜体堆叠。

## 4. Component Stylings

- **Buttons:** 4px/6px radius，深墨主按钮白字，次级按钮使用 Paper Surface。active 使用轻微 scale，不能只变透明度。
- **Cards:** 只在信息单元、弹窗、消息块中使用。表面为 Paper Surface，使用细边框和极轻纸面阴影。
- **Inputs:** label 在上方，表面与卡片一致，focus 使用 Magenta Signal ring。
- **Messages:** 用户消息使用 Ink Black；assistant 消息使用轻表面，像审查文档块，而不是聊天泡泡墙。
- **Status:** running 状态使用 breathing pulse，但只动画 transform 和 opacity。
- **Line Decoration:** 页面背景使用极淡 96px 纸面网格、细竖向参考线和短横线标记。重点面板只允许一条 accent rule，不做装饰渐变。
- **Loaders:** 使用当前组件尺寸内的轻量加载文本或状态点，避免突兀的大 spinner。

## 5. Layout Principles

应用是 sidebar + main workspace，不使用营销 AIDA 页面结构。侧边栏负责导航和审查会话，主区域负责阅读与追问。

背景装饰必须服务结构感：用于边界、比例、分隔和技术语境，不作为花纹堆叠。移动端降低网格透明度，优先保证阅读。

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
