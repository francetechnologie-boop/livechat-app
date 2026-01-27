// MySQL helpers for Grabbing-Jerome transfer
// Provides lightweight wrappers to acquire mysql2/promise and common helpers.

export async function getMysql2FromCtx(ctx = {}) {
  // Try dynamic import first; then fallback to backend-local require via helper
  try {
    const mod = await import('mysql2/promise');
    return mod?.default || mod;
  } catch (_) {}
  try {
    const mod = await import('../../db-mysql/backend/utils/mysql2.js');
    const mysql = await mod.getMysql2(ctx);
    return mysql?.default || mysql;
  } catch (e) {
    const err = new Error('mysql2_missing');
    err.code = 'MYSQL2_MISSING';
    throw err;
  }
}

export async function connectMySql(ctx, cfg) {
  const mysql = await getMysql2FromCtx(ctx);
  const conn = await mysql.createConnection(cfg);
  return conn;
}

export function makeSqlHelpers(conn) {
  const q = async (sql, args = []) => {
    const [rows] = await conn.query(sql, args);
    return rows;
  };
  const qi = (ident) => '`' + String(ident || '').replace(/`/g, '``') + '`';
  const hasTable = async (name, dbName) => {
    try {
      const rows = await q('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1', [dbName, name]);
      return Array.isArray(rows) && rows.length > 0;
    } catch { return false; }
  };
  const hasColumn = async (table, col, dbName) => {
    try {
      const rows = await q('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1', [dbName, table, col]);
      return Array.isArray(rows) && rows.length > 0;
    } catch { return false; }
  };
  return { q, qi, hasTable, hasColumn };
}

