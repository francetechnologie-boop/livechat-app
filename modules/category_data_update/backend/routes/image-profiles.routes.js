function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch (e) { return null; } }

export function registerCategoryDataUpdateImageProfilesRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const chatLog = utils.chatLog || (()=>{});
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  async function haveCols(cols) {
    try {
      const r = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_category_data_update_image_profiles'`
      );
      const have = new Set((r.rows||[]).map(x=>String(x.column_name)));
      return cols.filter(c => have.has(c));
    } catch (e) { return []; }
  }
  async function allCols() {
    try {
      const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_category_data_update_image_profiles'`);
      return new Set((r.rows||[]).map(x=>String(x.column_name)));
    } catch (e) { return new Set(); }
  }

  // Ensure table exists even if migrations haven't run yet (idempotent)
  async function ensureTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.mod_category_data_update_image_profiles (
          id SERIAL PRIMARY KEY,
          org_id INTEGER NULL,
          name VARCHAR(255) NOT NULL,
          base_path TEXT NOT NULL,
          prompt_config_id TEXT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);
      // Optional columns (guarded)
      const alters = [
        "ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN IF NOT EXISTS ftp_profile_id INTEGER NULL",
        "ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN IF NOT EXISTS ftp_host VARCHAR(255)",
        "ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN IF NOT EXISTS ftp_port INTEGER DEFAULT 21",
        "ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN IF NOT EXISTS ftp_user VARCHAR(255)",
        "ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN IF NOT EXISTS ftp_password TEXT",
        "ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN IF NOT EXISTS ftp_secure BOOLEAN DEFAULT FALSE"
      ];
      for (const sql of alters) { try { await pool.query(sql); } catch (e2) {} }
    } catch (e) { try { chatLog('cdu_image_profiles_ensure_error', { error: String(e?.message||e) }); } catch (e3) {} }
  }

  app.get('/api/category_data_update/image-profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      await ensureTable();
      const args = [];
      const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
      if (orgId) args.push(orgId);
      const opt = await haveCols(['ftp_profile_id','id_shop','id_lang','db_profile_id']);
      const cols = ['id','"name"', ...(opt.includes('ftp_profile_id')? ['ftp_profile_id'] : []), ...(opt.includes('db_profile_id')? ['db_profile_id'] : []), ...(opt.includes('id_shop')? ['id_shop'] : []), ...(opt.includes('id_lang')? ['id_lang'] : []), 'base_path','prompt_config_id','created_at','updated_at'];
      const r = await pool.query(`SELECT ${cols.join(', ')} FROM mod_category_data_update_image_profiles${whereOrg} ORDER BY updated_at DESC, name ASC`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/category_data_update/image-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      await ensureTable();
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const opt = await haveCols(['ftp_profile_id','id_shop','id_lang','db_profile_id']);
      const cols = ['id','"name"','org_id', ...(opt.includes('ftp_profile_id')? ['ftp_profile_id'] : []), ...(opt.includes('db_profile_id')? ['db_profile_id'] : []), ...(opt.includes('id_shop')? ['id_shop'] : []), ...(opt.includes('id_lang')? ['id_lang'] : []), 'base_path','prompt_config_id','created_at','updated_at'];
      const r = await pool.query(`SELECT ${cols.join(', ')} FROM mod_category_data_update_image_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/category_data_update/image-profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    try { chatLog('cdu_image_profile_create_req', { name: b?.name||'', has_ftp_profile_id: !!b?.ftp_profile_id }); } catch (e) {}
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ ok:false, error:'bad_request', message:'name required' });
    const orgId = (b.org_id != null) ? (String(b.org_id).trim() || null) : pickOrgId(req);
    const row = {
      org_id: orgId,
      name,
      ftp_profile_id: b.ftp_profile_id != null ? Number(b.ftp_profile_id) : null,
      id_shop: b.id_shop != null ? Number(b.id_shop) : null,
      id_lang: b.id_lang != null ? Number(b.id_lang) : null,
      db_profile_id: b.db_profile_id != null ? Number(b.db_profile_id) : null,
      base_path: String(b.base_path || '').trim(),
      prompt_config_id: b.prompt_config_id ? String(b.prompt_config_id) : null,
    };
    await ensureTable();
    const have = await allCols();
    // For flexibility, allow saving without FTP profile or base_path (useful for Preview-only).
    // Apply step will require FTP details; here we just persist what we have.
    const wantsFtpProfile = have.has('ftp_profile_id');
    try {
      const cols = ['org_id','"name"','base_path','prompt_config_id'];
      const vals = [row.org_id, row.name, row.base_path, row.prompt_config_id];
      if (wantsFtpProfile) { cols.splice(2,0,'ftp_profile_id'); vals.splice(2,0,row.ftp_profile_id); }
      if (have.has('db_profile_id')) { cols.push('db_profile_id'); vals.push(row.db_profile_id); }
      if (have.has('id_shop')) { cols.push('id_shop'); vals.push(row.id_shop); }
      if (have.has('id_lang')) { cols.push('id_lang'); vals.push(row.id_lang); }
      // For legacy schema where inline FTP columns are NOT NULL, provide harmless placeholders
      if (!wantsFtpProfile) {
        if (have.has('ftp_host')) { cols.push('ftp_host'); vals.push('legacy'); }
        if (have.has('ftp_port')) { cols.push('ftp_port'); vals.push(21); }
        if (have.has('ftp_user')) { cols.push('ftp_user'); vals.push('legacy'); }
        if (have.has('ftp_password')) { cols.push('ftp_password'); vals.push(null); }
        if (have.has('ftp_secure')) { cols.push('ftp_secure'); vals.push(false); }
      }
      const placeholders = cols.map((_,i)=>`$${i+1}`).join(',');
      const sql = `INSERT INTO mod_category_data_update_image_profiles (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`;
      const r = await pool.query(sql, vals);
      try { chatLog('cdu_image_profile_created', { id: r.rows?.[0]?.id || null, name: row.name }); } catch (e2) {}
      return res.json({ ok:true, id: r.rows[0].id });
    } catch (e) { try { chatLog('cdu_image_profile_create_error', { error: String(e?.message||e) }); } catch (e2) {} return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.put('/api/category_data_update/image-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    try { chatLog('cdu_image_profile_update_req', { id }); } catch (e) {}
    const orgId = (b.org_id != null) ? (String(b.org_id).trim() || null) : pickOrgId(req);
    const row = {
      org_id: orgId,
      name: b.name != null ? String(b.name) : null,
      ftp_profile_id: b.ftp_profile_id != null ? Number(b.ftp_profile_id) : null,
      id_shop: b.id_shop != null ? Number(b.id_shop) : null,
      id_lang: b.id_lang != null ? Number(b.id_lang) : null,
      db_profile_id: b.db_profile_id != null ? Number(b.db_profile_id) : null,
      base_path: b.base_path != null ? String(b.base_path) : null,
      prompt_config_id: b.prompt_config_id != null ? String(b.prompt_config_id) : null,
    };
    const sets = []; const args = []; let i = 1;
    const push = (col, val, cast) => { if (val !== null) { sets.push(`${col} = $${i}${cast||''}`); args.push(val); i++; } };
    push('org_id', row.org_id);
    push('"name"', row.name);
    try { const opt = await haveCols(['ftp_profile_id','id_shop','id_lang','db_profile_id']); if (opt.includes('ftp_profile_id')) push('ftp_profile_id', row.ftp_profile_id); if (opt.includes('db_profile_id')) push('db_profile_id', row.db_profile_id); if (opt.includes('id_shop')) push('id_shop', row.id_shop); if (opt.includes('id_lang')) push('id_lang', row.id_lang); } catch (e) {}
    push('base_path', row.base_path);
    push('prompt_config_id', row.prompt_config_id);
    sets.push('updated_at = NOW()');
    args.push(id);
    const sql = `UPDATE mod_category_data_update_image_profiles SET ${sets.join(', ')} WHERE id = $${i}`;
    try { await ensureTable(); await pool.query(sql, args); try { chatLog('cdu_image_profile_updated', { id }); } catch (e2) {} return res.json({ ok:true, id }); }
    catch (e) { try { chatLog('cdu_image_profile_update_error', { id, error: String(e?.message||e) }); } catch (e3) {} return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.delete('/api/category_data_update/image-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try { await ensureTable(); await pool.query(`DELETE FROM mod_category_data_update_image_profiles WHERE id=$1`, [id]); try { chatLog('cdu_image_profile_deleted', { id }); } catch (e2) {} return res.json({ ok:true }); }
    catch (e) { try { chatLog('cdu_image_profile_delete_error', { id, error: String(e?.message||e) }); } catch (e3) {} return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
