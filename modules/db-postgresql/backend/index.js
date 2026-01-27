import { registerDbPostgresqlRoutes } from './routes/db-postgresql.routes.js';

async function ensureTables(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mod_db_postgresql_profiles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      host VARCHAR(255) NOT NULL,
      port INTEGER NOT NULL DEFAULT 5432,
      database VARCHAR(255) NOT NULL,
      db_user VARCHAR(255) NOT NULL,
      db_password TEXT NULL,
      ssl BOOLEAN NOT NULL DEFAULT FALSE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      table_prefixes TEXT NULL,
      org_id TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_db_postgres_profiles_org ON mod_db_postgresql_profiles(org_id);
    ALTER TABLE mod_db_postgresql_profiles
      ADD COLUMN IF NOT EXISTS table_prefixes TEXT NULL;
  `);
}

async function reportModuleStatus(pool, ok, message) {
  if (!pool) return;
  try { await pool.query("ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS schema_ok BOOLEAN NULL"); } catch {}
  try { await pool.query("ALTER TABLE mod_module_manager_modules ADD COLUMN IF NOT EXISTS install_error TEXT NULL"); } catch {}
  try { await pool.query("INSERT INTO mod_module_manager_modules (module_name, version, active, install, installed_at, updated_at) VALUES ($1,$2,TRUE,TRUE,NOW(),NOW()) ON CONFLICT (module_name) DO UPDATE SET updated_at=NOW()", ['db-postgresql','1.0.0']); } catch {}
  const err = ok ? null : (message ? String(message).slice(0,2000) : 'schema_failed');
  try { await pool.query("UPDATE mod_module_manager_modules SET schema_ok=$1, install_error=$2, updated_at=NOW() WHERE module_name=$3", [ ok===null? null : !!ok, err, 'db-postgresql' ]); } catch {}
}

export function register(app, ctx) {
  const json = ctx.expressJson || ((opts)=> (req,res,next)=> next());
  app.use('/api/db-postgresql', json({ limit: process.env.API_JSON_LIMIT || '50mb', strict: false }));
  // On module load, ensure schema and report status
  (async () => {
    try { await ensureTables(ctx.pool); await reportModuleStatus(ctx.pool, true, null); }
    catch (e) { await reportModuleStatus(ctx.pool, false, e?.message || String(e)); }
  })();
  registerDbPostgresqlRoutes(app, ctx);
}
