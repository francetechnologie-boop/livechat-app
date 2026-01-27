function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch (e) { return null; } }

export function registerCategoryDataUpdateTranslatorProfilesRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  // Accept arrays, single number, or comma-separated strings for lang_to_ids
  function parseLangToIds(v) {
    try {
      if (Array.isArray(v)) return v.map(x=>Number(x)).filter(n=>Number.isFinite(n));
      if (typeof v === 'number' && Number.isFinite(v)) return [Number(v)];
      if (typeof v === 'string') return v.split(',').map(s=>Number(s.trim())).filter(n=>Number.isFinite(n));
    } catch (e) {}
    return null;
  }

  async function getExistingCols(table, cols) {
    try {
      const r = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
        [String(table)]
      );
      const have = new Set((r.rows||[]).map(x => String(x.column_name)));
      return cols.filter(c => have.has(c));
    } catch (e) { return cols; }
  }

  app.get('/api/category_data_update/translator-profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const args = [];
      const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
      if (orgId) args.push(orgId);
      const present = new Set(await getExistingCols('mod_category_data_translator_config', ['id_shop','id_shop_to','id_shop_from','lang_to_ids','scope_list','scope_from','scope_to','scope_where']));
      const cols = ['id','name','profile_id','prefix'];
      if (present.has('id_shop')) cols.push('id_shop');
      else if (present.has('id_shop_to')) cols.push('id_shop_to AS id_shop');
      cols.push('lang_from_id','overwrite','created_at','updated_at');
      for (const c of ['id_shop_from','lang_to_ids','scope_list','scope_from','scope_to','scope_where']) { if (present.has(c)) cols.push(c); }
      const sql = `SELECT ${cols.join(', ')} FROM mod_category_data_translator_config${whereOrg} ORDER BY updated_at DESC, name ASC`;
      const r = await pool.query(sql, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/category_data_update/translator-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const present = new Set(await getExistingCols('mod_category_data_translator_config', ['id_shop','id_shop_to','id_shop_from','lang_to_ids','scope_list','scope_from','scope_to','scope_where']));
      const cols = ['id','name','org_id','profile_id','prefix'];
      if (present.has('id_shop')) cols.push('id_shop'); else if (present.has('id_shop_to')) cols.push('id_shop_to AS id_shop');
      cols.push('lang_from_id','fields','prompt_config_id','limits','overwrite','created_at','updated_at');
      for (const c of ['id_shop_from','lang_to_ids','scope_list','scope_from','scope_to','scope_where']) { if (present.has(c)) cols.push(c); }
      const sql = `SELECT ${cols.join(', ')} FROM mod_category_data_translator_config WHERE id=$1${whereOrg} LIMIT 1`;
      const r = await pool.query(sql, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/category_data_update/translator-profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ ok:false, error:'bad_request', message:'name required' });
    const orgId = (b.org_id != null) ? (String(b.org_id).trim() || null) : pickOrgId(req);
    const row = {
      org_id: orgId,
      name,
      profile_id: b.profile_id != null ? Number(b.profile_id) : null,
      prefix: b.prefix != null ? String(b.prefix) : null,
      id_shop_to: b.id_shop_to != null ? Number(b.id_shop_to) : (b.id_shop != null ? Number(b.id_shop) : null),
      id_shop_from: b.id_shop_from != null ? Number(b.id_shop_from) : null,
      lang_from_id: b.lang_from_id != null ? Number(b.lang_from_id) : null,
      // Only lang_to_ids is supported (multi-language)
      fields: b.fields && typeof b.fields === 'object' ? b.fields : null,
      prompt_config_id: b.prompt_config_id ? String(b.prompt_config_id) : null,
      limits: b.limits && typeof b.limits === 'object' ? b.limits : null,
      scope_list: b.scope_list != null ? String(b.scope_list) : null,
      scope_from: (b.scope_from != null && b.scope_from !== '') ? Number(b.scope_from) : null,
      scope_to: (b.scope_to != null && b.scope_to !== '') ? Number(b.scope_to) : null,
      scope_where: b.scope_where != null ? String(b.scope_where) : null,
      lang_to_ids: parseLangToIds(b.lang_to_ids)
    };
    try {
      // Insert robustly even if lang_to_ids column does not exist yet
      const have = new Set((await getExistingCols('mod_category_data_translator_config', ['lang_to_ids','id_shop','id_shop_to'])).map(x=>x));
      const cols = ['org_id','name','profile_id','prefix'];
      const vals = [row.org_id, row.name, row.profile_id, row.prefix];
      const casts = [null,null,null,null];
      if (have.has('id_shop_to')) { cols.push('id_shop_to'); vals.push(row.id_shop_to); casts.push(null); }
      else if (have.has('id_shop')) { cols.push('id_shop'); vals.push(row.id_shop_to); casts.push(null); }
      cols.push('lang_from_id'); vals.push(row.lang_from_id); casts.push(null);
      cols.push('fields'); vals.push(JSON.stringify(row.fields||{})); casts.push('::jsonb');
      cols.push('prompt_config_id'); vals.push(row.prompt_config_id); casts.push(null);
      cols.push('limits'); vals.push(JSON.stringify(row.limits||{})); casts.push('::jsonb');
      cols.push('overwrite'); vals.push(!!b.overwrite); casts.push(null);
      cols.push('id_shop_from'); vals.push(row.id_shop_from); casts.push(null);
      cols.push('scope_list'); vals.push(row.scope_list); casts.push(null);
      cols.push('scope_from'); vals.push(row.scope_from); casts.push(null);
      cols.push('scope_to'); vals.push(row.scope_to); casts.push(null);
      cols.push('scope_where'); vals.push(row.scope_where); casts.push(null);
      if (have.has('lang_to_ids')) { cols.push('lang_to_ids'); vals.push(row.lang_to_ids ? JSON.stringify(row.lang_to_ids) : null); casts.push('::jsonb'); }
      const placeholders = cols.map((_,i)=> `$${i+1}${casts[i]||''}`).join(',');
      const sql = `INSERT INTO mod_category_data_translator_config (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`;
      const r = await pool.query(sql, vals);
      return res.json({ ok:true, id: r.rows[0].id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.put('/api/category_data_update/translator-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const orgId = (b.org_id != null) ? (String(b.org_id).trim() || null) : pickOrgId(req);
    const row = {
      org_id: orgId,
      name: b.name != null ? String(b.name) : null,
      profile_id: b.profile_id != null ? Number(b.profile_id) : null,
      prefix: b.prefix != null ? String(b.prefix) : null,
      id_shop_to: b.id_shop_to != null ? Number(b.id_shop_to) : (b.id_shop != null ? Number(b.id_shop) : null),
      id_shop_from: b.id_shop_from != null ? Number(b.id_shop_from) : null,
      lang_from_id: b.lang_from_id != null ? Number(b.lang_from_id) : null,
      // Prefer multi-language; accept legacy single value (converted below)
      fields: b.fields && typeof b.fields === 'object' ? b.fields : null,
      prompt_config_id: b.prompt_config_id ? String(b.prompt_config_id) : null,
      limits: b.limits && typeof b.limits === 'object' ? b.limits : null,
      scope_list: b.scope_list != null ? String(b.scope_list) : null,
      scope_from: (b.scope_from != null && b.scope_from !== '') ? Number(b.scope_from) : null,
      scope_to: (b.scope_to != null && b.scope_to !== '') ? Number(b.scope_to) : null,
      scope_where: b.scope_where != null ? String(b.scope_where) : null,
      lang_to_ids: parseLangToIds(b.lang_to_ids),
      overwrite: b.overwrite != null ? !!b.overwrite : null,
    };
    // Fallback: if only legacy lang_to_id provided in payload, convert to array (no DB column used)
    if (row.lang_to_ids === null && b.lang_to_id != null && Number.isFinite(Number(b.lang_to_id))) {
      row.lang_to_ids = [Number(b.lang_to_id)];
    }

    // Only update columns that exist to keep portability across envs
    const present = new Set(await (async()=>{
      try {
        const r = await pool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_category_data_translator_config'`
        );
        return (r.rows||[]).map(x=>String(x.column_name));
      } catch { return []; }
    })());

    const sets = []; const args = []; let i = 1;
    const push = (col, val, cast) => { if (val !== null && present.has(col)) { sets.push(`${col} = $${i}${cast||''}`); args.push(val); i++; } };
    const hasProp = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

    push('org_id', row.org_id);
    push('name', row.name);
    push('profile_id', row.profile_id);
    push('prefix', row.prefix);
    const presentCols = new Set(await getExistingCols('mod_category_data_translator_config', ['id_shop_to','id_shop']));
    if (presentCols.has('id_shop_to')) push('id_shop_to', row.id_shop_to);
    else if (presentCols.has('id_shop')) push('id_shop', row.id_shop_to);
    push('id_shop_from', row.id_shop_from);
    push('lang_from_id', row.lang_from_id);
    if (row.fields !== null) push('fields', JSON.stringify(row.fields||{}), '::jsonb');
    push('prompt_config_id', row.prompt_config_id);
    if (row.limits !== null) push('limits', JSON.stringify(row.limits||{}), '::jsonb');
    // Allow explicit clearing of scope fields when present in payload
    if (present.has('scope_list') && hasProp(b, 'scope_list')) { sets.push(`scope_list = $${i}`); args.push(b.scope_list != null ? String(b.scope_list) : null); i++; }
    else if (row.scope_list !== null) push('scope_list', row.scope_list);
    if (present.has('scope_from') && hasProp(b, 'scope_from')) { sets.push(`scope_from = $${i}`); args.push((b.scope_from != null && b.scope_from !== '') ? Number(b.scope_from) : null); i++; }
    else if (row.scope_from !== null) push('scope_from', row.scope_from);
    if (present.has('scope_to') && hasProp(b, 'scope_to')) { sets.push(`scope_to = $${i}`); args.push((b.scope_to != null && b.scope_to !== '') ? Number(b.scope_to) : null); i++; }
    else if (row.scope_to !== null) push('scope_to', row.scope_to);
    if (present.has('scope_where') && hasProp(b, 'scope_where')) { sets.push(`scope_where = $${i}`); args.push(b.scope_where != null ? String(b.scope_where) : null); i++; }
    else if (row.scope_where !== null) push('scope_where', row.scope_where);

    if (row.lang_to_ids !== null && present.has('lang_to_ids')) push('lang_to_ids', JSON.stringify(row.lang_to_ids||[]), '::jsonb');
    if (row.overwrite !== null) push('overwrite', row.overwrite);
    if (present.has('updated_at')) sets.push(`updated_at = NOW()`);

    args.push(id);
    const sql = `UPDATE mod_category_data_translator_config SET ${sets.join(', ')} WHERE id = $${i}`;
    try { await pool.query(sql, args); return res.json({ ok:true, id }); }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.delete('/api/category_data_update/translator-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try { await pool.query(`DELETE FROM mod_category_data_translator_config WHERE id=$1`, [id]); return res.json({ ok:true }); }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
