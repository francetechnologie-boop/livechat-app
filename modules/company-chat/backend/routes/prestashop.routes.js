import { getConfigValue, pickOrgId, setConfigValue } from '../services/companyChatDb.js';

function requireAdminGuard(ctx) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

function redactSecret(v) {
  try { return String(v || '').trim() ? '__set__' : ''; } catch { return ''; }
}

export function registerCompanyChatPrestaRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);

  app.get('/api/company-chat/prestashop/config', async (req, res) => {
    try {
      const orgId = await pickOrgId(pool, req);
      const base = await getConfigValue(pool, orgId, 'prestashop.base', '');
      const key = await getConfigValue(pool, orgId, 'prestashop.api_key', '');
      res.json({ ok: true, base: typeof base === 'string' ? base : '', api_key: redactSecret(key) });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/company-chat/prestashop/config', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await pickOrgId(pool, req);
      const b = req.body || {};
      if (Object.prototype.hasOwnProperty.call(b, 'base')) await setConfigValue(pool, orgId, 'prestashop.base', String(b.base || '').trim());
      if (Object.prototype.hasOwnProperty.call(b, 'api_key')) await setConfigValue(pool, orgId, 'prestashop.api_key', String(b.api_key || '').trim());
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
  });

  // Lightweight connectivity probe (does not require actual Presta integration here)
  app.post('/api/company-chat/prestashop/test', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const t0 = Date.now();
      const base = String(req.body?.base || '').trim();
      const key = String(req.body?.api_key || '').trim();
      if (!base || !key) return res.status(400).json({ ok: false, error: 'bad_request', message: 'base and api_key required' });
      // Best-effort: attempt the common webservice root check
      const url = `${base.replace(/\/+$/, '')}/api/?ws_key=${encodeURIComponent(key)}&output_format=JSON`;
      const ac = new AbortController();
      const timer = setTimeout(() => { try { ac.abort(); } catch {} }, 8000);
      let r;
      try { r = await fetch(url, { method: 'GET', signal: ac.signal }); }
      catch (e) {
        clearTimeout(timer);
        return res.status(502).json({ ok: false, error: 'connect_failed', message: e?.message || String(e) });
      }
      clearTimeout(timer);
      const ms = Date.now() - t0;
      const type = r.headers?.get?.('content-type') || '';
      if (!r.ok) return res.status(400).json({ ok: false, error: 'connect_failed', ms, status: r.status, content_type: type });
      return res.json({ ok: true, ms, status: r.status, content_type: type, via: 'root' });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
  });
}

