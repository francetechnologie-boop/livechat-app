/**
 * Module Installer (ESM JS)
 * - Registers module in DB (aligned with Module Manager schema)
 * - Inserts declared hooks
 * - Runs all SQL migrations in /db/migrations
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// moduleRoot points to the module folder (modules/<module-id>)
const moduleRoot = path.resolve(__dirname, "..");
const configPath = path.join(moduleRoot, "module.config.json");
const migrationsDir = path.join(moduleRoot, "db", "migrations");
// appBackendDir points to livechat-app/backend for env and dependencies
const appBackendDir = path.resolve(moduleRoot, "..", "..", "backend");

async function loadDotenv() {
  try {
    const dotenvPath = path.join(appBackendDir, "node_modules", "dotenv", "lib", "main.js");
    if (fs.existsSync(dotenvPath)) {
      const dotenv = await import(pathToFileURL(dotenvPath).href);
      dotenv.config?.({ path: path.join(appBackendDir, ".env") });
    }
  } catch {}
}

async function getPgPool() {
  // Try regular import first
  try {
    const pg = await import("pg");
    const { Pool } = pg.default || pg;
    return new Pool(getPgConfig());
  } catch {}

  // Fallback to backend's installed pg ESM entry
  const pgEsm = path.join(appBackendDir, "node_modules", "pg", "esm", "index.mjs");
  if (!fs.existsSync(pgEsm)) {
    throw new Error("Cannot locate 'pg'. Install it in backend or root node_modules.");
  }
  const pg = await import(pathToFileURL(pgEsm).href);
  const { Pool } = pg;
  return new Pool(getPgConfig());
}

function getPgConfig() {
  const url = (process.env.DATABASE_URL || "").trim();
  const base = { connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 };
  if (url) return { connectionString: url, ...base };
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "postgres",
    ...base,
  };
}

async function query(pool, sql, params) {
  return pool.query(sql, params);
}

async function ensureSystemTables(pool) {
  // Do not create legacy 'modules' table here; Module Manager owns module state
  await query(pool, `
    CREATE TABLE IF NOT EXISTS hooks (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE,
      active BOOLEAN DEFAULT TRUE
    );
  `);

  await query(pool, `
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

async function registerHook(pool, moduleName, hookName, callback) {
  await query(
    pool,
    `INSERT INTO hooks (name) VALUES ($1)
     ON CONFLICT (name) DO NOTHING;`,
    [hookName]
  );
  await query(
    pool,
    `INSERT INTO hook_module (hook_id, module_name, callback)
     SELECT h.id, $1, $2 FROM hooks h WHERE h.name=$3
     ON CONFLICT ON CONSTRAINT uq_hook_module DO NOTHING;`,
    [moduleName, callback, hookName]
  );
  console.log(` → Hook '${hookName}' linked to ${moduleName}.${callback}`);
}

async function applyMigrations(pool, migrationsPath, moduleName) {
  if (!fs.existsSync(migrationsPath)) {
    console.log("No migrations folder found.");
    return;
  }
  const files = fs
    .readdirSync(migrationsPath)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const res = await query(
      pool,
      `SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2;`,
      [moduleName, file]
    );
    if (res.rows.length) {
      console.log(` ⏭️  Skipping already applied migration: ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsPath, file), "utf8");
    console.log(` 🚀 Running migration: ${file}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO migrations_log (module_name, filename) VALUES ($1, $2);`,
        [moduleName, file]
      );
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
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
      throw e;
    } finally {
      client.release();
    }
  }
}

export async function installModule() {
  await loadDotenv();
  const pool = await getPgPool();
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const { name, version, hooks = {}, enabled = true } = config;

  console.log(`\n🧩 Installing module: ${name} v${version}`);

  await ensureSystemTables(pool);

  // Skip legacy 'modules' upsert

  for (const [hookName, callback] of Object.entries(hooks)) {
    await registerHook(pool, name, hookName, callback);
  }

  await applyMigrations(pool, migrationsDir, name);

  console.log(`✅ Module '${name}' installed successfully.\n`);
  await pool.end().catch(() => {});
}

// Auto-run if executed directly
if (import.meta.url === pathToFileURL(__filename).href || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  installModule().catch((err) => {
    console.error("Installer failed:", err?.message || err);
    process.exitCode = 1;
  });
}
