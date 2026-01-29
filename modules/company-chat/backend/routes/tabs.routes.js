import { createTab, deleteTab, listTabs, pickOrgId, updateTab } from '../services/companyChatDb.js';

function requireAdminGuard(ctx) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

export function registerCompanyChatTabsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const sendErr = (res, e) => {
    const msg = e?.message || String(e);
    if (msg === 'db_unavailable') return res.status(503).json({ ok: false, error: 'db_unavailable' });
    return res.status(500).json({ ok: false, error: 'server_error', message: msg });
  };

  app.get('/api/company-chat/tabs', async (req, res) => {
    try {
      const orgId = await pickOrgId(pool, req);
      const includeDisabled = String(req.query?.include_disabled || '') === '1';
      const tabs = await listTabs(pool, orgId, { includeDisabled });
      res.json({ ok: true, tabs });
    } catch (e) {
      return sendErr(res, e);
    }
  });

  app.post('/api/company-chat/tabs/create', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await pickOrgId(pool, req);
      const b = req.body || {};
      const id = await createTab(pool, orgId, {
        title: b.title,
        prompt_config_id: b.prompt_config_id,
        chatbot_ids: b.chatbot_ids,
        model: b.model,
      });
      res.json({ ok: true, id });
    } catch (e) {
      return sendErr(res, e);
    }
  });

  app.post('/api/company-chat/tabs/:id/update', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await pickOrgId(pool, req);
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      await updateTab(pool, orgId, id, req.body || {});
      res.json({ ok: true });
    } catch (e) {
      return sendErr(res, e);
    }
  });

  app.delete('/api/company-chat/tabs/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await pickOrgId(pool, req);
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const deleted = await deleteTab(pool, orgId, id);
      res.json({ ok: true, deleted });
    } catch (e) {
      return sendErr(res, e);
    }
  });
}
