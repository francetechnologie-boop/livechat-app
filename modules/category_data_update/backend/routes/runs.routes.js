function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch (e) { return null; } }

export function registerCategoryDataUpdateRunsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  // Start a run
  app.post('/api/category_data_update/runs', async (req, res) => {
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
        `INSERT INTO mod_category_data_update_runs (org_id, status, profile_id, prefix, id_shop, id_lang, prompt_config_id, totals, params)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
         RETURNING id, created_at, started_at`,
        [row.org_id, row.status, row.profile_id, row.prefix, row.id_shop, row.id_lang, row.prompt_config_id, JSON.stringify(row.totals), JSON.stringify(row.params)]
      );
      return res.json({ ok:true, id: r.rows[0].id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Append chunk results to a run
  app.post('/api/category_data_update/runs/:id/append', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const runId = Number(req.params.id || 0);
    if (!runId) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    const inc = b.totals && typeof b.totals === 'object' ? b.totals : null;
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      for (const it of items) {
        const idc = Number(it.id_category || 0);
        if (!idc) continue;
        const updated = !!it.updated;
        const status = it.error ? 'error' : (it.skipped ? 'skipped' : (updated ? 'updated' : 'ok'));
        const message = String(it.message || it.warning || it.error || '').slice(0, 1000);
        const mt = it.meta_title ? String(it.meta_title).slice(0, 255) : null;
        const md = it.meta_description ? String(it.meta_description).slice(0, 255) : null;
        await cli.query(
          `INSERT INTO mod_category_data_update_run_items (run_id, id_category, updated, status, message, meta_title, meta_description)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [runId, idc, updated, status, message || null, mt, md]
        );
      }
      if (inc) {
        // Update totals accumulatively
        await cli.query(
          `UPDATE mod_category_data_update_runs SET totals = COALESCE(totals,'{}'::jsonb) ||
            jsonb_build_object(
              'requested', COALESCE((totals->>'requested')::int,0) + $1,
              'done', COALESCE((totals->>'done')::int,0) + $2,
              'updated', COALESCE((totals->>'updated')::int,0) + $3,
              'skipped', COALESCE((totals->>'skipped')::int,0) + $4,
              'errors', COALESCE((totals->>'errors')::int,0) + $5
            )
           WHERE id=$6`,
          [Number(inc.requested||0), Number(inc.done||0), Number(inc.updated||0), Number(inc.skipped||0), Number(inc.errors||0), runId]
        );
      }
      await cli.query('COMMIT');
      return res.json({ ok:true });
    } catch (e) { try { await cli.query('ROLLBACK'); } catch (e2) {}; return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
    finally { cli.release(); }
  });

  // Finish a run
  app.post('/api/category_data_update/runs/:id/finish', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const runId = Number(req.params.id || 0);
    if (!runId) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const status = String(b.status || 'done');
    try {
      await pool.query(`UPDATE mod_category_data_update_runs SET status=$1, finished_at=NOW() WHERE id=$2`, [status, runId]);
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // List runs
  app.get('/api/category_data_update/runs', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    const args = [];
    const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
    if (orgId) args.push(orgId);
    const limit = Math.min(200, Number(req.query?.limit || 50));
    try {
      const r = await pool.query(
        `SELECT id, org_id, status, profile_id, prefix, id_shop, id_lang, prompt_config_id, totals, params, created_at, started_at, finished_at
           FROM mod_category_data_update_runs${whereOrg}
         ORDER BY id DESC
          LIMIT ${limit}`,
        args
      );
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Run detail (with items)
  app.get('/api/category_data_update/runs/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const limit = Math.min(5000, Number(req.query?.limit || 1000));
    try {
      const r1 = await pool.query(`SELECT id, org_id, status, profile_id, prefix, id_shop, id_lang, prompt_config_id, totals, params, created_at, started_at, finished_at FROM mod_category_data_update_runs WHERE id=$1`, [id]);
      if (!r1.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const r2 = await pool.query(`SELECT id, id_category, updated, status, message, meta_title, meta_description, created_at FROM mod_category_data_update_run_items WHERE run_id=$1 ORDER BY id ASC LIMIT ${limit}`, [id]);
      return res.json({ ok:true, run: r1.rows[0], items: r2.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
