// Send-to-Presta service (modern entry)
// Modern orchestrator using extracted helpers (mysql, mapping, images, generic-writer)
// Keeps behavior similar to legacy while being modular and testable.

import { getMysql2FromCtx, connectMySql, makeSqlHelpers } from './transfer/mysql.js';
import { resolveProfileId, resolvePrefix, loadTableSettings } from './transfer/mapping.js';
import { runImagesPipeline } from './transfer/images.pipeline.js';
import { runDocumentsPipeline } from './transfer/documents.pipeline.js';
import { runGenericWriter } from './transfer/generic-writer.js';
import { runAttributesWriter } from './transfer/attributes.js';
import { runFeaturesWriter } from './transfer/features.js';

export async function sendToPresta(req, res, ctx = {}, utils = {}) {
  const pool = utils?.pool || ctx?.pool;
  const chatLog = typeof utils?.chatLog === 'function' ? utils.chatLog : (()=>{});
  const normDomain = typeof utils?.normDomain === 'function' ? utils.normDomain : (s => String(s||'').toLowerCase().replace(/^www\./,''));
  const ensureExtractionRunsTable = typeof utils?.ensureExtractionRunsTable === 'function' ? utils.ensureExtractionRunsTable : async ()=>{};
  const ensureSendErrorLogsTable = typeof utils?.ensureSendErrorLogsTable === 'function' ? utils.ensureSendErrorLogsTable : async ()=>{};
  const ensureImageMapTable = typeof utils?.ensureImageMapTable === 'function' ? utils.ensureImageMapTable : async ()=>{};
  // Local ensure: per-field upsert logs (audit)
  const ensureUpsertFieldLogsTable = async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.mod_grabbing_sensorex_upsert_field_logs (
          id SERIAL PRIMARY KEY,
          run_id INTEGER,
          domain TEXT,
          page_type TEXT,
          table_name TEXT,
          product_id INTEGER,
          id_shop INTEGER,
          id_lang INTEGER,
          id_group INTEGER,
          field TEXT,
          value TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
    } catch {}
  };

  // Lightweight raw-body reader (fallback when JSON parser isn't mounted)
  const readRawBody = (req2, max = 1024 * 1024) => new Promise((resolve) => {
    try {
      if (!req2 || typeof req2.on !== 'function') return resolve('');
      let size = 0; const chunks = [];
      req2.on('data', (c) => { try { size += c.length; if (size <= max) chunks.push(c); } catch {} });
      req2.on('end', () => { try { resolve(Buffer.concat(chunks).toString('utf8')); } catch { resolve(''); } });
      req2.on('error', () => resolve(''));
    } catch { resolve(''); }
  });

  try {
    if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
    await ensureExtractionRunsTable();
    await ensureSendErrorLogsTable();
    await ensureUpsertFieldLogsTable();

    // Normalize body: use parsed body when available or parse raw if needed
    let bodyObj = (req.body && typeof req.body === 'object') ? req.body : null;
    if (!bodyObj) {
      const raw = (await readRawBody(req, 1024*1024)).trim();
      if (raw) {
        try { bodyObj = JSON.parse(raw); }
        catch {
          try { const sp = new URLSearchParams(raw); const tmp = {}; for (const [k,v] of sp.entries()) tmp[k]=v; bodyObj = tmp; } catch {}
        }
      }
      if (bodyObj && typeof bodyObj === 'object') { try { req.body = bodyObj; } catch {} }
    }

    const runId = Number(((bodyObj?.run_id ?? bodyObj?.id ?? req.query?.run_id ?? req.query?.id) || 0)) || 0;
    // Profile override from request is ignored by policy; mapping controls the DB profile strictly
    let explicitProfileId = null;
    let profileSource = null;
    let requestedMode = String(bodyObj?.mode||'').toLowerCase(); if (!requestedMode) requestedMode = String(req.query?.mode||'').toLowerCase();
    const debug = (bodyObj?.debug === true) || (String(req.query?.debug||'').toLowerCase() === 'true');
    const qWrite = ['1','true','yes','y'].includes(String(req.query?.write||'').toLowerCase());
    const doWrite = (bodyObj?.write === true) || qWrite || requestedMode === 'upsert' || requestedMode === 'insert';
    const explicitMapping = (bodyObj && typeof bodyObj.mapping === 'object') ? bodyObj.mapping : null;
    if (!runId) return res.status(400).json({ ok:false, error:'bad_request', message:'run_id required' });

    // Load run
    const rr = await pool.query(`select id, domain, url, page_type, version, result from public.mod_grabbing_sensorex_extraction_runs where id=$1`, [runId]);
    if (!rr.rowCount) return res.status(404).json({ ok:false, error:'not_found', message:'run not found' });
    const run = rr.rows[0];
    const domain = normDomain(run.domain);
    // Allow explicit override of page type from request wrappers
    const type = String((bodyObj?.force_page_type || bodyObj?.page_type || req.query?.force_page_type || req.query?.page_type || run.page_type || '')).trim().toLowerCase() || 'product';
    try { chatLog('send_type', { run_id: run.id, resolved_type: type, run_page_type: String(run.page_type||'').toLowerCase(), forced: String(req.body?.force_page_type||'') }); } catch {}
    chatLog('transfer_start', { run_id: runId, domain, page_type: type, write: doWrite });
    try { await pool.query(
      `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [ run.id, domain, run.page_type, 'transfer', 'start', null, null, null, 'begin', JSON.stringify({ write: !!doWrite }) ]
    ); } catch { try { chatLog('log_table_insert_failed', { stage: 'start' }); } catch {} }

    // Centralized error logger: both file log and DB table
    const logErr = async ({ table_name = null, op = null, product_id = null, id_shop = null, id_lang = null, error = '', payload = {} } = {}) => {
      try {
        await pool.query(
          `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [ run.id, domain, run.page_type, table_name, op, product_id, id_shop, id_lang, String(error||''), JSON.stringify(payload||{}) ]
        );
      } catch {}
      try { chatLog('transfer_error', { run_id: run.id, table_name, op, product_id, id_shop, id_lang, error: String(error||''), payload: Array.isArray(payload)? '[array]': (payload && typeof payload==='object' ? '[object]' : payload) }); } catch {}
    };

    // Request/profile probing removed: mapping must provide profile_id strictly
    try {} catch {}
    // Helper: inspect mapping tools/domain for debug info when profile is missing
      const inspectProfiles = async (mv = null) => {
      const info = { mapping_version: mv, mapping_profile_id: null, mapping_profile_name: null, domain_profile_id: null, domain_profile_name: null };
      try {
        if (mv) {
          const r1 = await pool.query(`select config from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3 limit 1`, [domain, type, mv]);
          if (r1.rowCount) { const cfg = r1.rows[0]?.config || {}; if (cfg && typeof cfg==='object' && cfg.profile_id != null) info.mapping_profile_id = Number(cfg.profile_id)||null; }
        } else {
          const r2 = await pool.query(`select version, config from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc, updated_at desc limit 1`, [domain, type]);
          if (r2.rowCount) { const cfg = r2.rows[0]?.config || {}; if (cfg && typeof cfg==='object' && cfg.profile_id != null) info.mapping_profile_id = Number(cfg.profile_id)||null; info.mapping_version = Number(r2.rows[0]?.version||0)||null; }
        }
      } catch {}
      try {
        const rct = await pool.query(`select (config_transfert->>'db_mysql_profile_id')::int as pid from public.mod_grabbing_sensorex_domains where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') limit 1`, [domain]);
        if (rct.rowCount) info.domain_profile_id = Number(rct.rows[0]?.pid||0)||null;
      } catch {}
      try {
        if (info.mapping_profile_id) {
          const rp = await pool.query(`select id, name from public.mod_db_mysql_profiles where id=$1`, [info.mapping_profile_id]);
          if (rp.rowCount) info.mapping_profile_name = String(rp.rows[0]?.name||'');
        }
        if (info.domain_profile_id && !info.mapping_profile_id) {
          const rp2 = await pool.query(`select id, name from public.mod_db_mysql_profiles where id=$1`, [info.domain_profile_id]);
          if (rp2.rowCount) info.domain_profile_name = String(rp2.rows[0]?.name||'');
        }
      } catch {}
      return info;
    };

    // Resolve profile strictly from mapping_tools.config.profile_id (selected version or latest)
    // mappingVersion may be referenced in debug before it's resolved; declare it early
    let mappingVersion = null;
    const ct = {};
    let profileId = null;
    try {
      const wantVer = (req.body?.mapping_version != null) ? Number(req.body.mapping_version) : (req.query?.mapping_version != null ? Number(req.query.mapping_version) : null);
      if (wantVer) {
        const rc = await pool.query(
          `select config from public.mod_grabbing_sensorex_maping_tools
             where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3
             limit 1`,
          [domain, type, wantVer]
        );
        if (rc.rowCount) {
          const cfg = rc.rows[0]?.config && typeof rc.rows[0].config==='object' ? rc.rows[0].config : {};
          if (cfg && cfg.profile_id != null) profileId = Number(cfg.profile_id)||null;
          mappingVersion = wantVer;
        }
      } else {
        const rc2 = await pool.query(
          `select version, config from public.mod_grabbing_sensorex_maping_tools
             where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
             order by version desc, updated_at desc limit 1`,
          [domain, type]
        );
        if (rc2.rowCount) {
          const cfg2 = rc2.rows[0]?.config && typeof rc2.rows[0].config==='object' ? rc2.rows[0].config : {};
          if (cfg2 && cfg2.profile_id != null) profileId = Number(cfg2.profile_id)||null;
          mappingVersion = Number(rc2.rows[0]?.version||0)||null;
        }
      }
    } catch {}
    profileSource = profileId != null ? 'mapping_tools.config.profile_id' : null;
    if (!profileId) {
      try { await logErr({ table_name: 'transfer', op: 'profile', product_id: null, error: 'missing_profile_strict', payload: { note: 'mapping.profile_id required' } }); } catch {}
      const dbg = await inspectProfiles(mappingVersion||null);
      return res.status(400).json({ ok:false, error:'missing_profile', message:'mapping.profile_id is required (no override allowed).', ...dbg });
    }

    // Load MySQL profile details
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
    if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
    const prof = pr.rows[0];

    // Connect to MySQL
    let mysql;
    try { mysql = await getMysql2FromCtx(ctx); } catch { return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' }); }
    const cfg = {
      host: String(prof.host||'localhost'),
      port: Number(prof.port||3306),
      user: String(prof.user||''),
      password: String(prof.password||''),
      database: String(prof.database||''),
      ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
    };

    let conn;
    try {
      conn = await connectMySql(ctx, cfg);
      chatLog('mysql_connect_ok', { host: cfg.host, port: cfg.port, database: cfg.database });
      const { q: qBase, qi, hasTable: _hasTable, hasColumn: _hasColumn } = makeSqlHelpers(conn);
      const executedQueries = [];
      const q = async (sql, args = []) => {
        try { if (debug) executedQueries.push({ sql: String(sql||''), args: Array.isArray(args)? args : [] }); } catch {}
        return qBase(sql, args);
      };
      const hasTable = (t) => _hasTable(t, cfg.database);
      const hasColumn = (t,c) => _hasColumn(t,c, cfg.database);

      // -------- Column length enforcement (truncate + log) --------
      const __colLenCache = new Map();
      const getColMaxLen = async (table, column) => {
        try {
          const key = String(table)+'|'+String(column);
          if (__colLenCache.has(key)) return __colLenCache.get(key);
          const rows = await q(
            'SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1',
            [cfg.database, table, column]
          );
          const n = Array.isArray(rows) && rows.length ? (Number(rows[0].max_len||0)||0) : 0;
          __colLenCache.set(key, n);
          return n;
        } catch { return 0; }
      };
      const enforceRowLimits = async (table, row = {}, ctxInfo = {}) => {
        try {
          const T = String(table);
          for (const [col, val] of Object.entries(row)) {
            if (typeof val !== 'string') continue;
            const max = await getColMaxLen(T, col);
            if (max && val.length > max) {
              const before = val;
              row[col] = before.slice(0, max);
              try {
                await logErr({ table_name: T, op: 'truncate', product_id: ctxInfo.product_id||null, id_shop: ctxInfo.id_shop||null, id_lang: ctxInfo.id_lang||null, error: 'truncated', payload: { column: col, max_len: max, before_len: before.length, after_len: row[col].length } });
              } catch {}
              try { chatLog('truncate', { table: T, col, max, before_len: before.length, after_len: row[col].length, product_id: ctxInfo.product_id||null, id_shop: ctxInfo.id_shop||null, id_lang: ctxInfo.id_lang||null }); } catch {}
            }
          }
        } catch {}
        return row;
      };

      // Resolve mapping (prefer latest from mapping tools; fallback to domain config_transfert)
      // Strict mapping source: body.mapping or mapping_tools.config only (no domain config fallbacks)
      let mapping = explicitMapping || null;
      if (!mapping) {
        try {
          const wantVer = (req.body?.mapping_version != null) ? Number(req.body.mapping_version) : (req.query?.mapping_version != null ? Number(req.query.mapping_version) : null);
          if (wantVer) {
            const r1 = await pool.query(
              `select config from public.mod_grabbing_sensorex_maping_tools
                 where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3
                 limit 1`,
              [domain, type, wantVer]
            );
            if (r1.rowCount) mapping = r1.rows[0]?.config || null;
          } else {
            const r2 = await pool.query(
              `select config from public.mod_grabbing_sensorex_maping_tools
                 where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
                 order by version desc, updated_at desc limit 1`,
              [domain, type]
            );
            if (r2.rowCount) mapping = r2.rows[0]?.config || null;
          }
        } catch {}
      }
      if (!mapping || typeof mapping !== 'object') {
        try { chatLog('mapping_missing', { run_id: run.id, domain, page_type: type, note: 'No mapping.config found (body or tools). No fallback by policy.' }); } catch {}
        return res.status(400).json({ ok:false, error:'mapping_not_found', message:'Mapping config not found for this domain/page_type', mapping_version: (req.body?.mapping_version ?? req.query?.mapping_version ?? null) });
      }
      if (mapping && typeof mapping === 'object' && mapping.config && typeof mapping.config === 'object') {
        mapping = mapping.config;
      }
      // Normalize mapping: promote defaults into table fields (constants) and drop top-level defaults
      try {
        if (mapping && typeof mapping === 'object') {
          const tables = (mapping.tables && typeof mapping.tables==='object') ? mapping.tables : {};
          const defsAll = (mapping.defaults && typeof mapping.defaults==='object') ? mapping.defaults : {};
          let changed = false;
          for (const [tName, defs] of Object.entries(defsAll||{})) {
            try {
              const entry = (tables[tName] && typeof tables[tName]==='object') ? tables[tName] : {};
              const fields = (entry.fields && typeof entry.fields==='object') ? entry.fields : {};
              for (const [col, defVal] of Object.entries(defs||{})) {
                const s = String(defVal);
                fields[col] = (s === '') ? '' : ('='+s);
                changed = true;
              }
              entry.fields = fields;
              tables[tName] = entry;
            } catch {}
          }
          if (changed) {
            mapping.tables = tables;
            mapping.defaults = {};
          }
          // Also normalize nested mapping.fields → fields, then drop empty mapping objects (including empty subkeys)
          try {
            const tnames = Object.keys(tables||{});
            let merged = false;
            for (const tName of tnames) {
              const entry = tables[tName] && typeof tables[tName]==='object' ? tables[tName] : {};
              const top = entry.fields && typeof entry.fields==='object' ? entry.fields : {};
              const nested = entry.mapping && entry.mapping.fields && typeof entry.mapping.fields==='object' ? entry.mapping.fields : {};
              if (Object.keys(nested).length) {
                // Top-level wins on collision; otherwise bring nested across
                entry.fields = { ...nested, ...top };
                try { if (entry.mapping && entry.mapping.fields) entry.mapping.fields = {}; } catch {}
                try {
                  if (entry.mapping) {
                    const md = (entry.mapping.defaults && typeof entry.mapping.defaults==='object') ? entry.mapping.defaults : {};
                    const mf = (entry.mapping.fields && typeof entry.mapping.fields==='object') ? entry.mapping.fields : {};
                    if (!Object.keys(md).length && !Object.keys(mf).length) delete entry.mapping;
                  }
                } catch {}
                tables[tName] = entry;
                merged = true;
              } else if (entry.mapping && typeof entry.mapping==='object') {
                try {
                  const md = (entry.mapping.defaults && typeof entry.mapping.defaults==='object') ? entry.mapping.defaults : {};
                  const mf = (entry.mapping.fields && typeof entry.mapping.fields==='object') ? entry.mapping.fields : {};
                  if (!Object.keys(md).length && !Object.keys(mf).length) { delete entry.mapping; tables[tName] = entry; }
                } catch {}
              }
            }
            if (merged) mapping.tables = tables;
          } catch {}
        }
      } catch {}
      // track mapping version if provided or from latest tool version
      mappingVersion = (bodyObj?.mapping_version != null) ? Number(bodyObj.mapping_version) : (req.query?.mapping_version != null ? Number(req.query.mapping_version) : null);
      if (!mappingVersion) {
        try {
          const rVer = await pool.query(`select version from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc limit 1`, [domain, type]);
          if (rVer.rowCount) mappingVersion = Number(rVer.rows[0].version||0) || null;
        } catch {}
      }
      try { chatLog('mapping_version_resolved', { run_id: run.id, mapping_version: (typeof mappingVersion==='number'? mappingVersion : null) }); } catch {}
      const PREFIX = resolvePrefix(ct, mapping);
      const STRICT_MAPPING_ONLY = true; // always strict mapping only (ignore defaults)
      try { chatLog('mode', { run_id: run.id, strict_mapping_only: !!STRICT_MAPPING_ONLY }); } catch {}
      const TABLES = (mapping && mapping.tables && typeof mapping.tables === 'object') ? mapping.tables : {};
      const ID_LANG = Number(mapping.id_lang || 1) || 1;
      // Determine languages strictly from mapping when provided
      // Priority:
      //  1) <type>_lang.settings.id_langs (product_lang for product, category_lang for category/article/page)
      //  2) mapping.id_langs (top-level)
      //  3) fallback to single mapping.id_lang or 1
      let LANGS = [];
      let langSource = 'fallback_id_lang';
      try {
        const typeLower = String(type||'').toLowerCase();
        const prefLangTable = (typeLower === 'category' || typeLower === 'article' || typeLower === 'page') ? 'category_lang' : 'product_lang';
        const arr1 = (TABLES && TABLES[prefLangTable] && TABLES[prefLangTable].settings && Array.isArray(TABLES[prefLangTable].settings.id_langs)) ? TABLES[prefLangTable].settings.id_langs : [];
        if (arr1.length) { LANGS = arr1.map(n=>Number(n)||0).filter(n=>n>0); langSource = `${prefLangTable}.settings.id_langs`; }
        // If nothing for the preferred table, try the other common one (union not needed for strict mapping semantics)
        if (!LANGS.length) {
          const altTable = (prefLangTable === 'product_lang') ? 'category_lang' : 'product_lang';
          const arr2 = (TABLES && TABLES[altTable] && TABLES[altTable].settings && Array.isArray(TABLES[altTable].settings.id_langs)) ? TABLES[altTable].settings.id_langs : [];
          if (arr2.length) { LANGS = arr2.map(n=>Number(n)||0).filter(n=>n>0); langSource = `${altTable}.settings.id_langs`; }
        }
      } catch {}
      if (!LANGS.length && Array.isArray(mapping.id_langs) && mapping.id_langs.length) {
        LANGS = mapping.id_langs.map(n=>Number(n)||0).filter(n=>n>0);
        langSource = 'mapping.id_langs';
      }
      if (!LANGS.length) { LANGS = [ID_LANG]; langSource = 'fallback_id_lang'; }

      // Load per-table settings (mapping-only). Do not backfill fields from table_settings.
      const { TSET_PRODUCT, TSET_SHOP, TSET_LANG, TSET_STOCK, TSET_ANY: TSET_ANY_RAW, MFIELDS, MDEF, TDEF_STOCK_TBL } = await loadTableSettings(pool, domain, type);
      // Promote top-level mapping.id_groups into category_group.settings.id_groups when missing
      const TSET_ANY = (() => {
        try {
          const o = { ...(TSET_ANY_RAW||{}) };
          const top = Array.isArray(mapping?.id_groups) ? mapping.id_groups.map(n=>Number(n)||0).filter(n=>n>0) : [];
          const cg = (o.category_group && typeof o.category_group==='object') ? { ...o.category_group } : {};
          const cur = Array.isArray(cg.id_groups) ? cg.id_groups.map(n=>Number(n)||0).filter(n=>n>0) : [];
          if (!cur.length && top.length) { cg.id_groups = top; o.category_group = cg; }
          return o;
        } catch { return TSET_ANY_RAW || {}; }
      })();

      // Ignore all defaults (mapping.defaults and per-table defaults) in strict mode
      const DEF_PROD = {};
      const DEF_SHOP = {};

      // Shops (mapping-only): derive strictly from mapping
      let shopsSrc = '';
      let SHOPS = (Array.isArray(TSET_SHOP?.id_shops) && TSET_SHOP.id_shops.length)
        ? (shopsSrc = 'settings.product_shop', TSET_SHOP.id_shops.map(n=>Number(n)||0).filter(n=>n>0))
        : [];
      if (!SHOPS.length) {
        try {
          const fromPaShop = (TABLES && TABLES.product_attribute_shop && TABLES.product_attribute_shop.settings && Array.isArray(TABLES.product_attribute_shop.settings.id_shops)) ? TABLES.product_attribute_shop.settings.id_shops : [];
          if (fromPaShop.length) { SHOPS = fromPaShop.map(n=>Number(n)||0).filter(n=>n>0); shopsSrc = 'mapping.tables.product_attribute_shop.settings.id_shops'; }
        } catch {}
      }
      if (!SHOPS.length) {
        try {
          const fromPShop = (TABLES && TABLES.product_shop && TABLES.product_shop.settings && Array.isArray(TABLES.product_shop.settings.id_shops)) ? TABLES.product_shop.settings.id_shops : [];
          if (fromPShop.length) { SHOPS = fromPShop.map(n=>Number(n)||0).filter(n=>n>0); shopsSrc = 'mapping.tables.product_shop.settings.id_shops'; }
        } catch {}
      }
      if (!SHOPS.length && Array.isArray(mapping.id_shops) && mapping.id_shops.length) {
        SHOPS = mapping.id_shops.map(n=>Number(n)||0).filter(n=>n>0); shopsSrc = 'mapping.id_shops';
      }
      if (!SHOPS.length) {
        try { chatLog('mapping_missing_shops', { run_id: run.id, domain, page_type: type }); } catch {}
        return res.status(400).json({ ok:false, error:'mapping_missing_shops', message:'No shops defined in mapping (id_shops)', mapping_version: (typeof mappingVersion==='number'? mappingVersion : null) });
      }
      // 3) Compute id_shop_default from mapping/settings/shops only
      const ID_SHOP_DEFAULT = (mapping.id_shop_default != null)
        ? Number(mapping.id_shop_default) || (SHOPS[0] || 0)
        : ((TSET_PRODUCT?.id_shop_default != null)
            ? (Number(TSET_PRODUCT.id_shop_default) || (SHOPS[0] || 0))
            : (SHOPS[0] || 0));
      const ID_SHOP_GROUP = (mapping.id_shop_group != null) ? Number(mapping.id_shop_group)||0 : 0;
      try { chatLog('shops_resolved', { run_id: run.id, shops: SHOPS, source: shopsSrc || null, id_shop_default: ID_SHOP_DEFAULT, id_shop_group: ID_SHOP_GROUP }); } catch {}

      // Groups list (mapping-only with auto-promote). Require mapping to provide id_groups when category_group table is used.
      let GROUPS = [];
      let groupsSrc = 'none';
      let groupsActiveFilterUsed = false;
      try {
        const fromTset = (TSET_ANY?.category_group && Array.isArray(TSET_ANY.category_group.id_groups)) ? TSET_ANY.category_group.id_groups.map(n=>Number(n)||0).filter(n=>n>0) : [];
        if (fromTset.length) { GROUPS = fromTset; groupsSrc = 'settings'; }
      } catch {}
      if (!GROUPS.length) {
        try {
          const fromTop = Array.isArray(mapping.id_groups) ? mapping.id_groups.map(n=>Number(n)||0).filter(n=>n>0) : [];
          if (fromTop.length) { GROUPS = fromTop; groupsSrc = 'mapping.id_groups'; }
        } catch {}
      }
      // As a last resort, derive groups from Presta DB and inject into mapping for this run only (requested by user)
      if ((!Array.isArray(GROUPS) || !GROUPS.length)) {
        try {
          const T_GROUP = PREFIX + 'group';
          if (await hasTable(T_GROUP)) {
            const hasActive = await hasColumn(T_GROUP, 'active');
            const rows = await q(`SELECT ${qi('id_group')} as id_group FROM ${qi(T_GROUP)} ${hasActive? 'WHERE '+qi('active')+'=1' : ''} ORDER BY ${qi('id_group')} ASC`);
            const ids = Array.isArray(rows) ? rows.map(r=>Number(r.id_group)||0).filter(n=>n>0) : [];
            if (ids.length) {
              GROUPS = ids; groupsSrc = hasActive ? 'db_active' : 'db_all'; groupsActiveFilterUsed = !!hasActive;
              // Promote into in-memory mapping for consistency during this run
              try { mapping.id_groups = ids; } catch {}
            }
          }
        } catch {}
      }
      // If mapping intends to write category_group or we are in category/article mode, groups must be provided
      const needsGroups = (() => {
        const t = String(type||'').toLowerCase();
        if (t === 'category' || t === 'article') return true;
        try { return !!(TABLES && TABLES.category_group); } catch { return false; }
      })();
      if (needsGroups && (!Array.isArray(GROUPS) || GROUPS.length === 0)) {
        try { chatLog('mapping_missing_groups', { run_id: run.id, domain, page_type: type }); } catch {}
        return res.status(400).json({ ok:false, error:'mapping_missing_groups', message:'No groups defined in mapping (category_group.settings.id_groups or mapping.id_groups).', mapping_version: (typeof mappingVersion==='number'? mappingVersion : null) });
      }

    
      try {
        const TABLES_SAFE = (mapping && mapping.tables && typeof mapping.tables==='object') ? mapping.tables : {};
        const mapSet = (k) => (TABLES_SAFE[k] && typeof TABLES_SAFE[k].settings==='object') ? TABLES_SAFE[k].settings : {};
        const tsetDb = (k) => (TSET_ANY && typeof TSET_ANY==='object' && TSET_ANY[k]) ? TSET_ANY[k] : {};
        const scopeLog = {
          run_id: run.id,
          domain,
          shops: SHOPS,
          langs: LANGS,
          groups: GROUPS,
          id_shop_default_eff: ID_SHOP_DEFAULT,
          base_shop: (SHOPS && SHOPS.length ? SHOPS[0] : null),
          per_table: (function(){
            const t = String(type||'').toLowerCase();
            if (t === 'product') {
              return {
                product_shop: { map: mapSet('product_shop')?.id_shops || null, db: tsetDb('product_shop')?.id_shops || null },
                product_lang: { map: mapSet('product_lang')?.id_shops || null, db: tsetDb('product_lang')?.id_shops || null },
                image:        { map: mapSet('image')?.id_shops || null,        db: tsetDb('image')?.id_shops || null },
                product_attribute_shop: { map: mapSet('product_attribute_shop')?.id_shops || null, db: tsetDb('product_attribute_shop')?.id_shops || null },
              };
            }
            // category/article: show category-related keys if present in mapping/settings
            return {
              category:        { map: TABLES?.category?.settings || null, db: tsetDb('category') || null },
              category_lang:   { map: TABLES?.category_lang?.settings || null, db: tsetDb('category_lang') || null },
              category_shop:   { map: TABLES?.category_shop?.settings || null, db: tsetDb('category_shop') || null },
              category_group:  { map: TABLES?.category_group?.settings || null, db: tsetDb('category_group') || null },
            };
          })()
        };
        chatLog('send_scope', scopeLog);
        // Human-friendly applied shops/langs lines to mirror groups
        try { chatLog('applied_shops', { run_id: run.id, shops: SHOPS, label: (Array.isArray(SHOPS)&&SHOPS.length)? SHOPS.join(',') : 'none' }); } catch {}
        try { chatLog('applied_langs', { run_id: run.id, langs: LANGS, source: langSource }); } catch {}
        // Human-friendly applied groups line (mirrors shops/langs applied logs)
        try {
          let label = 'none';
          if (groupsSrc === 'settings') label = 'mapping id_groups';
          // strictly mapping: no DB-derived groups labels
          chatLog('applied_groups', { run_id: run.id, source: groupsSrc, active_filtered: groupsActiveFilterUsed, groups: GROUPS, label });
        } catch {}
      } catch {}

      // Source data
      const result = run.result && typeof run.result === 'object' ? run.result : (run.result ? JSON.parse(run.result) : {});

      // (Unified non-product gate is implemented below)
      const src = result.product || result.item || result;
      const FIELDS = (mapping && mapping.fields && typeof mapping.fields === 'object') ? mapping.fields : {};
      const F_PRODUCT = (TABLES.product && typeof TABLES.product.fields === 'object') ? TABLES.product.fields : null;
      const F_LANG = (TABLES.product_lang && typeof TABLES.product_lang.fields === 'object') ? TABLES.product_lang.fields : null;
      const F_STOCK = (TABLES.stock_available && typeof TABLES.stock_available.fields === 'object') ? TABLES.stock_available.fields : null;

      const pickPath = (obj, pathStr) => {
        try { if (!pathStr) return undefined; const parts = String(pathStr).replace(/^\$\.?/, '').split('.'); let cur = obj; for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; } return cur; } catch { return undefined; }
      };
      const pickFlex = (pathStr) => {
        if (!pathStr) return undefined; const s = String(pathStr).trim();
        if (s.startsWith('$.')) return pickPath(result, s.slice(2));
        if (s.startsWith('product.')) return pickPath(src, s.slice('product.'.length));
        if (s.startsWith('item.')) return pickPath(src, s.slice('item.'.length));
        if (s.startsWith('meta.')) return pickPath(result, s);
        let v = pickPath(src, s); if (v === undefined || v === null || v === '') v = pickPath(result, s); return v;
      };
      const sanitizeStr = (v) => { try { if (v === undefined || v === null) return ''; let s = String(v); s = s.trim(); const lc = s.toLowerCase(); if (lc === 'undefined' || lc === 'null' || lc === 'nan') return ''; return s; } catch { return ''; } };
      const applyTransforms = (val, transforms=[]) => {
        try {
          let out = val;
          for (const t of (Array.isArray(transforms)? transforms: [])) {
            const op = String(t?.op||'').toLowerCase();
            if (op === 'trim') { out = (out==null? '': String(out)).trim(); continue; }
            if (op === 'replace') {
              const find = String(t?.find||''); const rep = String(t?.replace||'');
              out = String(out==null? '': out).split(find).join(rep);
              continue;
            }
            if (op === 'strip_html') {
              try {
                const s = String(out==null? '': out);
                // naive HTML tag removal; safe enough for meta/short fields
                out = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              } catch {}
              continue;
            }
            if (op === 'truncate') {
              const n = Number(t?.len||t?.n||t?.max||0) || 0;
              if (n > 0) {
                try { const s = String(out==null? '': out); out = s.length>n ? s.slice(0,n) : s; } catch {}
              }
              continue;
            }
            if (op === 'slugify') {
              try { const s = String(out==null? '': out); out = s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); } catch {}
              continue;
            }
          }
          return out;
        } catch { return val; }
      };
      const resolveSpec = (_obj, spec) => {
        if (spec == null) return undefined;
        // Arrays: first non-empty value
        if (Array.isArray(spec)) { for (const s of spec) { const v = resolveSpec(null, s); if (v !== undefined && v !== null && v !== '') return v; } return undefined; }
        // Object form: support constants and transforms/paths
        if (typeof spec === 'object') {
          // Constant literal value
          if (Object.prototype.hasOwnProperty.call(spec, 'const') || Object.prototype.hasOwnProperty.call(spec, 'value')) {
            return (Object.prototype.hasOwnProperty.call(spec, 'const') ? spec.const : spec.value);
          }
          const paths = Array.isArray(spec.paths) ? spec.paths : (spec.path ? [spec.path] : []);
          const wantJoin = String(spec.join||spec.combine||'').toLowerCase();
          if (wantJoin === 'html' || wantJoin === 'html_join' || wantJoin === 'join_html') {
            const parts = [];
            for (const p of paths) {
              const tmp = pickFlex(p);
              if (tmp == null || tmp === '') continue;
              if (Array.isArray(tmp)) {
                for (const it of tmp) { if (it != null && String(it).trim() !== '') parts.push(String(it)); }
              } else {
                parts.push(String(tmp));
              }
            }
            let joined = parts.join('<br/>');
            const outJoined = applyTransforms(joined, spec.transforms || spec.ops || []);
            return typeof outJoined === 'string' ? sanitizeStr(outJoined) : outJoined;
          } else {
            let v;
            for (const p of paths) { const tmp = pickFlex(p); if (tmp !== undefined && tmp !== null && tmp !== '') { v = tmp; break; } }
            if (v === undefined) v = pickFlex(spec.path || spec.p || '');
            const out = applyTransforms(v, spec.transforms || spec.ops || []);
            return typeof out === 'string' ? sanitizeStr(out) : out;
          }
        }
        if (typeof spec === 'string') {
          // Support explicit literal: "" (empty string) or =<literal>
          if (spec === '') return '';
          if (spec === '""' || spec === "''") return '';
          if (spec.startsWith('=')) {
            let v = spec.slice(1);
            if (v === '""' || v === "''") v = '';
            return v;
          }
          const out = pickFlex(spec);
          return typeof out === 'string' ? sanitizeStr(out) : out;
        }
        return spec;
      };
      const gwResolve = (obj, spec) => {
        try { return resolveSpec(obj, spec); } catch { return undefined; }
      };
      const firstDef = (...arr) => { for (const v of arr) { if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
      const toNumber = (v) => { const n = Number(String(v||'').replace(/,/g,'.').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)? n: 0; };
      const toInt = (v) => { const n = parseInt(String(v||'').replace(/[^0-9\-]/g,''),10); return Number.isFinite(n)? n: 0; };

      const val = {
        name: firstDef(F_LANG ? resolveSpec(src, F_LANG.name) : undefined, F_PRODUCT ? resolveSpec(src, F_PRODUCT.name) : undefined, resolveSpec(src, FIELDS.name), resolveSpec(src, ['title','name']), 'Imported Product'),
        description: firstDef(F_LANG ? resolveSpec(src, F_LANG.description) : undefined, F_PRODUCT ? resolveSpec(src, F_PRODUCT.description) : undefined, resolveSpec(src, FIELDS.description), resolveSpec(src, ['description','content']), ''),
        reference: String(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.reference) : undefined, resolveSpec(src, FIELDS.reference), resolveSpec(src, ['sku','reference']), '')),
        supplier_reference: String(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.supplier_reference) : undefined, resolveSpec(src, FIELDS.supplier_reference), resolveSpec(src, ['supplier_reference','mpn']), '')),
        price: toNumber(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.price) : undefined, resolveSpec(src, FIELDS.price), resolveSpec(src, ['price','price_without_tax','price_with_tax']), 0)),
        quantity: toInt(firstDef(F_STOCK ? resolveSpec(src, F_STOCK.quantity) : undefined, resolveSpec(src, FIELDS.quantity), resolveSpec(src, ['quantity','stock.quantity','qty']), 0)),
      };

      // Optional product identifiers resolved from mapping paths (fallback to empty string)
      const valIds = {
        ean13: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.ean13) : undefined, resolveSpec(src, FIELDS.ean13), '')),
        upc: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.upc) : undefined, resolveSpec(src, FIELDS.upc), '')),
        isbn: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.isbn) : undefined, resolveSpec(src, FIELDS.isbn), '')),
        mpn: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.mpn) : undefined, resolveSpec(src, FIELDS.mpn), '')),
      };

      // Detect tables
      const T_PRODUCT = PREFIX + 'product';
      const T_PRODUCT_LANG = PREFIX + 'product_lang';
      const T_PRODUCT_SHOP = PREFIX + 'product_shop';
      const T_STOCK = PREFIX + 'stock_available';
      const hasProduct = await hasTable(T_PRODUCT);
      const hasProductShop = await hasTable(T_PRODUCT_SHOP);
      const hasProductLang = await hasTable(T_PRODUCT_LANG);
      const productLangHasShop = hasProductLang ? await hasColumn(T_PRODUCT_LANG, 'id_shop') : false;

      // Execution metrics for visibility in response
      const steps = { preinserted: false, images: false, documents: false, attributes: false, features: false, generic: false };
      try { chatLog('profile_resolved', { run_id: run.id, profile_id: prof.id, profile_name: prof.name, source: profileSource||null }); } catch {}

      if (!doWrite) {
        chatLog('dry_run_preview', { run_id: run.id, preview: { name: val.name, reference: val.reference, price: val.price, quantity: val.quantity }, checks: { has_product_table: hasProduct } });
        return res.json({ ok:true, mode:'dry_run', run: { id: run.id, url: run.url, page_type: run.page_type, version: run.version }, profile: { id: prof.id, name: prof.name }, checks: { connected: true, has_product_table: hasProduct }, preview: { ...val } });
      }

      // Hard gate: if resolved type is NOT product, do not run any product pipeline; run only generic writer then return
      if (type !== 'product') {
        // Result from generic writer (captures lastIds like category)
        let gwRes = null;
        try {
          const now = new Date();
          const pad = (n)=>String(n).padStart(2,'0');
          const nowFmt = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
          const src = result || {};
          const DEFAULTS = {};
          const ID_SHOP_GROUP = (mapping.id_shop_group != null) ? Number(mapping.id_shop_group)||0 : 0;
          const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
          // Enforce article/category → category tables only in generic writer
          let ALLOW_TABLES = null;
          if (type === 'article' || type === 'category') {
            ALLOW_TABLES = ['category','category_lang','category_shop','category_group'];
          }
          if (SEND.generic !== false) {
            gwRes = await runGenericWriter({ q, qi, hasTable, pool, chatLog, PREFIX, TABLES, TSET_ANY, MFIELDS, DEFAULTS, MDEF: {}, SHOPS, ID_LANG, ID_SHOP_GROUP, LANGS, GROUPS, productId: null, src, domain, run, effectiveType: type, cfgDatabase: cfg.database, fmtDateTime: (d)=>nowFmt, resolveSpec: gwResolve, ALLOW_TABLES });
          } else { chatLog('generic_skipped', { run_id: run.id, reason: 'send.generic=false' }); }
        } catch (e) {
          await logErr({ table_name: PREFIX+'*', op: 'generic', product_id: null, error: e });
          throw e;
        }
        try {
          await pool.query(
            `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
            [ run.id, domain, run.page_type, 'transfer', 'done_generic', null, null, null, 'ok', JSON.stringify({ generic:true }) ]
          );
        } catch { try { chatLog('log_table_insert_failed', { stage: 'done_generic' }); } catch {} }
        const payload = { ok:true, mode:'upsert', product_id: null, category_id: (gwRes && gwRes.lastIds && gwRes.lastIds.category) ? Number(gwRes.lastIds.category)||null : null, generic: true };
        if (debug) payload.debug = { queries: executedQueries };
        if (type !== 'product') {
          try { chatLog('generic_only_return', { run_id: run.id, type, note: 'returned before attributes pipeline' }); } catch {}
          return res.json(payload);
        } else {
          try { chatLog('generic_only_continue_product', { run_id: run.id, note: 'continuing to attributes pipeline' }); } catch {}
          // fall through to attributes/images/features
        }
      }

      // Core upsert: find/insert product
      const now = new Date();
      const pad = (n)=>String(n).padStart(2,'0');
      const nowFmt = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const alwaysInsert = requestedMode === 'insert' || req.body?.always_insert === true;
      const FORCED_PRODUCT_ID = req.body?.product_id != null ? (Number(req.body.product_id)||0) : 0;
      let productId = 0;
      if (!alwaysInsert) {
        if (FORCED_PRODUCT_ID > 0) {
          const rows = await q(`SELECT ${'`id_product`'} FROM ${qi(T_PRODUCT)} WHERE ${qi('id_product')}=? LIMIT 1`, [FORCED_PRODUCT_ID]);
          if (rows && rows.length) {
            productId = FORCED_PRODUCT_ID;
          } else {
            // Graceful fallback: ignore the forced id when it no longer exists
            try { chatLog('forced_product_not_found_fallback', { run_id: run.id, forced_id: FORCED_PRODUCT_ID, note: 'id_product not found; falling back to reference/name/pre-insert flow' }); } catch {}
            // do NOT return; allow reference/name lookup and pre-insert paths below
          }
        }
        if (!productId && val.reference) {
          const rows = await q(`SELECT ${qi('id_product')} FROM ${qi(T_PRODUCT)} WHERE ${qi('reference')}=? LIMIT 1`, [val.reference]);
          if (rows && rows.length) productId = Number(rows[0].id_product||0)||0;
        }
      if (!productId && val.name && hasProductLang) {
        const rows = await q(`SELECT p.${qi('id_product')} FROM ${qi(T_PRODUCT)} p JOIN ${qi(T_PRODUCT_LANG)} pl ON pl.${qi('id_product')}=p.${qi('id_product')} WHERE pl.${qi('id_lang')}=? AND pl.${qi('name')}=? LIMIT 1`, [ID_LANG, String(val.name)]);
        if (rows && rows.length) productId = Number(rows[0].id_product||0)||0;
      }
      }

      // Resolve tax rules group from mapping/settings/defaults
      const productTaxRulesGroup = Number((mapping.id_tax_rules_group ?? TSET_PRODUCT?.id_tax_rules_group ?? 0)) || 0;
      const shopTaxRulesGroup = Number((mapping.id_tax_rules_group ?? TSET_SHOP?.id_tax_rules_group ?? TSET_PRODUCT?.id_tax_rules_group ?? 0)) || 0;
      const ID_SHOP_DEFAULT_EFF = (mapping.id_shop_default != null)
        ? (Number(mapping.id_shop_default)||SHOPS[0])
        : ((TSET_PRODUCT?.id_shop_default != null)
            ? (Number(TSET_PRODUCT.id_shop_default)||SHOPS[0])
            : ((DEF_PROD?.id_shop_default != null)
                ? (Number(DEF_PROD.id_shop_default)||SHOPS[0])
                : SHOPS[0]));

      // Ensure a product row exists for product runs: if we still have no id after lookup, pre-insert now
      if (!productId && hasProduct) {
        try {
          const cols = [];
          const args = [];
          const hasCol = async (c) => await hasColumn(T_PRODUCT, c);
          if (await hasCol('active')) { cols.push(qi('active')); args.push(1); }
          try { if (await hasCol('id_tax_rules_group')) { cols.push(qi('id_tax_rules_group')); args.push(productTaxRulesGroup || 0); } } catch {}
          try { if (await hasCol('id_category_default')) { const v = Number(mapping.id_category_default ?? TSET_PRODUCT?.id_category_default ?? 0) || 0; cols.push(qi('id_category_default')); args.push(v); } } catch {}
          try { if (await hasCol('id_shop_default')) { const sdef = (mapping.id_shop_default != null) ? Number(mapping.id_shop_default)||0 : ((Array.isArray(SHOPS)&&SHOPS.length)? SHOPS[0] : 0); cols.push(qi('id_shop_default')); args.push(sdef||0); } } catch {}
          if (await hasCol('date_add')) { cols.push(qi('date_add')); args.push(nowFmt); }
          if (await hasCol('date_upd')) { cols.push(qi('date_upd')); args.push(nowFmt); }
          if (cols.length) {
            const sql = `INSERT INTO ${qi(T_PRODUCT)} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
            await q(sql, args);
          } else {
            await q(`INSERT INTO ${qi(T_PRODUCT)} () VALUES ()`, []);
          }
          const rid0 = await q('SELECT LAST_INSERT_ID() AS id', []);
          const nid0 = Array.isArray(rid0) && rid0.length ? Number(rid0[0].id||0) : 0;
          if (nid0 > 0) productId = nid0;
          steps.preinserted = true;
          chatLog?.('product_preinsert', { run_id: run.id, product_id: productId, phase: 'early' });
        } catch (e) { await logErr({ table_name: T_PRODUCT, op: 'early_insert', product_id: null, error: e }); }
      }

      // Unified dynamic mode: prefer generic writer for all tables (after seeding product)
      // Respect mapping.flags.unified_dynamic (default true)
      let unifiedDynamic = true;
      try {
        const f = mapping && mapping.flags;
        if (typeof f?.unified_dynamic === 'boolean') unifiedDynamic = !!f.unified_dynamic;
      } catch {}
      // Caller explicitly wants a fresh product: force unified dynamic so we pre-insert and return a product_id
      if (requestedMode === 'insert' || req.body?.always_insert === true) unifiedDynamic = true;
      if (unifiedDynamic) {
        // If caller requested a guaranteed new product, pre-insert a minimal row to get a fresh id
        if (alwaysInsert && !productId && hasProduct) {
          try {
            const cols = [];
            const args = [];
            const hasCol = async (c) => await hasColumn(T_PRODUCT, c);
            if (await hasCol('active')) { cols.push(qi('active')); args.push(1); }
            // Provide required NOT NULL fields when present on schema
            try { if (await hasCol('id_tax_rules_group')) { cols.push(qi('id_tax_rules_group')); args.push(productTaxRulesGroup || 0); } } catch {}
            try { if (await hasCol('id_category_default')) { const v = Number(mapping.id_category_default ?? TSET_PRODUCT?.id_category_default ?? 0) || 0; cols.push(qi('id_category_default')); args.push(v); } } catch {}
            try { if (await hasCol('id_shop_default')) { const sdef = (mapping.id_shop_default != null) ? Number(mapping.id_shop_default)||0 : ((Array.isArray(SHOPS)&&SHOPS.length)? SHOPS[0] : 0); cols.push(qi('id_shop_default')); args.push(sdef||0); } } catch {}
            if (await hasCol('date_add')) { cols.push(qi('date_add')); args.push(nowFmt); }
            if (await hasCol('date_upd')) { cols.push(qi('date_upd')); args.push(nowFmt); }
            if (cols.length) {
              const sql = `INSERT INTO ${qi(T_PRODUCT)} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
              await q(sql, args);
            } else {
              // Fallback: rely on defaults
              await q(`INSERT INTO ${qi(T_PRODUCT)} () VALUES ()`, []);
            }
            const rid = await q('SELECT LAST_INSERT_ID() AS id', []);
            const nid = Array.isArray(rid) && rid.length ? Number(rid[0].id||0) : 0;
            if (nid > 0) productId = nid;
            chatLog?.('product_preinsert', { run_id: run.id, product_id: productId });
            steps.preinserted = steps.preinserted || (productId>0);
          } catch (e) {
            chatLog?.('product_preinsert_failed', { error: String(e?.message||e) });
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
                [ run.id, domain, run.page_type, T_PRODUCT, 'insert', null, String(e?.message||e), JSON.stringify({ stage:'preinsert' }) ]
              );
            } catch {}
          }
        }
        // Fully generic flow: auto-insert product (PK) and then update all mapped tables
        const allTables = Object.keys(TABLES||{});
        // Exclude image tables and combination tables from generic writer when we will run dedicated pipelines
        const exclude = new Set(['image','image_shop','image_lang','product_attribute','product_attribute_shop','product_attribute_combination','product_attribute_lang','product_attribute_image']);
        // Option B: allow PA Shop via generic writer when explicit fields exist
        try { const hasPASHOPFields = !!(mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields && Object.keys(mapping.tables.product_attribute_shop.fields).length); if (hasPASHOPFields) exclude.delete('product_attribute_shop'); } catch {}
        const allow = allTables.filter(t => !exclude.has(String(t)));
        await runGenericWriter({ q, qi, hasTable, pool, chatLog, PREFIX, TABLES, TSET_ANY, MFIELDS, DEFAULTS: {}, MDEF: {}, SHOPS, ID_LANG, ID_SHOP_GROUP, ID_SHOP_DEFAULT, LANGS, GROUPS, productId: productId||0, src, domain, run, cfgDatabase: cfg.database, fmtDateTime: (d)=>nowFmt, resolveSpec: gwResolve, strictMappingOnly: STRICT_MAPPING_ONLY, includeHandled: true, autoInsertIfMissingPk: true, ALLOW_TABLES: allow, mapping });
        // After generic writer, resolve product id (inserted or existing) so downstream pipelines get a valid id
        try {
          if (!productId) {
            if (val.reference) {
              const rows = await q(`SELECT ${qi('id_product')} FROM ${qi(T_PRODUCT)} WHERE ${qi('reference')}=? ORDER BY ${qi('id_product')} DESC LIMIT 1`, [val.reference]);
              if (rows && rows.length) productId = Number(rows[0].id_product||0)||0;
            }
            if (!productId && val.name && hasProductLang) {
              const rows = await q(`SELECT p.${qi('id_product')} FROM ${qi(T_PRODUCT)} p JOIN ${qi(T_PRODUCT_LANG)} pl ON pl.${qi('id_product')}=p.${qi('id_product')} WHERE pl.${qi('id_lang')}=? AND pl.${qi('name')}=? ORDER BY p.${qi('id_product')} DESC LIMIT 1`, [ID_LANG, String(val.name)]);
              if (rows && rows.length) productId = Number(rows[0].id_product||0)||0;
            }
          }
        } catch {}
      } else {
        if (alwaysInsert && !productId && hasProduct) {
          try {
            const cols = [];
            const args = [];
            const hasCol = async (c) => await hasColumn(T_PRODUCT, c);
            if (await hasCol('active')) { cols.push(qi('active')); args.push(1); }
            try { if (await hasCol('id_tax_rules_group')) { cols.push(qi('id_tax_rules_group')); args.push(productTaxRulesGroup || 0); } } catch {}
            try { if (await hasCol('id_category_default')) { const v = Number(mapping.id_category_default ?? TSET_PRODUCT?.id_category_default ?? 0) || 0; cols.push(qi('id_category_default')); args.push(v); } } catch {}
            try { if (await hasCol('id_shop_default')) { const sdef = (mapping.id_shop_default != null) ? Number(mapping.id_shop_default)||0 : ((Array.isArray(SHOPS)&&SHOPS.length)? SHOPS[0] : 0); cols.push(qi('id_shop_default')); args.push(sdef||0); } } catch {}
            if (await hasCol('date_add')) { cols.push(qi('date_add')); args.push(nowFmt); }
            if (await hasCol('date_upd')) { cols.push(qi('date_upd')); args.push(nowFmt); }
            if (cols.length) {
              const sql = `INSERT INTO ${qi(T_PRODUCT)} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
              await q(sql, args);
            } else {
              await q(`INSERT INTO ${qi(T_PRODUCT)} () VALUES ()`, []);
            }
            const rid = await q('SELECT LAST_INSERT_ID() AS id', []);
            const nid = Array.isArray(rid) && rid.length ? Number(rid[0].id||0) : 0;
            if (nid > 0) productId = nid;
            chatLog?.('product_preinsert', { run_id: run.id, product_id: productId });
          } catch (e) {
            chatLog?.('product_preinsert_failed', { error: String(e?.message||e) });
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
                [ run.id, domain, run.page_type, T_PRODUCT, 'insert', null, String(e?.message||e), JSON.stringify({ stage:'preinsert' }) ]
              );
            } catch {}
          }
        }
        // Non-unified path: fully generic as well
        const allTables = Object.keys(TABLES||{});
        const exclude = new Set(['image','image_shop','image_lang','product_attribute','product_attribute_shop','product_attribute_combination','product_attribute_lang','product_attribute_image']);
        // Option B: allow PA Shop via generic writer when explicit fields exist
        try { const hasPASHOPFields = !!(mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields && Object.keys(mapping.tables.product_attribute_shop.fields).length); if (hasPASHOPFields) exclude.delete('product_attribute_shop'); } catch {}
        const allow = allTables.filter(t => !exclude.has(String(t)));
        await runGenericWriter({ q, qi, hasTable, pool, chatLog, PREFIX, TABLES, TSET_ANY, MFIELDS, DEFAULTS: {}, MDEF: {}, SHOPS, ID_LANG, ID_SHOP_GROUP, ID_SHOP_DEFAULT, LANGS, GROUPS, productId: productId||0, src, domain, run, cfgDatabase: cfg.database, fmtDateTime: (d)=>nowFmt, resolveSpec: gwResolve, strictMappingOnly: STRICT_MAPPING_ONLY, includeHandled: true, autoInsertIfMissingPk: true, ALLOW_TABLES: allow, mapping });
        // After generic writer, resolve product id (inserted or existing)
        try {
          if (!productId) {
            if (val.reference) {
              const rows = await q(`SELECT ${qi('id_product')} FROM ${qi(T_PRODUCT)} WHERE ${qi('reference')}=? ORDER BY ${qi('id_product')} DESC LIMIT 1`, [val.reference]);
              if (rows && rows.length) productId = Number(rows[0].id_product||0)||0;
            }
            if (!productId && val.name && hasProductLang) {
              const rows = await q(`SELECT p.${qi('id_product')} FROM ${qi(T_PRODUCT)} p JOIN ${qi(T_PRODUCT_LANG)} pl ON pl.${qi('id_product')}=p.${qi('id_product')} WHERE pl.${qi('id_lang')}=? AND pl.${qi('name')}=? ORDER BY p.${qi('id_product')} DESC LIMIT 1`, [ID_LANG, String(val.name)]);
              if (rows && rows.length) productId = Number(rows[0].id_product||0)||0;
            }
          }
        } catch {}
      }

      // Split writers pipeline (images, documents, attributes, features, generic)
      // Accumulator for image pipeline (exposed to response details)
      let IMAGE_INFO = null;
      // Images pipeline (product-only)
      try {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        // Merge top-level image_setting (authoritative) into TSET_ANY.image for runtime
        const IMAGE_SETTING = (mapping && typeof mapping.image_setting === 'object') ? mapping.image_setting : null;
        const TSET_ANY_IMG = (() => { const o = { ...(TSET_ANY || {}) }; if (IMAGE_SETTING) o.image = { ...(o.image || {}), ...IMAGE_SETTING }; return o; })();
        if (type === 'product' && SEND.images !== false) {
          try {
            IMAGE_INFO = await runImagesPipeline({ q, qi, hasTable, hasColumn, pool, chatLog, run, result, domain, productId, PREFIX, TSET_LANG, TSET_ANY: TSET_ANY_IMG, TABLES, SHOPS, ID_LANG, fmtDateTime: (d)=>nowFmt, ensureImageMapTable });
          } catch (e) { IMAGE_INFO = null; }
          steps.images = true;
        } else { chatLog('images_skipped', { run_id: run.id }); }
      } catch (e) {
        await logErr({ table_name: PREFIX+'image', op: 'pipeline', product_id: productId, error: e });
      }

      // Documents/Attachments pipeline (product-only)
      try {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        // In unified_dynamic mode, still run when there are documents in the result or explicit document table settings exist
        const wantDocs = (type === 'product') && (SEND.documents !== false);
        if (wantDocs) {
          await runDocumentsPipeline({ q, qi, hasTable, hasColumn, chatLog, pool, run, result, productId, PREFIX, TSET_ANY, TABLES, SHOPS, ID_LANG, fmtDateTime: (d)=>nowFmt, domain });
          steps.documents = true;
        } else { chatLog('documents_skipped', { run_id: run.id, reason: 'send_flag' }); }
      } catch (e) {
        await logErr({ table_name: PREFIX+'attachment', op: 'pipeline', product_id: productId, error: e });
      }

      // Attributes/Combinations (product-only)
      const DEF_ATTR = {};
      const DEF_ATTR_SHOP = {};
      try {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        const hasVariantItems = Array.isArray(result?.variants?.items) && result.variants.items.length > 0;
        const FORCE_MIN = (req.body?.force_min_combination === true) || ((mapping?.flags && mapping.flags.force_min_combination === true));
        // Also run when explicit mapping exists for product_attribute or product_attribute_shop (to apply constants like =5)
        const hasPAFields = !!(mapping && mapping.tables && mapping.tables.product_attribute && mapping.tables.product_attribute.fields && Object.keys(mapping.tables.product_attribute.fields).length);
        const hasPASHOPFields = !!(mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields && Object.keys(mapping.tables.product_attribute_shop.fields).length);
        const needAttrPass = hasVariantItems || FORCE_MIN || hasPAFields || hasPASHOPFields;
        // Prolog breadcrumb to prove attributes gate inputs
        try { chatLog('attributes_gate_prolog', { run_id: run.id, type, hasTables: !!(mapping && mapping.tables), hasPAFields, hasPASHOPFields }); } catch {}
        // Gate debug: why attributes would skip
        try { chatLog('attributes_gate', { run_id: run.id, type, send_attributes: SEND.attributes !== false, hasVariantItems, FORCE_MIN: !!FORCE_MIN, hasPAFields, hasPASHOPFields, needAttrPass }); } catch {}
        // Always run attributes writer for products when attributes are enabled
        // This guarantees ps_product_attribute_shop map-all runs even without variants
        if (type === 'product' && SEND.attributes !== false) {
          try { chatLog('attributes_always', { run_id: run.id, reason: 'forced_for_product', hasVariantItems, hasPAFields, hasPASHOPFields }); } catch {}
          await runAttributesWriter({ q, qi, hasTable, hasColumn, pool, chatLog, PREFIX, productId, SHOPS, ID_LANG, ID_SHOP_GROUP, mapping, result, DEF_ATTR, DEF_ATTR_SHOP, run, domain, forceCreateEmptyCombination: !!FORCE_MIN, strictMappingOnly: STRICT_MAPPING_ONLY });
          steps.attributes = true;
        } else { chatLog('attributes_skipped', { run_id: run.id, reason: (SEND.attributes === false ? 'send_flag' : 'not_product') }); }
      } catch (e) {
        await logErr({ table_name: PREFIX+'product_attribute', op: 'pipeline', product_id: productId, error: e });
      }

      // Features mapping (product-only)
      try {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        if (type === 'product' && SEND.features !== false) {
          await runFeaturesWriter({ q, qi, hasTable, pool, chatLog, PREFIX, productId, SHOPS, ID_LANG, TABLES, result, run, domain });
          steps.features = true;
        } else { chatLog('features_skipped', { run_id: run.id, reason: 'send_flag' }); }
      } catch (e) {
        await logErr({ table_name: PREFIX+'feature', op: 'pipeline', product_id: productId, error: e });
      }

      // Generic writer for remaining mapped tables (exclude images/attachments/combination tables handled by dedicated pipelines)
      {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        if (SEND.generic !== false) {
          const allTables = Object.keys(TABLES||{});
          const exclude = new Set([
            'image','image_shop','image_lang',
            'attachment','attachment_lang','attachment_shop','product_attachment',
            'product_attribute','product_attribute_shop','product_attribute_combination','product_attribute_lang','product_attribute_image'
          ]);
          // Allow PA Shop via generic writer when explicit fields exist (fallback; attributes pass still runs)
          // Do not allow generic-writer to touch product_attribute_shop (skipped by request)
          try { /* intentionally keep product_attribute_shop excluded even if fields exist */ } catch {}
          const allow = allTables.filter(t => !exclude.has(String(t)));
          await runGenericWriter({ q, qi, hasTable, pool, chatLog, PREFIX, TABLES, TSET_ANY, MFIELDS, DEFAULTS: {}, MDEF: {}, SHOPS, ID_LANG, ID_SHOP_GROUP, ID_SHOP_DEFAULT, LANGS, GROUPS, productId, src, domain, run, cfgDatabase: cfg.database, fmtDateTime: (d)=>nowFmt, resolveSpec: gwResolve, strictMappingOnly: STRICT_MAPPING_ONLY, includeHandled: true, autoInsertIfMissingPk: true, ALLOW_TABLES: allow, mapping });
          steps.generic = true;
        } else { chatLog('generic_skipped', { run_id: run.id }); }
      }

      // Post-pass: fill product_attribute_shop from mapping constants after combinations exist
      try {
        const PAS = mapping?.tables?.product_attribute_shop?.fields || {};
        const shopsList = Array.isArray(mapping?.tables?.product_attribute_shop?.settings?.id_shops)
          ? mapping.tables.product_attribute_shop.settings.id_shops : SHOPS;
        // numeric-like columns we can safely coerce and set by constants
        // Note: exclude 'default_on' to avoid violating UNIQUE(id_product,id_shop,default_on)
        // Non-default combinations should keep NULL, and default is managed by the attributes pipeline
        const numeric = new Set(['price','wholesale_price','weight','ecotax','unit_price_impact','minimal_quantity','low_stock_alert','low_stock_threshold']);
        for (const SID of shopsList) {
          const assigns = [];
          for (const [k, v] of Object.entries(PAS||{})) {
            if (!numeric.has(String(k))) continue;
            if (typeof v !== 'string' || !v.startsWith('=')) continue;
            const num = Number(String(v.slice(1)).replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
            if (!Number.isFinite(num)) continue;
            // Qualify target columns with the update table alias to avoid ambiguity (both pa and pas have 'price')
            assigns.push('pas.`'+k+'`='+num);
          }
          if (!assigns.length) continue;
          const sql = `UPDATE \`${PREFIX}product_attribute_shop\` pas\n            JOIN \`${PREFIX}product_attribute\` pa ON pa.id_product_attribute=pas.id_product_attribute\n            SET ${assigns.join(', ')}\n            WHERE pa.id_product=? AND pas.id_shop=?`;
          await q(sql, [productId, SID]);
          try { chatLog('pattr_shop_sql_post', { product_id: productId, shop: SID, sql }); } catch {}
          try {
            await pool.query(
              `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs
                 (run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,sql_query,payload)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
               on conflict (run_id, table_name, op, id_shop, id_lang)
               do update set count=public.mod_grabbing_sensorex_send_to_presta_success_logs.count + EXCLUDED.count, sql_query=EXCLUDED.sql_query, updated_at=now()`,
              [ run.id||null, domain||null, run.page_type||null, PREFIX+'product_attribute_shop', 'update', productId||null, SID||null, null, 1, sql, JSON.stringify({ mode:'post_pass' }) ]
            );
          } catch {}
          // Mirror per-field assignments as diagnostics (applies constants across all combinations for the product/shop)
          try {
            for (const [k, v] of Object.entries(PAS||{})) {
              if (!numeric.has(String(k))) continue;
              if (typeof v !== 'string' || !v.startsWith('=')) continue;
              const num = Number(String(v.slice(1)).replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
              if (!Number.isFinite(num)) continue;
              try { chatLog('upsert_field', { table: PREFIX+'product_attribute_shop', run_id: run.id, id_product: productId||null, id_shop: SID||null, id_lang: null, id_group: null, field: String(k), value: num }); } catch {}
              try { await pool.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [run.id||null, domain||null, run?.page_type||null, PREFIX+'product_attribute_shop', productId||null, SID||null, null, null, String(k), String(num)]); } catch {}
            }
          } catch {}
          // Safe fallback: if PAS.price is declared in mapping but remains NULL/0 after writes, mirror from product_attribute.price
          try {
            const hasPriceDeclared = Object.prototype.hasOwnProperty.call(PAS||{}, 'price');
            if (hasPriceDeclared) {
              const sqlPrice = `UPDATE \`${PREFIX}product_attribute_shop\` pas\n                JOIN \`${PREFIX}product_attribute\` pa ON pa.id_product_attribute=pas.id_product_attribute\n                SET pas.\`price\` = pa.\`price\`\n                WHERE pa.id_product=? AND pas.id_shop=? AND (pas.\`price\` IS NULL OR pas.\`price\`=0) AND pa.\`price\` IS NOT NULL AND pa.\`price\`<>0`;
              await q(sqlPrice, [productId, SID]);
              try { chatLog('pattr_shop_price_fallback_from_pa', { product_id: productId, shop: SID }); } catch {}
              try {
                await pool.query(
                  `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs
                     (run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,sql_query,payload)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
                   on conflict (run_id, table_name, op, id_shop, id_lang)
                   do update set count=public.mod_grabbing_sensorex_send_to_presta_success_logs.count + EXCLUDED.count, sql_query=EXCLUDED.sql_query, updated_at=now()`,
                  [ run.id||null, domain||null, run.page_type||null, PREFIX+'product_attribute_shop', 'update', productId||null, SID||null, null, 1, sqlPrice, JSON.stringify({ mode:'post_pass_price_fallback' }) ]
                );
              } catch {}
              try { chatLog('upsert_field', { table: PREFIX+'product_attribute_shop', run_id: run.id, id_product: productId||null, id_shop: SID||null, id_lang: null, id_group: null, field: 'price', value: '[from pa if zero]' }); } catch {}
              try { await pool.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [run.id||null, domain||null, run?.page_type||null, PREFIX+'product_attribute_shop', productId||null, SID||null, null, null, 'price', '[from pa if zero]']); } catch {}
            }
          } catch {}
        }
      } catch (e) { try { chatLog('pattr_shop_post_failed', { product_id: productId, error: String(e?.message||e) }); } catch {} }

      // Post-pass: enforce product_attribute_shop.default_on for the first combination in each shop
      try {
        const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
        const T_PATTR = PREFIX + 'product_attribute';
        const T_PSHOP = PREFIX + 'product_shop';
        const pasHasDefaultOn = await hasColumn(T_PATTR_SHOP, 'default_on');
        if (await hasTable(T_PATTR_SHOP) && pasHasDefaultOn) {
          for (const SID of shopsList) {
            try {
              // Clear existing defaults for this product/shop
              await q(`UPDATE \`${PREFIX}product_attribute_shop\` SET \`default_on\`=NULL WHERE \`id_product\`=? AND \`id_shop\`=?`, [productId, SID]);
            } catch {}
            let setFromShop = false;
            try {
              // Prefer product_shop.cache_default_attribute when available
              const hasShopCda = await hasColumn(T_PSHOP, 'cache_default_attribute');
              if (await hasTable(T_PSHOP) && hasShopCda) {
                await q(`UPDATE \`${PREFIX}product_attribute_shop\` pas
                  JOIN \`${PREFIX}product_shop\` psh ON psh.id_product=pas.id_product AND psh.id_shop=pas.id_shop
                  SET pas.\`default_on\`=1
                  WHERE psh.id_product=? AND psh.id_shop=? AND pas.id_product_attribute=psh.cache_default_attribute`, [productId, SID]);
                try { chatLog('pattr_shop_default_from_pshop', { product_id: productId, shop: SID }); } catch {}
                setFromShop = true; // ignore affected rows; next block is safe idempotent
              }
            } catch {}
            try {
              // Fallback: use product_attribute.default_on=1 if present
              const paHasDefaultOn = await hasColumn(T_PATTR, 'default_on');
              if (await hasTable(T_PATTR) && paHasDefaultOn) {
                await q(`UPDATE \`${PREFIX}product_attribute_shop\` pas
                  JOIN \`${PREFIX}product_attribute\` pa ON pa.id_product_attribute=pas.id_product_attribute
                  SET pas.\`default_on\`=1
                  WHERE pa.id_product=? AND pas.id_shop=? AND pa.\`default_on\`=1`, [productId, SID]);
                try { chatLog('pattr_shop_default_from_pa', { product_id: productId, shop: SID }); } catch {}
              }
            } catch {}
          }
        }
      } catch (e) { try { chatLog('pattr_shop_default_failed', { product_id: productId, error: String(e?.message||e) }); } catch {} }

      // Final safeguard: if product_id is still zero and product table exists, create a minimal product row
      if ((Number(productId)||0) === 0 && hasProduct) {
        try {
          const cols = [];
          const args = [];
          const hasCol = async (c) => await hasColumn(T_PRODUCT, c);
          if (await hasCol('active')) { cols.push(qi('active')); args.push(1); }
          try { if (await hasCol('id_tax_rules_group')) { cols.push(qi('id_tax_rules_group')); args.push(productTaxRulesGroup || 0); } } catch {}
          try { if (await hasCol('id_category_default')) { const v = Number(mapping.id_category_default ?? TSET_PRODUCT?.id_category_default ?? 0) || 0; cols.push(qi('id_category_default')); args.push(v); } } catch {}
          try { if (await hasCol('id_shop_default')) { const sdef = (mapping.id_shop_default != null) ? Number(mapping.id_shop_default)||0 : ((Array.isArray(SHOPS)&&SHOPS.length)? SHOPS[0] : 0); cols.push(qi('id_shop_default')); args.push(sdef||0); } } catch {}
          if (await hasCol('date_add')) { cols.push(qi('date_add')); args.push(nowFmt); }
          if (await hasCol('date_upd')) { cols.push(qi('date_upd')); args.push(nowFmt); }
          if (cols.length) {
            const sql = `INSERT INTO ${qi(T_PRODUCT)} (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
            await q(sql, args);
          } else {
            await q(`INSERT INTO ${qi(T_PRODUCT)} () VALUES ()`, []);
          }
          const rid = await q('SELECT LAST_INSERT_ID() AS id', []);
          const nid = Array.isArray(rid) && rid.length ? Number(rid[0].id||0) : 0;
          if (nid > 0) productId = nid;
          chatLog?.('product_preinsert_fallback', { run_id: run.id, product_id: productId });
        } catch (e) { await logErr({ table_name: T_PRODUCT, op: 'fallback_insert', product_id: null, error: e }); }
      }

      chatLog('upsert_done', { run_id: run.id, product_id: productId });

      // legacy core block removed (split writers path is default)
      // Persist product_id on the run record
      try { await pool.query(`update public.mod_grabbing_sensorex_extraction_runs set product_id=$2, updated_at=now() where id=$1`, [run.id, productId||null]); } catch {}

      // (legacy core block was removed above; do not re-run pipelines)
      try {
        await pool.query(
          `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [ run.id, domain, run.page_type, 'transfer', 'done', productId||null, null, null, 'ok', JSON.stringify({ product_id: productId||null }) ]
        );
      } catch { try { chatLog('log_table_insert_failed', { stage: 'done' }); } catch {} }
      // persist mapping version/config + transfer summary onto the run (best-effort)
      try {
        const summary = { mode: 'upsert', product_id: productId, values: { ...val } };
        await pool.query(`update public.mod_grabbing_sensorex_extraction_runs set product_id=$2, mapping_version=$3, mapping=$4::jsonb, transfer=$5::jsonb, updated_at=now() where id=$1`, [run.id, productId||null, mappingVersion, JSON.stringify(mapping||{}), JSON.stringify(summary)]);
      } catch {}
      // Expose convenience flags/aliases for UI logging
      const payload = {
        ok: true,
        mode: 'upsert',
        product_id: productId,
        // versions (snake_case + camelCase aliases)
        used_version: (run && run.version != null) ? Number(run.version) : null,
        usedVersion: (run && run.version != null) ? Number(run.version) : null,
        mapping_version: (typeof mappingVersion === 'number' ? mappingVersion : null),
        mappingVersion: (typeof mappingVersion === 'number' ? mappingVersion : null),
        // best-effort updated flag (true when we ran writers in write mode)
        updated: !!doWrite,
        values: { ...val },
        details: {
          prefix: PREFIX,
          unified_dynamic: unifiedDynamic,
          shops: SHOPS,
          langs: LANGS,
          preinserted: !!steps.preinserted,
          ran: { images: !!steps.images, documents: !!steps.documents, attributes: !!steps.attributes, features: !!steps.features, generic: !!steps.generic },
          mapping_version: (typeof mappingVersion === 'number' ? mappingVersion : null),
          profile: { id: prof.id, name: prof.name, source: profileSource||null },
          images: IMAGE_INFO || null
        }
      };
      if (debug) payload.debug = { queries: executedQueries };
      return res.json(payload);
    } catch (e) {
      await (async () => { try { await logErr({ table_name: 'connect', op: 'connect_mysql', error: e }); } catch {} })();
      return res.status(500).json({ ok:false, error:'connect_failed', message: e?.message || String(e) });
    } finally {
      try { if (conn) await conn.end(); } catch {}
    }
  } catch (e) {
    try {
      const runId = Number(req.body?.run_id || req.body?.id || 0) || 0;
      // best-effort: log without run context if loading run failed
      await utils?.pool?.query(
        `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [ runId || null, null, null, 'transfer', 'service', null, null, null, String(e?.message||e), JSON.stringify({}) ]
      );
    } catch {}
    try { chatLog('transfer_error', { run_id: Number(req.body?.run_id||0)||0, error: String(e?.message||e) }); } catch {}
    return res.status(500).json({ ok:false, error:'transfer_failed', message: e?.message || String(e) });
  }
}

export const handleSendToPresta = sendToPresta;


