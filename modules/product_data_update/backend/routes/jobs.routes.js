export function registerProductDataUpdateJobsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const chatLog = utils.chatLog || (()=>{});
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  function pickOrgId(req, b) { try { return (b && b.org_id != null) ? (String(b.org_id).trim() || null) : ((req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null); } catch { return null; } }

  // Create async translator job; returns job_id and run_id
  app.post('/api/product_data_update/products/translate-run/async', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const orgId = pickOrgId(req, b);
    try {
      const profileId = Number(b.profile_id || 0) || null;
      const prefix = String(b.prefix || '').trim();
      const idShop = Number(b.id_shop || 0) || null;
      const idShopFrom = Number(b.id_shop_from || 0) || null;
      const langFromId = Number(b.lang_from_id || 0) || null;
      const langToIds = Array.isArray(b.lang_to_ids) ? b.lang_to_ids.map(n=>Number(n)).filter(n=>Number.isFinite(n) && n>0) : [];
      const arr = Array.isArray(b.product_ids) ? b.product_ids : [];
      const productIds = arr.map(n => Number(n)).filter(n => Number.isFinite(n) && n>0);
      const promptId = String(b.prompt_config_id || '').trim();
      const fields = Array.isArray(b.fields) ? b.fields : [];
      const includeFeatures = !!b.include_features;
      const includeAttributes = !!b.include_attributes;
      const includeAttachments = !!b.include_attachments;
      const includeImages = !!b.include_images;
      const oneLangPerPrompt = !!b.one_lang_per_prompt;
      const chunkSize = Math.max(1, Number(b.chunk_size || 10));
      if (!profileId || !prefix || !idShop || !langFromId || !langToIds.length || !productIds.length || !promptId)
        return res.status(400).json({ ok:false, error:'bad_request' });
      if (!/^[A-Za-z0-9_]+$/.test(prefix)) return res.status(400).json({ ok:false, error:'invalid_prefix' });

      // Create run header
      const totals = { requested: productIds.length * langToIds.length, done: 0, updated: 0, skipped: 0, errors: 0 };
      const params = { kind: 'translator', scope: { list: (b.scope_list != null ? String(b.scope_list) : String(productIds.join(','))), range: (b.scope_range || null), where: (b.scope_where || null), id_shop_from: idShopFrom, id_shop: idShop, lang_from_id: langFromId, lang_to_ids: langToIds } };
      const rRun = await pool.query(
        `INSERT INTO mod_product_data_translator_runs (org_id, status, profile_id, prefix, id_shop, id_lang, prompt_config_id, totals, params)
         VALUES ($1,'running',$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
         RETURNING id`,
        [orgId, profileId, prefix, idShop, null, promptId || null, JSON.stringify(totals), JSON.stringify(params)]
      );
      const runId = rRun.rows[0].id;

      // Create job
      const payload = { org_id: orgId, run_id: runId, profile_id: profileId, prefix, id_shop: idShop, id_shop_from: idShopFrom, lang_from_id: langFromId, lang_to_ids: langToIds, product_ids: productIds, fields, include_features: includeFeatures, include_attributes: includeAttributes, include_attachments: includeAttachments, include_images: includeImages, prompt_config_id: promptId, one_lang_per_prompt: oneLangPerPrompt, chunk_size: chunkSize, cursor_index: 0 };
      const rJob = await pool.query(
        `INSERT INTO mod_product_data_jobs (org_id, type, status, run_id, payload)
           VALUES ($1,'translator_run','queued',$2,$3::jsonb) RETURNING id`,
        [orgId, runId, JSON.stringify(payload)]
      );
      try { chatLog('translator_async_job_created', { run_id: runId, job_id: rJob.rows[0].id, products: productIds.length, chunk_size: chunkSize }); } catch {}
      return res.json({ ok:true, job_id: rJob.rows[0].id, run_id: runId });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Inspect a job status
  app.get('/api/product_data_update/jobs/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0); if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      const r = await pool.query(`SELECT id, org_id, type, status, run_id, attempts, last_error, created_at, started_at, finished_at, payload FROM mod_product_data_jobs WHERE id=$1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Cancel a pending/running job and mark its run as failed
  app.post('/api/product_data_update/jobs/:id/cancel', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0); if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      const r = await pool.query(`SELECT id, run_id, status FROM mod_product_data_jobs WHERE id=$1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const job = r.rows[0];
      // Mark job as failed/cancelled
      await pool.query(`UPDATE mod_product_data_jobs SET status='failed', finished_at=NOW(), last_error=$2 WHERE id=$1`, [id, 'cancelled_by_user']);
      // Also update run status if present
      try { if (job.run_id) await pool.query(`UPDATE mod_product_data_translator_runs SET status='failed', finished_at=NOW() WHERE id=$1 AND status<>'done'`, [job.run_id]); } catch {}
      try { chatLog('translator_async_job_cancelled', { job_id: id, run_id: job.run_id }); } catch {}
      return res.json({ ok:true, run_id: job.run_id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
