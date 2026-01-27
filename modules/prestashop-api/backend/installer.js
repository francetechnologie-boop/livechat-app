/**
 * Prestashop API Module Installer (ESM)
 * - Registers module entry and applies SQL migrations under db/migrations
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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
  const alt = path.join(appBackendDir, 'node_modules', 'pg', 'esm', 'index.mjs');
  if (!fs.existsSync(alt)) throw new Error('pg_missing');
  const { Pool } = await import(pathToFileURL(alt).href);
  return new Pool(getPgConfig());
}

async function query(pool, sql, params) { return pool.query(sql, params); }

async function ensureSystemTables(pool) {
  await query(pool, `CREATE TABLE IF NOT EXISTS modules (
    id_module SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    active SMALLINT NOT NULL DEFAULT 0,
    version VARCHAR(8) NOT NULL DEFAULT '0.0.0',
    install SMALLINT NOT NULL DEFAULT 0,
    installed_at TIMESTAMP NULL DEFAULT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );`);
  await query(pool, `CREATE TABLE IF NOT EXISTS migrations_log (
    id SERIAL PRIMARY KEY,
    module_name VARCHAR(255),
    filename VARCHAR(255),
    applied_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT uq_migrations_log UNIQUE(module_name, filename)
  );`);
}

async function applyMigrations(pool, dir, moduleName) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const already = await pool.query(`SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2`, [moduleName, file]);
    if (already.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(` 🚀 Running migration: ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO migrations_log(module_name, filename) VALUES ($1,$2)`, [moduleName, file]);
      await client.query('COMMIT');
    } catch (e) { try { await client.query('ROLLBACK'); } catch {};
      try {
        const dbg = String(process.env.MIGRATION_DEBUG || '1') !== '0';
        const pos = Number(e && e.position ? e.position : 0) || 0;
        let pointer = '';
        let snippet = '';
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
        if (dbg) {
          console.error('--- SQL snippet ---');
          console.error(snippet);
          if (pointer) console.error(pointer);
          console.error('-------------------');
        }
        try { e.message = `${header}: ${msg}`; } catch {}
      } catch {}
      throw e; }
    finally { client.release(); }
  }
}

export async function installModule() {
  await loadDotenv();
  const pool = await getPgPool();
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const name = String(cfg?.name || 'prestashop-api');
  const version = String(cfg?.version || '1.0.0').slice(0, 8);
  const active = (cfg?.enabled === false) ? 0 : 1;

  await ensureSystemTables(pool);
  await query(pool, `INSERT INTO modules(name, version, active, install, installed_at, updated_at)
                     VALUES($1,$2,$3,1,NOW(),NOW())
                     ON CONFLICT(name) DO UPDATE SET version=EXCLUDED.version, active=EXCLUDED.active, install=1, updated_at=NOW()`, [name, version, active]);

  await applyMigrations(pool, migrationsDir, name);
  await pool.end().catch(()=>{});
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('installer.js')) {
  installModule().then(()=>{ try { console.log('prestashop-api installed'); } catch {} }).catch(e=>{ console.error(e); process.exitCode = 1; });
}
