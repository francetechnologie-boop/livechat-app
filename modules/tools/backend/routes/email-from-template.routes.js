import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function pickOrgId(req) {
  try {
    const raw = req.headers['x-org-id'] || req.query?.org_id;
    if (!raw) return null;
    const trimmed = String(raw).trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function toOrgInt(orgId) {
  try {
    if (orgId === null || orgId === undefined) return null;
    const s = String(orgId).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function requireAdminGuard(ctx) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

function clampInt(value, { min = 0, max = 1_000_000, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeTemplateType(value) {
  const s = String(value || '').trim();
  return s || null;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id ?? null,
    org_id: row.org_id ?? null,
    template_type: row.template_type ?? null,
    id_shop: row.id_shop ?? 0,
    id_lang: row.id_lang ?? 0,
    subject: row.subject ?? '',
    html_body: row.html_body ?? '',
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function isMissingTableError(error) {
  try {
    const code = String(error?.code || '');
    if (code === '42P01') return true; // undefined_table
    const msg = String(error?.message || '');
    return /mod_tools_email_template/i.test(msg) && /does not exist|undefined_table/i.test(msg);
  } catch {
    return false;
  }
}

async function listTemplateTypes(pool, { orgId, idShop, idLang, qText, limit }) {
  const orgInt = toOrgInt(orgId);
  const shopProvided = idShop !== undefined && idShop !== null && String(idShop || '').trim() !== '';
  const langProvided = idLang !== undefined && idLang !== null && String(idLang || '').trim() !== '';
  const shop = shopProvided ? clampInt(idShop, { min: 0, max: 1_000_000, fallback: 0 }) : null;
  const lang = langProvided ? clampInt(idLang, { min: 0, max: 1_000_000, fallback: 0 }) : null;
  const lim = clampInt(limit, { min: 1, max: 500, fallback: 200 });
  const q = String(qText || '').trim();

  const args = [orgInt];
  const where = ['(($1::int IS NULL AND t.org_id IS NULL) OR (t.org_id = $1::int) OR (t.org_id IS NULL))'];

  if (shopProvided) {
    args.push(shop);
    where.push(`t.id_shop = $${args.length}`);
  }
  if (langProvided) {
    args.push(lang);
    where.push(`t.id_lang = $${args.length}`);
  }
  if (q) {
    args.push(`%${q}%`);
    where.push(`t.template_type ILIKE $${args.length}`);
  }

  const sql = `
    WITH ranked AS (
      SELECT
        t.template_type,
        t.subject,
        t.html_body,
        t.id_shop,
        t.id_lang,
        COUNT(*) OVER (PARTITION BY t.template_type) AS variants_count,
        ROW_NUMBER() OVER (
          PARTITION BY t.template_type
          ORDER BY
            CASE
              WHEN $1::int IS NOT NULL AND t.org_id = $1::int THEN 0
              WHEN t.org_id IS NULL THEN 1
              ELSE 2
            END,
            t.updated_at DESC NULLS LAST,
            t.created_at DESC NULLS LAST,
            t.id DESC
        ) AS rn
      FROM public.mod_tools_email_template t
      WHERE ${where.join(' AND ')}
    )
      SELECT template_type, subject, html_body, variants_count, id_shop, id_lang
      FROM ranked
     WHERE rn = 1
     ORDER BY template_type ASC
     LIMIT $${args.push(lim)}
  `;

  const r = await pool.query(sql, args);
  return (Array.isArray(r.rows) ? r.rows : []).map((row) => ({
    template_type: String(row?.template_type || '').trim(),
    subject: String(row?.subject || ''),
    has_html: !!String(row?.html_body || '').trim(),
    variants_count: Number(row?.variants_count || 0) || 0,
    id_shop: clampInt(row?.id_shop, { min: 0, max: 1_000_000, fallback: 0 }),
    id_lang: clampInt(row?.id_lang, { min: 0, max: 1_000_000, fallback: 0 }),
  })).filter((it) => it.template_type);
}

async function getRenderedTemplate(pool, { orgId, templateType, idShop, idLang }) {
  const orgInt = toOrgInt(orgId);
  const shop = clampInt(idShop, { min: 0, max: 1_000_000, fallback: 0 });
  const lang = clampInt(idLang, { min: 0, max: 1_000_000, fallback: 0 });
  const type = normalizeTemplateType(templateType);
  if (!type) return null;

  const args = [orgInt, shop, lang, type];
  const sql = `
    SELECT t.*
      FROM public.mod_tools_email_template t
     WHERE t.template_type = $4
       AND (($1::int IS NULL AND t.org_id IS NULL) OR (t.org_id = $1::int) OR (t.org_id IS NULL))
       AND (t.id_shop = $2 OR t.id_shop = 0)
       AND (t.id_lang = $3 OR t.id_lang = 0)
     ORDER BY
       CASE
         WHEN $1::int IS NOT NULL AND t.org_id = $1::int THEN 0
         WHEN t.org_id IS NULL THEN 1
         ELSE 2
       END,
       CASE WHEN t.id_shop = $2 THEN 0 WHEN t.id_shop = 0 THEN 1 ELSE 2 END,
       CASE WHEN t.id_lang = $3 THEN 0 WHEN t.id_lang = 0 THEN 1 ELSE 2 END,
       t.updated_at DESC NULLS LAST,
       t.created_at DESC NULLS LAST,
       t.id DESC
     LIMIT 1
  `;
  const r = await pool.query(sql, args);
  return mapRow(r.rows && r.rows[0] ? r.rows[0] : null);
}

async function upsertTemplate(pool, { orgId, templateType, idShop, idLang, subject, htmlBody }) {
  const orgInt = toOrgInt(orgId);
  const shop = clampInt(idShop, { min: 0, max: 1_000_000, fallback: 0 });
  const lang = clampInt(idLang, { min: 0, max: 1_000_000, fallback: 0 });
  const type = normalizeTemplateType(templateType);
  if (!type) return null;

  const subj = String(subject || '').trim();
  const html = String(htmlBody || '');

  const sql = orgInt === null
    ? `
        INSERT INTO public.mod_tools_email_template (
          org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
        )
        VALUES (NULL, $1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (template_type, id_shop, id_lang) WHERE org_id IS NULL
        DO UPDATE SET
          subject = EXCLUDED.subject,
          html_body = EXCLUDED.html_body,
          updated_at = NOW()
        RETURNING *
      `
    : `
        INSERT INTO public.mod_tools_email_template (
          org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
        )
        VALUES ($1::int, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (org_id, template_type, id_shop, id_lang) WHERE org_id IS NOT NULL
        DO UPDATE SET
          subject = EXCLUDED.subject,
          html_body = EXCLUDED.html_body,
          updated_at = NOW()
        RETURNING *
      `;

  const params = orgInt === null
    ? [type, shop, lang, subj, html]
    : [orgInt, type, shop, lang, subj, html];

  const r = await pool.query(sql, params);
  return mapRow(r.rows && r.rows[0] ? r.rows[0] : null);
}

async function deleteTemplate(pool, { orgId, templateType, idShop, idLang }) {
  const orgInt = toOrgInt(orgId);
  const shop = clampInt(idShop, { min: 0, max: 1_000_000, fallback: 0 });
  const lang = clampInt(idLang, { min: 0, max: 1_000_000, fallback: 0 });
  const type = normalizeTemplateType(templateType);
  if (!type) return 0;

  const args = orgInt === null
    ? [type, shop, lang]
    : [orgInt, type, shop, lang];
  const sql = orgInt === null
    ? `
        DELETE FROM public.mod_tools_email_template
         WHERE template_type = $1
           AND id_shop = $2
           AND id_lang = $3
           AND org_id IS NULL
    `
    : `
        DELETE FROM public.mod_tools_email_template
         WHERE org_id = $1::int
           AND template_type = $2
           AND id_shop = $3
           AND id_lang = $4
    `;

  const r = await pool.query(sql, args);
  return r.rowCount || 0;
}

async function upsertTemplateWithClient(client, { orgId, templateType, idShop, idLang, subject, htmlBody }) {
  const orgInt = toOrgInt(orgId);
  const shop = clampInt(idShop, { min: 0, max: 1_000_000, fallback: 0 });
  const lang = clampInt(idLang, { min: 0, max: 1_000_000, fallback: 0 });
  const type = normalizeTemplateType(templateType);
  if (!client || !type) return null;

  const subj = String(subject || '').trim();
  const html = String(htmlBody || '');

  const sql = orgInt === null
    ? `
        INSERT INTO public.mod_tools_email_template (
          org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
        )
        VALUES (NULL, $1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (template_type, id_shop, id_lang) WHERE org_id IS NULL
        DO UPDATE SET
          subject = EXCLUDED.subject,
          html_body = EXCLUDED.html_body,
          updated_at = NOW()
        RETURNING *
      `
    : `
        INSERT INTO public.mod_tools_email_template (
          org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
        )
        VALUES ($1::int, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT (org_id, template_type, id_shop, id_lang) WHERE org_id IS NOT NULL
        DO UPDATE SET
          subject = EXCLUDED.subject,
          html_body = EXCLUDED.html_body,
          updated_at = NOW()
        RETURNING *
      `;

  const params = orgInt === null
    ? [type, shop, lang, subj, html]
    : [orgInt, type, shop, lang, subj, html];

  const r = await client.query(sql, params);
  return mapRow(r.rows && r.rows[0] ? r.rows[0] : null);
}

export function registerToolsEmailFromTemplateRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const defaultChatLogPath = path.resolve(__dirname, '../../../../backend/chat.log');
  const chatLog = typeof ctx.chatLog === 'function'
    ? ctx.chatLog
    : ((event, payload) => {
        try {
          const line = JSON.stringify({ event, payload, ts: new Date().toISOString() });
          fs.appendFile(defaultChatLogPath, line + '\n', () => {});
        } catch {}
      });
  const requireAdmin = requireAdminGuard(ctx);

  app.get('/api/tools/email-from-template/__ping', (_req, res) => res.json({ ok: true, module: 'tools', route: 'email-from-template' }));

  app.get('/api/tools/email-from-template/types', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const orgId = pickOrgId(req);
    const idShop = req.query?.id_shop;
    const idLang = req.query?.id_lang;
    const qText = req.query?.q;
    const limit = req.query?.limit;
    try {
      const items = await listTemplateTypes(pool, { orgId, idShop, idLang, qText, limit });
      chatLog('tools_email_from_template_types', { org_id: orgId || null, count: items.length });
      return res.json({ ok: true, items });
    } catch (error) {
      if (isMissingTableError(error)) {
        return res.status(503).json({
          ok: false,
          error: 'missing_table',
          message: 'Table mod_tools_email_template is missing. Apply Tools module migration 20260405_unify_email_templates.sql.',
        });
      }
      return res.status(500).json({ ok: false, error: 'list_failed', message: error?.message || String(error) });
    }
  });

  app.get('/api/tools/email-from-template/render', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const templateType = req.query?.template_type;
    const idShop = req.query?.id_shop;
    const idLang = req.query?.id_lang;
    const orgId = pickOrgId(req);
    const type = normalizeTemplateType(templateType);
    if (!type) return res.status(400).json({ ok: false, error: 'missing_template_type' });
    try {
      const item = await getRenderedTemplate(pool, { orgId, templateType: type, idShop, idLang });
      if (!item) return res.status(404).json({ ok: false, error: 'not_found' });
      chatLog('tools_email_from_template_render', { org_id: orgId || null, template_type: type, id_shop: item.id_shop, id_lang: item.id_lang });
      return res.json({ ok: true, item });
    } catch (error) {
      if (isMissingTableError(error)) {
        return res.status(503).json({
          ok: false,
          error: 'missing_table',
          message: 'Table mod_tools_email_template is missing. Apply Tools module migration 20260405_unify_email_templates.sql.',
        });
      }
      return res.status(500).json({ ok: false, error: 'render_failed', message: error?.message || String(error) });
    }
  });

  app.post('/api/tools/email-from-template/template', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const body = req.body || {};
    const orgId = body.org_id !== undefined ? body.org_id : pickOrgId(req);
    const templateType = body.template_type ?? body.templateType;
    const idShop = body.id_shop ?? body.idShop ?? 0;
    const idLang = body.id_lang ?? body.idLang ?? 0;
    const subject = body.subject ?? '';
    const htmlBody = body.html_body ?? body.htmlBody ?? body.html ?? '';
    const type = normalizeTemplateType(templateType);
    if (!type) return res.status(400).json({ ok: false, error: 'missing_template_type' });
    try {
      const item = await upsertTemplate(pool, { orgId, templateType: type, idShop, idLang, subject, htmlBody });
      if (!item) return res.status(500).json({ ok: false, error: 'upsert_failed' });
      chatLog('tools_email_from_template_upsert', { org_id: orgId || null, template_type: type, id_shop: item.id_shop, id_lang: item.id_lang });
      return res.json({ ok: true, item });
    } catch (error) {
      if (isMissingTableError(error)) {
        return res.status(503).json({
          ok: false,
          error: 'missing_table',
          message: 'Table mod_tools_email_template is missing. Apply Tools module migration 20260405_unify_email_templates.sql.',
        });
      }
      return res.status(500).json({ ok: false, error: 'upsert_failed', message: error?.message || String(error) });
    }
  });

  app.delete('/api/tools/email-from-template/template', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const body = req.body || {};
    const orgId = body.org_id !== undefined ? body.org_id : pickOrgId(req);
    const templateType = body.template_type ?? body.templateType;
    const idShop = body.id_shop ?? body.idShop ?? null;
    const idLang = body.id_lang ?? body.idLang ?? null;
    const type = normalizeTemplateType(templateType);
    if (!type) return res.status(400).json({ ok: false, error: 'missing_template_type' });
    try {
      const deleted = await deleteTemplate(pool, { orgId, templateType: type, idShop, idLang });
      chatLog('tools_email_from_template_delete', { org_id: orgId || null, template_type: type, id_shop: idShop, id_lang: idLang, deleted });
      return res.json({ ok: true, deleted });
    } catch (error) {
      if (isMissingTableError(error)) {
        return res.status(503).json({
          ok: false,
          error: 'missing_table',
          message: 'Table mod_tools_email_template is missing. Apply Tools module migration 20260405_unify_email_templates.sql.',
        });
      }
      return res.status(500).json({ ok: false, error: 'delete_failed', message: error?.message || String(error) });
    }
  });

  // Deprecated: templates are stored in Postgres (mod_tools_email_template).
  // MySQL profiles are used only to list shops/languages, not as a template source.
  app.post('/api/tools/email-from-template/sync-mysql', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    return res.status(410).json({
      ok: false,
      error: 'deprecated',
      message: 'Deprecated: templates are stored in Postgres only (mod_tools_email_template).',
    });
  });
}
