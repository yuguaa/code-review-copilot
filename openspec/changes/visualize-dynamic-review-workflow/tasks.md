## 1. Data Model And Dependency

- [x] 1.1 Add local `@xyflow/react` dependency without upgrading unrelated packages
- [x] 1.2 Add `ReviewWorkflowNode` Prisma model and migration
- [x] 1.3 Generate Prisma client after schema change

## 2. Workflow Recording

- [x] 2.1 Add workflow recorder service with Promise-chain APIs
- [x] 2.2 Write trigger nodes from manual, retry, MR webhook, and Push webhook review creation
- [x] 2.3 Wrap main review steps with running, success, failed, and terminal workflow nodes
- [x] 2.4 Sync Pi Runtime execution into workflow nodes
- [x] 2.5 Cancel running workflow nodes from manual stop

## 3. Workflow APIs

- [x] 3.1 Add `/api/reviews/[id]/workflow` snapshot API with generated edges
- [x] 3.2 Add `/api/reviews/[id]` detail API for comments, Pi Review Runs, raw materials, and GitLab links
- [x] 3.3 Reduce `/api/reviews` list payload to summary data

## 4. Frontend Workflow Experience

- [x] 4.1 Split review detail workflow UI into focused components
- [x] 4.2 Add dynamically loaded React Flow canvas
- [x] 4.3 Add workflow inspector with metrics, raw data, runtime contribution, and clickable issues
- [x] 4.4 Poll workflow only while selected review is running
- [x] 4.5 Preserve existing review issue, summary, Pi runtime, raw material, retry, and stop interactions

## 5. Verification

- [x] 5.1 Run lint and fix issues
- [x] 5.2 Run build and fix issues
- [x] 5.3 Verify OpenSpec status is apply-ready/all tasks tracked
