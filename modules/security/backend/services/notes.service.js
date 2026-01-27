import { ensureNotesTable as ensureNotesTableImpl } from '../utils/ensure.js';

export async function ensureNotesTable(pool) {
  await ensureNotesTableImpl(pool);
}

export async function getTabNote(pool, { tab, orgId }) {
  if (!pool) return '';
  const table = 'public.mod_security_notes';
  const q = orgId == null
    ? `SELECT note FROM ${table} WHERE org_id IS NULL AND tab = $1 LIMIT 1`
    : `SELECT note FROM ${table} WHERE org_id = $1 AND tab = $2 LIMIT 1`;
  const params = orgId == null ? [tab] : [orgId, tab];
  const r = await pool.query(q, params);
  return r?.rows?.[0]?.note || '';
}

export async function upsertTabNote(pool, { tab, orgId, note }) {
  if (!pool) return { note: '' };
  const table = 'public.mod_security_notes';
  if (orgId == null) {
    const r = await pool.query(
      `INSERT INTO ${table} (org_id, tab, note, created_at, updated_at)
       VALUES (NULL, $1, $2, NOW(), NOW())
       ON CONFLICT (tab) WHERE (org_id IS NULL)
       DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()
       RETURNING note`,
      [tab, note]
    );
    return r?.rows?.[0] || { note };
  }
  const r = await pool.query(
    `INSERT INTO ${table} (org_id, tab, note, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (org_id, tab) WHERE (org_id IS NOT NULL)
     DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()
     RETURNING note`,
    [orgId, tab, note]
  );
  return r?.rows?.[0] || { note };
}
