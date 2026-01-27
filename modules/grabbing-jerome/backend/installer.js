/**
 * Grabbing-Jerome Module Installer
 * - Applies SQL migrations under modules/grabbing-jerome/db/migrations
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moduleRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(moduleRoot, 'db', 'migrations');
const appBackendDir = path.resolve(moduleRoot, '..', '..', 'backend');

async function loadDotenv() {
  try {
    const dotenvPath = path.join(appBackendDir, 'node_modules', 'dotenv', 'lib', 'main.js');
    if (fs.existsSync(dotenvPath)) {
      const dotenv = await import(pathToFileURL(dotenvPath).href);
      if (dotenv && typeof dotenv.config === 'function') {
        dotenv.config({ path: path.join(appBackendDir, '.env') });
      }
    }
    // Fallback: manually parse backend/.env when dotenv isn't available
    const envFile = path.join(appBackendDir, '.env');
    if (fs.existsSync(envFile)) {
      const raw = fs.readFileSync(envFile, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
    }
  } catch {}
}

function getPgConfig() {
  const url = (process.env.DATABASE_URL || '').trim();
  const base = { connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 3000), idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000) };
  if (url) return { connectionString: url, ...base };
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'postgres',
    ...base,
  };
}

async function getPgPool() {
  try {
    const pg = await import('pg');
    const { Pool } = pg.default || pg;
    return new Pool(getPgConfig());
  } catch {}
  try {
    // Fallback to CJS require when ESM import fails
    const req = createRequire(path.join(appBackendDir, 'package.json'));
    const pgCjs = req('pg');
    const { Pool } = pgCjs;
    return new Pool(getPgConfig());
  } catch {}
  try {
    // Fallback to historical ESM path used by some pg builds
    const pgEsm = path.join(appBackendDir, 'node_modules', 'pg', 'esm', 'index.mjs');
    const pg = await import(pathToFileURL(pgEsm).href);
    const { Pool } = pg;
    return new Pool(getPgConfig());
  } catch (e) {
    throw new Error('pg_not_installed_or_incompatible');
  }
}

async function ensureMigrationsLog(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations_log (
      id SERIAL PRIMARY KEY,
      module_name VARCHAR(255),
      filename VARCHAR(255),
      applied_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_migrations_log UNIQUE(module_name, filename)
    );
  `);
}

async function applyMigrations(pool, dir, moduleName) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const seen = await pool.query(`SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2`, [moduleName, file]);
    if (seen.rows.length) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO migrations_log (module_name, filename) VALUES ($1,$2)`, [moduleName, file]);
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      // Emit helpful diagnostics with SQL pointer, and persist install_error when possible
      try {
        const pos = Number(e && e.position ? e.position : 0) || 0;
        let snippet = '';
        let pointer = '';
        if (pos > 0) {
          const start = Math.max(0, pos - 160);
          const end = Math.min(sql.length, pos + 160);
          snippet = sql.slice(start, end);
          const caretIdx = Math.max(0, pos - start - 1);
          pointer = ' '.repeat(Math.max(0, caretIdx)) + '^';
        } else {
          snippet = sql.slice(0, 320);
        }
        const msg = e?.message || String(e);
        const header = `[installer] ${moduleName} migration failed: ${file}`;
        console.error(header);
        console.error(`error: ${msg}${pos ? ` (position ${pos})` : ''}`);
        console.error('--- SQL snippet ---');
        console.error(snippet);
        if (pointer) console.error(pointer);
        console.error('-------------------');
        // Try to persist error into Module Manager table if present
        try {
          await client.query(`
            UPDATE mod_module_manager_modules
               SET install_error = $1, updated_at = NOW()
             WHERE module_name = $2
          `, [msg, moduleName]).catch(()=>{});
        } catch {}
      } catch {}
      throw e;
    } finally { client.release(); }
  }
}

export async function installModule() {
  await loadDotenv();
  const pool = await getPgPool();
  await ensureMigrationsLog(pool);
  // Upsert module record as active (respect Module Manager schema when present)
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS mod_module_manager_modules (
      id_module    SERIAL PRIMARY KEY,
      module_name  VARCHAR(64) NOT NULL UNIQUE,
      active       SMALLINT NOT NULL DEFAULT 0,
      version      VARCHAR(8) NOT NULL DEFAULT '0.0.0',
      install      SMALLINT NOT NULL DEFAULT 0,
      installed_at TIMESTAMP NULL DEFAULT NULL,
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await pool.query(
      "INSERT INTO mod_module_manager_modules (module_name, active, version, install, installed_at, updated_at) VALUES ($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT (module_name) DO UPDATE SET active=EXCLUDED.active, version=EXCLUDED.version, install=EXCLUDED.install, updated_at=NOW()",
      ['grabbing-jerome', 1, '1.0.0', 1]
    );
    // Ensure optional columns exist so we can clear stale installer errors after success
    try { await pool.query("ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS install_error TEXT NULL"); } catch {}
    try { await pool.query("ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS schema_ok SMALLINT NULL"); } catch {}
  } catch {}
  await applyMigrations(pool, migrationsDir, 'grabbing-jerome');
  // On successful migrations, clear stale install_error and mark schema_ok optimistic true
  try {
    await pool.query(
      "UPDATE mod_module_manager_modules SET install_error = NULL, schema_ok = COALESCE(schema_ok, 1), updated_at = NOW() WHERE module_name = $1",
      ['grabbing-jerome']
    );
  } catch {}
  await pool.end().catch(() => {});
}

if (import.meta.url === pathToFileURL(__filename).href || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  installModule().catch((err) => { try { console.error('[grabbing-jerome] installer failed:', (err && err.message) ? err.message : err); } catch { console.error('[grabbing-jerome] installer failed'); } process.exitCode = 1; });
}
