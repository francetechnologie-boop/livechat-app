-- up
-- Ensure expected schema index exists for Module Manager schema checks.
-- Some environments created mod_automation_suite_config without this secondary index.
-- Europe/Prague date: 2026-01-08
CREATE INDEX IF NOT EXISTS mod_as_config_org_idx ON mod_automation_suite_config(org_id);

-- down
DROP INDEX IF EXISTS mod_as_config_org_idx;
