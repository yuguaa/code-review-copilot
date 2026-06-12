ALTER TABLE "review_logs"
  RENAME COLUMN "aiSummary" TO "changeSummary";

ALTER TABLE "review_logs"
  RENAME COLUMN "aiResponse" TO "piRawOutputs";

ALTER TABLE "review_logs"
  RENAME COLUMN "reviewPrompts" TO "piPrompts";

ALTER TABLE "review_logs"
  DROP COLUMN "aiModelProvider",
  DROP COLUMN "aiModelId";

ALTER TABLE "pi_review_runs"
  RENAME COLUMN "aiModelProvider" TO "modelProvider";

ALTER TABLE "pi_review_runs"
  RENAME COLUMN "aiModelId" TO "modelId";

ALTER TABLE "pi_review_runs"
  RENAME COLUMN "aiModelName" TO "modelName";
