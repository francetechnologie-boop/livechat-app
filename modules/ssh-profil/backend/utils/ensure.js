export function getTableNameProfiles() {
  return 'public.mod_ssh_profil_profiles';
}

export async function ensureProfilesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mod_ssh_profil_profiles (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NULL,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      key_path TEXT NULL,
      password_enc TEXT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Non-breaking additions for older installs
  try { await pool.query(`ALTER TABLE public.mod_ssh_profil_profiles ADD COLUMN IF NOT EXISTS org_id INTEGER NULL;`); } catch {}
  try { await pool.query(`ALTER TABLE public.mod_ssh_profil_profiles ADD COLUMN IF NOT EXISTS key_path TEXT NULL;`); } catch {}
  try { await pool.query(`ALTER TABLE public.mod_ssh_profil_profiles ADD COLUMN IF NOT EXISTS password_enc TEXT NULL;`); } catch {}
  try { await pool.query(`ALTER TABLE public.mod_ssh_profil_profiles ADD COLUMN IF NOT EXISTS port INTEGER DEFAULT 22;`); } catch {}
  try { await pool.query(`ALTER TABLE public.mod_ssh_profil_profiles ADD COLUMN IF NOT EXISTS username TEXT;`); } catch {}
  try { await pool.query(`ALTER TABLE public.mod_ssh_profil_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`); } catch {}
  try { await pool.query(`ALTER TABLE public.mod_ssh_profil_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();`); } catch {}

  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_ssh_profil_profiles_org_id ON public.mod_ssh_profil_profiles(org_id);`); } catch {}

  // Guarded FK to organizations(id)
  try {
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
            ALTER TABLE public.mod_ssh_profil_profiles
              ADD CONSTRAINT fk_ssh_profil_org
              FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
          EXCEPTION
            WHEN duplicate_object THEN NULL;
            WHEN others THEN NULL;
          END;
        END IF;
      END $$;
    `);
  } catch {}
}

