-- 用户明确要求将现有仓库的 OCR Token 预算统一为 2,000,000。
ALTER TABLE "repositories" ALTER COLUMN "ocrMaxTokensBudget" SET DEFAULT 2000000;
UPDATE "repositories" SET "ocrMaxTokensBudget" = 2000000;
