import fs from 'fs';
import path from 'path';
import os from 'os';
import { createOpenAIClient } from './openaiResponses.js';
import { google } from 'googleapis';
import { createPrestaClient, normalizePrestaCollection, pick } from './prestashop.js';

export function createMcpTools(deps) {
  const {
    pool,
    io,
    dbSchema,
    ensureVisitorExists,
    sanitizeAgentHtmlServer,
    textToSafeHTML,
    upsertVisitorColumns,
    uploadDir,
    // Optional auth helpers injected by server
    verifyToken, // async (token, ctx) => boolean
    needsAuth,   // async (ctx) => boolean
  } = deps;

  // ---------------- PrestaShop helpers ----------------
  async function resolvePrestaConfig(args = {}, ctx = {}) {
    // Priority: ctx.server_name from mcp_server_config (server_type='prestashop_api' or similar) -> args -> env
    let baseUrl = String(args.base_url || '').trim();
    let apiKey = String(args.api_key || '').trim();
    const serverName = String(ctx.server_name || '').trim();
    if (!baseUrl || !apiKey) {
      if (serverName) {
        try {
          const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
          if (r.rowCount) {
            const row = r.rows[0];
            let opt = row.options || {};
            try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
            const st = String(row.server_type || '').toLowerCase();
            if (st.includes('prestashop') || st.includes('api')) {
              baseUrl = baseUrl || String(opt.base_url || opt.baseURL || opt.url || '').trim();
              apiKey = apiKey || String(opt.api_key || opt.apiKey || '').trim();
            }
          }
        } catch {}
      }
    }
    if (!baseUrl) baseUrl = String(process.env.PRESTASHOP_BASE_URL || '').trim();
    if (!apiKey) apiKey = String(process.env.PRESTASHOP_API_KEY || '').trim();
    if (!baseUrl || !apiKey) throw new Error('prestashop_config_missing');
    return { base_url: baseUrl.replace(/\/$/, ''), api_key: apiKey };
  }

  // ---------------- DHL API helpers ----------------
  async function resolveDhlConfig(args = {}, ctx = {}) {
    // Priority: explicit args -> server options by name (server_type includes 'dhl') -> env
    let baseUrl = String(args.base_url || args.api_base_url || '').trim();
    let apiKey = String(args.api_key || '').trim();
    let language = String(args.language || args.locale || '').trim();
    const serverName = String(ctx.server_name || '').trim();
    if ((!baseUrl || !apiKey) && serverName) {
      try {
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (r.rowCount) {
          const row = r.rows[0];
          let opt = row.options || {};
          try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
          const st = String(row.server_type || '').toLowerCase();
          if (!baseUrl) baseUrl = String(opt.api_base_url || opt.api_base || opt.base_url || '').trim();
          if (!apiKey) apiKey = String(opt.api_key || opt.DHL_API_KEY || '').trim();
          if (!language) language = String(opt.language || opt.locale || '').trim();
          // Only enforce presence for dedicated DHL type; allow generic apis type too
          if (!baseUrl) {
            if (st.includes('dhl')) baseUrl = 'https://api-eu.dhl.com';
          }
        }
      } catch {}
    }
    if (!baseUrl) baseUrl = String(process.env.DHL_API_BASE_URL || 'https://api-eu.dhl.com');
    if (!apiKey) apiKey = String(process.env.DHL_API_KEY || '');
    return { base_url: baseUrl.replace(/\/$/, ''), api_key: apiKey, language };
  }

  async function dhlRequest(config, path, { method = 'GET', query = {}, timeout_ms = 20000 } = {}) {
    const base = String(config.base_url || '').replace(/\/$/, '');
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(query || {})) { if (v != null && v !== '') url.searchParams.set(k, String(v)); }
    const ctrl = new AbortController();
    const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, Math.max(100, Math.min(60000, Number(timeout_ms || 20000))));
    try {
      const headers = { 'Accept': 'application/json' };
      const key = String(config.api_key || '').trim();
      if (key) headers['DHL-API-Key'] = key;
      const lang = String(config.language || '').trim();
      if (lang) headers['Accept-Language'] = lang;
      const r = await fetch(url.toString(), { method, headers, signal: ctrl.signal });
      const text = await r.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok) {
        const msg = json?.errors || json?.error || text?.slice(0, 500) || `http_${r.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return json ?? { ok: true, raw: text };
    } finally { try { clearTimeout(t); } catch {} }
  }

  function buildPrestaApiUrl(baseUrl, resource, id = null, params = {}) {
    const base = baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
    const basePath = id ? `${base}/${resource}/${encodeURIComponent(id)}` : `${base}/${resource}`;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null) continue;
      if (k.includes('[')) sp.append(k, v);
      else sp.append(k, String(v));
    }
    return `${basePath}?${sp.toString()}`;
  }

  async function prestaRequest({ base_url, api_key }, { method = 'GET', resource, id = null, params = {}, body = null, contentType = 'application/json' }) {
    const url = buildPrestaApiUrl(base_url, resource, id, { ws_key: api_key, output_format: 'JSON', ...params });
    const ctrl = new AbortController();
    const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, 20000);
    try {
      const headers = { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${api_key}:`).toString('base64')}` };
      if (method !== 'GET') headers['Content-Type'] = contentType;
      const r = await fetch(url, { method, headers, body: body ? (contentType.includes('json') ? JSON.stringify(body) : body) : undefined, signal: ctrl.signal });
      const text = await r.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok) {
        const msg = json?.errors || json?.error || text?.slice(0, 400) || `http_${r.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return json ?? { ok: true, raw: text };
    } finally { try { clearTimeout(t); } catch {} }
  }

  async function getVisitor(args = {}, ctx = {}) {
    const vid = String(args.visitorId || '').trim();
    if (!vid) throw new Error('visitorId required');
    const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
    const r = await pool.query(`SELECT * FROM visitors WHERE ${idCol} = $1 LIMIT 1`, [vid]);
    return r.rowCount ? r.rows[0] : null;
  }

  async function listRecentVisitors(args = {}, ctx = {}) {
    const limit = Math.max(1, Math.min(100, Number(args.limit || 20)));
    const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
    const where = [];
    const params = [];
    if (ctx && ctx.shop_name) { params.push(ctx.shop_name); where.push(`shop_name = $${params.length}`); }
    if (ctx && ctx.lang_iso) { params.push(ctx.lang_iso); where.push(`lang_iso = $${params.length}`); }
    params.push(limit);
    const sql = `SELECT ${idCol} AS visitor_id, shop_name, lang_iso, last_seen, last_action, conversation_status
                   FROM visitors
                  ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY COALESCE(last_seen, NOW()) DESC
                  LIMIT $${params.length}`;
    const r = await pool.query(sql, params);
    return r.rows || [];
  }

  async function sendAgentMessage(args = {}, ctx = {}) {
    const visitorId = String(args.visitorId || '').trim();
    const raw = String(args.message || '').trim();
    if (!visitorId) throw new Error('visitorId required');
    if (!raw) throw new Error('message required');

    await ensureVisitorExists(visitorId);
    const looksHtml = /<\s*[a-z][\s\S]*>/i.test(raw);
    const content_html = looksHtml ? sanitizeAgentHtmlServer(raw) : textToSafeHTML(raw);
    const msgCol = dbSchema.messages.hasContent ? 'content' : (dbSchema.messages.hasMessage ? 'message' : 'content');
    const cols = [];
    const params = [];
    const ph = [];
    let onConflict = '';
    const msgId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (dbSchema.useDbDedup) { cols.push('id'); params.push(msgId); ph.push(`$${params.length}`); onConflict = ' ON CONFLICT (id) DO NOTHING'; }
    if (dbSchema.messages.hasVisitorId) { cols.push('visitor_id'); params.push(visitorId); ph.push(`$${params.length}`); }
    cols.push('sender'); params.push('agent'); ph.push(`$${params.length}`);
    cols.push(msgCol); params.push(raw); ph.push(`$${params.length}`);
    if (dbSchema.messages.hasContentHtml) { cols.push('content_html'); params.push(content_html); ph.push(`$${params.length}`); }
    if (dbSchema.messages.hasAgentId) { cols.push('agent_id'); params.push(null); ph.push(`$${params.length}`); }
    const sql = `INSERT INTO messages (${cols.join(', ')}) VALUES (${ph.join(', ')})${onConflict} RETURNING id, created_at`;
    await pool.query(sql, params);

    const out = { id: msgId, visitorId, from: 'agent', message: raw, html: content_html, agentId: null, timestamp: Date.now() };
    io.to(visitorId).emit('chat_message', out);
    io.to('agents').emit('dashboard_message', out);

    try { await upsertVisitorColumns(visitorId, { last_action: 'agent_message', last_action_at: new Date().toISOString(), conversation_status: 'waiting_visitor' }); } catch {}
    return { ok: true, message: out };
  }

  // Helper: read small text preview from a file if it's text-like
  function readTextPreview(fullPath, maxBytes = 65536) {
    try {
      const fd = fs.openSync(fullPath, 'r');
      try {
        const { size } = fs.fstatSync(fd);
        const toRead = Math.min(maxBytes, Math.max(0, size));
        const buf = Buffer.allocUnsafe(toRead);
        fs.readSync(fd, buf, 0, toRead, 0);
        // Best-effort UTF-8; if binary, this may contain odd chars
        const text = buf.toString('utf8');
        return text;
      } finally { try { fs.closeSync(fd); } catch {} }
    } catch { return null; }
  }
  
  // Helper to resolve Google JWT auth (for Gmail tools)
  function resolveGoogleJwtAuth(args = {}, opt = {}, { defaultScope = 'https://www.googleapis.com/auth/gmail.readonly' } = {}) {
    let creds = args.service_account_json || opt.service_account_json || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || null;
    if (typeof creds === 'string' && creds.trim()) { try { creds = JSON.parse(creds); } catch {} }
    if (!creds && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try { const p = process.env.GOOGLE_APPLICATION_CREDENTIALS; const txt = fs.readFileSync(p, 'utf8'); creds = JSON.parse(txt); } catch {}
    }
    if (!creds || typeof creds !== 'object') return { error: 'missing_service_account_json' };
    let key = creds.private_key || '';
    try { if (typeof key === 'string' && key.includes('\n') === false && key.includes('\\n')) key = key.replace(/\\n/g, '\n'); } catch {}
    const scopesRaw = String(args.scopes || opt.scopes || defaultScope);
    const scopes = scopesRaw.split(/\s+/).filter(Boolean);
    const subject = (args.impersonate || opt.impersonate || '').trim() || undefined;
    const client = new google.auth.JWT({ email: creds.client_email, key, scopes, subject });
    return { client, scopes, subject, creds };
  }

  // Resolve Google OAuth2 client from saved tokens (user session)
  async function resolveGoogleOauthClient(args = {}, opt = {}, ctx = {}) {
    try {
      let userId = '';
      try { userId = String(args.oauth_user_id || opt.oauth_user_id || ctx?.user_id || '').trim(); } catch {}
      let emailRaw = '';
      try { emailRaw = String(args.oauth_user_email || opt.oauth_user_email || ctx?.user_email || '').trim(); } catch {}
      if (!userId && emailRaw) {
        try { const rU = await pool.query(`SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`, [emailRaw.toLowerCase()]); if (rU.rowCount) userId = String(rU.rows[0].id || '').trim(); } catch {}
      }
      if (!userId) return { error: 'oauth_user_missing' };
      // Prefer per-user tokens in settings table; fallback to module-global tokens table
      const key = `GOOGLE_OAUTH_TOKENS_USER_${userId}`;
      let tokens = null;
      try {
        const rTok = await pool.query(`SELECT value FROM settings WHERE key=$1 LIMIT 1`, [key]);
        if (rTok.rowCount && rTok.rows[0].value) {
          try { tokens = JSON.parse(rTok.rows[0].value); } catch { tokens = null; }
        }
      } catch {}
      if (!tokens) {
        try {
          const rTok2 = await pool.query(`SELECT access_token, refresh_token, token_type, expiry_date FROM mod_google_api_tokens WHERE org_id='org_default' ORDER BY updated_at DESC LIMIT 1`);
          if (rTok2.rowCount) {
            const row = rTok2.rows[0];
            tokens = { access_token: row.access_token || null, refresh_token: row.refresh_token || null, token_type: row.token_type || null, expiry_date: row.expiry_date || null };
          }
        } catch {}
      }
      if (!tokens || (!tokens.access_token && !tokens.refresh_token)) return { error: 'oauth_tokens_not_found' };

      // Read OAuth client config from module settings (DB); fallback to env if absent
      let clientId = '', clientSecret = '', redirectUri = '';
      try {
        const rCfg = await pool.query(`SELECT client_id, client_secret, redirect_uri FROM mod_google_api_settings WHERE org_id='org_default' LIMIT 1`);
        if (rCfg.rowCount) {
          const cfg = rCfg.rows[0];
          clientId = String(cfg.client_id || '').trim();
          clientSecret = String(cfg.client_secret || '').trim();
          redirectUri = String(cfg.redirect_uri || '').trim();
        }
      } catch {}
      if (!clientId) clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
      if (!clientSecret) clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
      if (!redirectUri) redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || '';
      if (!clientId || !clientSecret || !redirectUri) return { error: 'missing_oauth_config' };
      const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      oauth2.setCredentials(tokens);
      return { client: oauth2, userId };
    } catch (e) {
      return { error: e?.message || 'oauth_resolve_error' };
    }
  }

  const TOOL_DEFS = [
    // ======================= GOOGLE GMAIL (Service Account) =======================
    // Server options expected (under this MCP server name):
    // - service_account_json: JSON or stringified JSON for Google service account (with domain-wide delegation)
    // - impersonate: Workspace user email to act as (e.g., user@domain.com)
    // - scopes: space-separated scopes (default: gmail.readonly)
    // These tools use domain-wide delegation with JWT (no per-user OAuth).
    { name: 'google.gmail.labels', description: 'List Gmail labels (service account or OAuth user)', inputSchema: { type: 'object', properties: { impersonate: { type: 'string', description: 'Override Workspace user email (SA only)' }, scopes: { type: 'string', description: 'Space separated scopes (SA only)' }, use_oauth: { type: 'boolean', description: 'Force using OAuth tokens instead of Service Account' }, oauth_user_id: { type: 'string', description: 'User ID to use for OAuth' }, oauth_user_email: { type: 'string', description: 'User email to use for OAuth (mapped to ID)' } } }, run: async (args = {}, ctx = {}) => {
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const r = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!r.rowCount) throw new Error('server_not_found');
        let opt = r.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        let gmail = null;
        const preferOauth = (args.use_oauth === true) || (opt.use_oauth === true);
        if (preferOauth) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) {
          const { client } = resolveGoogleJwtAuth(args, opt, { defaultScope: 'https://www.googleapis.com/auth/gmail.readonly' });
          if (client) gmail = google.gmail({ version: 'v1', auth: client });
        }
        if (!gmail) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) throw new Error('missing_service_account_json_or_oauth_tokens');
        const rr = await gmail.users.labels.list({ userId: 'me' });
        const labels = (rr.data.labels || []).map(l => ({ id: l.id, name: l.name, type: l.type, messagesTotal: l.messagesTotal, messagesUnread: l.messagesUnread, threadsTotal: l.threadsTotal, threadsUnread: l.threadsUnread }));
        return { ok: true, count: labels.length, labels };
      }
    },
    { name: 'google.gmail.search', description: 'Search Gmail messages and return basic headers', inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'Search query' }, labelIds: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'Comma-separated or array of label IDs (e.g., INBOX,UNREAD)' }, max: { type: 'integer', minimum: 1, maximum: 50, default: 20 }, impersonate: { type: 'string' }, scopes: { type: 'string' }, use_oauth: { type: 'boolean' }, oauth_user_id: { type: 'string' }, oauth_user_email: { type: 'string' } } }, run: async (args = {}, ctx = {}) => {
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const r = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!r.rowCount) throw new Error('server_not_found');
        let opt = r.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        let gmail = null;
        const preferOauth = (args.use_oauth === true) || (opt.use_oauth === true);
        if (preferOauth) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) {
          const { client } = resolveGoogleJwtAuth(args, opt, { defaultScope: 'https://www.googleapis.com/auth/gmail.readonly' });
          if (client) gmail = google.gmail({ version: 'v1', auth: client });
        }
        if (!gmail) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) throw new Error('missing_service_account_json_or_oauth_tokens');
        let labelIds = [];
        const raw = args.labelIds;
        if (Array.isArray(raw)) labelIds = raw.map(String).filter(Boolean);
        else if (typeof raw === 'string' && raw.trim()) labelIds = raw.split(',').map(s=>s.trim()).filter(Boolean);
        if (!labelIds.length) labelIds = ['INBOX'];
        const maxResults = Math.min(50, Math.max(1, Number(args.max || 20)));
        const q = String(args.q || '').trim() || undefined;
        const list = await gmail.users.messages.list({ userId: 'me', labelIds, maxResults, q });
        const items = list.data.messages || [];
        const pickHeader = (headers, name) => { try { const h = (headers||[]).find(h => String(h.name||'').toLowerCase() === String(name).toLowerCase()); return h ? (h.value || '') : ''; } catch { return ''; } };
        const details = await Promise.all(items.map(async (m) => {
          try {
            const rr = await gmail.users.messages.get({ userId:'me', id:m.id, format:'metadata', metadataHeaders:['From','Subject','Date'] });
            const md = rr.data || {};
            const hdrs = (md.payload && md.payload.headers) || [];
            return { id: md.id, threadId: md.threadId, snippet: md.snippet || '', from: pickHeader(hdrs, 'From'), subject: pickHeader(hdrs, 'Subject'), date: pickHeader(hdrs, 'Date'), labelIds: md.labelIds || [] };
          } catch { return { id: m.id, threadId: m.threadId, snippet:'', from:'', subject:'', date:'', labelIds: [] }; }
        }));
        return { ok:true, items: details };
      }
    },
    { name: 'google.gmail.get', description: 'Get a Gmail message with basic text/html extraction', inputSchema: { type: 'object', properties: { id: { type: 'string' }, impersonate: { type: 'string' }, scopes: { type: 'string' }, use_oauth: { type: 'boolean' }, oauth_user_id: { type: 'string' }, oauth_user_email: { type: 'string' } }, required: ['id'] }, run: async (args = {}, ctx = {}) => {
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const r = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!r.rowCount) throw new Error('server_not_found');
        let opt = r.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        let gmail = null;
        const preferOauth = (args.use_oauth === true) || (opt.use_oauth === true);
        if (preferOauth) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) {
          const { client } = resolveGoogleJwtAuth(args, opt, { defaultScope: 'https://www.googleapis.com/auth/gmail.readonly' });
          if (client) gmail = google.gmail({ version: 'v1', auth: client });
        }
        if (!gmail) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) throw new Error('missing_service_account_json_or_oauth_tokens');
        const id = String(args.id || '').trim(); if (!id) throw new Error('id_required');
        const rr = await gmail.users.messages.get({ userId:'me', id, format:'full' });
        const msg = rr.data || {};
        const hdrs = (msg.payload && msg.payload.headers) || [];
        const pickHeader = (name) => { try { const h = hdrs.find(h=>String(h.name||'').toLowerCase()===String(name).toLowerCase()); return h? (h.value||''):''; } catch { return ''; } };
        const decodeB64 = (s='') => { try { const b=s.replace(/-/g,'+').replace(/_/g,'/'); return Buffer.from(b,'base64').toString('utf8'); } catch { return ''; } };
        const walkParts = (p, out) => { if (!p) return; if (p.mimeType === 'text/plain' && p.body && p.body.data) out.text += decodeB64(p.body.data); if (p.mimeType === 'text/html' && p.body && p.body.data) out.html += decodeB64(p.body.data); if (Array.isArray(p.parts)) for (const c of p.parts) walkParts(c, out); };
        const body = { text:'', html:'' }; walkParts(msg.payload, body);
        return { ok:true, id: msg.id, threadId: msg.threadId, snippet: msg.snippet||'', from: pickHeader('From'), to: pickHeader('To'), cc: pickHeader('Cc'), subject: pickHeader('Subject'), date: pickHeader('Date'), labelIds: msg.labelIds||[], body_text: body.text, body_html: body.html };
      }
    },
    { name: 'google.gmail.mark_read', description: 'Mark a Gmail message as read (remove UNREAD)', inputSchema: { type: 'object', properties: { id: { type: 'string' }, impersonate: { type: 'string' }, scopes: { type: 'string' }, use_oauth: { type: 'boolean' }, oauth_user_id: { type: 'string' }, oauth_user_email: { type: 'string' } }, required: ['id'] }, run: async (args = {}, ctx = {}) => {
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const r = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!r.rowCount) throw new Error('server_not_found');
        let opt = r.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        let gmail = null;
        const preferOauth = (args.use_oauth === true) || (opt.use_oauth === true);
        if (preferOauth) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) {
          const { client } = resolveGoogleJwtAuth(args, opt, { defaultScope: 'https://www.googleapis.com/auth/gmail.modify' });
          if (client) gmail = google.gmail({ version: 'v1', auth: client });
        }
        if (!gmail) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) throw new Error('missing_service_account_json_or_oauth_tokens');
        const id = String(args.id || '').trim(); if (!id) throw new Error('id_required');
        await gmail.users.messages.modify({ userId:'me', id, requestBody: { removeLabelIds: ['UNREAD'] } });
        return { ok:true };
      }
    },
    { name: 'google.gmail.mark_unread', description: 'Mark a Gmail message as unread (add UNREAD)', inputSchema: { type: 'object', properties: { id: { type: 'string' }, impersonate: { type: 'string' }, scopes: { type: 'string' }, use_oauth: { type: 'boolean' }, oauth_user_id: { type: 'string' }, oauth_user_email: { type: 'string' } }, required: ['id'] }, run: async (args = {}, ctx = {}) => {
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const r = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!r.rowCount) throw new Error('server_not_found');
        let opt = r.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        let gmail = null;
        const preferOauth = (args.use_oauth === true) || (opt.use_oauth === true);
        if (preferOauth) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) {
          const { client } = resolveGoogleJwtAuth(args, opt, { defaultScope: 'https://www.googleapis.com/auth/gmail.modify' });
          if (client) gmail = google.gmail({ version: 'v1', auth: client });
        }
        if (!gmail) {
          const { client: oauth2 } = await resolveGoogleOauthClient(args, opt, ctx);
          if (oauth2) gmail = google.gmail({ version: 'v1', auth: oauth2 });
        }
        if (!gmail) throw new Error('missing_service_account_json_or_oauth_tokens');
        const id = String(args.id || '').trim(); if (!id) throw new Error('id_required');
        await gmail.users.messages.modify({ userId:'me', id, requestBody: { addLabelIds: ['UNREAD'] } });
        return { ok:true };
      }
    },
    // DHL tracking (DEC/Track API)
    { name: 'dhl.track_shipment', description: 'Track a DHL Express shipment (AWB) using DHL Track API', inputSchema: { type: 'object', properties: { tracking_number: { type: 'string', description: 'AWB tracking number' }, language: { type: 'string', description: 'Accept-Language header (e.g., en, fr, de)' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['tracking_number'] }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolveDhlConfig(args, ctx);
        if (!cfg.api_key) throw new Error('dhl_api_key_missing');
        const tn = String(args.tracking_number || '').trim();
        if (!tn) throw new Error('tracking_number_required');
        if (args.language) cfg.language = String(args.language);
        const out = await dhlRequest(cfg, '/track/shipments', { method: 'GET', query: { trackingNumber: tn }, timeout_ms: args.timeout_ms });
        return out;
      }
    },
    { name: 'dhl.track_shipments', description: 'Track multiple DHL shipments (AWB list) using DHL Track API', inputSchema: { type: 'object', properties: { tracking_numbers: { type: 'array', items: { type: 'string' }, description: 'List of AWB tracking numbers' }, language: { type: 'string' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['tracking_numbers'] }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolveDhlConfig(args, ctx);
        if (!cfg.api_key) throw new Error('dhl_api_key_missing');
        const arr = Array.isArray(args.tracking_numbers) ? args.tracking_numbers.filter(Boolean) : [];
        if (!arr.length) throw new Error('tracking_numbers_required');
        if (args.language) cfg.language = String(args.language);
        // DHL accepts multiple trackingNumber params
        const query = {};
        // Build a URL ourselves because URLSearchParams handles duplicates; do manual request
        const base = String(cfg.base_url || '').replace(/\/$/, '');
        const url = new URL(`${base}/track/shipments`);
        for (const tn of arr) { url.searchParams.append('trackingNumber', String(tn)); }
        const ctrl = new AbortController();
        const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, Math.max(100, Math.min(60000, Number(args.timeout_ms || 20000))));
        try {
          const headers = { 'Accept': 'application/json', 'DHL-API-Key': cfg.api_key };
          if (cfg.language) headers['Accept-Language'] = cfg.language;
          const r = await fetch(url.toString(), { method: 'GET', headers, signal: ctrl.signal });
          const text = await r.text();
          let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          if (!r.ok) {
            const msg = json?.errors || json?.error || text?.slice(0, 500) || `http_${r.status}`;
            throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
          }
          return json ?? { ok: true, raw: text };
        } finally { try { clearTimeout(t); } catch {} }
      }
    },
    { name: 'postgresql.get_visitor', description: 'Fetch a visitor by visitorId', inputSchema: { type: 'object', properties: { visitorId: { type: 'string' } }, required: ['visitorId'] }, run: getVisitor },
    { name: 'postgresql.list_recent_visitors', description: 'List recent visitors for this bot context', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } }, run: listRecentVisitors },
    { name: 'postgresql.send_agent_message', description: 'Send an agent message to a visitor and broadcast', inputSchema: { type: 'object', properties: { visitorId: { type: 'string' }, message: { type: 'string' } }, required: ['visitorId','message'] }, run: sendAgentMessage },
    // Authentication tool: set session flag when token matches
    { name: 'authenticate', description: 'Authenticate this session using a shared token', inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] }, run: async (args={}, ctx={}) => {
        let ok = false;
        if (typeof verifyToken === 'function') {
          try { ok = await verifyToken(String(args.token||''), ctx); } catch { ok = false; }
        }
        if (ctx && ctx.session) ctx.session.authed = ok;
        return { ok };
      }
    },
    // Convenience: Stripe get failed/problematic payments account-wide (no customer filter)
    { name: 'stripe.get_failed_payments_all', description: 'List recent failed/problematic payment intents across the account', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 }, starting_after: { type: 'string', description: 'Cursor for pagination (pi_...)' }, ending_before: { type: 'string', description: 'Cursor for pagination (pi_...)' }, created_gte: { anyOf: [{ type: 'integer' }, { type: 'string' }], description: 'Created timestamp gte (unix seconds or ISO8601)' }, created_lte: { anyOf: [{ type: 'integer' }, { type: 'string' }], description: 'Created timestamp lte (unix seconds or ISO8601)' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } } }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!rr.rowCount) throw new Error('server_not_found');
        let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
        const u = new URL(base + '/v1/payment_intents');
        const lim = Number(args.limit || 10); if (isFinite(lim)) u.searchParams.set('limit', String(Math.max(1, Math.min(100, lim))));
        const sa = String(args.starting_after || '').trim(); if (sa) u.searchParams.set('starting_after', sa);
        const eb = String(args.ending_before || '').trim(); if (eb) u.searchParams.set('ending_before', eb);
        const asUnix = (v)=>{ if (v==null||v==='') return null; const n=Number(v); if (isFinite(n) && n>0) return Math.floor(n); try{ const d=new Date(String(v)); const t=Math.floor(d.getTime()/1000); return isFinite(t)&&t>0?t:null; }catch{return null} };
        const gte = asUnix(args.created_gte); if (gte) u.searchParams.set('created[gte]', String(gte));
        const lte = asUnix(args.created_lte); if (lte) u.searchParams.set('created[lte]', String(lte));
        const headers = { Accept: 'application/json' };
        try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        try { const sk = String(opt.secret_key || opt.api_key || '').trim(); if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`; const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver; const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct; } catch {}
        const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
          const text = await r.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
          const items = (body && Array.isArray(body.data)) ? body.data : [];
          const failed = items.filter(pi => {
            try {
              if (!pi) return false;
              if (pi.status === 'canceled') return true;
              if (pi.status === 'requires_payment_method' && pi.last_payment_error) return true;
              if (pi.last_payment_error) return true;
              if (pi.status === 'requires_action' && pi.last_payment_error) return true;
              return false;
            } catch { return false; }
          });
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), total: items.length, failed_count: failed.length, failed, body: body ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Convenience: Stripe list payment intents across the account (no customer filter)
    { name: 'stripe.list_transactions_all', description: 'List recent payment intents across the account (no customer filter)', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 }, starting_after: { type: 'string', description: 'Cursor for pagination (pi_...)' }, ending_before: { type: 'string', description: 'Cursor for pagination (pi_...)' }, created_gte: { anyOf: [{ type: 'integer' }, { type: 'string' }], description: 'Created timestamp gte (unix seconds or ISO8601)' }, created_lte: { anyOf: [{ type: 'integer' }, { type: 'string' }], description: 'Created timestamp lte (unix seconds or ISO8601)' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } } }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!rr.rowCount) throw new Error('server_not_found');
        let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
        const u = new URL(base + '/v1/payment_intents');
        const lim = Number(args.limit || 10); if (isFinite(lim)) u.searchParams.set('limit', String(Math.max(1, Math.min(100, lim))));
        const sa = String(args.starting_after || '').trim(); if (sa) u.searchParams.set('starting_after', sa);
        const eb = String(args.ending_before || '').trim(); if (eb) u.searchParams.set('ending_before', eb);
        const asUnix = (v)=>{ if (v==null||v==='') return null; const n=Number(v); if (isFinite(n) && n>0) return Math.floor(n); try{ const d=new Date(String(v)); const t=Math.floor(d.getTime()/1000); return isFinite(t)&&t>0?t:null; }catch{return null} };
        const gte = asUnix(args.created_gte); if (gte) u.searchParams.set('created[gte]', String(gte));
        const lte = asUnix(args.created_lte); if (lte) u.searchParams.set('created[lte]', String(lte));
        const headers = { Accept: 'application/json' };
        try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        try { const sk = String(opt.secret_key || opt.api_key || '').trim(); if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`; const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver; const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct; } catch {}
        const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
          const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), body: json ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Convenience: Stripe customer search by email
    { name: 'stripe.get_customer_by_email', description: 'Search Stripe customers by email', inputSchema: { type: 'object', properties: { email: { type: 'string', description: "Customer email to search for" }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['email'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!rr.rowCount) throw new Error('server_not_found');
        let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
        const u = new URL(base + '/v1/customers/search');
        const email = String(args.email || '').trim(); if (!email) throw new Error('email_required');
        u.searchParams.set('query', `email:'${email}'`);
        const headers = { Accept: 'application/json' };
        try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        try { const sk = String(opt.secret_key || opt.api_key || '').trim(); if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`; const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver; const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct; } catch {}
        const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
          const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), body: json ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Convenience: Stripe get customer details
    { name: 'stripe.get_customer_details', description: 'Fetch Stripe customer details (name, created, delinquent, and raw)', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID (cus_...)' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['customer_id'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!rr.rowCount) throw new Error('server_not_found');
        let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
        const cid = String(args.customer_id || '').trim(); if (!cid) throw new Error('customer_id_required');
        const u = new URL(base + `/v1/customers/${encodeURIComponent(cid)}`);
        const headers = { Accept: 'application/json' };
        try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        try { const sk = String(opt.secret_key || opt.api_key || '').trim(); if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`; const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver; const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct; } catch {}
        const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
          const text = await r.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
          const summary = body && body.id ? { id: body.id, name: body.name || null, email: body.email || null, delinquent: !!body.delinquent, created: (body.created ? new Date(body.created * 1000).toISOString() : null) } : null;
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), summary, body: body ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Convenience: Stripe payment intents by customer
    { name: 'stripe.get_transactions', description: 'List payment intents for a customer', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID (cus_...)' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 5 }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['customer_id'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!rr.rowCount) throw new Error('server_not_found');
        let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
        const u = new URL(base + '/v1/payment_intents');
        const cid = String(args.customer_id || '').trim(); if (!cid) throw new Error('customer_id_required');
        u.searchParams.set('customer', cid);
        const lim = Number(args.limit || 5); if (isFinite(lim)) u.searchParams.set('limit', String(Math.max(1, Math.min(100, lim))));
        const headers = { Accept: 'application/json' };
        try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        try { const sk = String(opt.secret_key || opt.api_key || '').trim(); if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`; const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver; const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct; } catch {}
        const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
          const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), body: json ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Alias/alternate name: list transactions for a customer (same as get_transactions)
    { name: 'stripe.list_transactions', description: 'List recent payment intents for a customer (alias of stripe.get_transactions)', inputSchema: { type: 'object', properties: { customer_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 5 }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['customer_id'] }, run: async (args = {}, ctx = {}) => {
        return await (async () => {
          // Reuse implementation by calling the same logic inline to avoid refactor
          const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
          const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
          if (!rr.rowCount) throw new Error('server_not_found');
          let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
          const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
          if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
          const u = new URL(base + '/v1/payment_intents');
          const cid = String(args.customer_id || '').trim(); if (!cid) throw new Error('customer_id_required');
          u.searchParams.set('customer', cid);
          const lim = Number(args.limit || 5); if (isFinite(lim)) u.searchParams.set('limit', String(Math.max(1, Math.min(100, lim))));
          const headers = { Accept: 'application/json' };
          try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
          try { const sk = String(opt.secret_key || opt.api_key || '').trim(); if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`; const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver; const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct; } catch {}
          const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
          try {
            const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
            const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
            return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), body: json ?? text };
          } finally { try { clearTimeout(timer); } catch {} }
        })();
      }
    },
    // Convenience: Stripe get a single payment intent (transaction)
    { name: 'stripe.get_transaction', description: 'Retrieve a single payment intent by ID', inputSchema: { type: 'object', properties: { transaction_id: { type: 'string', description: 'Payment Intent ID (pi_...)' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['transaction_id'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!rr.rowCount) throw new Error('server_not_found');
        let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
        const tid = String(args.transaction_id || '').trim(); if (!tid) throw new Error('transaction_id_required');
        const u = new URL(base + `/v1/payment_intents/${encodeURIComponent(tid)}`);
        const headers = { Accept: 'application/json' };
        try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        try { const sk = String(opt.secret_key || opt.api_key || '').trim(); if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`; const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver; const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct; } catch {}
        const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
          const text = await r.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
          const summary = body && body.id ? { id: body.id, status: body.status || null, amount: body.amount || null, currency: body.currency || null, customer: body.customer || null } : null;
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), summary, body: body ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Convenience: Stripe get failed payments for a customer
    { name: 'stripe.get_failed_payments', description: 'List recent failed or problematic payment intents for a customer', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID (cus_...)' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['customer_id'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!rr.rowCount) throw new Error('server_not_found');
        let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
        // Fetch recent payment intents then filter client-side for problematic ones
        const u = new URL(base + '/v1/payment_intents');
        const cid = String(args.customer_id || '').trim(); if (!cid) throw new Error('customer_id_required');
        u.searchParams.set('customer', cid);
        const lim = Number(args.limit || 10); if (isFinite(lim)) u.searchParams.set('limit', String(Math.max(1, Math.min(100, lim))));
        const headers = { Accept: 'application/json' };
        try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        try { const sk = String(opt.secret_key || opt.api_key || '').trim(); if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`; const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver; const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct; } catch {}
        const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
          const text = await r.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
          let items = (body && Array.isArray(body.data)) ? body.data : [];
          // Problematic when canceled, or requires_payment_method with last_payment_error, or last_payment_error present
          const failed = items.filter(pi => {
            try {
              if (!pi) return false;
              if (pi.status === 'canceled') return true;
              if (pi.status === 'requires_payment_method' && pi.last_payment_error) return true;
              if (pi.last_payment_error) return true;
              // Also consider requires_action with last_payment_error
              if (pi.status === 'requires_action' && pi.last_payment_error) return true;
              return false;
            } catch { return false; }
          });
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), total: items.length, failed_count: failed.length, failed, body: body ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // PrestaShop (MariaDB/MySQL) — list products with filters and pagination
    { name: 'psdb.products.list', description: 'List PrestaShop products from the shop database (pagination + optional filters: category, availability, price range). Requires this MCP server to be of type database with connection options.', inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1, default: 1 }, page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, category_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, available: { type: 'boolean' }, price_min: { type: 'number' }, price_max: { type: 'number' }, lang_id: { type: 'integer', description: 'PrestaShop language id (id_lang)' }, shop_id: { type: 'integer', description: 'PrestaShop shop id (id_shop)' }, order_by: { type: 'string', enum: ['id','name','price','stock'], default: 'id' }, order_dir: { type: 'string', enum: ['asc','desc'], default: 'desc' } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required (use /mcp/:name/stream)');
        // Load server DB connection options
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const idLang = Number(args.lang_id || opt.lang_id || 1);
        const tables = {
          product: `${prefix}product`,
          product_lang: `${prefix}product_lang`,
          stock: `${prefix}stock_available`,
          cat_product: `${prefix}category_product`,
        };
        // Build filters
        const page = Math.max(1, Number(args.page || 1));
        const pageSize = Math.max(1, Math.min(100, Number(args.page_size || 20)));
        const where = [];
        const params = [];
        const whereCount = [];
        // category filter
        const hasCategory = args.category_id != null && String(args.category_id).trim() !== '';
        if (hasCategory) { where.push(`cp.id_category = ?`); whereCount.push(`cp.id_category = ?`); params.push(Number(args.category_id)); }
        // available filter (active + stock > 0)
        if (args.available === true) { where.push(`p.active = 1`); whereCount.push(`p.active = 1`); where.push(`(COALESCE(sa.quantity,0) > 0)`); whereCount.push(`(COALESCE(sa.quantity,0) > 0)`); }
        if (args.available === false) { where.push(`(p.active = 0 OR COALESCE(sa.quantity,0) <= 0)`); whereCount.push(`(p.active = 0 OR COALESCE(sa.quantity,0) <= 0)`); }
        if (args.price_min != null) { where.push(`p.price >= ?`); whereCount.push(`p.price >= ?`); params.push(Number(args.price_min)); }
        if (args.price_max != null) { where.push(`p.price <= ?`); whereCount.push(`p.price <= ?`); params.push(Number(args.price_max)); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const whereSqlCount = whereCount.length ? `WHERE ${whereCount.join(' AND ')}` : '';
        // Ordering
        const ob = String(args.order_by || 'id').toLowerCase();
        const od = String(args.order_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        let orderExpr = 'p.id_product';
        if (ob === 'name') orderExpr = 'pl.name';
        else if (ob === 'price') orderExpr = 'p.price';
        else if (ob === 'stock') orderExpr = 'stock_qty';
        const offset = (page - 1) * pageSize;

        // Connect to MariaDB/MySQL
        const mysql = await import('mysql2/promise');
        // Prefer full URL if provided
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          // Count
          const sqlCount = `SELECT COUNT(DISTINCT p.id_product) AS n
            FROM ${tables.product} p
            LEFT JOIN ${tables.stock} sa ON sa.id_product = p.id_product
            ${hasCategory ? `LEFT JOIN ${tables.cat_product} cp ON cp.id_product = p.id_product` : ''}
            ${whereSqlCount}`;
          const [countRows] = await conn.execute(sqlCount, params);
          const total = Number((countRows && countRows[0] && countRows[0].n) || 0);

          // Page rows
          const sql = `SELECT p.id_product AS id, p.reference, p.ean13, p.active, p.price,
              COALESCE(MAX(sa.quantity),0) AS stock_qty,
              MAX(pl.name) AS name
            FROM ${tables.product} p
            LEFT JOIN ${tables.product_lang} pl ON pl.id_product = p.id_product AND pl.id_lang = ?
            LEFT JOIN ${tables.stock} sa ON sa.id_product = p.id_product
            ${hasCategory ? `LEFT JOIN ${tables.cat_product} cp ON cp.id_product = p.id_product` : ''}
            ${whereSql}
            GROUP BY p.id_product, p.reference, p.ean13, p.active, p.price
            ORDER BY ${orderExpr} ${od}
            LIMIT ? OFFSET ?`;
          const args2 = [idLang, ...params, pageSize, offset];
          const [rows] = await conn.execute(sql, args2);
          return { page, page_size: pageSize, total, items: rows };
        } finally {
          try { await conn.end(); } catch {}
        }
      }
    },
    // PrestaShop Webservice (API) — Product tools
    { name: 'psapi.products.get', description: 'Get product details by id or reference via PrestaShop API', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, reference: { type: 'string' }, base_url: { type: 'string' }, api_key: { type: 'string' } }, oneOf: [ { required: ['id'] }, { required: ['reference'] } ] }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
        let data;
        if (args.id != null && String(args.id).trim() !== '') data = await client.getProduct(String(args.id).trim());
        else data = await client.getProductByReference(String(args.reference || '').trim());
        const products = normalizePrestaCollection(data, 'products');
        const p = products[0] || null;
        if (!p) return { product: null };
        let stockQty = null;
        try {
          const stock = await client.getStockByProductId(p.id);
          const sas = normalizePrestaCollection(stock, 'stock_availables');
          stockQty = sas.reduce((acc, s) => acc + Number(s.quantity || 0), 0);
        } catch {}
        const images = [];
        try {
          const assoc = p.associations || {};
          const arr = Array.isArray(assoc.images) ? assoc.images : (assoc.images && assoc.images.image ? (Array.isArray(assoc.images.image) ? assoc.images.image : [assoc.images.image]) : []);
          for (const it of arr) {
            const idImg = Number(it.id || it.id_image || it.idImage || 0);
            if (!idImg) continue;
            images.push({ id: idImg, url: `${cfg.base_url.replace(/\/$/, '')}/api/images/products/${p.id}/${idImg}?ws_key=${cfg.api_key}` });
          }
        } catch {}
        return {
          id: Number(p.id),
          reference: String(p.reference || ''),
          name: p.name,
          description: p.description,
          price: Number(p.price || 0),
          active: !!Number(p.active || 0),
          seo: { meta_title: p.meta_title, meta_description: p.meta_description, link_rewrite: p.link_rewrite },
          stock: stockQty,
          images,
          raw: p,
        };
      }
    },
    { name: 'psapi.products.search', description: 'Search products by name or reference (SKU) via PrestaShop API', inputSchema: { type: 'object', properties: { query: { type: 'string' }, reference: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, base_url: { type: 'string' }, api_key: { type: 'string' } } }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
        const outMap = new Map();
        if (String(args.reference || '').trim()) {
          const r = await client.getProductByReference(String(args.reference).trim());
          for (const p of normalizePrestaCollection(r, 'products')) {
            outMap.set(String(p.id), { id: Number(p.id), reference: p.reference || '', name: p.name, price: Number(p.price || 0), active: !!Number(p.active || 0) });
          }
        }
        if (String(args.query || '').trim()) {
          const r2 = await client.findProductsByName(String(args.query).trim(), Math.max(1, Math.min(100, Number(args.limit || 20))));
          for (const p of normalizePrestaCollection(r2, 'products')) {
            if (!outMap.has(String(p.id))) outMap.set(String(p.id), { id: Number(p.id), reference: p.reference || '', name: p.name, price: Number(p.price || 0), active: !!Number(p.active || 0) });
          }
        }
        const items = Array.from(outMap.values()).slice(0, Math.max(1, Math.min(100, Number(args.limit || 20))));
        return { count: items.length, items };
      }
    },
    { name: 'psapi.products.update_price', description: 'Update a product price by id or reference (requires auth if configured)', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, reference: { type: 'string' }, price: { type: 'number' }, base_url: { type: 'string' }, api_key: { type: 'string' } }, required: ['price'], oneOf: [ { required: ['id'] }, { required: ['reference'] } ] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const cfg = await resolvePrestaConfig(args, ctx);
        // Resolve id if reference provided
        let id = args.id != null && String(args.id).trim() !== '' ? String(args.id).trim() : null;
        if (!id && String(args.reference || '').trim()) {
          const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
          const r = await client.getProductByReference(String(args.reference).trim());
          const p = normalizePrestaCollection(r, 'products')[0];
          if (!p) throw new Error('product_not_found');
          id = String(p.id);
        }
        const body = { product: { id: Number(id), price: Number(args.price) } };
        const res = await prestaRequest(cfg, { method: 'PUT', resource: 'products', id, body });
        return { ok: true, id: Number(id), updated: { price: Number(args.price) }, response: res };
      }
    },
    { name: 'psapi.products.set_active', description: 'Enable or disable a product (active) by id or reference', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, reference: { type: 'string' }, active: { type: 'boolean' }, base_url: { type: 'string' }, api_key: { type: 'string' } }, required: ['active'], oneOf: [ { required: ['id'] }, { required: ['reference'] } ] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const cfg = await resolvePrestaConfig(args, ctx);
        let id = args.id != null && String(args.id).trim() !== '' ? String(args.id).trim() : null;
        if (!id && String(args.reference || '').trim()) {
          const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
          const r = await client.getProductByReference(String(args.reference).trim());
          const p = normalizePrestaCollection(r, 'products')[0];
          if (!p) throw new Error('product_not_found');
          id = String(p.id);
        }
        const body = { product: { id: Number(id), active: args.active ? 1 : 0 } };
        const res = await prestaRequest(cfg, { method: 'PUT', resource: 'products', id, body });
        return { ok: true, id: Number(id), updated: { active: !!args.active }, response: res };
      }
    },
    // Stock tools
    { name: 'psapi.stock.get', description: 'Get stock levels for a product id', inputSchema: { type: 'object', properties: { product_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, base_url: { type: 'string' }, api_key: { type: 'string' } }, required: ['product_id'] }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
        const r = await client.getStockByProductId(String(args.product_id).trim());
        const rows = normalizePrestaCollection(r, 'stock_availables').map(s => ({ id: Number(s.id), id_product: Number(s.id_product), id_product_attribute: Number(s.id_product_attribute || 0), quantity: Number(s.quantity || 0), id_shop: Number(s.id_shop || 0), id_shop_group: Number(s.id_shop_group || 0) }));
        const total = rows.reduce((a, b) => a + (b.quantity || 0), 0);
        return { total, rows };
      }
    },
    { name: 'psapi.stock.update', description: 'Update stock quantity for a product (updates the default stock_available row)', inputSchema: { type: 'object', properties: { product_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, quantity: { type: 'integer' }, base_url: { type: 'string' }, api_key: { type: 'string' } }, required: ['product_id','quantity'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const cfg = await resolvePrestaConfig(args, ctx);
        // Load stock rows to find default row (attribute 0)
        const urlParams = { 'filter[id_product]': `[${String(args.product_id).trim()}]` };
        const list = await prestaRequest(cfg, { method: 'GET', resource: 'stock_availables', params: urlParams });
        const rows = normalizePrestaCollection(list, 'stock_availables');
        if (!rows.length) throw new Error('stock_row_not_found');
        let row = rows.find(r => Number(r.id_product_attribute || 0) === 0) || rows[0];
        const id = String(row.id);
        const body = { stock_available: { id: Number(id), id_product: Number(row.id_product), id_product_attribute: Number(row.id_product_attribute || 0), quantity: Number(args.quantity), id_shop: Number(row.id_shop || 0), id_shop_group: Number(row.id_shop_group || 0) } };
        const res = await prestaRequest(cfg, { method: 'PUT', resource: 'stock_availables', id, body });
        return { ok: true, id: Number(id), product_id: Number(row.id_product), quantity: Number(args.quantity), response: res };
      }
    },
    { name: 'psapi.stock.low', description: 'List low-stock products under a threshold', inputSchema: { type: 'object', properties: { threshold: { type: 'integer', default: 5 }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, base_url: { type: 'string' }, api_key: { type: 'string' } } }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const thr = Math.max(0, Number(args.threshold || 5));
        const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
        const list = await prestaRequest(cfg, { method: 'GET', resource: 'stock_availables', params: { 'filter[quantity]': `[0,${thr}]`, limit: String(limit) } });
        const rows = normalizePrestaCollection(list, 'stock_availables').map(x => ({ id: Number(x.id), id_product: Number(x.id_product), id_product_attribute: Number(x.id_product_attribute || 0), quantity: Number(x.quantity || 0) }));
        return { threshold: thr, count: rows.length, items: rows };
      }
    },
    // Order tools
    { name: 'psapi.orders.list', description: 'List recent orders with optional filters (date range, state_id, reference, customer). Uses server-configured PrestaShop credentials; do not pass base_url/api_key.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, date_from: { type: 'string' }, date_to: { type: 'string' }, state_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, customer_email: { type: 'string' }, reference: { type: 'string' } } }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
        const limit = Math.max(1, Math.min(100, Number(args.limit || 20)));
        const ref = String(args.reference || '').trim();
        let customerId = null;
        if (String(args.customer_email || '').trim()) {
          const r = await client.getCustomerByEmail(String(args.customer_email).trim());
          const c = normalizePrestaCollection(r, 'customers')[0];
          customerId = c ? c.id : null;
        }
        let ordersRaw;
        try {
          // Primary path: use API filtering if available
          ordersRaw = await client.listOrders({
            customerId,
            reference: ref || undefined,
            dateFrom: String(args.date_from || '').trim() || undefined,
            dateTo: String(args.date_to || '').trim() || undefined,
            limit,
          });
        } catch (e) {
          // Fallback for shops that don’t allow some filters (e.g., reference) (Presta error code 38)
          const msg = String(e?.message || '');
          const filterUnsupported = /Unable to filter by this field/i.test(msg) || /code\"?:\s*38/.test(msg);
          if (filterUnsupported) {
            const wideLimit = Math.max(limit, 100);
            // Retry with a raw request that does not include any filter/sort params to avoid WS restrictions
            const retry = await prestaRequest(cfg, { method: 'GET', resource: 'orders', params: { display: 'full', limit: String(wideLimit) } });
            let arr = normalizePrestaCollection(retry, 'orders');
            // Client-side reference filter
            if (ref) arr = arr.filter(o => String(o.reference || '') === ref);
            // Client-side date_add filter
            const df = String(args.date_from || '').trim();
            const dt = String(args.date_to || '').trim();
            if (df || dt) {
              const fromMs = df ? Date.parse(df) : null;
              const toMs = dt ? Date.parse(dt) : null;
              arr = arr.filter(o => {
                const t = Date.parse(String(o.date_add || ''));
                if (Number.isNaN(t)) return false;
                if (fromMs != null && t < fromMs) return false;
                if (toMs != null && t > toMs) return false;
                return true;
              });
            }
            ordersRaw = { orders: arr };
          } else {
            throw e;
          }
        }
        let orders = normalizePrestaCollection(ordersRaw, 'orders');
        if (args.state_id != null && String(args.state_id).trim() !== '') {
          const want = Number(args.state_id);
          orders = orders.filter(o => Number(o.current_state) === want);
        }
        // Sort newest first by date_add when available, then trim to limit
        try {
          orders.sort((a, b) => {
            const ta = Date.parse(String(a?.date_add || '')) || 0;
            const tb = Date.parse(String(b?.date_add || '')) || 0;
            return tb - ta;
          });
        } catch {}
        orders = orders.slice(0, limit);
        const items = orders.map(o => ({ id: Number(o.id), reference: o.reference, id_customer: Number(o.id_customer), total_paid: Number(o.total_paid || 0), currency: o.id_currency ? Number(o.id_currency) : null, current_state: Number(o.current_state || 0), date_add: o.date_add }));
        return { count: items.length, items };
      }
    },
    { name: 'psapi.orders.get', description: 'Get order details by id or reference. Uses server-configured PrestaShop credentials; do not pass base_url/api_key.', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, reference: { type: 'string' } }, oneOf: [ { required: ['id'] }, { required: ['reference'] } ] }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
        const idVal = args.id != null && String(args.id).trim() !== '' ? String(args.id).trim() : '';
        const ref = String(args.reference || '').trim();
        let data;
        if (idVal) {
          data = await client.getOrder(idVal);
        } else {
          try {
            data = await client.getOrderByReference(ref);
          } catch (e) {
            const msg = String(e?.message || '');
            const refFilterUnsupported = /Unable to filter by this field/i.test(msg) || /code\"?:\s*38/.test(msg);
            if (ref && refFilterUnsupported) {
              // Fallback: fetch recent orders and match by reference
              const retry = await client.listOrders({ limit: 100 });
              const arr = normalizePrestaCollection(retry, 'orders');
              const found = arr.find(o => String(o.reference || '') === ref);
              data = found ? { orders: [found] } : { orders: [] };
            } else {
              throw e;
            }
          }
        }
        const orders = normalizePrestaCollection(data, 'orders');
        const o = orders[0] || null;
        if (!o) return { order: null };
        const summary = { id: Number(o.id), reference: o.reference, id_customer: Number(o.id_customer), total_paid: Number(o.total_paid || 0), total_products: Number(o.total_products || 0), total_shipping: Number(o.total_shipping || 0), current_state: Number(o.current_state || 0), date_add: o.date_add, invoice_number: o.invoice_number };
        return { order: summary, raw: o };
      }
    },
    { name: 'psapi.orders.update_status', description: 'Update order status by creating an order_history row. Uses server-configured PrestaShop credentials; do not pass base_url/api_key. (Requires auth if configured)', inputSchema: { type: 'object', properties: { id_order: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, state_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] } }, required: ['id_order','state_id'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const cfg = await resolvePrestaConfig(args, ctx);
        const body = { order_history: { id_order: Number(args.id_order), id_order_state: Number(args.state_id) } };
        const res = await prestaRequest(cfg, { method: 'POST', resource: 'order_histories', body });
        return { ok: true, id_order: Number(args.id_order), new_state: Number(args.state_id), response: res };
      }
    },
    { name: 'psapi.orders.search', description: 'Search orders by customer email, id, reference or date range. Uses server-configured PrestaShop credentials; do not pass base_url/api_key.', inputSchema: { type: 'object', properties: { customer_email: { type: 'string' }, id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, reference: { type: 'string' }, date_from: { type: 'string' }, date_to: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } } }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
        const limit = Math.max(1, Math.min(100, Number(args.limit || 20)));
        let customerId = null;
        if (String(args.customer_email || '').trim()) {
          const r = await client.getCustomerByEmail(String(args.customer_email).trim());
          const c = normalizePrestaCollection(r, 'customers')[0];
          customerId = c ? c.id : null;
        }
        let orders;
        if (args.id != null && String(args.id).trim() !== '') {
          const o = await client.getOrder(String(args.id).trim());
          orders = normalizePrestaCollection(o, 'orders');
        } else if (String(args.reference || '').trim()) {
          const o = await client.getOrderByReference(String(args.reference).trim());
          orders = normalizePrestaCollection(o, 'orders');
        } else {
          const o = await client.listOrders({ customerId, dateFrom: String(args.date_from || '').trim() || undefined, dateTo: String(args.date_to || '').trim() || undefined, limit });
          orders = normalizePrestaCollection(o, 'orders');
        }
        const items = (orders || []).slice(0, limit).map(o => ({ id: Number(o.id), reference: o.reference, id_customer: Number(o.id_customer), total_paid: Number(o.total_paid || 0), current_state: Number(o.current_state || 0), date_add: o.date_add }));
        return { count: items.length, items };
      }
    },
    // Customer tools
    { name: 'psapi.customers.list', description: 'List customers; filter by newsletter (subscribed) or date range for new customers. Uses server-configured PrestaShop credentials; do not pass base_url/api_key.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, subscribed: { type: 'boolean' }, date_from: { type: 'string' }, date_to: { type: 'string' } } }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const limit = Math.max(1, Math.min(100, Number(args.limit || 20)));
        const params = { display: 'full', limit: String(limit) };
        if (args.subscribed === true) params['filter[newsletter]'] = '[1]';
        if (String(args.date_from || '').trim() || String(args.date_to || '').trim()) {
          const from = String(args.date_from || '').trim();
          const to = String(args.date_to || '').trim();
          if (from && to) params['filter[date_add]'] = `[${from},${to}]`;
          else if (from) params['filter[date_add]'] = `[${from},]`;
          else params['filter[date_add]'] = `[,${to}]`;
        }
        try {
          const res = await prestaRequest(cfg, { method: 'GET', resource: 'customers', params });
          const items = normalizePrestaCollection(res, 'customers').map(c => ({ id: Number(c.id), email: c.email, firstname: c.firstname, lastname: c.lastname, newsletter: !!Number(c.newsletter || 0), active: !!Number(c.active || 0), date_add: c.date_add }));
          // Sort newest first by date_add if present
          items.sort((a,b)=>{ const ta=Date.parse(String(a.date_add||''))||0; const tb=Date.parse(String(b.date_add||''))||0; return tb-ta; });
          return { count: items.length, items: items.slice(0, limit) };
        } catch (e) {
          const msg = String(e?.message || '');
          const filterUnsupported = /Unable to filter by this field/i.test(msg) || /code\"?:\s*38/.test(msg);
          if (!filterUnsupported) throw e;
          // Fallback: fetch without filters, then filter and sort client-side
          const wideLimit = Math.max(limit, 100);
          const res2 = await prestaRequest(cfg, { method: 'GET', resource: 'customers', params: { display: 'full', limit: String(wideLimit) } });
          let arr = normalizePrestaCollection(res2, 'customers');
          if (args.subscribed === true) arr = arr.filter(c => Number(c.newsletter||0) === 1);
          const df = String(args.date_from || '').trim();
          const dt = String(args.date_to || '').trim();
          if (df || dt) {
            const fromMs = df ? Date.parse(df) : null;
            const toMs = dt ? Date.parse(dt) : null;
            arr = arr.filter(c => {
              const t = Date.parse(String(c.date_add || ''));
              if (Number.isNaN(t)) return false;
              if (fromMs != null && t < fromMs) return false;
              if (toMs != null && t > toMs) return false;
              return true;
            });
          }
          arr.sort((a,b)=>{ const ta=Date.parse(String(a.date_add||''))||0; const tb=Date.parse(String(b.date_add||''))||0; return tb-ta; });
          const items = arr.slice(0, limit).map(c => ({ id: Number(c.id), email: c.email, firstname: c.firstname, lastname: c.lastname, newsletter: !!Number(c.newsletter || 0), active: !!Number(c.active || 0), date_add: c.date_add }));
          return { count: items.length, items };
        }
      }
    },
    { name: 'psapi.customers.get', description: 'Get customer details by id or email. Uses server-configured PrestaShop credentials; do not pass base_url/api_key.', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, email: { type: 'string' } }, oneOf: [ { required: ['id'] }, { required: ['email'] } ] }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
        let data;
        if (args.id != null && String(args.id).trim() !== '') data = await client.getCustomer(String(args.id).trim());
        else data = await client.getCustomerByEmail(String(args.email || '').trim());
        const cs = normalizePrestaCollection(data, 'customers');
        const c = cs[0] || null;
        return { customer: c ? pick(c, ['id','email','firstname','lastname','active','newsletter','date_add','id_default_group']) : null, raw: c };
      }
    },
    { name: 'psapi.customers.search', description: 'Search customers by name or email. Uses server-configured PrestaShop credentials; do not pass base_url/api_key.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, firstname: { type: 'string' }, lastname: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } } }, run: async (args = {}, ctx = {}) => {
        const cfg = await resolvePrestaConfig(args, ctx);
        const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
        const r = await client.searchCustomers({ email: String(args.email || '').trim() || undefined, firstname: String(args.firstname || '').trim() || undefined, lastname: String(args.lastname || '').trim() || undefined, name: String(args.name || '').trim() || undefined, limit: Math.max(1, Math.min(100, Number(args.limit || 20))) });
        const items = normalizePrestaCollection(r, 'customers').map(c => ({ id: Number(c.id), email: c.email, firstname: c.firstname, lastname: c.lastname, active: !!Number(c.active || 0), newsletter: !!Number(c.newsletter || 0) }));
        return { count: items.length, items };
      }
    },
    { name: 'psapi.customers.update', description: 'Update customer fields (newsletter, active). Uses server-configured PrestaShop credentials; do not pass base_url/api_key. Requires auth if configured.', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, email: { type: 'string' }, newsletter: { type: 'boolean' }, active: { type: 'boolean' } }, oneOf: [ { required: ['id'] }, { required: ['email'] } ] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const cfg = await resolvePrestaConfig(args, ctx);
        let id = args.id != null && String(args.id).trim() !== '' ? String(args.id).trim() : null;
        if (!id && String(args.email || '').trim()) {
          const client = createPrestaClient({ baseURL: cfg.base_url, apiKey: cfg.api_key });
          const r = await client.getCustomerByEmail(String(args.email).trim());
          const c = normalizePrestaCollection(r, 'customers')[0];
          if (!c) throw new Error('customer_not_found');
          id = String(c.id);
        }
        const body = { customer: { id: Number(id) } };
        if (args.newsletter != null) body.customer.newsletter = args.newsletter ? 1 : 0;
        if (args.active != null) body.customer.active = args.active ? 1 : 0;
        const res = await prestaRequest(cfg, { method: 'PUT', resource: 'customers', id, body });
        return { ok: true, id: Number(id), updated: pick(body.customer, ['newsletter','active']), response: res };
      }
    },
    // Analytics & reporting via database
    { name: 'psdb.analytics.sales_report', description: 'Sales totals grouped by day/week/month from PrestaShop database', inputSchema: { type: 'object', properties: { period: { type: 'string', enum: ['day','week','month'], default: 'day' }, date_from: { type: 'string' }, date_to: { type: 'string' } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const tables = { orders: `${prefix}orders` };
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const period = String(args.period || 'day').toLowerCase();
          let fmt = '%Y-%m-%d';
          if (period === 'week') fmt = '%x-W%v';
          if (period === 'month') fmt = '%Y-%m';
          const where = [];
          const params = [];
          if (String(args.date_from || '').trim()) { where.push(`date_add >= ?`); params.push(String(args.date_from).trim()); }
          if (String(args.date_to || '').trim()) { where.push(`date_add <= ?`); params.push(String(args.date_to).trim()); }
          const sql = `SELECT DATE_FORMAT(date_add, '${fmt}') AS period, SUM(total_paid_tax_incl) AS total, COUNT(*) AS orders
                       FROM ${tables.orders}
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       GROUP BY 1 ORDER BY 1`;
          const [rows] = await conn.execute(sql, params);
          return { period, rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    { name: 'psdb.analytics.best_sellers', description: 'Best-selling products by quantity in a period (database)', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, date_from: { type: 'string' }, date_to: { type: 'string' } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const t = { orders: `${prefix}orders`, od: `${prefix}order_detail`, pl: `${prefix}product_lang` };
        const idLang = Number(opt.lang_id || 1);
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          if (String(args.date_from || '').trim()) { where.push(`o.date_add >= ?`); params.push(String(args.date_from).trim()); }
          if (String(args.date_to || '').trim()) { where.push(`o.date_add <= ?`); params.push(String(args.date_to).trim()); }
          const limit = Math.max(1, Math.min(200, Number(args.limit || 20)));
          const sql = `SELECT od.product_id AS id_product, MAX(od.product_reference) AS reference, MAX(pl.name) AS name, SUM(od.product_quantity) AS qty
                       FROM ${t.od} od
                       JOIN ${t.orders} o ON o.id_order = od.id_order
                       LEFT JOIN ${t.pl} pl ON pl.id_product = od.product_id AND pl.id_lang = ?
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       GROUP BY od.product_id
                       ORDER BY qty DESC
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql, [idLang, ...params]);
          return { items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    { name: 'psdb.analytics.clv', description: 'Customer lifetime value summary (database)', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, date_from: { type: 'string' }, date_to: { type: 'string' } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const t = { orders: `${prefix}orders`, customers: `${prefix}customer` };
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          if (String(args.date_from || '').trim()) { where.push(`o.date_add >= ?`); params.push(String(args.date_from).trim()); }
          if (String(args.date_to || '').trim()) { where.push(`o.date_add <= ?`); params.push(String(args.date_to).trim()); }
          const limit = Math.max(1, Math.min(200, Number(args.limit || 20)));
          const sql = `SELECT o.id_customer, MAX(c.email) AS email, MAX(CONCAT(c.firstname,' ',c.lastname)) AS name, COUNT(*) AS orders, SUM(o.total_paid_tax_incl) AS total_paid
                       FROM ${t.orders} o
                       LEFT JOIN ${t.customers} c ON c.id_customer = o.id_customer
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       GROUP BY o.id_customer
                       ORDER BY total_paid DESC
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql, params);
          return { items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Order states (labels) — expose ps_order_state_lang for UI mappings
    { name: 'psdb.order_state_lang.list', description: 'List PrestaShop order state labels from the database (ps_order_state_lang). Filter by language, state id or name substring.', inputSchema: { type: 'object', properties: { id_lang: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, id_order_state: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, name_like: { type: 'string' }, order: { type: 'string', enum: ['asc','desc'], default: 'asc' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          if (args.id_lang != null && String(args.id_lang).trim() !== '') { where.push('osl.id_lang = ?'); params.push(Number(args.id_lang)); }
          if (args.id_order_state != null && String(args.id_order_state).trim() !== '') { where.push('osl.id_order_state = ?'); params.push(Number(args.id_order_state)); }
          if (String(args.name_like || '').trim()) { where.push('osl.name LIKE ?'); params.push(`%${String(args.name_like).trim()}%`); }
          const orderDir = String(args.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
          const limit = Math.max(1, Math.min(500, Number(args.limit || 200)));
          const sql = `SELECT osl.id_order_state, osl.id_lang, osl.name
                       FROM ${prefix}order_state_lang osl
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       ORDER BY osl.id_order_state ${orderDir}, osl.id_lang ${orderDir}
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql, params);
          return { count: (rows||[]).length, items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    { name: 'psdb.order_state_lang.get', description: 'Get label(s) for a given order state id from ps_order_state_lang. If id_lang is omitted, returns all languages.', inputSchema: { type: 'object', properties: { id_order_state: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, id_lang: { anyOf: [{ type: 'integer' }, { type: 'string' }] } }, required: ['id_order_state'] }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const idState = Number(args.id_order_state);
          const hasLang = args.id_lang != null && String(args.id_lang).trim() !== '';
          const sql = `SELECT id_order_state, id_lang, name FROM ${prefix}order_state_lang WHERE id_order_state = ? ${hasLang ? 'AND id_lang = ?' : ''} ORDER BY id_lang ASC`;
          const params = hasLang ? [idState, Number(args.id_lang)] : [idState];
          const [rows] = await conn.execute(sql, params);
          if (hasLang) {
            const rec = rows && rows[0] ? rows[0] : null;
            return { id_order_state: idState, id_lang: Number(args.id_lang), name: rec ? rec.name : null };
          }
          return { id_order_state: idState, labels: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    { name: 'psdb.order_states.labels', description: 'Join ps_order_state with ps_order_state_lang to get flags (paid/shipped/delivery/...) and localized names.', inputSchema: { type: 'object', properties: { id_lang: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, id_order_state: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, name_like: { type: 'string' }, order: { type: 'string', enum: ['asc','desc'], default: 'asc' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 500 } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          if (args.id_lang != null && String(args.id_lang).trim() !== '') { where.push('osl.id_lang = ?'); params.push(Number(args.id_lang)); }
          if (args.id_order_state != null && String(args.id_order_state).trim() !== '') { where.push('os.id_order_state = ?'); params.push(Number(args.id_order_state)); }
          if (String(args.name_like || '').trim()) { where.push('osl.name LIKE ?'); params.push(`%${String(args.name_like).trim()}%`); }
          const orderDir = String(args.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
          const limit = Math.max(1, Math.min(500, Number(args.limit || 500)));
          const sql = `SELECT os.id_order_state, os.paid, os.shipped, os.delivery, os.logable, os.sent_email, os.invoice, os.color, osl.id_lang, osl.name
                       FROM ${prefix}order_state os
                       JOIN ${prefix}order_state_lang osl ON osl.id_order_state = os.id_order_state
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       ORDER BY os.id_order_state ${orderDir}, osl.id_lang ${orderDir}
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql, params);
          return { count: (rows||[]).length, items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    { name: 'psdb.carts.abandoned', description: 'Abandoned carts (no corresponding order) older than a threshold', inputSchema: { type: 'object', properties: { minutes_ago: { type: 'integer', default: 60 }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const t = { cart: `${prefix}cart`, orders: `${prefix}orders`, cp: `${prefix}cart_product` };
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
          const minutesAgo = Math.max(1, Number(args.minutes_ago || 60));
          const sql = `SELECT c.id_cart, c.id_customer, c.date_add, c.date_upd,
                              (SELECT SUM(cp.quantity) FROM ${t.cp} cp WHERE cp.id_cart = c.id_cart) AS total_items
                       FROM ${t.cart} c
                       LEFT JOIN ${t.orders} o ON o.id_cart = c.id_cart
                       WHERE o.id_order IS NULL AND c.date_upd < (NOW() - INTERVAL ${minutesAgo} MINUTE)
                       ORDER BY c.date_upd DESC
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql);
          return { count: rows.length, items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // ===================== DB-only PrestaShop tools (MariaDB/MySQL) =====================
    // Products: get full details by id or reference
    { name: 'psdb.products.get', description: 'Get product details from PrestaShop database (name, descriptions, price, stock, SEO, images)', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, reference: { type: 'string' }, id_lang: { type: 'integer' } }, oneOf: [ { required: ['id'] }, { required: ['reference'] } ] }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const idLang = Number(args.id_lang || opt.lang_id || 1);
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [idLang];
          if (args.id != null && String(args.id).trim() !== '') { where.push('p.id_product = ?'); params.push(Number(args.id)); }
          else { where.push('p.reference = ?'); params.push(String(args.reference)); }
          const sql = `SELECT p.id_product AS id, p.reference, p.ean13, p.active, p.price,
                             COALESCE(SUM(sa.quantity),0) AS stock_qty,
                             MAX(pl.name) AS name,
                             MAX(pl.description) AS description,
                             MAX(pl.description_short) AS description_short,
                             MAX(pl.link_rewrite) AS link_rewrite,
                             MAX(pl.meta_title) AS meta_title,
                             MAX(pl.meta_description) AS meta_description
                      FROM ${prefix}product p
                      LEFT JOIN ${prefix}product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
                      LEFT JOIN ${prefix}stock_available sa ON sa.id_product = p.id_product
                      WHERE ${where.join(' AND ')}
                      GROUP BY p.id_product, p.reference, p.ean13, p.active, p.price`;
          const [rows] = await conn.execute(sql, params);
          if (!rows.length) return { product: null };
          const p = rows[0];
          const [imgRows] = await conn.execute(`SELECT id_image, position, cover FROM ${prefix}image WHERE id_product = ? ORDER BY position ASC`, [p.id]);
          const images = [];
          const makePath = (id) => {
            const s = String(id);
            return `img/p/${s.split('').join('/')}/${s}.jpg`;
          };
          for (const im of imgRows) {
            images.push({ id: Number(im.id_image), position: Number(im.position || 0), cover: !!Number(im.cover || 0), relative_url: makePath(im.id_image) });
          }
          return {
            id: Number(p.id), reference: p.reference || '', ean13: p.ean13 || '',
            name: p.name, description: p.description, description_short: p.description_short,
            price: Number(p.price || 0), active: !!Number(p.active || 0), stock: Number(p.stock_qty || 0),
            seo: { meta_title: p.meta_title, meta_description: p.meta_description, link_rewrite: p.link_rewrite },
            images,
          };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Products: search with keyword/reference and filters
    { name: 'psdb.products.search', description: 'Search products in DB by name or SKU/reference with optional filters', inputSchema: { type: 'object', properties: { query: { type: 'string' }, reference: { type: 'string' }, category_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, available: { type: 'boolean' }, price_min: { type: 'number' }, price_max: { type: 'number' }, id_lang: { type: 'integer' }, page: { type: 'integer', minimum: 1, default: 1 }, page_size: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, order_by: { type: 'string', enum: ['id','name','price','stock'], default: 'id' }, order_dir: { type: 'string', enum: ['asc','desc'], default: 'desc' } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const idLang = Number(args.id_lang || opt.lang_id || 1);
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const page = Math.max(1, Number(args.page || 1));
          const pageSize = Math.max(1, Math.min(100, Number(args.page_size || 20)));
          const where = [];
          const params = [];
          const whereCount = [];
          const hasCategory = args.category_id != null && String(args.category_id).trim() !== '';
          if (hasCategory) { where.push(`cp.id_category = ?`); whereCount.push(`cp.id_category = ?`); params.push(Number(args.category_id)); }
          if (args.available === true) { where.push(`p.active = 1`); whereCount.push(`p.active = 1`); where.push(`(COALESCE(sa.quantity,0) > 0)`); whereCount.push(`(COALESCE(sa.quantity,0) > 0)`); }
          if (args.available === false) { where.push(`(p.active = 0 OR COALESCE(sa.quantity,0) <= 0)`); whereCount.push(`(p.active = 0 OR COALESCE(sa.quantity,0) <= 0)`); }
          if (args.price_min != null) { where.push(`p.price >= ?`); whereCount.push(`p.price >= ?`); params.push(Number(args.price_min)); }
          if (args.price_max != null) { where.push(`p.price <= ?`); whereCount.push(`p.price <= ?`); params.push(Number(args.price_max)); }
          const kw = String(args.query || '').trim();
          const ref = String(args.reference || '').trim();
          if (kw) { where.push(`(pl.name LIKE ? OR p.reference LIKE ?)`); whereCount.push(`(pl.name LIKE ? OR p.reference LIKE ?)`); params.push(`%${kw}%`, `%${kw}%`); }
          if (ref) { where.push(`p.reference = ?`); whereCount.push(`p.reference = ?`); params.push(ref); }
          const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
          const whereSqlCount = whereCount.length ? `WHERE ${whereCount.join(' AND ')}` : '';
          const ob = String(args.order_by || 'id').toLowerCase();
          const od = String(args.order_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
          let orderExpr = 'p.id_product';
          if (ob === 'name') orderExpr = 'pl.name';
          else if (ob === 'price') orderExpr = 'p.price';
          else if (ob === 'stock') orderExpr = 'stock_qty';
          const offset = (page - 1) * pageSize;
          const tables = { product: `${prefix}product`, product_lang: `${prefix}product_lang`, stock: `${prefix}stock_available`, cat_product: `${prefix}category_product` };
          // Count
          const sqlCount = `SELECT COUNT(DISTINCT p.id_product) AS n
                            FROM ${tables.product} p
                            LEFT JOIN ${tables.stock} sa ON sa.id_product = p.id_product
                            LEFT JOIN ${tables.product_lang} pl ON pl.id_product = p.id_product AND pl.id_lang = ?
                            ${hasCategory ? `LEFT JOIN ${tables.cat_product} cp ON cp.id_product = p.id_product` : ''}
                            ${whereSqlCount}`;
          const [countRows] = await conn.execute(sqlCount, [idLang, ...params]);
          const total = Number((countRows && countRows[0] && countRows[0].n) || 0);
          // Page rows
          const sql = `SELECT p.id_product AS id, p.reference, p.active, p.price,
                              MAX(pl.name) AS name,
                              COALESCE(SUM(sa.quantity),0) AS stock_qty
                       FROM ${tables.product} p
                       LEFT JOIN ${tables.product_lang} pl ON pl.id_product = p.id_product AND pl.id_lang = ?
                       LEFT JOIN ${tables.stock} sa ON sa.id_product = p.id_product
                       ${hasCategory ? `LEFT JOIN ${tables.cat_product} cp ON cp.id_product = p.id_product` : ''}
                       ${whereSql}
                       GROUP BY p.id_product, p.reference, p.active, p.price
                       ORDER BY ${orderExpr} ${od}
                       LIMIT ? OFFSET ?`;
          const [rows] = await conn.execute(sql, [idLang, ...params, pageSize, offset]);
          return { page, page_size: pageSize, total, items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Products: update price, active, and stock quantity (default variant)
    { name: 'psdb.products.update', description: 'Update product fields (price, active, stock_quantity) directly in DB', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, reference: { type: 'string' }, price: { type: 'number' }, active: { type: 'boolean' }, stock_quantity: { type: 'integer' } }, oneOf: [ { required: ['id'] }, { required: ['reference'] } ] }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          // Resolve product id if reference provided
          let id = (args.id != null && String(args.id).trim() !== '') ? Number(args.id) : null;
          if (!id) {
            const [rows] = await conn.execute(`SELECT id_product FROM ${prefix}product WHERE reference = ? LIMIT 1`, [String(args.reference || '').trim()]);
            if (!rows.length) throw new Error('product_not_found');
            id = Number(rows[0].id_product);
          }
          await conn.beginTransaction();
          const changes = {};
          if (args.price != null) {
            await conn.execute(`UPDATE ${prefix}product SET price = ? WHERE id_product = ?`, [Number(args.price), id]);
            changes.price = Number(args.price);
          }
          if (args.active != null) {
            await conn.execute(`UPDATE ${prefix}product SET active = ? WHERE id_product = ?`, [args.active ? 1 : 0, id]);
            changes.active = !!args.active;
          }
          if (args.stock_quantity != null) {
            await conn.execute(`UPDATE ${prefix}stock_available SET quantity = ? WHERE id_product = ? AND id_product_attribute = 0`, [Number(args.stock_quantity), id]);
            changes.stock_quantity = Number(args.stock_quantity);
          }
          await conn.commit();
          return { ok: true, id, updated: changes };
        } catch (e) {
          try { await conn.rollback(); } catch {}
          throw e;
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Stock: get levels by product or category
    { name: 'psdb.stock.get', description: 'Get stock levels for a product or a category (DB)', inputSchema: { type: 'object', properties: { product_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, category_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, id_lang: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 } }, oneOf: [ { required: ['product_id'] }, { required: ['category_id'] } ] }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const idLang = Number(args.id_lang || opt.lang_id || 1);
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          if (args.product_id != null && String(args.product_id).trim() !== '') {
            const pid = Number(args.product_id);
            const [rows] = await conn.execute(`SELECT id_product_attribute, SUM(quantity) AS qty FROM ${prefix}stock_available WHERE id_product = ? GROUP BY id_product_attribute ORDER BY id_product_attribute ASC`, [pid]);
            const total = rows.reduce((a, x) => a + Number(x.qty || 0), 0);
            return { product_id: pid, total, rows: rows.map(x => ({ id_product_attribute: Number(x.id_product_attribute || 0), quantity: Number(x.qty || 0) })) };
          } else {
            const cat = Number(args.category_id);
            const limit = Math.max(1, Math.min(500, Number(args.limit || 200)));
            const sql = `SELECT p.id_product AS id, p.reference, MAX(pl.name) AS name, COALESCE(SUM(sa.quantity),0) AS stock_qty
                         FROM ${prefix}product p
                         JOIN ${prefix}category_product cp ON cp.id_product = p.id_product AND cp.id_category = ?
                         LEFT JOIN ${prefix}stock_available sa ON sa.id_product = p.id_product
                         LEFT JOIN ${prefix}product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
                         GROUP BY p.id_product, p.reference
                         ORDER BY stock_qty ASC
                         LIMIT ${limit}`;
            const [rows] = await conn.execute(sql, [cat, idLang]);
            return { category_id: cat, items: rows };
          }
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Stock: update quantity (set or delta) for a product (optionally a combination)
    { name: 'psdb.stock.update', description: 'Update stock quantity in DB; supports mode set or delta (increment/decrement)', inputSchema: { type: 'object', properties: { product_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, product_attribute_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, quantity: { type: 'integer' }, mode: { type: 'string', enum: ['set','delta','increment','decrement'], default: 'set' } }, required: ['product_id','quantity'] }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const pid = Number(args.product_id);
          const paid = args.product_attribute_id != null && String(args.product_attribute_id).trim() !== '' ? Number(args.product_attribute_id) : 0;
          const q = Number(args.quantity);
          const mode = String(args.mode || 'set').toLowerCase();
          let sql, params;
          if (mode === 'delta' || mode === 'increment') { sql = `UPDATE ${prefix}stock_available SET quantity = quantity + ? WHERE id_product = ? AND id_product_attribute = ?`; params = [q, pid, paid]; }
          else if (mode === 'decrement') { sql = `UPDATE ${prefix}stock_available SET quantity = quantity - ? WHERE id_product = ? AND id_product_attribute = ?`; params = [q, pid, paid]; }
          else { sql = `UPDATE ${prefix}stock_available SET quantity = ? WHERE id_product = ? AND id_product_attribute = ?`; params = [q, pid, paid]; }
          const [res] = await conn.execute(sql, params);
          return { ok: true, affected_rows: res?.affectedRows ?? null, product_id: pid, product_attribute_id: paid, mode, quantity: q };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Stock: low stock alert list (DB)
    { name: 'psdb.stock.low', description: 'List products with stock under or equal to a threshold (DB)', inputSchema: { type: 'object', properties: { threshold: { type: 'integer', default: 5 }, id_lang: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const idLang = Number(args.id_lang || opt.lang_id || 1);
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const thr = Math.max(0, Number(args.threshold || 5));
          const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
          const sql = `SELECT p.id_product AS id, p.reference, MAX(pl.name) AS name, COALESCE(SUM(sa.quantity),0) AS stock_qty
                       FROM ${prefix}product p
                       LEFT JOIN ${prefix}stock_available sa ON sa.id_product = p.id_product
                       LEFT JOIN ${prefix}product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
                       GROUP BY p.id_product, p.reference
                       HAVING COALESCE(SUM(sa.quantity),0) <= ?
                       ORDER BY stock_qty ASC
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql, [idLang, thr]);
          return { threshold: thr, count: rows.length, items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Orders: list with status filters and ranges (DB)
    { name: 'psdb.orders.list', description: 'List recent orders from DB; filter by status, date range, customer email', inputSchema: { type: 'object', properties: { status: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, state_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, date_from: { type: 'string' }, date_to: { type: 'string' }, customer_email: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 }, id_lang: { type: 'integer' } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const idLang = Number(args.id_lang || opt.lang_id || 1);
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          // Customer email filter
          if (String(args.customer_email || '').trim()) { where.push(`c.email = ?`); params.push(String(args.customer_email).trim()); }
          // Date range
          if (String(args.date_from || '').trim()) { where.push(`o.date_add >= ?`); params.push(String(args.date_from).trim()); }
          if (String(args.date_to || '').trim()) { where.push(`o.date_add <= ?`); params.push(String(args.date_to).trim()); }
          // Status/state filter
          let stateIds = [];
          if (args.state_id != null && String(args.state_id).trim() !== '') {
            stateIds = [Number(args.state_id)];
          } else if (args.status) {
            const statuses = Array.isArray(args.status) ? args.status : [args.status];
            const want = new Set();
            for (const sRaw of statuses) {
              const s = String(sRaw || '').toLowerCase();
              if (!s) continue;
              if (s === 'paid') {
                const [rows] = await conn.execute(`SELECT id_order_state FROM ${prefix}order_state WHERE paid = 1`);
                for (const x of rows) want.add(Number(x.id_order_state));
              } else if (s === 'shipped') {
                const [rows] = await conn.execute(`SELECT id_order_state FROM ${prefix}order_state WHERE shipped = 1 OR delivery = 1`);
                for (const x of rows) want.add(Number(x.id_order_state));
              } else if (s === 'pending') {
                const [rows] = await conn.execute(`SELECT id_order_state FROM ${prefix}order_state WHERE paid = 0 AND shipped = 0`);
                for (const x of rows) want.add(Number(x.id_order_state));
              } else if (s === 'refunded') {
                const [rows] = await conn.execute(`SELECT os.id_order_state FROM ${prefix}order_state os JOIN ${prefix}order_state_lang osl ON osl.id_order_state = os.id_order_state AND osl.id_lang = ? WHERE LOWER(osl.name) LIKE '%refund%'`, [idLang]);
                for (const x of rows) want.add(Number(x.id_order_state));
              }
            }
            stateIds = Array.from(want);
          }
          if (stateIds.length) {
            where.push(`o.current_state IN (${stateIds.map(() => '?').join(',')})`);
            params.push(...stateIds);
          }
          const limit = Math.max(1, Math.min(200, Number(args.limit || 20)));
          const sql = `SELECT o.id_order AS id, o.reference, o.id_customer, o.current_state, o.total_paid, o.total_paid_tax_incl, o.payment, o.date_add
                       FROM ${prefix}orders o
                       LEFT JOIN ${prefix}customer c ON c.id_customer = o.id_customer
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       ORDER BY o.date_add DESC
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql, params);
          return { count: rows.length, items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Orders: get details
    { name: 'psdb.orders.get', description: 'Get order details from DB (summary, items, customer, addresses)', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, reference: { type: 'string' } }, oneOf: [ { required: ['id'] }, { required: ['reference'] } ] }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          if (args.id != null && String(args.id).trim() !== '') { where.push('o.id_order = ?'); params.push(Number(args.id)); }
          else { where.push('o.reference = ?'); params.push(String(args.reference)); }
          const sql = `SELECT o.id_order AS id, o.reference, o.id_customer, o.id_address_delivery, o.id_address_invoice,
                              o.current_state, o.total_paid, o.total_paid_tax_incl, o.payment, o.date_add
                       FROM ${prefix}orders o
                       WHERE ${where.join(' AND ')}
                       LIMIT 1`;
          const [orders] = await conn.execute(sql, params);
          if (!orders.length) return { order: null };
          const o = orders[0];
          const [items] = await conn.execute(`SELECT product_id, product_name, product_reference, product_quantity, unit_price_tax_incl, total_price_tax_incl FROM ${prefix}order_detail WHERE id_order = ? ORDER BY id_order_detail ASC`, [o.id]);
          const [custRows] = await conn.execute(`SELECT id_customer AS id, email, firstname, lastname FROM ${prefix}customer WHERE id_customer = ? LIMIT 1`, [o.id_customer]);
          const customer = custRows[0] || null;
          let address_delivery = null, address_invoice = null;
          if (o.id_address_delivery) {
            const [ad] = await conn.execute(`SELECT id_address, alias, company, firstname, lastname, address1, address2, postcode, city, id_country, phone, phone_mobile FROM ${prefix}address WHERE id_address = ? LIMIT 1`, [o.id_address_delivery]);
            address_delivery = ad[0] || null;
          }
          if (o.id_address_invoice) {
            const [ai] = await conn.execute(`SELECT id_address, alias, company, firstname, lastname, address1, address2, postcode, city, id_country, phone, phone_mobile FROM ${prefix}address WHERE id_address = ? LIMIT 1`, [o.id_address_invoice]);
            address_invoice = ai[0] || null;
          }
          return { order: o, items, customer, address_delivery, address_invoice };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Orders: update status (insert order_history and set current_state)
    { name: 'psdb.orders.update_status', description: 'Update order status directly in DB (order_history + orders.current_state)', inputSchema: { type: 'object', properties: { id_order: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, state_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] } }, required: ['id_order','state_id'] }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const idOrder = Number(args.id_order);
          const idState = Number(args.state_id);
          await conn.beginTransaction();
          await conn.execute(`INSERT INTO ${prefix}order_history (id_employee, id_order, id_order_state, date_add) VALUES (0, ?, ?, NOW())`, [idOrder, idState]);
          await conn.execute(`UPDATE ${prefix}orders SET current_state = ? WHERE id_order = ?`, [idState, idOrder]);
          await conn.commit();
          return { ok: true, id_order: idOrder, new_state: idState };
        } catch (e) {
          try { await conn.rollback(); } catch {}
          throw e;
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Orders: search by id, reference, email, date range (DB)
    { name: 'psdb.orders.search', description: 'Search orders in DB by id, reference, customer email, or date range', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, reference: { type: 'string' }, customer_email: { type: 'string' }, date_from: { type: 'string' }, date_to: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          if (args.id != null && String(args.id).trim() !== '') { where.push('o.id_order = ?'); params.push(Number(args.id)); }
          if (String(args.reference || '').trim()) { where.push('o.reference = ?'); params.push(String(args.reference).trim()); }
          if (String(args.customer_email || '').trim()) { where.push('c.email = ?'); params.push(String(args.customer_email).trim()); }
          if (String(args.date_from || '').trim()) { where.push('o.date_add >= ?'); params.push(String(args.date_from).trim()); }
          if (String(args.date_to || '').trim()) { where.push('o.date_add <= ?'); params.push(String(args.date_to).trim()); }
          const limit = Math.max(1, Math.min(200, Number(args.limit || 20)));
          const sql = `SELECT o.id_order AS id, o.reference, o.id_customer, o.current_state, o.total_paid, o.total_paid_tax_incl, o.payment, o.date_add
                       FROM ${prefix}orders o
                       LEFT JOIN ${prefix}customer c ON c.id_customer = o.id_customer
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       ORDER BY o.date_add DESC
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql, params);
          return { count: rows.length, items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Customers: list (new, returning, subscribed)
    { name: 'psdb.customers.list', description: 'List customers from DB; filter by subscribed/new/returning and date range', inputSchema: { type: 'object', properties: { subscribed: { type: 'boolean' }, segment: { type: 'string', enum: ['new','returning'] }, date_from: { type: 'string' }, date_to: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          if (args.subscribed === true) { where.push('c.newsletter = 1'); }
          if (String(args.date_from || '').trim()) { where.push('c.date_add >= ?'); params.push(String(args.date_from).trim()); }
          if (String(args.date_to || '').trim()) { where.push('c.date_add <= ?'); params.push(String(args.date_to).trim()); }
          const having = [];
          if (String(args.segment || '').toLowerCase() === 'new') having.push('orders_count <= 1');
          if (String(args.segment || '').toLowerCase() === 'returning') having.push('orders_count >= 2');
          const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
          const sql = `SELECT c.id_customer AS id, c.email, c.firstname, c.lastname, c.active, c.newsletter, c.date_add,
                              COUNT(o.id_order) AS orders_count, COALESCE(SUM(o.total_paid_tax_incl),0) AS total_paid
                       FROM ${prefix}customer c
                       LEFT JOIN ${prefix}orders o ON o.id_customer = c.id_customer
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       GROUP BY c.id_customer
                       ${having.length ? 'HAVING ' + having.join(' AND ') : ''}
                       ORDER BY c.date_add DESC
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql, params);
          return { count: rows.length, items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Customers: get details (contact, orders, addresses)
    { name: 'psdb.customers.get', description: 'Get customer details from DB by id or email, including order history and addresses', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, email: { type: 'string' }, limit_orders: { type: 'integer', minimum: 1, maximum: 500, default: 50 } }, oneOf: [ { required: ['id'] }, { required: ['email'] } ] }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          if (args.id != null && String(args.id).trim() !== '') { where.push('c.id_customer = ?'); params.push(Number(args.id)); }
          else { where.push('c.email = ?'); params.push(String(args.email).trim()); }
          const [rows] = await conn.execute(`SELECT c.id_customer AS id, c.email, c.firstname, c.lastname, c.active, c.newsletter, c.date_add FROM ${prefix}customer c WHERE ${where.join(' AND ')} LIMIT 1`, params);
          if (!rows.length) return { customer: null };
          const c = rows[0];
          const lim = Math.max(1, Math.min(500, Number(args.limit_orders || 50)));
          const [orders] = await conn.execute(`SELECT id_order AS id, reference, total_paid_tax_incl, current_state, date_add FROM ${prefix}orders WHERE id_customer = ? ORDER BY date_add DESC LIMIT ${lim}`, [c.id]);
          const [addresses] = await conn.execute(`SELECT id_address, alias, company, firstname, lastname, address1, address2, postcode, city, id_country, phone, phone_mobile, date_add, date_upd FROM ${prefix}address WHERE id_customer = ? AND deleted = 0 ORDER BY date_upd DESC`, [c.id]);
          return { customer: c, orders, addresses };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Customers: search by name or email
    { name: 'psdb.customers.search', description: 'Search customers in DB by name or email', inputSchema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } } }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          const where = [];
          const params = [];
          if (args.id != null && String(args.id).trim() !== '') { where.push('c.id_customer = ?'); params.push(Number(args.id)); }
          if (String(args.email || '').trim()) { where.push('c.email LIKE ?'); params.push(`%${String(args.email).trim()}%`); }
          if (String(args.name || '').trim()) {
            const name = String(args.name).trim();
            where.push('(c.firstname LIKE ? OR c.lastname LIKE ?)'); params.push(`%${name}%`, `%${name}%`);
          }
          const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
          const sql = `SELECT c.id_customer AS id, c.email, c.firstname, c.lastname, c.active, c.newsletter, c.date_add
                       FROM ${prefix}customer c
                       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                       ORDER BY c.date_add DESC
                       LIMIT ${limit}`;
          const [rows] = await conn.execute(sql, params);
          return { count: rows.length, items: rows };
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Customers: update flags and optionally an address by id
    { name: 'psdb.customers.update', description: 'Update customer newsletter/active flags and optionally update an address by id (DB)', inputSchema: { type: 'object', properties: { id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, email: { type: 'string' }, newsletter: { type: 'boolean' }, active: { type: 'boolean' }, address_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, address: { type: 'object', additionalProperties: true } }, oneOf: [ { required: ['id'] }, { required: ['email'] } ] }, run: async (args = {}, ctx = {}) => {
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT server_type, options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        const row = r.rows[0];
        if (String(row.server_type || '').toLowerCase() !== 'database') throw new Error('server_not_database');
        let opt = row.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const prefix = String(opt.db_prefix || 'ps_');
        const mysql = await import('mysql2/promise');
        let connUrl = String(opt.connection_url || opt.url || '').trim();
        if (!connUrl) {
          const host = opt.host || 'localhost';
          const port = Number(opt.port || 3306);
          const user = opt.user || opt.username || '';
          const password = opt.password || '';
          const database = opt.database || '';
          connUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
        }
        const conn = await mysql.createConnection(connUrl);
        try {
          await conn.beginTransaction();
          // Resolve customer id
          let id = (args.id != null && String(args.id).trim() !== '') ? Number(args.id) : null;
          if (!id) {
            const [rows] = await conn.execute(`SELECT id_customer FROM ${prefix}customer WHERE email = ? LIMIT 1`, [String(args.email || '').trim()]);
            if (!rows.length) throw new Error('customer_not_found');
            id = Number(rows[0].id_customer);
          }
          const changes = {};
          if (args.newsletter != null) { await conn.execute(`UPDATE ${prefix}customer SET newsletter = ? WHERE id_customer = ?`, [args.newsletter ? 1 : 0, id]); changes.newsletter = !!args.newsletter; }
          if (args.active != null) { await conn.execute(`UPDATE ${prefix}customer SET active = ? WHERE id_customer = ?`, [args.active ? 1 : 0, id]); changes.active = !!args.active; }
          if (args.address && (args.address_id != null && String(args.address_id).trim() !== '')) {
            const aid = Number(args.address_id);
            const allowed = ['alias','company','firstname','lastname','address1','address2','postcode','city','id_country','phone','phone_mobile'];
            const sets = []; const params = [];
            for (const k of allowed) {
              if (Object.prototype.hasOwnProperty.call(args.address, k)) { sets.push(`${k} = ?`); params.push(args.address[k]); }
            }
            if (sets.length) {
              sets.push('date_upd = NOW()');
              await conn.execute(`UPDATE ${prefix}address SET ${sets.join(', ')} WHERE id_address = ? AND id_customer = ?`, [...params, aid, id]);
              changes.address_id = aid;
            }
          }
          await conn.commit();
          return { ok: true, id, updated: changes };
        } catch (e) {
          try { await conn.rollback(); } catch {}
          throw e;
        } finally { try { await conn.end(); } catch {} }
      }
    },
    // Upload a file via base64; requires session.authed when MCP_TOKEN set
    { name: 'upload_file', description: 'Upload a file (base64) and register it for this bot', inputSchema: { type: 'object', properties: { filename: { type: 'string' }, content_base64: { type: 'string' }, content_type: { type: 'string' } , bot_id: { type: 'string' } }, required: ['filename','content_base64'] }, run: async (args={}, ctx={}) => {
        if (typeof needsAuth === 'function') {
          const reqd = await needsAuth(ctx);
          if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized');
        }
        const botId = String(args.bot_id || ctx.id_bot || '').trim() || null;
        const serverName = String(ctx.server_name || '').trim() || null;
        const base64 = String(args.content_base64 || '').trim();
        const buf = Buffer.from(base64, 'base64');
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const fname = String(args.filename || 'file.bin');
        const ct = String(args.content_type || 'application/octet-stream');
        const relName = id + '-' + fname.replace(/[^a-zA-Z0-9._-]+/g,'_');
        const subdir = serverName ? String(serverName).toLowerCase().replace(/[^a-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'') : '';
        const rel = subdir ? path.join(subdir, relName) : relName;
        const destDir = subdir ? path.join(uploadDir, subdir) : uploadDir;
        try { fs.mkdirSync(destDir, { recursive: true }); } catch {}
        const full = path.join(destDir, relName);
        fs.writeFileSync(full, buf);
        await pool.query(`INSERT INTO mcp_files (id, file_name, file_path, content_type, size_bytes, server_name, bot_id) VALUES ($1,$2,$3,$4,$5,$6,$7)` , [id, fname, rel, ct, buf.length, serverName, botId]);
        return { id, file_name: fname, size_bytes: buf.length, content_type: ct };
      }
    },
    // List files; requires auth when MCP_TOKEN set
    { name: 'list_files', description: 'List files uploaded (optionally scoped to this server/bot)', inputSchema: { type: 'object', properties: { bot_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } }, run: async (args={}, ctx={}) => {
        if (typeof needsAuth === 'function') {
          const reqd = await needsAuth(ctx);
          if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized');
        }
        const botId = String(args.bot_id || ctx.id_bot || '').trim();
        const serverName = String(ctx.server_name || '').trim();
        const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
        const where = [];
        const params = [];
        if (botId) { where.push('bot_id = $' + (params.push(botId))); }
        if (serverName) { where.push('server_name = $' + (params.push(serverName))); }
        params.push(limit);
        const r = await pool.query(`SELECT id, file_name, content_type, size_bytes, server_name, bot_id, created_at FROM mcp_files ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY created_at DESC LIMIT $${params.length}`, params);
        return r.rows || [];
      }
    },
    // Knowledge base: list files from vector stores linked to the current bot's prompt
    { name: 'kb_list_files', description: 'List files from OpenAI Vector Stores linked to the bot\'s Prompt', inputSchema: { type: 'object', properties: { bot_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } }, run: async (args = {}, ctx = {}) => {
        const botId = String(args.bot_id || ctx.id_bot || '').trim();
        if (!botId) throw new Error('bot_id required');
        // Resolve prompt_config for this bot
        const rb = await pool.query(`SELECT prompt_config_id FROM chatbot_config WHERE id_bot=$1 LIMIT 1`, [botId]);
        if (!rb.rowCount) return [];
        const pid = String(rb.rows[0].prompt_config_id || '').trim();
        if (!pid) return [];
        const rp = await pool.query(`SELECT name, openai_api_key, vector_store_id, vector_store_ids FROM prompt_config WHERE id=$1 LIMIT 1`, [pid]);
        if (!rp.rowCount) return [];
        const row = rp.rows[0];
        let vectorStoreIds = [];
        try { if (Array.isArray(row.vector_store_ids)) vectorStoreIds = row.vector_store_ids.filter(Boolean).map(String); } catch {}
        try { const single = String(row.vector_store_id || '').trim(); if (single) vectorStoreIds.push(single); } catch {}
        vectorStoreIds = Array.from(new Set(vectorStoreIds));
        if (!vectorStoreIds.length) return [];
        const limit = Math.max(1, Math.min(200, Number(args.limit || 100)));
        const client = createOpenAIClient({ apiKey: row.openai_api_key || undefined });
        const out = [];
        for (const vsId of vectorStoreIds) {
          try {
            let arr = [];
            try {
              const list = await client.vectorStores.files.list(vsId, { limit });
              arr = Array.isArray(list?.data) ? list.data : [];
            } catch (sdkErr) {
              try {
                const base = (process.env.OPENAI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');
                const key = String(row.openai_api_key || process.env.OPENAI_API_KEY || '').trim();
                const http = await fetch(`${base}/vector_stores/${encodeURIComponent(vsId)}/files?limit=${limit}`, {
                  method:'GET', headers:{ 'Authorization': `Bearer ${key}`, 'Content-Type':'application/json' }
                }).then(r=>r.json()).catch(()=>({}));
                arr = Array.isArray(http?.data) ? http.data : (Array.isArray(http?.files)? http.files: []);
              } catch {}
            }
            for (const f of arr) {
              let fileName = '';
              let fileBytes = null;
              let purpose = null;
              try {
                const meta = await client.files.retrieve(f.id);
                fileName = meta?.filename || meta?.name || '';
                fileBytes = (typeof meta?.bytes === 'number') ? meta.bytes : null;
                purpose = meta?.purpose || null;
              } catch {
                try {
                  const base = (process.env.OPENAI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');
                  const key = String(row.openai_api_key || process.env.OPENAI_API_KEY || '').trim();
                  const meta = await fetch(`${base}/files/${encodeURIComponent(f.id)}`, { method:'GET', headers:{ 'Authorization': `Bearer ${key}`, 'Content-Type':'application/json' } }).then(r=>r.json()).catch(()=>({}));
                  fileName = meta?.filename || meta?.name || '';
                  fileBytes = (typeof meta?.bytes === 'number') ? meta.bytes : null;
                  purpose = meta?.purpose || null;
                } catch {}
              }
              out.push({ vector_store_id: vsId, id: f.id, status: f.status || null, created_at: f.created_at || null, usage_bytes: f.usage_bytes || null, file_name: fileName, file_bytes: fileBytes, purpose });
            }
          } catch (e) {
            // Continue on next store
          }
        }
        return out;
      }
    },
    // Simple search over uploaded files (filename match + optional text preview)
    { name: 'search_documents', description: 'Search uploaded documents by filename (and preview text when readable)', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['query'] }, run: async (args={}, ctx={}) => {
        const q = String(args.query || '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(50, Number(args.limit || 10)));
        if (!q) return { results: [] };
        // Prefer scoped search when bot context provided
        const where = [];
        const params = [];
        if (ctx && ctx.id_bot) { where.push('bot_id = $' + (params.push(String(ctx.id_bot)))); }
        if (ctx && ctx.server_name) { where.push('server_name = $' + (params.push(String(ctx.server_name)))); }
        params.push(limit);
        const sql = `SELECT id, file_name, file_path, content_type, created_at FROM mcp_files ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY created_at DESC LIMIT $${params.length}`;
        const r = await pool.query(sql, params);
        const results = [];
        for (const row of r.rows || []) {
          const nameLc = String(row.file_name || '').toLowerCase();
          if (!nameLc.includes(q)) {
            // Try text preview match when file seems text-like
            const looksText = /^text\//i.test(String(row.content_type || '')) || /\.(txt|md|html?|json|csv|log)$/i.test(String(row.file_name||''));
            if (!looksText) continue;
            const full = path.join(uploadDir, row.file_path);
            const preview = readTextPreview(full, 65536) || '';
            if (!preview.toLowerCase().includes(q)) continue;
            results.push({ id: row.id, title: row.file_name, text: (preview.length>200? preview.slice(0,200)+"...": preview), content_type: row.content_type });
          } else {
            results.push({ id: row.id, title: row.file_name, text: '', content_type: row.content_type });
          }
          if (results.length >= limit) break;
        }
        return { results };
      }
    },
    // List local files directly from this Files server's configured root (no OpenAI access).
    { name: 'local_list_files', description: 'List local files from this Files server root (no OpenAI). Uses server options.root.', inputSchema: { type: 'object', properties: { recursive: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 } } }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') {
          const reqd = await needsAuth(ctx);
          if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized');
        }
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        // Load server root from DB
        const r = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        let opts = r.rows[0].options; try { if (typeof opts === 'string') opts = JSON.parse(opts); } catch { opts = {}; }
        const root = String(opts.root || opts.base_path || '').trim();
        if (!root) throw new Error('files_root_missing');
        const recursive = !!args.recursive;
        const limit = Math.max(1, Math.min(1000, Number(args.limit || 200)));
        const seen = [];
        function walk(dir, prefix = '') {
          if (seen.length >= limit) return;
          let ents = [];
          try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const e of ents) {
            if (seen.length >= limit) break;
            const rel = prefix ? path.join(prefix, e.name) : e.name;
            const full = path.join(dir, e.name);
            try {
              const st = fs.statSync(full);
              if (e.isFile()) {
                seen.push({ path: rel.replace(/\\/g,'/'), size_bytes: st.size, mtime_ms: Number(st.mtimeMs||0) });
              } else if (e.isDirectory() && recursive) {
                walk(full, rel);
              }
            } catch {}
          }
        }
        walk(root, '');
        return { root, files: seen };
      }
    },
    // Fetch a small text preview from a local file under this Files server root
    { name: 'local_fetch_document', description: 'Fetch a text preview from a local file under this Files server root (no OpenAI).', inputSchema: { type: 'object', properties: { path: { type: 'string' }, max_bytes: { type: 'integer', minimum: 64, maximum: 1048576, default: 262144 } }, required: ['path'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') {
          const reqd = await needsAuth(ctx);
          if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized');
        }
        const p = String(args.path || '').replace(/^[\\/]+/, '');
        const serverName = String(ctx.server_name || '').trim();
        if (!serverName) throw new Error('server_name required');
        const r = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]);
        if (!r.rowCount) throw new Error('server_not_found');
        let opts = r.rows[0].options; try { if (typeof opts === 'string') opts = JSON.parse(opts); } catch { opts = {}; }
        const root = String(opts.root || opts.base_path || '').trim();
        if (!root) throw new Error('files_root_missing');
        const full = path.resolve(root, p);
        const normRoot = path.resolve(root) + path.sep;
        if (!full.startsWith(normRoot)) throw new Error('invalid_path');
        const maxBytes = Math.max(64, Math.min(1048576, Number(args.max_bytes || 262144)));
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('not_found');
        let text = '';
        try {
          const buf = fs.readFileSync(full);
          const slice = buf.slice(0, maxBytes);
          text = slice.toString('utf8');
        } catch { text = ''; }
        return { path: p, text, size_bytes: fs.statSync(full).size };
      }
    },
    // Fetch a document content preview (best-effort text for text-like files)
    { name: 'fetch_document', description: 'Fetch a document by id with text preview (for text-like files). Use /mcp/file/:id/download to download raw.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, run: async (args={}, ctx={}) => {
        const id = String(args.id || '').trim();
        if (!id) throw new Error('id required');
        const r = await pool.query(`SELECT * FROM mcp_files WHERE id = $1 LIMIT 1`, [id]);
        if (!r.rowCount) throw new Error('not_found');
        const row = r.rows[0];
        const looksText = /^text\//i.test(String(row.content_type || '')) || /\.(txt|md|html?|json|csv|log)$/i.test(String(row.file_name||''));
        let text = null;
        if (looksText) {
          const full = path.join(uploadDir, row.file_path);
          text = readTextPreview(full, 262144) || null; // up to 256KB
        }
        return {
          id: row.id,
          title: row.file_name,
          content_type: row.content_type || null,
          text,
          download_path: `/mcp/file/${row.id}/download`,
          size_bytes: row.size_bytes || null,
          bot_id: row.bot_id || null,
          created_at: row.created_at || null,
        };
      }
    },
    // Upload a file to OpenAI storage (Files API) or to a Vector Store when provided
    { name: 'openai_upload_file', description: 'Upload content to OpenAI storage (Files API) or a Vector Store. Provide either file_id (from /mcp-dev files) or content_base64+filename. Optionally pass vector_store_id to store in a vector store instead of general files.', inputSchema: { type: 'object', properties: { file_id: { type: 'string' }, filename: { type: 'string' }, content_base64: { type: 'string' }, purpose: { type: 'string', description: 'Files API purpose (default: assistants)' }, vector_store_id: { type: 'string', description: 'If set, upload to this vector store' } } }, run: async (args={}, ctx={}) => {
        const requireAuth = await (typeof needsAuth === 'function' ? needsAuth(ctx) : Promise.resolve(false));
        if (requireAuth && !(ctx?.session?.authed)) throw new Error('unauthorized');

        const fileId = String(args.file_id || '').trim();
        const vectorStoreId = String(args.vector_store_id || '').trim();
        const purpose = String(args.purpose || 'assistants');
        let filename = String(args.filename || '').trim();
        let fullPath = '';
        let tmpPath = '';

        if (fileId) {
          const r = await pool.query(`SELECT * FROM mcp_files WHERE id = $1 LIMIT 1`, [fileId]);
          if (!r.rowCount) throw new Error('not_found');
          const row = r.rows[0];
          filename = filename || row.file_name || 'upload.bin';
          fullPath = path.join(uploadDir, row.file_path);
          if (!fs.existsSync(fullPath)) throw new Error('file_missing');
        } else {
          const b64 = String(args.content_base64 || '').trim();
          if (!b64) throw new Error('content_base64 or file_id required');
          if (!filename) filename = 'upload.bin';
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-up-'));
          tmpPath = path.join(dir, filename.replace(/[^a-zA-Z0-9._-]+/g, '_'));
          const buf = Buffer.from(b64, 'base64');
          fs.writeFileSync(tmpPath, buf);
          fullPath = tmpPath;
        }

        const client = createOpenAIClient();
        const stream = fs.createReadStream(fullPath);
        try {
          if (vectorStoreId) {
            // Prefer upload() when available; fallback to create/add in older SDKs
            let out;
            if (client?.vectorStores?.files?.upload) {
              out = await client.vectorStores.files.upload({ vector_store_id: vectorStoreId, file: stream });
            } else if (client?.vectorStores?.files?.create) {
              out = await client.vectorStores.files.create(vectorStoreId, { file: stream });
            } else if (client?.vectorStores?.files?.add) {
              out = await client.vectorStores.files.add(vectorStoreId, { file: stream });
            } else {
              throw new Error('vector_store_upload_unsupported_in_sdk');
            }
            return { ok: true, target: 'vector_store', vector_store_id: vectorStoreId, openai: out };
          } else {
            const file = await client.files.create({ file: stream, purpose });
            return { ok: true, target: 'files', purpose, file_id: file?.id || null, openai: file };
          }
        } finally {
          try { if (tmpPath) fs.unlinkSync(tmpPath); } catch {}
          try { if (tmpPath) fs.rmdirSync(path.dirname(tmpPath)); } catch {}
        }
      }
    },
    // Generic HTTP GET returning parsed JSON
    { name: 'http_get_json', description: 'HTTP GET a JSON API and return parsed body', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Absolute http(s) URL or relative when server has api_base' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, query: { type: 'object', additionalProperties: { type: 'string' } }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } } }, run: async (args = {}, ctx = {}) => {
        // Optional auth (when global MCP token or bot token configured)
        if (typeof needsAuth === 'function') {
          const reqd = await needsAuth(ctx);
          if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized');
        }
        // Merge server defaults (api_base, default_headers)
        let base = '';
        let defaults = {};
        try {
          const name = String(ctx.server_name || '').trim();
          if (name) {
            const r = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
            if (r.rowCount) {
              let opt = r.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
              base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim();
              if (opt.default_headers && typeof opt.default_headers === 'object') defaults = opt.default_headers;
            }
          }
        } catch {}
        let rawUrl = String(args.url || '').trim();
        if (base && rawUrl && !/^https?:\/\//i.test(rawUrl)) rawUrl = base.replace(/\/$/,'') + (rawUrl.startsWith('/')?'':'/') + rawUrl;
        if (!/^https?:\/\//i.test(rawUrl)) throw new Error('invalid_url');
        let u; try { u = new URL(rawUrl); } catch { throw new Error('invalid_url'); }
        // Apply query parameters
        try {
          if (args.query && typeof args.query === 'object') {
            for (const [k, v] of Object.entries(args.query)) {
              if (v != null) u.searchParams.set(k, String(v));
            }
          }
        } catch {}
        const headers = {};
        try { for (const [k,v] of Object.entries(defaults || {})) { if (v != null) headers[k] = String(v); } } catch {}
        try { if (args.headers && typeof args.headers === 'object') { for (const [k, v] of Object.entries(args.headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        const controller = new AbortController();
        const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000)));
        const timer = setTimeout(() => { try { controller.abort(); } catch {} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
          const text = await r.text();
          let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers || []), body: json ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Generic HTTP POST with JSON body and JSON response
    { name: 'http_post_json', description: 'HTTP POST JSON and return parsed JSON response', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Absolute http(s) URL or relative when server has api_base' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, body: { type: 'object' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['url','body'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') {
          const reqd = await needsAuth(ctx);
          if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized');
        }
        let base = '';
        let defaults = {};
        try {
          const name = String(ctx.server_name || '').trim();
          if (name) {
            const r = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
            if (r.rowCount) {
              let opt = r.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
              base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim();
              if (opt.default_headers && typeof opt.default_headers === 'object') defaults = opt.default_headers;
            }
          }
        } catch {}
        let rawUrl = String(args.url || '').trim();
        if (base && rawUrl && !/^https?:\/\//i.test(rawUrl)) rawUrl = base.replace(/\/$/,'') + (rawUrl.startsWith('/')?'':'/') + rawUrl;
        if (!/^https?:\/\//i.test(rawUrl)) throw new Error('invalid_url');
        let u; try { u = new URL(rawUrl); } catch { throw new Error('invalid_url'); }
        const headers = { 'Content-Type': 'application/json' };
        try { for (const [k,v] of Object.entries(defaults || {})) { if (v != null) headers[k] = String(v); } } catch {}
        try { if (args.headers && typeof args.headers === 'object') { for (const [k, v] of Object.entries(args.headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        const controller = new AbortController();
        const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000)));
        const timer = setTimeout(() => { try { controller.abort(); } catch {} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'POST', headers, body: JSON.stringify(args.body || {}), signal: controller.signal });
          const text = await r.text();
          let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers || []), body: json ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Stripe wrappers (use server api_base and default Authorization)
    { name: 'stripe.get', description: 'Stripe API GET (relative path, merges server default headers).', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path, e.g., /v1/customers' }, query: { type: 'object', additionalProperties: { type: 'string' } }, headers: { type: 'object', additionalProperties: { type: 'string' } }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['path'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!rr.rowCount) throw new Error('server_not_found');
        let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
        const p = ('/' + String(args.path || '').trim()).replace(/\/+/g, '/');
        const u = new URL(base + p);
        try { if (args.query && typeof args.query === 'object') { for (const [k,v] of Object.entries(args.query)) { if (v != null) u.searchParams.set(k, String(v)); } } } catch {}
        const headers = { Accept: 'application/json' };
        try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        try {
          const sk = String(opt.secret_key || opt.api_key || '').trim();
          if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`;
          const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver;
          const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct;
        } catch {}
        try { if (args.headers && typeof args.headers === 'object') { for (const [k,v] of Object.entries(args.headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
        try {
          const r = await fetch(u.toString(), { method: 'GET', headers, signal: controller.signal });
          const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), body: json ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    { name: 'stripe.post', description: 'Stripe API POST (relative path). Defaults to x-www-form-urlencoded. Set headers or form=false to send JSON.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, body: { type: 'object' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, form: { type: 'boolean', description: 'Encode body as application/x-www-form-urlencoded (default true)' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['path','body'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim(); if (!name) throw new Error('server_name required');
        const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]);
        if (!rr.rowCount) throw new Error('server_not_found');
        let opt = rr.rows[0].options || {}; try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        const base = String(opt.api_base || opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
        const p = ('/' + String(args.path || '').trim()).replace(/\/+/g, '/');
        const u = new URL(base + p);
        const headers = {};
        try { if (opt.default_headers && typeof opt.default_headers === 'object') { for (const [k,v] of Object.entries(opt.default_headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        try {
          const sk = String(opt.secret_key || opt.api_key || '').trim();
          if (sk && !headers['Authorization']) headers['Authorization'] = `Bearer ${sk}`;
          const ver = String(opt.api_version || '').trim(); if (ver && !headers['Stripe-Version']) headers['Stripe-Version'] = ver;
          const acct = String(opt.account || '').trim(); if (acct && !headers['Stripe-Account']) headers['Stripe-Account'] = acct;
        } catch {}
        try { if (args.headers && typeof args.headers === 'object') { for (const [k,v] of Object.entries(args.headers)) { if (v != null) headers[k] = String(v); } } } catch {}
        const form = args.form !== false; if (form && !headers['Content-Type']) headers['Content-Type']='application/x-www-form-urlencoded'; if (!form && !headers['Content-Type']) headers['Content-Type']='application/json';
        const controller = new AbortController(); const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, t);
        try {
          let body;
          if (form) {
            const sp = new URLSearchParams();
            const push = (k,v)=>sp.append(k, v==null?'':String(v));
            const walk = (prefix,obj)=>{ for (const [k,v] of Object.entries(obj||{})) { const key = prefix?`${prefix}[${k}]`:k; if (v!=null && typeof v==='object' && !Array.isArray(v)) walk(key,v); else if (Array.isArray(v)) v.forEach((item,i)=>{ if (item!=null && typeof item==='object') walk(`${key}[${i}]`, item); else push(`${key}[${i}]`, item);}); else push(key,v);} };
            walk('', args.body || {}); body = sp.toString();
          } else body = JSON.stringify(args.body || {});
          const r = await fetch(u.toString(), { method:'POST', headers, body, signal: controller.signal });
          const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), body: json ?? text };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Convenience tool for PrestaShop Livechat module: /module/livechat/api?action=custom&name=...&key=...
    { name: 'presta_livechat_custom', description: 'Fetch rows from PrestaShop Livechat module (action=custom)', inputSchema: { type: 'object', properties: { base_url: { type: 'string', description: 'Shop base URL, e.g. https://example.com' }, name: { type: 'string', description: 'Custom name parameter' }, key: { type: 'string', description: 'Module API key' }, action: { type: 'string', description: 'Action parameter', default: 'custom' }, filter_na: { type: 'boolean', description: 'Filter out rows with Id_instruction = "na"', default: true }, unique: { type: 'boolean', description: 'De-duplicate instructions', default: true }, sort: { type: 'boolean', description: 'Sort instructions ascending', default: false }, persist: { type: 'boolean', description: 'Persist resulting instructions for automations', default: false }, persist_key: { type: 'string', description: 'Optional settings key for persistence' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['base_url','name','key'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') {
          const reqd = await needsAuth(ctx);
          if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized');
        }
        const base = String(args.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_base_url');
        const name = String(args.name || '').trim();
        const key = String(args.key || '').trim();
        const action = String(args.action || 'custom');
        if (!name || !key) throw new Error('name_and_key_required');
        const url = `${base}/module/livechat/api?action=${encodeURIComponent(action)}&name=${encodeURIComponent(name)}&key=${encodeURIComponent(key)}`;
        const controller = new AbortController();
        const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000)));
        const timer = setTimeout(() => { try { controller.abort(); } catch {} }, t);
        try {
          const r = await fetch(url, { method: 'GET', signal: controller.signal });
          const text = await r.text();
          let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          const body = json ?? text;
          let instructions = [];
          try {
            const rows = (body && body.rows) || [];
            const filterNa = args.filter_na !== false; // default true
            instructions = rows
              .map(x => String(x?.Id_instruction || '').trim())
              .filter(s => s)
              .filter(s => (filterNa ? s.toLowerCase() !== 'na' : true));
            // De-duplicate by default
            const doUnique = args.unique !== false;
            if (doUnique) instructions = Array.from(new Set(instructions));
            if (args.sort === true) instructions.sort((a,b) => a.localeCompare(b));
          } catch {}
          // Optional persistence into settings table
          let saved = false;
          let saved_key = null;
          if (args.persist === true) {
            try {
              const keyName = String(args.persist_key || `AUTOMATION_INSTRUCTIONS_${(name||'').toUpperCase()}`);
              const value = JSON.stringify({ at: new Date().toISOString(), source: url, name, instructions });
              await pool.query(
                `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
                [keyName, value]
              );
              saved = true; saved_key = keyName;
            } catch {}
          }
          return { ok: !!(body && body.ok), status: r.status, name, url, raw: body, instructions, saved, saved_key };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // Simple instruction list tool using the same PrestaShop endpoint
    { name: 'list_of_instructions', description: 'Return the list of Id_instruction values from the PrestaShop Livechat API (action=custom)', inputSchema: { type: 'object', properties: { base_url: { type: 'string', description: 'Shop base URL, e.g. https://example.com' }, name: { type: 'string', description: 'Custom name parameter' }, key: { type: 'string', description: 'Module API key' }, filter_na: { type: 'boolean', description: 'Filter out rows with Id_instruction = "na"', default: true }, unique: { type: 'boolean', description: 'De-duplicate instructions', default: true }, sort: { type: 'boolean', description: 'Sort instructions ascending', default: true }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['base_url','name','key'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') {
          const reqd = await needsAuth(ctx);
          if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized');
        }
        const base = String(args.base_url || '').trim().replace(/\/$/, '');
        if (!/^https?:\/\//i.test(base)) throw new Error('invalid_base_url');
        const name = String(args.name || '').trim();
        const key = String(args.key || '').trim();
        if (!name || !key) throw new Error('name_and_key_required');
        const url = `${base}/module/livechat/api?action=custom&name=${encodeURIComponent(name)}&key=${encodeURIComponent(key)}`;
        const controller = new AbortController();
        const t = Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000)));
        const timer = setTimeout(() => { try { controller.abort(); } catch {} }, t);
        try {
          const r = await fetch(url, { method: 'GET', signal: controller.signal });
          const text = await r.text();
          let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
          const body = json ?? text;
          let instructions = [];
          try {
            const rows = (body && body.rows) || [];
            const filterNa = args.filter_na !== false; // default true
            instructions = rows
              .map(x => String(x?.Id_instruction || '').trim())
              .filter(s => s)
              .filter(s => (filterNa ? s.toLowerCase() !== 'na' : true));
            if (args.unique !== false) instructions = Array.from(new Set(instructions));
            if (args.sort !== false) instructions.sort((a,b) => a.localeCompare(b));
          } catch {}
          return { ok: !!(body && body.ok), status: r.status, name, url, count: instructions.length, instructions };
        } finally { try { clearTimeout(timer); } catch {} }
      }
    },
    // ---------------- Packeta (Zásilkovna) helpers ----------------
    { name: 'packeta.tracking_link', description: 'Build a Packeta tracking link for a shipment (and optionally fetch details)', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Shipment ID / barcode' }, locale: { type: 'string', description: 'Locale path segment (e.g., cs, en, sk, de)', default: 'cs' }, fetch_details: { type: 'boolean', description: 'Attempt to fetch extra fields (name, email, status) using options.* (details_url_template or xml_api_url + api_password). Also supports headers_json and api_auth/api_key/api_password.', default: true } }, required: ['id'] }, run: async (args = {}, ctx = {}) => {
        throw new Error('tool_disabled');
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim();
        let opt = {};
        if (name) {
          try { const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]); if (rr.rowCount) { opt = rr.rows[0].options || {}; if (typeof opt === 'string') opt = JSON.parse(opt); } } catch {}
        }
        const localeDefault = String(opt.locale || opt.default_locale || 'cs').trim() || 'cs';
        const id = String(args.id || '').trim(); if (!id) throw new Error('id_required');
        const loc = String(args.locale || localeDefault).trim() || 'cs';
        const trackingBase = String(opt.tracking_base_url || 'https://tracking.packeta.com').replace(/\/$/, '');
        const tracking_url = `${trackingBase}/${encodeURIComponent(loc)}/?id=${encodeURIComponent(id)}`;
        const extTmpl = String(opt.tracking_url_external_template || '').trim();
        const tracking_url_external = extTmpl ? extTmpl.replaceAll('{id}', encodeURIComponent(id)).replaceAll('{locale}', encodeURIComponent(loc)) : tracking_url;
        let nameOut = null, emailOut = null, statusOut = null, details = null;
        const wantDetails = args.fetch_details !== false;
        if (wantDetails) {
          try {
            const tmpl = String(opt.details_url_template || '').trim();
            if (tmpl) {
              const detailsUrl = tmpl.replaceAll('{id}', encodeURIComponent(id)).replaceAll('{locale}', encodeURIComponent(loc));
              const headers = {};
              // Custom headers JSON
              try { if (opt.headers_json) { const h = (typeof opt.headers_json === 'string' ? JSON.parse(opt.headers_json) : opt.headers_json); if (h && typeof h === 'object') { for (const [k,v] of Object.entries(h)) { if (v != null) headers[k] = String(v); } } } } catch {}
              // API key/password helpers
              try {
                const key = String(opt.api_key || '').trim();
                const pass = String(opt.api_password || '').trim();
                const authMode = String(opt.api_auth || '').toLowerCase();
                if (key && pass && (authMode === 'basic' || !authMode)) headers['Authorization'] = `Basic ${Buffer.from(`${key}:${pass}`).toString('base64')}`;
                else if (key && authMode === 'bearer') headers['Authorization'] = `Bearer ${key}`;
                else if (key && !authMode) headers['X-Api-Key'] = key;
              } catch {}
              const ctrl = new AbortController(); const t = setTimeout(()=>{ try{ctrl.abort();}catch{} }, Math.max(100, Math.min(15000, Number(opt.details_timeout_ms || 8000))));
              try {
                const r = await fetch(detailsUrl, { method:'GET', headers, signal: ctrl.signal });
                const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
                details = json ?? text;
                // Extract fields via dot paths if configured
                const getPath = (obj, p) => { try { if (!p) return null; return p.split('.').reduce((o,k)=> (o && (k in o)) ? o[k] : null, obj); } catch { return null; } };
                const namePath = String(opt.name_path || '').trim();
                const emailPath = String(opt.email_path || '').trim();
                const statusPath = String(opt.status_path || '').trim();
                if (json && namePath) nameOut = getPath(json, namePath);
                if (json && emailPath) emailOut = getPath(json, emailPath);
                if (json && statusPath) statusOut = getPath(json, statusPath);
                // Fallback heuristics
                if (json && nameOut == null) nameOut = json.name || json.recipient || (json.customer && json.customer.name) || null;
                if (json && emailOut == null) emailOut = json.email || (json.customer && json.customer.email) || null;
                if (json && statusOut == null) statusOut = json.status || json.state || null;
              } finally { try { clearTimeout(t); } catch {} }
            } else {
              // XML (legacy Zásilkovna) API fallback: requires xml_api_url (or api_url) and api_password
              const xmlUrl = String(opt.xml_api_url || opt.api_url || '').trim();
              const apiPass = String(opt.api_password || '').trim();
              if (xmlUrl && apiPass) {
                const idXml = (String(id||'').match(/\d+/g) || []).join('') || String(id||'');
                const payload = `<packetInfo><apiPassword>${apiPass}</apiPassword><packetId>${idXml}</packetId></packetInfo>`;
                const headers = { 'Content-Type': 'text/xml' };
                const ctrl = new AbortController(); const t = setTimeout(()=>{ try{ctrl.abort();}catch{} }, Math.max(100, Math.min(15000, Number(opt.details_timeout_ms || 8000))));
                try {
                  const r = await fetch(xmlUrl, { method:'POST', headers, body: payload, signal: ctrl.signal });
                  const text = await r.text();
                  details = text;
                  // Improved extraction of external tracking URL from XML (prefers matching locale)
                  try {
                    const findCourierUrl = (xmlText, preferredLang) => {
                      try {
                        const pref = String(preferredLang||'').toLowerCase();
                        const rePref = new RegExp(`<courierTrackingUrl>[\\s\\S]*?<lang>\\s*${pref}\\s*<\\/lang>[\\s\\S]*?<url>([\\s\\S]*?)<\\/url>[\\s\\S]*?<\\/courierTrackingUrl>`, 'i');
                        const m1 = rePref.exec(xmlText);
                        if (m1 && m1[1]) return m1[1].trim();
                      } catch {}
                      try {
                        const m2 = /<courierTrackingUrl>[\s\S]*?<url>([\s\S]*?)<\/url>[\s\S]*?<\/courierTrackingUrl>/i.exec(xmlText);
                        if (m2 && m2[1]) return m2[1].trim();
                      } catch {}
                      return null;
                    };
                    const ext2 = findCourierUrl(text, loc);
                    if (ext2) tracking_url_external = ext2;
                  } catch {}
                  const tag = (name)=>{ try { const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(text); return m ? m[1].trim() : null; } catch { return null; } };
                  // Try to extract courierTrackingUrl (external link)
                  let ext = tag('courierTrackingUrl');
                  if (!ext) {
                    const statusText = tag('statusText') || '';
                    const m = /href="([^"]+)"/i.exec(statusText);
                    if (m) ext = m[1];
                  }
                  if (ext) {
                    try { tracking_url_external = ext; } catch {}
                  }
                  // Collect courier metadata and all tracking URLs
                  try {
                    const tagSimple = (nm) => { try { const m = new RegExp(`<${nm}[^>]*>([\\s\\S]*?)</${nm}>`, 'i').exec(text); return m ? m[1].trim() : null; } catch { return null; } };
                    const courierName = tagSimple('courierName');
                    const courierNumber = tagSimple('courierNumber') || tagSimple('courierTrackingNumber');
                    if (courierName) nameOut = nameOut || courierName;
                    if (!statusOut && courierNumber) statusOut = courierNumber;
                    const urls = [];
                    try {
                      const reBlock = /<courierTrackingUrl>[\s\S]*?<\/courierTrackingUrl>/gi;
                      const blocks = text.match(reBlock) || [];
                      for (const b of blocks) {
                        const langM = /<lang[^>]*>([\s\S]*?)<\/lang>/i.exec(b);
                        const urlM = /<url[^>]*>([\s\S]*?)<\/url>/i.exec(b);
                        const lang = langM && langM[1] ? langM[1].trim() : null;
                        const urlV = urlM && urlM[1] ? urlM[1].trim() : null;
                        if (urlV) urls.push({ lang, url: urlV });
                      }
                    } catch {}
                    if (urls.length) {
                      try { details = { xml: text, courier_tracking_urls: urls }; } catch {}
                      if (!tracking_url_external) tracking_url_external = urls[0].url;
                    }
                  } catch {}
                  // Extract common fields (best-effort)
                  const nameTag = String(opt.xml_name_tag || 'name').trim();
                  const emailTag = String(opt.xml_email_tag || 'email').trim();
                  const statusTag = String(opt.xml_status_tag || 'status').trim();
                  nameOut = tag(nameTag) || nameOut;
                  emailOut = tag(emailTag) || emailOut;
                  statusOut = tag(statusTag) || statusOut || tag('state') || tag('statusText');
                } finally { try{ clearTimeout(t); } catch {} }
              }
            }
          } catch {}
        }
        // Surface courier fields at top-level when available
        let courier_name = null, courier_number = null, courier_tracking_urls = null;
        try {
          if (details && typeof details === 'object' && details.courier_tracking_urls) courier_tracking_urls = details.courier_tracking_urls;
          if (!courier_tracking_urls && typeof details === 'string') {
            try {
              const blocks = details.match(/<courierTrackingUrl>[\s\S]*?<\/courierTrackingUrl>/gi) || [];
              const urls = [];
              for (const b of blocks) {
                const lm = /<lang[^>]*>([\s\S]*?)<\/lang>/i.exec(b);
                const um = /<url[^>]*>([\s\S]*?)<\/url>/i.exec(b);
                const lang = lm && lm[1] ? lm[1].trim() : null;
                const url = um && um[1] ? um[1].trim() : null;
                if (url) urls.push({ lang, url });
              }
              if (urls.length) courier_tracking_urls = urls;
            } catch {}
          }
          if (typeof details === 'string') {
            const nm = /<courierName[^>]*>([\s\S]*?)<\/courierName>/i.exec(details);
            courier_name = nm && nm[1] ? nm[1].trim() : null;
            const cn = /<courierNumber[^>]*>([\s\S]*?)<\/courierNumber>/i.exec(details) || /<courierTrackingNumber[^>]*>([\s\S]*?)<\/courierTrackingNumber>/i.exec(details);
            courier_number = cn && cn[1] ? cn[1].trim() : null;
          }
        } catch {}
        return { ok: true, id, locale: loc, tracking_url, tracking_url_external, name: nameOut, email: emailOut, status: statusOut, courier_name, courier_number, courier_tracking_urls, details };
      }
    },
    { name: 'packeta.tracking_link_external', description: 'Return the external courier tracking link for a shipment (and details if available)', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Shipment ID / barcode' }, locale: { type: 'string', description: 'Locale path segment (e.g., cs, en, sk, de)', default: 'cs' }, fetch_details: { type: 'boolean', description: 'Attempt to fetch extra fields (name, email, status) using options.* (details_url_template or xml_api_url + api_password). Also supports headers_json and api_auth/api_key/api_password.', default: true } }, required: ['id'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim();
        let opt = {};
        if (name) {
          try { const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]); if (rr.rowCount) { opt = rr.rows[0].options || {}; if (typeof opt === 'string') opt = JSON.parse(opt); } } catch {}
        }
        const localeDefault = String(opt.locale || opt.default_locale || 'cs').trim() || 'cs';
        const id = String(args.id || '').trim(); if (!id) throw new Error('id_required');
        const loc = String(args.locale || localeDefault).trim() || 'cs';
        const trackingBase = String(opt.tracking_base_url || 'https://tracking.packeta.com').replace(/\/$/, '');
        const tracking_url = `${trackingBase}/${encodeURIComponent(loc)}/?id=${encodeURIComponent(id)}`;
        let tracking_url_external = String(opt.tracking_url_external_template || '').trim();
        if (tracking_url_external) tracking_url_external = tracking_url_external.replaceAll('{id}', encodeURIComponent(id)).replaceAll('{locale}', encodeURIComponent(loc));
        else tracking_url_external = tracking_url;
        let nameOut = null, emailOut = null, statusOut = null, details = null;
        const wantDetails = args.fetch_details !== false;
        if (wantDetails) {
          try {
            // Prefer JSON details endpoint
            const tmpl = String(opt.details_url_template || '').trim();
            if (tmpl) {
              const detailsUrl = tmpl.replaceAll('{id}', encodeURIComponent(id)).replaceAll('{locale}', encodeURIComponent(loc));
              const headers = {};
              try { if (opt.headers_json) { const h = (typeof opt.headers_json === 'string' ? JSON.parse(opt.headers_json) : opt.headers_json); if (h && typeof h === 'object') { for (const [k,v] of Object.entries(h)) { if (v != null) headers[k] = String(v); } } } } catch {}
              try {
                const key = String(opt.api_key || '').trim();
                const pass = String(opt.api_password || '').trim();
                const authMode = String(opt.api_auth || '').toLowerCase();
                if (key && pass && (authMode === 'basic' || !authMode)) headers['Authorization'] = `Basic ${Buffer.from(`${key}:${pass}`).toString('base64')}`;
                else if (key && authMode === 'bearer') headers['Authorization'] = `Bearer ${key}`;
                else if (key && !authMode) headers['X-Api-Key'] = key;
              } catch {}
              const ctrl = new AbortController(); const t = setTimeout(()=>{ try{ctrl.abort();}catch{} }, Math.max(100, Math.min(15000, Number(opt.details_timeout_ms || 8000))));
              try {
                const r = await fetch(detailsUrl, { method:'GET', headers, signal: ctrl.signal });
                const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
                details = json ?? text;
                // Try direct external URL by path
                const getPath = (obj, p) => { try { if (!p) return null; return p.split('.').reduce((o,k)=> (o && (k in o)) ? o[k] : null, obj); } catch { return null; } };
                const externalPath = String(opt.external_url_path || '').trim();
                if (json && externalPath) { const v = getPath(json, externalPath); if (v) tracking_url_external = v; }
                // Name/email/status
                const namePath = String(opt.name_path || '').trim();
                const emailPath = String(opt.email_path || '').trim();
                const statusPath = String(opt.status_path || '').trim();
                if (json && namePath) nameOut = getPath(json, namePath);
                if (json && emailPath) emailOut = getPath(json, emailPath);
                if (json && statusPath) statusOut = getPath(json, statusPath);
                if (json && nameOut == null) nameOut = json.name || json.recipient || (json.customer && json.customer.name) || null;
                if (json && emailOut == null) emailOut = json.email || (json.customer && json.customer.email) || null;
                if (json && statusOut == null) statusOut = json.status || json.state || null;
              } finally { try{ clearTimeout(t); } catch {} }
            } else {
              // Legacy XML API
              const xmlUrl = String(opt.xml_api_url || opt.api_url || '').trim();
              const apiPass = String(opt.api_password || '').trim();
              if (xmlUrl && apiPass) {
                const payload = `<packetInfo><apiPassword>${apiPass}</apiPassword><packetId>${id}</packetId></packetInfo>`;
                const headers = { 'Content-Type': 'text/xml' };
                const ctrl = new AbortController(); const t = setTimeout(()=>{ try{ctrl.abort();}catch{} }, Math.max(100, Math.min(15000, Number(opt.details_timeout_ms || 8000))));
                try {
                  const r = await fetch(xmlUrl, { method:'POST', headers, body: payload, signal: ctrl.signal });
                  const text = await r.text();
                  details = text;
                  const tag = (nm)=>{ try { const m = new RegExp(`<${nm}[^>]*>([\\s\\S]*?)</${nm}>`, 'i').exec(text); return m ? m[1].trim() : null; } catch { return null; } };
                  let ext = tag('courierTrackingUrl');
                  if (!ext) { const statusText = tag('statusText') || ''; const m = /href="([^"]+)"/i.exec(statusText); if (m) ext = m[1]; }
                  if (ext) tracking_url_external = ext;
                  // Collect courier metadata and all tracking URLs
                  try {
                    const tagSimple = (nm) => { try { const m = new RegExp(`<${nm}[^>]*>([\\s\\S]*?)</${nm}>`, 'i').exec(text); return m ? m[1].trim() : null; } catch { return null; } };
                    const courierName = tagSimple('courierName');
                    const courierNumber = tagSimple('courierNumber') || tagSimple('courierTrackingNumber');
                    if (courierName) nameOut = nameOut || courierName;
                    if (!statusOut && courierNumber) statusOut = courierNumber;
                    const urls = [];
                    try {
                      const reBlock = /<courierTrackingUrl>[\s\S]*?<\/courierTrackingUrl>/gi;
                      const blocks = text.match(reBlock) || [];
                      for (const b of blocks) {
                        const langM = /<lang[^>]*>([\s\S]*?)<\/lang>/i.exec(b);
                        const urlM = /<url[^>]*>([\s\S]*?)<\/url>/i.exec(b);
                        const lang = langM && langM[1] ? langM[1].trim() : null;
                        const urlV = urlM && urlM[1] ? urlM[1].trim() : null;
                        if (urlV) urls.push({ lang, url: urlV });
                      }
                    } catch {}
                    if (urls.length) {
                      try { details = { xml: text, courier_tracking_urls: urls }; } catch {}
                      if (!tracking_url_external) tracking_url_external = urls[0].url;
                    }
                  } catch {}
                  const nameTag = String(opt.xml_name_tag || 'name').trim();
                  const emailTag = String(opt.xml_email_tag || 'email').trim();
                  const statusTag = String(opt.xml_status_tag || 'status').trim();
                  nameOut = tag(nameTag) || nameOut;
                  emailOut = tag(emailTag) || emailOut;
                  statusOut = tag(statusTag) || statusOut || tag('state') || tag('statusText');
                } finally { try{ clearTimeout(t); } catch {} }
              }
            }
          } catch {}
        }
        return { ok: true, id, locale: loc, tracking_url_external, tracking_url, name: nameOut, email: emailOut, status: statusOut, details };
      }
    },
    // Return structured JSON from packetInfo (legacy XML API)
    { name: 'packeta.packet_info', description: 'Call packetInfo (legacy XML) and return structured courier data', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Shipment ID / barcode' }, locale: { type: 'string', description: 'Preferred locale for external URL selection', default: 'cs' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } }, required: ['id'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim();
        let opt = {};
        if (name) {
          try { const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]); if (rr.rowCount) { opt = rr.rows[0].options || {}; if (typeof opt === 'string') opt = JSON.parse(opt); } } catch {}
        }
        const xmlUrl = String(opt.xml_api_url || opt.api_url || '').trim();
        const apiPass = String(opt.api_password || '').trim();
        const loc = (String(args.locale || opt.locale || opt.default_locale || 'cs').trim() || 'cs').toLowerCase();
        const idRaw = String(args.id || '').trim(); if (!idRaw) throw new Error('id_required');
        // Graceful fallback (behave like packeta.tracking_link) when XML config is missing
        if (!xmlUrl || !apiPass) {
          const trackingBase = String(opt.tracking_base_url || 'https://tracking.packeta.com').replace(/\/$/, '');
          const tracking_url = `${trackingBase}/${encodeURIComponent(loc)}/?id=${encodeURIComponent(idRaw)}`;
          return {
            ok: true,
            id: idRaw,
            locale: loc,
            courier: { id: null, name: null, numbers: [], barcodes: [], tracking_numbers: [], tracking_urls: [], external_url: null },
            branch_id: null,
            invoiced_weight_grams: null,
            xml: null,
            warning: 'xml_api_url_and_api_password_missing',
            tracking_url,
            tracking_url_external: tracking_url,
          };
        }
        // XML mode
        const idRaw2 = idRaw;
        const idXml = (idRaw.match(/\d+/g) || []).join('') || idRaw;
        const payload = `<packetInfo><apiPassword>${apiPass}</apiPassword><packetId>${idXml}</packetId></packetInfo>`;
        const headers = { 'Content-Type': 'text/xml' };
        const controller = new AbortController();
        const t = setTimeout(()=>{ try{ controller.abort(); } catch {} }, Math.max(100, Math.min(60000, Number(args.timeout_ms || opt.details_timeout_ms || 8000))));
        try {
          const r = await fetch(xmlUrl, { method:'POST', headers, body: payload, signal: controller.signal });
          const text = await r.text();
          // Build helpers
          const first = (re) => { try { const m = re.exec(text); return m && m[1] ? m[1].trim() : null; } catch { return null; } };
          const all = (re, group=1) => { try { const out=[]; let m; while ((m = re.exec(text))) { const v = m[group]; if (v) out.push(v.trim()); } return out; } catch { return []; } };
          // Core fields
          const branch_id = first(/<branchId[^>]*>([\s\S]*?)<\/branchId>/i);
          const invoiced_weight_grams = first(/<invoicedWeightGrams[^>]*>([\s\S]*?)<\/invoicedWeightGrams>/i);
          const courier_id = first(/<courierId[^>]*>([\s\S]*?)<\/courierId>/i);
          const courier_name = first(/<courierName[^>]*>([\s\S]*?)<\/courierName>/i);
          const courier_numbers = all(/<courierNumber[^>]*>([\s\S]*?)<\/courierNumber>/gi);
          const courier_barcodes = all(/<courierBarcode[^>]*>([\s\S]*?)<\/courierBarcode>/gi);
          const courier_tracking_numbers = all(/<courierTrackingNumber[^>]*>([\s\S]*?)<\/courierTrackingNumber>/gi);
          // Tracking URLs (lang/url pairs) — parse per block
          const tracking_urls = [];
          try {
            const blockRe = /<courierTrackingUrl>[\s\S]*?<\/courierTrackingUrl>/gi;
            let bm;
            while ((bm = blockRe.exec(text))) {
              const b = bm[0];
              try {
                const langM = /<lang[^>]*>([\s\S]*?)<\/lang>/i.exec(b);
                const urlM = /<url[^>]*>([\s\S]*?)<\/url>/i.exec(b);
                const lang = langM && langM[1] ? langM[1].trim() : null;
                const url = urlM && urlM[1] ? urlM[1].trim() : null;
                if (url) tracking_urls.push({ lang, url });
              } catch {}
            }
          } catch {}
          // Prefer URL matching locale
          let external_url = null;
          try {
            const match = tracking_urls.find(x => String(x.lang||'').trim().toLowerCase() === loc);
            external_url = (match && match.url) || (tracking_urls[0] && tracking_urls[0].url) || null;
          } catch {}
          return {
            ok: true,
            id: idRaw,
            locale: loc,
            branch_id,
            invoiced_weight_grams,
            courier: {
              id: courier_id,
              name: courier_name,
              numbers: courier_numbers,
              barcodes: courier_barcodes,
              tracking_numbers: courier_tracking_numbers,
              tracking_urls,
              external_url,
            },
            xml: text,
          };
        } finally { try { clearTimeout(t); } catch {} }
      }
    },
    // Generic Packeta API request (REST or XML) using server options/auth
    { name: 'packeta.request', description: 'Send a request to Packeta API using saved auth (REST or XML).', inputSchema: { type: 'object', properties: { xml: { type: 'boolean', description: 'When true, send to xml_api_url with XML body' }, method: { type: 'string', enum: ['GET','POST','PUT','PATCH','DELETE'], default: 'GET' }, path: { type: 'string', description: 'Relative path for REST requests, e.g., /v1/shipments' }, query: { type: 'object', additionalProperties: { type: 'string' } }, headers: { type: 'object', additionalProperties: { type: 'string' } }, body: { anyOf: [{ type: 'object' }, { type: 'string' }], description: 'JSON body for REST or raw XML when xml=true' }, xml_template: { type: 'string', description: 'Optional XML template with {id} and {locale} placeholders' }, id: { type: 'string', description: 'For xml_template substitution' }, locale: { type: 'string', description: 'For xml_template substitution', default: 'cs' }, timeout_ms: { type: 'integer', minimum: 100, maximum: 60000 } } }, run: async (args = {}, ctx = {}) => {
        throw new Error('tool_disabled');
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const name = String(ctx.server_name || '').trim();
        let opt = {};
        if (name) { try { const rr = await pool.query(`SELECT options FROM mcp_server_config WHERE name=$1 LIMIT 1`, [name]); if (rr.rowCount) { opt = rr.rows[0].options || {}; if (typeof opt === 'string') opt = JSON.parse(opt); } } catch {}
        }
        const controller = new AbortController();
        const t = setTimeout(()=>{ try{controller.abort();}catch{} }, Math.max(100, Math.min(60000, Number(args.timeout_ms || 10000))));
        try {
          if (args.xml === true) {
            const xmlUrl = String(opt.xml_api_url || opt.api_url || '').trim();
            const apiPass = String(opt.api_password || '').trim();
            if (!xmlUrl || !apiPass) throw new Error('xml_api_url_and_api_password_required');
            let xmlBody = '';
            if (typeof args.body === 'string' && args.body.trim()) xmlBody = args.body.trim();
            else if (typeof args.xml_template === 'string' && args.xml_template.trim()) {
              const idRaw = String(args.id || '').trim();
              const idXml = (idRaw.match(/\d+/g) || []).join('') || idRaw;
              const loc = String(args.locale || opt.locale || opt.default_locale || 'cs').trim() || 'cs';
              xmlBody = args.xml_template.replaceAll('{api_password}', apiPass).replaceAll('{id}', idXml).replaceAll('{locale}', loc);
            } else {
              const idRaw = String(args.id || '').trim();
              const idXml = (idRaw.match(/\d+/g) || []).join('') || idRaw;
              xmlBody = `<packetInfo><apiPassword>${apiPass}</apiPassword><packetId>${idXml}</packetId></packetInfo>`;
            }
            const headers = { 'Content-Type': 'text/xml' };
            try { if (args.headers && typeof args.headers === 'object') { for (const [k,v] of Object.entries(args.headers)) { if (v != null) headers[k] = String(v); } } } catch {}
            const r = await fetch(xmlUrl, { method: 'POST', headers, body: xmlBody, signal: controller.signal });
            const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
            return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), body: json ?? text };
          } else {
            const base = String(opt.api_base_url || opt.base_url || '').trim().replace(/\/$/, '');
            if (!/^https?:\/\//i.test(base)) throw new Error('invalid_api_base');
            const p = ('/' + String(args.path || '').trim()).replace(/\/+/g, '/');
            const u = new URL(base + p);
            try { if (args.query && typeof args.query === 'object') { for (const [k,v] of Object.entries(args.query)) { if (v != null) u.searchParams.set(k, String(v)); } } } catch {}
            const headers = { 'Accept': 'application/json' };
            try { if (opt.headers_json) { const h = typeof opt.headers_json === 'string' ? JSON.parse(opt.headers_json) : opt.headers_json; if (h && typeof h === 'object') { for (const [k,v] of Object.entries(h)) { if (v != null) headers[k] = String(v); } } } } catch {}
            try {
              const key = String(opt.api_key || '').trim();
              const pass = String(opt.api_password || '').trim();
              const authMode = String(opt.api_auth || '').toLowerCase();
              if (key && pass && (authMode === 'basic' || !authMode)) headers['Authorization'] = `Basic ${Buffer.from(`${key}:${pass}`).toString('base64')}`;
              else if (key && authMode === 'bearer') headers['Authorization'] = `Bearer ${key}`;
              else if (key && !authMode) headers['X-Api-Key'] = key;
            } catch {}
            try { if (args.headers && typeof args.headers === 'object') { for (const [k,v] of Object.entries(args.headers)) { if (v != null) headers[k] = String(v); } } } catch {}
            const method = String(args.method || 'GET').toUpperCase();
            let body;
            if (method !== 'GET' && args.body !== undefined) body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
            if (body && !headers['Content-Type']) headers['Content-Type'] = typeof args.body === 'string' ? 'text/plain' : 'application/json';
            const r = await fetch(u.toString(), { method, headers, body, signal: controller.signal });
            const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
            return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers||[]), body: json ?? text };
          }
        } finally { try { clearTimeout(t); } catch {} }
      }
    },
    // Postgres helpers: look up Packeta (Zásilkovna) packet_id from grabbing_zasilkovna
    { name: 'postgresql.get_packetid_by_email', description: 'Find latest Packeta packet_id rows by customer email from grabbing_zasilkovna (PostgreSQL)', inputSchema: { type: 'object', properties: { email: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 5 } }, required: ['email'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const email = String(args.email || '').trim();
        if (!email) throw new Error('email_required');
        const limit = Math.max(1, Math.min(50, Number(args.limit || 5)));
        const sql = `
          SELECT packet_id, id_order, submission_number, barcode, status,
                 ready_for_pickup_until, delivered_on, consigned_date,
                 name, surname, customer_email, packet_price, created_at, updated_at
            FROM grabbing_zasilkovna
           WHERE customer_email ILIKE $1
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT $2`;
        const r = await pool.query(sql, [email, limit]);
        return { count: r.rowCount || 0, items: r.rows || [] };
      }
    },
    { name: 'postgresql.get_packetid_by_name', description: 'Find Packeta packet_id by customer name or surname from grabbing_zasilkovna (PostgreSQL)', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Full or partial name' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 5 } }, required: ['name'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const q = String(args.name || '').trim();
        if (!q) throw new Error('name_required');
        const like = `%${q}%`;
        const limit = Math.max(1, Math.min(50, Number(args.limit || 5)));
        const sql = `
          SELECT packet_id, id_order, submission_number, barcode, status,
                 ready_for_pickup_until, delivered_on, consigned_date,
                 name, surname, customer_email, packet_price, created_at, updated_at
            FROM grabbing_zasilkovna
           WHERE COALESCE(name,'') ILIKE $1
              OR COALESCE(surname,'') ILIKE $1
              OR (COALESCE(name,'') || ' ' || COALESCE(surname,'')) ILIKE $1
              OR (COALESCE(surname,'') || ' ' || COALESCE(name,'')) ILIKE $1
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT $2`;
        const r = await pool.query(sql, [like, limit]);
        return { count: r.rowCount || 0, items: r.rows || [] };
      }
    },
    { name: 'postgresql.get_packetid_by_id_order', description: 'Find Packeta packet_id rows by id_order from grabbing_zasilkovna (PostgreSQL)', inputSchema: { type: 'object', properties: { id_order: { anyOf: [{ type: 'integer' }, { type: 'string' }] }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 5 } }, required: ['id_order'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        let idOrder = null;
        try { idOrder = parseInt(String(args.id_order || '').match(/\d+/g)?.join('') || '', 10); } catch {}
        if (!Number.isFinite(idOrder) || idOrder <= 0) throw new Error('id_order_invalid');
        const limit = Math.max(1, Math.min(50, Number(args.limit || 5)));
        const sql = `
          SELECT packet_id, id_order, submission_number, barcode, status,
                 ready_for_pickup_until, delivered_on, consigned_date,
                 name, surname, customer_email, packet_price, created_at, updated_at
            FROM grabbing_zasilkovna
           WHERE id_order = $1
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT $2`;
        const r = await pool.query(sql, [idOrder, limit]);
        return { count: r.rowCount || 0, items: r.rows || [] };
      }
    },
    { name: 'postgresql.get_packetid_by_surname', description: 'Find Packeta packet_id rows by customer surname from grabbing_zasilkovna (PostgreSQL)', inputSchema: { type: 'object', properties: { surname: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 5 } }, required: ['surname'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const q = String(args.surname || '').trim();
        if (!q) throw new Error('surname_required');
        const like = `%${q}%`;
        const limit = Math.max(1, Math.min(50, Number(args.limit || 5)));
        const sql = `
          SELECT packet_id, id_order, submission_number, barcode, status,
                 ready_for_pickup_until, delivered_on, consigned_date,
                 name, surname, customer_email, packet_price, created_at, updated_at
            FROM grabbing_zasilkovna
           WHERE COALESCE(surname,'') ILIKE $1
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT $2`;
        const r = await pool.query(sql, [like, limit]);
        return { count: r.rowCount || 0, items: r.rows || [] };
      }
    },
    { name: 'postgresql.get_status_by_packetid', description: 'Get latest status fields for a given packet_id from grabbing_zasilkovna (PostgreSQL)', inputSchema: { type: 'object', properties: { packet_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 1 } }, required: ['packet_id'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const pid = String(args.packet_id || '').trim();
        if (!pid) throw new Error('packet_id_required');
        const limit = Math.max(1, Math.min(20, Number(args.limit || 1)));
        const sql = `
          SELECT packet_id, status,
                 ready_for_pickup_until, delivered_on, consigned_date,
                 id_order, submission_number, barcode,
                 created_at, updated_at
            FROM grabbing_zasilkovna
           WHERE packet_id = $1
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT $2`;
        const r = await pool.query(sql, [pid, limit]);
        return { count: r.rowCount || 0, items: r.rows || [] };
      }
    },
    { name: 'postgresql.get_date_of_delivery_by_packetid', description: 'Get delivered_on date(s) for a given packet_id from grabbing_zasilkovna (PostgreSQL)', inputSchema: { type: 'object', properties: { packet_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 1 } }, required: ['packet_id'] }, run: async (args = {}, ctx = {}) => {
        if (typeof needsAuth === 'function') { const reqd = await needsAuth(ctx); if (reqd && !(ctx?.session?.authed)) throw new Error('unauthorized'); }
        const pid = String(args.packet_id || '').trim();
        if (!pid) throw new Error('packet_id_required');
        const limit = Math.max(1, Math.min(20, Number(args.limit || 1)));
        const sql = `
          SELECT packet_id, delivered_on,
                 status, id_order, submission_number, barcode,
                 created_at, updated_at
            FROM grabbing_zasilkovna
           WHERE packet_id = $1
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT $2`;
        const r = await pool.query(sql, [pid, limit]);
        return { count: r.rowCount || 0, items: r.rows || [] };
      }
    },
    // Debug helper: return effective Packeta options for this server (masked)
    { name: 'packeta.debug_options', description: 'Return effective Packeta server options (passwords masked) to verify configuration.', inputSchema: { type: 'object', properties: {} }, run: async (args = {}, ctx = {}) => { throw new Error('tool_disabled'); } },
  ];

  function list() {
    // Expose camelCase only; ChatGPT MCP loader expects inputSchema
    return TOOL_DEFS.map(t => ({
      name: t.name,
      description: t.description,
      // Provide both casings for broader client compatibility
      inputSchema: t.inputSchema,
      input_schema: t.inputSchema,
    }));
  }
  async function run(name, args, ctx) {
    const t = TOOL_DEFS.find(x => x.name === name);
    if (!t) throw new Error(`Unknown tool: ${name}`);
    return await t.run(args || {}, ctx || {});
  }

  // Map to OpenAI function-tools definitions
  function toFunctionTools(allowNames = null) {
    const allowed = new Set(Array.isArray(allowNames) && allowNames.length ? allowNames : TOOL_DEFS.map(t => t.name));
    // Flattened function tool shape for OpenAI Responses API
    // { type: 'function', name, description, parameters }
    return TOOL_DEFS
      .filter(t => allowed.has(t.name))
      .map(t => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      }));
  }

  return { tools: list, run, toFunctionTools };
}
