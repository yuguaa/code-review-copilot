ALTER TABLE "dingtalk_robots"
  ADD COLUMN "transport" TEXT NOT NULL DEFAULT 'webhook',
  ADD COLUMN "cliProfile" TEXT,
  ADD COLUMN "cliRobotCode" TEXT,
  ADD COLUMN "cliGroupId" TEXT;

ALTER TABLE "dingtalk_robots" ALTER COLUMN "webhookUrl" DROP NOT NULL;

ALTER TABLE "dingtalk_robots"
  ADD CONSTRAINT "dingtalk_robots_transport_check" CHECK ("transport" IN ('webhook', 'cli'));

CREATE TABLE "dingtalk_contacts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectionId" TEXT NOT NULL REFERENCES "dingtalk_robots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "employeeNo" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "dingtalk_contacts_connectionId_userId_key" ON "dingtalk_contacts"("connectionId", "userId");
CREATE UNIQUE INDEX "dingtalk_contacts_connectionId_employeeNo_key" ON "dingtalk_contacts"("connectionId", "employeeNo");

CREATE TABLE "dingtalk_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectionId" TEXT NOT NULL REFERENCES "dingtalk_robots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sessionId" TEXT REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "requestedBy" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL CHECK ("targetKind" IN ('group', 'direct')),
  "recipients" JSONB NOT NULL,
  "title" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'sending' CHECK ("status" IN ('sending', 'accepted', 'failed', 'unknown')),
  "remoteIds" JSONB NOT NULL DEFAULT '[]',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "dingtalk_messages_sessionId_createdAt_idx" ON "dingtalk_messages"("sessionId", "createdAt");
