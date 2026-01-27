// Minimal MCP2 transport endpoints to validate connectivity with Inspector
// - GET /mcp2/:name/events  -> SSE test stream
// - GET /mcp2/:name/stream  -> NDJSON streaming test

export function registerMcp2TransportRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : null;
  const backendDir = (() => {
    try { return String(ctx?.backendDir || '').trim() || process.cwd(); } catch { return process.cwd(); }
  })();
  // In-memory stream sessions: name -> sessionId -> { res, createdAt }
  const sessions = new Map();
  function computeBase(req) {
    try {
      const xfProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
      const proto = xfProto || (req?.protocol) || (req?.secure ? 'https' : 'http');
      const xfHost = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
      const host = xfHost || String(req?.headers?.host || '');
      if (!host) return '';
      return `${proto}://${host}`;
    } catch {
      return '';
    }
  }
  function toAbsoluteUrl(req, path) {
    try {
      const base = computeBase(req);
      const p = String(path || '');
      if (!base) return p;
      return p.startsWith('/') ? `${base}${p}` : `${base}/${p}`;
    } catch {
      return path;
    }
  }
  // In-memory recent JSON-RPC calls (for debugging OpenAI/MCP Inspector): name -> [{ ts, method, id, params }]
  const recentRpc = new Map();
  function pushRecentRpc(name, entry) {
    try {
      const key = String(name || '').trim();
      if (!key) return;
      const arr = recentRpc.get(key) || [];
      arr.push(entry);
      while (arr.length > 10) arr.shift();
      recentRpc.set(key, arr);
    } catch {}
  }
  function redactDeep(value) {
    const MAX_STR = 800;
    const isSensitiveKey = (k) => {
      const s = String(k || '').toLowerCase();
      return s.includes('token') || s.includes('api_key') || s.includes('apikey') || s.includes('password') || s.includes('secret') || s.includes('authorization');
    };
    const walk = (v, keyHint) => {
      if (v == null) return v;
      const t = typeof v;
      if (t === 'string') {
        if (isSensitiveKey(keyHint)) return '****';
        return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…[truncated]` : v;
      }
      if (t === 'number' || t === 'boolean') return v;
      if (Array.isArray(v)) return v.slice(0, 50).map((x) => walk(x, keyHint));
      if (t === 'object') {
        const out = {};
        for (const [k, vv] of Object.entries(v)) out[k] = isSensitiveKey(k) ? '****' : walk(vv, k);
        return out;
      }
      return String(v);
    };
    return walk(value, null);
  }
  function withTokenQuery(req, url) {
    try {
      let tok = String(req?.query?.token || '').trim();
      if (!tok) {
        const h = String(req?.headers?.authorization || req?.headers?.Authorization || '').trim();
        if (/^bearer\\s+/i.test(h)) tok = h.replace(/^bearer\\s+/i, '').trim();
      }
      if (!tok) return url;
      const u = String(url || '');
      const sep = u.includes('?') ? '&' : '?';
      return `${u}${sep}token=${encodeURIComponent(tok)}`;
    } catch {
      return url;
    }
  }

  function safeJsonParse(s, dflt) {
    try { return typeof s === 'string' ? JSON.parse(s) : (s || dflt); } catch { return dflt; }
  }
  function ensureSchema(obj) {
    try {
      const o = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? { ...obj } : {};
      if (o.type !== 'object') o.type = 'object';
      return o;
    } catch { return { type: 'object' }; }
  }
  function dedupeTools(list) {
    try {
      const out = [];
      const seen = new Set();
      for (const t of (Array.isArray(list) ? list : [])) {
        const key = String(t?.name || '').trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(t);
      }
      return out;
    } catch { return Array.isArray(list) ? list : []; }
  }
  function isServerOnly(opt) {
    try {
      const o = (typeof opt === 'string') ? JSON.parse(opt) : (opt || {});
      const mode = String(o.persist_mode || o.tools_source || o.tools_strategy || '').toLowerCase();
      return mode === 'server_only';
    } catch { return false; }
  }
  function isPersistDisabled(opt) {
    try {
      const o = (typeof opt === 'string') ? JSON.parse(opt) : (opt || {});
      if (o.persist_disabled === true) return true;
      if (o.persist_enabled === false) return true;
      if (String(o.persist_mode||'').toLowerCase() === 'disabled') return true;
      return false;
    } catch { return false; }
  }
  function flattenConfig(cfg) {
    try {
      if (cfg && typeof cfg === 'object' && cfg.config && typeof cfg.config === 'object' && !cfg.sql && (cfg.config.sql || cfg.config.driver)) {
        return cfg.config;
      }
    } catch {}
    return (cfg && typeof cfg === 'object') ? cfg : {};
  }
  function normalizeTypeToolRow(row) {
    try {
      const tool_id = String(row?.tool_id || row?.id || '').trim();
      const name = String(row?.name || tool_id || '').trim();
      if (!name) return null;
      const description = typeof row?.description === 'string' ? row.description : '';
      const inputSchema = (row?.input_schema && typeof row.input_schema === 'object') ? row.input_schema : { type: 'object' };
      const rawCode = row?.code;
      const codeObj = typeof rawCode === 'string' ? safeJsonParse(rawCode, {}) : rawCode;
      const config = flattenConfig(codeObj);
      return { tool_id: tool_id || null, name, description, inputSchema, config, enabled: true };
    } catch { return null; }
  }
  async function resolveTypeId(typeRef) {
    const ref = String(typeRef || '').trim();
    if (!ref || !pool || typeof pool.query !== 'function') return null;
    try {
      const r = await pool.query(
        `SELECT id
           FROM mod_mcp2_type
          WHERE id = $1 OR lower(code) = lower($1) OR lower(name) = lower($1)
          LIMIT 1`,
        [ref]
      );
      return r?.rows?.[0]?.id ? String(r.rows[0].id) : null;
    } catch {
      return null;
    }
  }
  async function hasToolCatalog() {
    try {
      if (!pool || typeof pool.query !== 'function') return false;
      const r = await pool.query(`SELECT to_regclass('public.mod_mcp2_tool') AS reg`);
      return !!(r?.rows?.[0]?.reg);
    } catch { return false; }
  }
  async function loadTypeToolsByTypeId(typeId) {
    if (!pool) return [];
    const tidRef = String(typeId || '').trim();
    if (!tidRef) return [];
    const resolved = await resolveTypeId(tidRef);
    const ids = Array.from(new Set([resolved, tidRef].filter(Boolean)));
    try {
      const useCatalog = await hasToolCatalog();
      const r = useCatalog
        ? await pool.query(
          `SELECT tt.tool_id,
                  t.name,
                  t.description,
                  t.input_schema,
                  t.code
             FROM mod_mcp2_type_tool tt
             JOIN mod_mcp2_tool t ON t.id = tt.tool_id
            WHERE tt.type_id = ANY($1::text[])
            ORDER BY lower(t.name)`,
          [ids]
        )
        : await pool.query(
          `SELECT tool_id, tool_id AS name, NULL::text AS description, NULL::jsonb AS input_schema, NULL::jsonb AS code
             FROM mod_mcp2_type_tool
            WHERE type_id = ANY($1::text[])
            ORDER BY tool_id`,
          [ids]
        );
      return (r.rows || []).map(normalizeTypeToolRow).filter(Boolean);
    } catch { return []; }
  }

  async function loadServerToolEnabledMap(serverId) {
    const map = new Map();
    try {
      if (!pool || typeof pool.query !== 'function') return map;
      const id = String(serverId || '').trim();
      if (!id) return map;
      const r = await pool.query(`SELECT tool_id, enabled FROM mod_mcp2_server_tool WHERE server_id=$1`, [id]);
      for (const row of (r.rows || [])) {
        const tid = String(row?.tool_id || '').trim();
        if (!tid) continue;
        map.set(tid, row.enabled !== false);
      }
    } catch {}
    return map;
  }

  function detectToolDriver(cfg) {
    try {
      const c = (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) ? cfg : {};
      const driver = String(c.driver || '').toLowerCase();
      if (driver === 'postgresql') return 'postgresql';
      if (driver === 'mysql') return 'mysql';
      if (driver === 'google-api') return 'google-api';
      if (driver === 'filedata') return 'filedata';
      if (driver === 'http' || driver === 'https') return 'http';
      if (typeof c.sql === 'string' && c.sql.trim()) return 'mysql';
      return null;
    } catch { return null; }
  }

  async function resolveExecutableTool(serverConfig, foundTool, requestedName) {
    const base = foundTool && typeof foundTool === 'object' ? foundTool : {};
    const cfg = (base.config && typeof base.config === 'object') ? base.config : {};
    const driver = detectToolDriver(cfg);
    if (driver) return { driver, tool: base };
    return null;
  }

  async function listToolsForServer(serverNameOrId) {
    try {
      const srv = await loadServerConfigByNameOrId(serverNameOrId);
      if (!srv) return [];
      if (isServerOnly(srv.options)) return [];
      if (Array.isArray(srv.tools) && srv.tools.length) {
        return srv.tools
          .filter((t) => t && t.name && t.enabled !== false)
          .map((t) => ({ name: String(t.name).trim(), description: String(t.description || ''), inputSchema: ensureSchema(pickSchema(t)) }))
          .filter((t) => t.name);
      }
      return [];
    } catch {
      return [];
    }
  }

  async function callToolForServer(serverNameOrId, toolName, args) {
    const tool = String(toolName || '').trim();
    const inputArgs = (args && typeof args === 'object') ? args : {};
    const srv = await loadServerConfigByNameOrId(serverNameOrId);
    if (!srv) return { ok:false, error:'unknown_tool' };

    const cands = normalizeToolNames(tool);
    const found = (Array.isArray(srv.tools) ? srv.tools : []).find((t) => {
      const n = String(t?.name || '').trim();
      if (!n) return false;
      return cands.includes(n) || normalizeToolNames(n).some((x) => cands.includes(x));
    }) || null;

    if (found && found.enabled === false) return { ok:false, error:'tool_disabled' };
    if (found) {
      const resolved = await resolveExecutableTool(srv, found, tool);
      if (resolved?.driver === 'mysql') return await executeMysqlTool(serverNameOrId, srv, resolved.tool, inputArgs);
      if (resolved?.driver === 'postgresql') return await executePostgresTool(serverNameOrId, srv, resolved.tool, inputArgs);
      if (resolved?.driver === 'google-api') return await executeGoogleApiTool(serverNameOrId, srv, resolved.tool, inputArgs);
      if (resolved?.driver === 'filedata') return await executeFiledataTool(serverNameOrId, srv, resolved.tool, inputArgs);
      if (resolved?.driver === 'http') return await executeHttpTool(serverNameOrId, srv, resolved.tool, inputArgs);
      try {
        chatLog?.('mcp2_tool_driver_missing', {
          server: String(srv?.name || serverNameOrId || ''),
          tool: String(found?.name || tool || ''),
          tool_id: found?.tool_id || null,
          config_keys: Object.keys((found && found.config && typeof found.config === 'object') ? found.config : {}),
        });
      } catch {}
      return { ok:false, error:'unsupported_tool_driver', message:'Tool has no executable config. Add mysql, postgresql, google-api, or filedata driver to mod_mcp2_tool.code.' };
    }

    return { ok:false, error:'unknown_tool' };
  }

  function isObj(v) { return !!(v && typeof v === 'object' && !Array.isArray(v)); }
  function tpl(value, ctx) {
    try {
      if (value == null) return value;
      const s = String(value);
      return s.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_m, exprRaw) => {
        const expr = String(exprRaw || '').trim();
        if (!expr) return '';
        if (expr === 'token') return String(ctx?.server?.token || '');
        if (expr === 'http_base') return String(ctx?.server?.http_base || ctx?.server?.httpBase || '');
        if (expr.startsWith('options.')) {
          const k = expr.slice('options.'.length);
          return String(ctx?.server?.options?.[k] ?? '');
        }
        if (expr.startsWith('args.')) {
          const k = expr.slice('args.'.length);
          return String(ctx?.args?.[k] ?? '');
        }
        return '';
      });
    } catch { return value; }
  }

  async function executeHttpTool(serverName, serverConfig, tool, args) {
    let cfg = (tool && tool.config) || {};
    if (cfg && typeof cfg === 'object' && cfg.config && typeof cfg.config === 'object' && !cfg.sql && (cfg.config.url || cfg.config.path || cfg.config.driver)) {
      cfg = cfg.config;
    }
    const method = String(cfg.method || 'GET').trim().toUpperCase();
    const timeoutMs = Math.max(100, Math.min(60000, Number(args?.timeout_ms || args?.timeoutMs || cfg.timeout_ms || cfg.timeoutMs || 20000)));

    const params = (args && typeof args === 'object') ? { ...args } : {};
    // Convenience: for DHL tools/endpoints, default dhl_profile_id from server.origin_profile_id
    try {
      const origin = String((serverConfig && serverConfig.options && (serverConfig.options.origin_module || serverConfig.options.module)) || '').trim();
      const toolName = String((tool && tool.name) || '').trim().toLowerCase();
      const cfgPathHint = String(cfg.path || cfg.url || '').trim().toLowerCase();
      const looksLikeDhlTool =
        origin === 'dhl' ||
        toolName.startsWith('dhl.') ||
        cfgPathHint.startsWith('/api/dhl/') ||
        cfgPathHint.includes('/api/dhl/');
      if (looksLikeDhlTool) {
        const pid = serverConfig && serverConfig.options ? serverConfig.options.origin_profile_id : null;
        const has = (params.dhl_profile_id != null) ? String(params.dhl_profile_id).trim() : '';
        if (!has && pid != null && String(pid).trim()) params.dhl_profile_id = pid;
      }
    } catch {}

    const baseFromCfg = String(cfg.base_url || cfg.baseUrl || serverConfig.http_base || serverConfig.httpBase || serverConfig.options?.http_base || serverConfig.options?.base_url || serverConfig.options?.api_base_url || '').trim().replace(/\/$/, '');
    const url0 = String(cfg.url || '').trim();
    const path0 = String(cfg.path || '').trim();
    let base0 = baseFromCfg;
    // If no base is configured and the tool uses a relative /api/* path, default to local backend.
    try {
      const looksRelative = !/^https?:\/\//i.test(url0 || '') && !/^https?:\/\//i.test(path0 || '');
      const wantsLocal = String(url0 || path0 || '').trim().startsWith('/');
      if (!base0 && looksRelative && wantsLocal) {
        const port = Number(process.env.PORT || process.env.BACKEND_PORT || 3010) || 3010;
        base0 = `http://127.0.0.1:${port}`;
      }
    } catch {}
    const full = /^https?:\/\//i.test(url0) ? url0 : (url0 ? (base0 ? `${base0}${url0.startsWith('/') ? '' : '/'}${url0}` : url0) : (base0 ? `${base0}${path0.startsWith('/') ? '' : '/'}${path0}` : path0));
    if (!/^https?:\/\//i.test(full)) return { ok:false, error:'http_base_missing', message:'Missing http_base/base_url in server or tool config.' };

    const u = new URL(full);
    const qMap = isObj(cfg.query) ? cfg.query : null;
    if (qMap) {
      for (const [k, v] of Object.entries(qMap)) {
        if (v == null) continue;
        if (typeof v === 'string') {
          const vv = v.startsWith(':') ? params[v.slice(1)] : tpl(v, { server: serverConfig, args: params });
          if (vv != null && vv !== '') u.searchParams.set(k, String(vv));
        } else if (isObj(v) && v.arg) {
          const vv = params[String(v.arg)];
          if (vv != null && vv !== '') u.searchParams.set(k, String(vv));
        } else {
          if (v !== '') u.searchParams.set(k, String(v));
        }
      }
    } else if (method === 'GET') {
      // Default: append primitive args as query params
      for (const [k, v] of Object.entries(params)) {
        if (v == null) continue;
        if (typeof v === 'object') continue;
        if (k === 'timeout_ms' || k === 'timeoutMs') continue;
        u.searchParams.set(k, String(v));
      }
    }

    const headers = {};
    try {
      const baseHeaders = isObj(cfg.headers) ? cfg.headers : {};
      for (const [k, v] of Object.entries(baseHeaders)) {
        if (v == null) continue;
        headers[String(k)] = tpl(v, { server: serverConfig, args: params });
      }
    } catch {}
    if (!headers.Accept) headers.Accept = 'application/json';
    // Convenience: auto-attach subscription key if configured on server
    try {
      const k = String(serverConfig?.options?.api_key || serverConfig?.options?.apiKey || '').trim();
      const hk = String(cfg.api_key_header || cfg.apiKeyHeader || '').trim();
      if (k && hk && !headers[hk]) headers[hk] = k;
    } catch {}

    const ctrl = new AbortController();
    const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, timeoutMs);
    try {
      const init = { method, headers, signal: ctrl.signal };
      if (method !== 'GET' && method !== 'HEAD') {
        const bodyObj = (cfg.body && isObj(cfg.body)) ? cfg.body : null;
        const payload = bodyObj ? JSON.parse(tpl(JSON.stringify(bodyObj), { server: serverConfig, args: params })) : params;
        init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
        init.body = JSON.stringify(payload);
      }
      const r = await fetch(u.toString(), init);
      const text = await r.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { ok: r.ok, status: r.status, url: u.toString(), body };
    } finally {
      try { clearTimeout(t); } catch {}
    }
  }

  function pickSchema(obj) {
    try {
      const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
      if (!obj || typeof obj !== 'object') return {};
      const c = obj.config && isObj(obj.config) ? obj.config : null;
      const cc = c && c.config && isObj(c.config) ? c.config : null;
      return (
        (isObj(obj.inputSchema) ? obj.inputSchema : null) ||
        (isObj(obj.paramSchema) ? obj.paramSchema : null) ||
        (isObj(obj.paramsSchema) ? obj.paramsSchema : null) ||
        (c && isObj(c.inputSchema) ? c.inputSchema : null) ||
        (c && isObj(c.paramSchema) ? c.paramSchema : null) ||
        (c && isObj(c.paramsSchema) ? c.paramsSchema : null) ||
        (cc && isObj(cc.inputSchema) ? cc.inputSchema : null) ||
        (cc && isObj(cc.paramSchema) ? cc.paramSchema : null) ||
        (cc && isObj(cc.paramsSchema) ? cc.paramsSchema : null) ||
        {}
      );
    } catch { return { }; }
  }

  async function findServerByName(nameIn) {
    if (!pool) return null;
    const raw = String(nameIn || '').trim();
    const decoded = (() => { try { return decodeURIComponent(raw); } catch { return raw; } })();
    const looksId = /^m2srv_/.test(decoded);
    const sanitize = (s) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    const candidates = [decoded, sanitize(decoded)];
    try {
      if (looksId) {
        const r = await pool.query(`SELECT id, name, token, stream_url, sse_url FROM mod_mcp2_server WHERE id = $1 LIMIT 1`, [decoded]);
        if (r.rowCount) return r.rows[0];
      }
      // Exact or case-insensitive match on name
      for (const n of candidates) {
        const r1 = await pool.query(`SELECT id, name, token, stream_url, sse_url FROM mod_mcp2_server WHERE name = $1 LIMIT 1`, [n]);
        if (r1.rowCount) return r1.rows[0];
        const r2 = await pool.query(`SELECT id, name, token, stream_url, sse_url FROM mod_mcp2_server WHERE lower(name) = lower($1) LIMIT 1`, [n]);
        if (r2.rowCount) return r2.rows[0];
      }
      // Fallback: match by URL tail
      for (const n of candidates) {
        const r3 = await pool.query(
          `SELECT id, name, token, stream_url, sse_url
             FROM mod_mcp2_server
            WHERE (stream_url ILIKE '%'||$1||'/stream') OR (sse_url ILIKE '%'||$1||'/events')
            ORDER BY updated_at DESC LIMIT 1`, [decoded]
        );
        if (r3.rowCount) return r3.rows[0];
      }
      return null;
    } catch { return null; }
  }

  function pickToken(req) {
    try {
      const h = String((req.headers && (req.headers['authorization'] || req.headers['Authorization'])) || '').trim();
      if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim();
    } catch (e) {}
    try {
      const q = (req.query && req.query.token) ? String(req.query.token).trim() : '';
      if (q) return q;
    } catch (e) {}
    return '';
  }

  // ---- Dynamic tool execution helpers (profile/server-scoped) ----
  function normalizeToolNames(raw) {
    const s = String(raw || '').trim();
    const withDots = s.replace(/_/g, '.');
    const withUnderscores = s.replace(/\./g, '_');
    const set = new Set([s, withDots, withUnderscores]);
    return Array.from(set);
  }
  async function loadServerConfigByNameOrId(nameOrId) {
    if (!pool) return null;
    try {
      const idOrName = String(nameOrId || '').trim();
      let r = await pool.query(`SELECT id, name, type_id, http_base, options FROM mod_mcp2_server WHERE id=$1 OR name=$1 LIMIT 1`, [idOrName]);
      if (!r.rowCount) {
        // Try case-insensitive name match
        r = await pool.query(`SELECT id, name, type_id, http_base, options FROM mod_mcp2_server WHERE lower(name)=lower($1) LIMIT 1`, [idOrName]);
      }
      if (!r.rowCount) return null;
      const row = r.rows[0];
      const options = safeJsonParse(row.options || {}, {});
      let tools = [];
      if (row.type_id) {
        const enabledByToolId = await loadServerToolEnabledMap(row.id);
        const typeTools = await loadTypeToolsByTypeId(row.type_id);
        if (typeTools.length) {
          tools = typeTools
            .map((t) => {
              const tid = String(t?.tool_id || '').trim();
              const enabled = enabledByToolId.has(tid) ? enabledByToolId.get(tid) : (t?.enabled !== false);
              return { ...t, enabled: enabled !== false };
            })
            .filter((t) => t && t.name);
        }
      }
      return { id: row.id, name: row.name, type_id: row.type_id || null, http_base: row.http_base || null, options, tools };
    } catch { return null; }
  }
  async function loadMysqlProfileConnection(options) {
    try {
      const origin = String(options?.origin_module || options?.module || '').trim();
      let pid = options && options.origin_profile_id ? Number(options.origin_profile_id) : 0;
      if (!pool || !pid) return null;

      // Special case: Origin Module = dhl → origin_profile_id points to mod_dhl_profiles.id,
      // which contains mysql_profile_id pointing to mod_db_mysql_profiles.id
      if (origin === 'dhl') {
        try {
          const r0 = await pool.query(`SELECT mysql_profile_id FROM public.mod_dhl_profiles WHERE id=$1 LIMIT 1`, [pid]);
          const inner = r0?.rowCount ? Number(r0.rows[0]?.mysql_profile_id || 0) : 0;
          if (inner) pid = inner;
        } catch {}
      }

      const r = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1 LIMIT 1`, [pid]);
      if (!r.rowCount) return null;
      const row = r.rows[0];
      return { host: row.host, port: Number(row.port||3306), database: row.database, user: row.user, password: row.password||'', ssl: !!row.ssl };
    } catch { return null; }
  }

  async function loadPostgresProfileConnection(options) {
    try {
      const pid = options && options.origin_profile_id ? Number(options.origin_profile_id) : 0;
      if (!pool || !pid) return null;
      const r = await pool.query(`SELECT host, port, database, db_user AS user, db_password AS password, ssl FROM mod_db_postgresql_profiles WHERE id=$1 LIMIT 1`, [pid]);
      if (!r.rowCount) return null;
      const row = r.rows[0];
      return { host: row.host, port: Number(row.port||5432), database: row.database, user: row.user, password: row.password||'', ssl: !!row.ssl };
    } catch { return null; }
  }
  function mapNamedPostgresParams(sql, params) {
    const seen = new Map();
    let index = 1;
    // Replace :name placeholders with $1..$n, but do NOT treat PostgreSQL casts (::text) as placeholders.
    // Example:
    //   :email::text  -> $1::text
    //   id_order::text stays as a cast (no replacement on ::text)
    const replaced = String(sql || '').replace(/(^|[^:]):([A-Za-z_][A-Za-z0-9_]*)/g, (full, prefix, name) => {
      if (!seen.has(name)) {
        seen.set(name, index);
        index += 1;
      }
      return `${prefix}$${seen.get(name)}`;
    });
    const values = [];
    for (const [name, pos] of seen.entries()) {
      values[pos - 1] = params.hasOwnProperty(name) ? params[name] : null;
    }
    return { sql: replaced, values };
  }

  async function executePostgresTool(serverName, serverConfig, tool, args) {
    let params = null;
    let statements = [];
    let client = null;
    try {
      let cfg = (tool && tool.config) || {};
      if (cfg && typeof cfg === 'object' && cfg.config && typeof cfg.config === 'object' && !cfg.sql && (cfg.config.sql || cfg.config.driver)) {
        cfg = cfg.config;
      }
      const c0 = cfg.connection || {};
      const prof = await loadPostgresProfileConnection(serverConfig.options || {});
      const conn = {
        host: String(c0.host || (prof && prof.host) || ''),
        port: Number(c0.port || (prof && prof.port) || 5432),
        database: String(c0.database || (prof && prof.database) || ''),
        user: String(c0.user || (prof && prof.user) || ''),
        password: (c0.password != null ? String(c0.password) : (prof ? String(prof.password||'') : '')),
        ssl: (c0.ssl != null ? !!c0.ssl : (prof ? !!prof.ssl : false)),
      };
      if (!conn.host || !conn.database || !conn.user) return { ok:false, error:'postgres_connection_incomplete' };
      const sqlRaw = cfg.sql;
      statements = Array.isArray(sqlRaw) ? sqlRaw.map((s) => String(s || '').trim()).filter(Boolean) : [String(sqlRaw || '').trim()].filter(Boolean);
      if (!statements.length) return { ok:false, error:'sql_missing' };
      const defaults = (cfg.parameters && typeof cfg.parameters==='object') ? cfg.parameters : {};
      params = (args && typeof args==='object') ? { ...defaults, ...args } : { ...defaults };
      try {
        const ps = (cfg.paramSchema && typeof cfg.paramSchema==='object') ? cfg.paramSchema : {};
        const props = (ps.properties && typeof ps.properties === 'object') ? ps.properties : {};
        for (const [k, spec] of Object.entries(props)) {
          if (params[k] === undefined && spec && Object.prototype.hasOwnProperty.call(spec, 'default')) {
            params[k] = spec.default;
          }
        }
        const coerce = (value, type) => {
          if (value === undefined) return value;
          if (type === 'integer') {
            if (value === null || value === '') return value;
            const num = Number(value);
            return Number.isFinite(num) ? Math.trunc(num) : value;
          }
          if (type === 'number') {
            if (value === null || value === '') return value;
            const num = Number(value);
            return Number.isFinite(num) ? num : value;
          }
          return value;
        };
        for (const [k, spec] of Object.entries(props)) {
          const type = (spec && (spec.type || (Array.isArray(spec.type) ? spec.type[0] : ''))) || '';
          if (type) params[k] = coerce(params[k], type);
        }
      } catch {}
      try {
        for (const [k, defVal] of Object.entries(defaults)) {
          if (defVal !== null) continue;
          const v = params[k];
          if (v === '') params[k] = null;
          else if (Array.isArray(v) && v.length === 0) params[k] = null;
        }
        for (const [k, v] of Object.entries(params)) {
          if (typeof v === 'string' && v === '' && /_id$/i.test(k)) params[k] = null;
        }
      } catch {}
      try { delete params.debug; } catch {}
      try { delete params.prefix; } catch {}
      const { Client } = await import('pg');
      client = new Client({
        host: conn.host,
        port: conn.port,
        database: conn.database,
        user: conn.user,
        password: conn.password,
        ssl: conn.ssl ? { rejectUnauthorized: false } : false,
      });
      await client.connect();
      const steps = [];
      for (let sql of statements) {
        let mapped = mapNamedPostgresParams(sql, params);
        const res = await client.query(mapped.sql, mapped.values || []);
        if (Array.isArray(res.rows)) {
          const cols = res.rows[0] ? Object.keys(res.rows[0]) : [];
          steps.push({ type: 'rows', rowCount: res.rowCount, columns: cols, rows: res.rows });
        } else {
          steps.push({
            type: 'ok',
            affectedRows: Number(res.rowCount || 0) || 0,
            changedRows: Number(res.rowCount || 0) || 0,
            insertId: null,
            warningStatus: null,
          });
        }
      }
      const last = steps.length ? steps[steps.length - 1] : null;
      const baseOut = last && last.type === 'rows' ? last : { type: 'ok', affectedRows: 0, changedRows: 0 };
      return {
        ok: true,
        steps,
        result: baseOut,
      };
    } catch (e) {
      return { ok:false, error: 'postgresql_error', message: String((e && e.message) || e) };
    } finally {
      if (client) {
        try { await client.end(); } catch {}
      }
    }
  }

  async function executeGoogleApiTool(serverName, serverConfig, tool, args) {
    try {
      const cfg = (tool && tool.config) ? tool.config : {};
      const endpoint = String(cfg.endpoint || '').trim();
      if (!endpoint) return { ok:false, error:'missing_endpoint', message:'google-api endpoint not configured' };
      const moduleId = cfg.module || String(serverConfig?.options?.origin_module || '').trim() || '';
      if (!moduleId) return { ok:false, error:'missing_module', message:'Server origin_module must reference the google-api module' };
      const method = String(cfg.method || 'GET').toUpperCase();
      const queryParams = Array.isArray(cfg.query_params) ? cfg.query_params : [];
      const paramsToSend = (args && typeof args === 'object') ? { ...args } : {};
      const query = new URLSearchParams();
      const addQueryValue = (key, value) => {
        if (value == null) return;
        let formatted = value;
        if (Array.isArray(formatted)) formatted = formatted.join(',');
        if (typeof formatted !== 'string') formatted = String(formatted);
        if (formatted) query.set(key, formatted);
      };
      if (queryParams.length) {
        for (const key of queryParams) {
          if (Object.prototype.hasOwnProperty.call(paramsToSend, key)) {
            addQueryValue(key, paramsToSend[key]);
          }
        }
      } else {
        for (const [key, val] of Object.entries(paramsToSend)) {
          addQueryValue(key, val);
        }
      }
      const port = Number(process.env.PORT || 3010);
      const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      const baseUrl = `http://127.0.0.1:${port}`;
      const url = query.toString() ? `${baseUrl}${path}?${query.toString()}` : `${baseUrl}${path}`;
      try {
        const keys = Object.keys(paramsToSend || {});
        chatLog?.('mcp2_google_api_request', {
          server: String(serverConfig?.name || serverName || ''),
          tool: String(tool?.name || ''),
          method,
          endpoint: path,
          query_keys: queryParams.length ? queryParams : keys,
        });
      } catch {}
      const f = (typeof globalThis.fetch === 'function')
        ? globalThis.fetch.bind(globalThis)
        : (await import('node-fetch')).default;
      const headers = { Accept: 'application/json' };
      try {
        const tok = String(process.env.ADMIN_TOKEN || '').trim();
        if (tok) headers['X-Admin-Token'] = tok;
      } catch {}
      let body = null;
      if (method !== 'GET' && method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(paramsToSend);
      }
      const resp = await f(url, { method, headers, body });
      const text = await resp.text().catch(() => '');
      let json = null;
      if (text) {
        try { json = JSON.parse(text); } catch {}
      }
      try {
        chatLog?.('mcp2_google_api_response', {
          server: String(serverConfig?.name || serverName || ''),
          tool: String(tool?.name || ''),
          status: resp.status,
          ok: !!resp.ok,
          bytes: text ? text.length : 0,
          json: json && typeof json === 'object' ? true : false,
        });
      } catch {}
      if (resp.ok) return { ok:true, status: resp.status, json, text };
      return {
        ok:false,
        status: resp.status,
        error: json?.error || `http_${resp.status}`,
        message: json?.message || text,
        text,
      };
    } catch (e) {
      return { ok:false, error:'google_api_error', message: String((e && e.message) || e) };
    }
  }

  async function executeFiledataTool(serverName, serverConfig, tool, args) {
    const cfg = (tool && tool.config && typeof tool.config === 'object') ? tool.config : {};
    const action = String(cfg.action || '').trim().toLowerCase();
    const defaults = (cfg.parameters && typeof cfg.parameters === 'object') ? cfg.parameters : {};
    const params = (args && typeof args === 'object' && !Array.isArray(args)) ? { ...defaults, ...args } : { ...defaults };
    const debug = !!params.debug;
    try { delete params.debug; } catch {}

    const fsMod = await import('fs');
    const pathMod = await import('path');
    const fs = fsMod.default || fsMod;
    const path = pathMod.default || pathMod;
    const uploadDir = path.join(backendDir, 'uploads', 'mcp');
    const appFilesDir = path.join(backendDir, 'app_files');
    try { fs.mkdirSync(uploadDir, { recursive: true }); } catch {}
    try { fs.mkdirSync(appFilesDir, { recursive: true }); } catch {}

    const ensureMcpFilesTable = async () => {
      if (!pool) throw new Error('db_unavailable');
      // Keep it idempotent and portable across environments.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.mcp_files (
          id TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          content_type TEXT,
          size_bytes INTEGER,
          server_name TEXT,
          bot_id TEXT,
          org_id TEXT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      try { await pool.query(`ALTER TABLE public.mcp_files ADD COLUMN IF NOT EXISTS server_name TEXT`); } catch {}
      try { await pool.query(`ALTER TABLE public.mcp_files ADD COLUMN IF NOT EXISTS bot_id TEXT`); } catch {}
      try { await pool.query(`ALTER TABLE public.mcp_files ADD COLUMN IF NOT EXISTS org_id TEXT`); } catch {}
      try { await pool.query(`ALTER TABLE public.mcp_files ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`); } catch {}
      try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp_files_created ON public.mcp_files(created_at DESC)`); } catch {}
      try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp_files_server ON public.mcp_files(server_name)`); } catch {}
      try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp_files_bot ON public.mcp_files(bot_id)`); } catch {}
      try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp_files_org ON public.mcp_files(org_id)`); } catch {}
    };

    const looksTextFile = (name, contentType) => {
      const ct = String(contentType || '').toLowerCase();
      if (ct.startsWith('text/')) return true;
      const fn = String(name || '').toLowerCase();
      return /\.(txt|md|markdown|html?|json|csv|log|xml|yml|yaml)$/i.test(fn);
    };

    const guessMimeType = (fileName) => {
      const fn = String(fileName || '').toLowerCase();
      if (fn.endsWith('.pdf')) return 'application/pdf';
      if (fn.endsWith('.json')) return 'application/json';
      if (fn.endsWith('.csv')) return 'text/csv';
      if (fn.endsWith('.txt')) return 'text/plain';
      if (fn.endsWith('.md')) return 'text/markdown';
      if (fn.endsWith('.html') || fn.endsWith('.htm')) return 'text/html';
      if (fn.endsWith('.xml')) return 'application/xml';
      if (fn.endsWith('.png')) return 'image/png';
      if (fn.endsWith('.jpg') || fn.endsWith('.jpeg')) return 'image/jpeg';
      if (fn.endsWith('.gif')) return 'image/gif';
      if (fn.endsWith('.zip')) return 'application/zip';
      return 'application/octet-stream';
    };

    const readTextPreview = (fullPath, maxBytes) => {
      try {
        const buf = fs.readFileSync(fullPath);
        return buf.slice(0, maxBytes).toString('utf8');
      } catch {
        return '';
      }
    };

    const safeFileName = (raw) => {
      const s = String(raw || '').trim() || 'file.bin';
      const base = s.split(/[\\/]/).pop() || s;
      return base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200) || 'file.bin';
    };

    const getRowById = async (id) => {
      if (!pool) throw new Error('db_unavailable');
      await ensureMcpFilesTable();
      const r = await pool.query(`SELECT * FROM public.mcp_files WHERE id = $1 LIMIT 1`, [String(id)]);
      return r?.rowCount ? r.rows[0] : null;
    };

    const openaiListVectorStoreFiles = async (vectorStoreId, limit = 100) => {
      const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
      if (!apiKey) throw new Error('openai_key_missing');
      const base = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const f = (typeof globalThis.fetch === 'function')
        ? globalThis.fetch.bind(globalThis)
        : (await import('node-fetch')).default;
      const url = `${base}/vector_stores/${encodeURIComponent(vectorStoreId)}/files?limit=${encodeURIComponent(String(limit))}`;
      const r = await f(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } });
      const text = await r.text().catch(() => '');
      let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok) throw new Error(json?.error?.message || json?.message || text || `http_${r.status}`);
      const items = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.items) ? json.items : []);
      return items;
    };
    const openaiGetFileMeta = async (fileId) => {
      const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
      if (!apiKey) throw new Error('openai_key_missing');
      const base = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const f = (typeof globalThis.fetch === 'function')
        ? globalThis.fetch.bind(globalThis)
        : (await import('node-fetch')).default;
      const url = `${base}/files/${encodeURIComponent(fileId)}`;
      const r = await f(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } });
      const text = await r.text().catch(() => '');
      let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok) throw new Error(json?.error?.message || json?.message || text || `http_${r.status}`);
      return json || {};
    };

    if (action === 'list_files') {
      const source = String(params.source || 'all').trim().toLowerCase(); // mcp_files | app_files | all
      if (source !== 'app_files' && !pool) return { ok:false, error:'db_unavailable' };
      await ensureMcpFilesTable();
      const botId = String(params.bot_id || '').trim();
      const limit = Math.max(1, Math.min(200, Number(params.limit || 50)));
      const out = [];

      if (source === 'all' || source === 'mcp_files') {
        const where = [];
        const values = [];
        if (botId) { where.push(`bot_id = $${values.push(botId)}`); }
        values.push(limit);
        const sql = `SELECT id, file_name, file_path, content_type, size_bytes, server_name, bot_id, created_at
                       FROM public.mcp_files
                      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                      ORDER BY created_at DESC NULLS LAST
                      LIMIT $${values.length}`;
        const r = await pool.query(sql, values);
        for (const row of (r.rows || [])) {
          out.push({
            source: 'mcp_files',
            id: row.id,
            file_name: row.file_name,
            content_type: row.content_type || null,
            size_bytes: row.size_bytes || null,
            server_name: row.server_name || null,
            bot_id: row.bot_id || null,
            created_at: row.created_at || null,
          });
        }
        if (debug) out.executed_mcp_files = { sql, values };
      }

      if (source === 'all' || source === 'app_files') {
        try {
          const ents = fs.readdirSync(appFilesDir, { withFileTypes: true });
          for (const ent of ents) {
            if (!ent.isFile()) continue;
            const name = ent.name;
            const full = path.join(appFilesDir, name);
            let st = null; try { st = fs.statSync(full); } catch { continue; }
            out.push({
              source: 'app_files',
              id: `app:${name}`,
              file_name: name,
              content_type: guessMimeType(name),
              size_bytes: st.size,
              server_name: null,
              bot_id: null,
              created_at: st.mtime ? new Date(st.mtime).toISOString() : null,
            });
          }
        } catch {}
      }

      // newest first (best-effort)
      out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return { ok:true, files: out.slice(0, limit) };
    }

    const buildDownloadUrl = (fileId) => `/mcp/file/${encodeURIComponent(fileId)}/download`;

    if (action === 'search_documents') {
      const source = String(params.source || 'all').trim().toLowerCase(); // mcp_files | app_files | vector_store | all
      const vectorStoreId = String(params.vector_store_id || cfg.vector_store_id || serverConfig?.options?.vector_store_id || '').trim();
      if (source !== 'app_files' && source !== 'vector_store' && !pool) return { ok:false, error:'db_unavailable' };
      await ensureMcpFilesTable();
      const query = String(params.query || '').trim();
      if (!query) return { ok:false, error:'bad_request', message:'query required' };
      const limit = Math.max(1, Math.min(50, Number(params.limit || 10)));
      const items = [];

      if (source === 'all' || source === 'mcp_files') {
        const r = await pool.query(
          `SELECT id, file_name, file_path, content_type, size_bytes, server_name, bot_id, created_at
             FROM public.mcp_files
            WHERE file_name ILIKE '%' || $1 || '%'
            ORDER BY created_at DESC NULLS LAST
            LIMIT $2`,
          [query, limit]
        );
        for (const row of (r.rows || [])) {
          const full = path.join(uploadDir, String(row.file_path || ''));
          let text = null;
          if (row.file_path && looksTextFile(row.file_name, row.content_type) && fs.existsSync(full)) {
            const preview = readTextPreview(full, 262144);
            text = preview || null;
          }
          items.push({
            source: 'mcp_files',
            id: row.id,
            file_name: row.file_name,
            content_type: row.content_type || null,
            size_bytes: row.size_bytes || null,
            server_name: row.server_name || null,
            bot_id: row.bot_id || null,
            created_at: row.created_at || null,
            text,
            download_url: buildDownloadUrl(row.id),
          });
        }
      }

      if (source === 'all' || source === 'app_files') {
        try {
          const ents = fs.readdirSync(appFilesDir, { withFileTypes: true });
          for (const ent of ents) {
            if (!ent.isFile()) continue;
            const name = ent.name;
            if (!name.toLowerCase().includes(query.toLowerCase())) continue;
            const full = path.join(appFilesDir, name);
            let st = null; try { st = fs.statSync(full); } catch { continue; }
            const ct = guessMimeType(name);
            const text = looksTextFile(name, ct) ? (readTextPreview(full, 262144) || null) : null;
            items.push({
              source: 'app_files',
              id: `app:${name}`,
              file_name: name,
              content_type: ct,
              size_bytes: st.size,
              server_name: null,
              bot_id: null,
              created_at: st.mtime ? new Date(st.mtime).toISOString() : null,
              text,
              download_url: buildDownloadUrl(`app:${name}`),
            });
          }
        } catch {}
      }

      if ((source === 'all' || source === 'vector_store') && vectorStoreId) {
        try {
          const vsItems = await openaiListVectorStoreFiles(vectorStoreId, 100);
          for (const vf of (vsItems || [])) {
            const fid = String(vf?.file_id || vf?.fileId || vf?.id || '').trim();
            if (!fid) continue;
            const meta = await openaiGetFileMeta(fid).catch(() => null);
            const fname = String(meta?.filename || meta?.file_name || fid).trim();
            if (!fname.toLowerCase().includes(query.toLowerCase())) continue;
            items.push({
              source: 'vector_store',
              id: `openai:${fid}`,
              file_id: fid,
              vector_store_id: vectorStoreId,
              file_name: fname,
              content_type: meta?.purpose ? String(meta.purpose) : null,
              size_bytes: meta?.bytes != null ? Number(meta.bytes) : null,
              created_at: meta?.created_at ? new Date(Number(meta.created_at) * 1000).toISOString() : null,
              text: null,
            });
          }
        } catch (e) {
          items.push({ source: 'vector_store', error: 'openai_error', message: String(e?.message || e) });
        }
      }

      items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return { ok:true, items: items.slice(0, limit), hint: vectorStoreId ? { vector_store_id: vectorStoreId } : undefined };
    }

    if (action === 'download_file') {
      const id = String(params.id || '').trim();
      if (!id) return { ok:false, error:'bad_request', message:'id required' };
      const downloadUrl = `/mcp/file/${encodeURIComponent(id)}/download`;
      if (id.startsWith('app:')) {
        const name = id.slice(4);
        const full = path.join(appFilesDir, name);
        if (!fs.existsSync(full)) return { ok:false, error:'not_found' };
        return { ok:true, id, download_url: downloadUrl, preview: { source:'app_files', file_name: name } };
      }
      const row = await getRowById(id);
      if (!row) return { ok:false, error:'not_found' };
      const full = path.join(uploadDir, String(row.file_path || ''));
      if (!fs.existsSync(full)) return { ok:false, error:'file_missing' };
      return {
        ok:true,
        id,
        download_url: downloadUrl,
        preview: {
          source: 'mcp_files',
          file_name: row.file_name,
          size_bytes: row.size_bytes || null,
          content_type: row.content_type || null,
        }
      };
    }

    if (action === 'fetch_document') {
      const id = String(params.id || '').trim();
      if (!id) return { ok:false, error:'bad_request', message:'id required' };
      if (id.startsWith('app:')) {
        const name = id.slice(4);
        const full = path.join(appFilesDir, name);
        if (!fs.existsSync(full)) return { ok:false, error:'not_found' };
        const ct = guessMimeType(name);
        const text = looksTextFile(name, ct) ? (readTextPreview(full, 262144) || null) : null;
        let st = null; try { st = fs.statSync(full); } catch {}
        return {
          ok: true,
          source: 'app_files',
          id,
          title: name,
          content_type: ct,
          text,
          size_bytes: st?.size != null ? st.size : null,
        };
      }
      const row = await getRowById(id);
      if (!row) return { ok:false, error:'not_found' };
      const full = path.join(uploadDir, String(row.file_path || ''));
      const isText = looksTextFile(row.file_name, row.content_type);
      const text = (isText && row.file_path && fs.existsSync(full)) ? (readTextPreview(full, 262144) || null) : null;
      return {
        ok: true,
        source: 'mcp_files',
        id: row.id,
        title: row.file_name,
        content_type: row.content_type || null,
        text,
        size_bytes: row.size_bytes || null,
        bot_id: row.bot_id || null,
        created_at: row.created_at || null,
      };
    }

    if (action === 'upload_file') {
      if (!pool) return { ok:false, error:'db_unavailable' };
      await ensureMcpFilesTable();
      const filename = safeFileName(params.filename);
      const b64 = String(params.content_base64 || '').trim();
      if (!b64) return { ok:false, error:'bad_request', message:'content_base64 required' };
      const contentType = String(params.content_type || 'application/octet-stream');
      const botId = (params.bot_id != null && String(params.bot_id).trim()) ? String(params.bot_id).trim() : null;
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const rel = `${id}-${filename}`;
      const full = path.join(uploadDir, rel);
      const buf = Buffer.from(b64, 'base64');
      fs.writeFileSync(full, buf);
      const serverName = String(serverConfig?.name || serverName || '').trim() || null;
      await pool.query(
        `INSERT INTO public.mcp_files (id, file_name, file_path, content_type, size_bytes, server_name, bot_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [id, filename, rel, contentType, buf.length, serverName, botId]
      );
      return { ok:true, id, file_name: filename, size_bytes: buf.length, content_type: contentType };
    }

    if (action === 'openai_upload_file') {
      const vectorStoreId = String(params.vector_store_id || '').trim();
      const purpose = String(params.purpose || 'assistants').trim() || 'assistants';
      let filename = safeFileName(params.filename || 'upload.bin');
      let buf = null;

      const fileId = String(params.file_id || '').trim();
      if (fileId) {
        await ensureMcpFilesTable();
        const row = await getRowById(fileId);
        if (!row) return { ok:false, error:'not_found' };
        filename = safeFileName(filename || row.file_name || 'upload.bin');
        const full = path.join(uploadDir, String(row.file_path || ''));
        if (!fs.existsSync(full)) return { ok:false, error:'file_missing' };
        buf = fs.readFileSync(full);
      } else {
        const b64 = String(params.content_base64 || '').trim();
        if (!b64) return { ok:false, error:'bad_request', message:'content_base64 or file_id required' };
        buf = Buffer.from(b64, 'base64');
      }

      const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
      if (!apiKey) return { ok:false, error:'openai_key_missing' };

      const f = (typeof globalThis.fetch === 'function')
        ? globalThis.fetch.bind(globalThis)
        : (await import('node-fetch')).default;

      const base = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const filesUrl = `${base}/files`;

      const form = new FormData();
      form.append('purpose', purpose);
      form.append('file', new Blob([buf], { type: 'application/octet-stream' }), filename);

      const r1 = await f(filesUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
      const t1 = await r1.text().catch(() => '');
      let j1 = null; try { j1 = t1 ? JSON.parse(t1) : null; } catch {}
      if (!r1.ok) return { ok:false, error:'openai_error', status: r1.status, message: j1?.error?.message || j1?.message || t1 };
      const openaiFileId = j1?.id || j1?.file?.id || null;
      if (!openaiFileId) return { ok:false, error:'openai_no_file_id' };

      let linked = false;
      if (vectorStoreId) {
        const vsUrl = `${base}/vector_stores/${encodeURIComponent(vectorStoreId)}/files`;
        const r2 = await f(vsUrl, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: openaiFileId }) });
        const t2 = await r2.text().catch(() => '');
        if (!r2.ok) return { ok:false, error:'openai_vector_store_error', status: r2.status, message: t2 };
        linked = true;
      }

      return { ok:true, openai_file_id: openaiFileId, vector_store_id: vectorStoreId || null, linked };
    }

    if (action === 'list_of_instructions') {
      const base = String(params.base_url || '').trim().replace(/\/$/, '');
      const name = String(params.name || '').trim();
      const key = String(params.key || '').trim();
      if (!/^https?:\/\//i.test(base)) return { ok:false, error:'invalid_base_url' };
      if (!name || !key) return { ok:false, error:'name_and_key_required' };
      const timeoutMs = Math.max(100, Math.min(60000, Number(params.timeout_ms || 10000)));
      const url = `${base}/module/livechat/api?action=custom&name=${encodeURIComponent(name)}&key=${encodeURIComponent(key)}`;
      const ac = new AbortController();
      const timer = setTimeout(() => { try { ac.abort(); } catch {} }, timeoutMs);
      try {
        const f = (typeof globalThis.fetch === 'function')
          ? globalThis.fetch.bind(globalThis)
          : (await import('node-fetch')).default;
        const r = await f(url, { method: 'GET', signal: ac.signal });
        const text = await r.text().catch(() => '');
        let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
        const body = json ?? text;
        let instructions = [];
        try {
          const rows = (body && body.rows) || [];
          const filterNa = params.filter_na !== false;
          instructions = (rows || [])
            .map((x) => String(x?.Id_instruction || '').trim())
            .filter((s) => s)
            .filter((s) => (filterNa ? s.toLowerCase() !== 'na' : true));
          if (params.unique !== false) instructions = Array.from(new Set(instructions));
          if (params.sort !== false) instructions.sort((a, b) => a.localeCompare(b));
        } catch {}
        return { ok: !!(body && body.ok), status: r.status, name, url, count: instructions.length, instructions };
      } finally {
        try { clearTimeout(timer); } catch {}
      }
    }

    return { ok:false, error:'unknown_action', message:`Unknown filedata action: ${action}` };
  }

  async function executeMysqlTool(serverName, serverConfig, tool, args) {
    try {
      let cfg = (tool && tool.config) || {};
      // Repair nested config nesting like { config: { ... } }
      if (cfg && typeof cfg === 'object' && cfg.config && typeof cfg.config === 'object' && !cfg.sql && (cfg.config.sql || cfg.config.driver)) {
        cfg = cfg.config;
      }
      const c0 = cfg.connection || {};
      const prof = await loadMysqlProfileConnection(serverConfig.options || {});
      const conn = {
        host: String(c0.host || (prof && prof.host) || ''),
        port: Number(c0.port || (prof && prof.port) || 3306),
        database: String(c0.database || (prof && prof.database) || ''),
        user: String(c0.user || (prof && prof.user) || ''),
        password: (c0.password != null ? String(c0.password) : (prof ? String(prof.password||'') : '')),
        ssl: (c0.ssl != null ? !!c0.ssl : (prof ? !!prof.ssl : false)),
      };
      if (!conn.host || !conn.database || !conn.user) return { ok:false, error:'mysql_connection_incomplete' };
      const sqlRaw = cfg.sql;
      const statements = Array.isArray(sqlRaw) ? sqlRaw.map((s) => String(s || '').trim()).filter(Boolean) : [String(sqlRaw || '').trim()].filter(Boolean);
      if (!statements.length) return { ok:false, error:'sql_missing' };
      const defaults = (cfg.parameters && typeof cfg.parameters==='object') ? cfg.parameters : {};
      // Merge provided args over static defaults; then apply paramSchema defaults and light type coercion
      let params = (args && typeof args==='object') ? { ...defaults, ...args } : { ...defaults };
      // Compatibility mappings for older schemas/tool names.
      try {
        if (params && params.state_id === undefined && params.status !== undefined) {
          params.state_id = Array.isArray(params.status) ? params.status[0] : params.status;
        }
        if (params && params.id_lang === undefined && params.lang_id !== undefined) params.id_lang = params.lang_id;
      } catch {}
      try {
        const ps = (cfg && cfg.paramSchema && typeof cfg.paramSchema==='object') ? cfg.paramSchema : {};
        const props = (ps && ps.properties && typeof ps.properties==='object') ? ps.properties : {};
        // Apply defaults from paramSchema when a key is missing or strictly undefined
        for (const [k, spec] of Object.entries(props)) {
          if (params[k] === undefined && spec && Object.prototype.hasOwnProperty.call(spec, 'default')) {
            params[k] = spec.default;
          }
        }
        // Basic type coercion: integers and numbers
        const coerce = (v, t) => {
          if (v === undefined) return v;
          if (t === 'integer') {
            if (v === null || v === '') return v;
            const n = Number(v);
            return Number.isFinite(n) ? Math.trunc(n) : v;
          }
          if (t === 'number') {
            if (v === null || v === '') return v;
            const n = Number(v);
            return Number.isFinite(n) ? n : v;
          }
          return v;
        };
        for (const [k, spec] of Object.entries(props)) {
          const t = (spec && (spec.type || (Array.isArray(spec.type) ? spec.type[0] : ''))) || '';
          if (t) params[k] = coerce(params[k], t);
        }
      } catch {}
      // Normalize common "empty" values coming from UIs:
      // - empty string should behave like NULL for optional filters (when the tool default is NULL)
      // - empty arrays should behave like NULL for optional filters (when the tool default is NULL)
      try {
        for (const [k, defVal] of Object.entries(defaults)) {
          if (defVal !== null) continue;
          const v = params[k];
          if (v === '') params[k] = null;
          else if (Array.isArray(v) && v.length === 0) params[k] = null;
        }
        // Additional safety: treat empty string as null for *_id filters
        for (const [k, v] of Object.entries(params)) {
          if (typeof v === 'string' && v === '' && /_id$/i.test(k)) params[k] = null;
        }
      } catch {}
      // Convenience: compute pagination offset for MySQL tools.
      // MariaDB/MySQL prepared statements often reject arithmetic around parameter markers in LIMIT/OFFSET,
      // so tools should use `OFFSET :offset` and provide `page` + `page_size`; we compute `offset` if missing.
      try {
        if (params && params.offset === undefined && params.page !== undefined && params.page_size !== undefined) {
          const page = Number(params.page);
          const pageSize = Number(params.page_size);
          if (Number.isFinite(page) && Number.isFinite(pageSize)) {
            const p = Math.max(1, Math.trunc(page));
            const s = Math.max(1, Math.trunc(pageSize));
            params.page = p;
            params.page_size = s;
            params.offset = (p - 1) * s;
          }
        }
      } catch {}
      // Remove any undefined values (mysql2 rejects undefined bindings)
      try { for (const key of Object.keys(params)) { if (params[key] === undefined) delete params[key]; } } catch {}
      // Support a safe {{prefix}} placeholder for table names
      let usedPrefix = null;
      try {
        if (statements.some((s) => s.includes('{{prefix}}'))) {
          const rawPrefix = (params && params.prefix != null) ? String(params.prefix) : (cfg && cfg.prefix != null ? String(cfg.prefix) : 'ps_');
          const cleaned = rawPrefix.replace(/[^A-Za-z0-9_]/g, '');
          const safe = cleaned ? (cleaned.endsWith('_') ? cleaned : `${cleaned}_`) : 'ps_';
          for (let i = 0; i < statements.length; i += 1) {
            if (statements[i].includes('{{prefix}}')) statements[i] = statements[i].split('{{prefix}}').join(safe);
          }
          usedPrefix = safe;
          // prefix is not a SQL placeholder; remove it from bindings
          try { delete params.prefix; } catch {}
        }
      } catch {}
      // Remove debug from bindings (not a SQL placeholder)
      const debug = !!params.debug;
      try { delete params.debug; } catch {}
      // Use mysql2/promise with named placeholders; robust resolution across repo layout
      let mysql = null;
      try {
        const mod = await import('../../../db-mysql/backend/utils/mysql2.js');
        const getMysql2 = (mod && (mod.getMysql2 || (mod.default && mod.default.getMysql2))) || null;
        if (typeof getMysql2 === 'function') {
          const m = await getMysql2(ctx);
          if (m) mysql = m;
        }
      } catch {}
      if (!mysql) {
        // 1) Try regular node resolution
        try {
          const direct = await import('mysql2/promise');
          mysql = direct && (direct.default || direct);
        } catch {}
      }
      if (!mysql) {
        // 2) Try absolute file paths under backend/node_modules and other candidates
        try {
          const path = (await import('path')).default;
          const { pathToFileURL } = await import('url');
          const fs = (await import('fs')).default;
          const cands = [];
          try { if (ctx && ctx.backendDir) cands.push(path.join(ctx.backendDir, 'node_modules', 'mysql2', 'promise.js')); } catch {}
          try { cands.push(path.join(process.cwd(), 'node_modules', 'mysql2', 'promise.js')); } catch {}
          try {
            const here = path.dirname(new URL(import.meta.url).pathname);
            cands.push(path.resolve(here, '../../../../backend/node_modules/mysql2/promise.js'));
            cands.push(path.resolve(here, '../../../node_modules/mysql2/promise.js'));
            cands.push(path.resolve(here, '../../node_modules/mysql2/promise.js'));
          } catch {}
          for (const p of cands) {
            try {
              if (p && fs.existsSync(p)) {
                const mod = await import(pathToFileURL(p).href);
                mysql = mod && (mod.default || mod);
                if (mysql) break;
              }
            } catch {}
          }
        } catch {}
      }
      if (!mysql) return { ok:false, error:'mysql2_missing' };
      const connOpts = { host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: conn.database, namedPlaceholders: true };
      if (conn.ssl) connOpts.ssl = { rejectUnauthorized: false };
      const db = await mysql.createConnection(connOpts);
      try {
        const steps = [];
        for (const sql of statements) {
          const [rows] = await db.execute(sql, params);
          if (Array.isArray(rows)) {
            const cols = rows[0] ? Object.keys(rows[0]) : [];
            steps.push({ type: 'rows', rowCount: rows.length, columns: cols, rows });
          } else {
            const okPacket = rows && typeof rows === 'object' ? rows : {};
            steps.push({
              type: 'ok',
              affectedRows: Number(okPacket.affectedRows || 0) || 0,
              changedRows: Number(okPacket.changedRows || 0) || 0,
              insertId: okPacket.insertId != null ? okPacket.insertId : null,
              warningStatus: okPacket.warningStatus != null ? okPacket.warningStatus : null,
            });
          }
        }
        const last = steps.length ? steps[steps.length - 1] : null;
        const baseOut = last && last.type === 'rows'
          ? { ok:true, rowCount: last.rowCount, columns: last.columns, rows: last.rows, steps: steps.length > 1 ? steps : undefined }
          : { ok:true, steps };
        if (debug) {
          return { ...baseOut, executed: { statements, params, prefix: usedPrefix } };
        }
        return baseOut;
      } finally {
        try { await db.end(); } catch {}
      }
    } catch (e) {
      return { ok:false, error: String(e?.message || e) };
    }
  }

  // SSE endpoint
  app.get('/mcp2/:name/events', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      const server = await findServerByName(name);
      if (!server) return res.status(404).json({ ok:false, error:'not_found' });
      const t = pickToken(req);
      if (String(server.token || '') && t !== String(server.token)) {
        return res.status(401).json({ ok:false, error:'unauthorized' });
      }
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch (e) {}

      const send = (event, data) => {
        if (event) res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      send('hello', { ok:true, name, transport:'sse', ts: Date.now() });
      const iv = setInterval(() => send('ping', { ts: Date.now() }), 10000);
      req.on('close', () => { clearInterval(iv); try { res.end(); } catch {} });
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); } catch {}
    }
  });

  // Streamable-HTTP style: send newline-delimited JSON chunks and keep connection open
  app.get('/mcp2/:name/stream', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      const server = await findServerByName(name);
      if (!server) return res.status(404).json({ ok:false, error:'not_found' });
      const t = pickToken(req);
      if (String(server.token || '') && t !== String(server.token)) {
        return res.status(401).json({ ok:false, error:'unauthorized' });
      }
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch (e) {}
      const write = (obj) => { try { res.write(JSON.stringify(obj) + "\n"); } catch {} };
      // Register session
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      const byName = sessions.get(server.name) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(server.name, byName);

      // Minimal MCP-like hello and tools list
      write({ type: 'server_hello', protocol: 'mcp-stream/0.1', sessionId, caps: { tools: true } });
      try {
        const items = await listToolsForServer(name);
        write({ type: 'tools', items: dedupeTools(items) });
      } catch { write({ type: 'tools', items: [] }); }

      const iv = setInterval(function(){ write({ type:'ping', ts: Date.now(), sessionId: sessionId }); }, 10000);
      req.on('close', () => {
        clearInterval(iv);
        try { res.end(); } catch {}
        try { const map = sessions.get(server.name); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(server.name); } } catch {}
      });
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); } catch {}
    }
  });

  // API-scoped aliases implement the same logic inline (no app._router recursion)
  app.get('/api/mcp2/transport/:name/events', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      const server = await findServerByName(name);
      if (!server) return res.status(404).json({ ok:false, error:'not_found' });
      const t = pickToken(req);
      if (String(server.token || '') && t !== String(server.token)) return res.status(401).json({ ok:false, error:'unauthorized' });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch (e) {}
      const send = function(event, data) { if (event) res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); };
      send('hello', { ok:true, name, transport:'sse', ts: Date.now() });
      const iv = setInterval(function(){ send('ping', { ts: Date.now() }); }, 10000);
      req.on('close', function(){ clearInterval(iv); try { res.end(); } catch (e) {} });
    } catch (e) { try { res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); } catch (e2) {} }
  });
  app.get('/api/mcp2/transport/:name/stream', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      const server = await findServerByName(name);
      if (!server) return res.status(404).json({ ok:false, error:'not_found' });
      const t = pickToken(req);
      if (String(server.token || '') && t !== String(server.token)) return res.status(401).json({ ok:false, error:'unauthorized' });
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch (e) {}
      const write = function(obj){ try { res.write(JSON.stringify(obj) + "\n"); } catch (e) {} };
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      const byName = sessions.get(server.name) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(server.name, byName);
      write({ type: 'server_hello', protocol: 'mcp-stream/0.1', sessionId, caps: { tools: true } });
      try {
        const items = await listToolsForServer(name);
        write({ type: 'tools', items: dedupeTools(items) });
      } catch {
        write({ type: 'tools', items: [] });
      }
      const iv = setInterval(function(){ write({ type:'ping', ts: Date.now(), sessionId: sessionId }); }, 10000);
      req.on('close', function(){ clearInterval(iv); try { res.end(); } catch (e) {} try { const map = sessions.get(server.name); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(server.name); } } catch (e) {} });
    } catch (e) { try { res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); } catch (e2) {} }
  });

  // ================= Streamable HTTP (SSE + JSON-RPC) =================
  // Inspector/OpenAI-friendly endpoints under /api/mcp2/stream/:name
  app.get('/api/mcp2/stream/:name', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      // Optional: check token only if a server with a token is configured
      let server = null;
      try { server = await findServerByName(name); } catch {}
      const t = pickToken(req);
      if (server && String(server.token || '')) {
        if (t !== String(server.token)) return res.status(401).json({ ok:false, error:'unauthorized' });
      }

      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
      // MCP Inspector (SSEClientTransport) expects an `endpoint` event with the POST URL.
      try {
        // Match the current path (events handler -> events)
        const endpointPath = `/api/mcp2/${encodeURIComponent(name)}/events`;
        res.write(`event: endpoint\n`);
        const abs = toAbsoluteUrl(req, endpointPath);
        const payload = withTokenQuery(req, abs || endpointPath);
        res.write(`data: ${payload}\n\n`);
      } catch {}
      pushRecentRpc(name, { ts: Date.now(), id: null, method: 'sse_connect', params: { path: req.path, token: req.query?.token ? '***' : undefined } });

      const byName = sessions.get(name) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(name, byName);

      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => {
        clearInterval(iv);
        try { res.end(); } catch {}
        try { const map = sessions.get(name); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(name); } } catch {}
      });
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); } catch {}
    }
  });

  app.post('/api/mcp2/stream/:name', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      // Optional: check token only if a server with a token is configured
      let server = null;
      try { server = await findServerByName(name); } catch {}
      const t = pickToken(req);
      if (server && String(server.token || '')) {
        if (t !== String(server.token)) return res.status(401).json({ jsonrpc:'2.0', id:null, error: { code: -32001, message: 'unauthorized' } });
      }

      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!(body && typeof body === 'object' && body.jsonrpc === '2.0')) {
        return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      }

      const id = body.id ?? null;
      const method = String(body.method || '').trim();
      const params = body.params || {};

      let result;
      if (method === 'initialize') {
        result = {
          protocolVersion: '2025-06-18',
          serverInfo: { name: `mcp2:${name}`, version: '1.0.0' },
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: false, listChanged: false },
            resourceTemplates: { listChanged: false },
            prompts: { listChanged: false },
            logging: {}
          },
        };
        // Echo session id header for clients that expect it
        try { const sid = Math.random().toString(16).slice(2) + Date.now().toString(36); res.setHeader('mcp-session-id', sid); } catch {}
      } else if (method === 'tools/list') {
        try {
          const tools = await listToolsForServer(name);
          result = { tools: dedupeTools(tools) };
        } catch { result = { tools: [] }; }
      } else if (method === 'resources/list') {
        // Optional MCP resources API — return empty list instead of 400
        result = { resources: [] };
      } else if (method === 'resources/templates/list' || method === 'resourceTemplates/list') {
        // Support both spellings seen in clients/specs
        result = { resourceTemplates: [] };
      } else if (method === 'prompts/list') {
        result = { prompts: [] };
      } else if (method === 'tools/call') {
        const tool = String(params?.name || '').trim();
        const args = params?.arguments || params || {};
        if (tool === 'ping') result = { ok: true };
        else if (tool === 'time.now' || tool === 'time_now') result = { now: new Date().toISOString() };
        else if (tool === 'db.query' || tool === 'db_query') {
          try {
            if (!pool || typeof pool.query !== 'function') result = { ok:false, error:'db_unavailable' };
            else {
              const sql = String(args.sql || '').trim();
              if (!/^\s*select\b/i.test(sql)) result = { ok:false, error:'only_select_allowed' };
              else {
                const r = await pool.query(sql);
                const rows = (r && Array.isArray(r.rows)) ? r.rows.slice(0, 100) : [];
                const cols = rows[0] ? Object.keys(rows[0]) : [];
                const rc = (r && typeof r.rowCount === 'number') ? r.rowCount : rows.length;
                result = { ok:true, rowCount: rc, columns: cols, rows: rows };
              }
            }
          } catch (e) { result = { ok:false, error: String((e && e.message) || e) }; }
        } else {
          try {
            result = await callToolForServer(name, tool, args);
          } catch (e) { result = { ok:false, error: String((e && e.message) || e) }; }
        }
      } else {
        return res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
      }

      const response = { jsonrpc: '2.0', id, result };
      // Fan out JSON-RPC response to any SSE subscribers for this name
      try {
        const map = sessions.get(name);
        if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(response)}\n\n`); } catch {} }
      } catch {}
      // Send initialized notification for clients expecting it
      if (method === 'initialize') {
        try {
          const notif = { jsonrpc: '2.0', method: 'initialized', params: {} };
          const map = sessions.get(name);
          if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(notif)}\n\n`); } catch {} }
        } catch {}
      }

      return res.json(response);
    } catch (e) {
      return res.status(500).json({ jsonrpc:'2.0', id: null, error: { code: -32000, message: 'server_error', data: String(e?.message || e) } });
    }
  });

  // Unified single-path endpoint (/api/mcp2/:name) that supports
  // GET (SSE) and POST (JSON-RPC) on the same URL for modern MCP clients.
  // This mirrors the behavior of /api/mcp2/stream/:name for compatibility.
  app.get('/api/mcp2/:name', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      // Optional: check token only if a server with a token is configured
      let server = null;
      try { server = await findServerByName(name); } catch {}
      const t = pickToken(req);
      if (server && String(server.token || '')) {
        if (t !== String(server.token)) return res.status(401).json({ ok:false, error:'unauthorized' });
      }

      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}

      const byName = sessions.get(name) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(name, byName);

      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => {
        clearInterval(iv);
        try { res.end(); } catch {}
        try { const map = sessions.get(name); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(name); } } catch {}
      });
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); } catch {}
    }
  });

  app.post('/api/mcp2/:name', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      // Optional: check token only if a server with a token is configured
      let server = null; try { server = await findServerByName(name); } catch {}
      const t = pickToken(req);
      if (server && String(server.token || '')) {
        if (t !== String(server.token)) {
          return res.status(401).json({ jsonrpc:'2.0', id:null, error: { code: -32001, message: 'unauthorized' } });
        }
      }

      const rawBody = req.body === undefined ? {} : req.body;
      const handleOne = async (b) => {
        if (!(b && typeof b === 'object' && b.jsonrpc === '2.0')) {
          return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
        }
        const id = b.id ?? null;
        const method = String(b.method || '').trim();
        const params = b.params || {};
        let result;
        if (method === 'initialize') {
          result = {
            protocolVersion: '2025-06-18',
            serverInfo: { name: `mcp2:${name}`, version: '1.0.0' },
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: false, listChanged: false },
              resourceTemplates: { listChanged: false },
              prompts: { listChanged: false },
              logging: {}
            },
          };
          try { const sid = Math.random().toString(16).slice(2) + Date.now().toString(36); res.setHeader('mcp-session-id', sid); } catch {}
        } else if (method === 'tools/list') {
          try {
            const tools = await listToolsForServer(name);
            result = { tools: dedupeTools(tools) };
          } catch { result = { tools: [] }; }
        } else if (method === 'resources/list') {
          try {
            const resources = await (async () => {
              const server = await findServerByName(name);
              if (!server) return [];
              const opt = safeJsonParse(server.options || {}, {});
              const map = (opt && typeof opt.resources_enabled==='object') ? opt.resources_enabled : {};
              // Prefer server-scoped stored config
              try {
                if (ctx && ctx.pool) {
                  const r0 = await ctx.pool.query(`SELECT resources FROM mod_mcp2_server WHERE id=$1 OR name=$2 LIMIT 1`, [server.id || '', server.name || '']);
                  if (r0 && r0.rowCount && Array.isArray(r0.rows[0].resources) && r0.rows[0].resources.length) {
                    const list = r0.rows[0].resources;
                    return list.filter(x => (x?.enabled !== false) && (map[String(x?.uri)] !== false)).map(x => ({ uri: String(x?.uri||'').trim(), name: String(x?.name||''), description: String(x?.description||''), ...(x?.mimeType? { mimeType: String(x.mimeType) } : {}) })).filter(x=>x.uri);
                  }
                }
              } catch {}
              const origin = String(opt.origin_module || '').trim();
              const pid = opt.origin_profile_id || null;
              if (!origin || !pid) return [];
              const port = Number(process.env.PORT || 3010);
              const base = `http://127.0.0.1:${port}`;
              const headers = { 'Content-Type': 'application/json' };
              try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
              const r2 = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resources`, { headers });
              const j2 = await r2.json().catch(()=>({}));
              const list = (r2.ok && Array.isArray(j2?.items)) ? j2.items : [];
              return list.filter(x => map[String(x.uri)] !== false).map(x => ({ uri: x.uri, name: x.name||'', description: x.description||'', ...(x.mimeType? { mimeType: x.mimeType } : {}) }));
            })();
            result = { resources };
          } catch { result = { resources: [] }; }
        } else if (method === 'resources/templates/list' || method === 'resourceTemplates/list') {
          try {
            const resourceTemplates = await (async () => {
              const server = await findServerByName(name);
              if (!server) return [];
              const opt = safeJsonParse(server.options || {}, {});
              const map = (opt && typeof opt.resource_templates_enabled==='object') ? opt.resource_templates_enabled : {};
              try {
                if (ctx && ctx.pool) {
                  const r0 = await ctx.pool.query(`SELECT resource_templates FROM mod_mcp2_server WHERE id=$1 OR name=$2 LIMIT 1`, [server.id || '', server.name || '']);
                  if (r0 && r0.rowCount && Array.isArray(r0.rows[0].resource_templates) && r0.rows[0].resource_templates.length) {
                    const list = r0.rows[0].resource_templates;
                    return list.filter(x => (x?.enabled !== false) && (map[String(x?.name)] !== false)).map(x => {
                      const props = (x?.inputSchema && typeof x.inputSchema==='object' && x.inputSchema.properties && typeof x.inputSchema.properties==='object') ? Object.keys(x.inputSchema.properties) : [];
                      const qs = props.length ? ('?' + props.map(k => `${encodeURIComponent(k)}={${k}}`).join('&')) : '';
                      const uriTemplate = x?.uriTemplate && typeof x.uriTemplate==='string' ? x.uriTemplate : `server:${server.name}:${x?.name||''}${qs}`;
                      return { name: String(x?.name||'').trim(), description: String(x?.description||''), inputSchema: (x?.inputSchema && typeof x.inputSchema==='object') ? x.inputSchema : {}, uriTemplate };
                    }).filter(x=>x.name);
                  }
                }
              } catch {}
              const origin = String(opt.origin_module || '').trim();
              const pid = opt.origin_profile_id || null;
              if (!origin || !pid) return [];
              const port = Number(process.env.PORT || 3010);
              const base = `http://127.0.0.1:${port}`;
              const headers = { 'Content-Type': 'application/json' };
              try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
              const r2 = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resource-templates`, { headers });
              const j2 = await r2.json().catch(()=>({}));
              const list = (r2.ok && Array.isArray(j2?.items)) ? j2.items : [];
              return list.filter(x => map[String(x.name)] !== false).map(x => {
                const props = (x && x.inputSchema && typeof x.inputSchema==='object' && x.inputSchema.properties && typeof x.inputSchema.properties==='object') ? Object.keys(x.inputSchema.properties) : [];
                const qs = props.length ? ('?' + props.map(k => `${encodeURIComponent(k)}={${k}}`).join('&')) : '';
                const uriTemplate = `profile:${origin}:${pid}:${x.name}${qs}`;
                return { name: x.name, description: x.description||'', inputSchema: (x.inputSchema && typeof x.inputSchema==='object') ? x.inputSchema : {}, uriTemplate };
              });
            })();
            result = { resourceTemplates };
          } catch { result = { resourceTemplates: [] }; }
        } else if (method === 'prompts/list') {
          result = { prompts: [] };
        } else if (method === 'tools/call') {
          const tool = String(params?.name || '').trim();
          const args = params?.arguments || params || {};
          if (tool === 'ping') result = { ok: true };
          else if (tool === 'time.now' || tool === 'time_now') result = { now: new Date().toISOString() };
          else if (tool === 'db.query' || tool === 'db_query') {
            try {
              if (!pool || typeof pool.query !== 'function') result = { ok:false, error:'db_unavailable' };
              else {
                const sql = String(args.sql || '').trim();
                if (!/^\s*select\b/i.test(sql)) result = { ok:false, error:'only_select_allowed' };
                else {
                  const r = await pool.query(sql);
                  const rows = (r && Array.isArray(r.rows)) ? r.rows.slice(0, 100) : [];
                  const cols = rows[0] ? Object.keys(rows[0]) : [];
                  const rc = (r && typeof r.rowCount === 'number') ? r.rowCount : rows.length;
                  result = { ok:true, rowCount: rc, columns: cols, rows: rows };
                }
              }
            } catch (e) { result = { ok:false, error: String((e && e.message) || e) }; }
          } else {
            // Dynamic dispatch for stream variant
            try {
              const srv = await loadServerConfigByNameOrId(name);
              if (srv && Array.isArray(srv.tools) && srv.tools.length) {
                const cands = normalizeToolNames(tool);
                const found = srv.tools.find(t => cands.includes(String(t?.name || '').trim()));
                if (found && found.enabled === false) {
                  result = { ok:false, error:'tool_disabled' };
                } else if (found) {
                  const resolved = await resolveExecutableTool(srv, found, tool);
                  if (resolved?.driver === 'mysql') result = await executeMysqlTool(name, srv, resolved.tool, params || {});
                  else if (resolved?.driver === 'postgresql') result = await executePostgresTool(name, srv, resolved.tool, params || {});
                  else if (resolved?.driver === 'google-api') result = await executeGoogleApiTool(name, srv, resolved.tool, params || {});
                  else if (resolved?.driver === 'filedata') result = await executeFiledataTool(name, srv, resolved.tool, params || {});
                  else {
                    try {
                      chatLog?.('mcp2_tool_driver_missing', {
                        server: String(srv?.name || name || ''),
                        tool: String(found?.name || tool || ''),
                        tool_id: found?.tool_id || null,
                        config_keys: Object.keys((found && found.config && typeof found.config === 'object') ? found.config : {}),
                      });
                    } catch {}
                    result = { ok:false, error:'unsupported_tool_driver', message:'Tool has no executable config. Add mysql, postgresql, google-api, or filedata driver to mod_mcp2_tool.code.' };
                  }
                } else return { jsonrpc:'2.0', id, error: { code: -32601, message: 'Method not found' } };
              } else return { jsonrpc:'2.0', id, error: { code: -32601, message: 'Method not found' } };
            } catch (e) { result = { ok:false, error: String((e && e.message) || e) }; }
          }
        } else {
          return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
        }
        const response = { jsonrpc: '2.0', id, result };
        try {
          const map = sessions.get(name);
          if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(response)}\n\n`); } catch {} }
        } catch {}
        if (method === 'initialize') {
          try {
            const notif = { jsonrpc: '2.0', method: 'initialized', params: {} };
            const map = sessions.get(name);
            if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(notif)}\n\n`); } catch {} }
          } catch {}
        }
        return response;
      };
      if (Array.isArray(rawBody)) {
        const out = [];
        for (const item of rawBody) out.push(await handleOne(item));
        return res.json(out);
      } else {
        const single = await handleOne(rawBody);
        return res.json(single);
      }
    } catch (e) {
      return res.status(500).json({ jsonrpc:'2.0', id: null, error: { code: -32000, message: 'server_error', data: String(e?.message || e) } });
    }
  });

  // Also support canonical shape /api/mcp2/:name/stream (GET SSE + POST JSON-RPC)
  app.get('/api/mcp2/:name/stream', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      let server = null; try { server = await findServerByName(name); } catch {}
      const t = pickToken(req);
      if (server && String(server.token || '')) {
        if (t !== String(server.token)) return res.status(401).json({ ok:false, error:'unauthorized' });
      }
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
      // MCP Inspector (SSEClientTransport) expects an `endpoint` event with the POST URL.
      try {
        // Match the current path (stream handler -> stream)
        const endpointPath = `/api/mcp2/${encodeURIComponent(name)}/stream`;
        res.write(`event: endpoint\n`);
        const abs = toAbsoluteUrl(req, endpointPath);
        const payload = withTokenQuery(req, abs || endpointPath);
        res.write(`data: ${payload}\n\n`);
      } catch {}
      pushRecentRpc(name, { ts: Date.now(), id: null, method: 'sse_connect', params: { path: req.path, token: req.query?.token ? '***' : undefined } });
      const byName = sessions.get(name) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(name, byName);
      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => { clearInterval(iv); try { res.end(); } catch {} try { const map = sessions.get(name); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(name); } } catch {} });
    } catch (e) { try { res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); } catch {} }
  });
  async function handleApiMcpJsonRpcPost(req, res, name) {
    let rec = { ts: Date.now(), id: null, method: '', params: {} };
    try {
      const safeName = String(name || '').trim();
      let server = null; try { server = await findServerByName(safeName); } catch {}
      const t = pickToken(req);
      if (server && String(server.token || '')) {
        if (t !== String(server.token)) {
          return res.status(401).json({ jsonrpc:'2.0', id:null, error: { code: -32001, message: 'unauthorized' } });
        }
      }

      async function parseBodyFallback() {
        try {
          if (req.body && typeof req.body === 'object') return req.body;
          if (req.readableEnded) return {};
          const chunks = [];
          let total = 0;
          await new Promise((resolve) => {
            req.on('data', (c) => {
              try {
                total += c.length || 0;
                // Keep a hard cap to avoid memory blowups on invalid clients
                if (total <= 2 * 1024 * 1024) chunks.push(c);
              } catch {}
            });
            req.on('end', resolve);
            req.on('error', resolve);
          });
          const buf = Buffer.concat(chunks);
          if (!buf.length) return {};
          return JSON.parse(buf.toString('utf8'));
        } catch {
          return {};
        }
      }

      const body = (req.body && typeof req.body === 'object') ? req.body : await parseBodyFallback();
      if (!(body && typeof body === 'object' && body.jsonrpc === '2.0')) {
        try {
          const contentType = String(req.headers?.['content-type'] || '');
          let preview = '';
          try {
            if (typeof body === 'string') preview = body.slice(0, 500);
            else preview = JSON.stringify(body).slice(0, 500);
          } catch {}
          pushRecentRpc(safeName, {
            ts: Date.now(),
            id: null,
            method: 'invalid_request',
            params: { path: req.path, contentType, bodyPreview: preview || undefined },
            error: 'Invalid Request'
          });
        } catch {}
        return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      }
      const id = body.id ?? null;
      const method = String(body.method || '').trim();
      const params = body.params || {};
      rec = { ts: Date.now(), id, method, params: redactDeep(params) };
      try {
        if (chatLog) chatLog('mcp2_rpc', { name: safeName, method, id: id ?? null });
      } catch {}

      let result;
      if (method === 'initialize') {
        const reqProto = (params && typeof params === 'object' && typeof params.protocolVersion === 'string') ? params.protocolVersion : '';
        const protocolVersion = reqProto || '2025-11-25';
        try { res.setHeader('mcp-protocol-version', protocolVersion); } catch {}
        result = {
          protocolVersion,
          serverInfo: { name: `mcp2:${safeName}`, version: '1.0.0' },
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: false, listChanged: false },
            resourceTemplates: { listChanged: false },
            prompts: { listChanged: false },
            logging: {}
          }
        };
        try { const sid = Math.random().toString(16).slice(2) + Date.now().toString(36); res.setHeader('mcp-session-id', sid); } catch {}
      } else if (method === 'notifications/initialized' || method === 'initialized') {
        // JSON-RPC notification: no response body expected.
        pushRecentRpc(safeName, { ...rec, result: null });
        return res.status(204).end();
      } else if (method === 'tools/list') {
        try {
          const tools = await listToolsForServer(safeName);
          const fallback = [
            { name: 'ping', description: 'Responds with ok:true', inputSchema: { type:'object' } },
            { name: 'time_now', description: 'Returns ISO timestamp', inputSchema: { type:'object' } },
            { name: 'db_query', description: 'Run a safe SELECT via Postgres pool', inputSchema: { type:'object', properties: { sql: { type:'string' } }, required: ['sql'] } },
          ];
          result = { tools: dedupeTools((tools && tools.length) ? tools : fallback) };
        } catch {
          result = { tools: [] };
        }
      } else if (method === 'tools/call') {
        const toText = (payload) => {
          try {
            const max = Number(process.env.MCP2_TOOL_RESULT_MAX_CHARS || 20000);
            const s = (typeof payload === 'string') ? payload : JSON.stringify(payload, null, 2);
            if (s.length <= max) return s;
            return `${s.slice(0, max)}\n[truncated ${s.length - max} chars]`;
          } catch (e) {
            return String(payload ?? '');
          }
        };
        const buildSummaryText = (payload, toolName) => {
          try {
            if (!payload || typeof payload !== 'object') return '';
            // http tool wrapper shape: { ok, status, url, body }
            const body = (payload.body && typeof payload.body === 'object') ? payload.body : null;
            if (!body) return '';
            const tn = (body.tracking_number != null ? String(body.tracking_number).trim() : '')
              || (body.tracking && body.tracking.tracking_number != null ? String(body.tracking.tracking_number).trim() : '');
            const link = (body.tracking_link != null ? String(body.tracking_link).trim() : '')
              || (body.tracking && body.tracking.tracking_link != null ? String(body.tracking.tracking_link).trim() : '');
            // Default includes POD if present; some tools want a minimal output.
            const wantsCompact = String(toolName || '').trim().toLowerCase() === 'dhl.track.by_id_order';
            const pod = wantsCompact ? '' : (
              (body.proof_of_delivery_url != null ? String(body.proof_of_delivery_url).trim() : '')
              || (body.tracking && body.tracking.proof_of_delivery_url != null ? String(body.tracking.proof_of_delivery_url).trim() : '')
            );
            if (!tn && !link && !pod) return '';
            const lines = [];
            if (tn) lines.push(`tracking_number: ${tn}`);
            if (link) lines.push(`tracking_link: ${link}`);
            if (pod) lines.push(`proof_of_delivery_url: ${pod}`);
            return lines.join('\n');
          } catch {
            return '';
          }
        };
        const wrapCallToolResult = (payload, toolName) => {
          try {
            // If a tool already returns a CallToolResult-like shape, pass it through.
            if (payload && typeof payload === 'object' && Array.isArray(payload.content)) return payload;
          } catch {}
          const isError = !!(
            payload && typeof payload === 'object' &&
            (payload.ok === false || (payload.body && typeof payload.body === 'object' && payload.body.ok === false))
          );
          const summary = buildSummaryText(payload, toolName);
          const compactOnly = String(toolName || '').trim().toLowerCase() === 'dhl.track.by_id_order';
          if (summary) return compactOnly
            ? { content: [{ type: 'text', text: summary }], isError }
            : { content: [{ type: 'text', text: summary }, { type: 'text', text: toText(payload) }], isError };
          return { content: [{ type: 'text', text: toText(payload) }], isError };
        };
        const tool = String(params?.name || '').trim();
        const args = params?.arguments || params || {};
        let toolPayload;
        if (tool === 'ping') toolPayload = { ok: true };
        else if (tool === 'time.now' || tool === 'time_now') toolPayload = { now: new Date().toISOString() };
        else if (tool === 'db.query' || tool === 'db_query') {
          try {
            if (!pool || typeof pool.query !== 'function') toolPayload = { ok:false, error:'db_unavailable' };
            else {
              const sql = String(args.sql || '').trim();
              if (!/^\s*select\b/i.test(sql)) toolPayload = { ok:false, error:'only_select_allowed' };
              else {
                const r = await pool.query(sql);
                const rows = (r && Array.isArray(r.rows)) ? r.rows.slice(0, 100) : [];
                const cols = rows[0] ? Object.keys(rows[0]) : [];
                const rc = (r && typeof r.rowCount === 'number') ? r.rowCount : rows.length;
                toolPayload = { ok:true, rowCount: rc, columns: cols, rows: rows };
              }
            }
          } catch (e) {
            toolPayload = { ok:false, error: String((e && e.message) || e) };
          }
        } else {
          try {
            toolPayload = await callToolForServer(safeName, tool, args);
          } catch (e) {
            toolPayload = { ok:false, error: String((e && e.message) || e) };
          }
        }
        result = wrapCallToolResult(toolPayload, tool);
      } else if (method === 'resources/list') {
        result = { resources: [] };
      } else if (method === 'resourceTemplates/list') {
        result = { resourceTemplates: [] };
      } else if (method === 'prompts/list') {
        result = { prompts: [] };
      } else {
        try { pushRecentRpc(safeName, { ...rec, result: null, error: 'Method not found' }); } catch {}
        return res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
      }

      const response = { jsonrpc: '2.0', id, result };
      try {
        const map = sessions.get(safeName);
        if (map) for (const { res: r } of map.values()) {
          try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(response)}\n\n`); } catch {}
        }
      } catch {}

      if (method === 'initialize') {
        try {
          const listChanged = { jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} };
          const map = sessions.get(safeName);
          if (map) for (const { res: r } of map.values()) {
            try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(listChanged)}\n\n`); } catch {}
          }
        } catch {}
      }

      rec = { ...rec, result: response.result ?? null };
      pushRecentRpc(safeName, rec);
      return res.json(response);
    } catch (e) {
      const errEntry = { ...rec, result: null, error: String((e && e.message) || e) };
      pushRecentRpc(safeName, errEntry);
      return res.status(500).json({ jsonrpc:'2.0', id: null, error: { code: -32000, message: 'server_error', data: String(e?.message || e) } });
    }
  }

  app.post('/api/mcp2/:name/stream', async (req, res) => {
    return handleApiMcpJsonRpcPost(req, res, req.params.name);
  });

  // Also provide /api/mcp2/:name/events SSE alias
  app.get('/api/mcp2/:name/events', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      let server = null; try { server = await findServerByName(name); } catch {}
      const t = pickToken(req);
      if (server && String(server.token || '')) { if (t !== String(server.token)) return res.status(401).json({ ok:false, error:'unauthorized' }); }
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
      // MCP Inspector (SSEClientTransport) expects an `endpoint` event with the POST URL.
      try {
        // Match the current path (events alias -> events)
        const endpointPath = `/api/mcp2/${encodeURIComponent(name)}/events`;
        res.write(`event: endpoint\n`);
        const abs = toAbsoluteUrl(req, endpointPath);
        const payload = withTokenQuery(req, abs || endpointPath);
        res.write(`data: ${payload}\n\n`);
      } catch {}
      pushRecentRpc(name, { ts: Date.now(), id: null, method: 'sse_connect', params: { path: req.path, token: req.query?.token ? '***' : undefined } });
      const byName = sessions.get(name) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(name, byName);
      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => { clearInterval(iv); try { res.end(); } catch {} try { const map = sessions.get(name); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(name); } } catch {} });
    } catch (e) { try { res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); } catch {} }
  });
  // POST alias so MCP Inspector can use the same /events URL for JSON-RPC.
  app.post('/api/mcp2/:name/events', async (req, res) => {
    return handleApiMcpJsonRpcPost(req, res, req.params.name);
  });

  
  app.get('/api/mcp2/:name/recent-rpc', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      const items = recentRpc.get(name) || [];
      return res.json({ ok: true, name, items });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: String(e?.message || e) });
    }
  });

  // Client->Server messages (simple tools protocol) — manual JSON body parse (no express import)
  app.post('/mcp2/:name/message', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      const server = await findServerByName(name);
      if (!server) return res.status(404).json({ ok:false, error:'not_found' });
      const t = pickToken(req);
      if (String(server.token || '') && t !== String(server.token)) return res.status(401).json({ ok:false, error:'unauthorized' });
      // Collect body
      const chunks = [];
      await new Promise((resolve) => { req.on('data', (c)=>chunks.push(c)); req.on('end', resolve); req.on('error', resolve); });
      let body = {};
      try { const buf = Buffer.concat(chunks); if (buf.length) body = JSON.parse(buf.toString('utf8')); } catch {}
      const id = body.id || null;
      const method = String(body.method || '').trim();
      const params = body.params || {};

      let result;
      if (method === 'tools/list') {
        try {
          const tools = await listToolsForServer(name);
          const fallback = [
            { name: 'ping', description: 'Responds with ok:true', inputSchema: { type:'object' } },
            { name: 'time_now', description: 'Returns ISO timestamp', inputSchema: { type:'object' } },
            { name: 'db_query', description: 'Run a safe SELECT via Postgres pool', inputSchema: { type:'object', properties: { sql: { type:'string' } }, required: ['sql'] } },
          ];
          result = { tools: dedupeTools((tools && tools.length) ? tools : fallback) };
        } catch { result = { tools: [] }; }
      } else if (method === 'tools/call') {
        const tool = String((params && params.name) || '').trim();
        const args = (params && params.arguments) ? params.arguments : (params || {});
        if (tool === 'ping') result = { ok: true };
        else if (tool === 'time.now' || tool === 'time_now') result = { now: new Date().toISOString() };
        else if (tool === 'db.query' || tool === 'db_query') {
          try {
            if (!pool || typeof pool.query !== 'function') result = { ok:false, error:'db_unavailable' };
            else {
              const sql = String((params && params.sql) || '').trim();
              if (!/^\s*select\b/i.test(sql)) result = { ok:false, error:'only_select_allowed' };
              else {
                const r = await pool.query(sql);
                const rows = (r && Array.isArray(r.rows)) ? r.rows.slice(0, 100) : [];
                const cols = rows[0] ? Object.keys(rows[0]) : [];
                const rc = (r && typeof r.rowCount === 'number') ? r.rowCount : rows.length;
                result = { ok:true, rowCount: rc, columns: cols, rows: rows };
              }
            }
          } catch (e) { result = { ok:false, error: String((e && e.message) || e) }; }
        } else {
          try { result = await callToolForServer(name, tool, args); } catch (e) { result = { ok:false, error: String((e && e.message) || e) }; }
        }
      } else {
        result = { ok:false, error:'unknown_method' };
      }

      // Fan out result to all sessions for this server (as NDJSON events)
      const out = { type: 'result', id, method, result };
      try {
        const map = sessions.get(server.name);
        if (map) for (const { res: r } of map.values()) { try { r.write(JSON.stringify(out) + '\n'); } catch {} }
      } catch {}
      return res.json({ ok:true, id, method, result });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); }
  });

  // API alias for message — handle directly (benefits from server-level JSON parser too)
  app.post('/api/mcp2/transport/:name/message', async (req, res) => {
    try {
      const name = String(req.params.name || '').trim();
      const server = await findServerByName(name);
      if (!server) return res.status(404).json({ ok:false, error:'not_found' });
      const t = pickToken(req);
      if (String(server.token || '') && t !== String(server.token)) return res.status(401).json({ ok:false, error:'unauthorized' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const id = body.id || null;
      const method = String(body.method || '').trim();
      const params = body.params || {};

      let result;
      if (method === 'tools/list') {
        try {
          const tools = await listToolsForServer(name);
          const out = (tools || []).map((t) => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || { type:'object' },
            input_schema: t.inputSchema || { type:'object' },
          }));
          result = { tools: dedupeTools(out) };
        } catch { result = { tools: [] }; }
      } else if (method === 'resources/list') {
        try {
          const resources = await (async () => {
            if (!server) return [];
            const opt = safeJsonParse(server.options || {}, {});
            const map = (opt && typeof opt.resources_enabled==='object') ? opt.resources_enabled : {};
            // Prefer server-scoped stored config
            try {
              if (ctx && ctx.pool) {
                const r0 = await ctx.pool.query(`SELECT resources, options FROM mod_mcp2_server WHERE id=$1 OR name=$2 LIMIT 1`, [server.id || '', server.name || '']);
                if (r0 && r0.rowCount) {
                  const opt0 = safeJsonParse(r0.rows[0].options || {}, opt || {});
                  const list = Array.isArray(r0.rows[0].resources) ? r0.rows[0].resources : [];
                  if (list.length && !isPersistDisabled(opt0)) {
                    return list
                      .filter(x => (x?.enabled !== false) && (map[String(x?.uri)] !== false))
                      .map(x => ({
                        uri: String(x?.uri||'').trim(),
                        name: String(x?.name||''),
                        description: String(x?.description||''),
                        ...(x?.mimeType ? { mimeType: String(x.mimeType) } : {}),
                      }))
                      .filter(x => x.uri);
                  }
                }
              }
            } catch {}
            // Fallback to origin profile resources
            const origin = String(opt.origin_module || '').trim();
            const pid = opt.origin_profile_id || null;
            if (!origin || !pid) return [];
            const port = Number(process.env.PORT || 3010);
            const base = `http://127.0.0.1:${port}`;
            const headers = { 'Content-Type': 'application/json' };
            try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
            const r2 = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resources`, { headers });
            const j2 = await r2.json().catch(()=>({}));
            const list = (r2.ok && Array.isArray(j2?.items)) ? j2.items : [];
            return list
              .filter(x => map[String(x.uri)] !== false)
              .map(x => ({ uri: x.uri, name: x.name||'', description: x.description||'', ...(x.mimeType? { mimeType: x.mimeType } : {}) }));
          })();
          result = { resources };
        } catch { result = { resources: [] }; }
      } else if (method === 'resources/templates/list' || method === 'resourceTemplates/list') {
        try {
          const resource_templates = await (async () => {
            if (!server) return [];
            const opt = safeJsonParse(server.options || {}, {});
            const map = (opt && typeof opt.resource_templates_enabled==='object') ? opt.resource_templates_enabled : {};
            // Prefer server-scoped stored config
            try {
              if (ctx && ctx.pool) {
                const r0 = await ctx.pool.query(`SELECT resource_templates, options FROM mod_mcp2_server WHERE id=$1 OR name=$2 LIMIT 1`, [server.id || '', server.name || '']);
                if (r0 && r0.rowCount) {
                  const opt0 = safeJsonParse(r0.rows[0].options || {}, opt || {});
                  const list = Array.isArray(r0.rows[0].resource_templates) ? r0.rows[0].resource_templates : [];
                  if (list.length && !isPersistDisabled(opt0)) {
                    return list
                      .filter(x => (x?.enabled !== false) && (map[String(x?.name)] !== false))
                      .map(x => {
                        const props = (x?.inputSchema && typeof x.inputSchema==='object' && x.inputSchema.properties && typeof x.inputSchema.properties==='object')
                          ? Object.keys(x.inputSchema.properties)
                          : [];
                        const qs = props.length ? ('?' + props.map(k => `${encodeURIComponent(k)}={${k}}`).join('&')) : '';
                        const uriTemplate = (typeof x?.uriTemplate === 'string' && x.uriTemplate.trim())
                          ? x.uriTemplate.trim()
                          : `server:${server.name}:${String(x?.name||'')}${qs}`;
                        const inputSchema = (x?.inputSchema && typeof x.inputSchema === 'object') ? x.inputSchema : {};
                        return {
                          name: String(x?.name||'').trim(),
                          description: String(x?.description||''),
                          inputSchema,
                          uriTemplate,
                          input_schema: inputSchema,
                          uri_template: uriTemplate,
                        };
                      })
                      .filter(x => x.name);
                  }
                }
              }
            } catch {}
            // Fallback to origin profile templates
            const origin = String(opt.origin_module || '').trim();
            const pid = opt.origin_profile_id || null;
            if (!origin || !pid) return [];
            const port = Number(process.env.PORT || 3010);
            const base = `http://127.0.0.1:${port}`;
            const headers = { 'Content-Type': 'application/json' };
            try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
            const r2 = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resource-templates`, { headers });
            const j2 = await r2.json().catch(()=>({}));
            const list = (r2.ok && Array.isArray(j2?.items)) ? j2.items : [];
            return list
              .filter(x => map[String(x.name)] !== false)
              .map(x => {
                const props = (x && x.inputSchema && typeof x.inputSchema==='object' && x.inputSchema.properties && typeof x.inputSchema.properties==='object') ? Object.keys(x.inputSchema.properties) : [];
                const qs = props.length ? ('?' + props.map(k => `${encodeURIComponent(k)}={${k}}`).join('&')) : '';
                const uriTemplate = `profile:${origin}:${pid}:${x.name}${qs}`;
                const inputSchema = (x.inputSchema && typeof x.inputSchema==='object') ? x.inputSchema : {};
                return { name: x.name, description: x.description||'', inputSchema, uriTemplate, input_schema: inputSchema, uri_template: uriTemplate };
              });
          })();
          result = { resource_templates, resourceTemplates: resource_templates };
        } catch { result = { resource_templates: [] }; }
      } else if (method === 'tools/call') {
        const tool = String((params && params.name) || '').trim();
        if (tool === 'ping') result = { ok: true };
        else if (tool === 'time.now') result = { now: new Date().toISOString() };
        else if (tool === 'db.query') {
          try {
            if (!pool || typeof pool.query !== 'function') result = { ok:false, error:'db_unavailable' };
            else {
              const sql = String((params && params.sql) || '').trim();
              if (!/^\s*select\b/i.test(sql)) result = { ok:false, error:'only_select_allowed' };
              else {
                const r = await pool.query(sql);
                const rows = (r && Array.isArray(r.rows)) ? r.rows.slice(0, 100) : [];
                const cols = rows[0] ? Object.keys(rows[0]) : [];
                const rc = (r && typeof r.rowCount === 'number') ? r.rowCount : rows.length;
                result = { ok:true, rowCount: rc, columns: cols, rows: rows };
              }
            }
          } catch (e) { result = { ok:false, error: String((e && e.message) || e) }; }
        } else {
          try {
            const args = (params && params.arguments) ? params.arguments : (params || {});
            result = await callToolForServer(name, tool, args);
          } catch (e) { result = { ok:false, error: String((e && e.message) || e) }; }
        }
      } else {
        result = { ok:false, error:'unknown_method' };
      }

      const out = { type: 'result', id, method, result };
      try { const map = sessions.get(server.name); if (map) for (const { res: r } of map.values()) { try { r.write(JSON.stringify(out) + '\n'); } catch {} } } catch {}
      return res.json({ ok:true, id, method, result });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: (e && e.message) || String(e) }); }
  });
}
