WITH normalized AS (
  SELECT $$gitlab$$ AS category, id, to_jsonb(t) AS data FROM gitlab_accounts t
  UNION ALL SELECT $$models$$, id, to_jsonb(t) FROM ai_models t
  UNION ALL SELECT $$robots$$, id, to_jsonb(t) FROM dingtalk_robots t
  UNION ALL SELECT $$repositories$$, id, to_jsonb(t) - ARRAY[$$ocrConcurrency$$,$$ocrTimeoutMinutes$$,$$ocrMaxTokensBudget$$] FROM repositories t
  UNION ALL SELECT $$rss$$, id, to_jsonb(t) - ARRAY[$$lastFetchedAt$$,$$lastError$$,$$updatedAt$$] FROM rss_subscriptions t
)
SELECT category, count(*), md5(jsonb_agg(data ORDER BY id)::text)
FROM normalized GROUP BY category ORDER BY category;
