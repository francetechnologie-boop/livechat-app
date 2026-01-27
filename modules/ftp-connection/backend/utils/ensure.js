export function getTableNameProfiles() {
  return 'public.mod_ftp_connection_profiles';
}

export async function ensureProfilesTable(pool) {
  if (!pool || typeof pool.query !== 'function') return;
  // Create table if missing
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${getTableNameProfiles()} (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 21,
      protocol TEXT DEFAULT 'ftp', -- ftp | sftp
      username TEXT,
      password TEXT,
      base_path TEXT DEFAULT '/',
      passive BOOLEAN DEFAULT TRUE,
      org_id INTEGER NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Guarded FK to organizations(id)
  await pool.query(`
  DO $$ BEGIN
    IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
       WHERE n.nspname = 'public' AND t.relname = 'organizations'
         AND i.indisunique = TRUE
         AND array_length(i.indkey,1) = 1
         AND a.attname = 'id'
    ) THEN
      BEGIN
        ALTER TABLE ${getTableNameProfiles()}
          ADD CONSTRAINT fk_ftp_conn_org
          FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN others THEN NULL;
      END;
    END IF;
  END $$;`);
}

