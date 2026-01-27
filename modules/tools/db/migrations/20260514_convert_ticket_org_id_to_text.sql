-- Convert ticket tables' org_id columns to TEXT so they can store string identifiers.
DO $$
BEGIN
  IF to_regclass('public.mod_tools_tickets') IS NOT NULL THEN
    -- Drop FK if present so type change succeeds.
    BEGIN
      ALTER TABLE public.mod_tools_tickets DROP CONSTRAINT IF EXISTS fk_mod_tools_tickets_org;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    DROP INDEX IF EXISTS uq_mod_tools_tickets_org_message;
    ALTER TABLE public.mod_tools_tickets
      ALTER COLUMN org_id TYPE TEXT USING org_id::text;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_tools_tickets_org_message
      ON mod_tools_tickets (COALESCE(org_id::text, '-1'), email_message_id);
  END IF;

  IF to_regclass('public.mod_tools_ticket_messages') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_tools_ticket_messages DROP CONSTRAINT IF EXISTS fk_mod_tools_ticket_messages_org;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
    ALTER TABLE public.mod_tools_ticket_messages
      ALTER COLUMN org_id TYPE TEXT USING org_id::text;
  END IF;
END $$;

-- Re-add the guarded foreign keys only when organizations.id is text-like.
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'organizations'
       AND column_name = 'id'
       AND data_type IN ('text', 'character varying')
  ) THEN
    BEGIN
      ALTER TABLE public.mod_tools_tickets
        ADD CONSTRAINT fk_mod_tools_tickets_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;

    BEGIN
      ALTER TABLE public.mod_tools_ticket_messages
        ADD CONSTRAINT fk_mod_tools_ticket_messages_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;
