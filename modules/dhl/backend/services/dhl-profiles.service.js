function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeOrgId(orgId) {
  const s = String(orgId || '').trim();
  return s || 'org_default';
}

function normalizeText(v, max = 255) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s.slice(0, max);
}

function normalizePrefix(prefix) {
  const p = String(prefix || 'ps_').trim();
  if (!p) return 'ps_';
  if (!/^[a-zA-Z0-9_]+$/.test(p)) return 'ps_';
  return p;
}

function normalizeCountryCode(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return '';
  if (!/^[A-Z]{2}$/.test(s)) return '';
  return s;
}

function safeLast4(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  return v.length >= 4 ? v.slice(-4) : v;
}

async function ensureTable(pool) {
  if (!pool) return;
  // Best-effort: table should be created via migrations, but keep runtime portable.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mod_dhl_profiles (
      id SERIAL PRIMARY KEY,
      org_id TEXT NULL,
      name TEXT NOT NULL DEFAULT '',
      api_key TEXT NULL,
      mysql_profile_id INTEGER NULL,
      presta_prefix TEXT NOT NULL DEFAULT 'ps_',
      language TEXT NULL,
      service TEXT NULL,
      origin_country_code TEXT NULL,
      requester_country_code TEXT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_dhl_profiles_org ON public.mod_dhl_profiles(org_id)`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_dhl_profiles_default ON public.mod_dhl_profiles(org_id, is_default)`); } catch {}
}

export async function listDhlProfiles(ctx = {}, { orgId } = {}) {
  const pool = ctx?.pool;
  if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
  await ensureTable(pool);
  const org = normalizeOrgId(orgId);
  const r = await pool.query(
    `SELECT id, org_id, name, mysql_profile_id, presta_prefix, language, service, origin_country_code, requester_country_code,
            is_default, created_at, updated_at,
            api_key
       FROM public.mod_dhl_profiles
      WHERE COALESCE(org_id,'org_default') = $1
      ORDER BY is_default DESC, updated_at DESC`,
    [org]
  );
  const items = (r.rows || []).map((row) => ({
    id: row.id,
    org_id: row.org_id || null,
    name: row.name || '',
    mysql_profile_id: row.mysql_profile_id != null ? Number(row.mysql_profile_id) : null,
    presta_prefix: row.presta_prefix || 'ps_',
    language: row.language || null,
    service: row.service || null,
    origin_country_code: row.origin_country_code || null,
    requester_country_code: row.requester_country_code || null,
    is_default: row.is_default === true,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    has_api_key: !!String(row.api_key || '').trim(),
    api_key_last4: safeLast4(row.api_key),
  }));
  return items;
}

export async function getDhlProfile(ctx = {}, { orgId, id }) {
  const pool = ctx?.pool;
  if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
  await ensureTable(pool);
  const org = normalizeOrgId(orgId);
  const pid = clampInt(id, 1, 2_000_000_000, 0);
  if (!pid) return null;
  const r = await pool.query(
    `SELECT id, org_id, name, api_key, mysql_profile_id, presta_prefix, language, service, origin_country_code, requester_country_code, is_default
       FROM public.mod_dhl_profiles
      WHERE id = $1 AND COALESCE(org_id,'org_default') = $2
      LIMIT 1`,
    [pid, org]
  );
  if (!r.rowCount) return null;
  return r.rows[0];
}

