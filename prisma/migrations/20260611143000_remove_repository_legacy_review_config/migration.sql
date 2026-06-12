ALTER TABLE IF EXISTS "repositories" DROP CONSTRAINT IF EXISTS "repositories_defaultAIModelId_fkey";

ALTER TABLE IF EXISTS "repositories"
  DROP COLUMN IF EXISTS "defaultAIModelId",
  DROP COLUMN IF EXISTS "customPrompt",
  DROP COLUMN IF EXISTS "customPromptMode",
  DROP COLUMN IF EXISTS "customProvider",
  DROP COLUMN IF EXISTS "customModelId",
  DROP COLUMN IF EXISTS "customApiKey",
  DROP COLUMN IF EXISTS "customApiEndpoint",
  DROP COLUMN IF EXISTS "customMaxTokens",
  DROP COLUMN IF EXISTS "customTemperature";
