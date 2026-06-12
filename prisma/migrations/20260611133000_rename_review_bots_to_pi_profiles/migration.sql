DO $$
BEGIN
  IF to_regclass('public.repository_review_bots') IS NOT NULL THEN
    ALTER TABLE "repository_review_bots" RENAME TO "repository_pi_profiles";
  END IF;

  IF to_regclass('public.review_bot_runs') IS NOT NULL THEN
    ALTER TABLE "review_bot_runs" RENAME TO "pi_review_runs";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pi_review_runs' AND column_name = 'reviewBotId'
  ) THEN
    ALTER TABLE "pi_review_runs" RENAME COLUMN "reviewBotId" TO "piProfileId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'review_comments' AND column_name = 'reviewBotRunId'
  ) THEN
    ALTER TABLE "review_comments" RENAME COLUMN "reviewBotRunId" TO "piReviewRunId";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'review_comments' AND column_name = 'sourceBotName'
  ) THEN
    ALTER TABLE "review_comments" RENAME COLUMN "sourceBotName" TO "sourceProfileName";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'review_comments' AND column_name = 'sourceBotModel'
  ) THEN
    ALTER TABLE "review_comments" RENAME COLUMN "sourceBotModel" TO "sourceProfileModel";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'review_comments' AND column_name = 'sourceBotsJson'
  ) THEN
    ALTER TABLE "review_comments" RENAME COLUMN "sourceBotsJson" TO "sourceProfilesJson";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'review_workflow_nodes' AND column_name = 'reviewBotRunId'
  ) THEN
    ALTER TABLE "review_workflow_nodes" RENAME COLUMN "reviewBotRunId" TO "piReviewRunId";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'repository_review_bots_pkey'
      AND conrelid = to_regclass('public.repository_pi_profiles')
  ) THEN
    ALTER TABLE "repository_pi_profiles" RENAME CONSTRAINT "repository_review_bots_pkey" TO "repository_pi_profiles_pkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_bot_runs_pkey'
      AND conrelid = to_regclass('public.pi_review_runs')
  ) THEN
    ALTER TABLE "pi_review_runs" RENAME CONSTRAINT "review_bot_runs_pkey" TO "pi_review_runs_pkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'repository_review_bots_repositoryId_fkey'
      AND conrelid = to_regclass('public.repository_pi_profiles')
  ) THEN
    ALTER TABLE "repository_pi_profiles" RENAME CONSTRAINT "repository_review_bots_repositoryId_fkey" TO "repository_pi_profiles_repositoryId_fkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'repository_review_bots_aiModelId_fkey'
      AND conrelid = to_regclass('public.repository_pi_profiles')
  ) THEN
    ALTER TABLE "repository_pi_profiles" RENAME CONSTRAINT "repository_review_bots_aiModelId_fkey" TO "repository_pi_profiles_aiModelId_fkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_bot_runs_reviewLogId_fkey'
      AND conrelid = to_regclass('public.pi_review_runs')
  ) THEN
    ALTER TABLE "pi_review_runs" RENAME CONSTRAINT "review_bot_runs_reviewLogId_fkey" TO "pi_review_runs_reviewLogId_fkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_bot_runs_reviewBotId_fkey'
      AND conrelid = to_regclass('public.pi_review_runs')
  ) THEN
    ALTER TABLE "pi_review_runs" RENAME CONSTRAINT "review_bot_runs_reviewBotId_fkey" TO "pi_review_runs_piProfileId_fkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_comments_reviewBotRunId_fkey'
      AND conrelid = to_regclass('public.review_comments')
  ) THEN
    ALTER TABLE "review_comments" RENAME CONSTRAINT "review_comments_reviewBotRunId_fkey" TO "review_comments_piReviewRunId_fkey";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_workflow_nodes_reviewBotRunId_fkey'
      AND conrelid = to_regclass('public.review_workflow_nodes')
  ) THEN
    ALTER TABLE "review_workflow_nodes" RENAME CONSTRAINT "review_workflow_nodes_reviewBotRunId_fkey" TO "review_workflow_nodes_piReviewRunId_fkey";
  END IF;
END $$;

ALTER INDEX IF EXISTS "repository_review_bots_repositoryId_isActive_sortOrder_idx" RENAME TO "repository_pi_profiles_repositoryId_isActive_sortOrder_idx";
ALTER INDEX IF EXISTS "repository_review_bots_aiModelId_idx" RENAME TO "repository_pi_profiles_aiModelId_idx";
ALTER INDEX IF EXISTS "review_bot_runs_reviewLogId_reviewBotId_key" RENAME TO "pi_review_runs_reviewLogId_piProfileId_key";
ALTER INDEX IF EXISTS "review_bot_runs_reviewLogId_status_idx" RENAME TO "pi_review_runs_reviewLogId_status_idx";
ALTER INDEX IF EXISTS "review_bot_runs_reviewBotId_idx" RENAME TO "pi_review_runs_piProfileId_idx";
ALTER INDEX IF EXISTS "review_comments_reviewLogId_reviewBotRunId_severity_idx" RENAME TO "review_comments_reviewLogId_piReviewRunId_severity_idx";
ALTER INDEX IF EXISTS "review_comments_reviewBotRunId_isPosted_idx" RENAME TO "review_comments_piReviewRunId_isPosted_idx";
ALTER INDEX IF EXISTS "review_workflow_nodes_reviewBotRunId_idx" RENAME TO "review_workflow_nodes_piReviewRunId_idx";
