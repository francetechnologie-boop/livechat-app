/**
 * MCP2 Module Installer
 * - Registers module
 * - Applies SQL migrations under modules/mcp2/db/migrations
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const moduleRoot = path.resolve(__dirname, "..");
const configPath = path.join(moduleRoot, "module.config.json");
const migrationsDir = path.join(moduleRoot, "db", "migrations");
const appBackendDir = path.resolve(moduleRoot, "..", "..", "backend");

async function loadDotenv() {
  try {
    const envFile = path.join(appBackendDir, ".env");
    const dotenvPath = path.join(appBackendDir, "node_modules", "dotenv", "lib", "main.js");
    if (fs.existsSync(dotenvPath)) {
      const dotenv = await import(pathToFileURL(dotenvPath).href);
      dotenv.config?.({ path: envFile });
      return;
    }
  } catch {}
  // Fallback: minimal .env loader (keeps installer independent of dotenv)
  try {
    const envFile = path.join(appBackendDir, ".env");
    if (!fs.existsSync(envFile)) return;
    const raw = fs.readFileSync(envFile, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = String(line || "").trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      if (!key) continue;
      if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let val = trimmed.slice(idx + 1);
      // strip optional quotes
      val = val.replace(/^\s*['"]/, "").replace(/['"]\s*$/, "");
      process.env[key] = val;
    }
  } catch {}
}

function getPgConfig() {
  const url = (process.env.DATABASE_URL || "").trim();
  const base = { connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 };
  if (url) return { connectionString: url, ...base };
  // If DATABASE_URL isn't set, try to mirror the backend's bootstrap fallback.
  // This avoids running migrations against the wrong default database ('postgres').
  try {
    const backendBootstrap = path.join(appBackendDir, "src", "app", "bootstrap.js");
    if (fs.existsSync(backendBootstrap)) {
      const js = fs.readFileSync(backendBootstrap, "utf8");
      const m = js.match(/connectionString\s*:\s*\n?\s*process\.env\.DATABASE_URL\s*\|\|\s*["'`]([^"'`]+)["'`]/m);
      const fallbackUrl = (m && m[1]) ? String(m[1]).trim() : "";
      if (/^postgres(ql)?:\/\//i.test(fallbackUrl)) return { connectionString: fallbackUrl, ...base };
    }
  } catch {}
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "postgres",
    ...base,
  };
}

async function getPgPool() {
  try {
    const pg = await import("pg");
    const { Pool } = pg.default || pg;
    return new Pool(getPgConfig());
  } catch {}
  const pgEsm = path.join(appBackendDir, "node_modules", "pg", "esm", "index.mjs");
  if (!fs.existsSync(pgEsm)) throw new Error("Cannot locate 'pg'. Install it in backend or root.");
  const pg = await import(pathToFileURL(pgEsm).href);
  const { Pool } = pg;
  return new Pool(getPgConfig());
}

async function query(pool, sql, params) { return pool.query(sql, params); }

async function ensureSystemTables(pool) {
  await query(pool, `
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
  await query(pool, `
    CREATE TABLE IF NOT EXISTS migrations_log (
      id SERIAL PRIMARY KEY,
      module_name VARCHAR(255),
      filename VARCHAR(255),
      applied_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_migrations_log UNIQUE(module_name, filename)
    );
  `);
}

async function applyMigrations(pool, migrationsPath, moduleName) {
  const applied = [];
  const skipped = [];
  if (!fs.existsSync(migrationsPath)) return { applied, skipped };
  const files = fs.readdirSync(migrationsPath).filter(f=>f.endsWith('.sql')).sort();
  for (const file of files) {
    const seen = await query(pool, `SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2`, [moduleName, file]);
    if (seen.rows.length) { skipped.push(file); continue; }
    const sql = fs.readFileSync(path.join(migrationsPath, file), 'utf8');
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      await cli.query(sql);
      await cli.query(`INSERT INTO migrations_log (module_name, filename) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [moduleName, file]);
      await cli.query('COMMIT');
      applied.push(file);
    } catch (e) {
      try { await cli.query('ROLLBACK'); } catch {}
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
        // Also annotate the error for upstream handlers
        try { e.message = `${header}: ${msg}`; } catch {}
      } catch {}
      throw e;
    } finally { cli.release(); }
  }
  return { applied, skipped };
}

export async function installModule(opts = {}) {
  const log = typeof opts?.log === "function" ? opts.log : null;
  await loadDotenv();
  try { log?.("Starting installer"); } catch {}
  const pool = await getPgPool();
  const { name = 'mcp2', version = '1.0.0', enabled = true, hooks = {} } = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  await ensureSystemTables(pool);
  const activeVal = enabled ? 1 : 0;
  await query(pool, `
    INSERT INTO modules (name, version, active, install, installed_at, updated_at)
    VALUES ($1,$2,$3,1,NOW(),NOW())
    ON CONFLICT (name) DO UPDATE SET version=$2, active=$3, install=1, updated_at=NOW();
  `, [name, String(version||'0.0.0').slice(0,8), activeVal]);

  const mig = await applyMigrations(pool, migrationsDir, name);
  try { log?.(`Migrations applied=${mig?.applied?.length || 0} skipped=${mig?.skipped?.length || 0}`); } catch {}
  await pool.end().catch(()=>{});
  return { ok: true, module: name, version: String(version || ""), migrations: mig || { applied: [], skipped: [] } };
}

if (import.meta.url === pathToFileURL(__filename).href || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  installModule().catch((err) => { console.error('Installer failed:', err?.message || err); process.exitCode = 1; });
}
