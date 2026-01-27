import { createRequire } from 'module';
import path from 'path';
import { createHash } from 'crypto';

export function registerGrabbingJeromeExtractionRoutes(app, _ctx = {}, utils = {}) {
  const { pool, normDomain, ensureExtractionTable, ensureExtractionRunsTable, chatLog } = utils;
  if (!pool || typeof pool.query !== 'function') return;

  // List extraction tool versions
  app.get('/api/grabbing-jerome/extraction/tools', async (req, res) => {
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
      const total = await pool.query(`select count(*)::int as c from public.mod_grabbing_jerome_extraction_tools ${whereSql}`, params);
      const items = await pool.query(
        `select id, domain, page_type, version, name, enabled, created_at, updated_at
           from public.mod_grabbing_jerome_extraction_tools
           ${whereSql}
           order by domain asc, page_type asc, version desc, updated_at desc
           limit $${i} offset $${i+1}`,
        [...params, limit, offset]
      );
      return res.json({ ok:true, total: Number(total.rows?.[0]?.c || 0), items: items.rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_extract_failed', message: e?.message || String(e) }); }
  });

  // Step 4: Test extraction (mirror of inline handler; mounted here to guarantee availability)
  app.post('/api/grabbing-jerome/extraction/test', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const url = String(req.body?.url || '').trim();
      let domain = normDomain(req.body?.domain);
      const pageType = String(req.body?.page_type || '').trim().toLowerCase() || 'product';
      const version = Number(req.body?.version || 0) || 0;
      let cfg = req.body?.config || null;
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
            let runId = null;
            try {
              const ins = await pool.query(
                `insert into public.mod_grabbing_jerome_extraction_runs
                   (domain,url,page_type,version,config_hash,config,result,ok,error,created_at,updated_at)
                 values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9, now(), now())
                 returning id`,
                [domain || normDomain(req.body?.domain), url, pageType, ver, cfgHash, JSON.stringify(cfg||{}), JSON.stringify(null), false, String(message||errCode)]
              );
              runId = ins.rows?.[0]?.id || null;
              return res.status(status).json({ ok:false, error: errCode, message, saved: true, run_id: runId, used_version: ver, config_source: configSource || '' });
            } catch (_) {
              return res.status(status).json({ ok:false, error: errCode, message, saved: false, run_id: null, used_version: ver, config_source: configSource || '' });
            }
          }
        } catch {}
        return res.status(status).json({ ok:false, error: errCode, message, saved: false, run_id: null, used_version: usedVersion || version || null, config_source: configSource || '' });
      };

      if (!url) return persistAndReturnError(400, 'bad_request', 'url required');
      if (!domain) { try { domain = new URL(url).hostname.toLowerCase().replace(/^www\./,''); } catch {} }
      if (!domain) return persistAndReturnError(400, 'bad_request', 'domain required');

      // Load config when not provided
      if (!cfg) {
        if (!version) {
          try {
            await ensureExtractionRunsTable();
            let rr = await pool.query(
              `select version, config from public.mod_grabbing_jerome_extraction_runs
                where domain=$1 and lower(page_type)=lower($2) and lower(trim(both from url)) = lower(trim(both from $3))
                order by created_at desc limit 1`,
              [domain, pageType, url]
            );
            if (!rr.rowCount) {
              rr = await pool.query(
                `select version, config from public.mod_grabbing_jerome_extraction_runs
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
          } catch {}
        }
        if (!cfg) {
          await ensureExtractionTable();
          const r = await pool.query(
            `select id, version, config from public.mod_grabbing_jerome_extraction_tools
              where domain=$1 and lower(page_type)=lower($2)
              order by ${version? 'case when version=$$v$$ then 0 else 1 end, ': ''}version desc, updated_at desc
              limit 1`.replace('$$v$$', String(version)),
            [domain, pageType]
          );
          if (!r.rowCount) return persistAndReturnError(404, 'config_not_found', 'config_not_found');
          cfg = r.rows[0].config || {};
          usedVersion = Number(r.rows[0].version || usedVersion || 0) || null;
          if (!configSource) configSource = 'tool_latest';
        }
      } else if (typeof cfg === 'string') {
        try { cfg = JSON.parse(cfg); configSource = 'provided'; } catch (e) { return res.status(400).json({ ok:false, error:'invalid_json', message:String(e?.message||e) }); }
      } else {
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
      } catch {}
      if (!__cheerioLoad) {
        try { const req = createRequire(path.join(process.cwd(), 'package.json')); const mod = req('cheerio'); __cheerioLoad = (mod && mod.load) ? mod.load : (mod?.default?.load || null); } catch {}
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
          const selector = atIdx >= 0 ? s.slice(0, atIdx) : s; const attr = atIdx >= 0 ? s.slice(atIdx+1) : (attrHint||'');
          try { $(selector).each((_, el) => { const w = attr ? $(el).attr(attr) : $(el).text(); if (w) results.push(normSpace(String(w))); }); } catch {}
        }
        return results;
      };
      const uniq = (arr) => Array.from(new Set((arr||[]).map(x => String(x||'').trim()).filter(Boolean)));

      // Map basic fields
      const out = { url, page_type: pageType };
      try {
        const m = (cfg && typeof cfg==='object' ? cfg : {});
        out.title = pickFrom(m.title || ['meta[property="og:title"]@content','title']);
        out.description = pickFrom(m.description || ['meta[name="description"]@content']);
        const priceRaw = pickFrom(m.price || []);
        out.price = priceRaw ? Number(String(priceRaw).replace(/[^0-9.,]/g,'').replace(',','.')) : null;
        const imgSel = m.image || ["meta[property=\"og:image\"]@content","img@src"];
        const img = pickFrom(imgSel);
        out.image = img ? abs(img, url) : '';
        const imgSources = (m.images && typeof m.images === 'object' && Array.isArray(m.images.sources)) ? m.images.sources : (m.images || ['img@src']);
        const imgs = pickAll(imgSources, 'src').map(h=>abs(h,url));
        if (out.image) imgs.unshift(out.image);
        out.images = uniq(imgs);
        out.brand = pickFrom(m.brand || []);
        out.sku = pickFrom(m.sku || []);
        out.categories = uniq(pickAll(m.categories || [], 'text'));
        out.json_ld = {};

        // Colors (codes/labels/swatches)
        try {
          if (m.colors && typeof m.colors === 'object') {
            const col = {};
            if (m.colors.codes) col.codes = uniq(pickAll(m.colors.codes, 'value'));
            if (m.colors.labels) col.labels = uniq(pickAll(m.colors.labels, 'text'));
            if (m.colors.swatches) col.swatches = uniq(pickAll(m.colors.swatches, 'style'));
            if (Object.keys(col).length) out.colors = col;
          }
        } catch {}

        // Variants (WooCommerce data-product_variations)
        try {
          const rawAttr = $('form.variations_form').attr('data-product_variations') || '';
          if (rawAttr) {
            let arr = [];
            try { arr = JSON.parse(decodeEntities(rawAttr)); } catch {}
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
                    attributes: {
                      junction: attrs['attribute_junction'] || null,
                      connector: attrs['attribute_connector'] || null,
                      temperature_compensation: attrs['attribute_temperature-compensation'] || null,
                      length: attrs['attribute_length'] || null
                    }
                  });
                } catch {}
              }
              const skus = Array.from(new Set(items.map(it => String(it.sku||'').trim()).filter(Boolean)));
              if (items.length) out.variants = { skus, items };
              // Compatibility: also expose compact list under product.variant_skus
              try {
                if (skus.length) {
                  if (!out.product || typeof out.product !== 'object') out.product = {};
                  out.product.variant_skus = skus;
                }
              } catch {}
            }
          }
        } catch {}

        // Product subfields (populate out.product)
        try {
          const P = (m.product && typeof m.product === 'object') ? m.product : {};
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
        } catch {}

        // Sections (as arrays)
        try {
          if (m.sections && typeof m.sections === 'object') {
            const sec = {};
            for (const [key, sel] of Object.entries(m.sections)) {
              try { const arr = pickAll(sel, 'text'); if (arr && arr.length) sec[key] = uniq(arr); } catch {}
            }
            if (Object.keys(sec).length) out.sections = sec;
          }
        } catch {}

        // Attributes table/list extraction
        try {
          if (m.attributes && typeof m.attributes === 'object') {
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
                    if (!value && valSel) value = normSpace(sc.attr(valSel) || '');
                    if (name && value) items.push({ name, value });
                  } catch {}
                });
              } catch {}
            }
            if (items.length) out.attributes = items;
          }
        } catch {}

        // JSON-LD extraction/mapping
        try {
          const JL = (m.json_ld && typeof m.json_ld === 'object') ? m.json_ld : {};
          if (JL.enabled !== false) {
            const sel = JL.selector || "script[type='application/ld+json']";
            const typesPref = Array.isArray(JL.prefer_types) ? JL.prefer_types : [];
            const blobs = [];
            try {
              $(sel).each((_, el) => { try { const txt = $(el).text(); if (txt && txt.trim()) blobs.push(txt.trim()); } catch {} });
            } catch {}
            const parsed = [];
            for (const t of blobs) {
              try {
                const j = JSON.parse(t);
                if (Array.isArray(j)) { for (const it of j) parsed.push(it); }
                else parsed.push(j);
              } catch {}
            }
            // Pick first product-like node
            let prodNode = null;
            for (const node of parsed) {
              try {
                const ty = Array.isArray(node['@type']) ? node['@type'] : (node['@type'] ? [node['@type']] : []);
                if (!typesPref.length) { if (ty.includes('Product')) { prodNode = node; break; } }
                else if (ty.some(t => typesPref.includes(String(t)))) { prodNode = node; break; }
              } catch {}
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
        } catch {}
        // Documents (PDFs, etc.) — from config.documents or fallback scan
        try {
          const dcfg = (m.documents && typeof m.documents==='object') ? m.documents : {};
          const srcs = Array.isArray(dcfg.sources) ? dcfg.sources : null;
          let candidates = [];
          if (srcs && srcs.length) {
            candidates = pickAll(srcs, 'href').map(h => abs(h, url));
          } else {
            try {
              $('a[href],link[href]').each((_, el) => {
                const href = $(el).attr('href'); if (!href) return; const a = abs(href, url); if (a) candidates.push(a);
              });
            } catch {}
          }
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
        } catch {}
      } catch {}

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
          const ins = await pool.query(
            `insert into public.mod_grabbing_jerome_extraction_runs
               (domain,url,page_type,version,config_hash,config,result,ok,error,created_at,updated_at)
             values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9, now(), now())
             returning id`,
            [domain, url, pageType, usedVersion, cfgHash, JSON.stringify(cfg||{}), JSON.stringify(out||{}), true, null]
          );
          const runId = ins.rows?.[0]?.id || null;
          return res.json({ ok:true, url, domain, page_type: pageType, result: out, saved: true, run_id: runId, used_version: usedVersion, config_source: configSource });
        } catch (e) {
          return res.json({ ok:true, url, domain, page_type: pageType, result: out, saved: false, save_error: String(e?.message || e), used_version: usedVersion, config_source: configSource });
        }
      }
      return res.json({ ok:true, url, domain, page_type: pageType, result: out, used_version: usedVersion, config_source: configSource });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'test_failed', message: e?.message || String(e) });
    }
  });

  // Get latest tool config
  app.get('/api/grabbing-jerome/extraction/tools/latest', async (req, res) => {
    try {
      await ensureExtractionTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const where = [`domain = $1`, `lower(page_type) = $2`];
      const params = [domain, pageType];
      const r = await pool.query(
        `select id, domain, page_type, version, name, enabled, config, created_at, updated_at
           from public.mod_grabbing_jerome_extraction_tools
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
  app.get('/api/grabbing-jerome/extraction/tools/get', async (req, res) => {
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
           from public.mod_grabbing_jerome_extraction_tools
          where ${where.join(' and ')}
          limit 1`,
        params
      );
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_failed', message: e?.message || String(e) }); }
  });

  // Upsert tool config (create or update specific version)
  app.post('/api/grabbing-jerome/extraction/tools', async (req, res) => {
    try {
      await ensureExtractionTable();
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
          `insert into public.mod_grabbing_jerome_extraction_tools (domain,page_type,version,name,config,enabled,updated_at)
           values ($1,$2, coalesce((select max(version)+1 from public.mod_grabbing_jerome_extraction_tools where domain=$1 and lower(page_type)=lower($2)),1), $3, $4::jsonb, $5, now())
           returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [domain, pageType, name, JSON.stringify(config||{}), enabled]
        );
        row = r.rows[0];
      } else {
        const upd = await pool.query(
          `update public.mod_grabbing_jerome_extraction_tools
              set name=$1, config=$2::jsonb, enabled=$3, updated_at=now()
            where domain=$4 and lower(page_type)=lower($5) and version=$6
            returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [name, JSON.stringify(config||{}), enabled, domain, pageType, version]
        );
        if (upd.rowCount) row = upd.rows[0];
        else {
          const ins = await pool.query(
            `insert into public.mod_grabbing_jerome_extraction_tools (domain,page_type,version,name,config,enabled,updated_at)
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
  app.delete('/api/grabbing-jerome/extraction/tools', async (req, res) => {
    try {
      await ensureExtractionTable();
      const id = Number(req.query?.id || req.body?.id || 0);
      const domain = normDomain(req.query?.domain || req.body?.domain);
      const pageType = String(req.query?.page_type || req.body?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || req.body?.version || 0);
      let r;
      if (id) {
        r = await pool.query(`delete from public.mod_grabbing_jerome_extraction_tools where id=$1`, [id]);
      } else if (domain && pageType && version) {
        r = await pool.query(`delete from public.mod_grabbing_jerome_extraction_tools where domain=$1 and lower(page_type)=lower($2) and version=$3`, [domain, pageType, version]);
      } else {
        return res.status(400).json({ ok:false, error:'bad_request' });
      }
      return res.json({ ok:true, deleted: Number(r?.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_extract_failed', message: e?.message || String(e) }); }
  });

  // History: list
  app.get('/api/grabbing-jerome/extraction/history', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const domain = normDomain(req.query?.domain);
      const url = String(req.query?.url || '').trim();
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || 0) || null;
      const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const includeFull = String(req.query?.include || '').toLowerCase() === 'full' || req.query?.include === '1';
      const where = [];
      const params = [];
      let i = 1;
      if (domain) { where.push(`domain = $${i}`); params.push(domain); i++; }
      if (url) { where.push(`lower(trim(both from url)) = lower(trim(both from $${i}))`); params.push(url); i++; }
      if (pageType) { where.push(`lower(page_type) = lower($${i})`); params.push(pageType); i++; }
      if (version) { where.push(`version = $${i}`); params.push(version); i++; }
      const selCols = includeFull
        ? `id, domain, url, page_type, version, config_hash, config, result, ok, error, product_id, mapping_version, mapping, transfer, created_at, updated_at`
        : `id, domain, url, page_type, version, config_hash, ok, error, product_id, mapping_version, created_at`;
      const sql = `select ${selCols} from public.mod_grabbing_jerome_extraction_runs ${where.length? 'where '+where.join(' and '): ''} order by created_at desc limit $${i} offset $${i+1}`;
      params.push(limit, offset);
      const rows = await pool.query(sql, params);
      return res.json({ ok:true, items: rows.rows, count: rows.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'history_failed', message: e?.message || String(e) }); }
  });

  // History: delete single run
  app.delete('/api/grabbing-jerome/extraction/history/:id', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`delete from public.mod_grabbing_jerome_extraction_runs where id=$1`, [id]);
      try { chatLog?.('run_delete', { id, deleted: r.rowCount||0 }); } catch {}
      return res.json({ ok:true, deleted: Number(r.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // History: delete multiple runs
  app.post('/api/grabbing-jerome/extraction/history/delete', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const ids = Array.isArray(b.ids) ? b.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
      if (!ids.length) return res.status(400).json({ ok:false, error:'bad_request', message:'ids required' });
      const r = await pool.query(`delete from public.mod_grabbing_jerome_extraction_runs where id = any($1::bigint[])`, [ids]);
      try { chatLog?.('run_delete_many', { ids_count: ids.length, deleted: r.rowCount||0 }); } catch {}
      return res.json({ ok:true, requested: ids.length, deleted: Number(r.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_many_failed', message: e?.message || String(e) }); }
  });

  // History: flatten JSON paths for a run
  app.get('/api/grabbing-jerome/extraction/paths', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const id = Number(req.query?.id || 0) || 0;
      const max = Math.min(20000, Math.max(1, Number(req.query?.max || 5000)));
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`select id, domain, url, page_type, version, result from public.mod_grabbing_jerome_extraction_runs where id=$1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      let data = r.rows[0]?.result;
      if (data && typeof data === 'string') {
        try { data = JSON.parse(data); } catch {}
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
  // Get single run by id (include full result/config)
  app.get('/api/grabbing-jerome/extraction/history/:id', async (req, res) => {
    try {
      await ensureExtractionRunsTable();
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`select id, domain, url, page_type, version, config_hash, config, result, ok, error, product_id, mapping_version, mapping, transfer, created_at, updated_at from public.mod_grabbing_jerome_extraction_runs where id=$1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'history_get_failed', message: e?.message || String(e) }); }
  });
}
