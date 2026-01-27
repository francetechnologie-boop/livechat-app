import { getUfwStatus } from '../services/ufw.service.js';

export function registerSecurityUfwRoutes(app, ctx = {}) {
  const requireAdmin = ctx.requireAdmin;
  const logToFile = ctx.logToFile;

  app.get('/api/security/ufw/status', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const out = await getUfwStatus();
      res.json({ ok: true, output: out });
    } catch (e) {
      try { logToFile?.(`[security] ufw:status error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
}

