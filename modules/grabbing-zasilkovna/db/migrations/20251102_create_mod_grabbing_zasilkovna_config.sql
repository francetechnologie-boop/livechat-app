-- Module-specific configuration table for Zásilkovna (Packeta)
-- Naming follows convention: mod_<module_id_snake>_<name>
-- module_id_snake = grabbing_zasilkovna

CREATE TABLE IF NOT EXISTS mod_grabbing_zasilkovna_config (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target TEXT,
  options JSONB,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_config_name_uq ON mod_grabbing_zasilkovna_config (name);

