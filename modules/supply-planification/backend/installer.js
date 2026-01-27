/**
 * Module Installer (ESM JS)
 * - Registers module in DB (aligned with Module Manager schema)
 * - Inserts declared hooks
 * - Runs all SQL migrations in /db/migrations
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const moduleRoot = path.resolve(__dirname, '..');
const configPath = path.join(moduleRoot, 'module.config.json');
const migrationsDir = path.join(moduleRoot, 'db', 'migrations');
const appBackendDir = path.resolve(moduleRoot, '..', '..', 'backend');

async function loadDotenv() {
  try {
    const dotenvPath = path.join(appBackendDir, 'node_modules', 'dotenv', 'lib', 'main.js');
    if (fs.existsSync(dotenvPath)) {
      const dotenv = await import(pathToFileURL(dotenvPath).href);
      dotenv.config?.({ path: path.join(appBackendDir, '.env') });
    }
  } catch {}
}

function getPgConfig() {
  const url = (process.env.DATABASE_URL || '').trim();
  const base = { connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 };
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
  const pgEsm = path.join(appBackendDir, 'node_modules', 'pg', 'esm', 'index.mjs');
  if (!fs.existsSync(pgEsm)) throw new Error("Cannot locate 'pg'. Install it in backend or root node_modules.");
  const pg = await import(pathToFileURL(pgEsm).href);
  const { Pool } = pg;
  return new Pool(getPgConfig());
}

async function ensureSystemTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS modules (
      id_module   SERIAL PRIMARY KEY,
      name        VARCHAR(64) NOT NULL UNIQUE,
      active      SMALLINT NOT NULL DEFAULT 0,
      version     VARCHAR(8) NOT NULL DEFAULT '0.0.0',
      install     SMALLINT NOT NULL DEFAULT 0,
      installed_at TIMESTAMP NULL DEFAULT NULL,
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hooks (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE,
      active BOOLEAN DEFAULT TRUE
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hook_module (
      id SERIAL PRIMARY KEY,
      hook_id INT REFERENCES hooks(id),
      module_name VARCHAR(255),
      callback VARCHAR(255),
      position INT DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      CONSTRAINT uq_hook_module UNIQUE(hook_id, module_name, callback)
    );
  `);
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

async function findModuleManagerTable(pool) {
  try {
    const modRes = await pool.query("SELECT to_regclass('public.mod_module_manager_modules') AS found");
    if (modRes.rows?.[0]?.found) {
      return { table: 'mod_module_manager_modules', nameColumn: 'module_name' };
    }
    const legacyRes = await pool.query("SELECT to_regclass('public.modules') AS found");
    if (legacyRes.rows?.[0]?.found) {
      return { table: 'modules', nameColumn: 'name' };
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_module_manager_modules (
        id_module   SERIAL PRIMARY KEY,
        module_name VARCHAR(64) NOT NULL UNIQUE,
        active      SMALLINT NOT NULL DEFAULT 0,
        version     VARCHAR(8) NOT NULL DEFAULT '0.0.0',
        install     SMALLINT NOT NULL DEFAULT 0,
        installed_at TIMESTAMP NULL DEFAULT NULL,
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    return { table: 'mod_module_manager_modules', nameColumn: 'module_name' };
  } catch (error) {
    return null;
  }
}

async function ensureModuleManagerEntry(pool, moduleName, version) {
  const info = await findModuleManagerTable(pool);
  if (!info) return;
  try {
    await pool.query(
      `
      INSERT INTO ${info.table} (${info.nameColumn}, version, active, install, installed_at, updated_at)
      VALUES ($1, $2, 1, 1, NOW(), NOW())
      ON CONFLICT (${info.nameColumn}) DO UPDATE
        SET version = EXCLUDED.version,
            active = 1,
            install = 1,
            updated_at = NOW();
      `,
      [moduleName, version]
    );
  } catch (error) {
    // best effort, ignore failures
  }
}

async function registerHook(pool, moduleName, hookName, callback) {
  await pool.query(
    `INSERT INTO hooks (name) VALUES ($1)
     ON CONFLICT (name) DO NOTHING;`,
    [hookName]
  );
  await pool.query(
    `INSERT INTO hook_module (hook_id, module_name, callback)
     SELECT h.id, $1, $2 FROM hooks h WHERE h.name=$3
     ON CONFLICT ON CONSTRAINT uq_hook_module DO NOTHING;`,
    [moduleName, callback, hookName]
  );
}

async function applyMigrations(pool, migrationsPath, moduleName) {
  if (!fs.existsSync(migrationsPath)) return;
  const files = fs.readdirSync(migrationsPath).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const seen = await pool.query(
      `SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2;`,
      [moduleName, file]
    );
    if (seen.rows.length) continue;
    const sql = fs.readFileSync(path.join(migrationsPath, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO migrations_log (module_name, filename) VALUES ($1, $2);`, [moduleName, file]);
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw new Error(`Migration failed: ${file}: ${String(e?.message || e)}`);
    } finally {
      client.release();
    }
  }
}

async function upsertModule(pool, moduleName, version) {
  await pool.query(
    `INSERT INTO modules(name, active, version, install, installed_at, updated_at)
     VALUES ($1, 1, $2, 1, NOW(), NOW())
     ON CONFLICT (name) DO UPDATE
       SET active=EXCLUDED.active, version=EXCLUDED.version, install=EXCLUDED.install, updated_at=NOW();`,
    [moduleName, version]
  );
}

export async function install() {
  await loadDotenv();
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const moduleName = cfg?.name || 'supply-planification';
  const version = cfg?.version || '1.0.0';
  const hooks = cfg?.hooks || {};

  const pool = await getPgPool();
  try {
    await ensureSystemTables(pool);
    await upsertModule(pool, moduleName, version);
    for (const [hookName, callback] of Object.entries(hooks)) {
      if (!hookName || !callback) continue;
      await registerHook(pool, moduleName, hookName, callback);
    }
    await applyMigrations(pool, migrationsDir, moduleName);
    await ensureModuleManagerEntry(pool, moduleName, version);
  } finally {
    try { await pool.end(); } catch {}
  }
  return { ok: true, module: moduleName, version };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  install()
    .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
}
