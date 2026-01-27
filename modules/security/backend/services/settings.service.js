const TABLE_NAME = 'public.mod_security_settings';
const VALID_KEYS = new Set(['ssh_host', 'ssh_user', 'ssh_port', 'ssh_key_path', 'log_path']);

function mapValue(value) {
  if (value == null) return '';
  return String(value);
}

export async function ensureSettingsTable(pool) {
  if (!pool || typeof pool.query !== 'function') return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NULL,
      key TEXT NOT NULL,
      value TEXT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_security_settings_org_key UNIQUE (org_id, key)
    )
  `);
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
              ADD CONSTRAINT fk_security_settings_org
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

async function setSetting(pool, { key, value, orgId }) {
  if (!pool) return false;
  if (!VALID_KEYS.has(key)) return false;
  await ensureSettingsTable(pool);
  if (value == null) {
    await pool.query(`DELETE FROM ${TABLE_NAME} WHERE key=$1 AND (($2::int IS NULL AND org_id IS NULL) OR org_id=$2)`, [key, orgId]);
    return true;
  }
  await pool.query(
    `INSERT INTO ${TABLE_NAME} (org_id, key, value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (org_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [orgId, key, mapValue(value)]
  );
  return true;
}

async function getSettings(pool, orgId) {
  if (!pool) return {};
  await ensureSettingsTable(pool);
  const rows = await pool.query(
    `SELECT key, value FROM ${TABLE_NAME}
     WHERE key = ANY($1)
       AND (($2::int IS NULL AND org_id IS NULL) OR org_id=$2)
     ORDER BY (org_id IS NOT NULL) DESC, key ASC`,
    [[...VALID_KEYS], orgId]
  );
  const map = {};
  for (const row of rows.rows || []) {
    if (!row || !row.key) continue;
    if (map[row.key]) continue;
    map[row.key] = row.value ?? '';
  }
  return map;
}

export async function getSecurityConfig(pool, { orgId } = {}) {
  const rows = await getSettings(pool, orgId);
  const host = rows.ssh_host || process.env.SECURITY_LOG_SSH_HOST || '';
  const user = rows.ssh_user || process.env.SECURITY_LOG_SSH_USER || 'root';
  const port = rows.ssh_port ? Number(rows.ssh_port) : Number(process.env.SECURITY_LOG_SSH_PORT || 22);
  const keyPath = rows.ssh_key_path || process.env.SECURITY_LOG_SSH_KEY_PATH || '';
  const logPath = rows.log_path || process.env.SECURITY_LOG_PATH || '/var/log/apache2/access_unified_website.log';
  const configuredFromDb = Boolean(host && rows.ssh_host);
  const configured = Boolean(host);
  return {
    host: host || '',
    user: user || 'root',
    port: Number.isFinite(port) ? port : 22,
    keyPath: keyPath || '',
    logPath: logPath || '',
    configured,
    configuredFromDb,
    envFallback: !configuredFromDb,
    raw: rows,
  };
}

export async function upsertSecuritySettings(pool, { values = {}, orgId = null }) {
  if (!pool) return false;
  const entries = Object.entries(values).filter(([k]) => VALID_KEYS.has(k));
  if (!entries.length) return false;
  for (const [key, value] of entries) {
    await setSetting(pool, { key, value, orgId });
  }
  return true;
}

export const SECURITY_CONFIG_KEYS = Array.from(VALID_KEYS);
