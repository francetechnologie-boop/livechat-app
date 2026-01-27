#!/usr/bin/env node
/*
 One-time normalization script for mod_module_manager_sidebar_entries.
 - Ensure hashes start with "#/"
 - Convert legacy "#/modules/<id>[...]" to canonical "#/<id>[...]"
 - Normalize "#modules..." or "#logs2" etc. to "#/..."

 Usage: node backend/scripts/normalize-sidebar.cjs
 Requires: process.env.DATABASE_URL or PG* envs
*/

const { Client } = require('pg');

async function getClient() {
  const url = process.env.DATABASE_URL || '';
  const cfg = url
    ? { connectionString: url }
    : {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        database: process.env.PGDATABASE || 'postgres',
      };
  const client = new Client(cfg);
  await client.connect();
  return client;
}

async function main() {
  const client = await getClient();
  let total = 0;
  try {
    const stmts = [
      // #modules... -> #/modules...
      `UPDATE mod_module_manager_sidebar_entries
         SET hash = REGEXP_REPLACE(hash, '^#modules', '#/modules')
       WHERE hash ~ '^#modules'`,
      // #/modules/<id>... -> #/<id>...
      `UPDATE mod_module_manager_sidebar_entries
         SET hash = REGEXP_REPLACE(hash, '^#/?modules/([^/]+)(.*)$', '#/\\1\\2')
       WHERE hash ~ '^#/?modules/'`,
      // ensure leading #/
      `UPDATE mod_module_manager_sidebar_entries
         SET hash = REGEXP_REPLACE(hash, '^#(?!/)', '#/')
       WHERE hash ~ '^#(?!/)'`,
      // collapse duplicated slashes after #/
      `UPDATE mod_module_manager_sidebar_entries
         SET hash = REGEXP_REPLACE(hash, '^#//+', '#/')
       WHERE hash ~ '^#//+'`
    ];
    for (const sql of stmts) {
      const r = await client.query(sql);
      total += r.rowCount || 0;
    }
    console.log(JSON.stringify({ ok: true, updated: total }));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: e.message }));
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
}

main();

