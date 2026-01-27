// Transfer entrypoint (Send-to-Presta) and orchestration of split subroutes
// Loader-agnostic: works under both CJS and ESM loaders.
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

export function registerGrabbingSensorexTransferRoutes(app, ctx = {}, utils = {}) {
  if (!app) return;
  // Dynamically import and register sub-route groups to avoid static ESM imports
  // removed validate-mapping route (unused)
  (async () => { try { const m = await import('./transfer.schema.routes.js'); if (m && typeof m.registerGrabbingSensorexTransferSchemaRoutes === 'function') m.registerGrabbingSensorexTransferSchemaRoutes(app, ctx, utils); } catch {} })();
  // Unified: Send to Presta (delegates to ESM service)
  try {
    const callSend = async (req, res) => {
      try {
        try {
          const log = (utils && typeof utils.chatLog === 'function') ? utils.chatLog : (ctx && typeof ctx.chatLog === 'function' ? ctx.chatLog : null);
          if (log) log('transfer_route_enter', { route: '/api/grabbing-sensorex/transfer/prestashop' });
        } catch {}
        const esmUrl = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'services', 'transfer.service.js')).href;
        const esm = await import(esmUrl);
        const fn = esm?.sendToPresta || esm?.default?.sendToPresta;
        if (typeof fn === 'function') return fn(req, res, ctx, utils);
      } catch (_) { try { res.status(500).json({ ok:false, error:'send_service_missing' }); } catch {} }
    };
    app.post('/api/grabbing-sensorex/transfer/prestashop', callSend);
  } catch {}

  // Preview upsert tables/columns for a run (no writes) — parity with grabbing-jerome
  try {
    app.post('/api/grabbing-sensorex/transfer/prestashop/preview-tables', async (req, res) => {
      try {
        const { pool, normDomain, chatLog, ensureExtractionRunsTable } = utils || {};
        if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
        try { if (typeof ensureExtractionRunsTable === 'function') await ensureExtractionRunsTable(); } catch {}
        const runId = Number(req.body?.run_id || req.body?.id || 0) || 0;
        const explicitProfileId = req.body?.profile_id != null ? Number(req.body.profile_id) : null;
        const explicitMapping = (req.body && typeof req.body.mapping === 'object') ? req.body.mapping : null;
        if (!runId) return res.status(400).json({ ok:false, error:'bad_request', message:'run_id required' });
        const rr = await pool.query(`select id, domain, url, page_type, version, result from public.mod_grabbing_sensorex_extraction_runs where id=$1`, [runId]);
        if (!rr.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
        const run = rr.rows[0];
        const domain = typeof normDomain === 'function' ? normDomain(run.domain) : String(run.domain||'').toLowerCase().replace(/^www\./,'');
        try { if (typeof chatLog === 'function') chatLog('preview_start', { run_id: run.id, domain, url: run.url }); } catch {}

        // Resolve profile id (explicit first, else from domain config)
        let profileId = explicitProfileId;
        let ct = {};
        if (!profileId && domain) {
          try {
            const d = await pool.query(`select config_transfert from public.mod_grabbing_sensorex_domains where domain=$1`, [domain]);
            ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
            if (ct && typeof ct === 'object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id) || null;
          } catch {}
        }
        if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile' });

        // Load MySQL profile and connect
        const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
        if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
        const prof = pr.rows[0];
        let mysql = null; try { const mod = await import('../../../db-mysql/backend/utils/mysql2.js'); mysql = await mod.getMysql2(ctx); } catch (e) { return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' }); }
        const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized: false } : undefined };

        let conn;
        try {
          conn = await mysql.createConnection(cfg);
          const q = async (sql, args=[]) => { const [rows] = await conn.query(sql, args); return rows; };
          const qi = (ident) => '`' + String(ident||'').replace(/`/g, '``') + '`';
          const hasTable = async (name) => { const rows = await q('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, name]); return Array.isArray(rows)&&rows.length>0; };
          const hasColumn = async (table, col) => { const rows = await q('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [cfg.database, table, col]); return Array.isArray(rows)&&rows.length>0; };
          const getColMaxLen = async (table, column) => {
            try { const rows = await q('SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [cfg.database, table, column]); const len = (Array.isArray(rows) && rows.length) ? Number(rows[0].max_len||0) : 0; return len || 0; } catch { return 0; }
          };
          const slugify = (s) => String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'product';
          const now = new Date();
          const fmtDateTime = (d) => { try { const p=(n)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; } catch { return '1970-01-01 00:00:00'; } };
          const nowFmt = fmtDateTime(now);

          // Resolve mapping (prefer latest from mapping tools; fallback to domain config)
          const type = String((req.body?.force_page_type || req.body?.page_type || run.page_type || '')).trim().toLowerCase() || 'product';
          let toolMap = null; try { const rMap = await pool.query(`select config from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc, updated_at desc limit 1`, [domain, type]); if (rMap.rowCount) toolMap = rMap.rows[0]?.config || null; } catch {}
          const savedMap = toolMap || (ct && ct.mappings && ct.mappings[type]) || ct?.mapping || null;
          let mapping = explicitMapping || savedMap || {};
          if (mapping && typeof mapping === 'object' && mapping.config && typeof mapping.config === 'object') mapping = mapping.config;
          const PREFIX_DEFAULT = String(((ct && (ct.db_mysql_prefix || ct.db_prefix)) || 'ps_'));
          const PREFIX = String(mapping.prefix || PREFIX_DEFAULT || 'ps_');
          const ID_LANG = Number(mapping.id_lang || 1) || 1;
          const TABLES = (mapping && mapping.tables && typeof mapping.tables === 'object') ? { ...mapping.tables } : {};
          let ALLOW_SET = null; try { if (type !== 'product') ALLOW_SET = new Set(Object.keys(TABLES||{}).map(s=>String(s))); } catch {}
          let TSET_PRODUCT = (TABLES.product && typeof TABLES.product.settings === 'object') ? TABLES.product.settings : {};
          let TSET_SHOP = (TABLES.product_shop && typeof TABLES.product_shop.settings === 'object') ? TABLES.product_shop.settings : {};
          let TSET_LANG = (TABLES.product_lang && typeof TABLES.product_lang.settings === 'object') ? TABLES.product_lang.settings : {};
          let TSET_STOCK = (TABLES.stock_available && typeof TABLES.stock_available.settings === 'object') ? TABLES.stock_available.settings : {};
          let TSET_ANY2 = {};
          let MFIELDS2 = {};
          let MDEF2 = {};
          let TDEF_STOCK_TBL2 = (TABLES.stock_available && typeof TABLES.stock_available.defaults === 'object') ? TABLES.stock_available.defaults : {};
          try {
            const rows = await pool.query(`SELECT table_name, settings, mapping FROM public.mod_grabbing_sensorex_table_settings WHERE domain=$1 AND lower(page_type)=lower($2)`, [domain, type]);
            const map = new Map((rows.rows||[]).map(r => [String(r.table_name||'').toLowerCase(), r.settings || {}]));
            if (map.has('product')) TSET_PRODUCT = { ...TSET_PRODUCT, ...(map.get('product')||{}) };
            if (map.has('product_shop')) TSET_SHOP = { ...TSET_SHOP, ...(map.get('product_shop')||{}) };
            if (map.has('product_lang')) TSET_LANG = { ...TSET_LANG, ...(map.get('product_lang')||{}) };
            if (map.has('stock_available')) TSET_STOCK = { ...TSET_STOCK, ...(map.get('stock_available')||{}) };
            for (const r of (rows.rows||[])) {
              const t = String(r.table_name||'').toLowerCase();
              if (!t) continue;
              try { if (r.settings && typeof r.settings==='object') TSET_ANY2[t] = { ...(TSET_ANY2[t]||{}), ...r.settings }; } catch {}
              try { if (r.mapping && typeof r.mapping==='object') { if (r.mapping.fields && typeof r.mapping.fields==='object') MFIELDS2[t] = { ...(MFIELDS2[t]||{}), ...r.mapping.fields }; if (r.mapping.defaults && typeof r.mapping.defaults==='object') MDEF2[t] = { ...(MDEF2[t]||{}), ...r.mapping.defaults }; } } catch {}
              if (t === 'stock_available' && r.settings && r.settings.table_name) TDEF_STOCK_TBL2 = { ...(TDEF_STOCK_TBL2||{}), ...(r.settings||{}) };
            }
          } catch {}

          const SHOPS = (()=>{ 
            const arrTop = Array.isArray(mapping.id_shops) ? mapping.id_shops : (mapping.id_shop ? [mapping.id_shop] : []);
            const arrCfg = Array.isArray(mapping?.tables?.product_shop?.settings?.id_shops) ? mapping.tables.product_shop.settings.id_shops : [];
            const src = arrTop && arrTop.length ? arrTop : arrCfg;
            return src.map(n=>Number(n)||0).filter(n=>n>0);
          })();
          const ID_SHOP_DEFAULT = (mapping.id_shop_default != null) ? Number(mapping.id_shop_default) : (SHOPS[0] || null);
          const GROUPS = Array.isArray(mapping.id_groups) ? mapping.id_groups.map(n=>Number(n)||0).filter(n=>n>0) : [];
          let LANGS = [];
          try { const T_LANG = PREFIX + 'lang'; const rows = await q(`SELECT ${qi('id_lang')} as id_lang FROM ${qi(T_LANG)} WHERE ${qi('active')}=1 ORDER BY ${qi('id_lang')} ASC`); LANGS = Array.isArray(rows) ? rows.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : []; } catch {}
          if (!LANGS.length) LANGS = [ID_LANG];

          // Extracted source
          let src = {}; try { src = run.result || {}; if (typeof src !== 'object' || !src) src = {}; } catch { src = {}; }
          const sanitizeStr = (s) => String(s||'').replace(/[\u0000-\u001F\u007F]/g,'').trim();
          const pick = (path) => { try { return path.split('.').reduce((o,k)=> (o && typeof o==='object') ? o[k] : undefined, src); } catch { return undefined; } };
          const pickFlex = (spec) => {
            if (!spec) return undefined;
            const arr = Array.isArray(spec) ? spec : (typeof spec === 'string' ? spec.split('|') : [spec]);
            for (const p of arr) { const v = pick(String(p).trim()); if (v !== undefined && v !== null && v !== '') return v; }
            return undefined;
          };
          const applyTransforms = (v, ops=[]) => { let out=v; try { for (const op of (Array.isArray(ops)?ops:[])) { const k = String(op?.op||op?.name||'').toLowerCase(); if (!k) continue; if (k==='trim') out=String(out||'').trim(); else if (k==='lower') out=String(out||'').toLowerCase(); else if (k==='upper') out=String(out||'').toUpperCase(); else if (k==='slug') out=slugify(out); else if (k==='replace') { const f=String(op?.from||''); const t=String(op?.to||''); out=String(out||'').split(f).join(t); } } } catch {} return out; };
          const resolveSpec = (obj, spec) => {
            const src = obj || {};
            if (spec && typeof spec === 'object') {
              if (spec.and) { const arr = Array.isArray(spec.and) ? spec.and : [spec.and]; const parts = arr.map(s => String(resolveSpec(src, s)||'')).filter(Boolean); return parts.join(''); }
              if (spec.or) { const arr = Array.isArray(spec.or) ? spec.or : [spec.or]; for (const s of arr) { const v = resolveSpec(src, s); if (v !== undefined && v !== null && v !== '') return v; } return undefined; }
              if (spec.path || spec.p || spec.transforms || spec.ops) { let v = pickFlex(spec.path || spec.p || ''); const out = applyTransforms(v, spec.transforms || spec.ops || []); return typeof out === 'string' ? sanitizeStr(out) : out; }
            }
            if (typeof spec === 'string') { if (spec === '') return ''; if (spec === '""' || spec === "''") return ''; if (spec.startsWith('=')) { let v = spec.slice(1); if (v === '""' || v === "''") v = ''; return v; } const out = pickFlex(spec); return typeof out === 'string' ? sanitizeStr(out) : out; }
            return spec;
          };
          const firstDef = (...arr) => { for (const v of arr) { if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
          const toNumber = (v) => { const n = Number(String(v||'').replace(/,/g,'.').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)? n: 0; };
          const toInt = (v) => { const n = parseInt(String(v||'').replace(/[^0-9\-]/g,''),10); return Number.isFinite(n)? n: 0; };

          // Resolve key values
          const FIELDS = (TABLES.product && typeof TABLES.product.fields==='object') ? TABLES.product.fields : {};
          const F_LANG = (TABLES.product_lang && typeof TABLES.product_lang.fields==='object') ? TABLES.product_lang.fields : {};
          const F_PRODUCT = (TABLES.product && typeof TABLES.product.fields==='object') ? TABLES.product.fields : {};
          const F_STOCK = (TABLES.stock_available && typeof TABLES.stock_available.fields==='object') ? TABLES.stock_available.fields : {};
          const val = {
            name: firstDef(F_LANG ? resolveSpec(src, F_LANG.name) : undefined, F_PRODUCT ? resolveSpec(src, F_PRODUCT.name) : undefined, resolveSpec(src, FIELDS.name), resolveSpec(src, ['title','name']), 'Imported Product'),
            description: firstDef(F_LANG ? resolveSpec(src, F_LANG.description) : undefined, F_PRODUCT ? resolveSpec(src, F_PRODUCT.description) : undefined, resolveSpec(src, FIELDS.description), resolveSpec(src, ['description','content']), ''),
            reference: String(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.reference) : undefined, resolveSpec(src, FIELDS.reference), resolveSpec(src, ['sku','reference']), '')),
            supplier_reference: String(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.supplier_reference) : undefined, resolveSpec(src, FIELDS.supplier_reference), resolveSpec(src, ['supplier_reference','mpn']), '')),
            price: toNumber(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.price) : undefined, resolveSpec(src, FIELDS.price), resolveSpec(src, ['price','price_without_tax','price_with_tax']), 0)),
            quantity: toInt(firstDef(F_STOCK ? resolveSpec(src, F_STOCK.quantity) : undefined, resolveSpec(src, FIELDS.quantity), resolveSpec(src, ['quantity','stock.quantity','qty']), 0)),
          };

          // Tables
          const T_PRODUCT = PREFIX + 'product';
          const T_PRODUCT_LANG = PREFIX + 'product_lang';
          const T_PRODUCT_SHOP = PREFIX + 'product_shop';
          const T_STOCK = PREFIX + 'stock_available';
          const hasProduct = await hasTable(T_PRODUCT);
          const hasProductShop = await hasTable(T_PRODUCT_SHOP);
          const hasProductLang = await hasTable(T_PRODUCT_LANG);
          const productLangHasShop = hasProductLang ? await hasColumn(T_PRODUCT_LANG, 'id_shop') : false;

          // Try to find existing product id for preview context
          let productId = Number(req.body?.product_id || 0) || 0;
          if (productId > 0) {
            const rows = await q(`SELECT ${qi('id_product')} FROM ${qi(T_PRODUCT)} WHERE ${qi('id_product')}=? LIMIT 1`, [productId]);
            if (!rows || !rows.length) productId = 0;
          }
          if (!productId && val.reference) {
            const rows = await q(`SELECT ${qi('id_product')} FROM ${qi(T_PRODUCT)} WHERE ${qi('reference')} = ? ORDER BY ${qi('id_product')} DESC LIMIT 1`, [String(val.reference)]);
            if (rows && rows.length) productId = Number(rows[0].id_product || 0) || 0;
          }
          if (!productId && val.name) {
            if (hasProductLang && productLangHasShop && ID_SHOP_DEFAULT) {
              const rows = await q(`SELECT p.${qi('id_product')} FROM ${qi(T_PRODUCT)} p JOIN ${qi(T_PRODUCT_LANG)} pl ON pl.${qi('id_product')}=p.${qi('id_product')} WHERE pl.${qi('id_lang')}=? AND pl.${qi('id_shop')}=? AND pl.${qi('name')}=? ORDER BY p.${qi('id_product')} DESC LIMIT 1`, [ID_LANG, ID_SHOP_DEFAULT, String(val.name)]);
              if (rows && rows.length) productId = Number(rows[0].id_product || 0) || 0;
            } else if (hasProductLang) {
              const rows = await q(`SELECT p.${qi('id_product')} FROM ${qi(T_PRODUCT)} p JOIN ${qi(T_PRODUCT_LANG)} pl ON pl.${qi('id_product')}=p.${qi('id_product')} WHERE pl.${qi('id_lang')}=? AND pl.${qi('name')}=? ORDER BY p.${qi('id_product')} DESC LIMIT 1`, [ID_LANG, String(val.name)]);
              if (rows && rows.length) productId = Number(rows[0].id_product || 0) || 0;
            }
          }

          // Build plan similar to jerome
          const plan = { product: null, product_shop: [], product_lang: [], stock_available: [], image: [], image_shop: [], image_lang: [], extra: {} };
          const isArticle = (type === 'article');
          if (!isArticle && hasProduct) {
            // product base row (insert/update)
            const productCols = {};
            const setCols = {};
            if (await hasColumn(T_PRODUCT, 'id_category_default')) productCols['id_category_default'] = Number(mapping.id_category_default||0)||null;
            if (await hasColumn(T_PRODUCT, 'id_supplier') && (mapping.id_supplier != null)) productCols['id_supplier'] = Number(mapping.id_supplier)||null;
            if (await hasColumn(T_PRODUCT, 'id_manufacturer') && (mapping.id_manufacturer != null)) productCols['id_manufacturer'] = Number(mapping.id_manufacturer)||null;
            if (await hasColumn(T_PRODUCT, 'id_shop_default') && ID_SHOP_DEFAULT) productCols['id_shop_default'] = ID_SHOP_DEFAULT;
            if (await hasColumn(T_PRODUCT, 'visibility')) { const v = String(TSET_PRODUCT.visibility ?? 'both'); productCols['visibility'] = v; setCols['visibility'] = v; }
            if (await hasColumn(T_PRODUCT, 'condition')) { const v = String(TSET_PRODUCT.condition ?? 'new'); productCols['condition'] = v; setCols['condition'] = v; }
            if (await hasColumn(T_PRODUCT, 'available_for_order')) { const v = (TSET_PRODUCT.available_for_order ?? 1) ? 1 : 0; productCols['available_for_order'] = v; setCols['available_for_order'] = v; }
            if (await hasColumn(T_PRODUCT, 'show_price')) { const v = (TSET_PRODUCT.show_price ?? 1) ? 1 : 0; productCols['show_price'] = v; setCols['show_price'] = v; }
            if (await hasColumn(T_PRODUCT, 'indexed')) { const v = (TSET_PRODUCT.indexed ?? 0) ? 1 : 0; productCols['indexed'] = v; setCols['indexed'] = v; }
            if (await hasColumn(T_PRODUCT, 'active')) { productCols['active'] = 1; setCols['active'] = 1; }
            if (await hasColumn(T_PRODUCT, 'price')) { productCols['price'] = Number(val.price||0); setCols['price'] = Number(val.price||0); }
            if (await hasColumn(T_PRODUCT, 'reference')) { productCols['reference'] = String(val.reference||''); setCols['reference'] = String(val.reference||''); }
            if (await hasColumn(T_PRODUCT, 'supplier_reference')) { productCols['supplier_reference'] = String(val.supplier_reference||''); setCols['supplier_reference'] = String(val.supplier_reference||''); }
            plan.product = { table: T_PRODUCT, insert: { ...productCols, date_add: nowFmt, date_upd: nowFmt }, update: { ...setCols, date_upd: nowFmt }, product_id: productId || 0 };
          }

          // product_shop
          if (!isArticle && hasProductShop && SHOPS.length) {
            for (const SID of SHOPS) {
              const row = { id_product: (productId||0), id_shop: SID };
              if (await hasColumn(T_PRODUCT_SHOP, 'active')) row['active'] = 1;
              if (await hasColumn(T_PRODUCT_SHOP, 'price')) row['price'] = Number(val.price||0);
              if (await hasColumn(T_PRODUCT_SHOP, 'visibility')) row['visibility'] = String(TSET_SHOP.visibility ?? TSET_PRODUCT.visibility ?? 'both');
              if (await hasColumn(T_PRODUCT_SHOP, 'show_price')) row['show_price'] = (TSET_SHOP.show_price ?? TSET_PRODUCT.show_price ?? 1) ? 1 : 0;
              plan.product_shop.push({ table: T_PRODUCT_SHOP, columns: row });
            }
          }

          // product_lang
          if (!isArticle && hasProductLang && LANGS.length) {
            for (const L of LANGS) {
              const row = { id_product: (productId||0), id_lang: L };
              if (productLangHasShop && ID_SHOP_DEFAULT) row['id_shop'] = ID_SHOP_DEFAULT;
              row['name'] = String(val.name||'');
              if (await hasColumn(T_PRODUCT_LANG, 'description')) row['description'] = String(val.description||'');
              plan.product_lang.push({ table: T_PRODUCT_LANG, columns: row });
            }
          }

          // stock_available
          if (await hasTable(T_STOCK)) {
            const hasIdShopGroup = await hasColumn(T_STOCK, 'id_shop_group');
            const row = { id_product: (productId||0), id_product_attribute: 0 };
            if (ID_SHOP_DEFAULT) row['id_shop'] = ID_SHOP_DEFAULT;
            if (hasIdShopGroup) row['id_shop_group'] = 0;
            if (await hasColumn(T_STOCK, 'quantity')) row['quantity'] = Number(val.quantity||0);
            plan.stock_available.push({ table: T_STOCK, columns: row });
          }

          // images preview (no writes): show planned rows
          try {
            const T_IMAGE = PREFIX + 'image';
            const T_IMAGE_SHOP = PREFIX + 'image_shop';
            const T_IMAGE_LANG = PREFIX + 'image_lang';
            if (await hasTable(T_IMAGE)) {
              const urls = [];
              try { if (Array.isArray(result?.images)) for (const u of result.images) { const s=String(u||'').trim(); if (s) urls.push(s); } } catch {}
              try { const s = String(result?.image||'').trim(); if (s) urls.unshift(s); } catch {}
              const uniq = Array.from(new Set(urls));
              const N = Math.min(uniq.length, 6);
              for (let i=0;i<N;i++) {
                const position = i+1;
                const rowI = { id_product: (productId||0), position };
                if (await hasColumn(T_IMAGE, 'cover') && i===0) rowI['cover'] = 1;
                plan.image.push({ table: T_IMAGE, columns: rowI });
                if (await hasTable(T_IMAGE_SHOP)) {
                  for (const SID of SHOPS) {
                    const rowS = { id_image: '(AUTO)', id_shop: SID };
                    if (await hasColumn(T_IMAGE_SHOP, 'position')) rowS['position'] = position;
                    if (await hasColumn(T_IMAGE_SHOP, 'cover') && i===0) rowS['cover'] = 1;
                    plan.image_shop.push({ table: T_IMAGE_SHOP, columns: rowS });
                  }
                }
                if (await hasTable(T_IMAGE_LANG)) {
                  for (const L of LANGS) {
                    const rowL = { id_image: '(AUTO)', id_lang: L };
                    if (await hasColumn(T_IMAGE_LANG, 'legend')) rowL['legend'] = String(val.name||'');
                    plan.image_lang.push({ table: T_IMAGE_LANG, columns: rowL });
                  }
                }
              }
            }
          } catch {}

          // attachments preview (no writes)
          try {
            const T_ATT = PREFIX + 'attachment';
            const T_ATT_LANG = PREFIX + 'attachment_lang';
            const T_ATT_SHOP = PREFIX + 'attachment_shop';
            const T_PROD_ATT = PREFIX + 'product_attachment';
            if (await hasTable(T_ATT)) {
              const docs = Array.isArray(result?.documents) ? result.documents : [];
              const M = Math.min(docs.length, 6);
              for (let i=0;i<M;i++) {
                const url = String(docs[i]||'');
                const name = (function(){ try { return decodeURIComponent(new URL(url).pathname.split('/').pop()||'document.pdf'); } catch { return 'document.pdf'; } })();
                plan.attachment.push({ table: T_ATT, columns: { file: '(sha1(url))', file_name: name, mime: 'application/pdf' } });
                if (await hasTable(T_ATT_LANG)) {
                  for (const L of LANGS) plan.attachment_lang.push({ table: T_ATT_LANG, columns: { id_attachment: '(AUTO)', id_lang: L, name, description: '' } });
                }
                if (await hasTable(T_ATT_SHOP)) {
                  for (const SID of SHOPS) plan.attachment_shop.push({ table: T_ATT_SHOP, columns: { id_attachment: '(AUTO)', id_shop: SID } });
                }
                if (await hasTable(T_PROD_ATT)) {
                  plan.product_attachment.push({ table: T_PROD_ATT, columns: { id_product: (productId||0), id_attachment: '(AUTO)' } });
                }
              }
            }
          } catch {}

          // attributes/combinations preview (no writes)
          try {
            const items = Array.isArray(result?.variants?.items) ? result.variants.items : [];
            if (items.length) {
              const first = items.find(x => x && typeof x==='object' && x.attributes && typeof x.attributes==='object');
              const keys = first ? Object.keys(first.attributes||{}) : [];
              const T_AG_LANG = PREFIX + 'attribute_group_lang';
              const T_A_LANG = PREFIX + 'attribute_lang';
              const T_PATTR = PREFIX + 'product_attribute';
              const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
              const T_PATTR_COMB = PREFIX + 'product_attribute_combination';
              // group names from keys
              for (const k of keys) {
                const gName = k.replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
                if (await hasTable(T_AG_LANG)) {
                  for (const L of LANGS) plan.attribute_group_lang.push({ table: T_AG_LANG, columns: { id_attribute_group: '(AUTO)', id_lang: L, name: gName, public_name: gName } });
                }
              }
              const N = Math.min(items.length, 6);
              for (let i=0;i<N;i++) {
                const it = items[i] || {};
                if (await hasTable(T_PATTR)) plan.product_attribute.push({ table: T_PATTR, columns: { id_product: (productId||0) } });
                if (await hasTable(T_PATTR_SHOP)) for (const SID of SHOPS) plan.product_attribute_shop.push({ table: T_PATTR_SHOP, columns: { id_product: (productId||0), id_product_attribute: '(AUTO)', id_shop: SID } });
                if (await hasTable(T_A_LANG) && await hasTable(T_PATTR_COMB)) {
                  const attrs = (it && it.attributes && typeof it.attributes==='object') ? it.attributes : {};
                  for (const k of keys) {
                    const v = String(attrs[k]||''); if (!v) continue;
                    for (const L of LANGS) plan.attribute_lang.push({ table: T_A_LANG, columns: { id_attribute: '(AUTO)', id_lang: L, name: v } });
                    plan.product_attribute_combination.push({ table: T_PATTR_COMB, columns: { id_attribute: '(AUTO:'+v+')', id_product_attribute: '(AUTO)' } });
                  }
                }
              }
            }
          } catch {}

          const payload = { ok:true, plan, context: { product_id: productId||0, shops: SHOPS, langs: LANGS, prefix: PREFIX } };
          return res.json(payload);
        } catch (e) {
          return res.status(500).json({ ok:false, error:'preview_failed', message: e?.message || String(e) });
        } finally { try { if (conn) await conn.end(); } catch {} }
      } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
    });
  } catch {}
}

// Compatibility export
// No extra compatibility export; routes are mounted via backend/index.js


