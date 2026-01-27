export async function onModuleLoaded(ctx = {}) {
  const { app, requireAdmin, getSetting, setSetting, logToFile } = ctx;
  if (!app || typeof app.get !== 'function') return;

  let haBaseUrl = String(process.env.HA_BASE_URL || '');
  let haToken = String(process.env.HA_TOKEN || '');

  try {
    const savedBase = await getSetting?.('HA_BASE_URL');
    const savedTok = await getSetting?.('HA_TOKEN');
    if (typeof savedBase === 'string') haBaseUrl = savedBase;
    if (typeof savedTok === 'string') haToken = savedTok;
  } catch {}

  const getHaBaseUrl = () => haBaseUrl;
  const getHaToken = () => haToken;
  function normalizeHaBase(raw) {
    let b = (raw && String(raw).trim()) || '';
    if (!b) return '';
    if (!/^https?:\/\//i.test(b)) return '';
    return b.replace(/\/$/, '');
  }

  async function haFetch(pathname, { method = 'GET', body } = {}) {
    const base = getHaBaseUrl();
    const token = getHaToken();
    if (!base || !token) {
      const err = new Error('ha_config_missing');
      err.status = 412;
      throw err;
    }
    const url = `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const r = await fetch(url, init);
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    if (!r.ok) {
      const e = new Error(json?.message || json?.error || text || `http_${r.status}`);
      e.status = r.status;
      e.details = json || text;
      throw e;
    }
    return json;
  }

  // Admin config endpoints
  app.get('/api/admin/ha/config', (req, res) => {
    const u = requireAdmin?.(req, res);
    if (!u) return;
    try {
      res.json({ ok: true, base_url: getHaBaseUrl() || null, has_token: !!getHaToken() });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/admin/ha/config', async (req, res) => {
    const u = requireAdmin?.(req, res);
    if (!u) return;
    try {
      const base = normalizeHaBase(req.body?.base_url);
      const token = String(req.body?.token || '').trim();
      if (base == null) return res.status(400).json({ ok: false, error: 'invalid_base' });
      await setSetting?.('HA_BASE_URL', base || '');
      await setSetting?.('HA_TOKEN', token || '');
      haBaseUrl = base || '';
      haToken = token || '';
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // HA proxy endpoints
  app.get('/api/ha/info', async (req, res) => {
    const u = requireAdmin?.(req, res);
    if (!u) return;
    try {
      const j = await haFetch('/api/');
      res.json({ ok: true, info: j });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: 'ha_error', message: e?.message || String(e) });
    }
  });

  app.get('/api/ha/states', async (req, res) => {
    const u = requireAdmin?.(req, res);
    if (!u) return;
    try {
      const j = await haFetch('/api/states');
      res.json({ ok: true, states: j });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: 'ha_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/ha/services/:domain/:service', async (req, res) => {
    const u = requireAdmin?.(req, res);
    if (!u) return;
    try {
      const { domain, service } = req.params;
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const j = await haFetch(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, { method: 'POST', body: payload });
      res.json({ ok: true, result: j });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: 'ha_error', message: e?.message || String(e) });
    }
  });

  try { logToFile?.('[hooks] home-assistant routes mounted via onModuleLoaded'); } catch {}
}

export async function onModuleDisabled(_ctx = {}) {
  // No-op
}

