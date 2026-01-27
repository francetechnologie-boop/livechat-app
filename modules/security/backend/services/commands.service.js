import { ensureCommandsTable as ensureCommandsTableImpl } from '../utils/commands.ensure.js';

export async function ensureCommandsTable(pool) {
  await ensureCommandsTableImpl(pool);
}

function buildOrgWhere(orgId) {
  if (orgId == null) {
    return { clause: 'org_id IS NULL', params: [] };
  }
  return { clause: 'org_id = $1', params: [orgId] };
}

export async function listCommands(pool, { orgId = null } = {}) {
  if (!pool) return [];
  const table = 'public.mod_security_commands';
  const { clause, params } = buildOrgWhere(orgId);
  const query = `
    SELECT id, org_id, name, command, created_at, updated_at
      FROM ${table}
     WHERE ${clause}
     ORDER BY updated_at DESC
  `;
  const r = await pool.query(query, params);
  return r.rows || [];
}

export async function findCommand(pool, { orgId = null, name, id = null }) {
  if (!pool) return null;
  const table = 'public.mod_security_commands';
  const filters = [];
  const params = [];
  if (id != null) { filters.push(`id = $${params.length + 1}`); params.push(id); }
  if (name != null) { filters.push(`name = $${params.length + 1}`); params.push(name); }
  if (orgId == null) filters.push('org_id IS NULL');
  else { filters.push(`org_id = $${params.length + 1}`); params.push(orgId); }
  if (!filters.length) return null;
  const query = `SELECT id, org_id, name, command, created_at, updated_at FROM ${table} WHERE ${filters.join(' AND ')} LIMIT 1`;
  const r = await pool.query(query, params);
  return r.rows?.[0] || null;
}

export async function createCommand(pool, { orgId = null, name, command }) {
  if (!pool || !name || !command) return null;
  await ensureCommandsTable(pool);
  const existing = await findCommand(pool, { orgId, name });
  if (existing) {
    return updateCommand(pool, { id: existing.id, orgId, command });
  }
  const table = 'public.mod_security_commands';
  const params = orgId == null ? [name, command] : [orgId, name, command];
  const sql = orgId == null
    ? `INSERT INTO ${table} (org_id, name, command, created_at, updated_at) VALUES (NULL, $1, $2, NOW(), NOW()) RETURNING id, org_id, name, command, created_at, updated_at`
    : `INSERT INTO ${table} (org_id, name, command, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id, org_id, name, command, created_at, updated_at`;
  const r = await pool.query(sql, params);
  return r.rows?.[0] || null;
}

export async function updateCommand(pool, { id, orgId = null, name, command }) {
  if (!pool || !id) return null;
  const setParts = [];
  const params = [];
  if (name != null) { setParts.push(`name = $${params.length + 1}`); params.push(name); }
  if (command != null) { setParts.push(`command = $${params.length + 1}`); params.push(command); }
  if (!setParts.length) return null;
  params.push(id);
  const idIndex = params.length;
  let where = `id = $${idIndex}`;
  if (orgId == null) {
    where += ' AND org_id IS NULL';
  } else {
    params.push(orgId);
    where += ` AND org_id = $${params.length}`;
  }
  const table = 'public.mod_security_commands';
  const r = await pool.query(
    `UPDATE ${table}
       SET ${setParts.join(', ')}, updated_at = NOW()
     WHERE ${where}
     RETURNING id, org_id, name, command, created_at, updated_at`,
    params
  );
  return r.rows?.[0] || null;
}

export async function deleteCommand(pool, { id, orgId = null }) {
  if (!pool || !id) return false;
  const params = [id];
  let where = 'id = $1';
  if (orgId == null) {
    where += ' AND org_id IS NULL';
  } else {
    params.push(orgId);
    where += ` AND org_id = $${params.length}`;
  }
  const table = 'public.mod_security_commands';
  await pool.query(`DELETE FROM ${table} WHERE ${where}`, params);
  return true;
}
