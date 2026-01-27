import { getSecurityConfig } from './settings.service.js';
import { execFileAsync, getSshArgs, safeAbsoluteRemotePath, shQuote } from '../utils/ssh.js';

const TABLE_NAME = 'public.mod_security_log_connections';

function mapText(value) {
  if (value == null) return '';
  return String(value);
}

function cleanNonEmptyText(value, { maxLen = 500 } = {}) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (s.length > maxLen) return s.slice(0, maxLen);
  if (s.includes('\0') || s.includes('\n') || s.includes('\r')) return '';
  return s;
}

function cleanHost(value) {
  const s = cleanNonEmptyText(value, { maxLen: 255 });
  if (!s) return '';
  if (/\s/.test(s)) return '';
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return '';
  return s;
}

function cleanUser(value) {
  const s = cleanNonEmptyText(value, { maxLen: 64 });
  if (!s) return '';
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return '';
  return s;
}

function cleanPort(value) {
  const n = Number(String(value == null ? '' : value).trim() || 22);
  if (!Number.isFinite(n)) return 22;
  const v = Math.trunc(n);
  if (v < 1 || v > 65535) return 22;
  return v;
}

function cleanName(value) {
  const s = cleanNonEmptyText(value, { maxLen: 80 });
  if (!s) return '';
  return s;
}

function cleanKeyPath(value) {
  const s = cleanNonEmptyText(value, { maxLen: 500 });
  return s;
}

function cleanLogPath(value) {
  const s = cleanNonEmptyText(value, { maxLen: 600 });
  if (!s) return '';
  return s;
}

export async function ensureRemoteLogConnectionsTable(pool) {
  if (!pool || typeof pool.query !== 'function') return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NULL,
      name TEXT NOT NULL,
      ssh_host TEXT NOT NULL DEFAULT '',
      ssh_user TEXT NOT NULL DEFAULT 'root',
      ssh_port INTEGER NOT NULL DEFAULT 22,
      ssh_key_path TEXT NULL,
      log_path TEXT NOT NULL DEFAULT '/var/log/apache2/access_unified_website.log',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_security_log_connections_org_name
        ON ${TABLE_NAME} (org_id, name) WHERE org_id IS NOT NULL;
    `);
  } catch {}
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_security_log_connections_global_name
        ON ${TABLE_NAME} (name) WHERE org_id IS NULL;
    `);
  } catch {}
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_security_log_connections_org_default
        ON ${TABLE_NAME} (org_id) WHERE org_id IS NOT NULL AND is_default = TRUE;
    `);
  } catch {}
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_security_log_connections_global_default
        ON ${TABLE_NAME} ((1)) WHERE org_id IS NULL AND is_default = TRUE;
    `);
  } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_log_connections_org ON ${TABLE_NAME} (org_id)`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_log_connections_updated_at ON ${TABLE_NAME} (updated_at DESC)`); } catch {}

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
              ADD CONSTRAINT fk_security_log_connections_org
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

function mapRow(row) {
  return {
    id: Number(row?.id) || 0,
    org_id: row?.org_id == null ? null : Number(row.org_id),
    name: mapText(row?.name),
    ssh_host: mapText(row?.ssh_host),
    ssh_user: mapText(row?.ssh_user),
    ssh_port: Number(row?.ssh_port) || 22,
    ssh_key_path: mapText(row?.ssh_key_path),
    log_path: mapText(row?.log_path),
    is_default: Boolean(row?.is_default),
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null,
  };
}

export async function listRemoteLogConnections(pool, { orgId = null } = {}) {
  if (!pool) return [];
  await ensureRemoteLogConnectionsTable(pool);
  const rows = await pool.query(
    `SELECT id, org_id, name, ssh_host, ssh_user, ssh_port, ssh_key_path, log_path, is_default, created_at, updated_at
       FROM ${TABLE_NAME}
      WHERE (($1::int IS NULL AND org_id IS NULL) OR org_id=$1)
      ORDER BY is_default DESC, name ASC, id ASC`,
    [orgId]
  );
  return (rows.rows || []).map(mapRow);
}

export async function getRemoteLogConnection(pool, { orgId = null, id } = {}) {
  if (!pool) return null;
  await ensureRemoteLogConnectionsTable(pool);
  const connectionId = Math.trunc(Number(id) || 0);
  if (!connectionId) return null;
  const rows = await pool.query(
    `SELECT id, org_id, name, ssh_host, ssh_user, ssh_port, ssh_key_path, log_path, is_default, created_at, updated_at
       FROM ${TABLE_NAME}
      WHERE id=$1 AND (($2::int IS NULL AND org_id IS NULL) OR org_id=$2)
      LIMIT 1`,
    [connectionId, orgId]
  );
  return rows.rows?.length ? mapRow(rows.rows[0]) : null;
}

