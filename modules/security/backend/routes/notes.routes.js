import { ensureNotesTable, getTabNote, upsertTabNote } from '../services/notes.service.js';
import { parseOrgIdFromRequest } from '../utils/parseOrgId.js';

const VALID_TABS = new Set([
  'uptime-kuma',
  'ufw',
  'fail2ban',
  'cloudflare',
  'goaccess',
  'remote-log',
  'settings',
  'commands',
  'cockpit',
]);

function normalizeTab(tab) {
  const t = String(tab || '').trim();
  return VALID_TABS.has(t) ? t : null;
}

export function registerSecurityNotesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin;
  const logToFile = ctx.logToFile;

  app.get('/api/security/notes/:tab', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const tab = normalizeTab(req.params.tab);
      if (!tab) return res.status(400).json({ ok: false, error: 'invalid_tab' });
      const orgId = parseOrgIdFromRequest(req);

      await ensureNotesTable(pool);
      const note = await getTabNote(pool, { tab, orgId });
      res.json({ ok: true, tab, org_id: orgId, note: note || '' });
    } catch (e) {
      try { if (typeof logToFile === 'function') logToFile(`[security] notes:get error: ${e && e.message ? e.message : e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.put('/api/security/notes/:tab', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const tab = normalizeTab(req.params.tab);
      if (!tab) return res.status(400).json({ ok: false, error: 'invalid_tab' });
      const orgId = parseOrgIdFromRequest(req);
      const note = String(req && req.body && req.body.note != null ? req.body.note : '').slice(0, 200000);

      await ensureNotesTable(pool);
      const row = await upsertTabNote(pool, { tab, orgId, note });
      res.json({ ok: true, tab, org_id: orgId, note: (row && row.note) ? row.note : '' });
    } catch (e) {
      try { if (typeof logToFile === 'function') logToFile(`[security] notes:put error: ${e && e.message ? e.message : e}`); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
