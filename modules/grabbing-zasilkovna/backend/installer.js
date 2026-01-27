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
  if (!fs.existsSync(pgEsm)) throw new Error("Cannot locate 'pg' ESM entry");
  const pg = await import(pathToFileURL(pgEsm).href);
  const { Pool } = pg;
  return new Pool(getPgConfig());
}

async function applyMigrations(pool, migrationsPath, moduleName) {
  if (!fs.existsSync(migrationsPath)) return;
  const files = fs.readdirSync(migrationsPath).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const seen = await pool.query(`SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2;`, [moduleName, file]).catch(()=>({rows:[]}));
    if (seen.rows?.length) continue;
    const sql = fs.readFileSync(path.join(migrationsPath, file), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query(`INSERT INTO migrations_log (module_name, filename) VALUES ($1, $2);`, [moduleName, file]);
      await c.query('COMMIT');
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch {}
      throw e;
    } finally { c.release(); }
  }
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
    CREATE TABLE IF NOT EXISTS migrations_log (
      id SERIAL PRIMARY KEY,
      module_name VARCHAR(255),
      filename VARCHAR(255),
      applied_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_migrations_log UNIQUE(module_name, filename)
    );
  `);
}

export async function installModule() {
  if (/^(1|true|yes)$/i.test(String(process.env.GRABBING_ZASILKOVNA_INSTALL_DISABLE||''))) return;
  await loadDotenv();
  const pool = await getPgPool();
  await ensureSystemTables(pool);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const name = String(config.name || 'grabbing-zasilkovna');
  const version = String(config.version || '1.0.0').slice(0, 8);
  await pool.query(`INSERT INTO modules(name, version, active, install, installed_at, updated_at)
                    VALUES ($1,$2,1,1,NOW(),NOW())
                    ON CONFLICT (name) DO UPDATE SET version=$2, active=1, install=1, updated_at=NOW();`, [name, version]);
  await applyMigrations(pool, migrationsDir, name).catch(()=>{});
  await pool.end().catch(()=>{});
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  installModule().catch((e)=>{ console.error(e?.stack||e); process.exit(1); });
}