export async function getDefaultRemoteLogConnection(pool, { orgId = null } = {}) {
  if (!pool) return null;
  await ensureRemoteLogConnectionsTable(pool);
  const rows = await pool.query(
    `SELECT id, org_id, name, ssh_host, ssh_user, ssh_port, ssh_key_path, log_path, is_default, created_at, updated_at
       FROM ${TABLE_NAME}
      WHERE (($1::int IS NULL AND org_id IS NULL) OR org_id=$1)
        AND is_default = TRUE
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [orgId]
  );
  return rows.rows?.length ? mapRow(rows.rows[0]) : null;
}

export async function upsertRemoteLogConnection(pool, { orgId = null, connection = {} } = {}) {
  if (!pool) return null;
  await ensureRemoteLogConnectionsTable(pool);

  const id = Math.trunc(Number(connection?.id) || 0);
  const name = cleanName(connection?.name);
  const ssh_host = cleanHost(connection?.ssh_host);
  const ssh_user = cleanUser(connection?.ssh_user || 'root') || 'root';
  const ssh_port = cleanPort(connection?.ssh_port);
  const ssh_key_path = cleanKeyPath(connection?.ssh_key_path);
  const log_path = cleanLogPath(connection?.log_path || '/var/log/apache2/access_unified_website.log') || '/var/log/apache2/access_unified_website.log';
  const is_default = Boolean(connection?.is_default);

  if (!name) {
    const e = new Error('Missing name.');
    e.statusCode = 400;
    throw e;
  }
  if (!ssh_host) {
    const e = new Error('Missing ssh_host.');
    e.statusCode = 400;
    throw e;
  }

  if (id) {
    const updated = await pool.query(
      `UPDATE ${TABLE_NAME}
          SET name=$1, ssh_host=$2, ssh_user=$3, ssh_port=$4, ssh_key_path=$5, log_path=$6, is_default=$7, updated_at=NOW()
        WHERE id=$8 AND (($9::int IS NULL AND org_id IS NULL) OR org_id=$9)
      RETURNING id, org_id, name, ssh_host, ssh_user, ssh_port, ssh_key_path, log_path, is_default, created_at, updated_at`,
      [name, ssh_host, ssh_user, ssh_port, ssh_key_path || null, log_path, is_default, id, orgId]
    );
    return updated.rows?.length ? mapRow(updated.rows[0]) : null;
  }

  const inserted = await pool.query(
    `INSERT INTO ${TABLE_NAME} (org_id, name, ssh_host, ssh_user, ssh_port, ssh_key_path, log_path, is_default, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     RETURNING id, org_id, name, ssh_host, ssh_user, ssh_port, ssh_key_path, log_path, is_default, created_at, updated_at`,
    [orgId, name, ssh_host, ssh_user, ssh_port, ssh_key_path || null, log_path, is_default]
  );
  return inserted.rows?.length ? mapRow(inserted.rows[0]) : null;
}

export async function setDefaultRemoteLogConnection(pool, { orgId = null, id } = {}) {
  if (!pool) return null;
  await ensureRemoteLogConnectionsTable(pool);
  const connectionId = Math.trunc(Number(id) || 0);
  if (!connectionId) return null;

  await pool.query(
    `UPDATE ${TABLE_NAME}
        SET is_default = FALSE, updated_at=NOW()
      WHERE (($1::int IS NULL AND org_id IS NULL) OR org_id=$1)
        AND id <> $2`,
    [orgId, connectionId]
  );

  const updated = await pool.query(
    `UPDATE ${TABLE_NAME}
        SET is_default = TRUE, updated_at=NOW()
      WHERE id=$1 AND (($2::int IS NULL AND org_id IS NULL) OR org_id=$2)
      RETURNING id, org_id, name, ssh_host, ssh_user, ssh_port, ssh_key_path, log_path, is_default, created_at, updated_at`,
    [connectionId, orgId]
  );
  return updated.rows?.length ? mapRow(updated.rows[0]) : null;
}

export async function deleteRemoteLogConnection(pool, { orgId = null, id } = {}) {
  if (!pool) return false;
  await ensureRemoteLogConnectionsTable(pool);
  const connectionId = Math.trunc(Number(id) || 0);
  if (!connectionId) return false;
  const r = await pool.query(
    `DELETE FROM ${TABLE_NAME}
      WHERE id=$1 AND (($2::int IS NULL AND org_id IS NULL) OR org_id=$2)`,
    [connectionId, orgId]
  );
  return (r.rowCount || 0) > 0;
}

function mapConnectionToConfig(row) {
  const host = mapText(row?.ssh_host);
  const user = mapText(row?.ssh_user) || 'root';
  const port = Number(row?.ssh_port) || 22;
  const keyPath = mapText(row?.ssh_key_path);
  const logPath = mapText(row?.log_path) || '/var/log/apache2/access_unified_website.log';
  const configured = Boolean(host);
  return {
    host: host || '',
    user: user || 'root',
    port: Number.isFinite(port) ? port : 22,
    keyPath: keyPath || '',
    logPath: logPath || '',
    configured,
    configuredFromDb: true,
    envFallback: false,
    raw: row || null,
  };
}

export async function resolveSecurityRemoteLogConfig(pool, { orgId = null, connectionId = null } = {}) {
  const pickedId = Math.trunc(Number(connectionId) || 0);
  if (pickedId) {
    const row = await getRemoteLogConnection(pool, { orgId, id: pickedId });
    if (!row) {
      const e = new Error('Connection not found.');
      e.statusCode = 404;
      throw e;
    }
    return { config: mapConnectionToConfig(row), src: 'profile', connection: row };
  }

  const def = await getDefaultRemoteLogConnection(pool, { orgId });
  if (def) return { config: mapConnectionToConfig(def), src: 'profile-default', connection: def };

  const legacy = await getSecurityConfig(pool, { orgId });
  return { config: legacy, src: legacy.configuredFromDb ? 'legacy-db' : 'legacy-env', connection: null };
}

export async function testRemoteLogConnection({ pool, orgId = null, connectionId = null, connection = null, timeoutMs = 12000 } = {}) {
  let cfgResolved = null;
  if (connection) {
    const ssh_host = cleanHost(connection?.ssh_host);
    if (!ssh_host) {
      return { ok: false, configured: false, message: 'Missing ssh_host.' };
    }
    cfgResolved = {
      host: ssh_host,
      user: cleanUser(connection?.ssh_user || 'root') || 'root',
      port: cleanPort(connection?.ssh_port),
      keyPath: cleanKeyPath(connection?.ssh_key_path),
      logPath: cleanLogPath(connection?.log_path || '/var/log/apache2/access_unified_website.log') || '/var/log/apache2/access_unified_website.log',
      configured: true,
      configuredFromDb: false,
      envFallback: false,
      raw: null,
    };
  } else {
    const resolved = await resolveSecurityRemoteLogConfig(pool, { orgId, connectionId });
    cfgResolved = resolved.config;
    if (!cfgResolved?.configured) {
      return { ok: true, configured: false, message: 'Not configured.', src: resolved.src };
    }
  }

  const safePath = safeAbsoluteRemotePath(cfgResolved.logPath);
  if (!safePath) {
    return { ok: true, configured: false, message: 'Invalid log_path. Use an absolute path like /var/log/apache2/access_unified_website.log.' };
  }

  const started = Date.now();
  const remoteCmd = [
    'echo __security_ping__;',
    `if test -r ${shQuote(safePath)}; then echo __log_readable__; exit 0; fi;`,
    'echo __log_not_readable__;',
    `ls -la -- ${shQuote(safePath)} 2>/dev/null || true;`,
    'exit 3;',
  ].join(' ');
  const args = [...getSshArgs(cfgResolved), `${cfgResolved.user}@${cfgResolved.host}`, remoteCmd];
  try {
    const { stdout, stderr } = await execFileAsync('ssh', args, { timeout: Math.max(2000, Number(timeoutMs) || 12000) });
    const elapsed_ms = Date.now() - started;
    return {
      ok: true,
      configured: true,
      elapsed_ms,
      stdout: String(stdout || '').trim(),
      stderr: String(stderr || '').trim() || undefined,
    };
  } catch (e) {
    const elapsed_ms = Date.now() - started;
    const stdout = String(e?.stdout || '').trim();
    const stderr = String(e?.stderr || '').trim() || String(e?.message || '').trim();
    const combined = `${stderr}\n${stdout}`.toLowerCase();
    const exitCode = Number.isFinite(Number(e?.code)) ? Number(e.code) : null;

    const notReadable = stdout.includes('__log_not_readable__') || exitCode === 3;
    const authFailed = combined.includes('permission denied') || combined.includes('publickey');
    const badKeyPerms = combined.includes('unprotected private key file') || combined.includes('bad permissions');

    let hint = '';
    if (notReadable) {
      hint = 'The configured log_path is not readable by this SSH user. Fix permissions (e.g. add the user to the adm group) or change log_path.';
    } else if (badKeyPerms) {
      hint = 'SSH key permissions are too open. On the LiveChat server: chmod 600 <key> and chmod 700 <dir>.';
    } else if (authFailed) {
      hint = 'SSH authentication failed. Ensure the public key is in ~/.ssh/authorized_keys for this user, and PermitRootLogin/PubkeyAuthentication allow it.';
    }

    return {
      ok: false,
      configured: true,
      elapsed_ms,
      exitCode,
      stdout,
      stderr,
      message: notReadable ? 'Remote log file is not readable.' : 'SSH command failed.',
      hint: hint || undefined,
    };
  }
}
