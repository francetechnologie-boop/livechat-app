import { createRequire } from 'module';
import path from 'path';
import { createHash } from 'crypto';
import { makeEnsureHelpers } from '../utils/ensure.js';

export function registerGrabbingSensorexExtractionRoutes(app, _ctx = {}, utils = {}) {
  // Be resilient to loaders that pass only (app, ctx)
  const pool = utils?.pool || _ctx?.pool;
  const chatLog = utils?.chatLog || ((event, payload = {}) => { try { _ctx?.logToFile?.(`[grabbing-sensorex] ${event} ${JSON.stringify(payload)}`); } catch (e) {} });
  const normDomain = utils?.normDomain || ((input) => {
    try {
      let raw = String(input || '').trim();
      if (!raw) return '';
      if (/^https?:\/\//i.test(raw)) { try { const u = new URL(raw); raw = (u.hostname || '').toLowerCase(); } catch (e) {} }
      return raw.toLowerCase().replace(/^www\./, '');
    } catch { return String(input||'').toLowerCase().replace(/^www\./,''); }
  });
  // Ensure helpers: prefer utils; else derive from local ensure factory
  let ensureExtractionTable = utils?.ensureExtractionTable;
  let ensureExtractionRunsTable = utils?.ensureExtractionRunsTable;
  try {
    if ((!ensureExtractionTable || !ensureExtractionRunsTable) && pool && typeof pool.query === 'function') {
      const ensures = makeEnsureHelpers(pool);
      ensureExtractionTable = ensureExtractionTable || ensures.ensureExtractionTable;
      ensureExtractionRunsTable = ensureExtractionRunsTable || ensures.ensureExtractionRunsTable;
    }
  } catch (e) {}
  if (typeof ensureExtractionTable !== 'function') ensureExtractionTable = async () => {};
  if (typeof ensureExtractionRunsTable !== 'function') ensureExtractionRunsTable = async () => {};
  if (!pool || typeof pool.query !== 'function') return;
  const BACKFILL_OFF = String(process.env.GS_DISABLE_BACKFILL || '').trim() === '1' || String(process.env.GS_DISABLE_EXTRACTION_WRITES || '').trim() === '1';

  // Minimal raw body reader fallback (when no JSON parser is mounted)
  const readRawBody = (req, max = 1024 * 1024) => new Promise((resolve) => {
    try {
      if (!req || typeof req.on !== 'function') return resolve('');
      let size = 0; const chunks = [];
      req.on('data', (c) => { try { size += c.length; if (size <= max) chunks.push(c); } catch (e) {} });
      req.on('end', () => { try { resolve(Buffer.concat(chunks).toString('utf8')); } catch { resolve(''); } });
      req.on('error', () => resolve(''));
    } catch { resolve(''); }
  });

  app.get('/api/grabbing-sensorex/extraction/tools', async (req, res) => {
    try {
      await ensureExtractionTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const where = [];
      const params = [];
      let i = 1;
      if (domain) { where.push(`domain = $${i}`); params.push(domain); i++; }
      if (pageType) { where.push(`lower(page_type) = $${i}`); params.push(pageType); i++; }
      const whereSql = where.length ? 'where '+where.join(' and ') : '';
      const total = await pool.query(`select count(*)::int as c from public.mod_grabbing_sensorex_extraction_tools ${whereSql}`, params);
      const items = await pool.query(
        `select id, domain, page_type, version, name, enabled, created_at, updated_at
           from public.mod_grabbing_sensorex_extraction_tools
           ${whereSql}
           order by domain asc, page_type asc, version desc, updated_at desc
           limit $${i} offset $${i+1}`,
        [...params, limit, offset]
      );
      return res.json({ ok:true, total: Number(total.rows?.[0]?.c || 0), items: items.rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_extract_failed', message: e?.message || String(e) }); }
  });

  
  app.post('/api/grabbing-sensorex/extraction/test', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      // Normalize body: handle JSON, urlencoded or raw strings
      let bodyObj = (req.body && typeof req.body === 'object') ? req.body : null;
      if (!bodyObj) {
        let raw = '';
        if (typeof req.body === 'string') raw = req.body.trim();
        else raw = (await readRawBody(req, 1024*1024)).trim();
        if (raw) {
          try { bodyObj = JSON.parse(raw); }
          catch {
            try { const sp = new URLSearchParams(raw); const tmp = {}; for (const [k,v] of sp.entries()) tmp[k]=v; bodyObj = tmp; } catch { bodyObj = null; }
          }
        }
      }
      // Be lenient: accept url/domain/page_type/version from body or query string
      const url = String(((bodyObj && bodyObj.url != null) ? bodyObj.url : (req.query && req.query.url)) || '').trim();
      let domain = normDomain(((bodyObj && bodyObj.domain != null) ? bodyObj.domain : (req.query && req.query.domain)));
      const pageType = String((((bodyObj && bodyObj.page_type != null) ? bodyObj.page_type : (req.query && req.query.page_type)) || '')).trim().toLowerCase() || 'product';
      const version = Number(((bodyObj && bodyObj.version != null) ? bodyObj.version : (req.query && req.query.version)) || 0) || 0;
      let cfg = (bodyObj && typeof bodyObj === 'object' && bodyObj.config != null) ? bodyObj.config : null;
      try { chatLog?.('extraction_test_hit', { has_body: typeof req.body, has_query: !!req.query, url_b: (bodyObj && bodyObj.url) ? true : false, url_q: req.query && typeof req.query.url === 'string', page_type: pageType }); } catch (e) {}
      const strict = (req.body?.strict === true) || (String(req.body?.strict).toLowerCase() === 'true');
      let usedVersion = version || null;
      let configSource = '';

      const persistAndReturnError = async (status, errCode, message) => {
        try {
          let persistErr = true;
          if (req.body && (Object.prototype.hasOwnProperty.call(req.body, 'save') || Object.prototype.hasOwnProperty.call(req.body, 'persist'))) {
            const flag = (req.body?.save ?? req.body?.persist);
            persistErr = (flag === true) || (flag === 1) || (String(flag).toLowerCase() === 'true');
          }
          if (persistErr && pool && typeof pool.query === 'function') {
            await ensureExtractionRunsTable();
            const cfgHash = createHash('sha256').update(JSON.stringify(cfg || {})).digest('hex');
            const ver = Number(usedVersion || version || 0) || null;
            // Try to inherit org_id/org_key from the domain row
            let orgId = null; let orgKey = null;
          try { const d = await pool.query(`select org_id, org_key from public.mod_grabbing_sensorex_domains where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','')`, [domain || normDomain(req.body?.domain)]); if (d.rowCount) { orgId = d.rows[0]?.org_id ?? null; orgKey = d.rows[0]?.org_key ?? null; } } catch (e) {}
            let runId = null;
            try {
              const ins = await pool.query(
                `insert into public.mod_grabbing_sensorex_extraction_runs
                   (domain,url,page_type,version,config_hash,config,result,ok,error,org_id,org_key,created_at,updated_at)
                 values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11, now(), now())
                 returning id`,
                [domain || normDomain(req.body?.domain), url, pageType, ver, cfgHash, JSON.stringify(cfg||{}), JSON.stringify(null), false, String(message||errCode), orgId, orgKey]
              );
              runId = ins.rows?.[0]?.id || null;
              return res.status(status).json({ ok:false, error: errCode, message, saved: true, run_id: runId, used_version: ver, config_source: configSource || '' });
            } catch (_) {
              return res.status(status).json({ ok:false, error: errCode, message, saved: false, run_id: null, used_version: ver, config_source: configSource || '' });
            }
          }
        } catch (e) {}
        return res.status(status).json({ ok:false, error: errCode, message, saved: false, run_id: null, used_version: usedVersion || version || null, config_source: configSource || '' });
      };

      if (!url) return persistAndReturnError(400, 'bad_request', 'url required');
      if (!domain) { try { domain = new URL(url).hostname.toLowerCase().replace(/^www\./,''); } catch (e) {} }
      if (!domain) return persistAndReturnError(400, 'bad_request', 'domain required');

      // Strict mode: require provided editor config, and forbid version/fallbacks
      if (strict) {
        if (!cfg || (typeof cfg !== 'object' && typeof cfg !== 'string')) {
          return persistAndReturnError(400, 'strict_no_config', 'Strict mode requires a valid editor config.');
        }
        if (version) {
          return persistAndReturnError(400, 'strict_no_version', 'Strict mode forbids version selection; remove version and send config only.');
        }
        if (typeof cfg === 'string') {
          try { cfg = JSON.parse(cfg); } catch (e) { return persistAndReturnError(400, 'invalid_json', String(e?.message||e)); }
        }
        configSource = 'provided';
        usedVersion = null;
      }

      // Load config when not provided (non-strict path)
      if (!strict && !cfg) {
        // When no explicit version is requested, try last run first.
        if (!version) {
          try {
            await ensureExtractionRunsTable();
            let rr = await pool.query(
              `select version, config from public.mod_grabbing_sensorex_extraction_runs
                where domain=$1 and lower(page_type)=lower($2) and lower(trim(both from url)) = lower(trim(both from $3))
                order by created_at desc limit 1`,
              [domain, pageType, url]
            );
            if (!rr.rowCount) {
              rr = await pool.query(
                `select version, config from public.mod_grabbing_sensorex_extraction_runs
                  where domain=$1 and lower(page_type)=lower($2)
                  order by created_at desc limit 1`,
                [domain, pageType]
              );
              if (rr.rowCount) configSource = 'last_run_any';
            } else configSource = 'last_run_exact';
            if (rr.rowCount) {
              const last = rr.rows[0] || {};
              if (last && typeof last.config === 'object') cfg = last.config;
              usedVersion = Number(last.version || usedVersion || 0) || null;
            }
          } catch (e) {}
        }
        if (!cfg) {
          await ensureExtractionTable();
          if (version) {
            // Exact version requested: do not fallback to latest. If not found, return error.
            const rExact = await pool.query(
              `select id, version, config from public.mod_grabbing_sensorex_extraction_tools
                 where domain=$1 and lower(page_type)=lower($2) and version=$3
                 limit 1`,
              [domain, pageType, version]
            );
            if (!rExact.rowCount) return persistAndReturnError(404, 'config_not_found', 'config_not_found');
            cfg = rExact.rows[0].config || {};
            usedVersion = Number(rExact.rows[0].version || version || usedVersion || 0) || null;
            if (!configSource) configSource = 'tool_exact';
          } else {
            // No version: use latest as before.
            const r = await pool.query(
              `select id, version, config from public.mod_grabbing_sensorex_extraction_tools
                 where domain=$1 and lower(page_type)=lower($2)
                 order by version desc, updated_at desc
                 limit 1`,
              [domain, pageType]
            );
            if (!r.rowCount) return persistAndReturnError(404, 'config_not_found', 'config_not_found');
            cfg = r.rows[0].config || {};
            usedVersion = Number(r.rows[0].version || usedVersion || 0) || null;
            if (!configSource) configSource = 'tool_latest';
          }
        }
      } else if (!strict && typeof cfg === 'string') {
        try { cfg = JSON.parse(cfg); configSource = 'provided'; } catch (e) { return res.status(400).json({ ok:false, error:'invalid_json', message:String(e?.message||e) }); }
      } else if (!strict) {
        configSource = 'provided';
      }

      // Fetch HTML (use desktop UA to avoid bot-filtered responses)
      const rPage = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'accept-language': 'en-US,en;q=0.9',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });
      const ct = String(rPage.headers.get('content-type')||'');
      if (!rPage.ok || !/text\/html/i.test(ct)) return persistAndReturnError(400, 'fetch_failed', String(rPage.status || 'fetch_failed'));
      const html = await rPage.text();
      let __cheerioLoad = null;
      try {
        const mod = await import('cheerio');
        __cheerioLoad = (mod && mod.load) ? mod.load : (mod?.default?.load || null);
      } catch (e) {}
      if (!__cheerioLoad) {
        try { const req = createRequire(path.join(process.cwd(), 'package.json')); const mod = req('cheerio'); __cheerioLoad = (mod && mod.load) ? mod.load : (mod?.default?.load || null); } catch (e) {}
      }
      if (!__cheerioLoad) return persistAndReturnError(501, 'dep_missing', 'cheerio not installed on server; run `cd backend && npm install cheerio` then restart');
      const $ = __cheerioLoad(html);

      const normSpace = (s) => String(s||'').replace(/\s+/g,' ').trim();
      const abs = (href, base) => { try { return new URL(href, base).toString(); } catch { return ''; } };
      const decodeEntities = (str) => String(str||'')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
      const selPick = (selector, wantAttr, useHtml=false) => {
        try { const el = $(selector).first(); if (!el || el.length === 0) return ''; if (wantAttr === 'html' || useHtml) return normSpace(el.html() || ''); if (wantAttr) return normSpace(el.attr(wantAttr) || ''); return normSpace(el.text()); } catch { return ''; }
      };
      const pickFrom = (arrOrStr, useHtml=false) => {
        const list = Array.isArray(arrOrStr) ? arrOrStr : (arrOrStr ? [arrOrStr] : []);
        for (const spec of list) {
          const s = String(spec||''); const atIdx = s.lastIndexOf('@');
          const selector = atIdx >= 0 ? s.slice(0, atIdx) : s; const attr = atIdx >= 0 ? s.slice(atIdx+1) : '';
          const v = selPick(selector, attr, useHtml); if (v) return v;
        }
        return '';
      };
      const pickAll = (spec, attrHint) => {
        const results = []; const list = Array.isArray(spec) ? spec : (spec ? [spec] : []);
        for (const sRaw of list) {
          const s = String(sRaw||''); const atIdx = s.lastIndexOf('@');
          const selector = atIdx >= 0 ? s.slice(0, atIdx) : s;
          let attr = atIdx >= 0 ? s.slice(atIdx+1) : (attrHint||'');
          try {
            $(selector).each((_, el) => {
              let w = '';
              const $el = $(el);
              if (attr === 'html') w = $el.html() || '';
              else if (attr === 'text' || attr === '' || attr == null) w = $el.text() || '';
              else w = $el.attr(attr) || '';
              if (w) results.push(normSpace(String(w)));
            });
          } catch (e) {}
        }
        return results;
      };
      const uniq = (arr) => Array.from(new Set((arr||[]).map(x => String(x||'').trim()).filter(Boolean)));

      // Map basic fields
      const out = { url, page_type: pageType };
      try {
        const m = (cfg && typeof cfg==='object' ? cfg : {});
        const usedKeys = new Set();
        const noFallback = Number(version || 0) > 0;
        // Defaults are OFF by default. They can be opt-in via env or query for legacy behavior.
        // When a specific version is requested, disable defaults to avoid implicit fallbacks.
        const allowDefaults = (!strict) && (!version) && (
          String(process.env.GS_EXTRACTION_DEFAULTS || process.env.GJ_EXTRACTION_DEFAULTS || '').toLowerCase() === '1' ||
          String((req.query && req.query.defaults) || '').trim() === '1'
        );
        const DEF_TITLE = allowDefaults ? ['meta[property="og:title"]@content','title'] : [];
        const DEF_DESC  = allowDefaults ? ['meta[name="description"]@content'] : [];
        const DEF_IMG   = allowDefaults ? ["meta[property=\"og:image\"]@content","img@src"] : [];
        const DEF_IMGS  = allowDefaults ? ['img@src'] : [];
        if (m.title != null) usedKeys.add('title');
        out.title = pickFrom(m.title || DEF_TITLE);
        if (m.description != null) usedKeys.add('description');
        out.description = pickFrom(m.description || DEF_DESC);
        if (m.price != null) usedKeys.add('price');
        const priceRaw = pickFrom(m.price || []);
        out.price = priceRaw ? Number(String(priceRaw).replace(/[^0-9.,]/g,'').replace(',','.')) : null;
        if (m.image != null) usedKeys.add('image');
        const imgSel = m.image || DEF_IMG;
        const img = pickFrom(imgSel);
        out.image = img ? abs(img, url) : '';
        // Images: support object config with sources/include_regex/exclude_regex/unique/limit
        if (m.images != null) usedKeys.add('images');
        const imgCfgObj = (m.images && typeof m.images === 'object' && !Array.isArray(m.images)) ? m.images : null;
        const imgSources = imgCfgObj && Array.isArray(imgCfgObj.sources) ? imgCfgObj.sources : (m.images || DEF_IMGS);
        let imgs = pickAll(imgSources, 'src').map(h=>abs(h,url)).filter(Boolean);
        // Always drop obviously invalid or placeholder schemes (data:, blob:) and SVGs
        try {
          imgs = imgs.filter(u => {
            const s = String(u||'');
            if (!s) return false;
            if (/^data:/i.test(s)) return false;
            if (/^blob:/i.test(s)) return false;
            if (/(^|\.)svg(?:$|\?)/i.test(s) || /\.svg(?:$|\?)/i.test(s)) return false;
            return true;
          });
        } catch (e) {}
        if (out.image) imgs.unshift(out.image);
        if (imgCfgObj) {
          const incList = Array.isArray(imgCfgObj.include_regex) ? imgCfgObj.include_regex : (imgCfgObj.include_regex ? [imgCfgObj.include_regex] : []);
          const excList = Array.isArray(imgCfgObj.exclude_regex) ? imgCfgObj.exclude_regex : (imgCfgObj.exclude_regex ? [imgCfgObj.exclude_regex] : []);
          const toRe = (s) => { try { return new RegExp(String(s), 'i'); } catch { return null; } };
          const RE_INC = incList.map(toRe).filter(Boolean);
          const RE_EXC = excList.map(toRe).filter(Boolean);
          imgs = imgs.filter(u => {
            const s = String(u||'');
            if (RE_EXC.length && RE_EXC.some(re => re.test(s))) return false;
            if (RE_INC.length && !RE_INC.some(re => re.test(s))) return false;
            return true;
          });
          const unique = (imgCfgObj.unique === false) ? false : true;
          if (unique) imgs = uniq(imgs);
          const limit = Number(imgCfgObj.limit || 0);
          if (limit > 0 && imgs.length > limit) imgs = imgs.slice(0, limit);
        } else {
          imgs = uniq(imgs);
        }
        out.images = imgs;
        if (m.brand != null) usedKeys.add('brand');
        out.brand = pickFrom(m.brand || []);
        if (m.sku != null) usedKeys.add('sku');
        out.sku = pickFrom(m.sku || []);
        if (m.categories != null) usedKeys.add('categories');
        out.categories = uniq(pickAll(m.categories || [], 'text'));
        out.json_ld = {};

        // Colors (codes/labels/swatches)
        try {
          if (m.colors && typeof m.colors === 'object') {
            usedKeys.add('colors');
            const col = {};
            if (m.colors.codes) col.codes = uniq(pickAll(m.colors.codes, 'value'));
            if (m.colors.labels) col.labels = uniq(pickAll(m.colors.labels, 'text'));
            if (m.colors.swatches) col.swatches = uniq(pickAll(m.colors.swatches, 'style'));
            if (Object.keys(col).length) out.colors = col;
          }
        } catch (e) {}

        // Variants (WooCommerce data-product_variations)
        try {
          const wantsVariants = (m.product && typeof m.product === 'object' && (m.product.variants_items || m.product.variant_skus));
          const rawAttr = (wantsVariants || !noFallback) ? ($('form.variations_form').attr('data-product_variations') || '') : '';
          if (rawAttr) {
            let arr = [];
            try { arr = JSON.parse(decodeEntities(rawAttr)); } catch (e) {}
            if (Array.isArray(arr) && arr.length) {
              const items = [];
              for (const v of arr) {
                try {
                  const attrs = (v && v.attributes) ? v.attributes : {};
                  const image = (v && v.image) ? v.image : {};
                  const imageUrl = image.full_src || image.url || image.src || '';
                  items.push({
                    sku: (v && v.sku) || '',
                    variation_id: (v && v.variation_id) || null,
                    price: (v && typeof v.display_price === 'number') ? v.display_price : null,
                    price_html: (v && v.price_html) || null,
                    in_stock: !!(v && v.is_in_stock),
                    purchasable: !!(v && v.is_purchasable),
                    weight: (v && v.weight) || null,
                    dimensions: (v && v.dimensions) || null,
                    image_url: imageUrl ? abs(imageUrl, url) : '',
                    // Preserve all Woo attribute keys as-is (e.g., attribute_range, attribute_communication, attribute_pa_*).
                    attributes: attrs
                  });
                } catch (e) {}
              }
              const skus = Array.from(new Set(items.map(it => String(it.sku||'').trim()).filter(Boolean)));
              if (items.length) out.variants = { skus, items };
              // Compatibility: also expose compact list under product.variant_skus
              try {
                if (skus.length) {
                  if (!out.product || typeof out.product !== 'object') out.product = {};
                  out.product.variant_skus = skus;
                }
              } catch (e) {}
            }
          }
        } catch (e) {}

        // Product subfields (populate out.product)
        try {
          const P = (m.product && typeof m.product === 'object') ? m.product : {};
          if (m.product && typeof m.product === 'object') usedKeys.add('product');
          const toNum = (s) => { if (s==null||s==='') return null; const n = Number(String(s).replace(/[^0-9.,-]/g,'').replace(',','.')); return Number.isFinite(n)? n: null; };
          const prod = {};
          if (P.name) prod.name = pickFrom(P.name);
          if (P.sku) prod.sku = pickFrom(P.sku);
          if (P.mpn) prod.mpn = pickFrom(P.mpn);
          if (P.ean) prod.ean13 = pickFrom(P.ean);
          if (P.brand) prod.brand = pickFrom(P.brand);
          if (P.price) { const pr = pickFrom(P.price); prod.price = toNum(pr); }
          if (P.currency) prod.currency = pickFrom(P.currency);
          if (P.availability) prod.availability = pickFrom(P.availability);
          if (P.weight) prod.weight = pickFrom(P.weight);
          if (P.width) prod.width = pickFrom(P.width);
          if (P.height) prod.height = pickFrom(P.height);
          if (P.depth) prod.depth = pickFrom(P.depth);
          if (P.description_html) prod.description_html = pickFrom(P.description_html, true) || pickFrom(P.description_html);
          if (P.short_description_html) prod.short_description_html = pickFrom(P.short_description_html, true) || pickFrom(P.short_description_html);
          if (P.category) prod.category = pickFrom(P.category);
          if (Object.keys(prod).length) out.product = prod;
          // Backfill top-level when missing
          if (!out.title && prod.name) out.title = prod.name;
          if (!out.brand && prod.brand) out.brand = prod.brand;
          if (!out.sku && prod.sku) out.sku = prod.sku;
          if (out.price == null && prod.price != null) out.price = prod.price;
        } catch (e) {}

        // Sections (as arrays)
        try {
          if (m.sections && typeof m.sections === 'object') {
            usedKeys.add('sections');
            const sec = {};
            for (const [key, sel] of Object.entries(m.sections)) {
              try {
                // Support two forms:
                // 1) CSS selector or array of selectors → collect text() from all matches
                // 2) Toggle map: { toggles: '.et_pb_accordion .et_pb_toggle', title: '.et_pb_toggle_title', content: '.et_pb_toggle_content', where: /Product Information|Technical/i }
                if (sel && typeof sel === 'object' && !Array.isArray(sel)) {
                  const toggles = String(sel.toggles||'').trim();
                  const titleSel = String(sel.title||'').trim() || '.et_pb_toggle_title';
                  const contentSel = String(sel.content||'').trim() || '.et_pb_toggle_content';
                  const where = sel.where ? new RegExp(String(sel.where), 'i') : null;
                  const collect = [];
                  if (toggles) {
                    try {
                      $(toggles).each((_, el) => {
                        try {
                          const sc = $(el);
                          const t = normSpace(sc.find(titleSel).first().text());
                          if (!t) return;
                          if (where && !where.test(t)) return;
                          // Prefer HTML when present so lists are preserved
                          const html = sc.find(contentSel).first().html();
                          const txt = sc.find(contentSel).first().text();
                          const val = (html && html.trim()) ? html.trim() : normSpace(txt);
                          if (val) collect.push(val);
                        } catch (e) {}
                      });
                    } catch (e) {}
                  }
                  if (collect.length) sec[key] = collect;
                } else {
                  const arr = pickAll(sel, 'text');
                  if (arr && arr.length) sec[key] = uniq(arr);
                }
              } catch (e) {}
            }
            // Persist what we got so far
            if (Object.keys(sec).length) out.sections = sec;

            // Fallback: if some well-known sections are missing, try Divi accordions by title (disabled for exact-version runs)
            try {
              if (!noFallback) {
                const ensure = (k) => { if (!out.sections) out.sections = {}; if (!out.sections[k]) out.sections[k] = []; };
                const needPI = !out.sections || !out.sections.product_information || out.sections.product_information.length===0;
                const needPA = (!out.sections || (!out.sections.parameters_applications || out.sections.parameters_applications.length===0)) && (!out.sections || (!out.sections.application || out.sections.application.length===0));
                const needTS = !out.sections || !out.sections.technical_specifications || out.sections.technical_specifications.length===0;
                const needAI = !out.sections || !out.sections.additional_information || out.sections.additional_information.length===0;
                if (needPI || needPA || needTS || needAI) {
                  const togglesSel = '.et_pb_accordion .et_pb_toggle';
                  const titleSel = '.et_pb_toggle_title';
                  const contentSel = '.et_pb_toggle_content';
                  $(togglesSel).each((_, el) => {
                    try {
                      const sc = $(el);
                      const title = normSpace(sc.find(titleSel).first().text());
                      if (!title) return;
                      const html = sc.find(contentSel).first().html();
                      const txt = sc.find(contentSel).first().text();
                      const val = (html && html.trim()) ? html.trim() : normSpace(txt);
                      if (!val) return;
                      if (needPI && /product\s*information/i.test(title)) { ensure('product_information'); out.sections.product_information.push(val); return; }
                      if (needPA && /(parameters?\b.*applications?)|(applications?)/i.test(title)) {
                        // Write to both keys for compatibility
                        ensure('parameters_applications'); out.sections.parameters_applications.push(val);
                        ensure('application'); out.sections.application.push(val);
                        return;
                      }
                      if (needTS && /technical\s*specifications?/i.test(title)) {
                        ensure('technical_specifications'); out.sections.technical_specifications.push(val);
                        ensure('technical_specification'); out.sections.technical_specification.push(val);
                        return;
                      }
                      if (needAI && /additional\s*information/i.test(title)) { ensure('additional_information'); out.sections.additional_information.push(val); return; }
                    } catch (e) {}
                  });
                }
              }
            } catch (e) {}
          }
        } catch (e) {}

        // Derive Additional_information_data from Additional Information tables if present
        try {
          if (out.sections && Array.isArray(out.sections.additional_information) && out.sections.additional_information.length) {
            const acc = [];
            const seen = new Set();
            for (const html of out.sections.additional_information) {
              try {
                if (!html || typeof html !== 'string') continue;
                const $$ = __cheerioLoad(html);
                $$("table.woocommerce-product-attributes.shop_attributes tr").each((_, tr) => {
                  try {
                    const th = normSpace($$(tr).find('th').first().text());
                    const td = normSpace($$(tr).find('td').first().text());
                    const clean = (s) => {
                      let t = String(s||'');
                      try { t = decodeEntities(t); } catch (e) {}
                      t = t.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
                      return normSpace(t).trim();
                    };
                    const left = clean(th);
                    const right = clean(td);
                    if (!left || !right) return;
                    const key = left+"\u0000"+right;
                    if (seen.has(key)) return;
                    seen.add(key);
                    acc.push({ criteria: left, value: right });
                  } catch (e) {}
                });
              } catch (e) {}
            }
            if (acc.length) {
              if (!out.sections || typeof out.sections !== 'object') out.sections = {};
              out.sections.Additional_information_data = acc;
            }
          }
        } catch (e) {}

        // Derive parameters_applications_data from parameters_applications list-inline tiles only
        try {
          if (out.sections && Array.isArray(out.sections.parameters_applications) && out.sections.parameters_applications.length) {
            const acc = [];
            const seen = new Set();
            const clean = (s) => {
              let t = String(s||'');
              try { t = decodeEntities(t); } catch (e) {}
              t = t.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
              return normSpace(t).trim();
            };
            for (const html of out.sections.parameters_applications) {
              try {
                if (!html || typeof html !== 'string') continue;
                const $$ = __cheerioLoad(html);
                // Only take list-inline tiles with tooltip data; set criteria = title, value = href
                $$("ul.list-inline li[data-bs-toggle='tooltip']").each((_, el) => {
                  try {
                    const li = $$(el);
                    const title = clean(li.attr('data-bs-original-title') || li.attr('title') || '');
                    const href = clean(li.find('a[href]').first().attr('href') || '');
                    if (!title && !href) return;
                    const key = title + "\u0000" + href;
                    if (seen.has(key)) return; seen.add(key);
                    acc.push({ criteria: title, value: href || title });
                  } catch (e) {}
                });
              } catch (e) {}
            }
            if (acc.length) {
              if (!out.sections || typeof out.sections !== 'object') out.sections = {};
              out.sections.parameters_applications_data = acc;
            }
          }
        } catch (e) {}

        // Attributes table/list extraction
        try {
          if (m.attributes && typeof m.attributes === 'object') {
            usedKeys.add('attributes');
            const rowsSel = String(m.attributes.rows||'').trim();
            const nameSel = String(m.attributes.name||'').trim();
            const valSel  = String(m.attributes.value||'').trim();
            const items = [];
            if (rowsSel) {
              try {
                $(rowsSel).each((_, el) => {
                  try {
                    const sc = $(el);
                    let name = nameSel ? normSpace(sc.find(nameSel).first().text()) : normSpace(sc.text());
                    let value = valSel ? normSpace(sc.find(valSel).first().text()) : '';
                    // If no explicit value selector, allow splitting multiple "Label: Value" pairs per row
                    if (!valSel) {
                      const html = String(sc.html() || '');
                      const hasBr = /<br\s*\/?>/i.test(html);
                      const colonCount = (name.match(/:/g) || []).length;
                      let multiPushed = false;
                      if (hasBr) {
                        const parts = html.split(/<br\s*\/?>/ig);
                        for (const part of parts) {
                          try {
                            // Build text from the raw HTML fragment to reliably handle <br> splits
                            let text = String(part).replace(/<[^>]*>/g,' ');
                            // Decode HTML entities first, then normalize NBSP and spaces
                            try { text = decodeEntities(text); } catch (e) {}
                            text = text.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
                            text = normSpace(text)
                              // Insert a space before a glued label like "MΩConnector:" → "MΩ Connector:"
                              .replace(/([0-9A-Za-zΩ])([A-Z][A-Za-z]*(?:\s+[A-Za-z][A-Za-z]*)*:)/g, '$1 $2')
                              .trim();
                            if (!text) continue;
                            // Extract all Label: Value pairs within this segment (supports multi-word labels)
                            const rxAll = /\s*([^:]{1,160}?):\s*([^:]+?)(?=(?:\s+[A-Z][A-Za-z]*(?:\s+[A-Za-z][A-Za-z]*)*:)|$)/g;
                            let mm;
                            while ((mm = rxAll.exec(text)) !== null) {
                              // Final sanitize of left/right (decode, strip NBSP, collapse spaces)
                              const clean = (s) => {
                                let t = String(s||'');
                                try { t = decodeEntities(t); } catch (e) {}
                                t = t.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
                                return normSpace(t).trim();
                              };
                              const left = clean(mm[1]);
                              const right = clean(mm[2]);
                              if (left && right) { items.push({ name: left, value: right }); multiPushed = true; }
                            }
                          } catch (e) {}
                        }
                      } else if (colonCount > 1) {
                        // Fallback: split by pattern "Label: Value" repeated in one line
                        let s = String(name || '');
                        try { s = decodeEntities(s); } catch (e) {}
                        s = s.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
                        s = normSpace(s)
                          .replace(/([0-9A-Za-zΩ])([A-Z][A-Za-z]*(?:\s+[A-Za-z][A-Za-z]*)*:)/g, '$1 $2')
                          .trim();
                        const rx = /([^:]{1,160}?):\s*([^:]+?)(?=(?:\s+[A-Z][A-Za-z]*(?:\s+[A-Za-z][A-Za-z]*)*:)|$)/g;
                        let m;
                        while ((m = rx.exec(s)) !== null) {
                          const clean = (t) => {
                            let u = String(t||'');
                            try { u = decodeEntities(u); } catch (e) {}
                            u = u.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
                            return normSpace(u).trim();
                          };
                          const left = clean(m[1]);
                          const right = clean(m[2]);
                          if (left && right) { items.push({ name: left, value: right }); multiPushed = true; }
                        }
                      }
                      if (multiPushed) { return; }
                      // Single pair fallback when only one colon present
                      if ((!value || value === '') && name && name.includes(':')) {
                        const idx = name.indexOf(':');
                        const clean = (t) => {
                          let u = String(t||'');
                          try { u = decodeEntities(u); } catch (e) {}
                          u = u.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
                          return normSpace(u).trim();
                        };
                        const left = clean(name.slice(0, idx));
                        const right = clean(name.slice(idx+1));
                        if (left && right) { name = left; value = right; }
                      }
                    }
                    if (!value && valSel) value = normSpace(sc.attr(valSel) || '');
                    if (name && value) items.push({ name, value });
                  } catch (e) {}
                });
              } catch (e) {}
            }
            if (items.length) {
              // sanitize and de-duplicate
              try {
                const cleaned = [];
                const seen = new Set();
                for (const it of items) {
                  let n = String(it?.name ?? '');
                  let v = String(it?.value ?? '');
                  try { n = decodeEntities(n); v = decodeEntities(v); } catch (e) {}
                  n = n.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ').replace(/^\"|\"$/g,'').trim();
                  v = v.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ').replace(/^\"|\"$/g,'').trim();
                  if (!n || !v) continue;
                  const key = n+"\u0000"+v;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  cleaned.push({ name: n, value: v });
                }
                if (cleaned.length) out.attributes = cleaned; else out.attributes = items;
              } catch (_) { out.attributes = items; }
              // If the rows selector indicates technical specs content, also expose under sections
              try {
                if (rowsSel && /specifications?content/i.test(rowsSel)) {
                  if (!out.sections || typeof out.sections !== 'object') out.sections = {};
                  out.sections.technical_specifications_detail = items.map(it => ({ criteria: it.name, value: it.value }));
                }
              } catch (e) {}
            }
          }
        } catch (e) {}

        // Merge attributes with Additional_information_data and parameters_applications_data
        // (specs first, then additional info, then parameters/applications summary + tiles)
        try {
          const addl = out && out.sections && Array.isArray(out.sections.Additional_information_data)
            ? out.sections.Additional_information_data : null;
          const papps = out && out.sections && Array.isArray(out.sections.parameters_applications_data)
            ? out.sections.parameters_applications_data : null;
          const hasExtras = (Array.isArray(addl) && addl.length) || (Array.isArray(papps) && papps.length);
          if (hasExtras) {
            const merged = [];
            const seen = new Set();
            const pushUnique = (left, right) => {
              const clean = (s) => {
                let t = String(s||'');
                try { t = decodeEntities(t); } catch (e) {}
                t = t.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
                return normSpace(t).trim();
              };
              const n = clean(left);
              const v = clean(right);
              if (!n || !v) return;
              const key = n+"\u0000"+v;
              if (seen.has(key)) return;
              seen.add(key);
              merged.push({ name: n, value: v });
            };
            // 1) existing attributes first
            if (Array.isArray(out.attributes)) {
              for (const it of out.attributes) pushUnique(it?.name ?? it?.criteria, it?.value ?? it?.val);
            }
            // 2) then additional information
            if (Array.isArray(addl)) {
              for (const it of addl) pushUnique(it?.criteria ?? it?.name, it?.value ?? it?.val);
            }
            // 3) parameters/applications summary only (no individual tiles)
            if (Array.isArray(papps) && papps.length) {
              try {
                const names = papps.map(it => String(it?.criteria || '').trim()).filter(Boolean);
                if (names.length) {
                  // summary row: name = Applications, value = comma-separated names
                  pushUnique('Applications', names.join(', '));
                }
              } catch (e) {}
            }
            if (merged.length) out.attributes = merged;
          }
        } catch (e) {}

        // JSON-LD extraction/mapping
        try {
          const JL = (m.json_ld && typeof m.json_ld === 'object') ? m.json_ld : {};
          if (m.json_ld && typeof m.json_ld === 'object') usedKeys.add('json_ld');
          const hasJL = Object.keys(JL).length > 0;
          if (JL.enabled !== false && (hasJL || !noFallback)) {
            const sel = JL.selector || "script[type='application/ld+json']";
            const typesPref = Array.isArray(JL.prefer_types) ? JL.prefer_types : [];
            const blobs = [];
            try {
              $(sel).each((_, el) => { try { const txt = $(el).text(); if (txt && txt.trim()) blobs.push(txt.trim()); } catch (e) {} });
            } catch (e) {}
            const parsed = [];
            for (const t of blobs) {
              try {
                const j = JSON.parse(t);
                if (Array.isArray(j)) { for (const it of j) parsed.push(it); }
                else parsed.push(j);
              } catch (e) {}
            }
            // Pick first product-like node
            let prodNode = null;
            for (const node of parsed) {
              try {
                const ty = Array.isArray(node['@type']) ? node['@type'] : (node['@type'] ? [node['@type']] : []);
                if (!typesPref.length) { if (ty.includes('Product')) { prodNode = node; break; } }
                else if (ty.some(t => typesPref.includes(String(t)))) { prodNode = node; break; }
              } catch (e) {}
            }
            const mapped = {};
            const evalPath = (obj, pathStr) => {
              if (!obj || !pathStr) return undefined;
              const s = String(pathStr).trim();
              if (!s.startsWith('@.')) return undefined;
              const parts = s.slice(2).split('.');
              let cur = obj;
              for (let i=0;i<parts.length;i++) {
                let p = parts[i];
                const isArr = p.endsWith('[]');
                if (isArr) p = p.slice(0,-2);
                cur = cur ? cur[p] : undefined;
                if (cur == null) return undefined;
                if (isArr) return Array.isArray(cur) ? cur : [cur];
              }
              return cur;
            };
            if (prodNode && JL.map && typeof JL.map === 'object') {
              for (const [k, expr] of Object.entries(JL.map)) {
                let val;
                const alts = Array.isArray(expr) ? expr : String(expr).split('||');
                for (const alt of alts) {
                  const v = evalPath(prodNode, String(alt).trim());
                  if (v !== undefined && v !== null && v !== '') { val = v; break; }
                }
                if (val !== undefined) mapped[k] = val;
              }
            }
            out.json_ld = { raw: prodNode || null, mapped };
          }
        } catch (e) {}
        // Documents (PDFs, etc.) — from config.documents or fallback scan
        try {
          const dcfg = (m.documents && typeof m.documents==='object') ? m.documents : {};
          if (m.documents && typeof m.documents === 'object') usedKeys.add('documents');
          const srcs = Array.isArray(dcfg.sources) ? dcfg.sources : null;
          let candidates = [];
          if (srcs && srcs.length) {
            candidates = pickAll(srcs, 'href').map(h => abs(h, url));
          } else if (!noFallback) {
            try {
              $('a[href],link[href]').each((_, el) => {
                const href = $(el).attr('href'); if (!href) return; const a = abs(href, url); if (a) candidates.push(a);
              });
            } catch (e) {}
          }
          if (candidates.length) {
            const incList = Array.isArray(dcfg.include_regex) ? dcfg.include_regex : (dcfg.include_regex ? [dcfg.include_regex] : []);
            const excList = Array.isArray(dcfg.exclude_regex) ? dcfg.exclude_regex : (dcfg.exclude_regex ? [dcfg.exclude_regex] : []);
            const toRe = (s) => { try { return new RegExp(String(s), 'i'); } catch { return null; } };
            const RE_INC = incList.map(toRe).filter(Boolean);
            const RE_EXC = excList.map(toRe).filter(Boolean);
            const filtered = candidates.filter(u => {
              const s = String(u||'');
              if (RE_EXC.length && RE_EXC.some(r => r.test(s))) return false;
              if (RE_INC.length) return RE_INC.some(r => r.test(s));
              return true;
            });
            out.documents = uniq(filtered);
          }
        } catch (e) {}

        // Config notices for unsupported/unused keys
        try {
          const notices = [];
          const add = (s) => { try { if (s) notices.push(String(s)); } catch (e) {} };
          const knownTop = new Set(['brand','title','description','price','image','images','sku','categories','colors','product','json_ld','sections','documents','attributes','request']);
          try { for (const k of Object.keys(m || {})) if (!knownTop.has(k)) add(`Unused top-level key '${k}'`); } catch (e) {}
          const imgCfg = (m && m.images && typeof m.images === 'object' && !Array.isArray(m.images)) ? m.images : null;
          if (imgCfg) {
            try {
              const knownImg = new Set(['sources','include_regex','exclude_regex','unique','limit','download']);
              for (const k of Object.keys(imgCfg)) if (!knownImg.has(k)) add(`images.${k} not supported; ignored`);
              if (Object.prototype.hasOwnProperty.call(imgCfg,'download')) add('images.download is not supported by test endpoint; ignoring');
            } catch (e) {}
          }
          const docsCfg = (m && m.documents && typeof m.documents === 'object') ? m.documents : null;
          if (docsCfg) {
            try {
              const knownD = new Set(['sources','include_regex','exclude_regex','download']);
              for (const k of Object.keys(docsCfg)) if (!knownD.has(k)) add(`documents.${k} not supported; ignored`);
              if (Object.prototype.hasOwnProperty.call(docsCfg,'download')) add('documents.download is not supported by test endpoint; ignoring');
            } catch (e) {}
          }
          const jlCfg = (m && m.json_ld && typeof m.json_ld === 'object') ? m.json_ld : null;
          if (jlCfg) {
            try {
              const knownJL = new Set(['map','enabled','selector','prefer_types']);
              for (const k of Object.keys(jlCfg)) if (!knownJL.has(k)) add(`json_ld.${k} not supported; ignored`);
            } catch (e) {}
          }
          const attrCfg = (m && m.attributes && typeof m.attributes === 'object') ? m.attributes : null;
          if (attrCfg) {
            try {
              const knownA = new Set(['rows','name','value']);
              for (const k of Object.keys(attrCfg)) if (!knownA.has(k)) add(`attributes.${k} not supported; ignored`);
            } catch (e) {}
          }
          const prodCfg = (m && m.product && typeof m.product === 'object') ? m.product : null;
          if (prodCfg) {
            try {
              const knownP = new Set(['name','sku','mpn','ean','brand','price','currency','availability','weight','width','height','depth','description_html','short_description_html','category','variant_skus','variants_items']);
              for (const k of Object.keys(prodCfg)) if (!knownP.has(k)) add(`product.${k} not supported; ignored`);
            } catch (e) {}
          }
          try { if (m && m.request && typeof m.request === 'object' && m.request.headers) add('request.headers present but not used by test endpoint; server uses fixed headers'); } catch (e) {}
          if (notices.length) out.notices = notices;
        } catch (e) {}
        try { if (m.request && typeof m.request === 'object') usedKeys.add('request'); } catch (e) {}
        try { out.config_used_keys = Array.from(usedKeys).sort(); } catch (e) {}
      } catch (e) {}

      // Persist run by default
      let persist = true;
      if (req.body && (Object.prototype.hasOwnProperty.call(req.body, 'save') || Object.prototype.hasOwnProperty.call(req.body, 'persist'))) {
        const flag = (req.body?.save ?? req.body?.persist);
        persist = (flag === true) || (flag === 1) || (String(flag).toLowerCase() === 'true');
      }
      if (persist) {
        try {
          await ensureExtractionRunsTable();
          const cfgHash = createHash('sha256').update(JSON.stringify(cfg || {})).digest('hex');
          const updateRunId = Number((bodyObj && bodyObj.update_run_id != null) ? bodyObj.update_run_id : (req.query && req.query.update_run_id)) || 0;
          // Try to inherit org context from domain row
          let orgId = null; let orgKey = null;
          try { const d = await pool.query(`select org_id, org_key from public.mod_grabbing_sensorex_domains where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','')`, [domain]); if (d.rowCount) { orgId = d.rows[0]?.org_id ?? null; orgKey = d.rows[0]?.org_key ?? null; } } catch (e) {}
          if (updateRunId > 0) {
            // Update existing run (in-place refresh)
            try {
              await pool.query(
                `update public.mod_grabbing_sensorex_extraction_runs
                   set domain=$2, url=$3, page_type=$4, version=$5, config_hash=$6,
                       config=$7::jsonb, result=$8::jsonb, ok=$9, error=$10, updated_at=now()
                 where id=$1`,
                [updateRunId, domain, url, pageType, usedVersion, cfgHash, JSON.stringify(cfg||{}), JSON.stringify(out||{}), true, null]
              );
              try { chatLog?.('run_updated', { id: updateRunId, url, page_type: pageType, used_version: usedVersion, source: configSource }); } catch (e) {}
              return res.json({ ok:true, url, domain, page_type: pageType, result: out, saved: true, run_id: updateRunId, used_version: usedVersion, config_source: configSource, used_config: cfg || {}, updated: true });
            } catch (eUp) {
              // Fall through to insert a new row if update failed
            }
          }
          const ins = await pool.query(
            `insert into public.mod_grabbing_sensorex_extraction_runs
               (domain,url,page_type,version,config_hash,config,result,ok,error,org_id,org_key,created_at,updated_at)
             values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11, now(), now())
             returning id`,
            [domain, url, pageType, usedVersion, cfgHash, JSON.stringify(cfg||{}), JSON.stringify(out||{}), true, null, orgId, orgKey]
          );
          const runId = ins.rows?.[0]?.id || null;
          return res.json({ ok:true, url, domain, page_type: pageType, result: out, saved: true, run_id: runId, used_version: usedVersion, config_source: configSource, used_config: cfg || {} });
        } catch (e) {
          // Fallback path: try an insert without org columns (for older schemas) before giving up
          try {
            const cfgHash = createHash('sha256').update(JSON.stringify(cfg || {})).digest('hex');
            const ins2 = await pool.query(
              `insert into public.mod_grabbing_sensorex_extraction_runs
                 (domain,url,page_type,version,config_hash,config,result,ok,error,created_at,updated_at)
               values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9, now(), now())
               returning id`,
              [domain, url, pageType, usedVersion, cfgHash, JSON.stringify(cfg||{}), JSON.stringify(out||{}), true, null]
            );
            const runId2 = ins2.rows?.[0]?.id || null;
            return res.json({ ok:true, url, domain, page_type: pageType, result: out, saved: true, run_id: runId2, used_version: usedVersion, config_source: configSource, used_config: cfg || {}, warn: 'saved_without_org' });
          } catch (e2) {
            try { chatLog?.('run_save_failed', { message: String(e?.message||e), fallback_error: String(e2?.message||e2) }); } catch (e3) {}
            return res.json({ ok:true, url, domain, page_type: pageType, result: out, saved: false, save_error: String(e2?.message || e2), used_version: usedVersion, config_source: configSource, used_config: cfg || {} });
          }
        }
      }
      return res.json({ ok:true, url, domain, page_type: pageType, result: out, used_version: usedVersion, config_source: configSource, used_config: cfg || {} });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'test_failed', message: e?.message || String(e) });
    }
  });

  // Get latest tool config
  app.get('/api/grabbing-sensorex/extraction/tools/latest', async (req, res) => {
    try {
      await ensureExtractionTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const where = [`domain = $1`, `lower(page_type) = $2`];
      const params = [domain, pageType];
      const r = await pool.query(
        `select id, domain, page_type, version, name, enabled, config, created_at, updated_at
           from public.mod_grabbing_sensorex_extraction_tools
          where ${where.join(' and ')}
          order by version desc, updated_at desc
          limit 1`,
        params
      );
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_latest_failed', message: e?.message || String(e) }); }
  });

  // Get specific version
  app.get('/api/grabbing-sensorex/extraction/tools/get', async (req, res) => {
    try {
      await ensureExtractionTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || 0);
      if (!domain || !pageType || !version) return res.status(400).json({ ok:false, error:'bad_request' });
      const where = [`domain = $1`, `lower(page_type) = $2`, `version = $3`];
      const params = [domain, pageType, version];
      const r = await pool.query(
        `select id, domain, page_type, version, name, enabled, config, created_at, updated_at
           from public.mod_grabbing_sensorex_extraction_tools
          where ${where.join(' and ')}
          limit 1`,
        params
      );
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_failed', message: e?.message || String(e) }); }
  });

  // Upsert tool config (create or update specific version)
  app.post('/api/grabbing-sensorex/extraction/tools', async (req, res) => {
    try {
      await ensureExtractionTable();
      if (BACKFILL_OFF) return res.status(503).json({ ok:false, error:'writes_disabled', message:'GS_DISABLE_BACKFILL=1' });
      const domain = normDomain(req.body?.domain);
      const pageType = String(req.body?.page_type || '').trim().toLowerCase();
      const version = Number(req.body?.version || 0) || 0;
      const name = String(req.body?.name || '').trim() || null;
      const enabled = !!req.body?.enabled;
      const config = (req.body?.config && typeof req.body.config==='object') ? req.body.config : {};
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      let row = null;
      if (!version) {
        const r = await pool.query(
          `insert into public.mod_grabbing_sensorex_extraction_tools (domain,page_type,version,name,config,enabled,updated_at)
           values ($1,$2, coalesce((select max(version)+1 from public.mod_grabbing_sensorex_extraction_tools where domain=$1 and lower(page_type)=lower($2)),1), $3, $4::jsonb, $5, now())
           returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [domain, pageType, name, JSON.stringify(config||{}), enabled]
        );
        row = r.rows[0];
      } else {
        const upd = await pool.query(
          `update public.mod_grabbing_sensorex_extraction_tools
              set name=$1, config=$2::jsonb, enabled=$3, updated_at=now()
            where domain=$4 and lower(page_type)=lower($5) and version=$6
            returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [name, JSON.stringify(config||{}), enabled, domain, pageType, version]
        );
        if (upd.rowCount) row = upd.rows[0];
        else {
          const ins = await pool.query(
            `insert into public.mod_grabbing_sensorex_extraction_tools (domain,page_type,version,name,config,enabled,updated_at)
             values ($1,$2,$3,$4,$5::jsonb,$6, now())
             returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
            [domain, pageType, version, name, JSON.stringify(config||{}), enabled]
          );
          row = ins.rows[0];
        }
      }
      return res.json({ ok:true, item: row });
    } catch (e) { return res.status(500).json({ ok:false, error:'upsert_extract_failed', message: e?.message || String(e) }); }
  });

  // Delete a specific version
  app.delete('/api/grabbing-sensorex/extraction/tools', async (req, res) => {
    try {
      await ensureExtractionTable();
      if (BACKFILL_OFF) return res.status(503).json({ ok:false, error:'writes_disabled', message:'GS_DISABLE_BACKFILL=1' });
      const id = Number(req.query?.id || req.body?.id || 0);
      const domain = normDomain(req.query?.domain || req.body?.domain);
      const pageType = String(req.query?.page_type || req.body?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || req.body?.version || 0);
      let r;
      if (id) {
        r = await pool.query(`delete from public.mod_grabbing_sensorex_extraction_tools where id=$1`, [id]);
      } else if (domain && pageType && version) {
        r = await pool.query(`delete from public.mod_grabbing_sensorex_extraction_tools where domain=$1 and lower(page_type)=lower($2) and version=$3`, [domain, pageType, version]);
      } else {
        return res.status(400).json({ ok:false, error:'bad_request' });
      }
      return res.json({ ok:true, deleted: Number(r?.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_extract_failed', message: e?.message || String(e) }); }
  });

  // History: list (portable across schema variants)
  app.get('/api/grabbing-sensorex/extraction/history', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const domain = normDomain(req.query?.domain);
      const url = String(req.query?.url || '').trim();
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || 0) || null;
      const hasProductParam = String(req.query?.has_product_id || '').trim().toLowerCase();
      // Allow larger page sizes when requested from UI (cap at 2000 to stay reasonable)
      const limit = Math.min(2000, Math.max(1, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const includeFull = String(req.query?.include || '').toLowerCase() === 'full' || req.query?.include === '1';
      const includeSubdomains = String(req.query?.include_subdomains || '').toLowerCase() === '1' || String(req.query?.include_subdomains || '').toLowerCase() === 'true';
      const qProductId = Number(req.query?.product_id || 0) || 0;
      const qProductIdFrom = Number(req.query?.product_id_from || 0) || 0;
      const qProductIdTo = Number(req.query?.product_id_to || 0) || 0;
      const sortByReq = String(req.query?.sort_by || '').trim().toLowerCase();
      const sortDirReq = String(req.query?.sort_dir || '').trim().toLowerCase();
      const where = [];
      const params = [];
      let i = 1;
      if (domain) {
        // Match exact, www.<domain>, and optionally subdomains
        const alt = 'www.' + domain.replace(/^www\./,'');
        if (includeSubdomains) {
          where.push(`(regexp_replace(lower(coalesce(domain,'')),'^www\\.','') = regexp_replace(lower($${i}),'^www\\.','') OR lower(coalesce(domain,'')) = lower($${i+1}) OR lower(coalesce(domain,'')) like ('%.' || lower(trim(both from $${i}))))`);
          params.push(domain, alt); i += 2;
        } else {
          where.push(`(regexp_replace(lower(coalesce(domain,'')),'^www\\.','') = regexp_replace(lower($${i}),'^www\\.','') OR lower(coalesce(domain,'')) = lower($${i+1}))`);
          params.push(domain, alt); i += 2;
        }
      }
      if (url) { where.push(`lower(trim(both from url)) = lower(trim(both from $${i}))`); params.push(url); i++; }
      if (pageType) { where.push(`lower(page_type) = lower($${i})`); params.push(pageType); i++; }
      if (version) { where.push(`version = $${i}`); params.push(version); i++; }
      // Determine available columns to keep this endpoint portable across deployments
      const colSet = new Set();
      try {
        const rCols = await pool.query(
          `select column_name from information_schema.columns where table_schema='public' and table_name='mod_grabbing_sensorex_extraction_runs'`
        );
        for (const row of rCols.rows || []) colSet.add(String(row.column_name));
      } catch (e) {}
      const has = (c) => colSet.has(String(c));
      if (qProductId && has('product_id')) { where.push(`product_id = $${i}`); params.push(qProductId); i++; }
      // Range filter when exact product_id is not used
      if (!qProductId && has('product_id')) {
        if (qProductIdFrom > 0) { where.push(`product_id >= $${i}`); params.push(qProductIdFrom); i++; }
        if (qProductIdTo > 0) { where.push(`product_id <= $${i}`); params.push(qProductIdTo); i++; }
      }
      // Boolean presence filter: has_product_id=true/false
      if (!qProductId && has('product_id') && hasProductParam) {
        const truthy = hasProductParam === '1' || hasProductParam === 'true' || hasProductParam === 'yes' || hasProductParam === 'y';
        const falsy = hasProductParam === '0' || hasProductParam === 'false' || hasProductParam === 'no' || hasProductParam === 'n';
        if (truthy) where.push(`product_id is not null`);
        else if (falsy) where.push(`product_id is null`);
      }
      const base = [
        'id','domain','url','page_type','version'
      ];
      const minimal = ['config_hash'];
      if (includeFull) minimal.push('config','result');
      minimal.push('ok','error');
      if (has('product_id')) minimal.push('product_id');
      if (has('mapping_version')) minimal.push('mapping_version');
      if (includeFull) {
        if (has('mapping')) minimal.push('mapping');
        if (has('transfer')) minimal.push('transfer');
      }
      minimal.push('created_at');
      if (has('updated_at')) minimal.push('updated_at');
      const selCols = [...base, ...minimal].join(', ');
      // Sorting: whitelist a few safe columns
      let sortCol = 'created_at';
      let sortDir = (sortDirReq === 'asc' || sortDirReq === 'desc') ? sortDirReq : 'desc';
      const allowed = new Set(['created_at','id','version']);
      if (has('product_id')) allowed.add('product_id');
      if (allowed.has(sortByReq)) sortCol = sortByReq;
      const orderSql = `${sortCol} ${sortDir}, id ${sortCol==='id'? sortDir : 'desc'}`;
      const sql = `select ${selCols} from public.mod_grabbing_sensorex_extraction_runs ${where.length? 'where '+where.join(' and '): ''} order by ${orderSql} limit $${i} offset $${i+1}`;
      params.push(limit, offset);
      const rows = await pool.query(sql, params);
      return res.json({ ok:true, items: rows.rows, count: rows.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'history_failed', message: e?.message || String(e) }); }
  });

  // History: delete single run
  app.delete('/api/grabbing-sensorex/extraction/history/:id', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`delete from public.mod_grabbing_sensorex_extraction_runs where id=$1`, [id]);
      try { chatLog?.('run_delete', { id, deleted: r.rowCount||0 }); } catch (e) {}
      return res.json({ ok:true, deleted: Number(r.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // History: delete multiple runs
  app.post('/api/grabbing-sensorex/extraction/history/delete', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const ids = Array.isArray(b.ids) ? b.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
      if (!ids.length) return res.status(400).json({ ok:false, error:'bad_request', message:'ids required' });
      const r = await pool.query(`delete from public.mod_grabbing_sensorex_extraction_runs where id = any($1::bigint[])`, [ids]);
      try { chatLog?.('run_delete_many', { ids_count: ids.length, deleted: r.rowCount||0 }); } catch (e) {}
      return res.json({ ok:true, requested: ids.length, deleted: Number(r.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_many_failed', message: e?.message || String(e) }); }
  });

  // History: flatten JSON paths for a run
  app.get('/api/grabbing-sensorex/extraction/paths', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const id = Number(req.query?.id || 0) || 0;
      const max = Math.min(20000, Math.max(1, Number(req.query?.max || 5000)));
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`select id, domain, url, page_type, version, result from public.mod_grabbing_sensorex_extraction_runs where id=$1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      let data = r.rows[0]?.result;
      if (data && typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) {}
      }
      const items = [];
      const seen = new Set();
      const aggMap = new Map();
      const normalize = (p) => String(p||'').replace(/\.(?:\d+)(?!\d)/g, '.[]');
      function push(path, val) {
        if (items.length >= max) return;
        const key = `${path}`;
        if (!seen.has(key)) {
          seen.add(key);
          let t = (val === null) ? 'null' : Array.isArray(val) ? 'array' : typeof val;
          let preview;
          try {
            if (t === 'object' || t === 'array') preview = JSON.stringify(val).slice(0, 300);
            else preview = String(val);
          } catch { preview = String(val); }
          items.push({ path, type: t, preview });
        }
        const np = normalize(path);
        let row = aggMap.get(np);
        if (!row) { row = { count: 0, examples: new Set() }; aggMap.set(np, row); }
        row.count++;
        if (row.examples.size < 3) {
          try { row.examples.add((typeof val === 'object') ? JSON.stringify(val) : String(val)); } catch { row.examples.add(String(val)); }
        }
      }
      function walk(node, prefix) {
        if (items.length >= max) return;
        if (node === null) { push(prefix, null); return; }
        if (Array.isArray(node)) { if (node.length === 0) { push(prefix, []); return; } for (let i=0;i<node.length;i++) { const p = prefix ? `${prefix}.${i}` : String(i); walk(node[i], p); if (items.length >= max) break; } return; }
        const t = typeof node;
        if (t === 'object') { const keys = Object.keys(node); if (keys.length === 0) { push(prefix, {}); return; } for (const k of keys) { const p = prefix ? `${prefix}.${k}` : k; walk(node[k], p); if (items.length >= max) break; } return; }
        push(prefix, node);
      }
      walk(data, '');
      const aggregated = []; for (const [path, row] of aggMap.entries()) aggregated.push({ path, count: row.count, examples: Array.from(row.examples) });
      aggregated.sort((a,b) => a.path.localeCompare(b.path));
      return res.json({ ok:true, id, total: items.length, items, aggregated });
    } catch (e) { return res.status(500).json({ ok:false, error:'paths_failed', message: e?.message || String(e) }); }
  });
  // Get single run by id (include full result/config) – portable across schema variants
  app.get('/api/grabbing-sensorex/extraction/history/:id', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });

      // Discover available columns
      const colSet = new Set();
      try {
        const rCols = await pool.query(
          `select column_name from information_schema.columns where table_schema='public' and table_name='mod_grabbing_sensorex_extraction_runs'`
        );
        for (const row of rCols.rows || []) colSet.add(String(row.column_name));
      } catch (e) {}
      const has = (c) => colSet.has(String(c));
      const cols = ['id','domain','url','page_type','version','config_hash','config','result','ok','error'];
      if (has('product_id')) cols.push('product_id');
      if (has('mapping_version')) cols.push('mapping_version');
      if (has('mapping')) cols.push('mapping');
      if (has('transfer')) cols.push('transfer');
      cols.push('created_at');
      if (has('updated_at')) cols.push('updated_at');

      const sql = `select ${cols.join(', ')} from public.mod_grabbing_sensorex_extraction_runs where id=$1`;
      const r = await pool.query(sql, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'history_get_failed', message: e?.message || String(e) }); }
  });
}
