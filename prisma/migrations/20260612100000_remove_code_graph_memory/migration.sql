-- Remove the deprecated Code Graph / Memory domain.
DELETE FROM "review_workflow_nodes"
WHERE "kind" = 'memory' OR "nodeKey" = 'refresh_memory';

DROP TABLE IF EXISTS "code_relation_edges";
DROP TABLE IF EXISTS "code_symbol_nodes";
DROP TABLE IF EXISTS "code_file_nodes";
DROP TABLE IF EXISTS "repository_memory_facts";
DROP TABLE IF EXISTS "repository_memory_snapshots";
