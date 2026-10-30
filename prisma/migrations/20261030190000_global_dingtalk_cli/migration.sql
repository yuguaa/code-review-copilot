BEGIN;

ALTER TABLE "sessions" ADD COLUMN "authorUsername" TEXT;
ALTER TABLE "dingtalk_robots" ADD COLUMN "cliSingleton" BOOLEAN;
ALTER TABLE "dingtalk_robots" ADD COLUMN "cliLoginId" TEXT;
ALTER TABLE "dingtalk_robots" ADD COLUMN "cliEnableAfterLogin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dingtalk_messages" ADD COLUMN "cliProfile" TEXT;
ALTER TABLE "dingtalk_contacts" ADD COLUMN "cliProfile" TEXT;
UPDATE "dingtalk_contacts" c SET "cliProfile" = r."cliProfile" FROM "dingtalk_robots" r WHERE c."connectionId" = r.id;
DROP INDEX "dingtalk_contacts_connectionId_employeeNo_key";
CREATE UNIQUE INDEX "dingtalk_contacts_connectionId_cliProfile_employeeNo_key" ON "dingtalk_contacts"("connectionId", "cliProfile", "employeeNo");

-- 保留既有连接和发送记录；多份旧 CLI 配置须先由管理员确认，不能静默丢弃。
UPDATE "dingtalk_robots" SET "cliSingleton" = true WHERE "transport" = 'cli';
CREATE UNIQUE INDEX "dingtalk_robots_cliSingleton_key" ON "dingtalk_robots"("cliSingleton");
ALTER TABLE "dingtalk_robots" ADD CONSTRAINT "dingtalk_cli_singleton_check"
  CHECK (("transport" = 'cli' AND "cliSingleton" IS TRUE) OR ("transport" <> 'cli' AND "cliSingleton" IS NULL));

COMMIT;
