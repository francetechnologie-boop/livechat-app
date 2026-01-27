import { getConfigValue, pickOrgId, setConfigValue } from '../services/companyChatDb.js';

function requireAdminGuard(ctx) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

function redactSecret(v) {
  try {
    const s = String(v || '');
    return s ? '__set__' : '';
  } catch { return ''; }
}

export function registerCompanyChatConfigRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);

  app.get('/api/company-chat/config', async (req, res) => {
    try {
      const orgId = await pickOrgId(pool, req);
      const approval = await getConfigValue(pool, orgId, 'approval', 'never');
      const chatbotIds = await getConfigValue(pool, orgId, 'chatbot_ids', []);
      const promptCfgId = await getConfigValue(pool, orgId, 'prompt_config_id', '');
      const prestaBase = await getConfigValue(pool, orgId, 'prestashop.base', '');
      const prestaKey = await getConfigValue(pool, orgId, 'prestashop.api_key', '');

      res.json({
        ok: true,
        model: '',
        prompt_id: '',
        prompt_version: '',
        api_key: '',
        approval: typeof approval === 'string' ? approval : 'never',
        chatbot_ids: Array.isArray(chatbotIds) ? chatbotIds.map(String) : [],
        prompt_cfg_id: typeof promptCfgId === 'string' ? promptCfgId : '',
        prestashop: { base: typeof prestaBase === 'string' ? prestaBase : '', api_key: redactSecret(prestaKey) },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/company-chat/config', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = await pickOrgId(pool, req);
      const b = req.body || {};
      if (Object.prototype.hasOwnProperty.call(b, 'approval')) {
        const v = String(b.approval || '').toLowerCase();
        const norm = (v === 'never' || v === 'always' || v === 'auto') ? v : 'never';
        await setConfigValue(pool, orgId, 'approval', norm);
      }
      if (Object.prototype.hasOwnProperty.call(b, 'chatbot_ids')) {
        const ids = Array.isArray(b.chatbot_ids) ? b.chatbot_ids.map(String) : [];
        await setConfigValue(pool, orgId, 'chatbot_ids', ids);
      }
      if (Object.prototype.hasOwnProperty.call(b, 'prompt_cfg_id')) {
        const id = String(b.prompt_cfg_id || '').trim();
        await setConfigValue(pool, orgId, 'prompt_config_id', id);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
}
