ALTER TABLE "repositories" DROP CONSTRAINT "repositories_ocr_limits";
ALTER TABLE "repositories" ALTER COLUMN "ocrMaxTokensBudget" SET DEFAULT 0;
UPDATE "repositories" SET "ocrMaxTokensBudget" = 0;
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_ocr_limits"
  CHECK ("ocrConcurrency" BETWEEN 1 AND 16 AND "ocrTimeoutMinutes" BETWEEN 1 AND 120 AND "ocrMaxTokensBudget" >= 0);
