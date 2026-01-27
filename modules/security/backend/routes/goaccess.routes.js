import { createGoaccessDashboard, deleteGoaccessDashboard, listGoaccessDashboards, updateGoaccessDashboard } from '../services/goaccess.service.js';
import { parseOrgIdFromRequest } from '../utils/parseOrgId.js';

export function registerSecurityGoaccessRoutes(app, ctx = {}) {
  const requireAdmin = ctx.requireAdmin;
  const logToFile = ctx.logToFile;
  const pool = ctx.pool;

  app.get('/api/security/goaccess/dashboards', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const items = await listGoaccessDashboards(pool, { orgId });
      res.json({ ok: true, org_id: orgId, items });
    } catch (e) {
      try { if (typeof logToFile === 'function') logToFile(`[security] goaccess:list error: ${e && e.message ? e.message : e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error', message: (e && e.message) ? e.message : String(e) });
    }
  });

  app.post('/api/security/goaccess/dashboards', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const name = req && req.body ? req.body.name : '';
      const url = req && req.body ? req.body.url : '';
      const row = await createGoaccessDashboard(pool, { orgId, name, url });
      res.json({ ok: true, org_id: orgId, item: row });
    } catch (e) {
      const status = Number(e && e.statusCode) || 500;
      try { if (typeof logToFile === 'function') logToFile(`[security] goaccess:create error: ${e && e.message ? e.message : e}`); } catch {}
      res.status(status).json({ ok: false, error: 'server_error', message: (e && e.message) ? e.message : String(e) });
    }
  });

  app.put('/api/security/goaccess/dashboards/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const id = req && req.params ? req.params.id : null;
      const name = req && req.body ? req.body.name : '';
      const url = req && req.body ? req.body.url : '';
      const row = await updateGoaccessDashboard(pool, { orgId, id, name, url });
      res.json({ ok: true, org_id: orgId, item: row });
    } catch (e) {
      const status = Number(e && e.statusCode) || 500;
      try { if (typeof logToFile === 'function') logToFile(`[security] goaccess:update error: ${e && e.message ? e.message : e}`); } catch {}
      res.status(status).json({ ok: false, error: 'server_error', message: (e && e.message) ? e.message : String(e) });
    }
  });

  app.delete('/api/security/goaccess/dashboards/:id', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const orgId = parseOrgIdFromRequest(req);
      const id = req && req.params ? req.params.id : null;
      const deleted = await deleteGoaccessDashboard(pool, { orgId, id });
      res.json({ ok: true, org_id: orgId, deleted });
    } catch (e) {
      const status = Number(e && e.statusCode) || 500;
      try { if (typeof logToFile === 'function') logToFile(`[security] goaccess:delete error: ${e && e.message ? e.message : e}`); } catch {}
      res.status(status).json({ ok: false, error: 'server_error', message: (e && e.message) ? e.message : String(e) });
    }
  });
}

