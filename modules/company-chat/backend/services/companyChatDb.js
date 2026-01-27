import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function safeJsonParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function normalizeId(raw) {
  const s = String(raw || '').trim();
  return s || null;
}

export function getChatLog(ctx = {}) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const defaultChatLogPath = path.resolve(__dirname, '../../../../backend/chat.log');
  if (typeof ctx.chatLog === 'function') return ctx.chatLog;
  return (event, payload) => {
    try {
      const line = JSON.stringify({ event, payload, ts: new Date().toISOString() });
      fs.appendFile(defaultChatLogPath, line + '\n', () => {});
    } catch {}
  };
}

export async function resolveDefaultOrgId(pool) {
  if (!pool) return null;
  try {
    let r = await pool.query('SELECT id FROM organizations ORDER BY id ASC LIMIT 1');
    if (!r.rowCount) {
      try { r = await pool.query("INSERT INTO organizations(name) VALUES('Default') RETURNING id"); } catch {}
    }
    if (r?.rowCount) return r.rows[0].id;
  } catch {}
  return null;
}

export async function pickOrgId(pool, req) {
  try {
    const raw = req?.headers?.['x-org-id'] ?? req?.query?.org_id ?? null;
    const s = normalizeId(raw);
    if (s) return s;
  } catch {}
  return await resolveDefaultOrgId(pool);
}

