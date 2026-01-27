-- Module: agents
-- Purpose: membership table linking agents to roles (RBAC)

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

