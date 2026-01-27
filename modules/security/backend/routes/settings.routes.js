import { getSecurityConfig, upsertSecuritySettings, SECURITY_CONFIG_KEYS } from '../services/settings.service.js';
import { parseOrgIdFromRequest } from '../utils/parseOrgId.js';

export function registerSecuritySettingsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin;
  const logToFile = ctx.logToFile;

  app.get('/api/security/settings', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const config = await getSecurityConfig(pool, { orgId });
      res.json({
        ok: true,
        org_id: orgId,
        configured: config.configured,
        source: config.configuredFromDb ? 'db' : 'env',
        config: {
          ssh_host: config.host,
          ssh_user: config.user,
          ssh_port: config.port,
          ssh_key_path: config.keyPath,
          log_path: config.logPath,
        },
      });
    } catch (e) {
      try { logToFile?.(`[security] settings:get error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.put('/api/security/settings', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const body = req.body || {};
      const values = {};
      for (const key of SECURITY_CONFIG_KEYS) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          const raw = body[key];
          const trimmed = raw == null ? '' : String(raw).trim();
          values[key] = trimmed ? trimmed : null;
        }
      }
      if (!Object.keys(values).length) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' });
      }
      await upsertSecuritySettings(pool, { values, orgId });
      const config = await getSecurityConfig(pool, { orgId });
      res.json({
        ok: true,
        org_id: orgId,
        configured: config.configured,
        source: config.configuredFromDb ? 'db' : 'env',
        config: {
          ssh_host: config.host,
          ssh_user: config.user,
          ssh_port: config.port,
          ssh_key_path: config.keyPath,
          log_path: config.logPath,
        },
      });
    } catch (e) {
      try { logToFile?.(`[security] settings:put error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
