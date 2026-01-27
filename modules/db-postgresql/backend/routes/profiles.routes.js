export function registerDbPostgresRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ ok:false, error:'unauthorized' }); return null; });

  app.get('/api/db-postgresql/health', async (_req, res) => {
    try { return res.json({ ok:true, module: 'db-postgresql' }); } catch { return; }
  });

  async function ensureTables() {
    if (!pool) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_db_postgresql_profiles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        host VARCHAR(255) NOT NULL,
        port INTEGER NOT NULL DEFAULT 5432,
        database VARCHAR(255) NOT NULL,
        db_user VARCHAR(255) NOT NULL,
        db_password TEXT NULL,
        ssl BOOLEAN NOT NULL DEFAULT FALSE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        table_prefixes TEXT NULL,
        org_id TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_db_postgres_profiles_org ON mod_db_postgresql_profiles(org_id);
      ALTER TABLE mod_db_postgresql_profiles
        ADD COLUMN IF NOT EXISTS table_prefixes TEXT NULL;
    `);
  }

  app.get('/api/db-postgresql/profiles', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureTables();
      const r = await pool.query('SELECT id, name, host, port, database, db_user, ssl, is_default, table_prefixes, org_id, created_at, updated_at FROM mod_db_postgresql_profiles ORDER BY updated_at DESC');
      return res.json({ ok:true, items: r.rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  app.post('/api/db-postgresql/profiles', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureTables();
      const b = req.body || {};
      const name = String(b.name||'').trim();
      const host = String(b.host||'').trim();
      const port = Number(b.port||5432);
      const database = String(b.database||'').trim();
      const db_user = String(b.db_user||b.user||'').trim();
      const db_password = typeof b.db_password==='string' ? b.db_password : null;
      const ssl = !!b.ssl;
      const table_prefixes = (b.table_prefixes == null ? null : String(b.table_prefixes));
      const org_id = (b.org_id==null? null : String(b.org_id));
      if (!name || !host || !database || !db_user) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(
        `INSERT INTO mod_db_postgresql_profiles (name,host,port,database,db_user,db_password,ssl,is_default,table_prefixes,org_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [name,host,port,database,db_user,db_password,ssl,false,table_prefixes,org_id]
      );
      return res.status(201).json({ ok:true, id: r.rows[0].id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // Read one (includes password)
  app.get('/api/db-postgresql/profiles/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const id = Number(req.params.id||0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      const r = await pool.query('SELECT id, name, host, port, database, db_user, db_password, ssl, is_default, table_prefixes, org_id, created_at, updated_at FROM mod_db_postgresql_profiles WHERE id=$1', [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // Update
  app.put('/api/db-postgresql/profiles/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const id = Number(req.params.id||0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      const b = req.body||{};
      const fields = [];
      const vals = [];
      function set(col, val) { fields.push(col + '=$' + (vals.length+1)); vals.push(val); }
      if (b.name != null) set('name', String(b.name));
      if (b.host != null) set('host', String(b.host));
      if (b.port != null) set('port', Number(b.port));
      if (b.database != null) set('database', String(b.database));
      if (b.db_user != null) set('db_user', String(b.db_user));
      if (b.db_password != null) set('db_password', String(b.db_password));
      if (b.ssl != null) set('ssl', !!b.ssl);
      if (b.table_prefixes != null) set('table_prefixes', String(b.table_prefixes));
      if (!fields.length) return res.json({ ok:true });
      vals.push(id);
      const sql = `UPDATE mod_db_postgresql_profiles SET ${fields.join(', ')}, updated_at=NOW() WHERE id=$${vals.length}`;
      await pool.query(sql, vals);
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // Delete
  app.delete('/api/db-postgresql/profiles/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const id = Number(req.params.id||0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      await pool.query('DELETE FROM mod_db_postgresql_profiles WHERE id=$1', [id]);
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });
}
