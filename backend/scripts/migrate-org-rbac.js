#!/usr/bin/env node
import 'dotenv/config.js';
import pg from 'pg';

const { Pool } = pg;

function id(prefix='id') {
  const rnd = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}${rnd}`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://livechat_user:Alexcaroline12@127.0.0.1:5432/livechat';
  const ssl = String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString, ssl });
  const client = await pool.connect();
  const run = async (sql, params=[]) => { try { await client.query(sql, params); } catch (e) { /* best-effort */ } };

  try {
    // 1) Organizations (ensure table + a default org)
    await run(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        openai_api_key TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await run(`CREATE UNIQUE INDEX IF NOT EXISTS org_name_unique ON organizations (name)`);

    let orgId;
    try {
      const r = await client.query(`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`);
      if (r.rowCount) orgId = r.rows[0].id;
    } catch {}
    if (!orgId) {
      orgId = 'org_default';
      await run(`INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`, [orgId, 'Default']);
    }

    // 2) Users + Memberships
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        password TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(lower(email))`);

    await run(`
      CREATE TABLE IF NOT EXISTS memberships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        joined_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (user_id, org_id)
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id)`);

    // 3) Roles, Permissions, Role-Permissions, Assignments
    await run(`
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        is_system BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (org_id, name)
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(org_id)`);

    await run(`
      CREATE TABLE IF NOT EXISTS permissions (
        name TEXT PRIMARY KEY,
        description TEXT
      );
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id TEXT NOT NULL,
        permission_name TEXT NOT NULL,
        PRIMARY KEY (role_id, permission_name)
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id)`);

    await run(`
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        membership_id TEXT,
        role_id TEXT,
        org_id TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (membership_id, role_id)
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_assignments_membership ON assignments(membership_id)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_assignments_org ON assignments(org_id)`);

    // 4) Optional: Teams, team memberships
    await run(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (org_id, name)
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id)`);

    await run(`
      CREATE TABLE IF NOT EXISTS team_members (
        team_id TEXT NOT NULL,
        membership_id TEXT NOT NULL,
        role_id TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (team_id, membership_id)
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id)`);

    // 5) Optional: Resource ACL, Invitations, Audit Log
    await run(`
      CREATE TABLE IF NOT EXISTS resource_acl (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (resource_type, resource_id, subject_type, subject_id, permission)
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_resource_acl_org ON resource_acl(org_id)`);

    await run(`
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role_id TEXT,
        token TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        invited_at TIMESTAMP DEFAULT NOW(),
        accepted_at TIMESTAMP
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id)`);

    await run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        org_id TEXT,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        ip TEXT,
        meta JSONB,
        occurred_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await run(`CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id)`);

    // 6) Seed a base permission set and default roles
    const basePerms = [
      'chatbot.read','chatbot.write',
      'prompt.read','prompt.write',
      'mcp.read','mcp.write',
      'files.read','files.write',
      'visitors.read','visitors.write',
      'settings.read','settings.write'
    ];
    for (const p of basePerms) {
      await run(`INSERT INTO permissions(name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [p]);
    }

    // Global system roles
    const roles = [
      { id: 'role_owner', name: 'owner', is_system: true },
      { id: 'role_admin', name: 'admin', is_system: true },
      { id: 'role_member', name: 'member', is_system: true },
    ];
    for (const r of roles) {
      await run(`
        INSERT INTO roles (id, org_id, name, description, is_system, created_at, updated_at)
        VALUES ($1, NULL, $2, $3, $4, NOW(), NOW())
        ON CONFLICT (org_id, name) DO NOTHING
      `, [r.id, r.name, `${r.name} role`, true]);
    }

    // Role permissions (owner/admin: all; member: read)
    for (const p of basePerms) {
      await run(`INSERT INTO role_permissions(role_id, permission_name) VALUES ('role_owner', $1) ON CONFLICT DO NOTHING`, [p]);
      await run(`INSERT INTO role_permissions(role_id, permission_name) VALUES ('role_admin', $1) ON CONFLICT DO NOTHING`, [p]);
    }
    for (const p of basePerms.filter(x=>/\.read$/.test(x))) {
      await run(`INSERT INTO role_permissions(role_id, permission_name) VALUES ('role_member', $1) ON CONFLICT DO NOTHING`, [p]);
    }

    // 7) Backfill agents.org_id and mirror to users (one-way)
    await run(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS org_id TEXT`);
    await run(`UPDATE agents SET org_id = COALESCE(org_id, $1)`, [orgId]);
    
    // Mirror agents -> users and memberships
    try {
      const agents = await client.query(`SELECT id, email, name, password FROM agents ORDER BY id ASC`);
      for (let i=0; i<agents.rowCount; i++) {
        const a = agents.rows[i];
        const uid = `usr_${a.id}`; // stable mapping
        await run(`INSERT INTO users (id, email, name, password, created_at, updated_at) VALUES ($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`, [uid, (a.email||'').toLowerCase(), a.name || a.email, a.password || null]);
        const mid = id('mem');
        await run(`INSERT INTO memberships (id, user_id, org_id, status, joined_at) VALUES ($1,$2,$3,'active', NOW()) ON CONFLICT (user_id, org_id) DO NOTHING`, [mid, uid, orgId]);
        const role = (i === 0) ? 'role_owner' : 'role_member';
        const r = await client.query(`SELECT id FROM memberships WHERE user_id=$1 AND org_id=$2 LIMIT 1`, [uid, orgId]);
        if (r.rowCount) {
          const assignId = id('asg');
          await run(`INSERT INTO assignments (id, membership_id, role_id, org_id, created_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (membership_id, role_id) DO NOTHING`, [assignId, r.rows[0].id, role, orgId]);
        }
      }
    } catch {}

    // 8) Add org_id to domain tables and backfill to default org
    const addCol = async (table, col='org_id') => {
      await run(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} TEXT`);
      await run(`CREATE INDEX IF NOT EXISTS idx_${table.replace(/\W/g,'_')}_${col} ON ${table}(${col})`);
    };
    const backfill = async (table) => {
      await run(`UPDATE ${table} SET org_id = COALESCE(org_id, $1)`, [orgId]);
    };

    const orgScopedTables = [
      'messages','visitors','visits','auto_messages','welcome_message',
      'chatbot_config','prompt_config','local_prompt',
      'mcp_server_config','mcp_group','mcp_tool_def','mcp_files',
      'app_file','file_category'
    ];
    for (const t of orgScopedTables) { await addCol(t); }
    for (const t of orgScopedTables) { await backfill(t); }

    // settings: allow optional org override
    await addCol('settings');

    console.log('[migrate-org-rbac] Completed. Default org:', orgId);
  } catch (e) {
    console.error('[migrate-org-rbac] failed:', e.code || '', e.message);
    process.exitCode = 1;
  } finally {
    try { client.release(); } catch {}
    try { await pool.end(); } catch {}
  }
}

main().catch((e)=>{ console.error('[migrate-org-rbac] fatal:', e.message); process.exit(1); });
