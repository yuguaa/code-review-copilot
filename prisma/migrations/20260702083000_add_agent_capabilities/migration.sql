-- CreateTable
CREATE TABLE "agent_tools" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'read',
    "defaultEnabled" BOOLEAN NOT NULL DEFAULT true,
    "builtin" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'review',
    "prompt" TEXT NOT NULL,
    "defaultEnabled" BOOLEAN NOT NULL DEFAULT false,
    "builtin" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_tool_settings" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_tool_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repository_skill_settings" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_skill_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_tools_key_key" ON "agent_tools"("key");

-- CreateIndex
CREATE UNIQUE INDEX "agent_skills_key_key" ON "agent_skills"("key");

-- CreateIndex
CREATE UNIQUE INDEX "repository_tool_settings_repositoryId_toolId_key" ON "repository_tool_settings"("repositoryId", "toolId");

-- CreateIndex
CREATE INDEX "repository_tool_settings_toolId_idx" ON "repository_tool_settings"("toolId");

-- CreateIndex
CREATE UNIQUE INDEX "repository_skill_settings_repositoryId_skillId_key" ON "repository_skill_settings"("repositoryId", "skillId");

-- CreateIndex
CREATE INDEX "repository_skill_settings_skillId_idx" ON "repository_skill_settings"("skillId");

-- AddForeignKey
ALTER TABLE "repository_tool_settings" ADD CONSTRAINT "repository_tool_settings_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_tool_settings" ADD CONSTRAINT "repository_tool_settings_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "agent_tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_skill_settings" ADD CONSTRAINT "repository_skill_settings_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_skill_settings" ADD CONSTRAINT "repository_skill_settings_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "agent_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed builtin tools.
INSERT INTO "agent_tools" ("id", "key", "name", "description", "category", "defaultEnabled", "builtin", "isActive", "updatedAt")
VALUES
  ('tool_bash', 'bash', '只读命令', '在仓库工作区执行 grep/rg/find/cat/sed/git log 等只读探索命令。', 'read', true, true, true, CURRENT_TIMESTAMP),
  ('tool_read_file', 'read_file', '读取文件', '读取工作区内文本文件的完整内容。', 'read', true, true, true, CURRENT_TIMESTAMP),
  ('tool_read_memory', 'read_memory', '读取项目记忆', '读取本仓库跨次审查沉淀的项目记忆。', 'memory', true, true, true, CURRENT_TIMESTAMP),
  ('tool_git_diff', 'git_diff', '查看审查变更', '查看本次 MR/Push 审查对应的 git diff。', 'read', true, true, true, CURRENT_TIMESTAMP),
  ('tool_write_memory', 'write_memory', '更新项目记忆', '审查结束后更新本仓库项目记忆。', 'memory', true, true, true, CURRENT_TIMESTAMP),
  ('tool_post_review_comment', 'post_review_comment', '发布总评评论', '把审查总评发布到 GitLab MR 或 Push commit。', 'publish', true, true, true, CURRENT_TIMESTAMP),
  ('tool_post_inline_comment', 'post_inline_comment', '发布行级评论', '把问题精准发布到 MR/commit 的指定文件行。', 'publish', true, true, true, CURRENT_TIMESTAMP),
  ('tool_delegate_security', 'delegate_security', '安全专项委派', '委派安全专项 Agent 独立复核注入、鉴权、敏感信息等风险。', 'delegate', true, true, true, CURRENT_TIMESTAMP),
  ('tool_delegate_architecture', 'delegate_architecture', '架构专项委派', '委派架构专项 Agent 独立复核分层、依赖、职责和可维护性。', 'delegate', true, true, true, CURRENT_TIMESTAMP),
  ('tool_delegate_performance', 'delegate_performance', '性能专项委派', '委派性能专项 Agent 独立复核查询、IO、内存和前端性能风险。', 'delegate', true, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Seed builtin brooks-lint skills. Full prompt bodies are stored in code and synced at runtime;
-- this migration gives existing deployments a usable registry immediately.
INSERT INTO "agent_skills" ("id", "key", "name", "description", "mode", "prompt", "defaultEnabled", "builtin", "isActive", "updatedAt")
VALUES
  ('skill_brooks_review', 'brooks-review', 'Brooks PR Review', '基于 brooks-lint 的 PR/diff 衰退风险审查。', 'review', 'brooks-lint PR Review builtin skill', true, true, true, CURRENT_TIMESTAMP),
  ('skill_brooks_audit', 'brooks-audit', 'Brooks Architecture Audit', '基于 brooks-lint 的架构与模块依赖审计。', 'review', 'brooks-lint Architecture Audit builtin skill', false, true, true, CURRENT_TIMESTAMP),
  ('skill_brooks_debt', 'brooks-debt', 'Brooks Tech Debt', '基于 brooks-lint 的技术债分类与优先级评估。', 'review', 'brooks-lint Tech Debt builtin skill', false, true, true, CURRENT_TIMESTAMP),
  ('skill_brooks_health', 'brooks-health', 'Brooks Health Dashboard', '基于 brooks-lint 的综合代码健康评分。', 'review', 'brooks-lint Health Dashboard builtin skill', false, true, true, CURRENT_TIMESTAMP),
  ('skill_brooks_test', 'brooks-test', 'Brooks Test Quality', '基于 brooks-lint 的测试套件质量审查。', 'review', 'brooks-lint Test Quality builtin skill', false, true, true, CURRENT_TIMESTAMP),
  ('skill_brooks_sweep', 'brooks-sweep', 'Brooks Full Sweep', '基于 brooks-lint 的全维度扫描与修复模式；因涉及写代码默认禁用。', 'review', 'brooks-lint Full Sweep builtin skill', false, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
