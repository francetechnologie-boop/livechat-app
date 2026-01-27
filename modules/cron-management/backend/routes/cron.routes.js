export function registerCronRoutes(app, ctx = {}) {
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ error: 'unauthorized' }); return null; });
  const pool = ctx.pool;
  const log = (m) => { try { ctx.logToFile?.(`[cron-management] ${m}`); } catch {} };
  const getRegistryActions = () => {
    try {
      if (typeof ctx.getCronActions === 'function') return ctx.getCronActions() || [];
      return [];
    } catch {
      return [];
    }
  };

  async function ensureTables() {
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
  }

  async function upsertAction(data = {}) {
    const id = String(data.id || '').trim();
    if (!id) return null;
    const moduleId = String(data.module_id || '').trim() || 'unknown';
    const name = String(data.name || moduleId);
    const description = String(data.description || '');
    const method = String(data.method || 'POST').toUpperCase();
    const path = String(data.path || '').trim();
    if (!path) return null;
    const payload_template = (data.payload_template && typeof data.payload_template === 'object') ? data.payload_template : {};
    const metadata = (data.metadata && typeof data.metadata === 'object') ? data.metadata : {};
    const r = await pool.query(`
      INSERT INTO mod_cron_management_actions (id, module_id, name, description, method, path, payload_template, metadata, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET module_id=EXCLUDED.module_id, name=EXCLUDED.name, description=EXCLUDED.description, method=EXCLUDED.method, path=EXCLUDED.path, payload_template=EXCLUDED.payload_template, metadata=EXCLUDED.metadata, updated_at=NOW()
      RETURNING *
    `, [id, moduleId, name, description, method, path, payload_template, metadata]);
    return r.rows[0] || null;
  }

  async function getAction(actionId) {
    if (!actionId) return null;
    const r = await pool.query(`SELECT * FROM mod_cron_management_actions WHERE id=$1 LIMIT 1`, [actionId.trim()]);
    return r.rowCount ? r.rows[0] : null;
  }

  function buildCron({ every_hours, every_days, at_time }) {
    try {
      if (every_hours) {
        const h = Math.max(1, Number(every_hours || 0));
        return `0 */${h} * * *`;
      }
      if (every_days) {
        const d = Math.max(1, Number(every_days || 0));
        const t = String(at_time || '03:00');
        const [HH, MM] = t.split(':');
        const hh = Math.max(0, Math.min(23, Number(HH || 0)));
        const mm = Math.max(0, Math.min(59, Number(MM || 0)));
        return `${mm} ${hh} */${d} * *`;
      }
    } catch {}
    return String(new Date().getMinutes() || 0) + ' * * * *';
  }

  function inflateJobRow(row) {
    try {
      const payload = row.payload || {};
      const out = { ...row };
      // Mirror UI-friendly fields when present in payload
      if (payload && typeof payload === 'object') {
        if (payload.every_hours != null) out.every_hours = payload.every_hours;
        if (payload.every_days != null) out.every_days = payload.every_days;
        if (payload.at_time != null) out.at_time = payload.at_time;
        if (payload.options != null) out.options = payload.options;
      }
      if (!out.task && row.action) out.task = row.action;
      // Compute transient last/next run timestamps for display only
      const times = computeScheduleTimes(out);
      out.last_run = times.last_run;
      out.next_run = times.next_run;
      return out;
    } catch { return row; }
  }

  function pad(n){ return String(n).padStart(2,'0'); }
  function toIso(d){ try { return new Date(d).toISOString(); } catch { return null; } }
  function computeScheduleTimes(job) {
    try {
      const now = new Date();
      // Hourly schedule: every N hours at minute 0
      if (job.every_hours && Number(job.every_hours) > 0) {
        const step = Math.max(1, Number(job.every_hours));
        const prev = new Date(now);
        prev.setMinutes(0,0,0);
        const h = prev.getHours();
        const alignedHour = Math.floor(h / step) * step;
        prev.setHours(alignedHour);
        const next = new Date(prev);
        if (next <= now) next.setHours(next.getHours() + step);
        return { last_run: toIso(prev), next_run: toIso(next) };
      }
      // Daily schedule: every D days at HH:mm
      if (job.every_days && Number(job.every_days) > 0) {
        const stepDays = Math.max(1, Number(job.every_days));
        let hh = 3, mm = 0;
        try { const t = String(job.at_time||'03:00'); const p=t.split(':'); hh = Math.max(0, Math.min(23, Number(p[0]||3))); mm = Math.max(0, Math.min(59, Number(p[1]||0))); } catch {}
        const todayAt = new Date(now);
        todayAt.setHours(hh, mm, 0, 0);
        let next = new Date(todayAt);
        if (next <= now) next = new Date(next.getTime() + stepDays*24*60*60*1000);
        const last = new Date(next.getTime() - stepDays*24*60*60*1000);
        return { last_run: toIso(last), next_run: toIso(next) };
      }
    } catch {}
    return { last_run: null, next_run: null };
  }

  // Tasks list for UI (decoupled from Automation Suite)
  app.get('/api/cron-management/tasks', async (_req, res) => {
    try {
      await ensureTables();
      const r = await pool.query(`SELECT id, module_id, name, description FROM mod_cron_management_actions ORDER BY module_id, name`);
      res.json({ ok: true, tasks: r.rows || [] });
    } catch (e) {
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Sync registry -> DB so UI can list actions even after restart.
  app.post('/api/cron-management/actions/sync', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureTables();
      const registry = getRegistryActions();
      const out = [];
      for (const a of registry) {
        try {
          const saved = await upsertAction(a);
          if (saved) out.push(saved);
        } catch {}
      }
      log(`actions_sync: registry=${registry.length} upserted=${out.length}`);
      res.json({ ok: true, registry: registry.length, upserted: out.length, actions: out });
    } catch (e) {
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Debug: view in-memory registry (actions registered by modules at runtime)
  app.get('/api/cron-management/registry', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const registry = getRegistryActions();
      res.json({ ok: true, actions: registry });
    } catch (e) {
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  app.get('/api/cron-management/actions', async (_req, res) => {
    try {
      await ensureTables();
      const r = await pool.query(`SELECT * FROM mod_cron_management_actions ORDER BY module_id, name`);
      res.json({ ok: true, actions: r.rows || [] });
    } catch (e) {
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/cron-management/actions', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureTables();
      const data = req.body || {};
      const action = await upsertAction(data);
      if (!action) return res.status(400).json({ ok:false, error:'bad_request', message:'action_id and path required' });
      res.json({ ok:true, action });
    } catch (e) {
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  app.get('/api/cron-management/jobs', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureTables();
      const r = await pool.query(`SELECT * FROM mod_cron_management_jobs ORDER BY updated_at DESC`);
      const items = (r.rows || []).map(inflateJobRow);
      res.json({ ok: true, items });
    }
    catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/cron-management/jobs', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureTables();
      const b = req.body || {};
      const id = String(b.id || `cron_${Date.now()}`).trim();
      const name = String(b.name || id).trim();
      const task = String(b.task || b.action || '').trim();
      const options = (b.options && typeof b.options === 'object') ? b.options : {};
      const enabled = b.enabled === undefined ? true : !!b.enabled;
      const every_hours = b.every_hours != null ? Number(b.every_hours) : null;
      const every_days = b.every_days != null ? Number(b.every_days) : null;
      const at_time = b.at_time != null ? String(b.at_time) : null;
      let schedule = String(b.schedule || '').trim();
      if (!schedule) schedule = buildCron({ every_hours, every_days, at_time });
      if (!schedule || !task) return res.status(400).json({ ok:false, error:'bad_request' });
      const payload = { every_hours, every_days, at_time, options };
      const r = await pool.query(`
        INSERT INTO mod_cron_management_jobs (id, name, schedule, action, payload, enabled, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,NOW(),NOW())
        ON CONFLICT (id)
        DO UPDATE SET name=EXCLUDED.name, schedule=EXCLUDED.schedule, action=EXCLUDED.action, payload=EXCLUDED.payload, enabled=EXCLUDED.enabled, updated_at=NOW()
        RETURNING *
      `, [id, name, schedule, task, payload, enabled]);
      res.json({ ok:true, item: inflateJobRow(r.rows[0]) });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.patch('/api/cron-management/jobs/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureTables();
      const id = String(req.params.id||'').trim();
      const b = req.body || {};
      const sets = []; const vals = [];
      const push = (col,val,cast)=>{ sets.push(`${col} = $${sets.length+1}${cast||''}`); vals.push(val); };
      if (b.name !== undefined) push('name', String(b.name||''));
      // Allow schedule mutation via either raw schedule or friendly fields
      if (b.schedule !== undefined || b.every_hours !== undefined || b.every_days !== undefined || b.at_time !== undefined) {
        const sched = String(b.schedule || buildCron({ every_hours: b.every_hours, every_days: b.every_days, at_time: b.at_time }) || '').trim();
        push('schedule', sched);
      }
      if (b.action !== undefined || b.task !== undefined) push('action', String(b.action || b.task || ''));
      if (b.payload !== undefined || b.options !== undefined || b.every_hours !== undefined || b.every_days !== undefined || b.at_time !== undefined) {
        const payload = (b.payload && typeof b.payload === 'object') ? b.payload : {};
        if (b.options !== undefined) payload.options = b.options;
        if (b.every_hours !== undefined) payload.every_hours = b.every_hours;
        if (b.every_days !== undefined) payload.every_days = b.every_days;
        if (b.at_time !== undefined) payload.at_time = b.at_time;
        push('payload', payload, '::jsonb');
      }
      if (b.enabled !== undefined) push('enabled', !!b.enabled);
      if (!sets.length) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`UPDATE mod_cron_management_jobs SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${vals.length+1} RETURNING *`, [...vals, id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      res.json({ ok:true, item: inflateJobRow(r.rows[0]) });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.delete('/api/cron-management/jobs/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try { await ensureTables(); const id = String(req.params.id||'').trim(); await pool.query(`DELETE FROM mod_cron_management_jobs WHERE id=$1`, [id]); res.json({ ok:true }); }
    catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/cron-management/jobs/:id/run', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureTables();
      const id = String(req.params.id||'').trim();
      const r = await pool.query(`SELECT * FROM mod_cron_management_jobs WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const j = r.rows[0];
      const actionId = String(j.action || '').trim();
      if (!actionId) return res.status(400).json({ ok:false, error:'bad_request', message:'missing_action' });

      // Resolve action details (DB first, registry fallback)
      let action = await getAction(actionId);
      if (!action) {
        const reg = getRegistryActions();
        action = reg.find((a) => String(a.id || '').trim() === actionId) || null;
      }
      if (!action) return res.status(400).json({ ok:false, error:'bad_request', message:`unknown_action:${actionId}` });

      const payload = (j.payload && typeof j.payload === 'object') ? j.payload : {};
      if (typeof ctx.dispatchCronHttpAction !== 'function') {
        await pool.query(`INSERT INTO mod_cron_management_logs (job_id, status, message) VALUES ($1,$2,$3)`,[id,'fail','dispatcher_missing']);
        return res.status(500).json({ ok:false, error:'dispatcher_missing' });
      }

      const result = await ctx.dispatchCronHttpAction(action, payload, ctx);
      const status = result?.ok ? 'ok' : 'fail';
      const msg = result?.ok
        ? `dispatched ${actionId} status=${result.status} ms=${result.ms}`
        : `dispatch_failed ${actionId} status=${result?.status || '-'} ms=${result?.ms || '-'} err=${result?.error || result?.text || result?.message || '-'}`;
      await pool.query(`INSERT INTO mod_cron_management_logs (job_id, status, message) VALUES ($1,$2,$3)`,[id,status,String(msg).slice(0, 2000)]);
      res.json({ ok:true, action: actionId, result });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Logs listing (optionally filtered by job_id)
  app.get('/api/cron-management/logs', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureTables();
      const jobId = String(req.query?.job_id || '').trim();
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
      let r;
      if (jobId) r = await pool.query(`SELECT * FROM mod_cron_management_logs WHERE job_id=$1 ORDER BY ran_at DESC, id DESC LIMIT $2`, [jobId, limit]);
      else r = await pool.query(`SELECT * FROM mod_cron_management_logs ORDER BY ran_at DESC, id DESC LIMIT $1`, [limit]);
      res.json({ ok:true, items: r.rows });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
