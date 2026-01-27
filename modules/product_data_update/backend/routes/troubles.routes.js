function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerProductDataUpdateTroublesRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  // List troubles
  // GET /api/product_data_update/troubles?status=open&limit=200
  app.get('/api/product_data_update/troubles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    const status = String(req.query?.status || 'open');
    const limit = Math.min(500, Number(req.query?.limit || 200));
    try {
      const args = [];
      const where = [];
      if (orgId) { where.push('(org_id IS NULL OR org_id = $' + (args.length+1) + ')'); args.push(orgId); }
      if (status) { where.push('status = $' + (args.length+1)); args.push(status); }
      const sql = `SELECT id, org_id, run_id, id_product, id_lang, id_shop, code, message, status, attempts, created_at, updated_at
                     FROM mod_product_data_translator_troubles
                    ${where.length? 'WHERE ' + where.join(' AND ') : ''}
                    ORDER BY updated_at DESC, created_at DESC
                    LIMIT ${limit}`;
      const r = await pool.query(sql, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Retry one trouble by creating a job for its product+lang in the original run context
  app.post('/api/product_data_update/troubles/:id/retry', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0) || 0;
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      const t = await pool.query(`SELECT * FROM mod_product_data_translator_troubles WHERE id=$1`, [id]);
      if (!t.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const tr = t.rows[0];
      const runId = Number(tr.run_id || 0) || 0;
      if (!runId) return res.status(400).json({ ok:false, error:'no_run' });
      // Pull run context
      const r = await pool.query(`SELECT org_id, profile_id, prefix, id_shop, params, prompt_config_id FROM mod_product_data_translator_runs WHERE id=$1`, [runId]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'run_not_found' });
      const row = r.rows[0];
      const params = row.params || {}; const scope = params.scope || {};
      const profileId = Number(row.profile_id || 0) || null;
      const prefix = String(row.prefix || '');
      const idShop = Number(row.id_shop || 0) || null;
      const langFromId = Number(scope.lang_from_id || 0) || null;
      const promptId = String(row.prompt_config_id || '').trim();
      const idLang = Number(tr.id_lang || 0) || 0;
      const productId = Number(tr.id_product || 0) || 0;
      if (!profileId || !prefix || !idShop || !langFromId || !idLang || !promptId || !productId)
        return res.status(400).json({ ok:false, error:'run_params_incomplete' });
      const orgId = row.org_id || null;
      const idShopFrom = Number(scope.id_shop_from || scope.id_shop || idShop || 0) || null;
      const fields = Array.isArray(params.fields) ? params.fields : (Array.isArray(scope.fields) ? scope.fields : ['name','description_short','description','meta_title','meta_description']);
      const payload = { org_id: orgId, run_id: runId, profile_id: profileId, prefix, id_shop: idShop, id_shop_from: idShopFrom, lang_from_id: langFromId, lang_to_ids: [idLang], product_ids: [productId], fields, include_features: !!params.include_features, include_attributes: !!params.include_attributes, include_attachments: !!params.include_attachments, include_images: !!params.include_images, prompt_config_id: promptId, one_lang_per_prompt: true, chunk_size: 1, cursor_index: 0 };
      const job = await pool.query(
        `INSERT INTO mod_product_data_jobs (org_id, type, status, run_id, payload)
           VALUES ($1,'translator_run','queued',$2,$3::jsonb) RETURNING id`,
        [orgId, runId, JSON.stringify(payload)]
      );
      // Mark trouble as queued and bump attempts
      try { await pool.query(`UPDATE mod_product_data_translator_troubles SET status='queued', attempts=attempts+1, updated_at=NOW() WHERE id=$1`, [id]); } catch {}
      return res.json({ ok:true, job_id: job.rows[0].id, run_id: runId });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Resolve/close a trouble manually
  app.post('/api/product_data_update/troubles/:id/resolve', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0) || 0;
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try { await pool.query(`UPDATE mod_product_data_translator_troubles SET status='resolved', updated_at=NOW() WHERE id=$1`, [id]); return res.json({ ok:true }); }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}

