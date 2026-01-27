-- Agents module safety migration
-- Ensures RBAC tables exist and exposes a singular compatibility view.

-- 1) Roles table
CREATE TABLE IF NOT EXISTS public.mod_agents_roles (
  id          SERIAL PRIMARY KEY,
  org_id      TEXT NULL,
  role        TEXT NOT NULL,
  description TEXT NULL,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_agents_roles UNIQUE (org_id, role)
);
CREATE INDEX IF NOT EXISTS idx_mod_agents_roles_org ON public.mod_agents_roles(org_id);

-- 2) Memberships table (plural as canonical)
CREATE TABLE IF NOT EXISTS public.mod_agents_memberships (
  id         SERIAL PRIMARY KEY,
  org_id     TEXT NULL,
  agent_id   INT NOT NULL REFERENCES public.mod_agents_agents(id) ON DELETE CASCADE,
  role_id    INT NOT NULL REFERENCES public.mod_agents_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_agents_memberships UNIQUE (org_id, agent_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_mod_agents_memberships_org ON public.mod_agents_memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_mod_agents_memberships_agent ON public.mod_agents_memberships(agent_id);
CREATE INDEX IF NOT EXISTS idx_mod_agents_memberships_role ON public.mod_agents_memberships(role_id);

-- 3) Compatibility view: singular name for external expectations
DO $$
BEGIN
  IF to_regclass('public.mod_agents_membership') IS DISTINCT FROM 'public.mod_agents_membership'::regclass THEN
    BEGIN
      EXECUTE 'CREATE OR REPLACE VIEW public.mod_agents_membership AS SELECT * FROM public.mod_agents_memberships';
    EXCEPTION WHEN others THEN NULL; END;
  ELSE
    BEGIN
      EXECUTE 'CREATE OR REPLACE VIEW public.mod_agents_membership AS SELECT * FROM public.mod_agents_memberships';
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

