export function getCommandsTableName() {
  return 'public.mod_security_commands';
}

export async function ensureCommandsTable(pool) {
  if (!pool || typeof pool.query !== 'function') return;
  const table = getCommandsTableName();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NULL,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_security_commands_org
      ON ${table} (org_id, name)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_security_commands_global
      ON ${table} (name)
      WHERE org_id IS NULL
  `);

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
          ALTER TABLE ${table}
            ADD CONSTRAINT fk_security_commands_org
            FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
          WHEN others THEN NULL;
        END;
      END IF;
    END $$;
  `);
}
