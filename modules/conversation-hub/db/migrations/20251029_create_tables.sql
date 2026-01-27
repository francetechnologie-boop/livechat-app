-- Conversation Hub minimal tables (idempotent)
-- Prefix: mod_conversation_hub_*

CREATE TABLE IF NOT EXISTS mod_conversation_hub_config (
  id SERIAL PRIMARY KEY,
  org_id INT NULL,
  key TEXT NOT NULL,
  value JSONB NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_conversation_hub_config UNIQUE (org_id, key)
);
-- Adaptive FK based on organizations.id type
DO $$
DECLARE
  org_id_type TEXT;
BEGIN
  SELECT data_type INTO org_id_type
    FROM information_schema.columns
   WHERE table_name='organizations' AND column_name='id'
   LIMIT 1;
  IF org_id_type ILIKE 'integer' OR org_id_type ILIKE 'bigint' THEN
    BEGIN
      ALTER TABLE mod_conversation_hub_config
        ADD CONSTRAINT fk_mod_conversation_hub_config_org
        FOREIGN KEY (org_id) REFERENCES organizations(id)
        ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN others THEN NULL; END;
  ELSIF org_id_type ILIKE 'text' OR org_id_type ILIKE 'character varying' THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name='mod_conversation_hub_config' AND column_name='org_id_text'
    ) THEN
      BEGIN
        ALTER TABLE mod_conversation_hub_config ADD COLUMN org_id_text TEXT NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; WHEN others THEN NULL; END;
    END IF;
    BEGIN
      ALTER TABLE mod_conversation_hub_config
        ADD CONSTRAINT fk_mod_conversation_hub_config_org_text
        FOREIGN KEY (org_id_text) REFERENCES organizations(id)
        ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;
