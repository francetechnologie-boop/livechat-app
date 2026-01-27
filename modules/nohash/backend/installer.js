import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moduleRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(moduleRoot, 'db', 'migrations');

async function getPgPool(ctx) {
  if (ctx?.pool && typeof ctx.pool.query === 'function') return ctx.pool;
  // Fallback: try backend node_modules/pg (same approach as grabbing installer)
  try {
    const appBackendDir = path.resolve(moduleRoot, '..', '..', 'backend');
    const pgEsm = path.join(appBackendDir, 'node_modules', 'pg', 'esm', 'index.mjs');
    if (fs.existsSync(pgEsm)) {
      const pg = await import(pathToFileURL(pgEsm).href);
      const { Pool } = pg;
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        database: process.env.PGDATABASE || 'postgres',
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 30000,
      });
      return pool;
    }
  } catch {}
  throw new Error('nohash: cannot acquire pg pool');
}

async function ensureMigrationsLog(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations_log (
      id SERIAL PRIMARY KEY,
      module_name VARCHAR(255),
      filename VARCHAR(255),
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_migrations_log UNIQUE(module_name, filename)
    );
  `);
}

export async function installModule(ctx = {}) {
  if (/^(1|true|yes)$/i.test(String(process.env.NOHASH_INSTALL_DISABLE||'')).valueOf()) return;
  const pool = await getPgPool(ctx).catch(() => null);
  if (!pool) return;
  await ensureMigrationsLog(pool);
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
    : [];
  for (const file of files) {
    const seen = await pool.query(`SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2`, ['nohash', file]);
    if (seen.rowCount) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(` 🚀 Running migration: ${file}`);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query(`INSERT INTO migrations_log (module_name, filename) VALUES ($1,$2)`, ['nohash', file]);
      await c.query('COMMIT');
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch {}
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
        const header = `[installer] nohash migration failed: ${file}`;
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
      c.release();
    }
  }
  try { await pool.end(); } catch {}
}
