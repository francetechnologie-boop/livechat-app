// Cron Action Registry + Dispatcher (Step 1)
// - Modules register explicit, safe-to-run actions (not arbitrary routes).
// - Cron Management schedules these actions by id.
//
// Notes:
// - Never log secrets (passwords/tokens/api keys). Redact before logging.
// - Dispatcher uses internal HTTP to the same server with x-admin-token.

const __cronActions = new Map();

function normalizeId(v) {
  return String(v || '').trim();
}

function redactSecretsFromText(text) {
  try {
    if (!text) return text;
    let out = String(text);
    // Common key=value patterns
    out = out.replace(/(\b(apiPassword|password|apiKey|token|authorization)\s*=\s*)([^&\s]+)/gi, '$1****');
    // JSON-ish patterns: "password":"..."
    out = out.replace(/(\"(apiPassword|password|apiKey|token|authorization)\"\s*:\s*\")([^\"]*)\"/gi, '$1****"');
    return out;
  } catch {
    return '[unprintable]';
  }
}

function redactObject(obj) {
  try {
    const seen = new WeakSet();
    const walk = (v) => {
      if (!v || typeof v !== 'object') return v;
      if (seen.has(v)) return '[circular]';
      seen.add(v);
      if (Array.isArray(v)) return v.map(walk);
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        const key = String(k || '').toLowerCase();
        if (['password', 'apipassword', 'apikey', 'token', 'authorization'].includes(key)) out[k] = '****';
        else out[k] = walk(val);
      }
      return out;
    };
    return walk(obj);
  } catch {
    return { redacted: true };
  }
}

function getByPath(obj, path) {
  try {
    if (!path) return undefined;
    const parts = String(path).split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return cur;
  } catch {
    return undefined;
  }
}

function applyPathParams(pathTemplate, params = {}, payload = {}) {
  let out = String(pathTemplate || '');
  for (const [key, dotPath] of Object.entries(params || {})) {
    const rawVal = getByPath(payload, dotPath);
    const val = rawVal == null ? '' : String(rawVal);
    const enc = encodeURIComponent(val);
    out = out.replaceAll(`:${key}`, enc).replaceAll(`{${key}}`, enc);
  }
  return out;
}

async function getFetch() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  try {
    const mod = await import('node-fetch');
    return (mod.default || mod);
  } catch (e) {
    throw new Error(`fetch_unavailable: ${e?.message || e}`);
  }
}

export function registerCronAction(action = {}) {
  const id = normalizeId(action.id);
  if (!id) return null;
  const module_id = normalizeId(action.module_id || action.moduleId);
  const name = String(action.name || id);
  const description = String(action.description || '');
  const method = String(action.method || 'POST').toUpperCase();
  const path = String(action.path || '').trim();
  const payload_template = (action.payload_template && typeof action.payload_template === 'object' && !Array.isArray(action.payload_template))
    ? action.payload_template
    : {};
  const metadata = (action.metadata && typeof action.metadata === 'object' && !Array.isArray(action.metadata))
    ? action.metadata
    : {};

  if (!module_id || !path.startsWith('/')) return null;
  const item = { id, module_id, name, description, method, path, payload_template, metadata, updated_at: new Date().toISOString() };
  __cronActions.set(id, item);
  return item;
}

export function getCronActions() {
  try {
    return Array.from(__cronActions.values()).map((a) => ({ ...a }));
  } catch {
    return [];
  }
}

export async function dispatchCronHttpAction(action = {}, payload = {}, ctx = {}) {
  const method = String(action.method || 'POST').toUpperCase();
  const template = String(action.path || '').trim();
  const meta = (action.metadata && typeof action.metadata === 'object') ? action.metadata : {};
  const pathParams = (meta.path_params && typeof meta.path_params === 'object') ? meta.path_params : {};

  const resolvedPath = applyPathParams(template, pathParams, payload);
  const port = (() => {
    try {
      const p = ctx?.extras?.server?.address?.()?.port;
      if (p) return Number(p);
    } catch {}
    return Number(process.env.PORT || 3010);
  })();

  const url = `http://127.0.0.1:${port}${resolvedPath}`;
  const f = await getFetch();

  const headers = { Accept: 'application/json' };
  try {
    const tok = String(process.env.ADMIN_TOKEN || '').trim();
    if (tok) headers['x-admin-token'] = tok;
  } catch {}

  const sendBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  let bodyText = null;
  if (sendBody) {
    headers['Content-Type'] = 'application/json';
    bodyText = JSON.stringify(payload || {});
  }

  const t0 = Date.now();
  try {
    const redactedPayload = redactObject(payload || {});
    try { ctx?.logToFile?.(`[cron-dispatch] request action=${action.id || '-'} ${method} ${resolvedPath} payload=${JSON.stringify(redactedPayload)}`); } catch {}
  } catch {}

  let resp;
  try {
    resp = await f(url, { method, headers, body: bodyText });
  } catch (e) {
    const ms = Date.now() - t0;
    try { ctx?.logToFile?.(`[cron-dispatch] network_error action=${action.id || '-'} ${method} ${resolvedPath} ms=${ms} err=${e?.message || e}`); } catch {}
    return { ok: false, error: 'network_error', message: e?.message || String(e) };
  }

  const ms = Date.now() - t0;
  const status = resp.status;
  const contentType = String(resp.headers?.get?.('content-type') || '');
  const raw = await resp.text().catch(() => '');
  const trimmed = String(raw || '').trim();

  let json = null;
  if (contentType.includes('application/json') && trimmed) {
    try { json = JSON.parse(trimmed); } catch {}
  }

  const snippet = redactSecretsFromText(trimmed.replace(/\s+/g, ' ').slice(0, 400));
  try { ctx?.logToFile?.(`[cron-dispatch] response action=${action.id || '-'} status=${status} ms=${ms} body=${snippet || '-'}`); } catch {}

  return {
    ok: status >= 200 && status < 300,
    status,
    contentType,
    json,
    text: trimmed,
    ms,
  };
}

