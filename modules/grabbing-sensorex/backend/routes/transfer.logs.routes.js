// Routes: Upsert logs summary for audit/debug
export function registerTransferLogsRoutes(app, ctx) {
  const base = '/api/grabbing-sensorex';
  // GET /api/grabbing-sensorex/upsert-summary?run_id=NNN[&table=ps_product_lang]
  app.get(base + '/upsert-summary', ctx.expressJson(), async (req, res) => {
    try {
      const runId = Number(req.query?.run_id || 0) || 0;
      const table = String(req.query?.table || '').trim();
      const limit = Math.min(Math.max(Number(req.query?.limit || 2000), 1), 5000);
      const afterId = Number(req.query?.after_id || 0) || 0;
      if (!runId) return res.status(400).json({ ok:false, error:'run_id_required' });
      const q = `select id, table_name, product_id, id_shop, id_lang, id_group, field, value, created_at
                 from public.mod_grabbing_sensorex_upsert_field_logs
                 where run_id=$1 ${table? 'and table_name=$2' : ''} ${afterId>0? `and id>${afterId}`: ''}
                 order by id asc
                 limit ${limit}`;
      const args = table? (afterId>0? [runId, table, afterId] : [runId, table]) : (afterId>0? [runId, afterId] : [runId]);
      const r = await ctx.pool.query(q, args);
      return res.json({ ok:true, run_id: runId, table: table||null, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'upsert_summary_failed', message: String(e?.message||e) }); }
  });

  // GET /api/grabbing-sensorex/success-summary?run_id=NNN
  // Aggregated per-table success counters (insert/upsert/link) with shop/lang
  app.get(base + '/success-summary', ctx.expressJson(), async (req, res) => {
    try {
      const runId = Number(req.query?.run_id || 0) || 0;
      if (!runId) return res.status(400).json({ ok:false, error:'run_id_required' });
      const q = `select table_name, op, id_shop, id_lang, sum(count) as count
                   from public.mod_grabbing_sensorex_send_to_presta_success_logs
                  where run_id=$1
                  group by table_name, op, id_shop, id_lang
                  order by table_name, op, coalesce(id_shop, -1), coalesce(id_lang, -1)`;
      const r = await ctx.pool.query(q, [runId]);
      return res.json({ ok:true, run_id: runId, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'success_summary_failed', message: String(e?.message||e) }); }
  });
}
