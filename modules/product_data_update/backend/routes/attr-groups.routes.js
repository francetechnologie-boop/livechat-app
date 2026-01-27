export function registerProductDataUpdateAttrGroupsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const chatLog = utils.chatLog || (()=>{});
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  async function getMysql2Local() {
    try { const mod = await import('mysql2/promise'); return mod && (mod.default || mod); } catch {}
    try {
      const { createRequire } = await import('module');
      const path = (await import('path')).default;
      const backendDir = (ctx && ctx.backendDir) || path.resolve(process.cwd(), 'backend');
      const req = createRequire(path.join(backendDir, 'package.json'));
      const mod = req('mysql2/promise');
      return mod && (mod.default || mod);
    } catch {}
    const err = new Error('mysql2_missing'); err.code = 'MYSQL2_MISSING'; throw err;
  }

  // POST /api/product_data_update/attr-groups/translate
  // Body: { profile_id:number, prefix:string, from_lang_id:number, start_from?:number }
  // Translates ps_attribute_group_lang.name and public_name from from_lang_id to every other id_lang in ps_lang.
  app.post('/api/product_data_update/attr-groups/translate', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const profileId = Number(b.profile_id || 0) || null;
    const prefix = String(b.prefix || '').trim();
    const fromLangId = Number(b.from_lang_id || 0) || null;
    const startFrom = Number(b.start_from || 0) || 0;
    if (!profileId || !prefix || !fromLangId) return res.status(400).json({ ok:false, error:'bad_request' });
    if (!/^[A-Za-z0-9_]+$/.test(prefix)) return res.status(400).json({ ok:false, error:'invalid_prefix' });

    try {
      // Resolve profile connection
      const args = [profileId];
      let whereOrg = '';
      try { const orgId = (req.headers['x-org-id'] || req.query?.org_id) ? String(req.headers['x-org-id'] || req.query.org_id) : null; if (orgId) { args.push(orgId); whereOrg = ' AND (org_id IS NULL OR org_id = $2)'; } } catch {}
      const r = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const cfg = r.rows[0];
      const mysql = await getMysql2Local();
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      const conn = await mysql.createConnection({ host: cfg.host, port: Number(cfg.port||3306), user: cfg.user, password: cfg.password || '', database: cfg.database, ssl });
      try {
        const tableAGL = `\`${prefix}attribute_group_lang\``;
        const tableL = `\`${prefix}lang\``;

        // Collect all active languages to target (exclude fromLangId)
        const [langs] = await conn.query(`SELECT id_lang, iso_code FROM ${tableL}`);
        const targets = (langs||[]).map(x=>Number(x.id_lang)).filter(id=>Number.isFinite(id) && id !== fromLangId);

        // Pull all source rows once (optionally start from a specific id)
        let sqlSrc = `SELECT id_attribute_group, name, public_name FROM ${tableAGL} WHERE id_lang = ?`;
        const argsSrc = [fromLangId];
        if (startFrom && Number.isFinite(startFrom)) { sqlSrc += ` AND id_attribute_group >= ?`; argsSrc.push(startFrom); }
        const [srcRows] = await conn.query(sqlSrc, argsSrc);

        const out = [];
        // Forward admin token/cookie for prompt API
        const port = Number(process.env.PORT || 3010);
        const base = `http://127.0.0.1:${port}`;
        const headers = { 'Content-Type': 'application/json' };
        try { const tok = String(req.headers['x-admin-token'] || process.env.ADMIN_TOKEN || '').trim(); if (tok) headers['X-Admin-Token'] = tok; const cookie = req.headers['cookie']; if (cookie) headers['Cookie'] = String(cookie); } catch {}

        const promptId = String(b.prompt_config_id || '').trim();
        if (!promptId) return res.status(400).json({ ok:false, error:'prompt_required' });

        async function translateText(text, fromIso, toIso) {
          const input = [
            'Translate the short label accurately, keep it concise and natural.',
            'Return JSON only: { "text": string }',
            `From: ${fromIso}, To: ${toIso}`,
            'Text:', String(text||'')
          ].join('\n');
          const rTest = await fetch(`${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`, { method:'POST', headers, body: JSON.stringify({ input }) });
          const txt = await rTest.text(); let j=null; try { j = txt ? JSON.parse(txt) : null; } catch {}
          if (!rTest.ok || !j || j.ok === false) return String(text||'');
          const obj = j && j.text ? JSON.parse(j.text) : (typeof j === 'object' ? j : null);
          const out = (obj && typeof obj.text === 'string') ? obj.text : String(text||'');
          return out;
        }

        // Resolve ISO for from/to
        const isoById = new Map(); for (const l of (langs||[])) { isoById.set(Number(l.id_lang), String(l.iso_code||'')); }
        const fromIso = isoById.get(fromLangId) || '';

        for (const row of (srcRows||[])) {
          const gid = Number(row.id_attribute_group);
          const srcName = String(row.name||'');
          const srcPub = String(row.public_name||'');
          for (const toId of targets) {
            const toIso = isoById.get(toId) || '';
            let nameTr = await translateText(srcName, fromIso, toIso);
            if (nameTr.length > 128) nameTr = nameTr.slice(0,128);
            let pubTr = await translateText(srcPub, fromIso, toIso);
            if (pubTr.length > 64) pubTr = pubTr.slice(0,64);
            await conn.execute(
              `INSERT INTO ${tableAGL} (id_attribute_group, id_lang, name, public_name) VALUES (?,?,?,?)
               ON DUPLICATE KEY UPDATE name=VALUES(name), public_name=VALUES(public_name)`,
              [gid, toId, nameTr, pubTr]
            );
            out.push({ id_attribute_group: gid, to_lang: toId, updated: true });
          }
        }
        return res.json({ ok:true, items: out });
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}
