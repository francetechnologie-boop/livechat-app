-- Module: agents
-- Purpose: roles table for RBAC

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

