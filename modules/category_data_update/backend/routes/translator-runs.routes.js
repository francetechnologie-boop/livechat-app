function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch (e) { return null; } }

export function registerCategoryDataUpdateTranslatorRunsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  async function haveCols(cols = []) {
    try {
      const r = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_category_data_translator_runs'`
      );
      const set = new Set((r.rows||[]).map(x => String(x.column_name)));
      return cols.filter(c => set.has(c));
    } catch { return []; }
  }

  // Append chunk results to a translator run
  app.post('/api/category_data_update/translator-runs/:id/append', async (req, res) => {
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
        await cli.query(
          `INSERT INTO mod_category_data_translator_run_items (run_id, id_category, updated, status, message)
           VALUES ($1,$2,$3,$4,$5)`,
          [runId, idc, updated, status, message || null]
        );
      }
      if (inc) {
        await cli.query(
          `UPDATE mod_category_data_translator_runs SET totals = COALESCE(totals,'{}'::jsonb) ||
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

  app.post('/api/category_data_update/translator-runs', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const orgId = b.org_id != null ? (String(b.org_id).trim() || null) : pickOrgId(req);
    const row = {
      org_id: orgId,
      status: 'running',
      profile_id: b.profile_id != null ? Number(b.profile_id) : null,
      prefix: b.prefix != null ? String(b.prefix) : null,
      prompt_config_id: b.prompt_config_id ? String(b.prompt_config_id) : null,
      totals: b.totals && typeof b.totals === 'object' ? b.totals : { requested: 0, done: 0, updated: 0, skipped: 0, errors: 0 },
      params: b.params && typeof b.params === 'object' ? b.params : {},
    };
    try {
      const opt = await haveCols(['id_shop','id_lang']);
      const cols = ['org_id','status','profile_id','prefix','prompt_config_id','totals','params'];
      const vals = [row.org_id, row.status, row.profile_id, row.prefix, row.prompt_config_id, JSON.stringify(row.totals), JSON.stringify(row.params)];
      if (opt.includes('id_shop')) { cols.splice(4, 0, 'id_shop'); vals.splice(4, 0, (b.id_shop != null ? Number(b.id_shop) : null)); }
      if (opt.includes('id_lang')) { const pos = cols.indexOf('prompt_config_id'); cols.splice(pos, 0, 'id_lang'); vals.splice(pos, 0, (b.id_lang != null ? Number(b.id_lang) : null)); }
      const placeholders = cols.map((_,i)=>`$${i+1}${i>=cols.length-2?'::jsonb':''}`).map((p,i)=>{
        // Apply ::jsonb casts to last two values (totals, params)
        if (cols[i] === 'totals' || cols[i] === 'params') return `${p.replace(/::jsonb$/, '')}::jsonb`;
        return p.replace(/::jsonb$/,'');
      });
      const sql = `INSERT INTO mod_category_data_translator_runs (${cols.join(', ')}) VALUES (${placeholders.join(',')}) RETURNING id, created_at, started_at`;
      const r = await pool.query(sql, vals);
      return res.json({ ok:true, id: r.rows[0].id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/category_data_update/translator-runs/:id/finish', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const runId = Number(req.params.id || 0);
    if (!runId) return res.status(400).json({ ok:false, error:'bad_request' });
    const status = String((req.body?.status) || 'done');
    try { await pool.query(`UPDATE mod_category_data_translator_runs SET status=$1, finished_at=NOW() WHERE id=$2`, [status, runId]); return res.json({ ok:true }); }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/category_data_update/translator-runs', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    const args = [];
    const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
    if (orgId) args.push(orgId);
    const limit = Math.min(200, Number(req.query?.limit || 50));
    try {
      const base = ['id','org_id','status','profile_id','prefix','prompt_config_id','totals','params','created_at','started_at','finished_at'];
      const opt = await haveCols(['id_shop','id_lang']);
      const cols = [...base];
      if (opt.includes('id_shop')) cols.splice(5,0,'id_shop');
      if (opt.includes('id_lang')) cols.splice(6,0,'id_lang');
      const sql = `SELECT ${cols.join(', ')} FROM mod_category_data_translator_runs${whereOrg} ORDER BY id DESC LIMIT ${limit}`;
      const r = await pool.query(sql, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/category_data_update/translator-runs/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const limit = Math.min(5000, Number(req.query?.limit || 1000));
    try {
      const opt = await haveCols(['id_shop','id_lang']);
      const base = ['id','org_id','status','profile_id','prefix','prompt_config_id','totals','params','created_at','started_at','finished_at'];
      const cols = [...base];
      if (opt.includes('id_shop')) cols.splice(5,0,'id_shop');
      if (opt.includes('id_lang')) cols.splice(6,0,'id_lang');
      const r1 = await pool.query(`SELECT ${cols.join(', ')} FROM mod_category_data_translator_runs WHERE id=$1`, [id]);
      if (!r1.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const r2 = await pool.query(`SELECT id, id_category, updated, status, message, created_at FROM mod_category_data_translator_run_items WHERE run_id=$1 ORDER BY id ASC LIMIT ${limit}`, [id]);
      return res.json({ ok:true, run: r1.rows[0], items: r2.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
