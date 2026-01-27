function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerProductDataUpdateTranslatorProfilesRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const chatLog = (utils && utils.chatLog) ? utils.chatLog : (()=>{});
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  // Accept arrays, single number, or comma-separated strings for lang_to_ids
  function parseLangToIds(v) {
    try {
      if (Array.isArray(v)) return v.map(x=>Number(x)).filter(n=>Number.isFinite(n));
      if (typeof v === 'number' && Number.isFinite(v)) return [Number(v)];
      if (typeof v === 'string') return v.split(',').map(s=>Number(s.trim())).filter(n=>Number.isFinite(n));
    } catch {}
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
    } catch { return cols; }
  }

  app.get('/api/product_data_update/translator-profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const args = [];
      const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
      if (orgId) args.push(orgId);
      const baseCols = ['id','name','profile_id','prefix','id_shop','lang_from_id','lang_to_id','overwrite','created_at','updated_at'];
      const optCols = ['id_shop_from','lang_to_ids','scope_list','scope_from','scope_to','scope_where'];
      const cols = [...baseCols, ...(await getExistingCols('mod_product_data_translator_config', optCols))];
      const sql = `SELECT ${cols.join(', ')} FROM mod_product_data_translator_config${whereOrg} ORDER BY updated_at DESC, name ASC`;
      const r = await pool.query(sql, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/product_data_update/translator-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const baseCols = ['id','name','org_id','profile_id','prefix','id_shop','lang_from_id','lang_to_id','fields','prompt_config_id','limits','overwrite','created_at','updated_at'];
      const optCols = ['id_shop_from','lang_to_ids','scope_list','scope_from','scope_to','scope_where'];
      const cols = [...baseCols, ...(await getExistingCols('mod_product_data_translator_config', optCols))];
      const sql = `SELECT ${cols.join(', ')} FROM mod_product_data_translator_config WHERE id=$1${whereOrg} LIMIT 1`;
      const r = await pool.query(sql, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/product_data_update/translator-profiles', async (req, res) => {
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
      id_shop: b.id_shop != null ? Number(b.id_shop) : null,
      id_shop_from: b.id_shop_from != null ? Number(b.id_shop_from) : null,
      lang_from_id: b.lang_from_id != null ? Number(b.lang_from_id) : null,
      lang_to_id: b.lang_to_id != null ? Number(b.lang_to_id) : null,
      fields: b.fields && typeof b.fields === 'object' ? b.fields : null,
      prompt_config_id: b.prompt_config_id ? String(b.prompt_config_id) : null,
      limits: b.limits && typeof b.limits === 'object' ? b.limits : null,
      scope_list: b.scope_list != null ? String(b.scope_list) : null,
      scope_from: (b.scope_from != null && b.scope_from !== '') ? Number(b.scope_from) : null,
      scope_to: (b.scope_to != null && b.scope_to !== '') ? Number(b.scope_to) : null,
      scope_where: b.scope_where != null ? String(b.scope_where) : null,
      lang_to_ids: parseLangToIds(b.lang_to_ids),
      overwrite: !!b.overwrite,
    };
    // If only a single target was provided, overwrite the set with that single value
    if (row.lang_to_ids === null && Number.isFinite(row.lang_to_id)) row.lang_to_ids = [row.lang_to_id];
    // If only a single lang_to_id was provided and no explicit lang_to_ids, replace with that single value
    if (row.lang_to_ids === null && Number.isFinite(row.lang_to_id)) row.lang_to_ids = [row.lang_to_id];
    try {
      try { chatLog('translator_profile_create_req', { org_id: row.org_id, name: row.name, id_shop: row.id_shop, id_shop_from: row.id_shop_from, lang_from_id: row.lang_from_id, lang_to_id: row.lang_to_id, lang_to_ids_in: b.lang_to_ids, lang_to_ids: row.lang_to_ids }); } catch {}
      // Try extended insert (new columns); fallback to legacy columns if DB not yet migrated
      try {
        const r = await pool.query(
          `INSERT INTO mod_product_data_translator_config (org_id, name, profile_id, prefix, id_shop, id_shop_from, lang_from_id, lang_to_id, lang_to_ids, scope_list, scope_from, scope_to, scope_where, fields, prompt_config_id, limits, overwrite)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb,$17)
           RETURNING id`,
          [row.org_id, row.name, row.profile_id, row.prefix, row.id_shop, row.id_shop_from, row.lang_from_id, row.lang_to_id, JSON.stringify(row.lang_to_ids||[]), row.scope_list, row.scope_from, row.scope_to, row.scope_where, JSON.stringify(row.fields||{}), row.prompt_config_id, JSON.stringify(row.limits||{}), row.overwrite]
        );
        try { chatLog('translator_profile_create_ok', { id: r.rows[0].id, lang_to_ids: row.lang_to_ids }); } catch {}
        return res.json({ ok:true, id: r.rows[0].id });
      } catch {}
      const r2 = await pool.query(
        `INSERT INTO mod_product_data_translator_config (org_id, name, profile_id, prefix, id_shop, lang_from_id, lang_to_id, fields, prompt_config_id, limits, overwrite)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)
         RETURNING id`,
        [row.org_id, row.name, row.profile_id, row.prefix, row.id_shop, row.lang_from_id, row.lang_to_id, JSON.stringify(row.fields||{}), row.prompt_config_id, JSON.stringify(row.limits||{}), row.overwrite]
      );
      try { chatLog('translator_profile_create_ok_legacy', { id: r2.rows[0].id }); } catch {}
      return res.json({ ok:true, id: r2.rows[0].id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.put('/api/product_data_update/translator-profiles/:id', async (req, res) => {
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
      id_shop: b.id_shop != null ? Number(b.id_shop) : null,
      id_shop_from: b.id_shop_from != null ? Number(b.id_shop_from) : null,
      lang_from_id: b.lang_from_id != null ? Number(b.lang_from_id) : null,
      lang_to_id: b.lang_to_id != null ? Number(b.lang_to_id) : null,
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
    if (row.lang_to_ids === null && Number.isFinite(row.lang_to_id)) row.lang_to_ids = [row.lang_to_id];
    if (row.lang_to_ids === null && Number.isFinite(row.lang_to_id)) row.lang_to_ids = [row.lang_to_id];
    try {
      try { chatLog('translator_profile_update_req', { id, org_id: row.org_id, name: row.name, id_shop: row.id_shop, id_shop_from: row.id_shop_from, lang_from_id: row.lang_from_id, lang_to_id: row.lang_to_id, lang_to_ids_in: b.lang_to_ids, lang_to_ids: row.lang_to_ids }); } catch {}
      const present = new Set(await getExistingCols('mod_product_data_translator_config', [
        'org_id','name','profile_id','prefix','id_shop','id_shop_from','lang_from_id','lang_to_id','fields','prompt_config_id','limits','scope_list','scope_from','scope_to','scope_where','lang_to_ids','overwrite','updated_at'
      ]));
      const sets = []; const args = []; let i = 1;
      const push = (col, val, cast) => { if (val !== null && present.has(col)) { sets.push(`${col} = $${i}${cast||''}`); args.push(val); i++; } };
      const hasProp = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
      push('org_id', row.org_id);
      push('name', row.name);
      push('profile_id', row.profile_id);
      push('prefix', row.prefix);
      push('id_shop', row.id_shop);
      push('id_shop_from', row.id_shop_from);
      push('lang_from_id', row.lang_from_id);
      push('lang_to_id', row.lang_to_id);
      if (row.fields !== null) push('fields', JSON.stringify(row.fields||{}), '::jsonb');
      push('prompt_config_id', row.prompt_config_id);
      if (row.limits !== null) push('limits', JSON.stringify(row.limits||{}), '::jsonb');
      // Allow explicit clearing of scope fields when provided in payload
      if (present.has('scope_list') && hasProp(b, 'scope_list')) { sets.push(`scope_list = $${i}`); args.push(b.scope_list != null ? String(b.scope_list) : null); i++; }
      else if (row.scope_list !== null) push('scope_list', row.scope_list);
      if (present.has('scope_from') && hasProp(b, 'scope_from')) { sets.push(`scope_from = $${i}`); args.push((b.scope_from != null && b.scope_from !== '') ? Number(b.scope_from) : null); i++; }
      else if (row.scope_from !== null) push('scope_from', row.scope_from);
      if (present.has('scope_to') && hasProp(b, 'scope_to')) { sets.push(`scope_to = $${i}`); args.push((b.scope_to != null && b.scope_to !== '') ? Number(b.scope_to) : null); i++; }
      else if (row.scope_to !== null) push('scope_to', row.scope_to);
      if (present.has('scope_where') && hasProp(b, 'scope_where')) { sets.push(`scope_where = $${i}`); args.push(b.scope_where != null ? String(b.scope_where) : null); i++; }
      else if (row.scope_where !== null) push('scope_where', row.scope_where);
      if (row.lang_to_ids !== null) push('lang_to_ids', JSON.stringify(row.lang_to_ids||[]), '::jsonb');
      if (row.overwrite !== null) push('overwrite', row.overwrite);
      if (present.has('updated_at')) sets.push(`updated_at = NOW()`);
      args.push(id);
      const sql = `UPDATE mod_product_data_translator_config SET ${sets.join(', ')} WHERE id = $${i}`;
      await pool.query(sql, args);
      try { chatLog('translator_profile_update_ok', { id, set_cols: sets, lang_to_ids: row.lang_to_ids }); } catch {}
      return res.json({ ok:true, id });
    }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.delete('/api/product_data_update/translator-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try { await pool.query(`DELETE FROM mod_product_data_translator_config WHERE id=$1`, [id]); return res.json({ ok:true }); }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
