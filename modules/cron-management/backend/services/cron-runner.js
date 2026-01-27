function safeString(value) {
  return String(value ?? '').trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getPragueNowParts(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const year = Number(map.year || 0);
    const month = Number(map.month || 0);
    const day = Number(map.day || 0);
    const hour = Number(map.hour || 0);
    const minute = Number(map.minute || 0);
    const weekdayStr = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', weekday: 'short' }).format(now);
    const weekday = ({ sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[String(weekdayStr || '').slice(0, 3).toLowerCase()] ?? 0);
    return {
      year,
      month,
      day,
      hour,
      minute,
      weekday,
      minuteKey: `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`,
    };
  } catch {
    const d = now instanceof Date ? now : new Date(now);
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
      hour: d.getHours(),
      minute: d.getMinutes(),
      weekday: d.getDay(),
      minuteKey: `${String(d.getFullYear()).padStart(4, '0')}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    };
  }
}

function parseCronField(field, { min, max }) {
  const raw = safeString(field);
  if (!raw || raw === '*') return () => true;
  const list = raw.split(',').map((x) => x.trim()).filter(Boolean);
  const matchers = list.map((token) => {
    if (token === '*') return () => true;
    const stepMatch = token.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = Math.max(1, Number(stepMatch[1] || 1));
      return (value) => {
        const v = Number(value);
        if (!Number.isFinite(v)) return false;
        if (v < min || v > max) return false;
        return ((v - min) % step) === 0;
      };
    }
    const n = Number(token);
    if (!Number.isFinite(n)) return () => false;
    const fixed = Math.trunc(n);
    return (value) => Number(value) === fixed;
  });
  return (value) => matchers.some((fn) => fn(value));
}

function matchesCron(schedule, nowParts) {
  try {
    const text = safeString(schedule);
    if (!text) return false;
    const fields = text.split(/\s+/).filter(Boolean);
    if (fields.length < 5) return false;
    const [minF, hourF, domF, monF, dowF] = fields;
    const minOk = parseCronField(minF, { min: 0, max: 59 })(nowParts.minute);
    const hourOk = parseCronField(hourF, { min: 0, max: 23 })(nowParts.hour);
    const domOk = parseCronField(domF, { min: 1, max: 31 })(nowParts.day);
    const monOk = parseCronField(monF, { min: 1, max: 12 })(nowParts.month);
    const dowValue = Number(nowParts.weekday);
    const dowMatcher = dowF === '*' ? null : parseCronField(dowF, { min: 0, max: 7 });
    const dowOk = dowMatcher
      ? (dowMatcher(dowValue) || (dowValue === 0 && dowMatcher(7)))
      : true;
    return minOk && hourOk && domOk && monOk && dowOk;
  } catch {
    return false;
  }
}

async function resolveAction(client, actionId, ctx) {
  const id = safeString(actionId);
  if (!id) return null;
  try {
    const r = await client.query(`SELECT * FROM mod_cron_management_actions WHERE id=$1 LIMIT 1`, [id]);
    if (r.rowCount) return r.rows[0] || null;
  } catch {}
  try {
    if (typeof ctx.getCronActions === 'function') {
      const reg = ctx.getCronActions() || [];
      return reg.find((a) => safeString(a?.id) === id) || null;
    }
  } catch {}
  return null;
}

function shouldRunNow({ schedule, nowParts, lastRanMinuteKey }) {
  if (!matchesCron(schedule, nowParts)) return false;
  if (!lastRanMinuteKey) return true;
  return String(lastRanMinuteKey) !== String(nowParts.minuteKey);
}

export function startCronRunner(ctx = {}) {
  const pool = ctx.pool;
  if (!pool) return;
  if (globalThis.__cronManagementRunnerStarted) return;
  globalThis.__cronManagementRunnerStarted = true;

  const log = (msg) => {
    try {
      const line = `[cron-management] ${msg}`;
      if (typeof ctx.logToFile === 'function') ctx.logToFile(line);
    } catch {}
  };

  const enabled = !/^(0|false|no)$/i.test(String(process.env.CRON_RUNNER_ENABLED || '1'));
  const tickMs = Math.max(10_000, Math.min(5 * 60_000, Number(process.env.CRON_TICK_MS || 30_000)));
  if (!enabled) {
    log(`runner disabled (CRON_RUNNER_ENABLED=${process.env.CRON_RUNNER_ENABLED || ''})`);
    return;
  }

  const LOCK_KEY = 'mod_cron_management_runner_v1';
  let ticking = false;

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    const nowParts = getPragueNowParts(new Date());
    let client = null;
    try {
      client = await pool.connect();
      const lock = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [LOCK_KEY]);
      const haveLock = !!lock.rows?.[0]?.ok;
      if (!haveLock) return;

      const jobsRes = await client.query(
        `SELECT id, name, schedule, action, payload, enabled
           FROM mod_cron_management_jobs
          WHERE enabled = TRUE
          ORDER BY updated_at DESC`
      );
      const jobs = Array.isArray(jobsRes.rows) ? jobsRes.rows : [];
      if (!jobs.length) return;

      const lastRunsRes = await client.query(
        `SELECT DISTINCT ON (job_id) job_id, ran_at
           FROM mod_cron_management_logs
          ORDER BY job_id, ran_at DESC`
      );
      const lastById = new Map();
      for (const row of Array.isArray(lastRunsRes.rows) ? lastRunsRes.rows : []) {
        if (!row?.job_id) continue;
        const key = safeString(row.job_id);
        const ranAt = row.ran_at ? new Date(row.ran_at) : null;
        const lastKey = ranAt ? getPragueNowParts(ranAt).minuteKey : null;
        lastById.set(key, lastKey);
      }

      for (const job of jobs) {
        const jobId = safeString(job.id);
        if (!jobId) continue;
        const schedule = safeString(job.schedule);
        if (!schedule) continue;

        const lastRanKey = lastById.get(jobId) || null;
        if (!shouldRunNow({ schedule, nowParts, lastRanMinuteKey: lastRanKey })) continue;

        const actionId = safeString(job.action);
        const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
        const action = await resolveAction(client, actionId, ctx);
        if (!action) {
          await client.query(
            `INSERT INTO mod_cron_management_logs (job_id, status, message) VALUES ($1,$2,$3)`,
            [jobId, 'fail', `unknown_action:${actionId || '-'}`]
          );
          continue;
        }
        if (typeof ctx.dispatchCronHttpAction !== 'function') {
          await client.query(
            `INSERT INTO mod_cron_management_logs (job_id, status, message) VALUES ($1,$2,$3)`,
            [jobId, 'fail', 'dispatcher_missing']
          );
          continue;
        }
        try {
          const result = await ctx.dispatchCronHttpAction(action, payload, ctx);
          const status = result?.ok ? 'ok' : 'fail';
          const msg = result?.ok
            ? `auto_dispatched ${actionId} status=${result.status} ms=${result.ms}`
            : `auto_dispatch_failed ${actionId} status=${result?.status || '-'} ms=${result?.ms || '-'} err=${result?.error || result?.text || result?.message || '-'}`;
          await client.query(
            `INSERT INTO mod_cron_management_logs (job_id, status, message) VALUES ($1,$2,$3)`,
            [jobId, status, safeString(msg).slice(0, 2000)]
          );
        } catch (e) {
          await client.query(
            `INSERT INTO mod_cron_management_logs (job_id, status, message) VALUES ($1,$2,$3)`,
            [jobId, 'fail', safeString(e?.message || e).slice(0, 2000)]
          );
        }
      }
    } catch (e) {
      log(`runner tick error: ${e?.message || e}`);
    } finally {
      try {
        if (client) await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]);
      } catch {}
      try { client?.release(); } catch {}
      ticking = false;
    }
  };

  setInterval(() => { tick().catch(() => {}); }, tickMs);
  tick().catch(() => {});
  log(`runner started tick_ms=${tickMs} tz=Europe/Prague`);
}
