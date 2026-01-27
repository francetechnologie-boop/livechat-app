import { deleteModToolsConfig, loadModToolsConfigRow, upsertModToolsConfig } from '../utils/modToolsConfig.js';

const KEY_MYSQL_PROFILE = 'mysql_profile';
const KEY_TRANSLATION_PROMPT = 'translation_prompt';
const KEY_DEVIS_LANG_PROMPT = 'devis_language_prompt';

function pickOrgId(req) {
  try {
    const raw = req.body?.org_id ?? req.headers['x-org-id'] ?? req.query?.org_id;
    if (!raw && raw !== 0) return null;
    const trimmed = String(raw).trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function toOrgInt(value) {
  try {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  } catch {
    return null;
  }
}

function requireAdminGuard(ctx = {}) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

export function registerToolsSettingsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const logToFile = typeof ctx.logToFile === 'function' ? ctx.logToFile : () => {};
  const requireAdmin = requireAdminGuard(ctx);

  app.get('/api/tools/settings/mysql-profile', async (req, res) => {
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'db_unavailable', message: 'Database connection unavailable' });
    }
    const orgId = toOrgInt(pickOrgId(req));
    try {
      const row = await loadModToolsConfigRow(pool, KEY_MYSQL_PROFILE, orgId);
      const profileId = row?.value?.profile_id ?? null;
      return res.json({
        ok: true,
        profile_id: profileId,
        org_id: row?.org_id ?? null,
        updated_at: row?.updated_at ?? null,
      });
    } catch (error) {
      logToFile?.(`[tools] mysql profile status failed: ${error?.message || error}`);
      return res.status(500).json({ ok: false, error: 'mysql_profile_failed', message: 'Unable to read MySQL profile setting.' });
    }
  });

  app.post('/api/tools/settings/mysql-profile', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'db_unavailable', message: 'Database connection unavailable' });
    }
    const orgId = toOrgInt(pickOrgId(req));
    const profileIdValue = req.body?.profile_id;
    const profileId = profileIdValue === undefined || profileIdValue === null ? null : String(profileIdValue).trim() || null;
    try {
      if (profileId === null) {
        await deleteModToolsConfig(pool, KEY_MYSQL_PROFILE, orgId);
        logToFile?.(`tools_mysql_profile_delete`, { org_id: orgId ?? null });
        return res.json({ ok: true, profile_id: null, org_id: orgId ?? null });
      }
      await upsertModToolsConfig(pool, KEY_MYSQL_PROFILE, { profile_id: profileId }, orgId);
      logToFile?.(`tools_mysql_profile_set`, { org_id: orgId ?? null, profile_id: profileId });
      return res.json({ ok: true, profile_id: profileId, org_id: orgId ?? null });
    } catch (error) {
      logToFile?.(`[tools] mysql profile save failed: ${error?.message || error}`);
      return res.status(500).json({ ok: false, error: 'mysql_profile_failed', message: 'Unable to save MySQL profile setting.' });
    }
  });

  app.get('/api/tools/settings/translation-prompt', async (req, res) => {
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'db_unavailable', message: 'Database connection unavailable' });
    }
    const orgId = toOrgInt(pickOrgId(req));
    try {
      const row = await loadModToolsConfigRow(pool, KEY_TRANSLATION_PROMPT, orgId);
      const promptId = row?.value?.prompt_config_id ?? null;
      return res.json({
        ok: true,
        prompt_config_id: promptId,
        org_id: row?.org_id ?? null,
        updated_at: row?.updated_at ?? null,
      });
    } catch (error) {
      logToFile?.(`[tools] translation prompt load failed: ${error?.message || error}`);
      return res.status(500).json({ ok: false, error: 'translation_prompt_failed', message: 'Unable to load translation prompt setting.' });
    }
  });

  app.post('/api/tools/settings/translation-prompt', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'db_unavailable', message: 'Database connection unavailable' });
    }
    const orgId = toOrgInt(pickOrgId(req));
    const rawValue = req.body?.prompt_config_id;
    const promptConfigId = rawValue === undefined || rawValue === null ? null : String(rawValue).trim() || null;
    try {
      if (promptConfigId === null) {
        await deleteModToolsConfig(pool, KEY_TRANSLATION_PROMPT, orgId);
        logToFile?.(`tools_translation_prompt_delete`, { org_id: orgId ?? null });
        return res.json({ ok: true, prompt_config_id: null, org_id: orgId ?? null });
      }
      await upsertModToolsConfig(pool, KEY_TRANSLATION_PROMPT, { prompt_config_id: promptConfigId }, orgId);
      logToFile?.(`tools_translation_prompt_set`, { org_id: orgId ?? null, prompt_config_id: promptConfigId });
      return res.json({ ok: true, prompt_config_id: promptConfigId, org_id: orgId ?? null });
    } catch (error) {
      logToFile?.(`[tools] translation prompt save failed: ${error?.message || error}`);
      return res.status(500).json({ ok: false, error: 'translation_prompt_failed', message: 'Unable to save translation prompt setting.' });
    }
  });

  app.get('/api/tools/settings/devis-language-prompt', async (req, res) => {
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'db_unavailable', message: 'Database connection unavailable' });
    }
    const orgId = toOrgInt(pickOrgId(req));
    try {
      const row = await loadModToolsConfigRow(pool, KEY_DEVIS_LANG_PROMPT, orgId);
      const promptId = row?.value?.prompt_config_id ?? null;
      return res.json({
        ok: true,
        prompt_config_id: promptId,
        org_id: row?.org_id ?? null,
        updated_at: row?.updated_at ?? null,
      });
    } catch (error) {
      logToFile?.(`[tools] devis language prompt load failed: ${error?.message || error}`);
      return res
        .status(500)
        .json({ ok: false, error: 'devis_language_prompt_failed', message: 'Unable to load devis language prompt setting.' });
    }
  });

  app.post('/api/tools/settings/devis-language-prompt', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'db_unavailable', message: 'Database connection unavailable' });
    }
    const orgId = toOrgInt(pickOrgId(req));
    const rawValue = req.body?.prompt_config_id;
    const promptConfigId = rawValue === undefined || rawValue === null ? null : String(rawValue).trim() || null;
    try {
      if (promptConfigId === null) {
        await deleteModToolsConfig(pool, KEY_DEVIS_LANG_PROMPT, orgId);
        logToFile?.(`tools_devis_language_prompt_delete`, { org_id: orgId ?? null });
        return res.json({ ok: true, prompt_config_id: null, org_id: orgId ?? null });
      }
      await upsertModToolsConfig(pool, KEY_DEVIS_LANG_PROMPT, { prompt_config_id: promptConfigId }, orgId);
      logToFile?.(`tools_devis_language_prompt_set`, { org_id: orgId ?? null, prompt_config_id: promptConfigId });
      return res.json({ ok: true, prompt_config_id: promptConfigId, org_id: orgId ?? null });
    } catch (error) {
      logToFile?.(`[tools] devis language prompt save failed: ${error?.message || error}`);
      return res
        .status(500)
        .json({ ok: false, error: 'devis_language_prompt_failed', message: 'Unable to save devis language prompt setting.' });
    }
  });
}
