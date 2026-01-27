function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerDbMysqlProfilesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  // List profiles
  app.get('/api/db-mysql/profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const args = [];
      const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT id, name, host, port, "database", db_user, ssl, is_default, table_prefixes, org_id, tools, created_at, updated_at FROM mod_db_mysql_profiles${whereOrg} ORDER BY updated_at DESC`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // ----- Generate tools/resources/templates from an Automation Suite Prompt, then apply to this profile -----
  // Body: { prompt_config_id: string, context?: object }
  app.post('/api/db-mysql/profiles/:id/generate-from-prompt', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const promptId = String(b.prompt_config_id || '').trim();
    if (!promptId) return res.status(400).json({ ok:false, error:'bad_request', message:'prompt_config_id required' });
    const orgId = pickOrgId(req);
    try {
      // Load profile basics for context
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT id, name, host, port, "database", db_user, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const prof = r.rows[0] || {};

      // Build an input instruction for the selected Automation Suite prompt
      // The prompt should return a single JSON object with keys: tools, resources, resourceTemplates
      const ctxIn = (b.context && typeof b.context === 'object') ? b.context : {};
      const context = {
        profile: {
          id: prof.id,
          name: prof.name,
          host: prof.host,
          port: prof.port,
          database: prof.database,
          db_user: prof.db_user,
          ssl: !!prof.ssl,
        },
        db_flavor: ctxIn.db_flavor || 'mysql',
        notes: ctxIn.notes || 'Generate practical tools/resources/templates for this MySQL profile. Output JSON only.'
      };
      const input = [
        'You are generating an MCP profile configuration for a MySQL database.',
        'Return a single JSON object with fields: tools, resources, resourceTemplates.',
        'Strict rules:',
        '- Valid JSON only (no comments, no trailing commas, no code fences).',
        '- tools: array of { name, description?, config? } (config is an object).',
        '- resources: array of { uri, name?, description?, mimeType? }.',
        '- resourceTemplates: array of { name, description?, inputSchema }. inputSchema is a JSON Schema object.',
        '- Escape backslashes properly inside JSON strings.',
        'Context follows as JSON:',
        JSON.stringify(context)
      ].join('\n');

      // Call the Automation Suite prompt tester endpoint to get model output
      const port = Number(process.env.PORT || 3010);
      const base = `http://127.0.0.1:${port}`;
      const headers = { 'Content-Type': 'application/json' };
      // Forward admin token if available so requireAdmin passes
      try {
        const t = String(process.env.ADMIN_TOKEN || '').trim();
        if (t) headers['X-Admin-Token'] = t;
      } catch {}
      const rTest = await fetch(`${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input })
      });
      const text = await rTest.text();
      let jsonTest = null; try { jsonTest = text ? JSON.parse(text) : null; } catch {}
      if (!rTest.ok) {
        const msg = (jsonTest && (jsonTest.message || jsonTest.error)) || text || 'prompt_test_failed';
        return res.status(502).json({ ok:false, error:'prompt_test_failed', message: String(msg) });
      }
      const outText = (jsonTest && jsonTest.text) || '';
      if (!outText || typeof outText !== 'string') return res.status(502).json({ ok:false, error:'invalid_prompt_output', message:'Empty output from prompt' });
      let out;
      try { out = JSON.parse(outText); }
      catch (e) { return res.status(400).json({ ok:false, error:'invalid_json_from_prompt', message: e?.message || String(e) }); }

      const toArray = (x) => (Array.isArray(x) ? x : []);
      const tools = toArray(out.tools).map(t => ({ name: String(t?.name||'').trim(), description: String(t?.description||''), config: (t?.config && typeof t.config==='object') ? t.config : {} })).filter(t=>t.name);
      const resources = toArray(out.resources).map(x => ({ uri: String(x?.uri||'').trim(), name: String(x?.name||''), description: String(x?.description||''), ...(x?.mimeType? { mimeType: String(x.mimeType) } : {}) })).filter(x=>x.uri);
      const templates = toArray(out.resourceTemplates).map(x => ({ name: String(x?.name||'').trim(), description: String(x?.description||''), inputSchema: (x?.inputSchema && typeof x.inputSchema==='object') ? x.inputSchema : {} })).filter(x=>x.name);

      // Merge with current values (same logic as /apply-config)
      const r0 = await pool.query(`SELECT tools, resources, resource_templates FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      const curTools = Array.isArray(r0.rows[0].tools) ? r0.rows[0].tools : [];
      const curRes = Array.isArray(r0.rows[0].resources) ? r0.rows[0].resources : [];
      const curTpl = Array.isArray(r0.rows[0].resource_templates) ? r0.rows[0].resource_templates : [];
      const mergeBy = (key, cur, nxt) => {
        const map = new Map();
        for (const it of (cur||[])) { const k = String(it?.[key]||'').trim().toLowerCase(); if (k) map.set(k, it); }
        for (const it of (nxt||[])) { const k = String(it?.[key]||'').trim().toLowerCase(); if (k) map.set(k, it); }
        return Array.from(map.values());
      };
      const nextTools = tools.length ? mergeBy('name', curTools, tools) : curTools;
      const nextRes = resources.length ? mergeBy('uri', curRes, resources) : curRes;
      const nextTpl = templates.length ? mergeBy('name', curTpl, templates) : curTpl;

      await pool.query(`UPDATE mod_db_mysql_profiles SET tools=$1::jsonb, resources=$2::jsonb, resource_templates=$3::jsonb, updated_at=NOW() WHERE id=$4`, [JSON.stringify(nextTools), JSON.stringify(nextRes), JSON.stringify(nextTpl), id]);
      return res.json({ ok:true, tools: nextTools, resources: nextRes, resourceTemplates: nextTpl });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message||e) });
    }
  });

  // ----- Prompt-assisted design for a single tool (does NOT auto-apply) -----
  // Body: { prompt_config_id: string, context?: object }
  // Returns: { ok: true, tool: { name, description?, config{} } }
  app.post('/api/db-mysql/profiles/:id/tools/:name/generate-from-prompt', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    const toolName = String(req.params.name || '').trim();
    if (!id || !toolName) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const promptId = String(b.prompt_config_id || '').trim();
    if (!promptId) return res.status(400).json({ ok:false, error:'bad_request', message:'prompt_config_id required' });
    const orgId = pickOrgId(req);
    try {
      // Load profile context
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT id, name, host, port, "database", db_user, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const prof = r.rows[0] || {};

      const ctxIn = (b.context && typeof b.context === 'object') ? b.context : {};
      const context = {
        profile: {
          id: prof.id,
          name: prof.name,
          host: prof.host,
          port: prof.port,
          database: prof.database,
          db_user: prof.db_user,
          ssl: !!prof.ssl,
        },
        tool: { name: toolName },
        db_flavor: ctxIn.db_flavor || 'mysql',
        notes: ctxIn.notes || 'Design a single MySQL tool. Output JSON only.'
      };
      const input = [
        'You are generating a single MCP tool configuration for a MySQL database.',
        'Return a single JSON object with fields: name, description, config.',
        'Strict rules:',
        '- Valid JSON only (no comments, no trailing commas, no code fences).',
        '- name must be the provided tool name.',
        '- description is a short human description.',
        '- config is an object with tool-specific options.',
        'Context follows as JSON:',
        JSON.stringify(context)
      ].join('\n');

      const port = Number(process.env.PORT || 3010);
      const base = `http://127.0.0.1:${port}`;
      const headers = { 'Content-Type': 'application/json' };
      try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
      const rTest = await fetch(`${base}/api/automation-suite/prompt-configs/${encodeURIComponent(promptId)}/test`, {
        method: 'POST', headers, body: JSON.stringify({ input })
      });
      const text = await rTest.text();
      let jsonTest = null; try { jsonTest = text ? JSON.parse(text) : null; } catch {}
      if (!rTest.ok) {
        const msg = (jsonTest && (jsonTest.message || jsonTest.error)) || text || 'prompt_test_failed';
        return res.status(502).json({ ok:false, error:'prompt_test_failed', message: String(msg) });
      }
      const outText = (jsonTest && jsonTest.text) || '';
      if (!outText || typeof outText !== 'string') return res.status(502).json({ ok:false, error:'invalid_prompt_output', message:'Empty output from prompt' });
      let outObj = null;
      try { outObj = JSON.parse(outText); } catch (e) { return res.status(502).json({ ok:false, error:'invalid_prompt_output', message:'Model output is not valid JSON' }); }

      // Normalize: accept { tool:{...} } or direct object or { tools:[...] }
      let tool = null;
      if (outObj && typeof outObj === 'object') {
        if (outObj.tool && typeof outObj.tool === 'object') tool = outObj.tool;
        else if (Array.isArray(outObj.tools) && outObj.tools.length) tool = outObj.tools.find((t)=>String(t?.name||'').trim().toLowerCase()===toolName.toLowerCase()) || outObj.tools[0];
        else tool = outObj;
      }
      if (!tool || typeof tool !== 'object') return res.status(502).json({ ok:false, error:'invalid_prompt_output', message:'No tool object in output' });
      const name = String(tool.name || toolName).trim();
      const description = typeof tool.description === 'string' ? tool.description : '';
      const config = (tool.config && typeof tool.config === 'object') ? tool.config : {};
      return res.json({ ok:true, tool: { name, description, config } });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Create profile
  app.post('/api/db-mysql/profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const orgId = b.org_id != null ? String(b.org_id) : (pickOrgId(req));
    try {
      const name = String(b.name || '').trim();
      const host = String(b.host || '').trim();
      const port = Number(b.port || 3306);
      const database = String(b.database || '').trim();
      const db_user = String(b.db_user || '').trim();
      const db_password = b.db_password != null ? String(b.db_password) : '';
      const ssl = !!b.ssl;
      const is_default = !!b.is_default;
      const table_prefixes = (b.table_prefixes == null ? null : String(b.table_prefixes));
      if (!name || !host || !database || !db_user) return res.status(400).json({ ok:false, error:'bad_request', message:'Missing required fields' });
      const r = await pool.query(
        `INSERT INTO mod_db_mysql_profiles (name, host, port, "database", db_user, db_password, ssl, is_default, table_prefixes, org_id, tools, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW()) RETURNING id`,
        [name, host, port, database, db_user, db_password, ssl, is_default, table_prefixes, orgId || null, JSON.stringify([])]
      );
      return res.json({ ok:true, id: r.rows[0].id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Read single profile (includes db_password for edit)
  app.get('/api/db-mysql/profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT id, name, host, port, "database", db_user, db_password, ssl, is_default, table_prefixes, org_id, tools, created_at, updated_at FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r || !r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Update profile
  app.put('/api/db-mysql/profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const orgId = pickOrgId(req);
    try {
      const fields = [];
      const vals = [];
      function set(col, val) { fields.push(col + '=$' + (vals.length+1)); vals.push(val); }
      if (b.name != null) set('name', String(b.name));
      if (b.host != null) set('host', String(b.host));
      if (b.port != null) set('port', Number(b.port));
      if (b.database != null) set('"database"', String(b.database));
      if (b.db_user != null) set('db_user', String(b.db_user));
      if (b.db_password != null) set('db_password', String(b.db_password));
      if (b.ssl != null) set('ssl', !!b.ssl);
      if (b.is_default != null) set('is_default', !!b.is_default);
      if (b.table_prefixes != null) set('table_prefixes', String(b.table_prefixes));
      if (b.tools && Array.isArray(b.tools)) set('tools', JSON.stringify(b.tools));
      set('updated_at', new Date());
      if (!fields.length) return res.json({ ok:true });
      vals.push(id);
      const args = vals.slice();
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $' + (args.length+1) + ')' : '');
      if (orgId) args.push(orgId);
      const sql = `UPDATE mod_db_mysql_profiles SET ${fields.join(', ')} WHERE id=$${vals.length}${whereOrg}`;
      await pool.query(sql, args);
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // ----- Tools per profile -----
  app.get('/api/db-mysql/profiles/:id/tools', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT tools FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const list = Array.isArray(r.rows[0].tools) ? r.rows[0].tools : [];
      return res.json({ ok:true, items: list });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Add or update a tool under a profile
  app.post('/api/db-mysql/profiles/:id/tools', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ ok:false, error:'bad_request', message:'name required' });
    const description = typeof b.description === 'string' ? b.description : '';
    const config = (b.config && typeof b.config === 'object') ? b.config : {};
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT tools FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const list = Array.isArray(r.rows[0].tools) ? r.rows[0].tools : [];
      const next = list.slice();
      const idx = next.findIndex(t => String(t?.name||'').trim().toLowerCase() === name.toLowerCase());
      const tool = { name, description, config };
      if (idx >= 0) next[idx] = tool; else next.push(tool);
      await pool.query(`UPDATE mod_db_mysql_profiles SET tools = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(next), id]);
      return res.json({ ok:true, items: next });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Remove a tool from a profile
  app.delete('/api/db-mysql/profiles/:id/tools/:name', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    const name = String(req.params.name || '').trim();
    if (!id || !name) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT tools FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const list = Array.isArray(r.rows[0].tools) ? r.rows[0].tools : [];
      const next = list.filter(t => String(t?.name||'').trim().toLowerCase() !== name.toLowerCase());
      await pool.query(`UPDATE mod_db_mysql_profiles SET tools = $1::jsonb, updated_at = NOW() WHERE id = $2`, [JSON.stringify(next), id]);
      return res.json({ ok:true, items: next });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // ----- Batch apply config (tools, resources, resourceTemplates) -----
  app.post('/api/db-mysql/profiles/:id/apply-config', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r0 = await pool.query(`SELECT tools, resources, resource_templates FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r0.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const curTools = Array.isArray(r0.rows[0].tools) ? r0.rows[0].tools : [];
      const curRes = Array.isArray(r0.rows[0].resources) ? r0.rows[0].resources : [];
      const curTpl = Array.isArray(r0.rows[0].resource_templates) ? r0.rows[0].resource_templates : [];

      const toArray = (x) => (Array.isArray(x) ? x : []);
      const tools = toArray(b.tools).map(t => ({ name: String(t?.name||'').trim(), description: String(t?.description||''), config: (t?.config && typeof t.config==='object') ? t.config : {} })).filter(t=>t.name);
      const resources = toArray(b.resources).map(x => ({ uri: String(x?.uri||'').trim(), name: String(x?.name||''), description: String(x?.description||''), ...(x?.mimeType? { mimeType: String(x.mimeType) } : {}) })).filter(x=>x.uri);
      const templates = toArray(b.resourceTemplates).map(x => ({ name: String(x?.name||'').trim(), description: String(x?.description||''), inputSchema: (x?.inputSchema && typeof x.inputSchema==='object') ? x.inputSchema : {} })).filter(x=>x.name);

      const mergeBy = (key, cur, next) => {
        const map = new Map();
        for (const it of (cur||[])) { const k = String(it?.[key]||'').trim().toLowerCase(); if (k) map.set(k, it); }
        for (const it of (next||[])) { const k = String(it?.[key]||'').trim().toLowerCase(); if (k) map.set(k, it); }
        return Array.from(map.values());
      };
      const nextTools = tools.length ? mergeBy('name', curTools, tools) : curTools;
      const nextRes = resources.length ? mergeBy('uri', curRes, resources) : curRes;
      const nextTpl = templates.length ? mergeBy('name', curTpl, templates) : curTpl;

      await pool.query(`UPDATE mod_db_mysql_profiles SET tools=$1::jsonb, resources=$2::jsonb, resource_templates=$3::jsonb, updated_at=NOW() WHERE id=$4`, [JSON.stringify(nextTools), JSON.stringify(nextRes), JSON.stringify(nextTpl), id]);
      return res.json({ ok:true, tools: nextTools, resources: nextRes, resourceTemplates: nextTpl });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // ----- Resources per profile -----
  app.get('/api/db-mysql/profiles/:id/resources', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT resources FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const list = Array.isArray(r.rows[0].resources) ? r.rows[0].resources : [];
      return res.json({ ok:true, items: list });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.post('/api/db-mysql/profiles/:id/resources', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const uri = String(b.uri || '').trim(); if (!uri) return res.status(400).json({ ok:false, error:'bad_request', message:'uri required' });
    const name = String(b.name || '').trim() || uri;
    const description = typeof b.description === 'string' ? b.description : '';
    const mimeType = typeof b.mimeType === 'string' ? b.mimeType : null;
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT resources FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const list = Array.isArray(r.rows[0].resources) ? r.rows[0].resources : [];
      const next = list.slice();
      const i = next.findIndex(x => String(x?.uri || '').trim().toLowerCase() === uri.toLowerCase());
      const item = { uri, name, description, ...(mimeType ? { mimeType } : {}) };
      if (i >= 0) next[i] = item; else next.push(item);
      await pool.query(`UPDATE mod_db_mysql_profiles SET resources = $1::jsonb, updated_at = NOW() WHERE id=$2`, [JSON.stringify(next), id]);
      return res.json({ ok:true, items: next });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.delete('/api/db-mysql/profiles/:id/resources/*', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    const uri = String(decodeURIComponent(req.params[0] || '')).trim();
    if (!id || !uri) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT resources FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const list = Array.isArray(r.rows[0].resources) ? r.rows[0].resources : [];
      const next = list.filter(x => String(x?.uri || '').trim().toLowerCase() !== uri.toLowerCase());
      await pool.query(`UPDATE mod_db_mysql_profiles SET resources = $1::jsonb, updated_at = NOW() WHERE id=$2`, [JSON.stringify(next), id]);
      return res.json({ ok:true, items: next });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // ----- Resource templates per profile -----
  app.get('/api/db-mysql/profiles/:id/resource-templates', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT resource_templates FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const list = Array.isArray(r.rows[0].resource_templates) ? r.rows[0].resource_templates : [];
      return res.json({ ok:true, items: list });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.post('/api/db-mysql/profiles/:id/resource-templates', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const name = String(b.name || '').trim(); if (!name) return res.status(400).json({ ok:false, error:'bad_request', message:'name required' });
    const description = typeof b.description === 'string' ? b.description : '';
    const inputSchema = (b.inputSchema && typeof b.inputSchema === 'object') ? b.inputSchema : {};
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT resource_templates FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const list = Array.isArray(r.rows[0].resource_templates) ? r.rows[0].resource_templates : [];
      const next = list.slice();
      const i = next.findIndex(x => String(x?.name || '').trim().toLowerCase() === name.toLowerCase());
      const tpl = { name, description, inputSchema };
      if (i >= 0) next[i] = tpl; else next.push(tpl);
      await pool.query(`UPDATE mod_db_mysql_profiles SET resource_templates = $1::jsonb, updated_at = NOW() WHERE id=$2`, [JSON.stringify(next), id]);
      return res.json({ ok:true, items: next });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.delete('/api/db-mysql/profiles/:id/resource-templates/:name', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    const name = String(req.params.name || '').trim();
    if (!id || !name) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT resource_templates FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const list = Array.isArray(r.rows[0].resource_templates) ? r.rows[0].resource_templates : [];
      const next = list.filter(x => String(x?.name || '').trim().toLowerCase() !== name.toLowerCase());
      await pool.query(`UPDATE mod_db_mysql_profiles SET resource_templates = $1::jsonb, updated_at = NOW() WHERE id=$2`, [JSON.stringify(next), id]);
      return res.json({ ok:true, items: next });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Delete profile
  app.delete('/api/db-mysql/profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      await pool.query(`DELETE FROM mod_db_mysql_profiles WHERE id=$1${whereOrg}`, args);
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
