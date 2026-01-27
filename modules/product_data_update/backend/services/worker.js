import nodePath from 'path';

export function startPduWorker(ctx = {}, utils = {}) {
  const pool = utils.pool;
  const chatLog = utils.chatLog || (()=>{});
  if (!pool || typeof pool.query !== 'function') return;
  if (globalThis.__pduWorkerStarted) return; // singleton
  globalThis.__pduWorkerStarted = true;

  const port = Number(process.env.PORT || 3010);
  const base = `http://127.0.0.1:${port}`;

  async function tick() {
    let cli = null;
    try {
      try {
        cli = await pool.connect();
      } catch (e) {
        try { chatLog('translator_async_worker_db_unavailable', { error: e?.message || String(e) }); } catch {}
        return; // Skip this cycle when DB is unreachable
      }
      if (!cli) return;
      
      await cli.query('BEGIN');
      const r = await cli.query(`
        SELECT id, org_id, type, status, run_id, payload
           FROM mod_product_data_jobs
          WHERE status IN ('queued','running')
          ORDER BY status ASC, created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`);
      if (!r.rowCount) { await cli.query('COMMIT'); return; }
      const job = r.rows[0];
      const id = Number(job.id);
      const payload = job.payload || {};
      const runId = Number(job.run_id || 0) || null;
      const cursor = Number(payload.cursor_index || 0);
      const allIds = Array.isArray(payload.product_ids) ? payload.product_ids.map(n=>Number(n)).filter(Boolean) : [];
      const chunkSize = Math.max(1, Number(payload.chunk_size || 10));
      if (job.status === 'queued') await cli.query(`UPDATE mod_product_data_jobs SET status='running', started_at=NOW() WHERE id=$1`, [id]);
      await cli.query('COMMIT');

      // Prepare next chunk
      const nextIds = allIds.slice(cursor, cursor + chunkSize);
      if (!nextIds.length) {
        // finalize job
        await pool.query(`UPDATE mod_product_data_jobs SET status='done', finished_at=NOW() WHERE id=$1`, [id]);
        try { await pool.query(`UPDATE mod_product_data_translator_runs SET status='done', finished_at=NOW() WHERE id=$1 AND status<>'done'`, [runId]); } catch {}
        try { chatLog('translator_async_job_done', { job_id: id, run_id: runId }); } catch {}
        return;
      }

      // Call chunk endpoint on this server (bypasses Apache)
      const headers = { 'Content-Type': 'application/json' };
      try {
        const tok = String(process.env.ADMIN_TOKEN || '').trim(); if (tok) headers['X-Admin-Token'] = tok;
        if (payload.org_id) headers['X-Org-Id'] = String(payload.org_id);
      } catch {}
      const body = {
        profile_id: payload.profile_id,
        prefix: payload.prefix,
        id_shop_from: payload.id_shop_from,
        id_shop: payload.id_shop,
        lang_from_id: payload.lang_from_id,
        lang_to_ids: payload.lang_to_ids,
        product_ids: nextIds,
        fields: Array.isArray(payload.fields) ? payload.fields : [],
        include_features: !!payload.include_features,
        include_attributes: !!payload.include_attributes,
        include_attachments: !!payload.include_attachments,
        include_images: !!payload.include_images,
        prompt_config_id: payload.prompt_config_id,
        one_lang_per_prompt: !!payload.one_lang_per_prompt,
        dry_run: false,
        run_id: runId
      };
      let ok = false; let errorMsg = null;
      try {
        const resp = await fetch(`${base}/api/product_data_update/products/translate-run`, { method:'POST', headers, body: JSON.stringify(body) });
        ok = resp.ok;
        if (!ok) { const txt = await resp.text(); errorMsg = (txt || resp.statusText || 'request_failed'); }
      } catch (e) { ok = false; errorMsg = e?.message || String(e); }

      // Advance cursor and persist
      try {
        if (ok) {
          await pool.query(`UPDATE mod_product_data_jobs SET payload = jsonb_set(payload, '{cursor_index}', to_jsonb($2::int), true) WHERE id=$1`, [id, cursor + nextIds.length]);
        } else {
          await pool.query(`UPDATE mod_product_data_jobs SET attempts = attempts + 1, last_error=$2 WHERE id=$1`, [id, String(errorMsg||'')]);
          try { chatLog('translator_async_chunk_failed', { job_id: id, run_id: runId, error: errorMsg }); } catch {}
        }
      } catch {}
    } catch (e) {
      try { await cli?.query?.('ROLLBACK'); } catch {}
      try { chatLog('translator_async_worker_tick_error', { error: e?.message || String(e) }); } catch {}
    } finally { try { cli?.release?.(); } catch {} }
  }

  const intervalMs = Math.max(1000, Number(process.env.PDU_WORKER_INTERVAL_MS || 2000));
  setInterval(tick, intervalMs).unref();
  try { chatLog('translator_async_worker_started', { interval_ms: intervalMs }); } catch {}
}
