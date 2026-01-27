import { ensureProfilesTable, getTableNameProfiles } from '../utils/ensure.js';

export function registerFtpProfilesRoutes(app, ctx = {}, utils = {}) {
  const pool = utils?.pool || ctx?.pool;
  const chatLog = utils?.chatLog || ctx?.chatLog || (()=>{});
  const normStr = (v) => String(v||'').trim();
  const base = utils?.base || '/api/ftp-connection';
  if (!pool || typeof pool.query !== 'function') return;

  // Health
  app.get(`${base}/__ping`, (_req, res) => res.json({ ok: true }));

  // List profiles
  app.get(`${base}/profiles`, async (req, res) => {
    try {
      await ensureProfilesTable(pool);
      const id = req.query?.id ? Number(req.query.id) : null;
      const rows = id
        ? await pool.query(`SELECT * FROM ${getTableNameProfiles()} WHERE id=$1 ORDER BY id ASC`, [id])
        : await pool.query(`SELECT * FROM ${getTableNameProfiles()} ORDER BY id ASC`);
      return res.json({ ok: true, items: rows.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Admin: schema status
  app.get(`${base}/admin/schema`, async (_req, res) => {
    try {
      const T = getTableNameProfiles();
      const exists = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [T]);
      let columns = [];
      if (exists.rowCount && exists.rows[0] && exists.rows[0].ok) {
        const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_ftp_connection_profiles' ORDER BY ordinal_position`);
        columns = r.rows || [];
      }
      return res.json({ ok:true, table: T, exists: !!(exists.rowCount && exists.rows[0] && exists.rows[0].ok), columns });
    } catch (e) { return res.status(500).json({ ok:false, error:'schema_failed', message: e?.message || String(e) }); }
  });

  // Admin: ensure table then report schema
  app.post(`${base}/admin/ensure`, async (_req, res) => {
    try { await ensureProfilesTable(pool); } catch {}
    try {
      const T = getTableNameProfiles();
      const exists = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [T]);
      return res.json({ ok:true, ensured:true, exists: !!(exists.rowCount && exists.rows[0] && exists.rows[0].ok), table: T });
    } catch (e) { return res.status(500).json({ ok:false, error:'ensure_failed', message: e?.message || String(e) }); }
  });

  // Upsert profile (create or update by id)
  app.post(`${base}/profiles`, async (req, res) => {
    try {
      await ensureProfilesTable(pool);
      const b = (req.body && typeof req.body==='object') ? req.body : {};
      const id = b.id != null ? Number(b.id) : null;
      const name = normStr(b.name);
      const host = normStr(b.host);
      const port = Number(b.port || (String(b.protocol||'').toLowerCase()==='sftp'?22:21)) || 21;
      const protocol = (String(b.protocol||'ftp').toLowerCase()==='sftp') ? 'sftp' : 'ftp';
      const username = b.username != null ? String(b.username) : null;
      const password = b.password != null ? String(b.password) : null; // stored as-is; avoid logging
      const basePath = b.base_path != null ? String(b.base_path) : '/';
      const passive = (b.passive === false) ? false : true;
      if (!name || !host) return res.status(400).json({ ok:false, error:'bad_request', message:'name and host required' });
      if (id) {
        await pool.query(`UPDATE ${getTableNameProfiles()} SET name=$1, host=$2, port=$3, protocol=$4, username=$5, password=COALESCE($6,password), base_path=$7, passive=$8, updated_at=now() WHERE id=$9`, [name, host, port, protocol, username, password, basePath, passive, id]);
        return res.json({ ok:true, id });
      }
      const r = await pool.query(`INSERT INTO ${getTableNameProfiles()} (name,host,port,protocol,username,password,base_path,passive,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), now()) RETURNING id`, [name, host, port, protocol, username, password, basePath, passive]);
      return res.json({ ok:true, id: Number(r.rows?.[0]?.id || 0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'save_failed', message: e?.message || String(e) }); }
  });

  // Delete profile
  app.delete(`${base}/profiles/:id`, async (req, res) => {
    try {
      await ensureProfilesTable(pool);
      const id = Number(req.params?.id || 0) || 0;
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`DELETE FROM ${getTableNameProfiles()} WHERE id=$1`, [id]);
      return res.json({ ok:true, deleted: Number(r.rowCount || 0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // Optional: test connection (requires basic-ftp for FTP or ssh2-sftp-client for SFTP)
  app.post(`${base}/test`, async (req, res) => {
    try {
      const b = (req.body && typeof req.body==='object') ? req.body : {};
      const pid = b.profile_id != null ? Number(b.profile_id) : null;
      const conf = b && typeof b==='object' ? b : {};
      let cfg = null;
      if (pid) {
        const r = await pool.query(`SELECT * FROM ${getTableNameProfiles()} WHERE id=$1`, [pid]);
        if (!r.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
        cfg = r.rows[0];
      } else {
        cfg = conf;
      }
      const protocol = (String(cfg.protocol||'ftp').toLowerCase()==='sftp') ? 'sftp' : 'ftp';
      if (protocol === 'ftp') {
        let Client;
        try { ({ default: Client } = await import('basic-ftp')); } catch {
          // Fallback to backend/node_modules via createRequire
          try {
            const path = (await import('path')).default;
            const { createRequire } = await import('module');
            const __dirname = path.dirname(new URL(import.meta.url).pathname);
            const req = createRequire(path.resolve(__dirname, '../../../../backend/index.js'));
            Client = req('basic-ftp');
          } catch {
            return res.status(500).json({ ok:false, error:'missing_dependency', message:'Install basic-ftp in backend to test FTP: cd backend && npm i basic-ftp --omit=dev' });
          }
        }
        const client = new Client();
        try {
          await client.access({ host: cfg.host, port: Number(cfg.port||21), user: cfg.username||undefined, password: cfg.password||undefined, secure: false });
          await client.close();
          return res.json({ ok:true, protocol:'ftp', connected:true });
        } catch (e) { try { await client.close(); } catch {} return res.status(500).json({ ok:false, error:'connect_failed', message: e?.message || String(e) }); }
      } else {
        let SFTPClient;
        try { ({ default: SFTPClient } = await import('ssh2-sftp-client')); } catch {
          // Fallback to backend/node_modules via createRequire
          try {
            const path = (await import('path')).default;
            const { createRequire } = await import('module');
            const __dirname = path.dirname(new URL(import.meta.url).pathname);
            const req = createRequire(path.resolve(__dirname, '../../../../backend/index.js'));
            SFTPClient = req('ssh2-sftp-client');
          } catch {
            return res.status(500).json({ ok:false, error:'missing_dependency', message:'Install ssh2-sftp-client in backend: cd backend && npm i ssh2-sftp-client --omit=dev' });
          }
        }
        const client = new SFTPClient();
        try {
          await client.connect({ host: cfg.host, port: Number(cfg.port||22), username: cfg.username, password: cfg.password });
          await client.end();
          return res.json({ ok:true, protocol:'sftp', connected:true });
        } catch (e) { try { await client.end(); } catch {} return res.status(500).json({ ok:false, error:'connect_failed', message: e?.message || String(e) }); }
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'test_failed', message: e?.message || String(e) }); }
  });
}
