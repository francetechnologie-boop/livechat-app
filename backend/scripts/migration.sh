#!/usr/bin/env bash
set -euo pipefail

# Migration script to ensure DB schema for chatbot welcome messages

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Discover DATABASE_URL from env or backend .env
DBURL="${DATABASE_URL:-}"
if [ -z "$DBURL" ] && [ -f "$ROOT_DIR/.env" ]; then
  DBURL=$(grep -E '^DATABASE_URL=' "$ROOT_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"\|"$//g' -e "s/^'\|'$//g") || true
fi

log(){ printf '[migration] %s\n' "$*"; }

if command -v psql >/dev/null 2>&1 && [ -n "$DBURL" ]; then
  log "Applying SQL migrations via psql"
  psql "$DBURL" -v ON_ERROR_STOP=1 <<'SQL'
-- Ensure welcome_message table exists
CREATE TABLE IF NOT EXISTS public.welcome_message (
  id_message TEXT PRIMARY KEY,
  shop_name TEXT NOT NULL,
  lang_iso VARCHAR(16) NOT NULL,
  title TEXT,
  content TEXT,
  enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS welcome_message_shop_lang_unique ON public.welcome_message (shop_name, lang_iso);

-- Ensure chatbot_config association columns exist
ALTER TABLE public.chatbot_config
  ADD COLUMN IF NOT EXISTS welcome_message TEXT,
  ADD COLUMN IF NOT EXISTS welcome_message_id TEXT;

-- Recreate canonical unique index (harmless if already exists)
CREATE UNIQUE INDEX IF NOT EXISTS chatbot_config_shop_lang_unique ON public.chatbot_config (shop_name, lang_iso);
SQL
else
  log "psql not available or DATABASE_URL missing; falling back to Node migration scripts"
  if command -v node >/dev/null 2>&1; then
    (cd "$ROOT_DIR" && node scripts/ensure-columns.js) || true
    (cd "$ROOT_DIR" && node scripts/migrate-welcome-message-id.js) || true
  else
    log "Node not available; cannot run fallback migrations"
  fi
fi

log "Migration complete"

