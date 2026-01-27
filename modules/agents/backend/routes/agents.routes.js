export function registerAgentsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAuth = ctx.requireAuth || ((_req, res) => { res.status(401).json({ error: 'unauthorized' }); return null; });
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).json({ error: 'forbidden' }); return null; });

  // Namespaced API for agents module
  app.get('/api/agents/ping', (_req, res) => res.json({ ok: true, module: 'agents' }));

  // Compatibility stubs: legacy UIs may try to call these endpoints.
  // Keep them harmless and JSON-only to avoid HTML 404 content surfacing in the UI.
  app.get('/api/agents/list', (_req, res) => res.json({ ok: true, items: [] }));
  app.get('/api/agents/sidebar', (_req, res) => res.json({ ok: true, sidebar: { visible: [], hidden: [] } }));
  app.post('/api/agents/sidebar', (_req, res) => res.json({ ok: true }));

  // Preferences API (per-agent)
  app.get('/api/agents/preferences', async (req, res) => {
    const me = requireAuth(req, res);
    if (!me || !pool) return;
    try {
      const r = await pool.query(`SELECT preferences FROM public.mod_agents_preferences WHERE agent_id = $1 LIMIT 1`, [me.id]);
      const prefs = r.rowCount ? (r.rows[0].preferences || {}) : {};
      res.json({ ok: true, preferences: prefs });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // ---- Organization settings (per-org) ----
  const ensureOrgTable = async () => {
    if (!pool) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.mod_agents_orgs (
        org_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        contact_email TEXT NULL,
        logo_url TEXT NULL,
        locale TEXT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Extended columns (idempotent)
    const addCol = async (sql) => { try { await pool.query(sql); } catch {} };
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS timezone TEXT`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS default_lang TEXT`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS brand_logo_light TEXT`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS brand_logo_dark TEXT`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS favicon_url TEXT`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS theme_primary TEXT`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS theme_accent TEXT`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS allowed_email_domains TEXT[]`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS ip_allowlist TEXT[]`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS sso_required BOOLEAN`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS invite_policy TEXT`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS data_retention_days INT`);
    await addCol(`ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS audit_log_enabled BOOLEAN`);
  };
  app.get('/api/agents/organization', async (req, res) => {
    const me = requireAuth(req, res); if (!me || !pool) return;
    try {
      await ensureOrgTable();
      const org = me.org_id || 'org_default';
      let r = await pool.query(`SELECT org_id, name, contact_email, logo_url, locale,
                                       timezone, default_lang, brand_logo_light, brand_logo_dark, favicon_url,
                                       theme_primary, theme_accent, allowed_email_domains, ip_allowlist,
                                       sso_required, invite_policy, data_retention_days, audit_log_enabled,
                                       created_at, updated_at
                                FROM public.mod_agents_orgs WHERE org_id = $1`, [org]);
      if (!r.rowCount) {
        await pool.query(`INSERT INTO public.mod_agents_orgs(org_id, name, created_at, updated_at) VALUES ($1,$2,NOW(),NOW())`, [org, 'Organization']);
        r = await pool.query(`SELECT org_id, name, contact_email, logo_url, locale,
                                     timezone, default_lang, brand_logo_light, brand_logo_dark, favicon_url,
                                     theme_primary, theme_accent, allowed_email_domains, ip_allowlist,
                                     sso_required, invite_policy, data_retention_days, audit_log_enabled,
                                     created_at, updated_at
                              FROM public.mod_agents_orgs WHERE org_id = $1`, [org]);
      }
      res.json({ ok:true, organization: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });
  app.patch('/api/agents/organization', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    try {
      await ensureOrgTable();
      const org = admin.org_id || 'org_default';
      const b = req.body || {};
      const sets = [];
      const args = [];
      let i = 1;
      if (b.name !== undefined) { sets.push(`name=$${i++}`); args.push(String(b.name||'')); }
      if (b.contact_email !== undefined) { sets.push(`contact_email=$${i++}`); args.push(b.contact_email?String(b.contact_email):null); }
      if (b.logo_url !== undefined) { sets.push(`logo_url=$${i++}`); args.push(b.logo_url?String(b.logo_url):null); }
      if (b.locale !== undefined) { sets.push(`locale=$${i++}`); args.push(b.locale?String(b.locale):null); }
      if (b.timezone !== undefined) { sets.push(`timezone=$${i++}`); args.push(b.timezone?String(b.timezone):null); }
      if (b.default_lang !== undefined) { sets.push(`default_lang=$${i++}`); args.push(b.default_lang?String(b.default_lang):null); }
      if (b.brand_logo_light !== undefined) { sets.push(`brand_logo_light=$${i++}`); args.push(b.brand_logo_light?String(b.brand_logo_light):null); }
      if (b.brand_logo_dark !== undefined) { sets.push(`brand_logo_dark=$${i++}`); args.push(b.brand_logo_dark?String(b.brand_logo_dark):null); }
      if (b.favicon_url !== undefined) { sets.push(`favicon_url=$${i++}`); args.push(b.favicon_url?String(b.favicon_url):null); }
      if (b.theme_primary !== undefined) { sets.push(`theme_primary=$${i++}`); args.push(b.theme_primary?String(b.theme_primary):null); }
      if (b.theme_accent !== undefined) { sets.push(`theme_accent=$${i++}`); args.push(b.theme_accent?String(b.theme_accent):null); }
      if (b.allowed_email_domains !== undefined) { sets.push(`allowed_email_domains=$${i++}`); args.push(Array.isArray(b.allowed_email_domains)?b.allowed_email_domains.map(String):null); }
      if (b.ip_allowlist !== undefined) { sets.push(`ip_allowlist=$${i++}`); args.push(Array.isArray(b.ip_allowlist)?b.ip_allowlist.map(String):null); }
      if (b.sso_required !== undefined) { sets.push(`sso_required=$${i++}`); args.push(b.sso_required===true); }
      if (b.invite_policy !== undefined) { sets.push(`invite_policy=$${i++}`); args.push(b.invite_policy?String(b.invite_policy):null); }
      if (b.data_retention_days !== undefined) { sets.push(`data_retention_days=$${i++}`); args.push(Number.isFinite(Number(b.data_retention_days))?Number(b.data_retention_days):null); }
      if (b.audit_log_enabled !== undefined) { sets.push(`audit_log_enabled=$${i++}`); args.push(b.audit_log_enabled===true); }
      if (!sets.length) return res.status(400).json({ ok:false, error:'empty_update' });
      args.push(org);
      const sql = `UPDATE public.mod_agents_orgs SET ${sets.join(', ')}, updated_at=NOW() WHERE org_id=$${i}
                   RETURNING org_id, name, contact_email, logo_url, locale,
                             timezone, default_lang, brand_logo_light, brand_logo_dark, favicon_url,
                             theme_primary, theme_accent, allowed_email_domains, ip_allowlist,
                             sso_required, invite_policy, data_retention_days, audit_log_enabled,
                             created_at, updated_at`;
      const r = await pool.query(sql, args);
      if (!r.rowCount) {
        // Upsert fallback
        await pool.query(`INSERT INTO public.mod_agents_orgs(org_id, name, contact_email, logo_url, locale, timezone, default_lang, brand_logo_light, brand_logo_dark, favicon_url,
                                                             theme_primary, theme_accent, allowed_email_domains, ip_allowlist, sso_required, invite_policy, data_retention_days, audit_log_enabled,
                                                             created_at, updated_at)
                          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())`, [
            org,
            String(b.name||'Organization'),
            b.contact_email?String(b.contact_email):null,
            b.logo_url?String(b.logo_url):null,
            b.locale?String(b.locale):null,
            b.timezone?String(b.timezone):null,
            b.default_lang?String(b.default_lang):null,
            b.brand_logo_light?String(b.brand_logo_light):null,
            b.brand_logo_dark?String(b.brand_logo_dark):null,
            b.favicon_url?String(b.favicon_url):null,
            b.theme_primary?String(b.theme_primary):null,
            b.theme_accent?String(b.theme_accent):null,
            Array.isArray(b.allowed_email_domains)?b.allowed_email_domains.map(String):null,
            Array.isArray(b.ip_allowlist)?b.ip_allowlist.map(String):null,
            b.sso_required===true,
            b.invite_policy?String(b.invite_policy):null,
            Number.isFinite(Number(b.data_retention_days))?Number(b.data_retention_days):null,
            b.audit_log_enabled===true
        ]);
        const r2 = await pool.query(`SELECT org_id, name, contact_email, logo_url, locale,
                                            timezone, default_lang, brand_logo_light, brand_logo_dark, favicon_url,
                                            theme_primary, theme_accent, allowed_email_domains, ip_allowlist,
                                            sso_required, invite_policy, data_retention_days, audit_log_enabled,
                                            created_at, updated_at
                                     FROM public.mod_agents_orgs WHERE org_id=$1`, [org]);
        return res.json({ ok:true, organization: r2.rows[0] });
      }
      res.json({ ok:true, organization: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });

  app.post('/api/agents/preferences', async (req, res) => {
    const me = requireAuth(req, res);
    if (!me || !pool) return;
    try {
      // Ensure preferences table exists (idempotent safety)
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS public.mod_agents_preferences (
          id SERIAL PRIMARY KEY,
          org_id TEXT NULL,
          agent_id INT UNIQUE,
          preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );`);
      } catch {}

      const b = req.body || {};
      // Only allow safe keys; sidebar-related keys are ignored (global-only sidebar)
      const allowed = [
        // Display/Localization
        'preferred_lang','theme_color','theme_color2','time_format','date_format',
        // Notifications
        'notifications','debug_panels',
        // UI / Navigation
        'restore_on_login','per_device_ui','restore_scroll','persist_drafts',
        'compact_sidebar','open_submenus_on_hover','default_module','keyboard_shortcuts',
        // Security override
        'ip_allowlist'
      ];
      const next = {};
      for (const k of allowed) {
        if (b[k] !== undefined) next[k] = b[k];
      }
      // Upsert preferences
      const orgId = me.org_id || null;
      const sql = `INSERT INTO public.mod_agents_preferences (org_id, agent_id, preferences, created_at, updated_at)
                   VALUES ($1, $2, $3::jsonb, NOW(), NOW())
                   ON CONFLICT (agent_id)
                   DO UPDATE SET preferences = public.mod_agents_preferences.preferences || EXCLUDED.preferences,
                                 updated_at = NOW()
                   RETURNING preferences`;
      const up = await pool.query(sql, [orgId, me.id, JSON.stringify(next)]);
      const prefs = up.rows[0]?.preferences || {};

      // Mirror common fields into whichever agents table exists (best-effort)
      try {
        const r = await pool.query("SELECT to_regclass('public.mod_agents_agents') AS t1, to_regclass('public.agents') AS t2");
        const row = (r && r.rows && r.rows[0]) || {};
        const targets = [];
        if (row.t1) targets.push('public.mod_agents_agents');
        if (row.t2) targets.push('public.agents');
        for (const T of targets) {
          const sets = [];
          const args = [];
          let i = 1;
          if (next.preferred_lang !== undefined) { sets.push(`preferred_lang = $${i++}`); args.push(String(next.preferred_lang)); }
          if (next.theme_color !== undefined) { sets.push(`theme_color = $${i++}`); args.push(String(next.theme_color)); }
          if (next.theme_color2 !== undefined) { sets.push(`theme_color2 = $${i++}`); args.push(String(next.theme_color2)); }
          if (next.notifications !== undefined) { sets.push(`notifications = $${i++}::jsonb`); args.push(JSON.stringify(next.notifications || {})); }
          if (!sets.length) continue;
          args.push(me.id);
          try { await pool.query(`UPDATE ${T} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, args); } catch {}
        }
      } catch {}

      res.json({ ok: true, preferences: prefs });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // Test notification (simulates server notification, lets client show Web Notification)
  app.post('/api/agents/notifications/test', async (req, res) => {
    const me = requireAuth(req, res); if (!me) return;
    try {
      try {
        const io = ctx.io || ctx.getIO?.();
        if (io?.to) {
          io.to('agents').emit('dashboard_message', {
            type: 'notification_test',
            at: new Date().toISOString(),
            title: 'Test notification',
            body: `Hello ${me.name || me.email || 'agent'}!`,
          });
        }
      } catch {}
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // ---- Users CRUD ----
  app.get('/api/agents/users', async (req, res) => {
    const me = requireAuth(req, res); if (!me || !pool) return;
    try {
      const r = await pool.query(`SELECT id, name, email, role, is_active, preferred_lang, theme_color, theme_color2, last_login FROM public.mod_agents_agents ORDER BY id ASC`);
      res.json({ ok: true, items: r.rows || [] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });

  app.post('/api/agents/users', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    const b = req.body || {};
    try {
      const sql = `INSERT INTO public.mod_agents_agents (name, email, password, role, is_active, preferred_lang, notifications, theme_color, theme_color2)
                   VALUES ($1, $2, COALESCE($3,''), COALESCE($4,'agent'), COALESCE($5,1), COALESCE($6,'en'), COALESCE($7,'{}'::jsonb), COALESCE($8,'#2563eb'), COALESCE($9,'#0d9488'))
                   RETURNING id, name, email, role, is_active`;
      const params = [String(b.name||''), String(b.email||''), String(b.password||''), String(b.role||'agent'), b.is_active?1:1, String(b.preferred_lang||'en'), JSON.stringify(b.notifications||{}), String(b.theme_color||'#2563eb'), String(b.theme_color2||'#0d9488')];
      const r = await pool.query(sql, params);
      res.json({ ok: true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message||String(e) }); }
  });

  app.patch('/api/agents/users/:id', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const sets = [];
      const args = [];
      let i = 1;
      if (b.name !== undefined) { sets.push(`name=$${i++}`); args.push(String(b.name)); }
      if (b.email !== undefined) { sets.push(`email=$${i++}`); args.push(String(b.email)); }
      if (b.password !== undefined) { sets.push(`password=$${i++}`); args.push(String(b.password||'')); }
      if (b.role !== undefined) { sets.push(`role=$${i++}`); args.push(String(b.role)); }
      if (b.is_active !== undefined) { sets.push(`is_active=$${i++}`); args.push(b.is_active ? 1 : 0); }
      if (b.preferred_lang !== undefined) { sets.push(`preferred_lang=$${i++}`); args.push(String(b.preferred_lang||'en')); }
      if (b.notifications !== undefined) { sets.push(`notifications=$${i++}::jsonb`); args.push(JSON.stringify(b.notifications||{})); }
      if (b.theme_color !== undefined) { sets.push(`theme_color=$${i++}`); args.push(String(b.theme_color||'#2563eb')); }
      if (b.theme_color2 !== undefined) { sets.push(`theme_color2=$${i++}`); args.push(String(b.theme_color2||'#0d9488')); }
      if (!sets.length) return res.status(400).json({ ok:false, error:'empty_update' });
      args.push(id);
      const sql = `UPDATE public.mod_agents_agents SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${i} RETURNING id, name, email, role, is_active`;
      const r = await pool.query(sql, args);
      res.json({ ok:true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });

  app.delete('/api/agents/users/:id', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    try {
      const id = Number(req.params.id);
      await pool.query(`DELETE FROM public.mod_agents_agents WHERE id=$1`, [id]);
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // ---- Roles CRUD ----
  app.get('/api/agents/roles', async (req, res) => {
    const me = requireAuth(req, res); if (!me || !pool) return;
    try {
      const r = await pool.query(`SELECT id, org_id, role, description, created_at, updated_at FROM public.mod_agents_roles ORDER BY role ASC`);
      res.json({ ok:true, items: r.rows||[] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });
  app.post('/api/agents/roles', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    const b = req.body || {};
    try {
      const r = await pool.query(`INSERT INTO public.mod_agents_roles (org_id, role, description) VALUES ($1,$2,$3) RETURNING *`, [b.org_id||null, String(b.role||'').trim(), b.description?String(b.description):null]);
      res.json({ ok:true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message||String(e) }); }
  });
  app.patch('/api/agents/roles/:id', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const sets = [];
      const args = [];
      let i = 1;
      if (b.org_id !== undefined) { sets.push(`org_id=$${i++}`); args.push(b.org_id||null); }
      if (b.role !== undefined) { sets.push(`role=$${i++}`); args.push(String(b.role||'')); }
      if (b.description !== undefined) { sets.push(`description=$${i++}`); args.push(b.description?String(b.description):null); }
      if (!sets.length) return res.status(400).json({ ok:false, error:'empty_update' });
      args.push(id);
      const r = await pool.query(`UPDATE public.mod_agents_roles SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${i} RETURNING *`, args);
      res.json({ ok:true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });
  app.delete('/api/agents/roles/:id', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    try { await pool.query(`DELETE FROM public.mod_agents_roles WHERE id=$1`, [Number(req.params.id)]); res.json({ ok:true }); }
    catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // ---- Memberships (agent ↔ role) ----
  app.get('/api/agents/members', async (req, res) => {
    const me = requireAuth(req, res); if (!me || !pool) return;
    try {
      const r = await pool.query(`
        SELECT m.id, m.org_id, m.agent_id, a.name AS agent_name, a.email AS agent_email,
               m.role_id, r.role AS role_name,
               m.created_at, m.updated_at
          FROM public.mod_agents_memberships m
          JOIN public.mod_agents_agents a ON a.id = m.agent_id
          JOIN public.mod_agents_roles r ON r.id = m.role_id
         ORDER BY a.name ASC, r.role ASC`);
      res.json({ ok:true, items: r.rows||[] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });
  app.post('/api/agents/members', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    const b = req.body || {};
    try {
      const r = await pool.query(`INSERT INTO public.mod_agents_memberships (org_id, agent_id, role_id) VALUES ($1,$2,$3) RETURNING *`, [b.org_id||null, Number(b.agent_id), Number(b.role_id)]);
      res.json({ ok:true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message||String(e) }); }
  });
  app.delete('/api/agents/members/:id', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    try { await pool.query(`DELETE FROM public.mod_agents_memberships WHERE id=$1`, [Number(req.params.id)]); res.json({ ok:true }); }
    catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // ---- Migration helper (idempotent) ----
  // Creates mod_agents_* tables when missing, copies data from legacy tables where available,
  // and replaces legacy tables with compatibility views.
  app.post('/api/agents/migrate', async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin || !pool) return;
    const steps = [];
    const run = async (description, sql, params=[]) => {
      await pool.query(sql, params); steps.push(description); return true;
    };
    const hasTable = async (name) => {
      const r = await pool.query(`SELECT to_regclass($1) AS t`, [name]);
      return !!(r.rows?.[0]?.t);
    };
    const colSet = async (table) => {
      const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
      return new Set((r.rows||[]).map(x => String(x.column_name)));
    };
    const begin = async () => { try { await pool.query('BEGIN'); } catch {} };
    const commit = async () => { try { await pool.query('COMMIT'); } catch {} };
    const rollback = async () => { try { await pool.query('ROLLBACK'); } catch {} };

    try {
      await begin();
      // 1) Ensure tables (idempotent)
      await run('ensure.mod_agents_agents', `
        CREATE TABLE IF NOT EXISTS public.mod_agents_agents (
          id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          org_id TEXT NULL,
          name TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL DEFAULT '',
          is_active SMALLINT DEFAULT 1,
          role TEXT NOT NULL DEFAULT 'agent',
          preferred_lang TEXT DEFAULT 'en',
          notifications JSONB DEFAULT '{}'::jsonb,
          theme_color TEXT DEFAULT '#2563eb',
          theme_color2 TEXT DEFAULT '#0d9488',
          last_login TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );`);
      await run('ensure.mod_agents_roles', `
        CREATE TABLE IF NOT EXISTS public.mod_agents_roles (
          id SERIAL PRIMARY KEY,
          org_id TEXT NULL,
          role TEXT NOT NULL,
          description TEXT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_agents_roles_role ON public.mod_agents_roles(role);
      `);
      await run('ensure.mod_agents_memberships', `
        CREATE TABLE IF NOT EXISTS public.mod_agents_memberships (
          id SERIAL PRIMARY KEY,
          org_id TEXT NULL,
          agent_id INTEGER NOT NULL REFERENCES public.mod_agents_agents(id) ON DELETE CASCADE,
          role_id INTEGER NOT NULL REFERENCES public.mod_agents_roles(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );`);
      await run('ensure.mod_agents_preferences', `
        CREATE TABLE IF NOT EXISTS public.mod_agents_preferences (
          org_id TEXT NULL,
          agent_id INTEGER PRIMARY KEY REFERENCES public.mod_agents_agents(id) ON DELETE CASCADE,
          preferences JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );`);

      // 2) Migrate from legacy 'users' to mod_agents_agents (if users table exists)
      if (await hasTable('users')) {
        const cs = await colSet('users');
        const sel = [
          cs.has('id') ? 'u.id' : 'NULL',
          cs.has('name') ? 'COALESCE(u.name,u.email,\'\')' : (cs.has('email') ? 'COALESCE(u.email,\'\')' : '\'\''),
          cs.has('email') ? 'u.email' : '\'\'',
          cs.has('password') ? 'COALESCE(u.password,\'\')' : '\'\'',
          cs.has('role') ? 'COALESCE(u.role,\'agent\')' : '\'agent\'',
          cs.has('is_active') ? 'COALESCE(u.is_active,1)' : '1',
          cs.has('preferred_lang') ? 'COALESCE(u.preferred_lang,\'en\')' : '\'en\'',
          cs.has('notifications') ? 'COALESCE(u.notifications,\'{}\'::jsonb)' : '\'{}\'::jsonb',
          cs.has('theme_color') ? 'COALESCE(u.theme_color,\'#2563eb\')' : '\'#2563eb\'',
          cs.has('theme_color2') ? 'COALESCE(u.theme_color2,\'#0d9488\')' : '\'#0d9488\'',
          cs.has('last_login') ? 'u.last_login' : 'NULL'
        ].join(',');
        await run('migrate.users->mod_agents_agents', `
          INSERT INTO public.mod_agents_agents (id, name, email, password, role, is_active, preferred_lang, notifications, theme_color, theme_color2, last_login)
          SELECT ${sel} FROM public.users u
          WHERE NOT EXISTS (SELECT 1 FROM public.mod_agents_agents m WHERE m.id = u.id OR m.email = u.email);
        `);
        // Optional: replace users table with a view pointing to mod_agents_agents (delete table first if it's a table)
        const isUsersTable = await pool.query(`SELECT relkind FROM pg_class WHERE oid = to_regclass('public.users')`);
        const relkind = isUsersTable.rows?.[0]?.relkind || null; // 'r' = table, 'v' = view
        if (relkind === 'r') {
          await run('drop.users', 'DROP TABLE public.users CASCADE;');
          await run('view.users->mod_agents_agents', 'CREATE VIEW public.users AS SELECT * FROM public.mod_agents_agents;');
        }
      }

      // 3) Migrate roles if legacy 'roles' exists
      if (await hasTable('roles')) {
        const cs = await colSet('roles');
        const roleCol = cs.has('role') ? 'role' : (cs.has('name') ? 'name' : null);
        if (roleCol) {
          await run('migrate.roles->mod_agents_roles', `
            INSERT INTO public.mod_agents_roles (role, description)
            SELECT DISTINCT TRIM(${roleCol}), NULL FROM public.roles r
            WHERE TRIM(${roleCol}) IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM public.mod_agents_roles x WHERE x.role = TRIM(r.${roleCol})
            );
          `);
        }
        const rk = await pool.query(`SELECT relkind FROM pg_class WHERE oid = to_regclass('public.roles')`);
        if (rk.rows?.[0]?.relkind === 'r') {
          await run('drop.roles', 'DROP TABLE public.roles CASCADE;');
          await run('view.roles->mod_agents_roles', 'CREATE VIEW public.roles AS SELECT id, org_id, role, description, created_at, updated_at FROM public.mod_agents_roles;');
        }
      }

      // 4) Migrate memberships if legacy 'memberships' exists
      if (await hasTable('memberships')) {
        const cs = await colSet('memberships');
        // Try to infer columns
        const agentIdExpr = cs.has('agent_id') ? 'm.agent_id' : (cs.has('user_id') ? 'm.user_id' : null);
        const roleIdExpr = cs.has('role_id') ? 'm.role_id' : null;
        if (agentIdExpr && roleIdExpr) {
          await run('migrate.memberships->mod_agents_memberships', `
            INSERT INTO public.mod_agents_memberships (org_id, agent_id, role_id)
            SELECT NULL, ${agentIdExpr}, ${roleIdExpr} FROM public.memberships m
            WHERE NOT EXISTS (
              SELECT 1 FROM public.mod_agents_memberships x WHERE x.agent_id = ${agentIdExpr} AND x.role_id = ${roleIdExpr}
            );
          `);
        }
        const rk = await pool.query(`SELECT relkind FROM pg_class WHERE oid = to_regclass('public.memberships')`);
        if (rk.rows?.[0]?.relkind === 'r') {
          await run('drop.memberships', 'DROP TABLE public.memberships CASCADE;');
          await run('view.memberships->mod_agents_memberships', 'CREATE VIEW public.memberships AS SELECT id, org_id, agent_id, role_id, created_at, updated_at FROM public.mod_agents_memberships;');
        }
      }

      await commit();
      res.json({ ok:true, steps });
    } catch (e) {
      await rollback();
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}
