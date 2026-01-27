// Category extraction routes
export function registerGrabbingSensorexCategoryRoutes(app, ctx = {}, utils = {}) {
  if (!app) return;
  const pool = utils?.pool || ctx?.pool;
  const chatLog = typeof utils?.chatLog === 'function' ? utils.chatLog : (()=>{});
  const ensureExtractionRunsTable = typeof utils?.ensureExtractionRunsTable === 'function' ? utils.ensureExtractionRunsTable : async ()=>{};
  const ensureCategoryExtractTable = typeof utils?.ensureCategoryExtractTable === 'function' ? utils.ensureCategoryExtractTable : async ()=>{};
  const normDomain = typeof utils?.normDomain === 'function' ? utils.normDomain : (s=>String(s||'').toLowerCase().replace(/^www\./,''));

  function pickCategoriesList(result) {
    try {
      if (!result) return [];
      if (typeof result === 'string') { try { result = JSON.parse(result); } catch {} }
      const out = [];
      const push = (v) => { const s = String(v||'').trim(); if (s) out.push(s); };
      if (Array.isArray(result?.categories)) {
        for (const it of result.categories) {
          if (!it) continue;
          if (typeof it === 'string') push(it);
          else if (typeof it === 'object') push(it.name || it.text || it.title || '');
        }
      }
      try { if (result?.product?.category) push(result.product.category); } catch {}
      try { if (result?.category) push(result.category); } catch {}
      // uniq, keep order
      const seen = new Set();
      const uniq = out.filter(s => { if (seen.has(s)) return false; seen.add(s); return true; });
      return uniq;
    } catch { return []; }
  }
  function pickCategory(result) {
    try {
      if (!result) return '';
      if (typeof result === 'string') { try { result = JSON.parse(result); } catch {} }
      let category = '';
      if (!category && result?.product?.category) category = String(result.product.category).trim();
      if (!category && result?.category) category = String(result.category).trim();
      if (!category && Array.isArray(result?.categories) && result.categories.length) {
        const first = result.categories.find(x => x) || result.categories[0];
        category = typeof first === 'string' ? first : (first?.text || first?.name || '');
        category = String(category||'').trim();
      }
      return category || '';
    } catch { return ''; }
  }

  // Normalization helpers reused across mapping flows
  function normalizeName(s='') {
    try {
      let t = String(s||'');
      t = t.replace(/&amp;/gi,'&');
      t = t.replace(/[\u2013\u2014]/g,'-'); // – —
      // Remove common suffix/prefix noise words found on the source site
      t = t.replace(/\bproduct\s+categories?\b/gi,'');
      t = t.replace(/\bproduct\s+category\b/gi,'');
      t = t.replace(/\bsensorex\b/gi,'');
      t = t.replace(/\bliquid\s+analysis\s+technology\b/gi,'');
      // Collapse punctuation to spaces
      t = t.replace(/[\-–—:|/\\]+/g,' ');
      t = t.replace(/\s+/g,' ').trim().toLowerCase();
      return t;
    } catch { return String(s||'').toLowerCase(); }
  }
  function andAmpVariants(t) {
    const a = String(t||'');
    const v1 = a.replace(/\s*&\s*/g,' and ');
    const v2 = a.replace(/\band\b/gi,' & ');
    const v3 = a.replace(/\s+/g,' ').trim();
    return Array.from(new Set([a, v1, v2, v3]));
  }

  // POST /api/grabbing-sensorex/category/extract
  // Body: { run_id: number, product_id?: number }
  app.post('/api/grabbing-sensorex/category/extract', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureExtractionRunsTable();
      await ensureCategoryExtractTable();
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const runId = Number(b.run_id || b.id || 0) || 0;
      if (!runId) return res.status(400).json({ ok:false, error:'bad_request', message:'run_id required' });
      const r = await pool.query(`select id, domain, url, page_type, result, product_id from public.mod_grabbing_sensorex_extraction_runs where id=$1`, [runId]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'run_not_found' });
      const row = r.rows[0];
      let result = row.result;
      if (result && typeof result === 'string') { try { result = JSON.parse(result); } catch {} }
      // Extract category: prefer result.product.category, else result.category, else first of result.categories
      let category = '';
      try { if (!category && result?.product?.category) category = String(result.product.category).trim(); } catch {}
      try { if (!category && result?.category) category = String(result.category).trim(); } catch {}
      try {
        if (!category && Array.isArray(result?.categories) && result.categories.length) {
          const first = result.categories.find(x => x) || result.categories[0];
          category = typeof first === 'string' ? first : (first?.text || first?.name || '');
          category = String(category||'').trim();
        }
      } catch {}
      if (!category) return res.status(404).json({ ok:false, error:'category_not_found' });
      // Resolve product_id: body overrides, then run.product_id
      const productId = Number(b.product_id != null ? b.product_id : row.product_id) || 0;
      if (!productId) return res.status(400).json({ ok:false, error:'missing_product_id' });
      // Prepare categories list from result for storage
      const categoriesList = pickCategoriesList(result);
      // Insert (idempotent) into extract table and store categories array
      const sql = `insert into public.mod_grabbing_sensorex_category_extract (product_id, category, categories) values ($1,$2,$3::jsonb)
                   on conflict (product_id, category) do update set categories = EXCLUDED.categories`;
      await pool.query(sql, [productId, category, JSON.stringify(categoriesList||[])]);
      try { chatLog('category_extract_upsert', { run_id: runId, product_id: productId, category }); } catch {}

      // Optional: map to Presta id_category in the same call if profile/prefix provided
      const profId = Number(b.profile_id||0)||0;
      const prefix = String(b.prefix||'');
      const idLang = b.id_lang != null ? Number(b.id_lang)||0 : 0;
      if (profId && prefix) {
        let conn;
        try {
          const { connectMySql, makeSqlHelpers } = await import('../services/transfer/mysql.js');
          const pr = await pool.query(`SELECT id, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profId]);
          if (pr.rowCount) {
            const prof = pr.rows[0];
            conn = await connectMySql(ctx, {
              host: String(prof.host||'localhost'),
              port: Number(prof.port||3306),
              user: String(prof.user||''),
              password: String(prof.password||''),
              database: String(prof.database||''),
              ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
            });
            const { q, qi } = makeSqlHelpers(conn);
            const T_CL = prefix + 'category_lang';
            const where = idLang ? `WHERE ${qi('id_lang')}=${idLang}` : '';
            const rows = await q(`SELECT ${qi('id_category')} AS id_category, ${qi('name')} AS name FROM ${qi(T_CL)} ${where}`);
            const catalog = [];
            for (const r2 of rows) {
              const nm = String(r2.name||'').trim();
              const cid = Number(r2.id_category||0)||0;
              if (!nm || !cid) continue;
              const base = normalizeName(nm);
              const variants = andAmpVariants(base);
              catalog.push({ id: cid, base, variants, len: base.length });
            }
            // pick best match
            const raw = String(category||'').trim();
            const needleBase = normalizeName(raw);
            const needles = andAmpVariants(needleBase);
            let best = null;
            for (const cat of catalog) {
              if (cat.variants.some(v => needles.includes(v))) { if (!best || cat.id > best.id) best = cat; }
            }
            if (!best) {
              for (const cat of catalog) {
                const m = cat.variants.some(v => needles.some(n => v.includes(n)));
                if (m) { if (!best || cat.id > best.id) best = cat; }
              }
            }
            if (!best) {
              for (const cat of catalog) {
                const m = needles.some(n => cat.variants.some(v => n.includes(v)));
                if (m) { if (!best || cat.id > best.id) best = cat; }
              }
            }
            if (best && best.id) {
              // Build full match list
              const needles = andAmpVariants(normalizeName(category));
              const matches = new Set();
              for (const cat of catalog) {
                if (cat.variants.some(v => needles.includes(v))) matches.add(cat.id);
                else if (cat.variants.some(v => needles.some(n => v.includes(n)))) matches.add(cat.id);
                else if (needles.some(n => cat.variants.some(v => n.includes(v)))) matches.add(cat.id);
              }
              const arr = Array.from(matches.size? matches : [best.id]);
              await pool.query(`UPDATE public.mod_grabbing_sensorex_category_extract SET id_category=$1, id_categories=$2 WHERE product_id=$3 AND category=$4`, [best.id, arr, productId, category]);
            }
          }
        } catch (e) { try { chatLog('category_extract_map_error', { error: String(e?.message||e) }); } catch {} }
        finally { try { if (conn) await conn.end(); } catch {} }
      }
      return res.json({ ok:true, run_id: runId, product_id: productId, category });
    } catch (e) {
      try { chatLog('category_extract_error', { error: String(e?.message||e) }); } catch {}
      return res.status(500).json({ ok:false, error:'extract_failed', message: e?.message || String(e) });
    }
  });

  // POST /api/grabbing-sensorex/category/rebuild
  // Clears the extract table and refills it from extraction runs.
  // Body: { domain?: string, page_type?: string }
  app.post('/api/grabbing-sensorex/category/rebuild', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureExtractionRunsTable();
      await ensureCategoryExtractTable();
      // Clear table (global)
      try { await pool.query(`TRUNCATE TABLE public.mod_grabbing_sensorex_category_extract`); }
      catch { await pool.query(`DELETE FROM public.mod_grabbing_sensorex_category_extract`); }

      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const domain = body.domain ? normDomain(body.domain) : null;
      const pageType = String(body.page_type || 'product').trim().toLowerCase();
      const params = [];
      const where = [];
      if (domain) { where.push(`regexp_replace(lower(coalesce(domain,'')),'^www\\.','') = regexp_replace(lower($1),'^www\\.','')`); params.push(domain); }
      if (pageType) { where.push(`lower(page_type) = lower($${params.length+1})`); params.push(pageType); }
      const sql = `select id, domain, url, page_type, result, product_id from public.mod_grabbing_sensorex_extraction_runs ${where.length? 'where '+where.join(' and '): ''} order by id asc`;
      const rr = await pool.query(sql, params);
      let total = rr.rowCount || 0;
      let inserted = 0;
      for (const row of rr.rows || []) {
        const productId = Number(row.product_id||0) || 0;
        if (!productId) continue; // require a product id
        const category = pickCategory(row.result);
        if (!category) continue;
        const categoriesList = pickCategoriesList(row.result);
        try {
          await pool.query(`insert into public.mod_grabbing_sensorex_category_extract (product_id, category, categories) values ($1,$2,$3::jsonb) on conflict (product_id, category) do update set categories = EXCLUDED.categories`, [productId, category, JSON.stringify(categoriesList||[])]);
          inserted++;
        } catch (e) { /* keep portable */ }
      }
      // Optional inline mapping after rebuild when profile/prefix provided
      const profId = Number(body.profile_id||0)||0;
      const prefix = String(body.prefix||'');
      const idLang = body.id_lang != null ? Number(body.id_lang)||0 : 0;
      let updated = 0; let unmatched = 0;
      if (profId && prefix) {
        let conn;
        try {
          const { connectMySql, makeSqlHelpers } = await import('../services/transfer/mysql.js');
          const pr = await pool.query(`SELECT id, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profId]);
          if (pr.rowCount) {
            const prof = pr.rows[0];
            conn = await connectMySql(ctx, {
              host: String(prof.host||'localhost'),
              port: Number(prof.port||3306),
              user: String(prof.user||''),
              password: String(prof.password||''),
              database: String(prof.database||''),
              ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
            });
            const { q, qi } = makeSqlHelpers(conn);
            const T_CL = prefix + 'category_lang';
            const w = idLang ? `WHERE ${qi('id_lang')}=${idLang}` : '';
            const rows = await q(`SELECT ${qi('id_category')} AS id_category, ${qi('name')} AS name FROM ${qi(T_CL)} ${w}`);
            const catalog = [];
            for (const r2 of rows) {
              const nm = String(r2.name||'').trim();
              const cid = Number(r2.id_category||0)||0;
              if (!nm || !cid) continue;
              const base = normalizeName(nm);
              const variants = andAmpVariants(base);
              catalog.push({ id: cid, base, variants, len: base.length });
            }
            const pgRows = await pool.query(`SELECT product_id, category, categories FROM public.mod_grabbing_sensorex_category_extract WHERE id_category IS NULL OR id_categories IS NULL`);
            for (const it of pgRows.rows || []) {
              const raw = String(it.category||'').trim();
              const needleBase = normalizeName(raw);
              // Build needles from primary category and also from categories JSON list
              let allNeedles = new Set();
              const addNeedles = (s) => {
                const b = normalizeName(String(s||''));
                if (!b) return;
                for (const v of andAmpVariants(b)) allNeedles.add(v);
              };
              if (needleBase) { for (const v of andAmpVariants(needleBase)) allNeedles.add(v); }
              try { if (Array.isArray(it.categories)) { for (const nm of it.categories) addNeedles(nm); } } catch {}
              let best = null;
              const matches = new Set();
              const needlesArr = Array.from(allNeedles);
              for (const cat of catalog) { if (cat.variants.some(v => needlesArr.includes(v))) { matches.add(cat.id); if (!best || cat.id > best.id) best = cat; } }
              if (!best) { for (const cat of catalog) { const m = cat.variants.some(v => needlesArr.some(n => v.includes(n))); if (m) { matches.add(cat.id); if (!best || cat.id > best.id) best = cat; } } }
              if (!best) { for (const cat of catalog) { const m = needlesArr.some(n => cat.variants.some(v => n.includes(v))); if (m) { matches.add(cat.id); if (!best || cat.id > best.id) best = cat; } } }
              if (best && best.id) { const arr = Array.from(matches.size? matches : [best.id]); await pool.query(`UPDATE public.mod_grabbing_sensorex_category_extract SET id_category=$1, id_categories=$2 WHERE product_id=$3 AND category=$4`, [best.id, arr, it.product_id, it.category]); updated++; }
              else { unmatched++; }
            }
          }
        } catch (e) { try { chatLog('category_rebuild_map_error', { error: String(e?.message||e) }); } catch {} }
        finally { try { if (conn) await conn.end(); } catch {} }
      }
      try { chatLog('category_rebuild', { domain, page_type: pageType, total, inserted, updated, unmatched }); } catch {}
      return res.json({ ok:true, total, inserted, updated, unmatched });
    } catch (e) {
      try { chatLog('category_rebuild_error', { error: String(e?.message||e) }); } catch {}
      return res.status(500).json({ ok:false, error:'rebuild_failed', message: e?.message || String(e) });
    }
  });

  // GET /api/grabbing-sensorex/category/extract
  // Lists rows from mod_grabbing_sensorex_category_extract with optional filters
  // Query: product_id?, q? (substring on category), limit?, offset?
  app.get('/api/grabbing-sensorex/category/extract', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureCategoryExtractTable();
      const productId = req.query?.product_id != null ? Number(req.query.product_id)||0 : 0;
      const qstr = String(req.query?.q||'').trim();
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit||200)));
      const offset = Math.max(0, Number(req.query?.offset||0));
      const where = [];
      const params = [];
      let i = 1;
      if (productId) { where.push(`product_id = $${i++}`); params.push(productId); }
      if (qstr) { where.push(`category ILIKE '%'||$${i++}||'%'`); params.push(qstr); }
      const sql = `SELECT product_id, category, categories, id_category, id_categories, created_at
                   FROM public.mod_grabbing_sensorex_category_extract
                   ${where.length? 'WHERE '+where.join(' AND '): ''}
                   ORDER BY product_id ASC, category ASC
                   LIMIT $${i++} OFFSET $${i}`;
      params.push(limit, offset);
      const r = await pool.query(sql, params);
      return res.json({ ok:true, items: r.rows, count: r.rowCount });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) });
    }
  });

  // POST /api/grabbing-sensorex/category/map-presta
  // Maps category names to Presta id_category, updating id_category in the extract table.
  // Body: { profile_id: number, prefix: string, id_lang?: number }
  app.post('/api/grabbing-sensorex/category/map-presta', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureCategoryExtractTable();
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const profileId = Number(b.profile_id||0) || 0;
      const prefix = String(b.prefix||'ps_');
      const idLang = b.id_lang != null ? Number(b.id_lang)||0 : 0;
      if (!profileId || !prefix) return res.status(400).json({ ok:false, error:'bad_request', message:'profile_id and prefix required' });

      // Load MySQL profile
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];

      // Connect to MySQL
      let conn;
      try {
        const { connectMySql, makeSqlHelpers } = await import('../services/transfer/mysql.js');
        conn = await connectMySql(ctx, {
          host: String(prof.host||'localhost'),
          port: Number(prof.port||3306),
          user: String(prof.user||''),
          password: String(prof.password||''),
          database: String(prof.database||''),
          ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
        });
        const { q, qi } = makeSqlHelpers(conn);

        // Normalizer helpers for robust matching
        const normalize = (s='') => {
          try {
            let t = String(s||'');
            t = t.replace(/&amp;/gi,'&');
            t = t.replace(/[\u2013\u2014]/g,'-'); // – —
            // Remove common suffix/prefix noise words
            t = t.replace(/\bproduct\s+categories?\b/gi,'');
            t = t.replace(/\bproduct\s+category\b/gi,'');
            t = t.replace(/\bsensorex\b/gi,'');
            t = t.replace(/\bliquid\s+analysis\s+technology\b/gi,'');
            // Collapse punctuation to spaces
            t = t.replace(/[\-–—:|/\\]+/g,' ');
            t = t.replace(/\s+/g,' ').trim().toLowerCase();
            return t;
          } catch { return String(s||'').toLowerCase(); }
        };
        const andAmpVariants = (t) => {
          const a = String(t||'');
          const v1 = a.replace(/\s*&\s*/g,' and ');
          const v2 = a.replace(/\band\b/gi,' & ');
          const v3 = a.replace(/\s+/g,' ').trim();
          return Array.from(new Set([a, v1, v2, v3]));
        };

        const T_CL = prefix + 'category_lang';
        const where = idLang ? `WHERE ${qi('id_lang')}=${idLang}` : '';
        const rows = await q(`SELECT ${qi('id_category')} AS id_category, ${qi('name')} AS name FROM ${qi(T_CL)} ${where}`);
        const catalog = [];
        for (const r of rows) {
          const nm = String(r.name||'').trim();
          const cid = Number(r.id_category||0)||0;
          if (!nm || !cid) continue;
          const base = normalize(nm);
          const variants = andAmpVariants(base);
          catalog.push({ id: cid, name: nm, base, variants, len: base.length });
        }

        // Load all rows; we'll backfill/merge categories JSON and compute union matches for id_categories
        const pgRows = await pool.query(`SELECT product_id, category, categories, id_category, id_categories FROM public.mod_grabbing_sensorex_category_extract`);
        // Backfill/merge categories JSON from latest extraction run for every row
        try {
          for (const it of pgRows.rows || []) {
            try {
              const pid = Number(it.product_id||0)||0;
              const cat = String(it.category||'');
              if (!pid || !cat) continue;
              const rr = await pool.query(`select result from public.mod_grabbing_sensorex_extraction_runs where product_id=$1 order by created_at desc limit 1`, [pid]);
              if (!rr.rowCount) continue;
              let res = rr.rows[0]?.result;
              if (res && typeof res === 'string') { try { res = JSON.parse(res); } catch {} }
              const list = pickCategoriesList(res);
              if (Array.isArray(list) && list.length) {
                const cur = Array.isArray(it.categories) ? it.categories : [];
                const merged = Array.from(new Set([...cur, ...list].map(s=>String(s||'').trim()).filter(Boolean)));
                await pool.query(`update public.mod_grabbing_sensorex_category_extract set categories=$3::jsonb where product_id=$1 and category=$2`, [pid, cat, JSON.stringify(merged)]);
              }
            } catch {}
          }
        } catch {}
        let updated = 0; let unmatched = 0;
        for (const it of pgRows.rows || []) {
          const raw = String(it.category||'').trim();
          const needleBase = normalize(raw);
          if (!needleBase && !(Array.isArray(it.categories) && it.categories.length)) { unmatched++; continue; }
          // Build needles: primary-only and union (primary + categories[])
          const primNeedles = needleBase ? andAmpVariants(needleBase) : [];
          let allNeedles = new Set(primNeedles);
          const addNeedles = (s) => { const b = normalize(String(s||'')); if (!b) return; for (const v of andAmpVariants(b)) allNeedles.add(v); };
          try { if (Array.isArray(it.categories)) { for (const nm of it.categories) addNeedles(nm); } } catch {}
          const needlesAll = Array.from(allNeedles);
          // Matches from union for id_categories
          let bestAll = null; const matchesAll = new Set(Array.isArray(it.id_categories) ? it.id_categories.map(n=>Number(n)||0).filter(n=>n>0) : []);
          for (const cat of catalog) { if (cat.variants.some(v => needlesAll.includes(v))) { matchesAll.add(cat.id); if (!bestAll || cat.id > bestAll.id) bestAll = cat; } }
          if (!bestAll) { for (const cat of catalog) { const m = cat.variants.some(v => needlesAll.some(n => v.includes(n))); if (m) { matchesAll.add(cat.id); if (!bestAll || cat.id > bestAll.id) bestAll = cat; } } }
          if (!bestAll) { for (const cat of catalog) { const m = needlesAll.some(n => cat.variants.some(v => n.includes(v))); if (m) { matchesAll.add(cat.id); if (!bestAll || cat.id > bestAll.id) bestAll = cat; } } }
          const arrAll = Array.from(matchesAll);
          // Matches from primary only for id_category default
          let bestPrim = null; const matchesPrim = new Set();
          if (primNeedles.length) {
            for (const cat of catalog) { if (cat.variants.some(v => primNeedles.includes(v))) { matchesPrim.add(cat.id); if (!bestPrim || cat.id > bestPrim.id) bestPrim = cat; } }
            if (!bestPrim) { for (const cat of catalog) { const m = cat.variants.some(v => primNeedles.some(n => v.includes(n))); if (m) { matchesPrim.add(cat.id); if (!bestPrim || cat.id > bestPrim.id) bestPrim = cat; } } }
            if (!bestPrim) { for (const cat of catalog) { const m = primNeedles.some(n => cat.variants.some(v => n.includes(v))); if (m) { matchesPrim.add(cat.id); if (!bestPrim || cat.id > bestPrim.id) bestPrim = cat; } } }
          }
          const bestId = bestPrim?.id || (arrAll.length ? Math.max(...arrAll) : 0);
          if (bestId || arrAll.length) {
            await pool.query(`UPDATE public.mod_grabbing_sensorex_category_extract SET id_category=$1, id_categories=$2 WHERE product_id=$3 AND category=$4`, [bestId||null, arrAll, it.product_id, it.category]);
            updated++;
          } else {
            unmatched++;
          }
        }
        try { await conn.end(); } catch {}
        try { chatLog('category_map_presta', { updated, unmatched, id_lang: idLang||null, prefix }); } catch {}
        return res.json({ ok:true, updated, unmatched });
      } catch (e) {
        try { if (conn) await conn.end(); } catch {}
        return res.status(500).json({ ok:false, error:'mysql_error', message: e?.message || String(e) });
      }
    } catch (e) {
      return res.status(500).json({ ok:false, error:'map_failed', message: e?.message || String(e) });
    }
  });

  // POST /api/grabbing-sensorex/category/apply-presta
  // Upserts ps_category_product for all matched categories and sets highest id_category as default in ps_product and ps_product_shop.
  // Body: { profile_id:number, prefix:string, domain?:string, page_type?:string, id_shops?:number[], product_ids?:number[] }
  app.post('/api/grabbing-sensorex/category/apply-presta', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureCategoryExtractTable();
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const profileId = Number(b.profile_id||0)||0;
      const prefix = String(b.prefix||'').trim();
      if (!profileId || !prefix) return res.status(400).json({ ok:false, error:'bad_request', message:'profile_id and prefix required' });

      // Resolve shops: prefer provided id_shops; else mapping_tools.config.tables.product_shop.settings.id_shops; else all active shops
      let idShops = Array.isArray(b.id_shops) ? b.id_shops.map(n=>Number(n)||0).filter(n=>n>0) : [];
      if (!idShops.length) {
        const domain = b.domain ? normDomain(b.domain) : null;
        const pageType = String(b.page_type||'product').trim().toLowerCase();
        if (domain) {
          try {
            const r = await pool.query(
              `select config from public.mod_grabbing_sensorex_maping_tools
               where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','')
                 and lower(page_type)=lower($2)
               order by version desc, updated_at desc limit 1`, [domain, pageType]
            );
            if (r.rowCount) {
              const cfg = r.rows[0]?.config && typeof r.rows[0].config==='object' ? r.rows[0].config : {};
              const shops = cfg?.tables?.product_shop?.settings?.id_shops;
              if (Array.isArray(shops)) idShops = shops.map(n=>Number(n)||0).filter(n=>n>0);
            }
          } catch {}
        }
      }

      // Select extract rows (optionally filtered by product_ids)
      let where = 'WHERE id_category IS NOT NULL';
      const productIds = Array.isArray(b.product_ids) ? b.product_ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
      const params = [];
      if (productIds.length) {
        where += ` AND product_id = ANY($1::int[])`;
        params.push(productIds);
      }
      let pgRows = await pool.query(`SELECT product_id, id_category, id_categories, category, categories, created_at FROM public.mod_grabbing_sensorex_category_extract ${where} ORDER BY created_at DESC`, params);

      // Best-effort backfill of categories JSON from latest extraction run when missing
      try {
        for (const it of pgRows.rows || []) {
          try {
            const pid = Number(it.product_id||0)||0;
            const cat = String(it.category||'');
            const hasCats = Array.isArray(it.categories) ? it.categories.length>0 : !!it.categories;
            if (!pid || !cat || hasCats) continue;
            const rr = await pool.query(`select result from public.mod_grabbing_sensorex_extraction_runs where product_id=$1 order by created_at desc limit 1`, [pid]);
            if (rr.rowCount) {
              let res = rr.rows[0]?.result;
              if (res && typeof res === 'string') { try { res = JSON.parse(res); } catch {} }
              const list = pickCategoriesList(res);
              if (Array.isArray(list) && list.length) {
                await pool.query(`update public.mod_grabbing_sensorex_category_extract set categories=$3::jsonb where product_id=$1 and category=$2`, [pid, cat, JSON.stringify(list)]);
              }
            }
          } catch {}
        }
      } catch {}

      // MySQL connect
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];

      const { connectMySql, makeSqlHelpers } = await import('../services/transfer/mysql.js');
      const conn = await connectMySql(ctx, {
        host: String(prof.host||'localhost'),
        port: Number(prof.port||3306),
        user: String(prof.user||''),
        password: String(prof.password||''),
        database: String(prof.database||''),
        ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
      });
      const { q, qi, hasColumn } = makeSqlHelpers(conn);

      const T_CP = prefix + 'category_product';
      const T_P = prefix + 'product';
      const T_PS = prefix + 'product_shop';
      const T_CL = prefix + 'category_lang';
      const T_SHOP = prefix + 'shop';

      // Build catalog of categories (all languages)
      let catalog = [];
      try {
        const rows = await q(`SELECT ${qi('id_category')} AS id_category, ${qi('name')} AS name FROM ${qi(T_CL)}`);
        for (const r of rows || []) {
          const nm = String(r.name||'').trim();
          const cid = Number(r.id_category||0)||0;
          if (!nm || !cid) continue;
          const base = normalizeName(nm);
          const variants = andAmpVariants(base);
          catalog.push({ id: cid, name: nm, base, variants, len: base.length });
        }
      } catch {}

      // Pre-pass: merge categories JSON from latest run and infer mapping when missing
      try {
        const pgMiss = await pool.query(`SELECT product_id, category, categories, id_category, id_categories FROM public.mod_grabbing_sensorex_category_extract`);
        for (const it of pgMiss.rows || []) {
          const pid = Number(it.product_id||0)||0;
          const catLabel = String(it.category||'').trim();
          if (!pid || !catLabel) continue;
          // Merge categories JSON from latest extraction
          try {
            const rr = await pool.query(`select result from public.mod_grabbing_sensorex_extraction_runs where product_id=$1 order by created_at desc limit 1`, [pid]);
            if (rr.rowCount) {
              let res = rr.rows[0]?.result;
              if (res && typeof res === 'string') { try { res = JSON.parse(res); } catch {} }
              const list = pickCategoriesList(res);
              if (Array.isArray(list) && list.length) {
                const cur = Array.isArray(it.categories) ? it.categories : [];
                const merged = Array.from(new Set([...cur, ...list].map(s=>String(s||'').trim()).filter(Boolean)));
                await pool.query(`update public.mod_grabbing_sensorex_category_extract set categories=$3::jsonb where product_id=$1 and category=$2`, [pid, catLabel, JSON.stringify(merged)]);
                it.categories = merged;
              }
            }
          } catch {}
          // Infer mapping with two sets: primary-only (for id_category default) and union (for id_categories)
          const raw = catLabel;
          const needleBase = normalizeName(raw);
          let allNeedles = new Set();
          const addNeedles = (s) => { const b = normalizeName(String(s||'')); if (!b) return; for (const v of andAmpVariants(b)) allNeedles.add(v); };
          if (needleBase) { for (const v of andAmpVariants(needleBase)) allNeedles.add(v); }
          try { if (Array.isArray(it.categories)) { for (const nm of it.categories) addNeedles(nm); } } catch {}
          const needles = Array.from(allNeedles);
          if (!needles.length) continue;
          // union matches
          let bestAll = null; const matchesAll = new Set(Array.isArray(it.id_categories)? it.id_categories.map(n=>Number(n)||0).filter(n=>n>0) : []);
          for (const cat of catalog) { if (cat.variants.some(v => needles.includes(v))) { matchesAll.add(cat.id); if (!bestAll || cat.id > bestAll.id) bestAll = cat; } }
          if (!bestAll) { for (const cat of catalog) { const m = cat.variants.some(v => needles.some(n => v.includes(n))); if (m) { matchesAll.add(cat.id); if (!bestAll || cat.id > bestAll.id) bestAll = cat; } } }
          if (!bestAll) { for (const cat of catalog) { const m = needles.some(n => cat.variants.some(v => n.includes(v))); if (m) { matchesAll.add(cat.id); if (!bestAll || cat.id > bestAll.id) bestAll = cat; } } }
          const arrAll = Array.from(matchesAll);
          // primary-only matches for default id_category
          let bestPrim = null; const matchesPrim = new Set();
          if (needleBase) {
            const prim = andAmpVariants(needleBase);
            for (const cat of catalog) { if (cat.variants.some(v => prim.includes(v))) { matchesPrim.add(cat.id); if (!bestPrim || cat.id > bestPrim.id) bestPrim = cat; } }
            if (!bestPrim) { for (const cat of catalog) { const m = cat.variants.some(v => prim.some(n => v.includes(n))); if (m) { matchesPrim.add(cat.id); if (!bestPrim || cat.id > bestPrim.id) bestPrim = cat; } } }
            if (!bestPrim) { for (const cat of catalog) { const m = prim.some(n => cat.variants.some(v => n.includes(v))); if (m) { matchesPrim.add(cat.id); if (!bestPrim || cat.id > bestPrim.id) bestPrim = cat; } } }
          }
          const bestId = bestPrim?.id || (arrAll.length ? Math.max(...arrAll) : 0);
          if (bestId || arrAll.length) {
            await pool.query(`UPDATE public.mod_grabbing_sensorex_category_extract SET id_category=$1, id_categories=$2 WHERE product_id=$3 AND category=$4`, [bestId||null, arrAll, it.product_id, it.category]);
          }
        }
      } catch {}

      // Refresh PG rows after pre-pass to include updated id_categories
      pgRows = await pool.query(`SELECT product_id, id_category, id_categories, category, categories FROM public.mod_grabbing_sensorex_category_extract ${where}`, params);

      // If shops not provided and not from mapping, fallback to active shops from MySQL
      if (!idShops.length) {
        try { const shops = await q(`SELECT ${qi('id_shop')} AS id_shop FROM ${qi(T_SHOP)} WHERE ${qi('active')}=1`); idShops = shops.map(r=>Number(r.id_shop)||0).filter(n=>n>0); } catch {}
      }

      let linked = 0; let defaultsSet = 0; let missing = 0;
      // Group rows per product and compute union + default from most recent row (primary-only)
      const byPid = new Map();
      for (const row of pgRows.rows || []) {
        const pid = Number(row.product_id||0)||0;
        if (!pid) continue;
        const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
        const best = Number(row.id_category||0)||0;
        const catsArr = Array.isArray(row.id_categories) ? row.id_categories.map(n=>Number(n)||0).filter(n=>n>0) : [];
        const entry = byPid.get(pid) || { defaultId: 0, defaultTs: -1, catSet: new Set() };
        if (best && createdAt >= entry.defaultTs) { entry.defaultId = best; entry.defaultTs = createdAt; }
        for (const c of catsArr) entry.catSet.add(c);
        byPid.set(pid, entry);
      }
      for (const [pid, entry] of byPid.entries()) {
        const cats = Array.from(entry.catSet);
        const best = Number(entry.defaultId||0)||0;
        if (!pid || !best || !cats.length) { missing++; continue; }
        for (const cid of cats) {
          try {
            let pos = 0;
            try {
              const rowPos = await q(`SELECT COALESCE(MAX(${qi('position')}), -1) + 1 AS pos FROM ${qi(T_CP)} WHERE ${qi('id_category')}=?`, [cid]);
              pos = Number(rowPos?.[0]?.pos||0) || 0;
            } catch {}
            if (await hasColumn(T_CP, 'position')) {
              await q(`INSERT IGNORE INTO ${qi(T_CP)} (${qi('id_category')}, ${qi('id_product')}, ${qi('position')}) VALUES (?,?,?)`, [cid, pid, pos]);
            } else {
              await q(`INSERT IGNORE INTO ${qi(T_CP)} (${qi('id_category')}, ${qi('id_product')}) VALUES (?,?)`, [cid, pid]);
            }
            linked++;
          } catch {}
        }
        try { await q(`UPDATE ${qi(T_P)} SET ${qi('id_category_default')}=?, ${qi('date_upd')}=NOW() WHERE ${qi('id_product')}=?`, [best, pid]); } catch {}
        try {
          if (idShops.length) {
            for (const sid of idShops) {
              await q(`UPDATE ${qi(T_PS)} SET ${qi('id_category_default')}=? WHERE ${qi('id_product')}=? AND ${qi('id_shop')}=?`, [best, pid, sid]);
            }
          } else {
            await q(`UPDATE ${qi(T_PS)} SET ${qi('id_category_default')}=? WHERE ${qi('id_product')}=?`, [best, pid]);
          }
          defaultsSet++;
        } catch {}
      }

      try { await conn.end(); } catch {}
      try { chatLog('category_apply_presta', { linked, defaultsSet, missing, products: pgRows.rowCount||0, shops: idShops }); } catch {}
      return res.json({ ok:true, linked, defaultsSet, missing, products: pgRows.rowCount||0, id_shops: idShops });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'apply_failed', message: e?.message || String(e) });
    }
  });
}
