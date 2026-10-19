SELECT $$gitlab$$ AS configuration, COUNT(*) AS records,
  md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), $$[]$$::jsonb)::text) AS fingerprint FROM gitlab_accounts t
UNION ALL
SELECT $$models$$, COUNT(*), md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), $$[]$$::jsonb)::text) FROM ai_models t
UNION ALL
SELECT $$repositories$$, COUNT(*), md5(COALESCE(jsonb_agg(to_jsonb(t) - ARRAY[$$memory$$,$$ocrConcurrency$$,$$ocrTimeoutMinutes$$,$$ocrMaxTokensBudget$$] ORDER BY id), $$[]$$::jsonb)::text) FROM repositories t
UNION ALL
SELECT $$rss$$, COUNT(*), md5(COALESCE(jsonb_agg(to_jsonb(t) - ARRAY[$$lastFetchedAt$$,$$lastError$$,$$updatedAt$$] ORDER BY id), $$[]$$::jsonb)::text) FROM rss_subscriptions t
UNION ALL
SELECT $$robots$$, COUNT(*), md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), $$[]$$::jsonb)::text) FROM dingtalk_robots t;
