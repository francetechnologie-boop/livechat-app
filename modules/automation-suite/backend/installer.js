/**
 * Automation Suite Module Installer
 * - Applies SQL migrations under modules/automation-suite/db/migrations
 * - Tracks applied migrations in public.migrations_log (module-scoped)
 *
 * NOTE: Migration files follow an `-- up` / `-- down` convention.
 * This installer executes only the `-- up` section (or the entire file if no markers exist).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const moduleRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(moduleRoot, "db", "migrations");
const appBackendDir = path.resolve(moduleRoot, "..", "..", "backend");
const MODULE_NAME = "automation-suite";

function splitUpSql(sqlText) {
  const sql = String(sqlText || "");
  const upIdx = sql.search(/^\s*--\s*up\b/im);
  const downIdx = sql.search(/^\s*--\s*down\b/im);
  if (upIdx >= 0 && downIdx > upIdx) {
    return sql.slice(upIdx).replace(/^\s*--\s*up\b/im, "").slice(0, downIdx - upIdx).trim();
  }
  if (upIdx >= 0) {
    return sql.slice(upIdx).replace(/^\s*--\s*up\b/im, "").trim();
  }
  // No markers → treat whole file as up.
  return sql.trim();
}

async function loadDotenv() {
  try {
    const dotenvPath = path.join(appBackendDir, "node_modules", "dotenv", "lib", "main.js");
    if (fs.existsSync(dotenvPath)) {
      const dotenv = await import(pathToFileURL(dotenvPath).href);
      dotenv.config?.({ path: path.join(appBackendDir, ".env") });
    }
  } catch {}
}

function getPgConfig() {
  const url = (process.env.DATABASE_URL || "").trim();
  const base = { connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 };
  if (url) return { connectionString: url, ...base };
  // Match backend bootstrap fallback when DATABASE_URL is missing.
  try {
    const backendBootstrap = path.join(appBackendDir, "src", "app", "bootstrap.js");
    if (fs.existsSync(backendBootstrap)) {
      const js = fs.readFileSync(backendBootstrap, "utf8");
      const m = js.match(/connectionString\\s*:\\s*\\n?\\s*process\\.env\\.DATABASE_URL\\s*\\|\\|\\s*[\"'`]([^\"'`]+)[\"'`]/m);
      const fallbackUrl = (m && m[1]) ? String(m[1]).trim() : "";
      const lower = fallbackUrl.toLowerCase();
      if (lower.startsWith("postgres://") || lower.startsWith("postgresql://")) {
        return { connectionString: fallbackUrl, ...base };
      }
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

async function applyMigrations(pool) {
  if (!fs.existsSync(migrationsDir)) return;
  await ensureMigrationsLog(pool);
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const seen = await pool.query(`SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2 LIMIT 1`, [MODULE_NAME, file]);
    if (seen.rowCount) continue;
    const raw = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const upSql = splitUpSql(raw);
    if (!upSql) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(upSql);
      await client.query(`INSERT INTO migrations_log (module_name, filename) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [MODULE_NAME, file]);
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      const msg = e?.message || String(e);
      console.error(`[installer] ${MODULE_NAME} migration failed: ${file}: ${msg}`);
      throw e;
    } finally {
      client.release();
    }
  }
}

export async function onModuleLoaded(ctx = {}) {
  const pool = ctx?.pool;
  if (!pool) return;
  await applyMigrations(pool);
}

export async function onModuleDisabled() { /* no-op */ }

export async function installModule() {
  await loadDotenv();
  const pool = await getPgPool();
  try {
    await applyMigrations(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(__filename).href || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  installModule().catch((err) => { console.error("Installer failed:", err?.message || err); process.exitCode = 1; });
}
