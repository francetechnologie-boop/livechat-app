// Clean entries from public.grabbing_jerome_domains_url_page_explore
// Usage examples:
//  - Truncate all rows (reset identity):
//      node scripts/clean-page-explore.js --all --yes
//  - Delete a single domain:
//      node scripts/clean-page-explore.js --domain stilcasashop.com --yes
//  - Delete a single domain older than a date:
//      node scripts/clean-page-explore.js --domain stilcasashop.com --before 2025-10-01 --yes

import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all" || a === "--truncate") args.all = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--dry-run") args.dry = true;
    else if (a === "--domain") { args.domain = argv[++i]; }
    else if (a === "--before" || a === "--older" || a === "--date") { args.before = argv[++i]; }
    else if (a === "--help" || a === "-h") args.help = true;
    else args._.push(a);
  }
  return args;
}

function usage() {
  console.log(`Clean table public.grabbing_jerome_domains_url_page_explore

Options:
  --all / --truncate        Truncate the entire table (RESTART IDENTITY)
  --domain <name>           Delete only a specific domain
  --before <YYYY-MM-DD>     Delete rows explored before this date (optionally with --domain)
  --dry-run                 Show what would be deleted
  --yes, -y                 Skip confirmation prompt
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.all && !args.domain)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const connectionString = process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER||"postgres"}:${process.env.PGPASSWORD||""}@${process.env.PGHOST||"127.0.0.1"}:${process.env.PGPORT||5432}/${process.env.PGDATABASE||"postgres"}`;
  const ssl = String(process.env.PGSSL || "").toLowerCase() === "true" ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString, ssl });
  const client = await pool.connect();

  try {
    if (args.all) {
      if (!args.yes) {
        console.log("Refusing to truncate without --yes. Add --yes to proceed.");
        process.exit(1);
      }
      if (args.dry) {
        const { rows } = await client.query("select count(*)::int as c from public.grabbing_jerome_domains_url_page_explore");
        console.log(`[dry-run] Would TRUNCATE grabbing_jerome_domains_url_page_explore (rows: ${rows[0].c})`);
      } else {
        await client.query("TRUNCATE public.grabbing_jerome_domains_url_page_explore RESTART IDENTITY CASCADE");
        console.log("Truncated grabbing_jerome_domains_url_page_explore (identity reset)");
      }
      return;
    }

    // Domain or date filtering
    const params = [];
    const conds = [];
    if (args.domain) { params.push(args.domain.replace(/^www\./, "")); conds.push(`domain = $${params.length}`); }
    if (args.before) { params.push(new Date(args.before)); conds.push(`explored_at < $${params.length}`); }
    const where = conds.length ? `where ${conds.join(" and ")}` : "";

    const { rows: cnt } = await client.query(`select count(*)::int as c from public.grabbing_jerome_domains_url_page_explore ${where}`, params);
    const total = cnt[0]?.c || 0;
    if (!total) {
      console.log("No rows match criteria. Nothing to delete.");
      return;
    }
    if (args.dry) {
      console.log(`[dry-run] Would delete ${total} rows from grabbing_jerome_domains_url_page_explore ${where ? `(${where})` : ""}`);
      return;
    }
    if (!args.yes) {
      console.log(`Refusing to delete ${total} rows without --yes. Add --dry-run to preview.`);
      process.exit(1);
    }
    await client.query(`delete from public.grabbing_jerome_domains_url_page_explore ${where}`, params);
    console.log(`Deleted ${total} rows from grabbing_jerome_domains_url_page_explore.`);
  } catch (e) {
    console.error("Error:", e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });

