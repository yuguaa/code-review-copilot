ALTER TABLE "repositories" ALTER COLUMN "ocrMaxTokensBudget" SET DEFAULT 1000000;
UPDATE "repositories" SET "ocrMaxTokensBudget" = 1000000 WHERE "ocrMaxTokensBudget" = 0;
