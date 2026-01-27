-- up
-- Company Chat: tabs (profiles) + message sessions (org-scoped)

-- Tabs / Profiles
CREATE TABLE IF NOT EXISTS public.mod_company_chat_tabs (
  id TEXT PRIMARY KEY,
  org_id TEXT NULL,
  title TEXT NOT NULL DEFAULT 'New tab',
  prompt_config_id TEXT NULL,
  chatbot_ids JSONB NULL,
  model TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mod_company_chat_tabs_org_idx ON public.mod_company_chat_tabs(org_id);
CREATE INDEX IF NOT EXISTS mod_company_chat_tabs_enabled_idx ON public.mod_company_chat_tabs(enabled);

-- Messages (session-scoped; can be filtered by tab_id)
CREATE TABLE IF NOT EXISTS public.mod_company_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NULL,
  tab_id TEXT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_id TEXT NULL
);
CREATE INDEX IF NOT EXISTS mod_company_chat_messages_org_idx ON public.mod_company_chat_messages(org_id);
CREATE INDEX IF NOT EXISTS mod_company_chat_messages_session_idx ON public.mod_company_chat_messages(session_id);
CREATE INDEX IF NOT EXISTS mod_company_chat_messages_tab_idx ON public.mod_company_chat_messages(tab_id);

-- Small JSON config store (org-scoped)
CREATE TABLE IF NOT EXISTS public.mod_company_chat_config (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NULL,
  key TEXT NOT NULL,
  value JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mod_company_chat_config UNIQUE (org_id, key)
);
CREATE INDEX IF NOT EXISTS mod_company_chat_config_org_idx ON public.mod_company_chat_config(org_id);

-- Guarded org_id foreign keys (portable across environments)
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
      ALTER TABLE public.mod_company_chat_tabs
        ADD CONSTRAINT fk_mod_company_chat_tabs_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.mod_company_chat_messages
        ADD CONSTRAINT fk_mod_company_chat_messages_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.mod_company_chat_config
        ADD CONSTRAINT fk_mod_company_chat_config_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- down
-- Non-destructive: keep tables to preserve chat history/config.
