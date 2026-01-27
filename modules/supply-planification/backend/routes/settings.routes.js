function jsonError(res, status, error, message) {
  try {
    return res.status(status).json({ ok: false, error, ...(message ? { message } : {}) });
  } catch {
    return res.status(status).end();
  }
}

function requireAuth(ctx, req, res) {
  try {
    if (ctx && typeof ctx.requireAuth === 'function') return ctx.requireAuth(req, res);
  } catch {}
  jsonError(res, 401, 'unauthorized');
  return null;
}

function requireAdmin(ctx, req, res) {
  try {
    if (ctx && typeof ctx.requireAdmin === 'function') return ctx.requireAdmin(req, res);
  } catch {}
  jsonError(res, 401, 'unauthorized');
  return null;
}

async function getSettingsRow(pool, orgId) {
  const key = 'settings';
  const args = [key];
  let where = 'key=$1';
  if (orgId) {
    args.push(orgId);
    where += ' AND (org_id IS NULL OR org_id = $2)';
  }
  const r = await pool.query(`SELECT value FROM mod_supply_planification_settings WHERE ${where} ORDER BY updated_at DESC LIMIT 1`, args);
  return r.rowCount ? (r.rows[0]?.value || {}) : {};
}

async function upsertSettingsRow(pool, orgId, next) {
  const key = 'settings';
  const args = [orgId || null, key, next];
  await pool.query(
    `
    INSERT INTO mod_supply_planification_settings(org_id, key, value, created_at, updated_at)
    VALUES ($1,$2,$3,NOW(),NOW())
    ON CONFLICT (org_id, key) DO UPDATE
      SET value=EXCLUDED.value, updated_at=NOW()
    `,
    args
  );
}

export function registerSupplyPlanificationSettingsRoutes(app, ctx = {}, utils = {}) {
  const base = utils.base || '/api/supply-planification';
  const pool = utils.pool || ctx.pool;
  const pickOrgId = utils.pickOrgId || (() => null);

  app.get(base + '/settings', async (req, res) => {
    if (!requireAuth(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const value = await getSettingsRow(pool, orgId);
      return res.json({
        ok: true,
        settings: {
          mysql_profile_id: value.mysql_profile_id ?? null,
          coverage_days: Number(value.coverage_days || 220),
          locations: Array.isArray(value.locations) ? value.locations : [],
        },
      });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });

  app.put(base + '/settings', async (req, res) => {
    if (!requireAdmin(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const incoming = (body.settings && typeof body.settings === 'object') ? body.settings : body;

      const mysqlProfileId = incoming.mysql_profile_id != null ? Number(incoming.mysql_profile_id) : null;
      const coverageDays = Math.max(1, Math.min(3650, Number(incoming.coverage_days || 220)));
      const locations = Array.isArray(incoming.locations)
        ? incoming.locations.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12)
        : [];

      const next = {
        mysql_profile_id: (mysqlProfileId && Number.isFinite(mysqlProfileId) && mysqlProfileId > 0) ? mysqlProfileId : null,
        coverage_days: Number.isFinite(coverageDays) ? coverageDays : 220,
        locations,
      };

      await upsertSettingsRow(pool, orgId, next);
      return res.json({ ok: true, settings: next });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });
}
