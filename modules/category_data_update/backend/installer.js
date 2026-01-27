import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const moduleRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(moduleRoot, 'db', 'migrations');

async function getPgPool() {
  try {
    const pg = await import('pg');
    const { Pool } = pg.default || pg;
    const url = (process.env.DATABASE_URL||'').trim();
    const cfg = url ? { connectionString: url } : {
      host: process.env.PGHOST || '127.0.0.1',
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'postgres'
    };
    return new Pool({ ...cfg, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000 });
  } catch (e) {
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

async function ensureModulesTable(pool) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_module_manager_modules (
        id_module SERIAL PRIMARY KEY,
        module_name TEXT UNIQUE,
        version VARCHAR(16),
        active SMALLINT NOT NULL DEFAULT 1,
        install SMALLINT NOT NULL DEFAULT 1,
        installed_at TIMESTAMP NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        has_mcp_tool SMALLINT NOT NULL DEFAULT 0,
        has_profil SMALLINT NOT NULL DEFAULT 0,
        mcp_tools JSONB NULL,
        schema_ok BOOLEAN NULL,
        install_error TEXT NULL
      )`);
  } catch {}
  try { await pool.query('ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS schema_ok BOOLEAN NULL'); } catch {}
  try { await pool.query('ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS install_error TEXT NULL'); } catch {}
}

async function detectModulesColumnTypes(pool) {
  try {
    const r = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'mod_module_manager_modules'
         AND column_name IN ('active','install','has_mcp_tool','has_profil','schema_ok','install_error')
    `);
    const types = Object.fromEntries(r.rows.map(x => [x.column_name, x.data_type]));
    return {
      active: types.active === 'boolean' ? 'boolean' : 'smallint',
      install: types.install === 'boolean' ? 'boolean' : 'smallint',
      has_mcp_tool: types.has_mcp_tool === 'boolean' ? 'boolean' : 'smallint',
      has_profil: types.has_profil === 'boolean' ? 'boolean' : 'smallint',
    };
  } catch {
    return { active: 'smallint', install: 'smallint', has_mcp_tool: 'smallint', has_profil: 'smallint' };
  }
}

async function upsertModuleState(pool, opts = {}) {
  const name = 'category_data_update';
  await ensureModulesTable(pool);
  const types = await detectModulesColumnTypes(pool);
  const version = opts.version || '1.0.0';
  const active = opts.active == null ? true : !!opts.active;
  const install = opts.install == null ? true : !!opts.install;
  const hasMcp = false, hasProfil = false;
  const params = [name, version, active, install, hasMcp, hasProfil, null];
  const useBoolActive = types.active === 'boolean';
  const useBoolInstall = types.install === 'boolean';
  const useBoolHasMcp = types.has_mcp_tool === 'boolean';
  const useBoolHasProfil = types.has_profil === 'boolean';
  const activeExpr = useBoolActive ? '(SELECT active_b FROM __vals)' : '(CASE WHEN (SELECT active_b FROM __vals) THEN 1 ELSE 0 END)';
  const installExpr = useBoolInstall ? '(SELECT install_b FROM __vals)' : '(CASE WHEN (SELECT install_b FROM __vals) THEN 1 ELSE 0 END)';
  const hasMcpExpr = useBoolHasMcp ? '(SELECT has_mcp_b FROM __vals)' : '(CASE WHEN (SELECT has_mcp_b FROM __vals) THEN 1 ELSE 0 END)';
  const hasProfilExpr = useBoolHasProfil ? '(SELECT has_profil_b FROM __vals)' : '(CASE WHEN (SELECT has_profil_b FROM __vals) THEN 1 ELSE 0 END)';
  const installedAtInsert = `CASE WHEN (SELECT install_b FROM __vals) THEN NOW() ELSE NULL END`;
  const installedAtUpdate = useBoolInstall
    ? `CASE
         WHEN mod_module_manager_modules.install = FALSE AND EXCLUDED.install = TRUE THEN NOW()
         WHEN EXCLUDED.install = FALSE THEN mod_module_manager_modules.installed_at
         ELSE COALESCE(mod_module_manager_modules.installed_at, NOW())
       END`
    : `CASE
         WHEN mod_module_manager_modules.install = 0 AND EXCLUDED.install = 1 THEN NOW()
         WHEN EXCLUDED.install = 0 THEN mod_module_manager_modules.installed_at
         ELSE COALESCE(mod_module_manager_modules.installed_at, NOW())
       END`;
  const sql = `
    WITH __vals AS (
      SELECT $3::boolean AS active_b,
             $4::boolean AS install_b,
             $5::boolean AS has_mcp_b,
             $6::boolean AS has_profil_b,
             $7::jsonb    AS mcp_tools_j
    )
    INSERT INTO mod_module_manager_modules (module_name, version, active, install, has_mcp_tool, has_profil, mcp_tools, installed_at, updated_at)
    VALUES ($1, $2, ${activeExpr}, ${installExpr}, ${hasMcpExpr}, ${hasProfilExpr}, (SELECT mcp_tools_j FROM __vals), ${installedAtInsert}, NOW())
    ON CONFLICT (module_name) DO UPDATE SET
      version = EXCLUDED.version,
      active = EXCLUDED.active,
      install = EXCLUDED.install,
      has_mcp_tool = EXCLUDED.has_mcp_tool,
      has_profil = EXCLUDED.has_profil,
      mcp_tools = EXCLUDED.mcp_tools,
      installed_at = ${installedAtUpdate},
      updated_at = NOW()
  `;
  await pool.query(sql, params);
  try { await pool.query(`UPDATE mod_module_manager_modules SET schema_ok=$1, install_error=NULL, updated_at=NOW() WHERE module_name=$2`, [true, name]); } catch {}
}

export async function installModule() {
  const pool = await getPgPool();
  await ensureSystem(pool);
  if (!fs.existsSync(migrationsDir)) { await pool.end().catch(()=>{}); return; }
  const files = fs.readdirSync(migrationsDir).filter(f=>f.endsWith('.sql')).sort();
  for (const file of files) {
    const seen = await pool.query(`SELECT 1 FROM migrations_log WHERE module_name=$1 AND filename=$2`, ['category_data_update', file]);
    if (seen.rows.length) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      await cli.query(sql);
      await cli.query(`INSERT INTO migrations_log (module_name, filename) VALUES ($1,$2) ON CONFLICT DO NOTHING`, ['category_data_update', file]);
      await cli.query('COMMIT');
    } catch (e) {
      try { await cli.query('ROLLBACK'); } catch (e2) {}
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
        const header = `[installer] category_data_update migration failed: ${file}`;
        console.error(header);
        console.error(`error: ${msg}${pos ? ` (position ${pos})` : ''}`);
        if (dbg) {
          console.error('--- SQL snippet ---');
          console.error(snippet);
          if (pointer) console.error(pointer);
          console.error('-------------------');
        }
        try { e.message = `${header}: ${msg}`; } catch (e2) {}
      } catch (e3) {}
      throw e;
    }
    finally { cli.release(); }
  }
  try { await upsertModuleState(pool, { active: true, install: true, version: '1.0.0' }); } catch {}
  await pool.end().catch(()=>{});
}

if (import.meta.url === pathToFileURL(__filename).href || (process.argv[1] && path.resolve(process.argv[1]) === __filename)) {
  installModule().catch((err) => { console.error('Installer failed:', err?.message || err); process.exitCode = 1; });
}
