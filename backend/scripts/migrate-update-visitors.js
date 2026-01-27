#!/usr/bin/env node
// Ensure critical columns on visitors table exist (title, chatbot_id, page_url_last)
// Usage: node backend/scripts/migrate-update-visitors.js

import { createPool } from "../src/infrastructure/database/index.js";

async function main() {
  const pool = await createPool();
  const q = async (sql) => {
    try { await pool.query(sql); return true; } catch (e) { return false; }
  };
  const stmts = [
    "ALTER TABLE visitors ADD COLUMN IF NOT EXISTS title TEXT",
    "ALTER TABLE visitors ADD COLUMN IF NOT EXISTS page_url_last TEXT",
    "ALTER TABLE visitors ADD COLUMN IF NOT EXISTS chatbot_id TEXT",
  ];
  let ok = 0;
  for (const s of stmts) {
    const r = await q(s);
    if (r) ok++;
  }
  // Rebuild simple index if needed (no-op if already exists)
  await q("CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors((COALESCE(last_seen, created_at)))");
  await pool.end().catch(()=>{});
  console.log(`[migrate] visitors updated. Statements run OK: ${ok}/${stmts.length}`);
}

main().catch((e) => {
  console.error("[migrate] failed:", e?.message || e);
  process.exitCode = 1;
});

