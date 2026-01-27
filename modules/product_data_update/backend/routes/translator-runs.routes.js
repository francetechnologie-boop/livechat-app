function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerProductDataUpdateTranslatorRunsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  app.post('/api/product_data_update/translator-runs', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const orgId = b.org_id != null ? (String(b.org_id).trim() || null) : pickOrgId(req);
    const row = {
      org_id: orgId,
      status: 'running',
      profile_id: b.profile_id != null ? Number(b.profile_id) : null,
      prefix: b.prefix != null ? String(b.prefix) : null,
      id_shop: b.id_shop != null ? Number(b.id_shop) : null,
      id_lang: b.id_lang != null ? Number(b.id_lang) : null,
      prompt_config_id: b.prompt_config_id ? String(b.prompt_config_id) : null,
      totals: b.totals && typeof b.totals === 'object' ? b.totals : { requested: 0, done: 0, updated: 0, skipped: 0, errors: 0 },
      params: b.params && typeof b.params === 'object' ? b.params : {},
    };
    try {
      const r = await pool.query(
        `INSERT INTO mod_product_data_translator_runs (org_id, status, profile_id, prefix, id_shop, id_lang, prompt_config_id, totals, params)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
         RETURNING id, created_at, started_at`,
        [row.org_id, row.status, row.profile_id, row.prefix, row.id_shop, row.id_lang, row.prompt_config_id, JSON.stringify(row.totals), JSON.stringify(row.params)]
      );
      return res.json({ ok:true, id: r.rows[0].id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/product_data_update/translator-runs/:id/finish', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const runId = Number(req.params.id || 0);
    if (!runId) return res.status(400).json({ ok:false, error:'bad_request' });
    const status = String((req.body?.status) || 'done');
    try { await pool.query(`UPDATE mod_product_data_translator_runs SET status=$1, finished_at=NOW() WHERE id=$2`, [status, runId]); return res.json({ ok:true }); }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/product_data_update/translator-runs', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    const args = [];
    const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
    if (orgId) args.push(orgId);
    const limit = Math.min(200, Number(req.query?.limit || 50));
    try {
      const r = await pool.query(
        `SELECT id, org_id, status, profile_id, prefix, id_shop, id_lang, prompt_config_id, totals, params, created_at, started_at, finished_at
           FROM mod_product_data_translator_runs${whereOrg}
         ORDER BY id DESC
          LIMIT ${limit}`,
        args
      );
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/product_data_update/translator-runs/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const limit = Math.min(5000, Number(req.query?.limit || 1000));
    try {
      const r1 = await pool.query(`SELECT id, org_id, status, profile_id, prefix, id_shop, id_lang, prompt_config_id, totals, params, created_at, started_at, finished_at FROM mod_product_data_translator_runs WHERE id=$1`, [id]);
      if (!r1.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const r2 = await pool.query(`SELECT id, id_product, updated, status, message, created_at FROM mod_product_data_translator_run_items WHERE run_id=$1 ORDER BY id ASC LIMIT ${limit}`, [id]);
      return res.json({ ok:true, run: r1.rows[0], items: r2.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Update run status without touching finished_at (used to resume a run)
  app.post('/api/product_data_update/translator-runs/:id/status', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const status = String((req.body?.status) || '').trim();
    if (!status) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      if (status === 'running') {
        await pool.query(`UPDATE mod_product_data_translator_runs SET status=$1, finished_at=NULL WHERE id=$2`, [status, id]);
      } else {
        await pool.query(`UPDATE mod_product_data_translator_runs SET status=$1 WHERE id=$2`, [status, id]);
      }
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Retry a translator run (create a new async job using same parameters)
  // Body: { product_ids?: number[], mode?: 'failed'|'all', chunk_size?: number, one_lang_per_prompt?: boolean }
  app.post('/api/product_data_update/translator-runs/:id/retry', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const runId = Number(req.params.id || 0);
    if (!runId) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      // Load run header
      const r = await pool.query(`SELECT org_id, profile_id, prefix, id_shop, params, prompt_config_id FROM mod_product_data_translator_runs WHERE id=$1`, [runId]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0];
      const params = row.params || {};
      const scope = params.scope || {};
      const profileId = Number(row.profile_id || 0) || null;
      const prefix = String(row.prefix || '');
      const idShop = Number(row.id_shop || 0) || null;
      const langFromId = Number(scope.lang_from_id || 0) || null;
      const langToIds = Array.isArray(scope.lang_to_ids) ? scope.lang_to_ids.map(n=>Number(n)).filter(n=>Number.isFinite(n) && n>0) : [];
      const promptId = String(row.prompt_config_id || '').trim();
      if (!profileId || !prefix || !idShop || !langFromId || !langToIds.length || !promptId) return res.status(400).json({ ok:false, error:'run_params_incomplete' });

      // Decide product ids to retry
      const b = req.body || {};
      let productIds = Array.isArray(b.product_ids) ? b.product_ids.map(n=>Number(n)).filter(Boolean) : [];
      const mode = String(b.mode || 'failed');
      if (!productIds.length) {
        if (mode === 'all') {
          // Use products from previous items table
          const rr = await pool.query(`SELECT DISTINCT id_product FROM mod_product_data_translator_run_items WHERE run_id=$1`, [runId]);
          productIds = (rr.rows||[]).map(x=>Number(x.id_product||0)).filter(Boolean);
        } else {
          // failed mode: pick items with status='error' or message containing ':prompt_failed'
          const rr = await pool.query(`SELECT id_product, status, message FROM mod_product_data_translator_run_items WHERE run_id=$1`, [runId]);
          const bad = [];
          for (const it of (rr.rows||[])) {
            const st = String(it.status||'');
            const msg = String(it.message||'');
            if (st === 'error' || /prompt_failed/.test(msg)) bad.push(Number(it.id_product||0));
          }
          productIds = Array.from(new Set(bad)).filter(Boolean);
        }
      }
      if (!productIds.length) return res.status(400).json({ ok:false, error:'no_products_to_retry' });

      const orgId = row.org_id || null;
      const idShopFrom = Number(scope.id_shop_from || scope.id_shop || idShop || 0) || null;
      const fields = Array.isArray(params.fields) ? params.fields : (Array.isArray(scope.fields) ? scope.fields : ['name','description_short','description','meta_title','meta_description']);
      const chunkSize = Math.max(1, Number(b.chunk_size || 10));
      const oneLangPerPrompt = !!b.one_lang_per_prompt;

      // Insert job
      const payload = { org_id: orgId, run_id: null, profile_id: profileId, prefix, id_shop: idShop, id_shop_from: idShopFrom, lang_from_id: langFromId, lang_to_ids: langToIds, product_ids: productIds, fields, include_features: !!params.include_features, include_attributes: !!params.include_attributes, include_attachments: !!params.include_attachments, include_images: !!params.include_images, prompt_config_id: promptId, one_lang_per_prompt: oneLangPerPrompt, chunk_size: chunkSize, cursor_index: 0 };
      const rJob = await pool.query(
        `INSERT INTO mod_product_data_jobs (org_id, type, status, run_id, payload)
           VALUES ($1,'translator_run','queued',$2,$3::jsonb) RETURNING id`,
        [orgId, runId, JSON.stringify(payload)]
      );
      return res.json({ ok:true, job_id: rJob.rows[0].id, run_id: runId, products: productIds.length });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Retry exactly one product + one target language (split, sequential)
  // Body: { product_id:number, id_lang:number, chunk_size?:number }
  app.post('/api/product_data_update/translator-runs/:id/retry/lang', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const runId = Number(req.params.id || 0);
    if (!runId) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const productId = Number(b.product_id || 0) || null;
    const idLang = Number(b.id_lang || 0) || null;
    if (!productId || !idLang) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      const r = await pool.query(`SELECT org_id, profile_id, prefix, id_shop, params, prompt_config_id FROM mod_product_data_translator_runs WHERE id=$1`, [runId]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0];
      const params = row.params || {};
      const scope = params.scope || {};
      const profileId = Number(row.profile_id || 0) || null;
      const prefix = String(row.prefix || '');
      const idShop = Number(row.id_shop || 0) || null;
      const langFromId = Number(scope.lang_from_id || 0) || null;
      const langToIdsAll = Array.isArray(scope.lang_to_ids) ? scope.lang_to_ids.map(n=>Number(n)).filter(n=>Number.isFinite(n) && n>0) : [];
      const promptId = String(row.prompt_config_id || '').trim();
      if (!profileId || !prefix || !idShop || !langFromId || !langToIdsAll.length || !promptId) return res.status(400).json({ ok:false, error:'run_params_incomplete' });
      if (!langToIdsAll.includes(idLang)) return res.status(400).json({ ok:false, error:'lang_not_in_run' });

      const orgId = row.org_id || null;
      const idShopFrom = Number(scope.id_shop_from || scope.id_shop || idShop || 0) || null;
      const fields = Array.isArray(params.fields) ? params.fields : (Array.isArray(scope.fields) ? scope.fields : ['name','description_short','description','meta_title','meta_description']);
      const chunkSize = Math.max(1, Number(b.chunk_size || 1));

      const payload = { org_id: orgId, run_id: runId, profile_id: profileId, prefix, id_shop: idShop, id_shop_from: idShopFrom, lang_from_id: langFromId, lang_to_ids: [idLang], product_ids: [productId], fields, include_features: !!params.include_features, include_attributes: !!params.include_attributes, include_attachments: !!params.include_attachments, include_images: !!params.include_images, prompt_config_id: promptId, one_lang_per_prompt: true, chunk_size: chunkSize, cursor_index: 0 };
      const rJob = await pool.query(
        `INSERT INTO mod_product_data_jobs (org_id, type, status, run_id, payload)
           VALUES ($1,'translator_run','queued',$2,$3::jsonb) RETURNING id`,
        [orgId, runId, JSON.stringify(payload)]
      );
      return res.json({ ok:true, job_id: rJob.rows[0].id, run_id: runId, products: 1, id_lang: idLang });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Aggregated metrics: average prompt times per language for a run
  app.get('/api/product_data_update/translator-runs/:id/metrics/avg-by-language', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      const r = await pool.query(
        `SELECT id_lang,
                AVG(NULLIF(prompt_ms,0))::numeric(12,2) AS avg_prompt_ms,
                AVG(NULLIF(rel_prompt_ms,0))::numeric(12,2) AS avg_rel_prompt_ms,
                COUNT(*)::int AS samples
           FROM mod_product_data_translator_prompt_metrics
          WHERE run_id=$1
          GROUP BY id_lang
          ORDER BY id_lang ASC`,
        [id]
      );
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
