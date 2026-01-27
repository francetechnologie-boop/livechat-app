/**
 * Module Installer (TypeScript)
 * - Registers module in DB (aligned with Module Manager schema)
 * - Inserts declared hooks
 * - Runs all SQL migrations in /db/migrations
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

type Pool = import("pg").Pool;

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// moduleRoot points to the module folder (modules/<module-id>)
const moduleRoot = path.resolve(__dirname, "..");
const configPath = path.join(moduleRoot, "module.config.json");
const migrationsDir = path.join(moduleRoot, "db", "migrations");
// appBackendDir points to livechat-app/backend for env and dependencies
const backendDir = path.resolve(moduleRoot, "..", "..", "backend");

interface HookMap {
  [name: string]: string;
}

async function loadDotenv(): Promise<void> {
  try {
    const dotenvPath = path.join(backendDir, "node_modules", "dotenv", "lib", "main.js");
    if (fs.existsSync(dotenvPath)) {
      const mod = await import(pathToFileURL(dotenvPath).href);
      (mod as any).config?.({ path: path.join(backendDir, ".env") });
    }
  } catch {}
}

function getPgConfig(): any {
  const url = (process.env.DATABASE_URL || "").trim();
  const base = { connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 } as const;
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

async function getPgPool(): Promise<Pool> {
  try {
    const pg = await import("pg");
    const { Pool } = (pg as any).default || (pg as any);
    return new Pool(getPgConfig());
  } catch {}

  const pgEsm = path.join(backendDir, "node_modules", "pg", "esm", "index.mjs");
  if (!fs.existsSync(pgEsm)) {
    throw new Error("Cannot locate 'pg'. Install it in backend or root node_modules.");
  }
  const pg = await import(pathToFileURL(pgEsm).href);
  const { Pool } = pg as any;
  return new Pool(getPgConfig());
}

async function ensureSystemTables(pool: Pool): Promise<void> {
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

async function registerHook(pool: Pool, moduleName: string, hookName: string, callback: string): Promise<void> {
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
  console.log(` → Hook '${hookName}' linked to ${moduleName}.${callback}`);
}

async function applyMigrations(pool: Pool, migrationsPath: string, moduleName: string): Promise<void> {
  if (!fs.existsSync(migrationsPath)) {
    console.log("No migrations folder found.");
    return;
  }
  const files = fs
    .readdirSync(migrationsPath)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const res = await pool.query(
      `SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2;`,
      [moduleName, file]
    );
    if (res.rows.length) {
      console.log(` ⏭️  Skipping already applied migration: ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsPath, file), "utf8");
    console.log(` 🚀 Running migration: ${file}`);
    const client = await (pool as any).connect();
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
      throw e;
    } finally {
      client.release();
    }
  }
}

export async function installModule(): Promise<void> {
  await loadDotenv();
  const pool = await getPgPool();
  const configRaw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(configRaw) as { name: string; version: string; hooks?: HookMap; enabled?: boolean };
  const { name, version, hooks = {}, enabled = true } = parsed;

  console.log(`\n🧩 Installing module: ${name} v${version}`);

  await ensureSystemTables(pool);

  const activeVal = enabled ? 1 : 0;
  await pool.query(
    `INSERT INTO modules (name, version, active, install, installed_at, updated_at)
     VALUES ($1, $2, $3, 1, NOW(), NOW())
     ON CONFLICT (name) DO UPDATE SET version=$2, active=$3, install=1, updated_at=NOW();`,
    [name, String(version || "0.0.0").slice(0, 8), activeVal]
  );

  for (const [hookName, callback] of Object.entries(hooks)) {
    await registerHook(pool, name, hookName, callback);
  }

  await applyMigrations(pool, migrationsDir, name);

  console.log(`✅ Module '${name}' installed successfully.`);
  await (pool as any).end?.().catch?.(() => {});
}

if (import.meta.url === pathToFileURL(new URL(import.meta.url).pathname).href || (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname)) {
  installModule().catch((err) => {
    console.error("Installer failed:", (err as any)?.message || err);
    process.exitCode = 1;
  });
}
