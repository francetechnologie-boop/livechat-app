import { ensureProfilesTable, getTableNameProfiles } from '../utils/ensure.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';
import { runSshProfileDiagnostics } from '../services/sshDiagnostics.js';

function pickOrgId(req) {
  try {
    const v = req?.headers?.['x-org-id'] ?? req?.query?.org_id ?? null;
    if (v == null) return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function normStr(v) {
  return String(v || '').trim();
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function toPort(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 22;
}

function publicRow(row) {
  if (!row || typeof row !== 'object') return row;
  const { password_enc, ...rest } = row;
  return { ...rest, has_password: !!password_enc };
}

export function registerSshProfilProfilesRoutes(app, ctx = {}, utils = {}) {
  const pool = utils?.pool || ctx?.pool;
  const chatLog = utils?.chatLog || ctx?.chatLog || (() => {});
  const base = utils?.base || '/api/ssh-profil';
  if (!pool || typeof pool.query !== 'function') return;

  // List profiles
  app.get(`${base}/profiles`, async (req, res) => {
    try {
      await ensureProfilesTable(pool);
      const id = req.query?.id ? Number(req.query.id) : null;
      const orgId = pickOrgId(req);
      const where = [];
      const args = [];

      if (id) {
        args.push(id);
        where.push(`id = $${args.length}`);
      }
      if (orgId) {
        args.push(orgId);
        where.push(`(org_id IS NULL OR org_id = $${args.length})`);
      }

      const sql = `SELECT * FROM ${getTableNameProfiles()}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id ASC`;
      const r = await pool.query(sql, args);
      return res.json({ ok: true, items: (r.rows || []).map(publicRow) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'list_failed', message: e?.message || String(e) });
    }
  });

  // Admin: schema status
  app.get(`${base}/admin/schema`, async (_req, res) => {
    try {
      const T = getTableNameProfiles();
      const exists = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [T]);
      let columns = [];
      if (exists.rowCount && exists.rows[0] && exists.rows[0].ok) {
        const r = await pool.query(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_ssh_profil_profiles' ORDER BY ordinal_position`
        );
        columns = r.rows || [];
      }
      return res.json({ ok: true, table: T, exists: !!(exists.rowCount && exists.rows[0] && exists.rows[0].ok), columns });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'schema_failed', message: e?.message || String(e) });
    }
  });

  // Admin: ensure table then report
  app.post(`${base}/admin/ensure`, async (_req, res) => {
    try { await ensureProfilesTable(pool); } catch {}
    try {
      const T = getTableNameProfiles();
      const exists = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [T]);
      return res.json({ ok: true, ensured: true, exists: !!(exists.rowCount && exists.rows[0] && exists.rows[0].ok), table: T });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'ensure_failed', message: e?.message || String(e) });
    }
  });

  // Upsert profile (create or update by id)
  app.post(`${base}/profiles`, async (req, res) => {
    try {
      await ensureProfilesTable(pool);
      const b = (req.body && typeof req.body === 'object') ? req.body : {};

      const id = b.id != null ? Number(b.id) : null;
      const orgId = (b.org_id != null) ? (Number(b.org_id) || null) : pickOrgId(req);
      const name = normStr(b.name || b.profile_name);
      const host = normStr(b.host || b.ssh_host);
      const username = normStr(b.username || b.user || b.ssh_user);
      const port = toPort(b.port || b.ssh_port);
      const keyPath = isNonEmptyString(b.key_path) ? normStr(b.key_path) : (isNonEmptyString(b.ssh_key_path) ? normStr(b.ssh_key_path) : null);

      const wantsClearPassword = b.clear_password === true || b.clearPassword === true;
      const hasPasswordField = Object.prototype.hasOwnProperty.call(b, 'password') || Object.prototype.hasOwnProperty.call(b, 'ssh_password');
      const passwordRaw = hasPasswordField ? String(b.password ?? b.ssh_password ?? '') : null;
      const passwordEnc = wantsClearPassword ? null : (isNonEmptyString(passwordRaw) ? encryptSecret(passwordRaw) : undefined);

      if (!name || !host || !username) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'name, host and username are required' });
      }

      if (id) {
        const sets = ['org_id=$1', 'name=$2', 'host=$3', 'port=$4', 'username=$5', 'key_path=$6', 'updated_at=now()'];
        const args = [orgId, name, host, port, username, keyPath];
        if (passwordEnc !== undefined) {
          args.push(passwordEnc);
          sets.splice(6, 0, `password_enc=$${args.length}`);
        }
        args.push(id);
        await pool.query(`UPDATE ${getTableNameProfiles()} SET ${sets.join(', ')} WHERE id=$${args.length}`, args);
        return res.json({ ok: true, id });
      }

      const r = await pool.query(
        `INSERT INTO ${getTableNameProfiles()} (org_id,name,host,port,username,key_path,password_enc,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
         RETURNING id`,
        [orgId, name, host, port, username, keyPath, passwordEnc === undefined ? null : passwordEnc]
      );
      return res.json({ ok: true, id: Number(r.rows?.[0]?.id || 0) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'save_failed', message: e?.message || String(e) });
    }
  });

  // Delete profile
  app.delete(`${base}/profiles/:id`, async (req, res) => {
    try {
      await ensureProfilesTable(pool);
      const id = Number(req.params?.id || 0) || 0;
      if (!id) return res.status(400).json({ ok: false, error: 'bad_request' });
      const orgId = pickOrgId(req);
      const whereOrg = orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '';
      const args = orgId ? [id, orgId] : [id];
      const r = await pool.query(`DELETE FROM ${getTableNameProfiles()} WHERE id=$1${whereOrg}`, args);
      return res.json({ ok: true, deleted: Number(r.rowCount || 0) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'delete_failed', message: e?.message || String(e) });
    }
  });

  // Test connection and report access/groups/sudo
  app.post(`${base}/test`, async (req, res) => {
    try {
      await ensureProfilesTable(pool);
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = (b.org_id != null) ? (Number(b.org_id) || null) : pickOrgId(req);
      const pid = b.profile_id != null ? Number(b.profile_id) : null;

      let cfg = null;
      if (pid) {
        const whereOrg = orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '';
        const args = orgId ? [pid, orgId] : [pid];
        const r = await pool.query(`SELECT * FROM ${getTableNameProfiles()} WHERE id=$1${whereOrg}`, args);
        if (!r.rowCount) return res.status(404).json({ ok: false, error: 'profile_not_found' });
        cfg = r.rows[0];
      } else {
        cfg = {
          id: null,
          name: normStr(b.name || b.profile_name || 'ad-hoc'),
          host: normStr(b.host || b.ssh_host),
          port: toPort(b.port || b.ssh_port),
          username: normStr(b.username || b.user || b.ssh_user),
          key_path: isNonEmptyString(b.key_path) ? normStr(b.key_path) : null,
          password_enc: isNonEmptyString(b.password || b.ssh_password) ? encryptSecret(String(b.password ?? b.ssh_password)) : null,
        };
      }

      if (!cfg?.host || !cfg?.username) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'host and username required' });
      }

      const password = cfg.password_enc ? decryptSecret(cfg.password_enc) : null;
      const result = await runSshProfileDiagnostics(
        {
          host: cfg.host,
          port: Number(cfg.port || 22),
          username: cfg.username,
          keyPath: cfg.key_path || null,
          password: password || null,
        },
        { chatLog, profileId: cfg.id || null, profileName: cfg.name || null }
      );

      return res.json({ ok: true, profile: publicRow(cfg), result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'test_failed', message: e?.message || String(e) });
    }
  });
}
