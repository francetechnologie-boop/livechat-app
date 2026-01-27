-- up
-- Persist SMS inbox/outbox for the Gateway module (idempotent, non-destructive)

CREATE TABLE IF NOT EXISTS public.mod_gateway_sms_messages (
  id BIGSERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  direction TEXT NOT NULL, -- 'in' | 'out'
  message_id TEXT NULL, -- stable id for status correlation (device/server)
  device_id TEXT NULL,
  subscription_id INTEGER NULL,
  sim_slot INTEGER NULL,
  from_msisdn TEXT NULL,
  to_msisdn TEXT NULL,
  body TEXT NULL,
  status TEXT NULL,
  error TEXT NULL,
  meta JSONB NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Optional uniqueness for message_id (multiple NULLs allowed)
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_gateway_sms_messages_message_id
  ON public.mod_gateway_sms_messages (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_messages_created_at
  ON public.mod_gateway_sms_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_messages_from
  ON public.mod_gateway_sms_messages (from_msisdn);
CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_messages_to
  ON public.mod_gateway_sms_messages (to_msisdn);
CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_messages_org
  ON public.mod_gateway_sms_messages (org_id);

-- Guarded foreign key to organizations(id)
DO $$ BEGIN
  IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
     WHERE n.nspname = 'public' AND t.relname = 'organizations'
       AND i.indisunique = TRUE
       AND array_length(i.indkey,1) = 1
       AND a.attname = 'id'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_gateway_sms_messages
        ADD CONSTRAINT fk_mod_gateway_sms_messages_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

-- down
-- Non-destructive: do not drop tables/columns to preserve message history.
