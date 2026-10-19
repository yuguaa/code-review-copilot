BEGIN;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM "notification_settings" WHERE nullif(btrim("dingtalkSecret"), $$$$) IS NOT NULL
    AND nullif(btrim("dingtalkWebhookUrl"), $$$$) IS NULL)
    OR EXISTS (SELECT 1 FROM "repositories" WHERE nullif(btrim("dingtalkSecret"), $$$$) IS NOT NULL
    AND nullif(btrim("dingtalkWebhook"), $$$$) IS NULL) THEN
    RAISE EXCEPTION USING MESSAGE = $$钉钉 Secret 缺少对应 Webhook，请补全配置后执行迁移$$;
  END IF;
END
$migration$;

CREATE TABLE "dingtalk_robots" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "webhookUrl" TEXT NOT NULL,
  "secret" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "repositories" ADD COLUMN "dingtalkRobotId" TEXT;
ALTER TABLE "rss_subscriptions" ADD COLUMN "dingtalkRobotId" TEXT;

/* 保留已有机器人的凭证和启用状态，并明确建立通知目标。 */
INSERT INTO "dingtalk_robots" ("id", "name", "webhookUrl", "secret", "enabled", "createdAt", "updatedAt")
SELECT concat($$notification-$$, "id"),
  CASE WHEN "scope" = $$global$$ THEN $$默认钉钉机器人$$ ELSE concat("scope", $$钉钉机器人$$) END,
  "dingtalkWebhookUrl", "dingtalkSecret", "dingtalkEnabled", "createdAt", "updatedAt"
FROM "notification_settings"
WHERE "dingtalkWebhookUrl" IS NOT NULL AND btrim("dingtalkWebhookUrl") <> $$$$;

INSERT INTO "dingtalk_robots" ("id", "name", "webhookUrl", "secret", "enabled", "createdAt", "updatedAt")
SELECT concat($$repository-$$, "id"), concat("name", $$钉钉机器人$$),
  "dingtalkWebhook", "dingtalkSecret", true, "createdAt", "updatedAt"
FROM "repositories"
WHERE "dingtalkWebhook" IS NOT NULL AND btrim("dingtalkWebhook") <> $$$$;

UPDATE "repositories" AS repository SET "dingtalkRobotId" =
  CASE WHEN repository."dingtalkWebhook" IS NOT NULL AND btrim(repository."dingtalkWebhook") <> $$$$
    THEN concat($$repository-$$, repository."id")
    ELSE (SELECT concat($$notification-$$, setting."id") FROM "notification_settings" setting
      JOIN "dingtalk_robots" robot ON robot."id" = concat($$notification-$$, setting."id")
      WHERE setting."scope" = $$global$$)
  END;

UPDATE "rss_subscriptions" SET "dingtalkRobotId" = (
  SELECT concat($$notification-$$, setting."id") FROM "notification_settings" setting
  JOIN "dingtalk_robots" robot ON robot."id" = concat($$notification-$$, setting."id")
  WHERE setting."scope" = $$global$$
);

ALTER TABLE "repositories" ALTER COLUMN "enableDingtalk" SET DEFAULT false;
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_dingtalkRobotId_fkey"
  FOREIGN KEY ("dingtalkRobotId") REFERENCES "dingtalk_robots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rss_subscriptions" ADD CONSTRAINT "rss_subscriptions_dingtalkRobotId_fkey"
  FOREIGN KEY ("dingtalkRobotId") REFERENCES "dingtalk_robots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "repositories" DROP COLUMN "dingtalkWebhook", DROP COLUMN "dingtalkSecret";
DROP TABLE "notification_settings";

COMMIT;
