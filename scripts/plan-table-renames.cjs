#!/usr/bin/env node
/*
 Plans table renames to the canonical mod_<module_id_snake>_* convention.

 - Reads modules/<id> to detect module IDs.
 - Connects to Postgres using DATABASE_URL (or PG* env) and lists public tables.
 - Prints a suggested mapping and writes modules/table_rename_plan.json.
 - Does NOT modify the database. Use the admin endpoint to apply:
   POST /api/module-manager/db/rename-tables
   Body: { renames: [ { from, to, createView:true } ] }

 Usage: node scripts/plan-table-renames.cjs [--pretty]
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pgClientLoader = null;
try { pgClientLoader = require('pg').Client; }
catch {
  try { pgClientLoader = require(path.join(ROOT, 'backend', 'node_modules', 'pg')).Client; }
  catch { pgClientLoader = null; }
}

const MODS_DIR = path.join(ROOT, 'modules');
const PRETTY = process.argv.includes('--pretty');

function list(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } }
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

function toSnake(id) { return String(id || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }

function loadModuleIds() {
  const ids = [];
  for (const ent of list(MODS_DIR)) if (ent.isDirectory()) ids.push(ent.name);
  return ids.map(id => ({ id, snake: toSnake(id) }));
}

async function getTables(client) {
  const q = `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const r = await client.query(q);
  return (r.rows || []).map(row => String(row.tablename));
}

function planRenames(tables, mods) {
  const renames = [];
  const skipPrefixes = new Set(['mod_']); // already compliant
  for (const t of tables) {
    // Skip already compliant
    if (t.startsWith('mod_')) continue;
    // Try to infer the owning module
    let match = null;
    for (const m of mods) {
      const id = m.id.toLowerCase();
      const snake = m.snake;
      if (t === id || t.startsWith(id + '_') || t.startsWith(snake + '_') || t.includes(`_${snake}_`)) {
        const rest = t
          .replace(new RegExp(`^${id}_?`), '')
          .replace(new RegExp(`^${snake}_?`), '');
        const base = rest ? rest : 'data';
        const to = `mod_${snake}_${base}`;
        if (to !== t) renames.push({ module: m.id, from: t, to, createView: true });
        match = m; break;
      }
    }
    // Common historical names
    if (!match && t === 'modules') {
      renames.push({ module: 'module-manager', from: 'modules', to: 'mod_module_manager_modules', createView: true });
    }
  }
  return renames;
}

async function main() {
  const mods = loadModuleIds();
  const conn = process.env.DATABASE_URL || null;
  if (!conn) {
    console.error('DATABASE_URL not set. Only emitting a blank plan.');
    const out = { ok:false, message:'no_database', renames:[], modules:mods };
    const outPath = path.join(MODS_DIR, 'table_rename_plan.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, PRETTY?2:0));
    console.log(JSON.stringify(out, null, PRETTY?2:0));
    process.exit(0);
  }
  if (!pgClientLoader) throw new Error('pg module is not available; install it under backend or root');
  const client = (() => {
    const url = new URL(conn);
    const cfg = { connectionString: conn };
    const sm = url.searchParams.get('sslmode') || process.env.PGSSLMODE || '';
    if (/no-verify/i.test(sm)) { cfg.ssl = { rejectUnauthorized: false }; }
    else if (/require/i.test(sm) || /true/i.test(url.searchParams.get('ssl') || '')) { cfg.ssl = { rejectUnauthorized: false }; }
    return new pgClientLoader(cfg);
  })();
  await client.connect();
  try {
    const tables = await getTables(client);
    const renames = planRenames(tables, mods);
    const out = { ok:true, tables, modules:mods, renames };
    const outPath = path.join(MODS_DIR, 'table_rename_plan.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, PRETTY?2:0));
    console.log(JSON.stringify(out, null, PRETTY?2:0));
  } finally { await client.end(); }
}

main().catch((e) => { console.error(e); process.exit(1); });