export async function getDefaultDhlProfile(ctx = {}, { orgId }) {
  const pool = ctx?.pool;
  if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
  await ensureTable(pool);
  const org = normalizeOrgId(orgId);
  const r = await pool.query(
    `SELECT id, org_id, name, api_key, mysql_profile_id, presta_prefix, language, service, origin_country_code, requester_country_code, is_default
       FROM public.mod_dhl_profiles
      WHERE COALESCE(org_id,'org_default') = $1 AND is_default = TRUE
      ORDER BY updated_at DESC
      LIMIT 1`,
    [org]
  );
  if (r.rowCount) return r.rows[0];
  const r2 = await pool.query(
    `SELECT id, org_id, name, api_key, mysql_profile_id, presta_prefix, language, service, origin_country_code, requester_country_code, is_default
       FROM public.mod_dhl_profiles
      WHERE COALESCE(org_id,'org_default') = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [org]
  );
  return r2.rowCount ? r2.rows[0] : null;
}

export async function createDhlProfile(ctx = {}, { orgId, input }) {
  const pool = ctx?.pool;
  if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
  await ensureTable(pool);
  const org = normalizeOrgId(orgId);
  const b = (input && typeof input === 'object') ? input : {};
  const name = normalizeText(b.name || 'Default', 255) || 'Default';
  const apiKey = normalizeText(b.api_key || b.apiKey || '', 2000) || null;
  const mysqlProfileId = (b.mysql_profile_id != null) ? clampInt(b.mysql_profile_id, 1, 2_000_000_000, null) : null;
  const prestaPrefix = normalizePrefix(b.presta_prefix || b.prefix || 'ps_');
  const language = normalizeText(b.language || '', 16) || null;
  const service = normalizeText(b.service || '', 32) || null;
  const origin = normalizeCountryCode(b.origin_country_code || b.originCountryCode || '');
  const requester = normalizeCountryCode(b.requester_country_code || b.requesterCountryCode || '');
  const isDefault = b.is_default === true || b.set_default === true;

  const r = await pool.query(
    `INSERT INTO public.mod_dhl_profiles (org_id, name, api_key, mysql_profile_id, presta_prefix, language, service, origin_country_code, requester_country_code, is_default, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
     RETURNING id`,
    [org, name, apiKey, mysqlProfileId, prestaPrefix, language, service, origin || null, requester || null, isDefault]
  );
  const id = r.rowCount ? Number(r.rows[0].id) : null;
  if (id && isDefault) {
    try { await pool.query(`UPDATE public.mod_dhl_profiles SET is_default = FALSE, updated_at = NOW() WHERE COALESCE(org_id,'org_default') = $1 AND id <> $2`, [org, id]); } catch {}
  }
  return { id };
}

export async function updateDhlProfile(ctx = {}, { orgId, id, patch }) {
  const pool = ctx?.pool;
  if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
  await ensureTable(pool);
  const org = normalizeOrgId(orgId);
  const pid = clampInt(id, 1, 2_000_000_000, 0);
  if (!pid) throw new Error('bad_request');
  const b = (patch && typeof patch === 'object') ? patch : {};

  const sets = [];
  const vals = [];
  let idx = 1;
  const set = (col, val) => { sets.push(`${col} = $${idx}`); vals.push(val); idx += 1; };
  if (b.name !== undefined) set('name', normalizeText(b.name, 255) || '');
  if (b.api_key !== undefined || b.apiKey !== undefined) {
    const v = normalizeText(b.api_key ?? b.apiKey ?? '', 2000);
    set('api_key', v ? v : null);
  }
  if (b.mysql_profile_id !== undefined) {
    const v = (b.mysql_profile_id == null || b.mysql_profile_id === '') ? null : clampInt(b.mysql_profile_id, 1, 2_000_000_000, null);
    set('mysql_profile_id', v);
  }
  if (b.presta_prefix !== undefined || b.prefix !== undefined) set('presta_prefix', normalizePrefix(b.presta_prefix ?? b.prefix ?? 'ps_'));
  if (b.language !== undefined) set('language', normalizeText(b.language || '', 16) || null);
  if (b.service !== undefined) set('service', normalizeText(b.service || '', 32) || null);
  if (b.origin_country_code !== undefined || b.originCountryCode !== undefined) set('origin_country_code', normalizeCountryCode(b.origin_country_code ?? b.originCountryCode ?? '') || null);
  if (b.requester_country_code !== undefined || b.requesterCountryCode !== undefined) set('requester_country_code', normalizeCountryCode(b.requester_country_code ?? b.requesterCountryCode ?? '') || null);
  if (b.is_default !== undefined || b.set_default !== undefined) set('is_default', b.is_default === true || b.set_default === true);
  if (!sets.length) return { ok: true };

  set('updated_at', new Date());
  vals.push(pid);
  vals.push(org);
  const sql = `UPDATE public.mod_dhl_profiles SET ${sets.join(', ')} WHERE id = $${idx} AND COALESCE(org_id,'org_default') = $${idx + 1}`;
  await pool.query(sql, vals);

  // Enforce one default per org
  if (b.is_default === true || b.set_default === true) {
    try { await pool.query(`UPDATE public.mod_dhl_profiles SET is_default = FALSE, updated_at = NOW() WHERE COALESCE(org_id,'org_default') = $1 AND id <> $2`, [org, pid]); } catch {}
  }
  return { ok: true };
}

export async function deleteDhlProfile(ctx = {}, { orgId, id }) {
  const pool = ctx?.pool;
  if (!pool || typeof pool.query !== 'function') throw new Error('db_unavailable');
  await ensureTable(pool);
  const org = normalizeOrgId(orgId);
  const pid = clampInt(id, 1, 2_000_000_000, 0);
  if (!pid) throw new Error('bad_request');
  await pool.query(`DELETE FROM public.mod_dhl_profiles WHERE id = $1 AND COALESCE(org_id,'org_default') = $2`, [pid, org]);
  return { ok: true };
}

