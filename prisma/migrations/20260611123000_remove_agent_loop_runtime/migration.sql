DROP TABLE IF EXISTS "review_agent_traces";

DO $$
BEGIN
  IF to_regclass('public.repository_pi_profiles') IS NOT NULL THEN
    ALTER TABLE "repository_pi_profiles"
    DROP COLUMN IF EXISTS "maxIterations",
    DROP COLUMN IF EXISTS "maxContextFiles",
    DROP COLUMN IF EXISTS "maxCallGraphDepth";
  ELSIF to_regclass('public.repository_review_bots') IS NOT NULL THEN
    ALTER TABLE "repository_review_bots"
    DROP COLUMN IF EXISTS "maxIterations",
    DROP COLUMN IF EXISTS "maxContextFiles",
    DROP COLUMN IF EXISTS "maxCallGraphDepth";
  END IF;
END $$;
