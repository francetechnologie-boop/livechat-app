// Create or reset an agent (staff) login for the Livechat backend
// Usage examples:
//   node scripts/agent.js --list
//   node scripts/agent.js --email you@example.com --password 'Secret123' --name 'You' --admin
//   node scripts/agent.js --email you@example.com --password 'NewPass123'

import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.split('=');
      const key = k.replace(/^--/, '');
      if (v != null) out[key] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
      else out.flags.add(key);
    }
  }
  return out;
}

function help() {
  console.log(`\nLivechat agent helper\n\nCommands:\n  --list                           List existing agents\n  --email <email> --password <pw>  Create or reset agent password\n  --name <name>                    Optional name when creating\n  --admin                          Create/update with admin role\n  --activate | --deactivate        Toggle is_active\n\nExamples:\n  node scripts/agent.js --list\n  node scripts/agent.js --email admin@example.com --password 'Secret123' --name 'Admin' --admin\n  node scripts/agent.js --email agent@example.com --password 'NewPass123'\n`);
}

async function ensureAgentsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      role TEXT DEFAULT 'agent',
      last_login TIMESTAMP
    );
  `);
  await client.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS preferred_lang TEXT`);
  await client.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS notifications JSONB`);
  await client.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_color TEXT`);
  await client.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_color2 TEXT`);
  await client.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS ui_state JSONB`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.flags.has('help') || args.flags.has('h')) return help();

  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://livechat_user:Alexcaroline12@127.0.0.1:5432/livechat';
  const ssl = String(process.env.PGSSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: false }
    : false;
  const pool = new Pool({ connectionString, ssl });
  const client = await pool.connect();
  try {
    if (args.flags.has('list')) {
      const r = await client.query('SELECT id, name, email, role, is_active, last_login FROM agents ORDER BY id ASC');
      if (!r.rowCount) console.log('(no agents)');
      else console.table(r.rows);
      return;
    }

    const email = String(args.email || '').trim().toLowerCase();
    const password = String(args.password || '').trim();
    const wantAdmin = args.flags.has('admin');
    const doActivate = args.flags.has('activate');
    const doDeactivate = args.flags.has('deactivate');

    if (!email || !password) {
      console.error('Missing --email and/or --password');
      help();
      process.exitCode = 1;
      return;
    }

    await ensureAgentsTable(client);

    const found = await client.query(
      'SELECT id, name, email, role, is_active FROM agents WHERE lower(email) = $1 LIMIT 1',
      [email]
    );
    const hash = await bcrypt.hash(password, 10);

    if (found.rowCount) {
      // Update existing
      const a = found.rows[0];
      const sets = ['password = $1'];
      const vals = [hash];
      if (wantAdmin) { sets.push('role = $' + (sets.length + 1)); vals.push('admin'); }
      if (doActivate) { sets.push('is_active = $' + (sets.length + 1)); vals.push(true); }
      if (doDeactivate) { sets.push('is_active = $' + (sets.length + 1)); vals.push(false); }
      const sql = `UPDATE agents SET ${sets.join(', ')} WHERE id = $${sets.length + 1} RETURNING id, name, email, role, is_active`;
      const r = await client.query(sql, [...vals, a.id]);
      const out = r.rows[0];
      console.log('Updated agent:', out);
    } else {
      // Create new
      const name = String(args.name || email).trim();
      const role = wantAdmin ? 'admin' : 'agent';
      const isActive = doDeactivate ? false : true;
      const r = await client.query(
        `INSERT INTO agents (name, email, password, role, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, role, is_active`,
        [name, email, hash, role, isActive]
      );
      console.log('Created agent:', r.rows[0]);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
