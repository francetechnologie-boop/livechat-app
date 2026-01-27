// Reset or truncate the Postgres DB pointed by DATABASE_URL
// Usage:
//  - Truncate known tables (safe, keeps schema):
//      node scripts/reset-db.js
//  - Drop and recreate the public schema (full reset):
//      node scripts/reset-db.js --drop-schema

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

async function main() {
  const dropSchema = process.argv.includes("--drop-schema");

  const connectionString =
    process.env.DATABASE_URL ||
    "postgresql://livechat_user:Alexcaroline12@127.0.0.1:5432/livechat";

  const ssl = String(process.env.PGSSL || "").toLowerCase() === "true"
    ? { rejectUnauthorized: false }
    : false;

  const pool = new Pool({ connectionString, ssl });
  const client = await pool.connect();
  try {
    if (dropSchema) {
      console.log("Dropping and recreating schema 'public' (full reset)...");
      // Drops all objects in public, then recreates it owned by current user
      await client.query("BEGIN");
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");
      await client.query("COMMIT");
      console.log("Schema reset complete. Restart the server to auto-migrate.");
    } else {
      console.log("Truncating data in known tables (messages, visitors, visits)...");
      // Build a list of existing tables to avoid errors if some don't exist
      const { rows } = await client.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema='public'
           AND table_name = ANY($1)`,
        [["messages", "visitors", "visits"]]
      );
      const tables = rows.map((r) => r.table_name);
      if (tables.length === 0) {
        console.log("No known tables found to truncate.");
      } else {
        const list = tables.map((t) => `"public"."${t}"`).join(", ");
        await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
        console.log(`Truncated: ${tables.join(", ")}`);
      }
    }
  } catch (e) {
    console.error("DB reset error:", e.message);
    try { await client.query("ROLLBACK"); } catch {}
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
