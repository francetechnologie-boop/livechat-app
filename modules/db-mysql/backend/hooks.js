import fs from 'fs';
import path from 'path';

export async function onModuleLoaded(ctx = {}) {
  const pool = ctx?.pool;
  if (!pool) return;
  try {
    const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../db/migrations');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.sql$/i.test(f)).sort() : [];
    for (const f of files) {
      try {
        const sql = fs.readFileSync(path.join(dir, f), 'utf8');
        if (sql && sql.trim()) await pool.query(sql);
      } catch {}
    }
  } catch {}
}

export async function onModuleDisabled() { /* no-op */ }

