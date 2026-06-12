## Context

当前 review 后端是固定串行主链路：触发创建 `ReviewLog`，随后 `ReviewService.performReview` 执行 Diff、Summary、Pi Runtime、Aggregate、Publish。Pi Runtime 会创建 OpenSandbox session 和 Pi Review Run，但前端需要通过动态节点查看 review 运行中的主链路变化。

前端 `app/reviews/page.tsx` 目前承担列表、详情、runtime 原始材料解析和 UI，列表接口 `/api/reviews` 也返回了过多详情级数据。新增 React Flow 后必须避免把重型图组件和 runtime 原始材料塞进列表首屏。

## Goals / Non-Goals

**Goals:**
- 在 review 运行时持续写入动态 workflow 节点，节点内容随步骤推进而新增和更新。
- 用 React Flow 展示当前 workflow 快照，支持节点点击查看详情，支持 Finding 点击打开 GitLab 行或定位到问题详情。
- 保留现有 Pi 审查逻辑，不把可视化变成新的流程编排系统。
- 拆分列表、详情、workflow 数据，减少客户端序列化负载和首屏 bundle。

**Non-Goals:**
- 不引入 WebSocket/SSE，第一版使用轮询。
- 不支持拖拽编辑流程、保存布局或自定义编排。
- 不做多次 attempt 对比、导出图片或全局监控大屏。
- 不为旧 review 补造缺失节点；缺失 workflow 时快速失败。

## Decisions

1. **新增 `ReviewWorkflowNode`，只保存节点快照**
   - 选择：持久化当前节点状态，边在读取时生成。
   - 理由：动态图需要运行中可刷新，单靠 Pi Review Run 或 sandbox session 只能覆盖 Pi 运行结果，无法表达触发、主步骤、取消和发布链路的当前状态。
   - 替代方案：仅从原始材料 JSON 派生。该方案无法在 review 刚开始时展示主链路动态节点，也难以表达 stop/cancel。

2. **新增 `review-workflow-recorder` 服务**
   - 选择：提供 `startNode`、`completeNode`、`failNode`、`cancelRunningNodes`、`upsertNode`，所有方法返回 Promise。
   - 理由：集中管理节点 key、状态、时间和 JSON 序列化，避免步骤内散落 Prisma 写入。
   - 替代方案：在每个步骤直接写 Prisma。该方案重复且容易状态不一致。

3. **主链路由 `ReviewService.performReview` 包装记录**
   - 选择：在服务层包装每个 step 的开始、完成和失败。
   - 理由：它是全链路唯一编排点，记录主步骤不会侵入各 step 的业务细节。
   - 替代方案：每个 step 内部自行记录。该方案耦合更强，也更容易遗漏异常状态。

4. **Pi Runtime 写入 workflow 节点**
   - 选择：Pi review 开始、完成、失败时 upsert 对应 workflow 节点，并在详情接口展示 sandbox session。
   - 理由：当前主路径只有 Pi + OpenSandbox，workflow 应直接反映这个运行时，不再依赖旧原始 Trace。
   - 替代方案：完成后批量转换。该方案不是动态的，运行中看不到节点变化。

5. **React Flow 动态加载**
   - 选择：`@xyflow/react` 只在过程图组件中动态 import。
   - 理由：符合 Vercel bundle 优化，避免 reviews 列表首屏加载重型画布。
   - 替代方案：在 `page.tsx` 顶部静态 import。该方案会放大首屏 JS。

6. **节点详情承担交互价值**
   - 选择：节点只显示短摘要，详情面板展示指标、原始节点、相关 Finding 和 GitLab 行链接。
   - 理由：流程图适合表达结构，详情面板适合承载可点击问题与原始数据。
   - 替代方案：把所有内容写进节点。该方案会导致节点撑开、图形抖动且不可扫描。

## Risks / Trade-offs

- **节点写入增加数据库写入量** → 每个节点只 upsert 当前快照，不保存完整事件流；Pi 原始输出由 `ReviewLog.piRawOutputs` 和 `PiReviewRun.summary/error` 承载。
- **运行中进程崩溃可能留下 running 节点** → 重新触发/停止/失败路径会更新终态；历史残留可通过 review 状态识别。
- **边由读取时生成可能不完整** → 使用稳定 `nodeKey`、`parentNodeKey`、`sequence` 和约定主链路顺序生成，避免持久化边状态。
- **列表与详情拆分会改动前端数据流** → 保持现有交互入口，先用详情接口补齐弹窗数据，再逐步移除列表重字段。
- **React Flow 增加依赖** → 仅新增本地依赖，不升级核心依赖，动态加载降低首屏影响。
