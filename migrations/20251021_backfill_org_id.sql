-- up
-- Backfill org_id for existing rows to the default organization
-- Chooses the first organization id (smallest id) as the default.

WITH def AS (
  SELECT id FROM organizations ORDER BY id ASC LIMIT 1
)
UPDATE messages SET org_id = (SELECT id FROM def) WHERE org_id IS NULL;

WITH def AS (
  SELECT id FROM organizations ORDER BY id ASC LIMIT 1
)
UPDATE visitors SET org_id = (SELECT id FROM def) WHERE org_id IS NULL;

WITH def AS (
  SELECT id FROM organizations ORDER BY id ASC LIMIT 1
)
UPDATE visits SET org_id = (SELECT id FROM def) WHERE org_id IS NULL;

WITH def AS (
  SELECT id FROM organizations ORDER BY id ASC LIMIT 1
)
UPDATE agents SET org_id = (SELECT id FROM def) WHERE org_id IS NULL;

WITH def AS (
  SELECT id FROM organizations ORDER BY id ASC LIMIT 1
)
UPDATE auto_messages SET org_id = (SELECT id FROM def) WHERE org_id IS NULL;

WITH def AS (
  SELECT id FROM organizations ORDER BY id ASC LIMIT 1
)
UPDATE prompt_config SET org_id = (SELECT id FROM def) WHERE org_id IS NULL;

WITH def AS (
  SELECT id FROM organizations ORDER BY id ASC LIMIT 1
)
UPDATE local_prompt SET org_id = (SELECT id FROM def) WHERE org_id IS NULL;

WITH def AS (
  SELECT id FROM organizations ORDER BY id ASC LIMIT 1
)
UPDATE mcp_server_config SET org_id = (SELECT id FROM def) WHERE org_id IS NULL;

-- down
-- No-op (non-destructive; do not clear org_id values)

