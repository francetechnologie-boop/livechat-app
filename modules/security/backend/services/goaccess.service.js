const TABLE_NAME = 'public.mod_security_goaccess_dashboards';

function normalizeName(name) {
  const v = String(name || '').trim();
  if (!v) return '';
  return v.slice(0, 120);
}

function normalizeUrl(url) {
  const v = String(url || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) return '';
  return v.slice(0, 2000);
}

export async function ensureGoaccessDashboardsTable(pool) {
  if (!pool || typeof pool.query !== 'function') return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_goaccess_org ON ${TABLE_NAME} (org_id)`);
  } catch {}
  try {
    await pool.query(`
      DO $$ BEGIN
        IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
          SELECT 1
            FROM pg_index i
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
           WHERE n.nspname = 'public' AND t.relname = 'organizations'
             AND i.indisunique = TRUE
             AND array_length(i.indkey,1) = 1
             AND a.attname = 'id'
        ) THEN
          BEGIN
            ALTER TABLE ${TABLE_NAME}
              ADD CONSTRAINT fk_security_goaccess_org
              FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
          EXCEPTION
            WHEN duplicate_object THEN NULL;
            WHEN others THEN NULL;
          END;
        END IF;
      END $$;
    `);
  } catch {}
}

export async function listGoaccessDashboards(pool, { orgId = null } = {}) {
  if (!pool) return [];
  await ensureGoaccessDashboardsTable(pool);
  const r = await pool.query(
    `SELECT id, org_id, name, url, created_at, updated_at
       FROM ${TABLE_NAME}
      WHERE (($1::int IS NULL AND org_id IS NULL) OR org_id=$1)
      ORDER BY name ASC, id ASC`,
    [orgId]
  );
  return (r && r.rows) ? r.rows : [];
}

export async function createGoaccessDashboard(pool, { orgId = null, name, url } = {}) {
  if (!pool) return null;
  await ensureGoaccessDashboardsTable(pool);
  const n = normalizeName(name);
  const u = normalizeUrl(url);
  if (!n) {
    const e = new Error('Name is required.');
    e.statusCode = 400;
    throw e;
  }
  if (!u) {
    const e = new Error('URL must start with http:// or https://');
    e.statusCode = 400;
    throw e;
  }

  const r = await pool.query(
    `INSERT INTO ${TABLE_NAME} (org_id, name, url, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING id, org_id, name, url, created_at, updated_at`,
    [orgId, n, u]
  );
  return (r && r.rows && r.rows[0]) ? r.rows[0] : null;
}

export async function updateGoaccessDashboard(pool, { orgId = null, id, name, url } = {}) {
  if (!pool) return null;
  await ensureGoaccessDashboardsTable(pool);
  const parsedId = Number(id);
  if (!Number.isFinite(parsedId) || parsedId <= 0) {
    const e = new Error('Invalid id.');
    e.statusCode = 400;
    throw e;
  }
  const n = normalizeName(name);
  const u = normalizeUrl(url);
  if (!n) {
    const e = new Error('Name is required.');
    e.statusCode = 400;
    throw e;
  }
  if (!u) {
    const e = new Error('URL must start with http:// or https://');
    e.statusCode = 400;
    throw e;
  }

  const r = await pool.query(
    `UPDATE ${TABLE_NAME}
        SET name=$2, url=$3, updated_at=NOW()
      WHERE id=$1
        AND (($4::int IS NULL AND org_id IS NULL) OR org_id=$4)
      RETURNING id, org_id, name, url, created_at, updated_at`,
    [parsedId, n, u, orgId]
  );
  const row = (r && r.rows && r.rows[0]) ? r.rows[0] : null;
  if (!row) {
    const e = new Error('Not found.');
    e.statusCode = 404;
    throw e;
  }
  return row;
}

export async function deleteGoaccessDashboard(pool, { orgId = null, id } = {}) {
  if (!pool) return false;
  await ensureGoaccessDashboardsTable(pool);
  const parsedId = Number(id);
  if (!Number.isFinite(parsedId) || parsedId <= 0) {
    const e = new Error('Invalid id.');
    e.statusCode = 400;
    throw e;
  }
  const r = await pool.query(
    `DELETE FROM ${TABLE_NAME}
      WHERE id=$1
        AND (($2::int IS NULL AND org_id IS NULL) OR org_id=$2)`,
    [parsedId, orgId]
  );
  return Boolean(r && typeof r.rowCount === 'number' && r.rowCount > 0);
}

