export async function onModuleLoaded(ctx = {}) {
  const pool = ctx.pool;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_cron_management_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schedule TEXT NOT NULL,
        action TEXT NOT NULL,
        payload JSONB,
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_cron_management_logs (
        id SERIAL PRIMARY KEY,
        job_id TEXT,
        status TEXT,
        message TEXT,
        ran_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_cron_management_actions (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'POST',
        path TEXT NOT NULL,
        payload_template JSONB DEFAULT '{}'::jsonb,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      INSERT INTO mod_cron_management_actions (id, module_id, name, description, method, path, payload_template, metadata, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE
        SET module_id=EXCLUDED.module_id,
            name=EXCLUDED.name,
            description=EXCLUDED.description,
            method=EXCLUDED.method,
            path=EXCLUDED.path,
            payload_template=EXCLUDED.payload_template,
            metadata=EXCLUDED.metadata,
            updated_at=NOW()
    `, [
      'packeta_download',
      'grabbing-zasilkovna',
      'Zásilkovna download',
      'Download Zásilkovna CSV and import it (steps 1‑4)',
      'POST',
      '/api/grabbing-zasilkovna/download-and-import/:config_id',
      { debug: false },
      { path_params: { config_id: 'options.grabbing_id' } },
    ]);
    // Legacy backfill from cron_job and cron_job_log if present
    try {
      // Copy jobs if module table is empty
      const hasAny = await pool.query(`SELECT 1 FROM mod_cron_management_jobs LIMIT 1`);
      if (!hasAny.rowCount) {
        const tExists = await pool.query(`SELECT to_regclass('public.cron_job') AS t`);
        if (tExists.rows[0]?.t) {
          const r = await pool.query(`SELECT * FROM cron_job`);
          for (const row of r.rows) {
            const id = String(row.id || row.name || `cron_${Date.now()}`).trim();
            const name = String(row.name || id);
            const schedule = String(row.schedule || row.cron || '').trim();
            const action = String(row.action || row.kind || 'noop');
            let payload = null; try { if (row.payload && typeof row.payload === 'object') payload = row.payload; else if (typeof row.payload === 'string' && row.payload.trim()) payload = JSON.parse(row.payload); } catch {}
            const enabled = row.enabled === undefined ? true : !!row.enabled;
            await pool.query(`
              INSERT INTO mod_cron_management_jobs (id, name, schedule, action, payload, enabled, created_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
              ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, schedule=EXCLUDED.schedule, action=EXCLUDED.action, payload=EXCLUDED.payload, enabled=EXCLUDED.enabled, updated_at=NOW()
            `, [id, name, schedule, action, payload, enabled]);
          }
          ctx.logToFile?.(`[cron-management] Backfilled ${r.rowCount} job(s) from cron_job`);
        }
      }
      // Copy logs
      const logExists = await pool.query(`SELECT to_regclass('public.cron_job_log') AS t`);
      if (logExists.rows[0]?.t) {
        const r2 = await pool.query(`SELECT * FROM cron_job_log ORDER BY created_at ASC LIMIT 5000`);
        for (const row of r2.rows) {
          await pool.query(`INSERT INTO mod_cron_management_logs (job_id, status, message, ran_at) VALUES ($1,$2,$3,$4)`,
            [ String(row.job_id || row.id || ''), String(row.status || 'ok'), String(row.message || ''), row.created_at || row.ran_at || new Date() ]);
        }
        ctx.logToFile?.(`[cron-management] Backfilled ${r2.rowCount} log row(s) from cron_job_log`);
      }
    } catch (e) {
      ctx.logToFile?.(`[cron-management] backfill error: ${e?.message || e}`);
    }

    ctx.logToFile?.('[cron-management] onModuleLoaded completed');
  } catch (e) {
    ctx.logToFile?.(`[cron-management] onModuleLoaded error: ${e?.message || e}`);
  }
}

export async function onModuleDisabled(_ctx = {}) {}
