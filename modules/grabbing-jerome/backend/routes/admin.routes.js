export function registerGrabbingJeromeAdminRoutes(app, ctx = {}, utils = {}) {
  const { pool } = utils;
  const requireAdmin = ctx && typeof ctx.requireAdmin === 'function' ? ctx.requireAdmin : ((_req, res) => { try { res.status(401).json({ error: 'unauthorized' }); } catch {} return null; });
  const getChatLogPath = utils && typeof utils.getChatLogPath === 'function' ? utils.getChatLogPath : (() => null);
  const chatLog = typeof utils?.chatLog === 'function' ? utils.chatLog : (()=>{});

  // Admin: schema status (tables, columns, indexes) — org-agnostic
  app.get('/api/grabbing-jerome/admin/schema', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const expectedTables = [
        'public.mod_grabbing_jerome_extraction_tools',
        'mod_grabbing_jerome_domains',
        'mod_grabbing_jerome_domains_url',
        'public.mod_grabbing_jerome_extraction_runs'
      ];
      const expectedIndexes = [
        { name: 'mod_gj_extraction_domain_type_idx', table: 'public.mod_grabbing_jerome_extraction_tools' },
        { name: 'mod_grabbing_jerome_domains_url_domain_idx', table: 'mod_grabbing_jerome_domains_url' }
      ];
      const tables = [];
      const wanted = expectedTables.map(t => String(t).replace(/^public\./,''));
      const cols = await pool.query(
        `select table_name, column_name, data_type
           from information_schema.columns
          where table_schema='public' and table_name = any($1::text[])
          order by table_name, ordinal_position`,
        [wanted]
      );
      const colsByTable = cols.rows.reduce((m, r) => { const key = r.table_name; (m[key] ||= []).push({ column_name: r.column_name, data_type: r.data_type }); return m; }, {});
      const idx = await pool.query(`select schemaname, tablename, indexname from pg_indexes where schemaname='public'`);
      const idxByTable = {};
      for (const r of idx.rows || []) { const k = r.schemaname + '.' + r.tablename; (idxByTable[k] ||= []).push(r.indexname); if (!idxByTable[r.tablename]) idxByTable[r.tablename] = idxByTable[k]; }
      const tb = await pool.query(
        `select relname as table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and relname = any($1::text[])`,
        [wanted]
      );
      const presentSet = new Set((tb.rows||[]).map(r=>r.table_name));
      for (const t of expectedTables) {
        const nameOnly = String(t).replace(/^public\./,'');
        tables.push({
          name: t,
          exists: presentSet.has(nameOnly),
          columns: colsByTable[nameOnly] || [],
          indexes: idxByTable['public.'+nameOnly] || idxByTable[nameOnly] || []
        });
      }
      const missingTables = expectedTables.filter(t=>!presentSet.has(String(t).replace(/^public\./,'')));
      const indexSet = new Set((idx.rows||[]).map(r=>r.indexname));
      const missingIndexes = expectedIndexes.filter(e=>!indexSet.has(e.name)).map(e => `${e.name} ON ${e.table}`);
      const schemaOk = missingTables.length===0 && missingIndexes.length===0;
      try { await pool.query("ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS install_error TEXT NULL"); } catch {}
      try { await pool.query("ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS schema_ok SMALLINT NULL"); } catch {}
      try { await pool.query("UPDATE mod_module_manager_modules SET schema_ok=$1, install_error=NULL, updated_at=NOW() WHERE module_name=$2", [schemaOk ? 1 : 0, 'grabbing-jerome']); } catch {}
      return res.json({ ok:true, module:'grabbing-jerome', schema_ok: schemaOk, install_error: null, derived_ok: schemaOk, expected: { tables: expectedTables, indexes: expectedIndexes }, present: { tables, missingTables, missingIndexes } });
    } catch (e) { return res.status(500).json({ ok:false, error:'schema_failed', message: e?.message || String(e) }); }
  });

  // Admin: log info (path, exists, size)
  app.get('/api/grabbing-jerome/admin/log/info', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const p = getChatLogPath();
      let st = null; let exists = false;
      try { st = p ? require('fs').statSync(p) : null; exists = !!st; } catch { exists = false; st = null; }
      return res.json({ ok:true, path: p, exists, size: st?.size || 0, mtime: st?.mtime || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'log_info_failed', message: e?.message || String(e) }); }
  });

  // Admin: write a test log line
  app.post('/api/grabbing-jerome/admin/log/test', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try { chatLog('log_test', { from: 'admin', note: 'manual test line' }); return res.json({ ok:true, wrote: true, path: getChatLogPath() }); }
    catch (e) { return res.status(500).json({ ok:false, error:'log_test_failed', message: e?.message || String(e) }); }
  });

  // Admin: tail chat log (last N lines)
  app.get('/api/grabbing-jerome/admin/log/tail', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const p = getChatLogPath();
      if (!p) return res.status(404).json({ ok:false, error:'not_found' });
      const fs = require('fs');
      let raw = '';
      try { raw = fs.readFileSync(p, 'utf8'); } catch { raw = ''; }
      const maxLines = Math.min(2000, Math.max(1, Number(req.query?.lines || 500)));
      const lines = raw ? raw.split(/\r?\n/) : [];
      const tail = lines.slice(Math.max(0, lines.length - maxLines));
      return res.json({ ok:true, path: p, lines: tail.length, data: tail });
    } catch (e) { return res.status(500).json({ ok:false, error:'log_tail_failed', message: e?.message || String(e) }); }
  });

  // Admin: filtered chat log lines for a specific run (best-effort; substring match on run_id)
  app.get('/api/grabbing-jerome/admin/runs/logs', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const runId = req.query?.run_id != null ? Number(req.query.run_id) : null;
      if (!runId) return res.status(400).json({ ok:false, error:'bad_request', message:'run_id required' });
      const p = getChatLogPath();
      if (!p) return res.json({ ok:true, items: [] });
      const fs = require('fs');
      let raw = '';
      try { raw = fs.readFileSync(p, 'utf8'); } catch { raw = ''; }
      const maxLines = Math.min(4000, Math.max(1, Number(req.query?.lines || 800)));
      const lines = raw ? raw.split(/\r?\n/) : [];
      const tail = lines.slice(Math.max(0, lines.length - maxLines));
      const needle = `"run_id": ${runId}`;
      const items = tail.filter(l => l.includes(needle));
      return res.json({ ok:true, items });
    } catch (e) { return res.status(500).json({ ok:false, error:'log_tail_failed', message: e?.message || String(e) }); }
  });

  // Admin: run summary (errors) with filters: run_id, table_name, id_shop, id_lang; supports pagination
  app.get('/api/grabbing-jerome/admin/runs/errors', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const q = req.query || {};
      const runId = q.run_id != null ? Number(q.run_id) : null;
      const tableName = String(q.table_name || q.table || '').trim();
      const idShop = q.id_shop != null ? Number(q.id_shop) : null;
      const idLang = q.id_lang != null ? Number(q.id_lang) : null;
      const domain = String(q.domain || '').trim().toLowerCase();
      const pageType = String(q.page_type || '').trim().toLowerCase();
      const limit = Math.min(500, Math.max(1, Number(q.limit || 200)));
      const offset = Math.max(0, Number(q.offset || 0));
      const where = [];
      const args = [];
      let i = 1;
      if (runId) { where.push(`run_id = $${i++}`); args.push(runId); }
      if (tableName) { where.push(`table_name = $${i++}`); args.push(tableName); }
      if (idShop != null) { where.push(`id_shop = $${i++}`); args.push(idShop); }
      if (idLang != null) { where.push(`id_lang = $${i++}`); args.push(idLang); }
      if (domain) { where.push(`lower(domain) = lower($${i++})`); args.push(domain); }
      if (pageType) { where.push(`lower(page_type) = lower($${i++})`); args.push(pageType); }
      const whereSql = where.length ? `where ${where.join(' and ')}` : '';
      const sql = `select id, run_id, domain, page_type, table_name, op, product_id, id_shop, id_lang, error, payload, created_at
                     from public.mod_grabbing_jerome_send_to_presta_error_logs
                    ${whereSql}
                    order by created_at desc
                    limit $${i++} offset $${i++}`;
      args.push(limit, offset);
      const rows = await pool.query(sql, args);
      return res.json({ ok:true, items: rows.rows || [], limit, offset, count: rows.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'errors_list_failed', message: e?.message || String(e) }); }
  });

  // Admin: run summary overview (counts per table/op for a run)
  app.get('/api/grabbing-jerome/admin/runs/summary', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const runId = req.query?.run_id != null ? Number(req.query.run_id) : null;
      if (!runId) return res.status(400).json({ ok:false, error:'bad_request', message:'run_id required' });
      const perTable = await pool.query(
        `select table_name, count(*) as errors
           from public.mod_grabbing_jerome_send_to_presta_error_logs
          where run_id = $1
          group by table_name
          order by errors desc, table_name asc`,
        [runId]
      );
      const perOp = await pool.query(
        `select op, count(*) as errors
           from public.mod_grabbing_jerome_send_to_presta_error_logs
          where run_id = $1
          group by op
          order by errors desc, op asc`,
        [runId]
      );
      const latest = await pool.query(
        `select id, created_at, table_name, op, error
           from public.mod_grabbing_jerome_send_to_presta_error_logs
          where run_id = $1
          order by created_at desc
          limit 10`,
        [runId]
      );
      return res.json({ ok:true, run_id: runId, per_table: perTable.rows||[], per_op: perOp.rows||[], latest: latest.rows||[] });
    } catch (e) { return res.status(500).json({ ok:false, error:'summary_failed', message: e?.message || String(e) }); }
  });
}
