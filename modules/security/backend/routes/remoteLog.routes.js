import { listRemoteApacheLogFiles, tailRemoteApacheAccessLog, tailRemoteApacheLogFile } from '../services/remoteLog.service.js';
import { parseOrgIdFromRequest } from '../utils/parseOrgId.js';

export function registerSecurityRemoteLogRoutes(app, ctx = {}) {
  const requireAdmin = ctx.requireAdmin;
  const logToFile = ctx.logToFile;
  const pool = ctx.pool;

  app.get('/api/security/remote/apache/files', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const connectionId = Math.trunc(Number(req.query.connection_id) || 0) || null;
      const data = await listRemoteApacheLogFiles({ pool, orgId, connectionId });
      res.json({
        ok: true,
        org_id: orgId,
        connection_id: connectionId,
        ...data,
        config: data.config,
      });
    } catch (e) {
      const status = Number(e && e.statusCode) || 500;
      try { if (typeof logToFile === 'function') logToFile(`[security] remote-log files error: ${e && e.message ? e.message : e}`); } catch {}
      res.status(status).json({ ok: false, error: 'server_error', message: (e && e.message) ? e.message : String(e) });
    }
  });

  app.get('/api/security/remote/apache/tail', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const lines = Math.max(10, Math.min(2000, Number(req.query.lines || 300)));
      const file = String(req.query.file || '');
      const mode = String(req.query.mode || 'tail');
      const offset = Math.max(0, Math.min(5000000, Number(req.query.offset || 0)));
      const orgId = parseOrgIdFromRequest(req);
      const connectionId = Math.trunc(Number(req.query.connection_id) || 0) || null;
      const data = await tailRemoteApacheLogFile({ pool, orgId, connectionId, file, lines, mode, offset });
      res.json({
        ok: true,
        org_id: orgId,
        connection_id: connectionId,
        lines,
        ...data,
        config: data.config,
      });
    } catch (e) {
      const status = Number(e && e.statusCode) || 500;
      try { if (typeof logToFile === 'function') logToFile(`[security] remote-log tail error: ${e && e.message ? e.message : e}`); } catch {}
      res.status(status).json({ ok: false, error: 'server_error', message: (e && e.message) ? e.message : String(e) });
    }
  });

  app.get('/api/security/remote/apache/access-log', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const lines = Math.max(10, Math.min(2000, Number(req.query.lines || 300)));
      const orgId = parseOrgIdFromRequest(req);
      const connectionId = Math.trunc(Number(req.query.connection_id) || 0) || null;
      const data = await tailRemoteApacheAccessLog({ pool, orgId, connectionId, lines });
      res.json({
        ok: true,
        org_id: orgId,
        connection_id: connectionId,
        lines,
        ...data,
        config: data.config,
      });
    } catch (e) {
      try { if (typeof logToFile === 'function') logToFile(`[security] remote-log error: ${e && e.message ? e.message : e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error', message: (e && e.message) ? e.message : String(e) });
    }
  });
}
