function normKey(key) {
  const k = String(key || '').trim();
  if (!k) throw new Error('bad_key');
  return k;
}

let toolsConfigReady = false;
async function ensureModToolsConfigTable(pool) {
  if (!pool || toolsConfigReady) return;
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS public.mod_tools_config (
         id SERIAL PRIMARY KEY,
         org_id INT NULL,
         key VARCHAR(128) NOT NULL,
         value JSONB NULL,
         created_at TIMESTAMP DEFAULT NOW(),
         updated_at TIMESTAMP DEFAULT NOW()
       );`
    );
    // Ensure expected columns exist (best-effort upgrades).
    try { await pool.query(`ALTER TABLE public.mod_tools_config ADD COLUMN IF NOT EXISTS org_id INT NULL;`); } catch {}
    try { await pool.query(`ALTER TABLE public.mod_tools_config ADD COLUMN IF NOT EXISTS key VARCHAR(128) NOT NULL DEFAULT '';`); } catch {}
    try { await pool.query(`ALTER TABLE public.mod_tools_config ADD COLUMN IF NOT EXISTS value JSONB NULL;`); } catch {}
    try { await pool.query(`ALTER TABLE public.mod_tools_config ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`); } catch {}
    try { await pool.query(`ALTER TABLE public.mod_tools_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();`); } catch {}

    // Helpful indexes. Uniqueness is not strictly required (we do manual upsert),
    // but keeping it best-effort helps other tooling.
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_tools_config_org ON public.mod_tools_config(org_id);`); } catch {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_tools_config_key ON public.mod_tools_config(key);`); } catch {}
    try { await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_tools_config_org_key ON public.mod_tools_config(org_id, key);`); } catch {}
  } catch {}

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
            ALTER TABLE public.mod_tools_config
              ADD CONSTRAINT fk_mod_tools_config_org
              FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
          EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
        END IF;
      END $$;
    `);
  } catch {}

  try {
    const r = await pool.query(`SELECT to_regclass('public.mod_tools_config') AS reg`);
    toolsConfigReady = !!(r && r.rows && r.rows[0] && r.rows[0].reg);
  } catch {
    toolsConfigReady = false;
  }
}

export async function loadModToolsConfigRow(pool, key, orgId) {
  if (!pool) return null;
  await ensureModToolsConfigTable(pool);
  if (!toolsConfigReady) throw new Error('db_schema_unavailable');
  const k = normKey(key);
  const args = [k];
  let whereOrg = 'AND org_id IS NULL';
  if (orgId != null) {
    args.push(orgId);
    whereOrg = 'AND (org_id IS NULL OR org_id = $2)';
  }
  const r = await pool.query(
    `
      SELECT id, value, org_id, updated_at
        FROM public.mod_tools_config
       WHERE key = $1
         ${whereOrg}
       ORDER BY (org_id IS NULL)::int, org_id DESC, updated_at DESC NULLS LAST, id DESC
       LIMIT 1
    `,
    args
  );
  return r.rowCount ? r.rows[0] : null;
}

export async function deleteModToolsConfig(pool, key, orgId) {
  if (!pool) return;
  await ensureModToolsConfigTable(pool);
  if (!toolsConfigReady) throw new Error('db_schema_unavailable');
  const k = normKey(key);
  if (orgId == null) {
    await pool.query(`DELETE FROM public.mod_tools_config WHERE key = $1 AND org_id IS NULL`, [k]);
    return;
  }
  await pool.query(`DELETE FROM public.mod_tools_config WHERE key = $1 AND (org_id IS NULL OR org_id = $2)`, [k, orgId]);
}

export async function upsertModToolsConfig(pool, key, value, orgId) {
  if (!pool) return null;
  await ensureModToolsConfigTable(pool);
  if (!toolsConfigReady) throw new Error('db_schema_unavailable');
  const k = normKey(key);

  // NOTE: Postgres UNIQUE(org_id, key) does not treat NULL org_id as a conflict.
  if (orgId == null) {
    const u = await pool.query(
      `UPDATE public.mod_tools_config
          SET value = $1, updated_at = NOW()
        WHERE org_id IS NULL
          AND key = $2`,
      [value, k]
    );
    if (!u.rowCount) {
      await pool.query(
        `INSERT INTO public.mod_tools_config (org_id, key, value)
         VALUES (NULL, $1, $2)`,
        [k, value]
      );
    }
    // Best-effort cleanup of duplicates for NULL org_id
    try {
      await pool.query(
        `DELETE FROM public.mod_tools_config
          WHERE org_id IS NULL
            AND key = $1
            AND id <> (
              SELECT MAX(id) FROM public.mod_tools_config WHERE org_id IS NULL AND key = $1
            )`,
        [k]
      );
    } catch {}
    return loadModToolsConfigRow(pool, k, null);
  }

  // Manual upsert to stay compatible even if the UNIQUE(org_id,key) constraint is missing.
  const u = await pool.query(
    `UPDATE public.mod_tools_config
        SET value=$1, updated_at=NOW()
      WHERE org_id=$2 AND key=$3`,
    [value, orgId, k]
  );
  if (!u.rowCount) {
    await pool.query(
      `INSERT INTO public.mod_tools_config (org_id, key, value)
       VALUES ($1, $2, $3)`,
      [orgId, k, value]
    );
  }
  // Best-effort cleanup of duplicates for org_id/key
  try {
    await pool.query(
      `DELETE FROM public.mod_tools_config
        WHERE org_id=$1 AND key=$2
          AND id <> (
            SELECT MAX(id) FROM public.mod_tools_config WHERE org_id=$1 AND key=$2
          )`,
      [orgId, k]
    );
  } catch {}
  return loadModToolsConfigRow(pool, k, orgId);
}
