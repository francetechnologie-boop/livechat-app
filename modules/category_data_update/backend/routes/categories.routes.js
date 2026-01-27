import { createRequire } from 'module';
import path from 'path';

// Hard caps aligned with typical PrestaShop limits for ps_category_lang
const NAME_MAX = 128;
const LINK_REWRITE_MAX = 128;
const META_TITLE_MAX = 255;
const META_DESCRIPTION_MAX = 512;

function pickOrgId(req) {
  try {
    return (req.headers['x-org-id'] || req.query?.org_id || null)
      ? String(req.headers['x-org-id'] || req.query.org_id)
      : null;
  } catch (e) {
    return null;
  }
}
function normalizeConn(raw = {}) {
  const host = String(raw.host || '').trim();
  const port = Number(raw.port || 3306);
  const database = String(raw.database || '').trim();
  const user = String(raw.user || raw.db_user || '').trim();
  const password = raw.password != null ? String(raw.password) : String(raw.db_password || '');
  const ssl = !!raw.ssl;
  return { host, port, database, user, password, ssl };
}
async function getMysql2(ctx) {
  try {
    const mod = await import('mysql2/promise');
    return mod && (mod.default || mod);
  } catch (e) {}
  try {
    const backendDir = (ctx && ctx.backendDir) || path.resolve(process.cwd(), 'backend');
    const req = createRequire(path.join(backendDir, 'package.json'));
    const mod = req('mysql2/promise');
    return mod && (mod.default || mod);
  } catch (e) {}
  const err = new Error('mysql2_missing');
  err.code = 'MYSQL2_MISSING';
  throw err;
}
function slugify(str) {
  try {
    const s = String(str || '').toLowerCase();
    return s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 128);
  } catch (e) {
    return '';
  }
}
function normalizeIso(code) {
  try {
    const c = String(code || '').toLowerCase();
    // Keep PrestaShop ISO codes as-is except for legacy aliases
    // Do NOT map 'gb'/'uk' to 'en' to respect DB-configured language codes
    const map = { cz: 'cs', gr: 'el', iw: 'he', in: 'id' };
    return map[c] || c;
  } catch (e) {
    return code || null;
  }
}

