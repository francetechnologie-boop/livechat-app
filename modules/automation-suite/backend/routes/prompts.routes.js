// OpenAI Prompts admin endpoints for Automation Suite (module-scoped)
// Namespaced under /api/automation-suite/* and guarded by requireAdmin

import { respondWithPrompt } from '../../../../backend/lib/openaiResponses.js';

function normalizeOpenAIBase(raw) {
  try {
    let b = (raw && String(raw).trim()) || '';
    if (!b) return 'https://api.openai.com/v1';
    if (!/^https?:\/\//i.test(b)) return 'https://api.openai.com/v1';
    try {
      const u = new URL(b);
      if (!u.pathname || u.pathname === '/' || u.pathname === '') {
        u.pathname = '/v1';
        b = u.toString().replace(/\/$/, '');
      }
    } catch { return 'https://api.openai.com/v1'; }
    return b.replace(/\/$/, '');
  } catch { return 'https://api.openai.com/v1'; }
}

function buildOpenAIHeaders(apiKey, { organization, project } = {}) {
  const h = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (organization) h['OpenAI-Organization'] = String(organization);
  if (project) h['OpenAI-Project'] = String(project);
  return h;
}

async function openaiHttp(path, { method = 'GET', body, apiKey, organization, project, baseURL, extraHeaders } = {}, ctx = {}) {
  const key = (apiKey && String(apiKey).trim()) || (ctx?.extras?.getOpenaiApiKey?.() || process.env.OPENAI_API_KEY || '');
  if (!key) {
    const err = new Error('openai_key_missing');
    err.status = 400;
    throw err;
  }
  const base = normalizeOpenAIBase(baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers = { ...buildOpenAIHeaders(key, { organization, project }), ...(extraHeaders || {}) };
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  // Add a timeout so upstream hangs don't stall module calls forever
  const timeoutMs = Math.max(1000, Number(process.env.OPENAI_HTTP_TIMEOUT_MS || 30000));
  const ac = new AbortController();
  const timer = setTimeout(() => { try { ac.abort(); } catch {} }, timeoutMs);
  let r;
  try {
    r = await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e && (e.name === 'AbortError' || String(e.message||'').toLowerCase().includes('abort')));
    const err = new Error(aborted ? 'upstream_timeout' : (e?.message || 'upstream_fetch_failed'));
    err.status = aborted ? 504 : 502;
    throw err;
  }
  clearTimeout(timer);
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const msg = json?.error?.message || json?.message || text || `http_${r.status}`;
    const e = new Error(String(msg));
    e.status = r.status;
    e.details = json || text;
    throw e;
  }
  return json;
}

