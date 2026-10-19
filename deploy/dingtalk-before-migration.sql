WITH robots AS (
  SELECT concat($$notification-$$, "id") AS id,
    CASE WHEN "scope" = $$global$$ THEN $$默认钉钉机器人$$ ELSE concat("scope", $$钉钉机器人$$) END AS name,
    "dingtalkWebhookUrl" AS "webhookUrl", "dingtalkSecret" AS secret, "dingtalkEnabled" AS enabled,
    "createdAt", "updatedAt"
  FROM notification_settings WHERE nullif(btrim("dingtalkWebhookUrl"), $$$$) IS NOT NULL
  UNION ALL
  SELECT concat($$repository-$$, "id"), concat("name", $$钉钉机器人$$),
    "dingtalkWebhook", "dingtalkSecret", true, "createdAt", "updatedAt"
  FROM repositories WHERE nullif(btrim("dingtalkWebhook"), $$$$) IS NOT NULL
), global_robot AS (
  SELECT concat($$notification-$$, "id") AS id FROM notification_settings
  WHERE "scope" = $$global$$ AND nullif(btrim("dingtalkWebhookUrl"), $$$$) IS NOT NULL
), normalized AS (
  SELECT $$gitlab$$ AS category, id, to_jsonb(t) AS data FROM gitlab_accounts t
  UNION ALL SELECT $$models$$, id, to_jsonb(t) FROM ai_models t
  UNION ALL SELECT $$robots$$, id, to_jsonb(t) FROM robots t
  UNION ALL
  SELECT $$repositories$$, id, (to_jsonb(t) - ARRAY[$$dingtalkWebhook$$,$$dingtalkSecret$$,$$memory$$,$$ocrConcurrency$$,$$ocrTimeoutMinutes$$,$$ocrMaxTokensBudget$$])
    || jsonb_build_object($$dingtalkRobotId$$, CASE WHEN nullif(btrim("dingtalkWebhook"), $$$$) IS NOT NULL
      THEN concat($$repository-$$, id) ELSE (SELECT id FROM global_robot) END)
  FROM repositories t
  UNION ALL
  SELECT $$rss$$, id, (to_jsonb(t) - ARRAY[$$lastFetchedAt$$,$$lastError$$,$$updatedAt$$])
    || jsonb_build_object($$dingtalkRobotId$$, (SELECT id FROM global_robot)) FROM rss_subscriptions t
)
SELECT category, count(*), md5(jsonb_agg(data ORDER BY id)::text)
FROM normalized GROUP BY category ORDER BY category;
