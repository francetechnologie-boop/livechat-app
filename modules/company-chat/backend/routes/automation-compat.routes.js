import { getPromptConfig, listChatbots, listPromptConfigs, pickOrgId } from '../services/companyChatDb.js';

function redactSecret(v) {
  try { return String(v || '').trim() ? '__set__' : ''; } catch { return ''; }
}

export function registerCompanyChatAutomationCompatRoutes(app, ctx = {}) {
  const pool = ctx.pool;

  app.get('/api/company-chat/chatbots', async (req, res) => {
    try {
      const orgId = await pickOrgId(pool, req);
      const rows = await listChatbots(pool, orgId);
      const items = (rows || []).map((r) => ({
        id_bot: String(r.id_bot),
        name: r.name || null,
        shop_name: r.shop_name || null,
        lang_iso: r.lang_iso || null,
        enabled: r.enabled !== false,
        model: r.model || null,
        prompt_config_id: r.prompt_config_id || null,
        local_prompt_id: r.local_prompt_id || null,
        has_api_key: r.has_api_key === true || r.has_api_key === 1,
      }));
      res.json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/company-chat/prompt-configs', async (req, res) => {
    try {
      const orgId = await pickOrgId(pool, req);
      const limit = Number(req.query?.limit || 200) || 200;
      const rows = await listPromptConfigs(pool, orgId, { limit });
      const items = (rows || []).map((r) => ({
        id: String(r.id),
        name: r.name || null,
        model: r.model || null,
        updated_at: r.updated_at || null,
        has_api_key: r.has_api_key === true || r.has_api_key === 1,
      }));
      res.json({ ok: true, items });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/company-chat/prompt-configs/:id', async (req, res) => {
    try {
      const orgId = await pickOrgId(pool, req);
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const raw = await getPromptConfig(pool, orgId, id);
      const item = raw
        ? {
            id: String(raw.id),
            org_id: raw.org_id ?? null,
            name: raw.name || null,
            model: raw.model || null,
            tools: raw.tools ?? null,
            vector_store_id: raw.vector_store_id || null,
            vector_store_ids: raw.vector_store_ids || null,
            prompt_id: raw.prompt_id || null,
            prompt_version: raw.prompt_version || null,
            has_api_key: !!(raw.openai_api_key && String(raw.openai_api_key).trim()),
            openai_api_key: redactSecret(raw.openai_api_key),
          }
        : null;
      if (!item) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, item });
    } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
  });
}
