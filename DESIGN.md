# Design System: Code Review Console

## 1. Visual Theme & Atmosphere

代码审查工作台采用 Founder OS 的“紫灰运营决策台”主题：以低饱和紫灰画布承载高密度审查信息，以品牌紫标记当前上下文和主要动作，以少量语义色表达真实状态。

界面保持安静、紧凑、任务优先。会话、风险、证据和配置必须易于扫描，不使用营销式 Hero、玻璃拟态、卡片墙或无业务意义的装饰。

## 2. Color Palette & Roles

- **Brand** `#7656C8`：主要动作、当前导航和图表主序列。
- **Brand Strong** `#6242B5`：浅色背景上的品牌强调与 hover。
- **Brand Soft** `#F0EBFF`：轻量品牌背景和选中反馈。
- **Canvas** `#F7F5FC`：工作台主画布。
- **Sidebar** `#EEE9F8`：侧边栏与导航区域。
- **Card** `#FFFEFE`：卡片、输入器、弹窗和消息表面。
- **Ink** `#28243A`：标题、主要文字和代码深色表面。
- **Muted** `#756D85`：说明、metadata 和次级文本。
- **Status Up** `#28895C`：成功、健康和已完成。
- **Destructive** `#C6534A`：错误和危险动作。

需要对比序列时使用蓝 `#4D83C7`、青 `#2F9B8F`、橙 `#DC8A35` 和玫红 `#D85F86`。品牌紫只表达当前、品牌或可执行，不作为无意义装饰。

## 3. Typography Rules

- **UI:** `Avenir Next, Avenir, Segoe UI Variable, Segoe UI, PingFang SC, sans-serif`。
- **Mono:** `SFMono-Regular, Roboto Mono, Consolas, Liberation Mono, monospace`，仅用于分支、hash、工具名、JSON 和编号。
- 页面标题 `24px / 700`；区块标题 `16-20px / 700`；正文与控件 `14px`；辅助标签 `12px`。
- 中文使用系统字体自然回退，不额外引入 Web Font，不用超宽字距或字体混搭制造层级。

## 4. Component Styling

- **Button:** 默认高 `32px`，`8px` 圆角；主按钮品牌紫白字，次级按钮使用卡片表面。focus 使用半透明品牌 ring，active 缩放至 `0.96`。
- **Card:** `8px` 圆角、`1px` 语义边框、`20px` 内边距和轻环境阴影。
- **Input / Select:** 最小高 `36px`、`6px` 圆角；focus 使用品牌边框与 `2px` 弱品牌 ring。
- **Badge:** `20px` 高、`12px` 字号、胶囊圆角；颜色只表达标签类型或真实状态。
- **Messages:** 用户消息使用品牌紫；assistant 消息使用轻表面，保持文档阅读感。
- **Status:** running 使用轻量呼吸或旋转反馈，只动画 transform 和 opacity。

面板阴影统一为：

```css
0 1px 2px rgb(63 45 91 / 0.04),
0 8px 24px rgb(79 58 116 / 0.06)
```

## 5. Layout Principles

- 应用保持 sidebar + main workspace，不改变现有审查信息架构。
- 桌面侧栏宽 `240px`，折叠态宽 `72px`；顶栏高 `64px`。
- 主内容内边距为移动端 `16px`、桌面端 `28px`。
- 业务页面使用纯色画布；只允许登录品牌区使用紫色渐变与细网格。
- 移动端强制单列，不允许横向滚动；固定格式区域使用稳定尺寸和响应式约束。
- 卡片只用于独立信息单元、弹窗、消息和真正需要边界的工具。

## 6. Motion & Interaction

- 常规颜色、边框、阴影和位移过渡约 `150ms`。
- 所有可点击元素都有 hover、active 和键盘 focus 反馈。
- 加载状态使用当前组件尺寸内的轻量文本或状态点，避免大型 spinner。
- `prefers-reduced-motion` 下将非必要动画压缩至近乎即时。

## 7. Do's and Don'ts

Do：

- 使用现有语义变量和共享组件保持全站一致。
- 每个页面明确当前对象、关键状态和一个主要动作。
- 用品牌紫表达当前上下文、主要动作或图表主序列。
- 为加载、空数据、错误、成功和进行中提供明确反馈。
- 保持键盘焦点可见，图标按钮提供可识别名称。

Don't：

- 不为单个页面创建私有色板、字体体系或组件风格。
- 不在业务页使用全局网格、渐变、玻璃拟态、光晕或渐变字。
- 不用成功、警告或错误色丰富画面，它们只表达真实状态。
- 不添加无业务意义的 Hero、badge、stamp 或装饰图形。
- 不为视觉效果新增依赖或预建未使用的组件。
