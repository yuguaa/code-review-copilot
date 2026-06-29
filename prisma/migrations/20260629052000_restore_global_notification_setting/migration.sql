-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "dingtalkWebhookUrl" TEXT,
    "dingtalkSecret" TEXT,
    "dingtalkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_scope_key" ON "notification_settings"("scope");

-- AlterDefault
ALTER TABLE "repositories" ALTER COLUMN "enableMrComment" SET DEFAULT false;
ALTER TABLE "repositories" ALTER COLUMN "enableDingtalk" SET DEFAULT true;
