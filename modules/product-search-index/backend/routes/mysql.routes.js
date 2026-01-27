import { loadProfileConfig } from '../services/indexer.service.js';
import { connectMySql, makeSqlHelpers } from '../../../grabbing-jerome/backend/services/transfer/mysql.js';

function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerPsiMysqlRoutes(app, ctx = {}, utils = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });

  // List shops from ps_shop
  app.get('/api/product-search-index/mysql/shops', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const profileId = req.query?.profile_id ? Number(req.query.profile_id) : 0;
      const prefix = String(req.query?.prefix || 'ps_');
      if (!profileId) return res.status(400).json({ ok:false, error:'bad_request', message:'profile_id required' });
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      const conn = await connectMySql(ctx, cfg);
      try {
        const { q, hasTable, hasColumn } = makeSqlHelpers(conn);
        const dbName = String(cfg.database);
        const tShop = prefix + 'shop';
        if (!(await hasTable(tShop, dbName))) return res.json({ ok:true, items: [] });
        // Some PS versions may miss 'name'
        const hasName = await hasColumn(tShop, 'name', dbName);
        const rows = await q(`SELECT id_shop${hasName?', name':''} FROM \`${tShop}\` ORDER BY id_shop`);
        const items = rows.map(r => ({ id_shop: Number(r.id_shop), name: hasName ? (r.name || '') : '' }));
        return res.json({ ok:true, items });
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      const msg = e?.message || String(e);
      if (/mysql2_missing/i.test(msg)) return res.status(503).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend' });
      return res.status(500).json({ ok:false, error:'server_error', message: msg });
    }
  });

  // List active languages for a shop
  app.get('/api/product-search-index/mysql/languages', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const profileId = req.query?.profile_id ? Number(req.query.profile_id) : 0;
      const idShop = req.query?.id_shop ? Number(req.query.id_shop) : 0;
      const prefix = String(req.query?.prefix || 'ps_');
      if (!profileId) return res.status(400).json({ ok:false, error:'bad_request', message:'profile_id required' });
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      const conn = await connectMySql(ctx, cfg);
      try {
        const { q, hasTable, hasColumn } = makeSqlHelpers(conn);
        const dbName = String(cfg.database);
        const tLang = prefix + 'lang';
        const tLangShop = prefix + 'lang_shop';
        if (!(await hasTable(tLang, dbName))) return res.json({ ok:true, items: [] });
        const hasIso = await hasColumn(tLang, 'iso_code', dbName);
        const useMap = idShop > 0 && await hasTable(tLangShop, dbName);
        let rows;
        if (useMap) {
          rows = await q(
            `SELECT l.id_lang, l.name${hasIso ? ', l.iso_code' : ''} FROM \`${tLang}\` l INNER JOIN \`${tLangShop}\` ls ON ls.id_lang = l.id_lang AND ls.id_shop = ? WHERE l.active = 1 ORDER BY l.id_lang`,
            [idShop]
          );
        } else {
          rows = await q(`SELECT id_lang, name${hasIso ? ', iso_code' : ''} FROM \`${tLang}\` WHERE active = 1 ORDER BY id_lang`);
        }
        const items = (rows || []).map((r) => ({
          id_lang: Number(r.id_lang),
          name: typeof r.name === 'string' ? r.name : '',
          iso_code: typeof r.iso_code === 'string' ? r.iso_code : '',
        }));
        return res.json({ ok:true, items });
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      const msg = e?.message || String(e);
      if (/mysql2_missing/i.test(msg)) return res.status(503).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend' });
      return res.status(500).json({ ok:false, error:'server_error', message: msg });
    }
  });

  // List active currencies for a shop + language
  app.get('/api/product-search-index/mysql/currencies', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const profileId = req.query?.profile_id ? Number(req.query.profile_id) : 0;
      const idShop = req.query?.id_shop ? Number(req.query.id_shop) : 0;
      const idLang = req.query?.id_lang ? Number(req.query.id_lang) : 0;
      const prefix = String(req.query?.prefix || 'ps_');
      if (!profileId || !idShop || !idLang) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'profile_id, id_shop and id_lang required' });
      }

      const cfg = await loadProfileConfig(pool, orgId, profileId);
      const conn = await connectMySql(ctx, cfg);
      try {
        const { q, hasTable, hasColumn } = makeSqlHelpers(conn);
        const dbName = String(cfg.database);
        const tCurrency = prefix + 'currency';
        const tCurrencyShop = prefix + 'currency_shop';
        const tCurrencyLang = prefix + 'currency_lang';
        const tConfig = prefix + 'configuration';

        if (!(await hasTable(tCurrency, dbName))) return res.json({ ok: true, items: [] });

        const hasIso = await hasColumn(tCurrency, 'iso_code', dbName);
        const hasSign = await hasColumn(tCurrency, 'sign', dbName);
        const hasDeleted = await hasColumn(tCurrency, 'deleted', dbName);
        const hasRate = await hasColumn(tCurrency, 'conversion_rate', dbName);
        const useShop = await hasTable(tCurrencyShop, dbName);
        const useLang = await hasTable(tCurrencyLang, dbName);
        const hasLangName = useLang ? await hasColumn(tCurrencyLang, 'name', dbName) : false;

        const selectParts = [
          'c.id_currency',
          hasIso ? 'c.iso_code' : null,
          hasSign ? 'c.sign' : null,
          hasRate ? 'c.conversion_rate' : null,
          useLang && hasLangName ? 'cl.name AS name' : null,
        ].filter(Boolean);

        const joins = [];
        const args = [];
        if (useShop) {
          joins.push(`INNER JOIN \`${tCurrencyShop}\` cs ON cs.id_currency = c.id_currency AND cs.id_shop = ?`);
          args.push(idShop);
        }
        if (useLang) {
          joins.push(`LEFT JOIN \`${tCurrencyLang}\` cl ON cl.id_currency = c.id_currency AND cl.id_lang = ?`);
          args.push(idLang);
        }

        const whereParts = ['c.active = 1'];
        if (hasDeleted) whereParts.push('c.deleted = 0');

        const rows = await q(
          `SELECT ${selectParts.join(', ')} FROM \`${tCurrency}\` c ${joins.join(' ')} WHERE ${whereParts.join(' AND ')} ORDER BY c.id_currency`,
          args
        );

        let defaultIso = '';
        try {
          if (await hasTable(tConfig, dbName)) {
            const configRows = await q(
              `SELECT value FROM \`${tConfig}\` WHERE name = 'PS_CURRENCY_DEFAULT' AND id_shop = ? LIMIT 1`,
              [idShop]
            );
            const defaultId = Number(configRows?.[0]?.value || 0);
            if (defaultId && hasIso) {
              const isoRows = await q(`SELECT iso_code FROM \`${tCurrency}\` WHERE id_currency = ? LIMIT 1`, [defaultId]);
              defaultIso = String(isoRows?.[0]?.iso_code || '');
            }
          }
        } catch {}

        const items = (Array.isArray(rows) ? rows : [])
          .map((r) => ({
            id_currency: Number(r.id_currency),
            iso_code: typeof r.iso_code === 'string' ? r.iso_code : '',
            sign: typeof r.sign === 'string' ? r.sign : '',
            name: typeof r.name === 'string' ? r.name : '',
            conversion_rate: hasRate ? Number(r.conversion_rate) : null,
          }))
          .filter((r) => Number.isFinite(r.id_currency) && r.id_currency > 0);

        return res.json({ ok: true, items, default_iso: defaultIso || '', has_conversion_rate: hasRate });
      } finally {
        try { await conn.end(); } catch {}
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (/mysql2_missing/i.test(msg)) return res.status(503).json({ ok: false, error: 'mysql2_missing', message: 'Install mysql2 in backend' });
      return res.status(500).json({ ok: false, error: 'server_error', message: msg });
    }
  });
}
