import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moduleRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(moduleRoot, 'db', 'migrations');

async function getPgPool() {
  try {
    const pg = await import('pg');
    const { Pool } = pg.default || pg;
    const url = (process.env.DATABASE_URL || '').trim();
    let cfg = null;
    if (url) cfg = { connectionString: url };
    if (!cfg) cfg = {
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'postgres',
    };
    return new Pool({ ...cfg, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
  } catch {
    const backendDir = path.resolve(moduleRoot, '..', '..', 'backend');
    const alt = path.join(backendDir, 'node_modules', 'pg', 'esm', 'index.mjs');
    const mod = await import(pathToFileURL(alt).href);
    const { Pool } = mod;
    return new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
  }
}

async function ensureSystem(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS migrations_log (id SERIAL PRIMARY KEY, module_name VARCHAR(255), filename VARCHAR(255), applied_at TIMESTAMP DEFAULT NOW(), CONSTRAINT uq_migrations_log UNIQUE(module_name, filename));`);
}

export async function installModule() {
  const pool = await getPgPool();
  await ensureSystem(pool);
  const moduleId = path.basename(moduleRoot);
  if (!fs.existsSync(migrationsDir)) { await pool.end().catch(() => {}); return; }
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const seen = await pool.query(`SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2`, [moduleId, file]);
    if (seen.rows.length) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      await cli.query(sql);
      await cli.query(`INSERT INTO migrations_log (module_name, filename) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [moduleId, file]);
      await cli.query('COMMIT');
    } catch (e) {
      try { await cli.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      cli.release();
    }
  }
  await pool.end().catch(() => {});
}

if (import.meta.url === pathToFileURL(__filename).href || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  installModule().catch((err) => { console.error('Installer failed:', err?.message || err); process.exitCode = 1; });
}

