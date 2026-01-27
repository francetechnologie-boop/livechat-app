function normKey(key) {
  const k = String(key || '').trim();
  if (!k) throw new Error('bad_key');
  return k;
}

export async function loadModToolsConfigRow(pool, key, orgId) {
  if (!pool) return null;
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
        FROM mod_tools_config
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
  const k = normKey(key);
  if (orgId == null) {
    await pool.query(`DELETE FROM mod_tools_config WHERE key = $1 AND org_id IS NULL`, [k]);
    return;
  }
  await pool.query(`DELETE FROM mod_tools_config WHERE key = $1 AND (org_id IS NULL OR org_id = $2)`, [k, orgId]);
}

export async function upsertModToolsConfig(pool, key, value, orgId) {
  if (!pool) return null;
  const k = normKey(key);

  // NOTE: Postgres UNIQUE(org_id, key) does not treat NULL org_id as a conflict.
  if (orgId == null) {
    const u = await pool.query(
      `UPDATE mod_tools_config
          SET value = $1, updated_at = NOW()
        WHERE org_id IS NULL
          AND key = $2`,
      [value, k]
    );
    if (!u.rowCount) {
      await pool.query(
        `INSERT INTO mod_tools_config (org_id, key, value)
         VALUES (NULL, $1, $2)`,
        [k, value]
      );
    }
    // Best-effort cleanup of duplicates for NULL org_id
    try {
      await pool.query(
        `DELETE FROM mod_tools_config
          WHERE org_id IS NULL
            AND key = $1
            AND id <> (
              SELECT MAX(id) FROM mod_tools_config WHERE org_id IS NULL AND key = $1
            )`,
        [k]
      );
    } catch {}
    return loadModToolsConfigRow(pool, k, null);
  }

  await pool.query(
    `
      INSERT INTO mod_tools_config (org_id, key, value)
      VALUES ($1, $2, $3)
      ON CONFLICT (org_id, key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    `,
    [orgId, k, value]
  );
  return loadModToolsConfigRow(pool, k, orgId);
}

