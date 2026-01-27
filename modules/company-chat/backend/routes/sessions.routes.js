import { deleteSession, getSessionMessages, listSessions, pickOrgId } from '../services/companyChatDb.js';

export function registerCompanyChatSessionsRoutes(app, ctx = {}) {
  const pool = ctx.pool;

  app.get('/api/company-chat/sessions', async (req, res) => {
    try {
      const orgId = await pickOrgId(pool, req);
      const limit = Number(req.query?.limit || 10) || 10;
      const tabId = String(req.query?.tab_id || '').trim() || null;
      const sessions = await listSessions(pool, orgId, { tabId, limit });
      res.json({ ok: true, sessions });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.get('/api/company-chat/sessions/:id/messages', async (req, res) => {
    try {
      const orgId = await pickOrgId(pool, req);
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const messages = await getSessionMessages(pool, orgId, id);
      res.json({ ok: true, messages });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.delete('/api/company-chat/sessions/:id', async (req, res) => {
    try {
      const orgId = await pickOrgId(pool, req);
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const deleted = await deleteSession(pool, orgId, id);
      res.json({ ok: true, deleted });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
}

