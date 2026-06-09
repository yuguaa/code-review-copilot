## Why

当前审查详情只能用日志和静态阶段卡片追踪 Agent Loop，用户无法在 review 进行中直观看到流程推进、节点状态和辅助 Agent 触发关系。动态过程图可以把 review 从“事后读日志”变成“实时看链路”，尤其适合排查卡点、失败、上下文缺失和 Finding 被丢弃的原因。

## What Changes

- 新增动态 review workflow 快照能力：review 刚创建时只写入触发节点，后续步骤开始、完成、失败、取消时持续更新节点。
- 新增 `ReviewWorkflowNode` 持久化模型，只保存当前图节点状态，不引入可编辑流程编排系统。
- 新增 `/api/reviews/[id]/workflow`，返回当前 workflow 的 `nodes` 和读取时生成的 `edges`。
- 在审查详情中新增“过程图”Tab，使用 `@xyflow/react` 展示动态节点和边，并在 review 进行中轮询刷新。
- 将 React Flow 画布动态加载，避免进入审查列表首屏 bundle。
- 保留 `ReviewAgentTrace` 作为 Agent Loop 原始轨迹来源，workflow 只负责可视化快照。

## Capabilities

### New Capabilities
- `dynamic-review-workflow`: 动态记录并展示单次 code review 的执行节点、状态、指标和关系。

### Modified Capabilities
- `review-history`: 审查历史详情新增过程图入口，并将列表摘要与详情级 workflow 数据分离。

## Impact

- 数据库：新增 `review_workflow_nodes` 表及相关索引。
- 后端：新增 workflow recorder 服务；触发、主审查步骤、Agent Loop、停止审查、失败处理写入动态节点。
- API：新增 `/api/reviews/[id]/workflow`；新增 `/api/reviews/[id]` 详情接口；列表接口减少详情级 trace/raw 字段。
- 前端：拆分审查详情相关组件，新增 React Flow 过程图、节点详情面板和轮询刷新逻辑。
- 依赖：新增本地依赖 `@xyflow/react`。