export function registerCategoryDataUpdateCategoriesRoutes(app, ctx = {}, utils = {}) {
  const chatLog = utils.chatLog || (() => {});
  const requireAdmin =
    ctx.requireAdmin ||
    ((_req, res) => {
      res.status(403).end();
      return false;
    });

  // Utility: parse ids from any input
  function parseIds(val) {
    if (Array.isArray(val)) {
      return val
        .map(v => Number(v))
        .filter(v => Number.isFinite(v) && v > 0);
    }
    if (typeof val === 'string') {
      return val
        .split(',')
        .map(s => Number(s.trim()))
        .filter(v => Number.isFinite(v) && v > 0);
    }
    return [];
  }

  // Simple healthcheck / is-enabled endpoint
  app.get('/api/category_data_update/status', (req, res) => {
    const poolOk = !!(ctx && ctx.utils && ctx.utils.pool);
    return res.json({
      ok: true,
      mysql_pool: poolOk ? 'ready' : 'missing',
      mysql2_required: true
    });
  });

  // Fill missing category fields within the same language (no cross-language copy)
  app.post('/api/category_data_update/categories/fill-missing', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const profileId = Number(b.profile_id || 0) || null;
    const prefix = String(b.prefix || '').trim();
    const fields = Array.isArray(b.fields) ? b.fields : [];
    const scope = b.scope && typeof b.scope === 'object' ? b.scope : {};
    const idShop = Number(scope.id_shop || 0) || null;
    const idLang = Number(b.id_lang || scope.id_lang || 0) || null;
    // Always use prompt when a prompt_config_id is provided; otherwise fall back to deterministic same-language fill
    const usePrompt = !!b.prompt_config_id;
    const categories = parseIds(scope.category_ids || b.category_ids);

    if (!profileId || !prefix || !idShop || !idLang || !categories.length) {
      return res.status(400).json({ ok: false, error: 'bad_request' });
    }

    try {
      chatLog('fill_missing_request', {
        profileId,
        prefix,
        idShop,
        idLang,
        categories,
        fields
      });
    } catch (e) {}

    const pool = utils.pool;
    if (!pool || typeof pool.query !== 'function') {
      return res
        .status(500)
        .json({ ok: false, error: 'server_error', message: 'db_pool_missing' });
    }

    const orgId =
      b.org_id != null ? String(b.org_id).trim() || null : pickOrgId(req);
    const args = [profileId];
    const whereOrg = orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '';
    if (orgId) args.push(orgId);

    try {
      const pr = await pool.query(
        `SELECT host, port, "database", db_user AS user, db_password AS password, ssl
           FROM mod_db_mysql_profiles
          WHERE id=$1${whereOrg}
          LIMIT 1`,
        args
      );
      if (!pr || !pr.rowCount) {
        return res
          .status(404)
          .json({ ok: false, error: 'profile_not_found' });
      }

      const cfg = normalizeConn(pr.rows[0]);

      const mysql = await getMysql2(ctx);
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      let conn;
      try {
        conn = await mysql.createConnection({
          host: cfg.host,
          port: cfg.port,
          user: cfg.user,
          password: cfg.password,
          database: cfg.database,
          ssl
        });

        const tblCL = `${prefix}category_lang`;
        const tblLang = `${prefix}lang`;

        // Resolve ISO for the selected language (for prompt payloads)
        let isoCode = null;
        try {
          const [rf] = await conn.query(
            `SELECT iso_code FROM \`${tblLang}\` WHERE id_lang = ? LIMIT 1`,
            [idLang]
          );
          isoCode = (Array.isArray(rf) && rf[0] && rf[0].iso_code) ? String(rf[0].iso_code).toLowerCase() : null;
        } catch (e) {}

        // Load rows for the selected language
        const placeholders = categories.map(() => '?').join(',');
        const [destRows] = await conn.query(
          `SELECT id_category, id_lang, id_shop, name, description, meta_title, meta_description, link_rewrite
             FROM \`${tblCL}\`
            WHERE id_category IN (${placeholders}) AND id_lang=? AND id_shop=?`,
          [...categories, idLang, idShop]
        );
        const destByCat = new Map();
        for (const r of Array.isArray(destRows) ? destRows : []) {
          destByCat.set(Number(r.id_category), r);
        }

        const out = [];
        let updated = 0;

        // Minimal helpers to extract fields from prompt responses
        function parseMaybeJson(val) {
          try { if (val == null) return null; if (typeof val === 'string') { const s = val.trim(); if (s.startsWith('{') || s.startsWith('[')) { try { return JSON.parse(s); } catch { return s; } } return s; } return val; } catch { return val; }
        }
        function coerceText(v) {
          try { if (v == null) return ''; const parsed = parseMaybeJson(v); if (parsed == null) return ''; if (typeof parsed === 'string') return parsed; if (Array.isArray(parsed)) return parsed.map(x=>typeof x==='string'?x:'').filter(Boolean).join(' ').trim(); if (typeof parsed === 'object') { for (const k of ['text','value','content']) { if (parsed[k]!=null) { const t = coerceText(parsed[k]); if (t) return t; } } const s = JSON.stringify(parsed); return (s==='{}'||s==='[]') ? '' : s; } return String(parsed); } catch { return ''; }
        }
        function firstObjectCandidate(resp) {
          const cands = [resp?.text, resp?.fields, resp?.result, resp?.output, resp?.data, resp];
          for (let c of cands) { if (typeof c === 'string') c = parseMaybeJson(c); if (c && typeof c === 'object' && !Array.isArray(c)) return c; }
          return null;
        }

        async function callPrompt(inputObject, timeoutMs) {
          const promptId = b.prompt_config_id ? String(b.prompt_config_id) : null;
          if (!promptId) return null;
          const base = String(process.env.INTERNAL_SERVER_URL || '').trim() || `http://127.0.0.1:${Number(process.env.PORT || process.env.APP_PORT || 3010)}`;
          const url = `${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`;
          const payload = { input: JSON.stringify(inputObject) };
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), Number(timeoutMs || process.env.PROMPT_TIMEOUT_MS || 90000));
          try {
            const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.message || `prompt_http_${r.status}`);
            return j;
          } finally { clearTimeout(t); }
        }

        for (const id of categories) {
          const dst = destByCat.get(Number(id)) || null;
          if (!dst) {
            out.push({
              id_category: id,
              updated: false,
              status: 'missing_row'
            });
            continue;
          }

          try {
            if (b?.run_id) {
              utils?.sseEmit?.(String(b.run_id), 'category_start', {
                id_category: id,
                id_lang: idLang,
                id_shop: idShop
              });
            }
          } catch (e) {}

          // Derive values within same language when missing
          const patch = {};
          const get = (v) => (v == null ? '' : String(v));
          const strip = (s) => get(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          if (usePrompt) {
            try {
              if (b?.run_id) {
                utils?.sseEmit?.(String(b.run_id), 'prompt_request', {
                  id_category: id,
                  id_lang: idLang,
                  id_shop: idShop,
                  input_len: 0
                });
              }
            } catch (e) {}

            const limits = {
              meta_title: Number(process.env.CATEGORY_META_TITLE_LIMIT || 70),
              meta_description_min: Number(process.env.CATEGORY_META_DESCRIPTION_MIN || 150),
              meta_description_max: Number(process.env.CATEGORY_META_DESCRIPTION_MAX || 160)
            };
            const reqObj = {
              from_lang_id: idLang,
              from_iso: normalizeIso(isoCode) || null,
              to_lang_id: idLang,
              to_iso: normalizeIso(isoCode) || null,
              fields,
              limits,
              source: {
                name: dst.name || '',
                description: dst.description || '',
                meta_title: dst.meta_title || '',
                meta_description: dst.meta_description || '',
                link_rewrite: dst.link_rewrite || ''
              },
              glossary: null,
              category: { id, shop_id_from: idShop },
              site: (b?.source_site || b?.scope?.source_site || '') || null,
              mode: 'fill-missing'
            };
            let resp;
            try {
              const t0 = Date.now();
              resp = await callPrompt(reqObj, b?.prompt_timeout_ms);
              const t1 = Date.now();
              try { if (b?.run_id) utils?.sseEmit?.(String(b.run_id), 'prompt_received', { id_category: id, id_lang: idLang, id_shop: idShop, ms: Math.max(0, t1 - t0) }); } catch (e) {}
            } catch (e) {
              // On prompt error, fall back to deterministic fill
              resp = null;
            }
            try { if (b?.run_id && resp) utils?.sseEmit?.(String(b.run_id), 'prompt_output', { id_category: id, id_lang: idLang, id_shop: idShop }); } catch (e) {}

            const obj = firstObjectCandidate(resp) || {};
            const pick = (k) => coerceText(obj[k]);
            const gen = {
              name: coerceText(obj.name),
              meta_title: coerceText(obj.meta_title) || coerceText(obj.title) || '',
              meta_description: coerceText(obj.meta_description) || coerceText(obj.description) || '',
              description: coerceText(obj.description) || '',
              link_rewrite: coerceText(obj.link_rewrite) || ''
            };
            for (const f of fields) {
              if (!Object.prototype.hasOwnProperty.call(dst, f)) continue;
              const vDst = strip(dst[f]);
              if (vDst) continue;
              if (gen[f]) {
                if (f === 'meta_title') patch.meta_title = gen.meta_title.slice(0, META_TITLE_MAX);
                else if (f === 'meta_description') patch.meta_description = gen.meta_description.slice(0, META_DESCRIPTION_MAX);
                else if (f === 'link_rewrite') patch.link_rewrite = slugify(gen.link_rewrite || gen.name || gen.meta_title || '').slice(0, LINK_REWRITE_MAX);
                else if (f === 'description') patch.description = gen.description;
              }
            }
          } else {
            for (const f of fields) {
              if (!Object.prototype.hasOwnProperty.call(dst, f)) continue;
              const vDst = strip(dst[f]);
              if (vDst) continue; // already has content
              if (f === 'meta_title') {
                const base = strip(dst.name) || strip(dst.description);
                patch.meta_title = (base || '').slice(0, META_TITLE_MAX);
              } else if (f === 'meta_description') {
                const base = strip(dst.description) || strip(dst.meta_title) || strip(dst.name);
                patch.meta_description = (base || '').slice(0, META_DESCRIPTION_MAX);
              } else if (f === 'link_rewrite') {
                const slug = slugify(strip(dst.name) || strip(dst.meta_title) || '');
                patch.link_rewrite = (slug || '').slice(0, LINK_REWRITE_MAX);
              } else if (f === 'description') {
                const base = strip(dst.description) || strip(dst.meta_description);
                if (base) patch.description = base;
              }
            }
          }

          const cols = Object.keys(patch);
          if (!cols.length) {
            out.push({
              id_category: id,
              updated: false,
              status: 'nothing_to_fill'
            });
            try {
              if (b?.run_id) {
                utils?.sseEmit?.(String(b.run_id), 'db_update_done', {
                  id_category: id,
                  id_lang: idLang,
                  id_shop: idShop,
                  updated: false,
                  fields: []
                });
              }
            } catch (e) {}
            continue;
          }

          const sets = cols.map(c => `\`${c}\` = ?`).join(', ');
          const vals = cols.map(c => patch[c]);

          try {
            if (b?.dry_run) {
              out.push({ id_category: id, updated: false, status: 'ok', fields: cols });
              try { if (b?.run_id) utils?.sseEmit?.(String(b.run_id), 'db_update_done', { id_category: id, id_lang: idLang, id_shop: idShop, updated: false, fields: cols }); } catch (e) {}
              continue;
            }
            try {
              if (b?.run_id) {
                utils?.sseEmit?.(String(b.run_id), 'db_update_start', {
                  id_category: id,
                  id_lang: idLang,
                  id_shop: idShop,
                  fields: cols
                });
              }
            } catch (e) {}
            const [r] = await conn.query(
              `UPDATE \`${tblCL}\` SET ${sets} WHERE id_category=? AND id_lang=? AND id_shop=?`,
              [...vals, id, idLang, idShop]
            );
            const ok =
              r && typeof r.affectedRows === 'number'
                ? r.affectedRows > 0
                : true;
            if (!ok) throw new Error('no_row_updated');
            updated += 1;
            out.push({
              id_category: id,
              updated: true,
              status: 'updated',
              fields: cols
            });
            try {
              if (b?.run_id) {
                utils?.sseEmit?.(String(b.run_id), 'db_update_done', {
                  id_category: id,
                  id_lang: idLang,
                  id_shop: idShop,
                  updated: true,
                  fields: cols
                });
              }
            } catch (e) {}
          } catch (e) {
            out.push({
              id_category: id,
              updated: false,
              status: 'error',
              message: e?.message || String(e)
            });
            try {
              if (b?.run_id) {
                utils?.sseEmit?.(String(b.run_id), 'db_update_error', {
                  id_category: id,
                  id_lang: idLang,
                  id_shop: idShop,
                  message: e?.message || String(e),
                  fields: cols
                });
              }
            } catch (e2) {}
          }
        }

        return res.json({
          ok: true,
          updated,
          total: categories.length,
          items: out
        });
      } finally {
        try {
          if (conn) await conn.end();
        } catch (e) {}
      }
    } catch (e) {
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') {
        return res.status(500).json({
          ok: false,
          error: 'mysql2_missing',
          message:
            'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev'
        });
      }
      try {
        chatLog('fill_missing_error', {
          error: e?.message || String(e)
        });
      } catch (e2) {}
      return res.status(500).json({
        ok: false,
        error: 'server_error',
        message: e?.message || String(e)
      });
    }
  });

  // Translate category fields for one or more target languages
  app.post('/api/category_data_update/categories/translate', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const b = req.body || {};
    const profileId = Number(b.profile_id || 0) || null;
    const prefix = String(b.prefix || '').trim();
    const fields = Array.isArray(b.fields) ? b.fields : [];
    const promptFields = fields.filter(f => String(f) !== 'link_rewrite');
    const promptId = b.prompt_config_id != null ? String(b.prompt_config_id) : null;
    const scope = b.scope && typeof b.scope === 'object' ? b.scope : {};
    const idShopTo = Number(scope.id_shop || 0) || null;
    const idShopFrom = Number(scope.id_shop_from || 0) || null;
    const idLangFrom = Number(b.lang_from || scope.lang_from_id || 0) || null;
    const idLangTo = Number(b.lang_to || scope.lang_to_id || scope.id_lang || 0) || null;

    let toLangs = Array.isArray(b.lang_to_ids)
      ? b.lang_to_ids.map(x => Number(x)).filter(Number.isFinite)
      : [];
    if (!toLangs.length && idLangTo) toLangs = [idLangTo];
    toLangs = Array.from(new Set(toLangs))
      .filter(n => n > 0)
      .sort((a, b) => a - b);

    const list = Array.isArray(scope.category_ids)
      ? scope.category_ids
      : String(scope.category_ids || '').split(',');
    const ids = list
      .map(s => Number(String(s).trim()))
      .filter(n => Number.isFinite(n) && n > 0);

    const dryRun = !!b.dry_run;
    const wantTrace = !!b.trace;

    if (!profileId || !prefix || !idShopTo || !toLangs.length || !ids.length) {
      return res.status(400).json({ ok: false, error: 'bad_request' });
    }

    try {
      chatLog('cat_translate_request', {
        profileId,
        prefix,
        ids,
        id_shop_from: idShopFrom,
        id_shop: idShopTo,
        lang_from: idLangFrom,
        lang_to_ids: toLangs,
        prompt: promptId || null,
        dry_run: dryRun
      });
    } catch (e) {}

    const pool = utils.pool;
    if (!pool || typeof pool.query !== 'function') {
      return res
        .status(500)
        .json({ ok: false, error: 'server_error', message: 'db_pool_missing' });
    }

    const orgId =
      b.org_id != null ? String(b.org_id).trim() || null : pickOrgId(req);
    const args = [profileId];
    const whereOrg = orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '';
    if (orgId) args.push(orgId);

    let conn;
    try {
      const pr = await pool.query(
        `SELECT host, port, "database", db_user AS user, db_password AS password, ssl
           FROM mod_db_mysql_profiles
          WHERE id=$1${whereOrg}
          LIMIT 1`,
        args
      );
      if (!pr || !pr.rowCount) {
        return res
          .status(404)
          .json({ ok: false, error: 'profile_not_found' });
      }

      const cfg = normalizeConn(pr.rows[0]);

      const mysql = await getMysql2(ctx);
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      conn = await mysql.createConnection({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
        ssl
      });

      const tblCL = `${prefix}category_lang`;
      const tblLang = `${prefix}lang`;

      // Resolve ISO codes for source and all target languages
      let isoFrom = null;
      const isoToMap = new Map();
      try {
        const idsList = Array.from(
          new Set([idLangFrom, ...toLangs].filter(Boolean))
        );
        const placeholdersLang = idsList.map(() => '?').join(',');
        const [rf] = idsList.length
          ? await conn.query(
              `SELECT id_lang, iso_code FROM \`${tblLang}\` WHERE id_lang IN (${placeholdersLang})`,
              idsList
            )
          : [[]];
        const map = new Map(
          (Array.isArray(rf) ? rf : []).map(r => [
            Number(r.id_lang),
            String(r.iso_code || '').toLowerCase()
          ])
        );
        isoFrom = map.get(Number(idLangFrom)) || null;
        for (const lid of toLangs) {
          isoToMap.set(Number(lid), map.get(Number(lid)) || null);
        }
      } catch (e) {}

      // Load sources from origin or from destination if origin missing (fallback)
      const placeholders = ids.map(() => '?').join(',');
      const [src] = await conn.query(
        `SELECT id_category, name, description, meta_title, meta_description
           FROM \`${tblCL}\`
          WHERE id_category IN (${placeholders}) AND id_lang=? AND id_shop=?`,
        [...ids, idLangFrom || idLangTo, idShopFrom || idShopTo]
      );
      const byId = new Map(
        (Array.isArray(src) ? src : []).map(r => [Number(r.id_category), r])
      );

      async function callPrompt(inputObject, timeoutMs) {
        if (!promptId) return null;
        const base =
          String(process.env.INTERNAL_SERVER_URL || '').trim() ||
          `http://127.0.0.1:${Number(
            process.env.PORT || process.env.APP_PORT || 3010
          )}`;
        const url = `${base}/api/automation-suite/prompt-configs/${encodeURIComponent(
          promptId
        )}/test`;
        const payload = { input: JSON.stringify(inputObject) };
        const ctl = new AbortController();
        const t = setTimeout(
          () => ctl.abort(),
          Number(timeoutMs || process.env.PROMPT_TIMEOUT_MS || 90000)
        );
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: ctl.signal
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.message || `prompt_http_${r.status}`);
          return j;
        } finally {
          clearTimeout(t);
        }
      }

      function parseMaybeJson(val) {
        try {
          if (val == null) return null;
          if (typeof val === 'string') {
            const s = val.trim();
            if (s.startsWith('{') || s.startsWith('[')) {
              try {
                return JSON.parse(s);
              } catch (e) {
                return s;
              }
            }
            return s;
          }
          return val;
        } catch (e) {
          return val;
        }
      }

      function coerceText(v) {
        try {
          if (v == null) return '';
          const parsed = parseMaybeJson(v);
          if (parsed == null) return '';
          if (typeof parsed === 'string') return parsed;
          if (Array.isArray(parsed)) {
            return parsed
              .map(x => (typeof x === 'string' ? x : ''))
              .filter(Boolean)
              .join(' ')
              .trim();
          }
          if (typeof parsed === 'object') {
            for (const k of ['text', 'value', 'content']) {
              if (parsed[k] != null) {
                const t = coerceText(parsed[k]);
                if (t) return t;
              }
            }
            const s = JSON.stringify(parsed);
            if (s === '{}' || s === '[]') return '';
            return s;
          }
          return String(parsed);
        } catch (e) {
          return '';
        }
      }

      function pick(obj, keys) {
        try {
          for (const k of keys) {
            if (obj && obj[k] != null) {
              const t = coerceText(obj[k]);
              if (t) return t;
            }
          }
          return '';
        } catch (e) {
          return '';
        }
      }

      function firstObjectCandidate(resp) {
        const cands = [
          resp?.text,
          resp?.fields,
          resp?.result,
          resp?.output,
          resp?.data,
          resp
        ];
        for (let c of cands) {
          if (typeof c === 'string') c = parseMaybeJson(c);
          if (c && typeof c === 'object' && !Array.isArray(c)) return c;
        }
        return null;
      }

      function extractFromPrompt(resp, cur) {
        try {
          const fromFields = firstObjectCandidate(resp) || {};
          const name =
            pick(fromFields, ['name', 'title', 'text']) || cur?.name || '';
          const meta_title =
            pick(fromFields, ['meta_title', 'title', 'name', 'text']) ||
            name ||
            cur?.name ||
            '';
          const meta_description =
            pick(fromFields, [
              'meta_description',
              'description',
              'summary'
            ]) || cur?.meta_description || '';
          const description =
            pick(fromFields, ['description', 'text']) ||
            (cur?.description || '');
          return { name, meta_title, meta_description, description };
        } catch (e) {
          return {};
        }
      }

      const updates = [];
      const traces = [];

      for (const id of ids) {
        const cur = byId.get(Number(id)) || {};
        try {
          if (b?.run_id) {
            utils?.sseEmit?.(String(b.run_id), 'category_start', {
              id_category: id,
              id_shop: idShopTo,
              id_lang_from: idLangFrom,
              lang_to_ids: toLangs
            });
          }
        } catch (e) {}

        for (const idLangTarget of toLangs) {
          let gen = null;

          if (promptId) {
            try {
              const limits = {
                meta_title: Number(
                  process.env.CATEGORY_META_TITLE_LIMIT || 70
                ),
                meta_description_min: Number(
                  process.env.CATEGORY_META_DESCRIPTION_MIN || 150
                ),
                meta_description_max: Number(
                  process.env.CATEGORY_META_DESCRIPTION_MAX || 160
                )
              };

              const reqObj = {
                from_lang_id: Number(idLangFrom) || null,
                from_iso: normalizeIso(isoFrom) || null,
                to_lang_id: Number(idLangTarget) || null,
                to_iso:
                  normalizeIso(
                    isoToMap.get(Number(idLangTarget)) || null
                  ) || null,
                fields: promptFields,
                limits,
                source: {
                  name: cur.name || '',
                  description: cur.description || '',
                  meta_title: cur.meta_title || '',
                  meta_description: cur.meta_description || ''
                },
                glossary: null,
                category: { id, shop_id_from: idShopFrom || idShopTo },
                site:
                  (b?.source_site || b?.scope?.source_site || '') || null
              };

              try {
                chatLog('cat_prompt_request', {
                  id_category: id,
                  id_lang: idLangTarget,
                  id_lang_from: idLangFrom,
                  payload: reqObj
                });
              } catch (e) {}

              try {
                if (b?.run_id) {
                  utils?.sseEmit?.(String(b.run_id), 'prompt_request', {
                    id_category: id,
                    id_lang: idLangTarget,
                    id_lang_from: idLangFrom,
                    id_shop: idShopTo,
                    input_len: JSON.stringify(reqObj).length,
                    prompt: reqObj
                  });
                }
              } catch (e) {}

              let resp;
              try {
                const __t0 = Date.now();
                resp = await callPrompt(reqObj, b?.prompt_timeout_ms);
                const __t1 = Date.now();
                try {
                  if (b?.run_id) {
                    utils?.sseEmit?.(String(b.run_id), 'prompt_received', {
                      id_category: id,
                      id_lang: idLangTarget,
                      id_lang_from: idLangFrom,
                      id_shop: idShopTo,
                      ms: Math.max(0, __t1 - __t0)
                    });
                  }
                } catch (e) {}
              } catch (e) {
                const msg = String(e?.message || '');
                if (
                  msg.includes('aborted') ||
                  msg.includes('AbortError') ||
                  msg.includes('fetch failed') ||
                  msg.includes('ECONN')
                ) {
                  try {
                    const __t0b = Date.now();
                    resp = await callPrompt(reqObj, b?.prompt_timeout_ms);
                    const __t1b = Date.now();
                    try {
                      if (b?.run_id) {
                        utils?.sseEmit?.(
                          String(b.run_id),
                          'prompt_received',
                          {
                            id_category: id,
                            id_lang: idLangTarget,
                            id_lang_from: idLangFrom,
                            id_shop: idShopTo,
                            ms: Math.max(0, __t1b - __t0b)
                          }
                        );
                      }
                    } catch (e2) {}
                  } catch (ee) {
                    throw ee;
                  }
                } else {
                  throw e;
                }
              }

              gen = extractFromPrompt(resp, cur);
              try {
                if (b?.run_id) {
                  utils?.sseEmit?.(String(b.run_id), 'prompt_output', {
                    id_category: id,
                    id_lang: idLangTarget,
                    id_lang_from: idLangFrom,
                    id_shop: idShopTo,
                    out: gen
                  });
                }
              } catch (e) {}

              if (wantTrace) {
                const safe = v => {
                  try {
                    const s =
                      typeof v === 'string' ? v : JSON.stringify(v);
                    return String(s).slice(0, 2000);
                  } catch (e) {
                    return '';
                  }
                };
                traces.push({
                  id_category: id,
                  id_lang: idLangTarget,
                  request: safe(reqObj),
                  response: safe(resp),
                  extracted: safe(gen)
                });
              }

              try {
                const s = JSON.stringify(resp);
                chatLog('cat_prompt_response', {
                  id_category: id,
                  id_lang: idLangTarget,
                  bytes: s ? s.length : 0,
                  snippet: (s || '').slice(0, 512)
                });
              } catch (e) {}
            } catch (e) {
              try {
                chatLog('cat_translate_prompt_error', {
                  id_lang: idLangTarget,
                  error: e?.message || String(e)
                });
              } catch (e2) {}
            }
            // Immediate DB update after prompt_output (respect dry_run)
            try {
              const patchNow = {};
              if (fields.includes('name')) patchNow.name = ((gen && gen.name) || cur.name || '').slice(0, NAME_MAX);
              if (fields.includes('meta_title')) patchNow.meta_title = ((gen && gen.meta_title) || cur.name || '').slice(0, META_TITLE_MAX);
              if (fields.includes('meta_description')) patchNow.meta_description = ((gen && gen.meta_description) || cur.meta_description || '').slice(0, META_DESCRIPTION_MAX);
              if (fields.includes('description')) patchNow.description = (gen && gen.description) || cur.description || '';
              if (fields.includes('link_rewrite')) { const baseNow = patchNow.name || gen?.name || cur.name || ''; patchNow.link_rewrite = slugify(baseNow).slice(0, LINK_REWRITE_MAX); }
              const colsNow = Object.keys(patchNow);
              if (!colsNow.length) {
                out.push({ id_category: id, id_lang: idLangTarget, updated: false, status: 'skipped' });
              } else if (dryRun) {
                out.push({ id_category: id, id_lang: idLangTarget, updated: false, status: 'ok', fields: colsNow });
                try { if (b?.run_id) utils?.sseEmit?.(String(b.run_id), 'db_update_done', { id_category: id, id_lang: idLangTarget, id_shop: idShopTo, updated: false, fields: colsNow }); } catch (e) {}
              } else {
                const setsNow = colsNow.map(c => `\`${c}\` = ?`).join(', ');
                const valsNow = colsNow.map(c => patchNow[c]);
                try {
                  try { if (b?.run_id) utils?.sseEmit?.(String(b.run_id), 'db_update_start', { id_category: id, id_lang: idLangTarget, id_shop: idShopTo, fields: colsNow }); } catch (e) {}
                  const [rNow] = await conn.query(`UPDATE \`${tblCL}\` SET ${setsNow} WHERE id_category=? AND id_lang=? AND id_shop=?`, [...valsNow, id, idLangTarget, idShopTo]);
                  const okNow = rNow && typeof rNow.affectedRows === 'number' ? rNow.affectedRows > 0 : true;
                  if (!okNow) throw new Error('no_row_updated');
                  updated += 1;
                  out.push({ id_category: id, id_lang: idLangTarget, updated: true, status: 'updated' });
                  try { if (b?.run_id) utils?.sseEmit?.(String(b.run_id), 'db_update_done', { id_category: id, id_lang: idLangTarget, id_shop: idShopTo, updated: true, fields: colsNow }); } catch (e) {}
                } catch (eWrite) {
                  try {
                    const cols2 = ['id_category', 'id_lang', 'id_shop', ...colsNow];
                    const vals2 = [id, idLangTarget, idShopTo, ...valsNow];
                    const placeholders2 = cols2.map(() => '?').join(',');
                    const sqlIns = `INSERT INTO \`${tblCL}\` (${cols2.map(c=>`\`${c}\``).join(',')}) VALUES (${placeholders2}) ON DUPLICATE KEY UPDATE ${colsNow.map(c=>`\`${c}\`=VALUES(\`${c}\`)`).join(', ')}`;
                    const [riNow] = await conn.query(sqlIns, vals2);
                    const ok2Now = riNow && typeof riNow.affectedRows === 'number' ? riNow.affectedRows > 0 : true;
                    updated += ok2Now ? 1 : 0;
                    out.push({ id_category: id, id_lang: idLangTarget, updated: ok2Now, status: ok2Now ? 'updated' : 'ok' });
                    try { if (b?.run_id) utils?.sseEmit?.(String(b.run_id), 'db_update_done', { id_category: id, id_lang: idLangTarget, id_shop: idShopTo, updated: ok2Now, fields: colsNow }); } catch (e) {}
                  } catch (eeNow) {
                    out.push({ id_category: id, id_lang: idLangTarget, updated: false, status: 'error', message: eeNow?.message || String(eeNow) });
                    try { if (b?.run_id) utils?.sseEmit?.(String(b.run_id), 'db_update_error', { id_category: id, id_lang: idLangTarget, id_shop: idShopTo, message: eeNow?.message || String(eeNow), fields: colsNow }); } catch (e2) {}
                  }
                }
              }
              // Skip the batch path for this id/lang; continue with next target lang
              continue;
            } catch (eImmediate) {
              // If immediate path fails, fall through to batch path below
            }
          }

          const patch = {};
          if (fields.includes('name')) {
            patch.name = ((gen && gen.name) || cur.name || '').slice(
              0,
              NAME_MAX
            );
          }
          if (fields.includes('meta_title')) {
            patch.meta_title = ((gen && gen.meta_title) || cur.name || '').slice(
              0,
              META_TITLE_MAX
            );
          }
          if (fields.includes('meta_description')) {
            patch.meta_description = (
              (gen && gen.meta_description) ||
              cur.meta_description ||
              ''
            ).slice(0, META_DESCRIPTION_MAX);
          }
          if (fields.includes('description')) {
            patch.description =
              (gen && gen.description) || cur.description || '';
          }
          if (fields.includes('link_rewrite')) {
            const base = patch.name || gen?.name || cur.name || '';
            patch.link_rewrite = slugify(base).slice(0, LINK_REWRITE_MAX);
          }

          updates.push({ id_category: id, id_lang: idLangTarget, patch });
        }
      }

      if (dryRun) {
        return res.json({
          ok: true,
          preview: true,
          items: updates.map(u => ({
            id_category: u.id_category,
            id_lang: u.id_lang,
            ...u.patch
          })),
          trace: wantTrace ? traces : undefined
        });
      }

      // Apply updates
      let updated = 0;
      const out = [];
      for (const u of updates) {
        const cols = Object.keys(u.patch);
        if (!cols.length) {
          out.push({
            id_category: u.id_category,
            updated: false,
            status: 'skipped'
          });
          continue;
        }

        const sets = cols.map(c => `\`${c}\` = ?`).join(', ');
        const vals = cols.map(c => u.patch[c]);

        try {
          if (dryRun) {
            out.push({ id_category: u.id_category, id_lang: u.id_lang, updated: false, status: 'ok', fields: cols });
            try { if (b?.run_id) utils?.sseEmit?.(String(b.run_id), 'db_update_done', { id_category: u.id_category, id_lang: u.id_lang, id_shop: idShopTo, updated: false, fields: cols }); } catch (e) {}
            continue;
          }
          try {
            if (b?.run_id) {
              utils?.sseEmit?.(String(b.run_id), 'db_update_start', {
                id_category: u.id_category,
                id_lang: u.id_lang,
                id_shop: idShopTo,
                fields: cols
              });
            }
          } catch (e) {}

          const [r] = await conn.query(
            `UPDATE \`${tblCL}\` SET ${sets} WHERE id_category=? AND id_lang=? AND id_shop=?`,
            [...vals, u.id_category, u.id_lang, idShopTo]
          );
          const ok =
            r && typeof r.affectedRows === 'number'
              ? r.affectedRows > 0
              : true;
          if (!ok) throw new Error('no_row_updated');

          updated += 1;
          out.push({
            id_category: u.id_category,
            id_lang: u.id_lang,
            updated: true,
            status: 'updated'
          });

          try {
            if (b?.run_id) {
              utils?.sseEmit?.(String(b.run_id), 'db_update_done', {
                id_category: u.id_category,
                id_lang: u.id_lang,
                id_shop: idShopTo,
                updated: true,
                fields: cols
              });
            }
          } catch (e) {}
        } catch (e) {
          try {
            const cols2 = ['id_category', 'id_lang', 'id_shop', ...cols];
            const vals2 = [u.id_category, u.id_lang, idShopTo, ...vals];
            const placeholders2 = cols2.map(() => '?').join(',');
            const sqlIns = `INSERT INTO \`${tblCL}\` (${cols2
              .map(c => `\`${c}\``)
              .join(',')}) VALUES (${placeholders2}) ON DUPLICATE KEY UPDATE ${cols
              .map(c => `\`${c}\`=VALUES(\`${c}\`)`)
              .join(', ')}`;
            const [ri] = await conn.query(sqlIns, vals2);
            const ok2 =
              ri && typeof ri.affectedRows === 'number'
                ? ri.affectedRows > 0
                : true;

            updated += ok2 ? 1 : 0;
            out.push({
              id_category: u.id_category,
              id_lang: u.id_lang,
              updated: ok2,
              status: ok2 ? 'updated' : 'ok'
            });

            try {
              if (b?.run_id) {
                utils?.sseEmit?.(String(b.run_id), 'db_update_done', {
                  id_category: u.id_category,
                  id_lang: u.id_lang,
                  id_shop: idShopTo,
                  updated: ok2,
                  fields: cols
                });
              }
            } catch (e) {}
          } catch (ee) {
            out.push({
              id_category: u.id_category,
              id_lang: u.id_lang,
              updated: false,
              status: 'error',
              message: ee?.message || String(ee)
            });

            try {
              if (b?.run_id) {
                utils?.sseEmit?.(String(b.run_id), 'db_update_error', {
                  id_category: u.id_category,
                  id_lang: u.id_lang,
                  id_shop: idShopTo,
                  message: ee?.message || String(ee),
                  fields: cols
                });
              }
            } catch (e2) {}
          }
        }
      }

      return res.json({
        ok: true,
        updated,
        total: updates.length,
        items: out,
        trace: wantTrace ? traces : undefined
      });
    } catch (e) {
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') {
        return res.status(500).json({
          ok: false,
          error: 'mysql2_missing',
          message:
            'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev'
        });
      }

      try {
        chatLog('cat_translate_error', {
          error: e?.message || String(e)
        });
      } catch (e2) {}

      return res.status(500).json({
        ok: false,
        error: 'server_error',
        message: e?.message || String(e)
      });
    } finally {
      try {
        if (conn) await conn.end();
      } catch (e) {}
    }
  });

  // Build prompt JSON input only (no OpenAI call, no writes)
  app.post(
    '/api/category_data_update/categories/translate-build-input',
    async (req, res) => {
      const b = req.body || {};
      const profileId = Number(b.profile_id || 0) || null;
      const prefix = String(b.prefix || '').trim();
      const fields = Array.isArray(b.fields) ? b.fields : [];
      const promptFields = fields.filter(f => String(f) !== 'link_rewrite');
      const scope = b.scope && typeof b.scope === 'object' ? b.scope : {};
      const idShopTo = Number(scope.id_shop || 0) || null;
      const idShopFrom = Number(scope.id_shop_from || 0) || null;
      const idLangFrom = Number(b.lang_from || scope.lang_from_id || 0) || null;
      const idLangTo = Number(b.lang_to || scope.lang_to_id || scope.id_lang || 0) || null;
      const list = Array.isArray(scope.category_ids)
        ? scope.category_ids
        : String(scope.category_ids || '').split(',');
      const ids = list
        .map(s => Number(String(s).trim()))
        .filter(n => Number.isFinite(n) && n > 0);

      if (!profileId || !prefix || !idShopTo || !idLangTo || !ids.length) {
        return res.status(400).json({ ok: false, error: 'bad_request' });
      }

      {
        const pool = utils.pool;
        if (!pool || typeof pool.query !== 'function') {
          return res.status(500).json({
            ok: false,
            error: 'server_error',
            message: 'db_pool_missing'
          });
        }

        const orgId =
          b.org_id != null ? String(b.org_id).trim() || null : pickOrgId(req);
        const args = [profileId];
        const whereOrg = orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '';
        if (orgId) args.push(orgId);
        const pr = await pool.query(
          `SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`,
          args
        );
        if (!pr || !pr.rowCount) {
          return res
            .status(404)
            .json({ ok: false, error: 'profile_not_found' });
        }
        const cfg = normalizeConn(pr.rows[0]);

        const mysql = await getMysql2(ctx);
        const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
        let conn;
        try {
          conn = await mysql.createConnection({
            host: cfg.host,
            port: cfg.port,
            user: cfg.user,
            password: cfg.password,
            database: cfg.database,
            ssl
          });
          const tblCL = `${prefix}category_lang`;
          const tblLang = `${prefix}lang`;
          // Resolve ISO codes
          let isoFrom = null,
            isoTo = null;
          try {
            const [rf] = await conn.query(
              `SELECT id_lang, iso_code FROM \`${tblLang}\` WHERE id_lang IN (?,?)`,
              [idLangFrom, idLangTo]
            );
            const map = new Map(
              (Array.isArray(rf) ? rf : []).map(r => [
                Number(r.id_lang),
                String(r.iso_code || '').toLowerCase()
              ])
            );
            isoFrom = map.get(Number(idLangFrom)) || null;
            isoTo = map.get(Number(idLangTo)) || null;
          } catch (e) {}
          // Load source rows
          const placeholders = ids.map(() => '?').join(',');
          const [src] = await conn.query(
            `SELECT id_category, name, description, meta_title, meta_description
               FROM \`${tblCL}\`
              WHERE id_category IN (${placeholders}) AND id_lang=? AND id_shop=?`,
            [...ids, idLangFrom || idLangTo, idShopFrom || idShopTo]
          );
          const byId = new Map(
            (Array.isArray(src) ? src : []).map(r => [
              Number(r.id_category),
              r
            ])
          );
          const limits = {
            meta_title: META_TITLE_MAX,
            meta_description_min: 0,
            meta_description_max: META_DESCRIPTION_MAX,
            name_max: NAME_MAX
          };
          const inputs = ids.map(id => {
            const cur = byId.get(Number(id)) || {};
            return {
              from_lang_id: Number(idLangFrom) || null,
              from_iso: normalizeIso(isoFrom) || null,
              to_lang_id: Number(idLangTo) || null,
              to_iso: normalizeIso(isoTo) || null,
              fields: promptFields,
              limits,
              source: {
                name: (cur.name || '').slice(0, NAME_MAX),
                description: cur.description || '',
                meta_title: (cur.meta_title || '').slice(
                  0,
                  META_TITLE_MAX
                ),
                meta_description: (cur.meta_description || '').slice(
                  0,
                  META_DESCRIPTION_MAX
                )
              },
              glossary: null,
              category: { id, shop_id_from: idShopFrom || idShopTo }
            };
          });
          return res.json({ ok: true, count: inputs.length, inputs });
        } catch (e) {
          return res.status(500).json({
            ok: false,
            error: 'server_error',
            message: e?.message || String(e)
          });
        } finally {
          try {
            if (conn) await conn.end();
          } catch (e2) {}
        }
      }
    }
  );

  // Chunked translator run for categories
  app.post(
    '/api/category_data_update/categories/translate-run',
    async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const b = req.body || {};
      const profileId = Number(b.profile_id || 0) || null;
      const prefix = String(b.prefix || '').trim();
      const idShop = Number(b.id_shop || 0) || null;
      const idShopFrom = Number(b.id_shop_from || 0) || null;
      const langFromId = Number(b.lang_from_id || 0) || null;
      const langToId = Number(b.lang_to_id || 0) || null;
      const fields = Array.isArray(b.fields) ? b.fields : [];
      const arr = Array.isArray(b.category_ids) ? b.category_ids : [];
      const categoryIds = arr
        .map(n => Number(n))
        .filter(n => Number.isFinite(n) && n > 0);
      const promptId = String(b.prompt_config_id || '').trim();
      const dryRun = !!b.dry_run;
      const batchSize = Math.max(
        1,
        Math.min(100, Number(b.batch_size || 10) || 10)
      );

      if (
        !profileId ||
        !prefix ||
        !idShop ||
        !langFromId ||
        !langToId ||
        !categoryIds.length
      ) {
        return res.status(400).json({ ok: false, error: 'bad_request' });
      }

      const total = categoryIds.length;
      let index = 0;
      const batchResults = [];

      try {
        while (index < total) {
          const slice = categoryIds.slice(index, index + batchSize);
          const body = {
            profile_id: profileId,
            prefix,
            fields,
            prompt_config_id: promptId || null,
            scope: {
              id_shop: idShop,
              id_shop_from: idShopFrom || null,
              lang_from_id: langFromId,
              lang_to_id: langToId,
              category_ids: slice
            },
            dry_run: dryRun,
            trace: !!b.trace,
            run_id: b.run_id || null
          };

          const base =
            String(process.env.INTERNAL_SERVER_URL || '').trim() ||
            `http://127.0.0.1:${Number(
              process.env.PORT || process.env.APP_PORT || 3010
            )}`;
          const url = `${base}/api/category_data_update/categories/translate`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-call': '1'
            },
            body: JSON.stringify(body)
          });
          const j = await resp.json().catch(() => ({}));
          batchResults.push({
            from: index,
            to: index + slice.length,
            ok: !!j?.ok,
            updated: j?.updated || 0,
            total: j?.total || slice.length,
            items: j?.items || [],
            error: j?.ok ? null : j?.error || j?.message || null
          });
          index += slice.length;
        }

        const totalUpdated = batchResults.reduce(
          (acc, b) => acc + (b.updated || 0),
          0
        );
        return res.json({
          ok: true,
          total,
          batch_size: batchSize,
          batches: batchResults.length,
          updated: totalUpdated,
          results: batchResults
        });
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: 'server_error',
          message: e?.message || String(e)
        });
      }
    }
  );
}