export async function ensureCompanyChatTables(pool) {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS public.mod_company_chat_tabs (
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
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.mod_company_chat_messages (
    id BIGSERIAL PRIMARY KEY,
    org_id TEXT NULL,
    tab_id TEXT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    response_id TEXT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.mod_company_chat_config (
    id BIGSERIAL PRIMARY KEY,
    org_id TEXT NULL,
    key TEXT NOT NULL,
    value JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // Environments may use TEXT org ids (e.g., "org_..."); keep this module portable.
  try { await pool.query(`ALTER TABLE public.mod_company_chat_tabs ALTER COLUMN org_id TYPE TEXT USING org_id::text`); } catch {}
  try { await pool.query(`ALTER TABLE public.mod_company_chat_messages ALTER COLUMN org_id TYPE TEXT USING org_id::text`); } catch {}
  try { await pool.query(`ALTER TABLE public.mod_company_chat_config ALTER COLUMN org_id TYPE TEXT USING org_id::text`); } catch {}
  try { await pool.query(`ALTER TABLE public.mod_company_chat_config ADD CONSTRAINT uq_mod_company_chat_config UNIQUE (org_id, key)`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS mod_company_chat_tabs_org_idx ON public.mod_company_chat_tabs(org_id)`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS mod_company_chat_messages_session_idx ON public.mod_company_chat_messages(session_id)`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS mod_company_chat_messages_tab_idx ON public.mod_company_chat_messages(tab_id)`); } catch {}
}

export function makeSessionId({ tabId } = {}) {
  const t = Date.now();
  const rand = Math.random().toString(16).slice(2, 10);
  const prefix = tabId ? `cc_${String(tabId).replace(/[^a-zA-Z0-9_-]/g, '_')}` : 'cc';
  return `${prefix}_${t}_${rand}`;
}

export async function getConfigValue(pool, orgId, key, fallback = null) {
  if (!pool) return fallback;
  await ensureCompanyChatTables(pool);
  const k = String(key || '').trim();
  if (!k) return fallback;
  const r = await pool.query(
    `SELECT value
       FROM public.mod_company_chat_config
      WHERE (($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id::text=$1::text))
        AND key=$2
      ORDER BY updated_at DESC
      LIMIT 1`,
    [orgId ?? null, k]
  );
  return r.rowCount ? (r.rows[0].value ?? fallback) : fallback;
}

export async function setConfigValue(pool, orgId, key, value) {
  if (!pool) return false;
  await ensureCompanyChatTables(pool);
  const k = String(key || '').trim();
  if (!k) return false;
  await pool.query(
    `INSERT INTO public.mod_company_chat_config (org_id, key, value, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (org_id, key)
     DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [orgId ?? null, k, value ?? null]
  );
  return true;
}

export async function listTabs(pool, orgId, { includeDisabled = false } = {}) {
  if (!pool) return [];
  await ensureCompanyChatTables(pool);
  const r = await pool.query(
    `SELECT id, title, prompt_config_id, chatbot_ids, model, enabled, position, created_at, updated_at
       FROM public.mod_company_chat_tabs
      WHERE (($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id::text=$1::text))
        AND ($2::boolean = TRUE OR enabled = TRUE)
      ORDER BY position ASC, updated_at DESC`,
    [orgId ?? null, !!includeDisabled]
  );
  return (r.rows || []).map((row) => ({
    id: String(row.id),
    title: String(row.title || ''),
    prompt_config_id: row.prompt_config_id ? String(row.prompt_config_id) : '',
    chatbot_ids: Array.isArray(row.chatbot_ids) ? row.chatbot_ids.map(String) : [],
    model: row.model ? String(row.model) : '',
    enabled: row.enabled !== false,
    position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }));
}

export async function createTab(pool, orgId, { title, prompt_config_id, chatbot_ids, model } = {}) {
  if (!pool) throw new Error('db_unavailable');
  await ensureCompanyChatTables(pool);
  const id = `tab_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const t = String(title || 'New tab').trim() || 'New tab';
  const pid = String(prompt_config_id || '').trim() || null;
  const arr = Array.isArray(chatbot_ids) ? chatbot_ids.map(String) : null;
  const m = String(model || '').trim() || null;
  await pool.query(
    `INSERT INTO public.mod_company_chat_tabs (id, org_id, title, prompt_config_id, chatbot_ids, model, enabled, position, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, 0, NOW(), NOW())`,
    [id, orgId ?? null, t, pid, arr ? JSON.stringify(arr) : null, m]
  );
  return id;
}

export async function updateTab(pool, orgId, id, patch = {}) {
  if (!pool) throw new Error('db_unavailable');
  await ensureCompanyChatTables(pool);
  const tabId = String(id || '').trim();
  if (!tabId) throw new Error('bad_request');
  const sets = [];
  const values = [];
  const add = (col, val) => { sets.push(`${col}=$${sets.length + 1}`); values.push(val); };
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) add('title', String(patch.title || 'New tab').trim() || 'New tab');
  if (Object.prototype.hasOwnProperty.call(patch, 'prompt_config_id')) {
    const pid = String(patch.prompt_config_id || '').trim();
    add('prompt_config_id', pid || null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'chatbot_ids')) {
    const arr = Array.isArray(patch.chatbot_ids) ? patch.chatbot_ids.map(String) : [];
    add('chatbot_ids', JSON.stringify(arr));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
    const m = String(patch.model || '').trim();
    add('model', m || null);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) add('enabled', patch.enabled !== false);
  if (Object.prototype.hasOwnProperty.call(patch, 'position')) add('position', Number(patch.position || 0) || 0);
  if (!sets.length) return false;
  values.push(orgId ?? null);
  values.push(tabId);
  await pool.query(
    `UPDATE public.mod_company_chat_tabs
        SET ${sets.join(', ')}, updated_at=NOW()
      WHERE (($${values.length - 1}::text IS NULL AND org_id IS NULL) OR ($${values.length - 1}::text IS NOT NULL AND org_id::text=$${values.length - 1}::text))
        AND id=$${values.length}`,
    values
  );
  return true;
}

export async function deleteTab(pool, orgId, id) {
  if (!pool) throw new Error('db_unavailable');
  await ensureCompanyChatTables(pool);
  const tabId = String(id || '').trim();
  if (!tabId) throw new Error('bad_request');
  const r = await pool.query(
    `DELETE FROM public.mod_company_chat_tabs
      WHERE (($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id::text=$1::text))
        AND id=$2`,
    [orgId ?? null, tabId]
  );
  return r.rowCount || 0;
}

export async function getTab(pool, orgId, id) {
  if (!pool) return null;
  await ensureCompanyChatTables(pool);
  const tabId = String(id || '').trim();
  if (!tabId) return null;
  const r = await pool.query(
    `SELECT id, title, prompt_config_id, chatbot_ids, model, enabled, position, created_at, updated_at
       FROM public.mod_company_chat_tabs
      WHERE (($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id::text=$1::text))
        AND id=$2
      LIMIT 1`,
    [orgId ?? null, tabId]
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return {
    id: String(row.id),
    title: String(row.title || ''),
    prompt_config_id: row.prompt_config_id ? String(row.prompt_config_id) : '',
    chatbot_ids: Array.isArray(row.chatbot_ids) ? row.chatbot_ids.map(String) : [],
    model: row.model ? String(row.model) : '',
    enabled: row.enabled !== false,
    position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export async function appendMessage(pool, orgId, { tabId, sessionId, role, content, responseId } = {}) {
  if (!pool) return false;
  await ensureCompanyChatTables(pool);
  const sid = String(sessionId || '').trim();
  const r = String(role || '').trim();
  const c = String(content || '');
  if (!sid || !r) return false;
  await pool.query(
    `INSERT INTO public.mod_company_chat_messages (org_id, tab_id, session_id, role, content, response_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [orgId ?? null, tabId ? String(tabId) : null, sid, r, c, responseId ? String(responseId) : null]
  );
  return true;
}

export async function listSessions(pool, orgId, { tabId, limit = 10 } = {}) {
  if (!pool) return [];
  await ensureCompanyChatTables(pool);
  const lim = Math.max(1, Math.min(100, Number(limit || 10)));
  const r = await pool.query(
    `SELECT session_id,
            MIN(created_at) AS first_seen,
            MAX(created_at) AS last_seen,
            COUNT(*)::int AS message_count
       FROM public.mod_company_chat_messages
      WHERE (($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id::text=$1::text))
        AND ($2::text IS NULL OR tab_id=$2::text)
      GROUP BY session_id
      ORDER BY last_seen DESC
      LIMIT $3`,
    [orgId ?? null, tabId ? String(tabId) : null, lim]
  );
  return r.rows || [];
}

export async function getSessionMessages(pool, orgId, sessionId) {
  if (!pool) return [];
  await ensureCompanyChatTables(pool);
  const sid = String(sessionId || '').trim();
  if (!sid) return [];
  const r = await pool.query(
    `SELECT role, content, created_at, response_id
       FROM public.mod_company_chat_messages
      WHERE (($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id::text=$1::text))
        AND session_id=$2
      ORDER BY created_at ASC
      LIMIT 1000`,
    [orgId ?? null, sid]
  );
  return r.rows || [];
}

export async function deleteSession(pool, orgId, sessionId) {
  if (!pool) throw new Error('db_unavailable');
  await ensureCompanyChatTables(pool);
  const sid = String(sessionId || '').trim();
  if (!sid) throw new Error('bad_request');
  const r = await pool.query(
    `DELETE FROM public.mod_company_chat_messages
      WHERE (($1::text IS NULL AND org_id IS NULL) OR ($1::text IS NOT NULL AND org_id::text=$1::text))
        AND session_id=$2`,
    [orgId ?? null, sid]
  );
  return r.rowCount || 0;
}

export async function listChatbots(pool, orgId) {
  if (!pool) return [];
  // automation-suite table (if installed)
  const has = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mod_automation_suite_chatbots' LIMIT 1`).catch(() => null);
  if (!has?.rowCount) return [];
  const r = await pool.query(
    `SELECT id_bot, org_id, name, shop_name, lang_iso, enabled,
            bot_behavior, instructions, prompt_id, prompt_version,
            mcp_enabled, mcp_tools, local_prompt_id, prompt_config_id, mcp_server_name, web_search_enabled,
            (COALESCE(openai_api_key,'') <> '') AS has_api_key
       FROM public.mod_automation_suite_chatbots
      WHERE ($1::text IS NULL) OR (org_id IS NULL OR org_id::text=$1::text)
      ORDER BY updated_at DESC, created_at DESC`,
    [orgId ?? null]
  );
  return r.rows || [];
}

export async function getChatbotsByIds(pool, orgId, ids) {
  if (!pool) return [];
  const list = Array.isArray(ids) ? ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (!list.length) return [];
  const has = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mod_automation_suite_chatbots' LIMIT 1`).catch(() => null);
  if (!has?.rowCount) return [];
  const r = await pool.query(
    `SELECT id_bot, org_id, name, shop_name, lang_iso, enabled,
            bot_behavior, instructions, openai_api_key, prompt_id, prompt_version,
            mcp_enabled, mcp_tools, local_prompt_id, prompt_config_id, mcp_server_name, web_search_enabled,
            (COALESCE(openai_api_key,'') <> '') AS has_api_key
       FROM public.mod_automation_suite_chatbots
      WHERE id_bot = ANY($2::text[])
        AND (($1::text IS NULL) OR (org_id IS NULL OR org_id::text=$1::text))
      ORDER BY updated_at DESC, created_at DESC`,
    [orgId ?? null, list]
  );
  return r.rows || [];
}

export async function listPromptMcp2Servers(pool, promptConfigIds) {
  if (!pool) return [];
  const ids = Array.isArray(promptConfigIds) ? promptConfigIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (!ids.length) return [];
  const hasLink = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mod_automation_suite_prompt_mcp2' LIMIT 1`).catch(() => null);
  if (!hasLink?.rowCount) return [];
  const hasServers = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mod_mcp2_server' LIMIT 1`).catch(() => null);
  if (!hasServers?.rowCount) return [];
  const r = await pool.query(
    `SELECT x.prompt_config_id,
            s.id, s.name, s.stream_url, s.sse_url, s.token, s.options, COALESCE(s.enabled,false) AS enabled
       FROM public.mod_automation_suite_prompt_mcp2 x
       JOIN public.mod_mcp2_server s ON s.id = x.mcp2_server_id
      WHERE x.prompt_config_id = ANY($1::text[])
      ORDER BY s.updated_at DESC NULLS LAST`,
    [ids]
  );
  return r.rows || [];
}

export async function listPromptConfigs(pool, orgId, { limit = 200 } = {}) {
  if (!pool) return [];
  const has = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mod_automation_suite_prompt_config' LIMIT 1`).catch(() => null);
  if (!has?.rowCount) return [];
  const lim = Math.max(1, Math.min(500, Number(limit || 200)));
  const r = await pool.query(
    `SELECT id, org_id, name, model, updated_at,
            (COALESCE(openai_api_key,'') <> '') AS has_api_key
       FROM public.mod_automation_suite_prompt_config
      WHERE ($1::text IS NULL) OR (org_id IS NULL OR org_id::text=$1::text)
      ORDER BY updated_at DESC, created_at DESC
      LIMIT $2`,
    [orgId ?? null, lim]
  );
  return r.rows || [];
}

export async function getPromptConfig(pool, orgId, id) {
  if (!pool) return null;
  const pid = String(id || '').trim();
  if (!pid) return null;
  const has = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mod_automation_suite_prompt_config' LIMIT 1`).catch(() => null);
  if (!has?.rowCount) return null;
  const r = await pool.query(
    `SELECT *
       FROM public.mod_automation_suite_prompt_config
      WHERE id=$2
        AND (($1::text IS NULL) OR (org_id IS NULL OR org_id::text=$1::text))
      LIMIT 1`,
    [orgId ?? null, pid]
  );
  return r.rowCount ? r.rows[0] : null;
}

export function normalizeTools(tools) {
  if (!tools) return {};
  if (typeof tools === 'string') return safeJsonParse(tools, {});
  if (typeof tools === 'object') return tools;
  return {};
}
