-- Module: agents
-- Purpose: per-agent preferences table (JSONB), org-scoped
-- Idempotent creation; safe to run multiple times

CREATE TABLE IF NOT EXISTS public.mod_agents_preferences (
  id           SERIAL PRIMARY KEY,
  org_id       TEXT NULL,
  agent_id     INT NOT NULL REFERENCES public.mod_agents_agents(id) ON DELETE CASCADE,
  preferences  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

-- Unique per agent (global); if you require multi-org duplication, switch to (org_id, agent_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_agents_prefs_agent ON public.mod_agents_preferences(agent_id);
CREATE INDEX IF NOT EXISTS idx_mod_agents_prefs_org ON public.mod_agents_preferences(org_id);
