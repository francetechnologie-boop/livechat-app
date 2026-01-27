import { getSecurityConfig } from '../services/settings.service.js';
import {
  getRemoteLogConnection,
  deleteRemoteLogConnection,
  listRemoteLogConnections,
  resolveSecurityRemoteLogConfig,
  setDefaultRemoteLogConnection,
  testRemoteLogConnection,
  upsertRemoteLogConnection,
} from '../services/remoteConnections.service.js';
import { parseOrgIdFromRequest } from '../utils/parseOrgId.js';

export function registerSecurityRemoteConnectionsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin;
  const logToFile = ctx.logToFile;

  app.get('/api/security/remote/connections', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const connections = await listRemoteLogConnections(pool, { orgId });
      const legacy = await getSecurityConfig(pool, { orgId });
      const active = await resolveSecurityRemoteLogConfig(pool, { orgId, connectionId: null });
      res.json({
        ok: true,
        org_id: orgId,
        connections,
        active: {
          src: active.src,
          connection_id: active.connection?.id || null,
          name: active.connection?.name || null,
        },
        legacy: {
          configured: legacy.configured,
          source: legacy.configuredFromDb ? 'db' : 'env',
          config: {
            ssh_host: legacy.host,
            ssh_user: legacy.user,
            ssh_port: legacy.port,
            ssh_key_path: legacy.keyPath,
            log_path: legacy.logPath,
          },
        },
      });
    } catch (e) {
      try { logToFile?.(`[security] remote-connections:list error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/security/remote/connections', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const body = req.body || {};
      const setDefault = Boolean(body.set_default);
      const id = Math.trunc(Number(body.id) || 0) || null;
      let keepDefault = false;
      if (id) {
        const existing = await getRemoteLogConnection(pool, { orgId, id });
        keepDefault = Boolean(existing?.is_default);
      }
      const connection = await upsertRemoteLogConnection(pool, {
        orgId,
        connection: {
          id,
          name: body.name,
          ssh_host: body.ssh_host,
          ssh_user: body.ssh_user,
          ssh_port: body.ssh_port,
          ssh_key_path: body.ssh_key_path,
          log_path: body.log_path,
          is_default: keepDefault,
        },
      });
      if (!connection) return res.status(404).json({ ok: false, error: 'not_found' });
      const updated = setDefault ? await setDefaultRemoteLogConnection(pool, { orgId, id: connection.id }) : connection;
      res.json({ ok: true, org_id: orgId, connection: updated || connection });
    } catch (e) {
      const status = Number(e?.statusCode) || (String(e?.code || '') === '23505' ? 409 : 500);
      try { logToFile?.(`[security] remote-connections:upsert error: ${e?.message || e}`); } catch {}
      res.status(status).json({ ok: false, error: status === 409 ? 'conflict' : 'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/security/remote/connections/:id/set-default', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const id = Math.trunc(Number(req.params.id) || 0);
      const connection = await setDefaultRemoteLogConnection(pool, { orgId, id });
      if (!connection) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, org_id: orgId, connection });
    } catch (e) {
      try { logToFile?.(`[security] remote-connections:set-default error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.delete('/api/security/remote/connections/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const id = Math.trunc(Number(req.params.id) || 0);
      const ok = await deleteRemoteLogConnection(pool, { orgId, id });
      res.json({ ok: true, org_id: orgId, deleted: ok });
    } catch (e) {
      try { logToFile?.(`[security] remote-connections:delete error: ${e?.message || e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/security/remote/connections/test', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const body = req.body || {};
      const connectionId = Math.trunc(Number(body.id ?? body.connection_id) || 0) || null;
      const payload = body.connection && typeof body.connection === 'object' ? body.connection : null;
      const result = await testRemoteLogConnection({
        pool,
        orgId,
        connectionId,
        connection: payload ? {
          ssh_host: payload.ssh_host,
          ssh_user: payload.ssh_user,
          ssh_port: payload.ssh_port,
          ssh_key_path: payload.ssh_key_path,
          log_path: payload.log_path,
        } : (connectionId ? null : {
          ssh_host: body.ssh_host,
          ssh_user: body.ssh_user,
          ssh_port: body.ssh_port,
          ssh_key_path: body.ssh_key_path,
          log_path: body.log_path,
        }),
      });
      res.json({ ok: true, org_id: orgId, result });
    } catch (e) {
      const status = Number(e?.statusCode) || 500;
      try { logToFile?.(`[security] remote-connections:test error: ${e?.message || e}`); } catch {}
      res.status(status).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
}