async function openaiPromptCreate(body, opts, ctx) {
  try { return await openaiHttp('/prompts', { method: 'POST', body, extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx); }
  catch (e) {
    if (e?.status === 404) return await openaiHttp('/chat/prompts', { method: 'POST', body, extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx);
    throw e;
  }
}
async function openaiPromptRetrieve(id, opts, ctx) {
  try { return await openaiHttp(`/prompts/${encodeURIComponent(id)}`, { method: 'GET', extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx); }
  catch (e) {
    if (e?.status === 404) return await openaiHttp(`/chat/prompts/${encodeURIComponent(id)}`, { method: 'GET', extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx);
    throw e;
  }
}
async function openaiPromptListVersions(id, opts, ctx) {
  try { return await openaiHttp(`/prompts/${encodeURIComponent(id)}/versions`, { method: 'GET', extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx); }
  catch (e) {
    if (e?.status === 404) return await openaiHttp(`/chat/prompts/${encodeURIComponent(id)}/versions`, { method: 'GET', extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx);
    throw e;
  }
}
async function openaiPromptCreateVersion(id, body, opts, ctx) {
  try { return await openaiHttp(`/prompts/${encodeURIComponent(id)}/versions`, { method: 'POST', body, extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx); }
  catch (e) {
    if (e?.status === 404) return await openaiHttp(`/chat/prompts/${encodeURIComponent(id)}/versions`, { method: 'POST', body, extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx);
    throw e;
  }
}
async function openaiPromptPatch(id, body, opts, ctx) {
  try { return await openaiHttp(`/prompts/${encodeURIComponent(id)}`, { method: 'PATCH', body, extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx); }
  catch (e) {
    if (e?.status === 404) return await openaiHttp(`/chat/prompts/${encodeURIComponent(id)}`, { method: 'PATCH', body, extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx);
    throw e;
  }
}
async function openaiPromptList(query = {}, opts, ctx) {
  const q = new URLSearchParams();
  if (query && query.limit) q.set('limit', String(query.limit));
  if (query && query.after) q.set('after', String(query.after));
  const qs = q.toString();
  const path = `/prompts${qs ? `?${qs}` : ''}`;
  const alt = `/chat/prompts${qs ? `?${qs}` : ''}`;
  try { return await openaiHttp(path, { method: 'GET', extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx); }
  catch (e) {
    if (e?.status === 404) return await openaiHttp(alt, { method: 'GET', extraHeaders: { 'OpenAI-Beta': 'prompts=v1' }, ...(opts || {}) }, ctx);
    throw e;
  }
}

export function registerAutomationSuitePromptsRoutes(app, ctx = {}) {
  const requireAdmin = ctx?.requireAdmin;
  const pool = ctx?.pool;
  const isDbUnavailable = (e) => {
    try { return (e?.message || String(e)) === 'db_unavailable'; } catch { return false; }
  };

  function sanitizeServerLabel(raw, fallback = 'mcp') {
    try {
      let s = String(raw || '').trim();
      s = s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
      if (!s) s = fallback;
      if (!/^[A-Za-z]/.test(s)) s = `mcp_${s}`;
      return s.slice(0, 64);
    } catch {
      return 'mcp';
    }
  }

  function uniqueServerLabel(raw, used) {
    const base = sanitizeServerLabel(raw || 'mcp');
    if (!used.has(base)) { used.add(base); return base; }
    for (let i = 2; i < 1000; i += 1) {
      const next = `${base}_${i}`;
      if (!used.has(next)) { used.add(next); return next; }
    }
    return `${base}_${Date.now().toString(36)}`;
  }

  function normalizeMessages(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const m of arr) {
      const role = String(m?.role || '').trim() || 'user';
      const content = String(m?.content ?? m?.text ?? '');
      if (!content.trim()) continue;
      out.push({ role, content });
    }
    return out;
  }

  function redactMcpToolsInRequestBody(body) {
    try {
      const clone = body ? JSON.parse(JSON.stringify(body)) : {};
      const tools = Array.isArray(clone?.tools) ? clone.tools : [];
      for (const t of tools) {
        if (!t || t.type !== 'mcp') continue;
        if (t.authorization) t.authorization = '****';
        if (typeof t.server_url === 'string' && t.server_url) {
          try {
            const u = new URL(t.server_url);
            if (u.searchParams.has('token')) u.searchParams.set('token', '****');
            t.server_url = u.toString();
          } catch {}
        }
      }
      return clone;
    } catch {
      return body;
    }
  }

  // List prompts (admin)
  app.get('/api/automation-suite/prompts', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const q = req.query || {};
      const limit = Math.max(1, Math.min(200, Number(q.limit || 50)));
      const after = q.after ? String(q.after) : undefined;
      const json = await openaiPromptList({ limit, after }, {}, ctx);
      const items = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.items) ? json.items : (Array.isArray(json) ? json : []));
      const out = { ok: true, items };
      if (Object.prototype.hasOwnProperty.call(json || {}, 'has_more')) out.has_more = !!json.has_more;
      if (Object.prototype.hasOwnProperty.call(json || {}, 'last_id')) out.next_after = json.last_id;
      return res.json(out);
    } catch (e) {
      return res.status(e?.status || 500).json({ ok: false, error: 'openai_error', message: e?.message || String(e), details: e?.details || undefined });
    }
  });

  // Create prompt
  app.post('/api/automation-suite/prompts', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim() || undefined;
      const instructions = String(b.instructions || b.definition || '').trim();
      const messages = Array.isArray(b.messages) ? b.messages : undefined;
      const model = (b.model && String(b.model).trim()) || undefined;
      const description = String(b.description || '').trim() || undefined;
      const metadata = (typeof b.metadata === 'object' && b.metadata) || undefined;
      if (!instructions && !messages) return res.status(400).json({ ok: false, error: 'bad_request', message: 'instructions or messages required' });
      const body = {};
      if (instructions) body.instructions = instructions;
      if (messages) body.messages = messages;
      if (model) body.model = model;
      if (name) body.name = name;
      if (description) body.description = description;
      if (metadata) body.metadata = metadata;
      const json = await openaiPromptCreate(body, {}, ctx);
      return res.json({ ok: true, prompt: json });
    } catch (e) {
      return res.status(e?.status || 500).json({ ok: false, error: 'openai_error', message: e?.message || String(e), details: e?.details || undefined });
    }
  });

  // Retrieve prompt
  app.get('/api/automation-suite/prompts/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const json = await openaiPromptRetrieve(id, {}, ctx);
      return res.json({ ok: true, prompt: json });
    } catch (e) {
      return res.status(e?.status || 500).json({ ok: false, error: 'openai_error', message: e?.message || String(e), details: e?.details || undefined });
    }
  });

  // List prompt versions
  app.get('/api/automation-suite/prompts/:id/versions', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const json = await openaiPromptListVersions(id, {}, ctx);
      return res.json({ ok: true, versions: json });
    } catch (e) {
      return res.status(e?.status || 500).json({ ok: false, error: 'openai_error', message: e?.message || String(e), details: e?.details || undefined });
    }
  });

  // Create version
  app.post('/api/automation-suite/prompts/:id/versions', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const b = req.body || {};
      const instructions = String(b.instructions || b.definition || '').trim();
      const description = String(b.description || '').trim() || undefined;
      const metadata = (typeof b.metadata === 'object' && b.metadata) || undefined;
      if (!instructions) return res.status(400).json({ ok: false, error: 'bad_request', message: 'instructions required' });
      const body = { instructions };
      if (description) body.description = description;
      if (metadata) body.metadata = metadata;
      const json = await openaiPromptCreateVersion(id, body, {}, ctx);
      return res.json({ ok: true, version: json });
    } catch (e) {
      return res.status(e?.status || 500).json({ ok: false, error: 'openai_error', message: e?.message || String(e), details: e?.details || undefined });
    }
  });

  // Patch prompt
  app.patch('/api/automation-suite/prompts/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const b = req.body || {};
      const name = String(b.name || '').trim() || undefined;
      const description = String(b.description || '').trim() || undefined;
      const metadata = (typeof b.metadata === 'object' && b.metadata) || undefined;
      const body = {};
      if (name !== undefined) body.name = name;
      if (description !== undefined) body.description = description;
      if (metadata !== undefined) body.metadata = metadata;
      if (!Object.keys(body).length) return res.status(400).json({ ok: false, error: 'bad_request' });
      const json = await openaiPromptPatch(id, body, {}, ctx);
      return res.json({ ok: true, prompt: json });
    } catch (e) {
      return res.status(e?.status || 500).json({ ok: false, error: 'openai_error', message: e?.message || String(e), details: e?.details || undefined });
    }
  });

  // ---- Module prompt tables: list/query (admin) ----
  app.get('/api/automation-suite/prompt-configs', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const q = req.query || {};
      const limit = Math.max(1, Math.min(200, Number(q.limit || 50)));
      const org = q.org_id != null ? Number(q.org_id) : null;
      const sql = `SELECT id, org_id, name, dev_message, messages, tools, openai_api_key, prompt_id, prompt_version, model, vector_store_id, vector_store_ids, metadata, created_at, updated_at
                     FROM mod_automation_suite_prompt_config
                    WHERE ($1::int IS NULL AND org_id IS NULL) OR ($1::int IS NOT NULL AND org_id=$1::int)
                    ORDER BY updated_at DESC
                    LIMIT $2`;
      const r = await pool.query(sql, [Number.isFinite(org)? org: null, limit]);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) {
      if (isDbUnavailable(e)) return res.status(503).json({ ok:false, error:'db_unavailable' });
      return res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  app.get('/api/automation-suite/prompt-configs/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`SELECT * FROM mod_automation_suite_prompt_config WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) {
      if (isDbUnavailable(e)) return res.status(503).json({ ok:false, error:'db_unavailable' });
      return res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Create a new prompt_config row (module DB)
  app.post('/api/automation-suite/prompt-configs', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const b = req.body || {};
      let id = String(b.id || '').trim();
      if (!id) id = `pc_${Date.now()}`;
      const name = String(b.name || '').trim() || id;
      await pool.query(
        `INSERT INTO mod_automation_suite_prompt_config (id, name, created_at, updated_at)
         VALUES ($1,$2,NOW(),NOW())
         ON CONFLICT (id) DO NOTHING`, [id, name]
      );
      const r = await pool.query(`SELECT * FROM mod_automation_suite_prompt_config WHERE id=$1 LIMIT 1`, [id]);
      return res.status(201).json({ ok:true, item: r.rowCount ? r.rows[0] : { id, name } });
    } catch (e) {
      if (isDbUnavailable(e)) return res.status(503).json({ ok:false, error:'db_unavailable' });
      return res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // Patch an existing prompt_config row (module DB)
  app.patch('/api/automation-suite/prompt-configs/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const b = req.body || {};
      const allowed = ['name','dev_message','messages','tools','openai_api_key','prompt_id','prompt_version','model','vector_store_id','vector_store_ids','metadata'];
      const jsonbCols = new Set(['messages','tools','metadata']);
      const jsonCols = new Set(['vector_store_ids']);
      const sets = []; const vals = [];
      for (const k of allowed) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
        let placeholder = `$${vals.length+1}`;
        let v = b[k];
        if (jsonbCols.has(k)) {
          placeholder += '::jsonb';
          if (v != null && typeof v !== 'string') {
            try { v = JSON.stringify(v); } catch { v = null; }
          }
        } else if (jsonCols.has(k)) {
          placeholder += '::json';
          if (v != null && typeof v !== 'string') {
            try { v = JSON.stringify(v); } catch { v = null; }
          }
        }
        sets.push(`${k}=${placeholder}`);
        vals.push(v);
      }
      if (!sets.length) return res.status(400).json({ ok:false, error:'bad_request' });
      // Debug log: which fields are being saved (redact secrets)
      try {
        const mask = (v) => (v == null ? v : (typeof v === 'string' && v.length > 0 ? '****' : v));
        const changed = Object.keys(b).filter(k => allowed.includes(k));
        const preview = changed.reduce((acc, k) => { acc[k] = (k === 'openai_api_key') ? mask(b[k]) : (Array.isArray(b[k]) ? `[array:${b[k].length}]` : (typeof b[k] === 'object' && b[k] ? '{object}' : b[k])); return acc; }, {});
        ctx?.logToFile?.(`[automation-suite] save prompt_config ${id} keys=${changed.join(',')}; ${JSON.stringify(preview)}`);
      } catch {}
      vals.push(id);
      await pool.query(`UPDATE mod_automation_suite_prompt_config SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${vals.length}`, vals);
      const r = await pool.query(`SELECT * FROM mod_automation_suite_prompt_config WHERE id=$1 LIMIT 1`, [id]);
      return res.json({ ok:true, item: r.rowCount ? r.rows[0] : null });
    } catch (e) {
      try { ctx?.logToFile?.(`[automation-suite] save error for prompt_config ${String(req.params?.id||'')} -> ${e?.message || e}`); } catch {}
      if (isDbUnavailable(e)) return res.status(503).json({ ok:false, error:'db_unavailable' });
      return res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // List chatbots assigned to this prompt (by prompt_config_id)
  app.get('/api/automation-suite/prompt-configs/:id/chatbots', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`SELECT id_bot FROM mod_automation_suite_chatbots WHERE prompt_config_id=$1`, [id]);
      const chatbot_ids = (r.rows || []).map(x => String(x.id_bot));
      return res.json({ ok:true, chatbot_ids });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  app.get('/api/automation-suite/prompt-configs/:id/tests', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(
        `SELECT id, input, output, request, response, ms, created_at
           FROM mod_automation_suite_prompt_test_history
          WHERE prompt_config_id=$1
          ORDER BY created_at DESC
          LIMIT $2`,
        [id, limit]
      );
      return res.json({ ok:true, items: r.rows || [] });
    } catch { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  app.delete('/api/automation-suite/prompt-configs/:id/tests/:testId', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      const tid = String(req.params.testId || '').trim();
      if (!id || !tid) return res.status(400).json({ ok:false, error:'bad_request' });
      await pool.query(`DELETE FROM mod_automation_suite_prompt_test_history WHERE id=$1 AND prompt_config_id=$2`, [tid, id]);
      return res.json({ ok:true });
    } catch { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Assign chatbots to this prompt (by id_bot)
  app.post('/api/automation-suite/prompt-configs/:id/assign', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      const arr = Array.isArray(req.body?.chatbot_ids) ? req.body.chatbot_ids : [];
      if (!id || !arr.length) return res.json({ ok:true, updated: 0 });
      const inList = arr.map((v,i)=>`$${i+2}`).join(',');
      const vals = [id, ...arr];
      const sql = `UPDATE mod_automation_suite_chatbots SET prompt_config_id=$1, updated_at=NOW() WHERE id_bot IN (${inList})`;
      const r = await pool.query(sql, vals);
      return res.json({ ok:true, updated: r.rowCount|0 });
    } catch { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // ---- Vector store linking (stored on prompt_config row) ----
  // The UI expects to link/unlink existing OpenAI vector store IDs to a prompt config.
  // Storage: mod_automation_suite_prompt_config.vector_store_ids (JSON array of strings)
  app.get('/api/automation-suite/prompt-configs/:id/vector-store', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`SELECT vector_store_id, vector_store_ids, tools FROM mod_automation_suite_prompt_config WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0] || {};
      const ids = Array.isArray(row.vector_store_ids) ? row.vector_store_ids : [];
      return res.json({ ok:true, vector_store_id: row.vector_store_id || null, vector_store_ids: ids, tools: row.tools || null });
    } catch { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  app.post('/api/automation-suite/prompt-configs/:id/vector-stores/link', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      const vsId = String(req.body?.id || '').trim();
      if (!id || !vsId) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`SELECT vector_store_ids, tools, vector_store_id FROM mod_automation_suite_prompt_config WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0] || {};
      const current = Array.isArray(row.vector_store_ids) ? row.vector_store_ids : [];
      const set = new Set(current.map((x) => String(x || '').trim()).filter(Boolean));
      set.add(vsId);
      const nextIds = Array.from(set);
      const tools = (row.tools && typeof row.tools === 'object') ? row.tools : {};
      const nextTools = { ...tools, file_search: true };
      await pool.query(
        `UPDATE mod_automation_suite_prompt_config
            SET vector_store_ids=$1::json, tools=$2::jsonb, updated_at=NOW()
          WHERE id=$3`,
        [JSON.stringify(nextIds), JSON.stringify(nextTools), id]
      );
      return res.json({ ok:true, vector_store_ids: nextIds });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/automation-suite/prompt-configs/:id/vector-stores/unlink', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      const vsId = String(req.body?.id || '').trim();
      if (!id || !vsId) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`SELECT vector_store_ids, tools, vector_store_id FROM mod_automation_suite_prompt_config WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0] || {};
      const current = Array.isArray(row.vector_store_ids) ? row.vector_store_ids : [];
      const nextIds = current.map((x) => String(x || '').trim()).filter(Boolean).filter((x) => x !== vsId);
      const tools = (row.tools && typeof row.tools === 'object') ? row.tools : {};
      const hasAny = nextIds.length > 0 || !!String(row.vector_store_id || '').trim();
      const nextTools = { ...tools, file_search: hasAny };
      await pool.query(
        `UPDATE mod_automation_suite_prompt_config
            SET vector_store_ids=$1::json, tools=$2::jsonb, updated_at=NOW()
          WHERE id=$3`,
        [JSON.stringify(nextIds), JSON.stringify(nextTools), id]
      );
      return res.json({ ok:true, vector_store_ids: nextIds });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Unassign chatbots from this prompt
  app.post('/api/automation-suite/prompt-configs/:id/unassign', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      const arr = Array.isArray(req.body?.chatbot_ids) ? req.body.chatbot_ids : [];
      if (!id || !arr.length) return res.json({ ok:true, updated: 0 });
      const inList = arr.map((v,i)=>`$${i+2}`).join(',');
      const vals = [id, ...arr];
      const sql = `UPDATE mod_automation_suite_chatbots SET prompt_config_id=NULL, updated_at=NOW() WHERE prompt_config_id=$1 AND id_bot IN (${inList})`;
      const r = await pool.query(sql, vals);
      return res.json({ ok:true, updated: r.rowCount|0 });
    } catch { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Delete a prompt_config (and related history/links)
  app.delete('/api/automation-suite/prompt-configs/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      await pool.query(`DELETE FROM mod_automation_suite_prompt_test_history WHERE prompt_config_id=$1`, [id]);
      await pool.query(`DELETE FROM mod_automation_suite_prompt_mcp WHERE prompt_config_id=$1`, [id]).catch(()=>{});
      await pool.query(`DELETE FROM mod_automation_suite_prompt_mcp2 WHERE prompt_config_id=$1`, [id]).catch(()=>{});
      await pool.query(`UPDATE mod_automation_suite_chatbots SET prompt_config_id=NULL, updated_at=NOW() WHERE prompt_config_id=$1`, [id]);
      const r = await pool.query(`DELETE FROM mod_automation_suite_prompt_config WHERE id=$1`, [id]);
      return res.json({ ok:true, deleted: r.rowCount|0 });
    } catch (e) {
      if (isDbUnavailable(e)) return res.status(503).json({ ok:false, error:'db_unavailable' });
      return res.status(500).json({ ok:false, error:'server_error' });
    }
  });

  // ----- MCP2 server linking for a prompt_config -----
  // List linked MCP2 servers for this prompt
  app.get('/api/automation-suite/prompt-configs/:id/mcp2-servers', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const q = `SELECT s.id, s.name, s.http_base, s.ws_url, s.stream_url, s.sse_url, s.enabled
                   FROM mod_automation_suite_prompt_mcp2 x
                   JOIN mod_mcp2_server s ON s.id = x.mcp2_server_id
                  WHERE x.prompt_config_id = $1
                  ORDER BY s.updated_at DESC NULLS LAST`;
      const r = await pool.query(q, [id]);
      return res.json({ ok:true, servers: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Assign/link MCP2 servers to this prompt
  app.post('/api/automation-suite/prompt-configs/:id/mcp2-servers/assign', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      const arr = Array.isArray(req.body?.server_ids) ? req.body.server_ids : [];
      if (!id || !arr.length) return res.json({ ok:true, added: 0 });
      let added = 0;
      for (const sid of arr) {
        try {
          const sql = `INSERT INTO mod_automation_suite_prompt_mcp2 (prompt_config_id, mcp2_server_id, created_at)
                       VALUES ($1,$2,NOW())
                       ON CONFLICT (prompt_config_id, mcp2_server_id) DO NOTHING`;
          const r = await pool.query(sql, [id, String(sid)]);
          if ((r.rowCount|0) > 0) added += r.rowCount|0;
        } catch {}
      }
      return res.json({ ok:true, added });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Unassign/unlink MCP2 servers from this prompt
  app.post('/api/automation-suite/prompt-configs/:id/mcp2-servers/unassign', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      const arr = Array.isArray(req.body?.server_ids) ? req.body.server_ids : [];
      if (!id || !arr.length) return res.json({ ok:true, removed: 0 });
      const r = await pool.query(
        `DELETE FROM mod_automation_suite_prompt_mcp2 WHERE prompt_config_id=$1 AND mcp2_server_id = ANY($2::text[])`,
        [id, arr.map(String)]
      );
      return res.json({ ok:true, removed: r.rowCount|0 });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Test this prompt configuration against OpenAI (Chat or Image)
  app.post('/api/automation-suite/prompt-configs/:id/test', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    const t0 = Date.now();
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const b = req.body || {};
      const input = String(b.input || '').trim();
      const previewOnly = !!b.preview;
      // Load prompt config
      const r = await pool.query(`SELECT * FROM mod_automation_suite_prompt_config WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0] || {};
      const toolsObj = (() => { try { return (row.tools && typeof row.tools === 'object') ? row.tools : (typeof row.tools === 'string' ? JSON.parse(row.tools) : {}); } catch { return {}; } })();
      const toolsFileSearch = !!toolsObj.file_search;
      const toolsCodeInterpreter = !!toolsObj.code_interpreter;
      const webSearchEnabled = !!toolsObj.web_search;
      const webSearchAllowedDomains = Array.isArray(toolsObj.web_search_allowed_domains) ? toolsObj.web_search_allowed_domains.map(String).filter(Boolean) : undefined;
      const webSearchContextSize = toolsObj.web_search_context_size != null ? String(toolsObj.web_search_context_size) : undefined;

      const seedMessages = normalizeMessages(Array.isArray(row.messages) ? row.messages : []);
      let metadata = row.metadata;
      try { if (typeof metadata === 'string') metadata = JSON.parse(metadata); } catch {}
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) metadata = {};
      const metaOpenai = (metadata && metadata.openai && typeof metadata.openai === 'object') ? metadata.openai : metadata;
      const textVerbosity = metaOpenai?.text_verbosity || 'medium';
      const reasoningEffort = metaOpenai?.reasoning_effort || 'medium';
      const maxOutputTokens = metaOpenai?.max_output_tokens || 250;

      // Derive a single text prompt for image generation (strip tags + trim)
      function stripTags(s) { try { return String(s||'').replace(/<[^>]+>/g, ' '); } catch { return String(s||''); } }
      const imgPrompt = (() => {
        try {
          const parts = [];
          if (row.dev_message) parts.push(stripTags(row.dev_message));
          for (const m of seedMessages) parts.push(stripTags(m?.content ?? ''));
          if (input) parts.push(stripTags(input));
          const joined = parts.filter(Boolean).join('\n\n').slice(0, 4000);
          return joined || 'Generate an e‑commerce category hero image on white background.';
        } catch { return 'Generate an e‑commerce category hero image on white background.'; }
      })();

      // Determine model
      let model = String(row.model || '').trim();
      if (!model && typeof ctx.getSetting === 'function') {
        try { model = String((await ctx.getSetting('OPENAI_MODEL')) || ''); } catch {}
      }
      if (!model) model = String(process.env.OPENAI_MODEL || 'gpt-4o-mini');
      // Some models (e.g., gpt-5) do not support custom temperature; only default (1)
      const supportsCustomTemp = (m) => {
        try { return !/^gpt-5/i.test(String(m||'')); } catch { return true; }
      };
      const defaultTemp = (() => { try { const t = Number(process.env.OPENAI_TEMPERATURE || 0.3); return Number.isFinite(t) ? t : 0.3; } catch { return 0.3; } })();
      // If model is an image model, use image generations endpoint
      const isImageModel = /^gpt-image/i.test(String(model||'')) || /image|vision/.test(String(model||''));
      if (isImageModel) {
        const imgReq = { model, prompt: imgPrompt, size: '1024x1024', response_format: 'b64_json' };
        if (previewOnly) return res.json({ ok:true, request_body: imgReq });
        let json;
        try {
          json = await openaiHttp('/images/generations', { method:'POST', body: imgReq }, ctx);
        } catch (e) {
          // Fallback: some deployments reject `response_format`; retry without it
          const msg = String(e?.message || '');
          const canRetry = /unknown parameter\s*:\s*'response_format'/i.test(msg) || /unknown parameter\s*:\s*response_format/i.test(msg);
          if (canRetry) {
            const body2 = { ...imgReq };
            try { delete body2.response_format; } catch {}
            try {
              json = await openaiHttp('/images/generations', { method:'POST', body: body2 }, ctx);
            } catch (ee) {
              return res.status(ee?.status || 500).json({ ok:false, error:'openai_error', message: ee?.message || String(ee) });
            }
          } else {
            return res.status(e?.status || 500).json({ ok:false, error:'openai_error', message: e?.message || String(e) });
          }
        }
        const d0 = (json && Array.isArray(json.data) && json.data[0]) || {};
        const b64 = d0?.b64_json || null;
        const url = d0?.url || null;
        const ms = Date.now() - t0;
        try {
          const hid = `pth_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
          await pool.query(
            `INSERT INTO mod_automation_suite_prompt_test_history (id, prompt_config_id, input, output, request, response, ms, created_at)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,NOW())`,
            [hid, id, input || null, String(url || (b64 ? '[base64]' : '') || ''), JSON.stringify(imgReq), JSON.stringify(json), ms]
          );
        } catch {}
        const out = { ok:true, request_body: imgReq, response: json, ms };
        if (b64) out.image_base64 = b64; else if (url) out.url = url; else out.text = '';
        return res.json(out);
      }

      // Chat path: use Responses API so linked vector stores and MCP servers are part of the request.
      const promptId = row.prompt_id ? String(row.prompt_id).trim() : undefined;
      const promptVersion = row.prompt_version ? String(row.prompt_version).trim() : undefined;
      const instructions = row.dev_message ? String(row.dev_message) : undefined;

      // Build MCP tools from linked MCP2 servers (OpenAI MCP tool type).
      const extraTools = [];
      const seenLabels = new Set();
      try {
        const rr = await pool.query(
          `SELECT s.id, s.name, s.stream_url, s.sse_url, s.token, s.options, COALESCE(s.enabled,false) AS enabled
             FROM mod_automation_suite_prompt_mcp2 x
             JOIN mod_mcp2_server s ON s.id = x.mcp2_server_id
            WHERE x.prompt_config_id = $1
            ORDER BY s.updated_at DESC NULLS LAST`,
          [id]
        );
        for (const srow of rr.rows || []) {
          if (!srow) continue;
          const name = String(srow.name || srow.id || '').trim();
          if (!name) continue;
          let opts = srow.options;
          try { if (typeof opts === 'string') opts = JSON.parse(opts); } catch { opts = {}; }
          const pref = (opts && opts.server_url_pref === 'stream') ? 'stream' : 'sse';
          let url = pref === 'stream' ? (srow.stream_url || srow.sse_url || '') : (srow.sse_url || srow.stream_url || '');
          url = String(url || '').trim();
          if (!url) continue;
          // Token support: MCP2 transport accepts query ?token=... (or Authorization bearer).
          // Do not expose token in preview output; we will redact it before returning.
          try {
            const token = String(srow.token || '').trim();
            if (token) {
              const u = new URL(url);
              if (!u.searchParams.get('token')) u.searchParams.set('token', token);
              url = u.toString();
            }
          } catch {}
          const allowed = Array.isArray(opts?.allowed_tools) ? opts.allowed_tools : undefined;
          const serverLabel = uniqueServerLabel(name, seenLabels);
          extraTools.push({ type: 'mcp', server_url: url, server_label: serverLabel, allowed_tools: allowed, require_approval: 'never' });
        }
      } catch {}

      // Responses API request (preview or run)
      const apiKey = String(row.openai_api_key || (ctx?.extras?.getOpenaiApiKey?.() || process.env.OPENAI_API_KEY || '') || '').trim();
      if (!apiKey) return res.status(400).json({ ok:false, error:'openai_key_missing' });
      const vectorStoreId = row.vector_store_id ? String(row.vector_store_id) : undefined;
      const vectorStoreIds = Array.isArray(row.vector_store_ids) ? row.vector_store_ids.map(String).filter(Boolean) : undefined;

      const result = await respondWithPrompt({
        apiKey,
        model,
        promptId,
        promptVersion,
        input,
        seedMessages,
        instructions,
        toolsFileSearch,
        toolsCodeInterpreter,
        vectorStoreId,
        vectorStoreIds,
        webSearchEnabled,
        webSearchAllowedDomains,
        webSearchContextSize,
        textVerbosity,
        reasoningEffort,
        maxOutputTokens,
        temperature: supportsCustomTemp(model) ? defaultTemp : undefined,
        extraTools,
      }, { buildOnly: previewOnly });

      const ms = Date.now() - t0;
      const safeReqBody = redactMcpToolsInRequestBody(result.request_body || {});
      if (previewOnly) return res.json({ ok:true, request_body: safeReqBody, request: result.request || {} });

      // Persist test history (best effort) — store redacted request to avoid leaking tokens
      try {
        const hid = `pth_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        await pool.query(
          `INSERT INTO mod_automation_suite_prompt_test_history (id, prompt_config_id, input, output, request, response, ms, created_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,NOW())`,
          [hid, id, input || null, String(result.text || ''), JSON.stringify(safeReqBody), JSON.stringify(result.raw || null), ms]
        );
      } catch {}

      return res.json({ ok:true, text: result.text || '', request_body: safeReqBody, request: result.request || {}, response: result.raw || null, ms });
    } catch {
      return res.status(500).json({ ok:false, error:'server_error' });
    }
  });
}
