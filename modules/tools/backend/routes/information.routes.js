import { deleteModToolsConfig, loadModToolsConfigRow, upsertModToolsConfig } from '../utils/modToolsConfig.js';

const KEY_INFO_MY_TEXT = 'information_my_text';
const KEY_INFO_MAILCOW = 'information_mailcow';
const MAX_TEXT_CHARS = 1000000;

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

async function readConfig(pool, key, orgId) {
  return loadModToolsConfigRow(pool, key, orgId);
}

async function writeConfig(pool, orgId, key, value) {
  await upsertModToolsConfig(pool, key, value, orgId);
}

async function deleteConfig(pool, orgId, key) {
  await deleteModToolsConfig(pool, key, orgId);
}

function clampText(value) {
  const text = value === undefined || value === null ? null : String(value);
  if (text === null) return null;
  if (text.length > MAX_TEXT_CHARS) {
    const err = new Error(`Text too large (>${MAX_TEXT_CHARS} chars)`);
    err.code = 'text_too_large';
    throw err;
  }
  return text;
}

export function registerToolsInformationRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const logToFile = typeof ctx.logToFile === 'function' ? ctx.logToFile : () => {};
  const requireAdmin = requireAdminGuard(ctx);
  const isDbUnavailable = (e) => {
    const msg = e?.message || String(e);
    return msg === 'db_unavailable' || msg === 'db_schema_unavailable';
  };

  app.get('/api/tools/information/__ping', (_req, res) => res.json({ ok: true, module: 'tools', feature: 'information' }));

  app.get('/api/tools/information/settings', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'db_unavailable', message: 'Database connection unavailable' });
    }
    const orgId = toOrgInt(pickOrgId(req));
    try {
      const [row1, row2] = await Promise.all([
        readConfig(pool, KEY_INFO_MY_TEXT, orgId),
        readConfig(pool, KEY_INFO_MAILCOW, orgId),
      ]);

      return res.json({
        ok: true,
        org_id: orgId ?? null,
        settings: {
          my_text_content: row1?.value?.content ?? '',
          mailcow_content: row2?.value?.content ?? '',
        },
        meta: {
          my_text_updated_at: row1?.updated_at ?? null,
          mailcow_updated_at: row2?.updated_at ?? null,
        },
      });
    } catch (error) {
      logToFile?.(`[tools] information settings load failed: ${error?.message || error}`);
      if (isDbUnavailable(error)) return res.status(503).json({ ok:false, error:'db_unavailable' });
      return res.status(500).json({ ok: false, error: 'information_settings_failed', message: 'Unable to load information settings.' });
    }
  });

  app.post('/api/tools/information/settings', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'db_unavailable', message: 'Database connection unavailable' });
    }
    const orgId = toOrgInt(pickOrgId(req));

    const hasMyText = Object.prototype.hasOwnProperty.call(req.body || {}, 'my_text_content');
    const hasMailcow = Object.prototype.hasOwnProperty.call(req.body || {}, 'mailcow_content');

    try {
      if (hasMyText) {
        const text = clampText(req.body?.my_text_content);
        if (text === null) await deleteConfig(pool, orgId, KEY_INFO_MY_TEXT);
        else await writeConfig(pool, orgId, KEY_INFO_MY_TEXT, { content: text });
      }
      if (hasMailcow) {
        const text = clampText(req.body?.mailcow_content);
        if (text === null) await deleteConfig(pool, orgId, KEY_INFO_MAILCOW);
        else await writeConfig(pool, orgId, KEY_INFO_MAILCOW, { content: text });
      }

      const [row1, row2] = await Promise.all([
        readConfig(pool, KEY_INFO_MY_TEXT, orgId),
        readConfig(pool, KEY_INFO_MAILCOW, orgId),
      ]);

      return res.json({
        ok: true,
        org_id: orgId ?? null,
        settings: {
          my_text_content: row1?.value?.content ?? '',
          mailcow_content: row2?.value?.content ?? '',
        },
        meta: {
          my_text_updated_at: row1?.updated_at ?? null,
          mailcow_updated_at: row2?.updated_at ?? null,
        },
      });
    } catch (error) {
      const code = String(error?.code || '').trim();
      if (code === 'text_too_large') {
        return res.status(413).json({ ok: false, error: 'text_too_large', message: error?.message || 'Text too large.' });
      }
      logToFile?.(`[tools] information settings save failed: ${error?.message || error}`);
      if (isDbUnavailable(error)) return res.status(503).json({ ok:false, error:'db_unavailable' });
      return res.status(500).json({ ok: false, error: 'information_settings_failed', message: 'Unable to save information settings.' });
    }
  });
}
