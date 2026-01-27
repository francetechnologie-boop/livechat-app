import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export function registerMcp2Routes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ ok:false, error:'unauthorized' }); return null; });
  const getLoadedModules = ctx.getLoadedModules || (()=>[]);
  const repoRoot = ctx.repoRoot || process.cwd();

  function safeJsonParse(s, dflt) { try { return typeof s === 'string' ? JSON.parse(s) : (s || dflt); } catch { return dflt; } }
  function redactObj(obj) {
    try {
      const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
      const seen = new WeakSet();
      const redactKey = (k) => {
        const s = String(k || '').toLowerCase();
        return s.includes('password') || s.includes('token') || s.includes('apikey') || s.includes('api_key') || s.includes('secret') || s.includes('authorization');
      };
      const walk = (v) => {
        if (!isObj(v) && !Array.isArray(v)) return v;
        if (isObj(v)) {
          if (seen.has(v)) return '[circular]';
          seen.add(v);
          const out = {};
          for (const [k, vv] of Object.entries(v)) out[k] = redactKey(k) ? '****' : walk(vv);
          return out;
        }
        if (Array.isArray(v)) return v.map(walk);
        return v;
      };
      return walk(obj);
    } catch {
      return { redacted: true };
    }
  }
  function isPersistDisabled(opt){ try{ const o= typeof opt==='string'? JSON.parse(opt): (opt||{}); if(o.persist_disabled===true) return true; if(o.persist_enabled===false) return true; if(String(o.persist_mode||'').toLowerCase()==='disabled') return true; return false; } catch{ return false; } }
  function toArray(v) { return Array.isArray(v) ? v : []; }
  async function resolveTypeId(typeRef) {
    const ref = String(typeRef || '').trim();
    if (!ref || !pool || typeof pool.query !== 'function') return null;
    try {
      const r = await pool.query(
        `SELECT id
           FROM mod_mcp2_type
          WHERE id = $1 OR lower(code) = lower($1) OR lower(name) = lower($1)
          LIMIT 1`,
        [ref]
      );
      return r?.rows?.[0]?.id ? String(r.rows[0].id) : null;
    } catch {
      return null;
    }
  }
  // Type tools are pure mappings (type_id <-> tool_id). Definitions live in mod_mcp2_tool.
  async function hasToolCatalog() {
    try {
      if (!pool || typeof pool.query !== 'function') return false;
      const r = await pool.query(`SELECT to_regclass('public.mod_mcp2_tool') AS reg`);
      return !!(r?.rows?.[0]?.reg);
    } catch {
      return false;
    }
  }
  function splitPrefixes(input) {
    const raw = Array.isArray(input) ? input : (typeof input === 'string' ? input.split(/[,\n]+/) : []);
    return (raw || []).map((x) => String(x || '').trim()).filter(Boolean);
  }
  function buildPrefixPatterns(prefixes) {
    const out = [];
    for (const p0 of splitPrefixes(prefixes)) {
      const p = p0.trim();
      if (!p) continue;
      const dotBase = p.replace(/_/g, '.');
      const underscoreBase = p.replace(/\./g, '_');
      const dot = dotBase.endsWith('.') ? dotBase : `${dotBase}.`;
      const underscore = underscoreBase.endsWith('_') ? underscoreBase : `${underscoreBase}_`;
      out.push({ dot, underscore });
    }
    return out;
  }
  function pickSchema(obj) {
    try {
      const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
      if (!obj || typeof obj !== 'object') return {};
      const c = isObj(obj.config) ? obj.config : null;
      const cc = c && isObj(c.config) ? c.config : null;
      return (
        (isObj(obj.inputSchema) ? obj.inputSchema : null) ||
        (isObj(obj.paramSchema) ? obj.paramSchema : null) ||
        (isObj(obj.paramsSchema) ? obj.paramsSchema : null) ||
        (c && (isObj(c.inputSchema) ? c.inputSchema : (isObj(c.paramSchema) ? c.paramSchema : (isObj(c.paramsSchema) ? c.paramsSchema : null)))) ||
        (cc && (isObj(cc.inputSchema) ? cc.inputSchema : (isObj(cc.paramSchema) ? cc.paramSchema : (isObj(cc.paramsSchema) ? cc.paramsSchema : null)))) ||
        {}
      );
    } catch { return {}; }
  }
  function flattenConfig(cfg) {
    try {
      if (cfg && typeof cfg==='object' && cfg.config && typeof cfg.config==='object' && !cfg.sql && (cfg.config.sql || cfg.config.driver)) {
        return cfg.config;
      }
    } catch {}
    return (cfg && typeof cfg==='object') ? cfg : {};
  }
  function normalizeTypeToolRow(row) {
    try {
      const name = String(row?.name || '').trim();
      if (!name) return null;
      const toolId = String(row?.tool_id || row?.id || '').trim();
      const inputSchema = (row?.input_schema && typeof row.input_schema === 'object') ? row.input_schema : {};
      const cfg = flattenConfig(row?.code);
      return {
        tool_id: toolId || null,
        name,
        description: typeof row?.description === 'string' ? row.description : '',
        inputSchema,
        config: cfg,
      };
    } catch {
      return null;
    }
  }
  function namesEqual(a,b){
    const s=(x)=>String(x||'').trim();
    const u=(x)=>s(x).replace(/\./g,'_');
    return s(a)===s(b) || u(a)===u(b) || s(a).replace(/_/g,'.')===s(b);
  }
  function readModuleConfig(modId) {
    try {
      const candidates = [];
      try { if (repoRoot) candidates.push(path.join(repoRoot, 'modules', String(modId||'').trim(), 'module.config.json')); } catch {}
      try { if (ctx.backendDir) candidates.push(path.join(ctx.backendDir, '..', 'modules', String(modId||'').trim(), 'module.config.json')); } catch {}
      for (const p of candidates) {
        try {
          if (p && fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf8');
            return JSON.parse(raw);
          }
        } catch {}
      }
      return null;
    } catch { return null; }
  }
  async function listMcpToolModules() {
    // Merge DB-declared modules and filesystem manifests so modules like
    // "testmcp" with mcpTools in module.config.json always show up even when
    // the DB row hasn't set has_mcp_tool yet.
    const out = [];
    const seen = new Set();
    // 1) DB
    try {
      if (pool && typeof pool.query === 'function') {
        // Be tolerant to schema differences: some installs still use 'name' instead of 'module_name',
        // and 'has_mcp_tool' may be a smallint (0/1). Avoid SQL boolean filters; filter in JS.
        let rows = [];
        try {
          const r1 = await pool.query(`SELECT module_name AS id, module_name AS name, has_mcp_tool, mcp_tools FROM mod_module_manager_modules`);
          rows = Array.isArray(r1?.rows) ? r1.rows : [];
        } catch (e1) {
          try {
            const r2 = await pool.query(`SELECT name AS id, name AS name, has_mcp_tool, mcp_tools FROM mod_module_manager_modules`);
            rows = Array.isArray(r2?.rows) ? r2.rows : [];
          } catch (e2) {
            try { ctx.logToFile?.(`[mcp2] modules discovery (DB) error: ${e1?.message || e1} ; fallback error: ${e2?.message || e2}`); } catch {}
            rows = [];
          }
        }
        const toBool = (v) => {
          try {
            if (v === true) return true;
            if (v === false) return false;
            const s = String(v).trim().toLowerCase();
            return s === '1' || s === 't' || s === 'true' || s === 'yes' || s === 'y';
          } catch { return false; }
        };
        for (const row of rows) {
          const id = String(row.id || row.name || '').trim();
          if (!id) continue;
          const name = row.name || id;
          const tools = Array.isArray(row.mcp_tools) ? row.mcp_tools : [];
          const has = toBool(row.has_mcp_tool) || tools.length > 0;
          if (!has) continue;
          out.push({ id, name, tools });
          seen.add(id);
        }
        try { ctx.logToFile?.(`[mcp2] modules discovery (DB) found=${rows.length}`); } catch {}
      }
    } catch (e) {
      try { ctx.logToFile?.(`[mcp2] modules discovery (DB) error (outer): ${e?.message || e}`); } catch {}
    }

    // 2) Filesystem scan
    try {
      const roots = [];
      try { if (repoRoot) roots.push(path.join(repoRoot, 'modules')); } catch {}
      try { if (ctx.backendDir) roots.push(path.join(ctx.backendDir, '..', 'modules')); } catch {}
      for (const base of roots) {
        try {
          if (!base || !fs.existsSync(base)) continue;
          for (const ent of (fs.readdirSync(base, { withFileTypes: true })||[])) {
            if (!ent.isDirectory()) continue;
            const id = String(ent.name);
            if (seen.has(id)) continue;
            const cfg = readModuleConfig(id) || {};
            const has = !!cfg.hasMcpTool || Array.isArray(cfg.mcpTools);
            if (!has) continue;
            const tools = Array.isArray(cfg.mcpTools) ? cfg.mcpTools : [];
            out.push({ id, name: (cfg && cfg.name) || id, tools });
            seen.add(id);
          }
        } catch {}
      }
      try { ctx.logToFile?.(`[mcp2] modules discovery (merged) total=${out.length}`); } catch {}
    } catch {}

    // 3) Loader fallback for any remaining loaded modules
    try {
      if (typeof getLoadedModules === 'function') {
        const loaded = (getLoadedModules()||[]).map(m=>m && m.id).filter(Boolean);
        for (const id of loaded) {
          if (seen.has(id)) continue;
          const cfg = readModuleConfig(id) || {};
          const has = !!cfg.hasMcpTool || Array.isArray(cfg.mcpTools);
          if (!has) continue;
          const tools = Array.isArray(cfg.mcpTools) ? cfg.mcpTools : [];
          out.push({ id, name: (cfg && cfg.name) || id, tools });
          seen.add(id);
        }
      }
    } catch {}
    return out;
  }

  function hasTransportMounted() {
    try {
      const stack = (app && app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];
      const seen = { stream:false, events:false, alias:false };
      const checkLayer = (layer) => {
        try {
          if (!layer) return;
          if (layer.route && layer.route.path) {
            const p = String(layer.route.path);
            if (p.includes('/mcp2/:name/stream')) seen.stream = true;
            if (p.includes('/mcp2/:name/events')) seen.events = true;
            if (p.includes('/api/mcp2/transport/:name/stream')) seen.alias = true;
          } else if (Array.isArray(layer.handle?.stack)) {
            for (const sub of layer.handle.stack) checkLayer(sub);
          }
        } catch {}
      };
      for (const l of stack) checkLayer(l);
      return !!(seen.stream || seen.events || seen.alias);
    } catch { return false; }
  }

  // ----- Kinds CRUD (mod_mcp2_kind)
  app.get('/api/mcp2/kinds', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const r = await pool.query(`SELECT id, code, name, description, org_id, created_at, updated_at FROM mod_mcp2_kind ORDER BY lower(code)`); return res.json({ ok:true, items:r.rows }); } catch(e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });
  app.post('/api/mcp2/kinds', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const b=req.body||{}; const id=`m2k_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`; const code=String(b.code||'').trim(); if(!code) return res.status(400).json({ ok:false, error:'bad_request' }); const name=String(b.name||'').trim()||code; const description=(typeof b.description==='string'&&b.description)||null; const r=await pool.query(`INSERT INTO mod_mcp2_kind (id, code, name, description, created_at, updated_at) VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING id, code, name, description, created_at, updated_at`, [id,code,name,description]); return res.status(201).json({ ok:true, item:r.rows[0] }); } catch(e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });
  app.patch('/api/mcp2/kinds/:id', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const id=String(req.params.id||'').trim(); const allowed=new Set(['code','name','description','org_id']); const ent=Object.entries(req.body||{}).filter(([k])=>allowed.has(k)); if(!ent.length) return res.status(400).json({ ok:false, error:'bad_request' }); const sets=ent.map(([k],i)=>`${k} = $${i+1}`); const vals=ent.map(([,v])=>v); sets.push('updated_at = NOW()'); const r=await pool.query(`UPDATE mod_mcp2_kind SET ${sets.join(', ')} WHERE id=$${vals.length+1} RETURNING id, code, name, description, created_at, updated_at`, [...vals,id]); if(!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' }); return res.json({ ok:true, item:r.rows[0] }); } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });
  app.delete('/api/mcp2/kinds/:id', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const id=String(req.params.id||'').trim(); await pool.query(`DELETE FROM mod_mcp2_kind WHERE id=$1`, [id]); return res.json({ ok:true }); } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });

  // ----- Types CRUD (mod_mcp2_type)
  app.get('/api/mcp2/types', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const r = await pool.query(`SELECT id, code, name, description, tool_prefix, org_id, created_at, updated_at FROM mod_mcp2_type ORDER BY lower(code)`); return res.json({ ok:true, items:r.rows }); } catch(e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });
  app.post('/api/mcp2/types', async (req, res) => {
    const u=requireAdmin(req,res); if(!u) return;
    try {
      const b=req.body||{};
      const id=`m2t_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
      const code=String(b.code||'').trim();
      if(!code) return res.status(400).json({ ok:false, error:'bad_request' });
      const name=String(b.name||'').trim()||code;
      const description=(typeof b.description==='string'&&b.description)||null;
      const tool_prefix = (typeof b.tool_prefix === 'string' && b.tool_prefix.trim()) ? b.tool_prefix.trim() : null;
      const org_id = (b.org_id != null && String(b.org_id).trim()) ? String(b.org_id).trim() : null;
      const r=await pool.query(
        `INSERT INTO mod_mcp2_type (id, code, name, description, tool_prefix, org_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
         RETURNING id, code, name, description, tool_prefix, org_id, created_at, updated_at`,
        [id,code,name,description,tool_prefix,org_id]
      );
      return res.status(201).json({ ok:true, item:r.rows[0] });
    } catch(e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });
  app.patch('/api/mcp2/types/:id', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const id=String(req.params.id||'').trim(); const allowed=new Set(['code','name','description','tool_prefix','org_id']); const ent=Object.entries(req.body||{}).filter(([k])=>allowed.has(k)); if(!ent.length) return res.status(400).json({ ok:false, error:'bad_request' }); const sets=ent.map(([k],i)=>`${k} = $${i+1}`); const vals=ent.map(([,v])=>v); sets.push('updated_at = NOW()'); const r=await pool.query(`UPDATE mod_mcp2_type SET ${sets.join(', ')} WHERE id=$${vals.length+1} RETURNING id, code, name, description, tool_prefix, created_at, updated_at`, [...vals,id]); if(!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' }); return res.json({ ok:true, item:r.rows[0] }); } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });
  app.delete('/api/mcp2/types/:id', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const id=String(req.params.id||'').trim(); await pool.query(`DELETE FROM mod_mcp2_type WHERE id=$1`, [id]); return res.json({ ok:true }); } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });

  // NOTE: Tool definitions live in mod_mcp2_tool (catalog). Type tools are mappings only.

  // ----- Type standard tools (mod_mcp2_type_tool) -----
  app.get('/api/mcp2/types/:id/tools', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const typeId = String(req.params.id || '').trim();
      if (!typeId) return res.status(400).json({ ok:false, error:'bad_request' });
      const hasType = await pool.query(`SELECT 1 FROM mod_mcp2_type WHERE id=$1 LIMIT 1`, [typeId]);
      if (!hasType.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const useCatalog = await hasToolCatalog();
      const r = useCatalog
        ? await pool.query(
          `SELECT tt.type_id, tt.tool_id, tt.created_at, tt.org_id,
                  t.name,
                  t.description,
                  t.input_schema,
                  t.code,
                  t.version
             FROM mod_mcp2_type_tool tt
             JOIN mod_mcp2_tool t ON t.id = tt.tool_id
            WHERE tt.type_id = $1
            ORDER BY lower(t.name)`,
          [typeId]
        )
        : await pool.query(
          `SELECT type_id, tool_id, created_at, org_id
             FROM mod_mcp2_type_tool
            WHERE type_id = $1
            ORDER BY tool_id`,
          [typeId]
        );
      const items = (r.rows || []).map((row) => ({
        type_id: row.type_id,
        tool_id: row.tool_id,
        created_at: row.created_at || null,
        org_id: row.org_id || null,
        tool: useCatalog ? {
          id: row.tool_id,
          name: row.name,
          description: row.description,
          input_schema: row.input_schema,
          code: row.code,
          version: row.version,
        } : { id: row.tool_id, name: row.tool_id, description: '', input_schema: { type:'object' }, code: null, version: 1 },
      }));
      return res.json({ ok:true, items });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });
  app.post('/api/mcp2/types/:id/tools', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const typeId = String(req.params.id || '').trim();
      if (!typeId) return res.status(400).json({ ok:false, error:'bad_request' });
      const b = req.body || {};
      const tool = (b.tool && typeof b.tool === 'object') ? b.tool : b;
      const name = String(tool.name || '').trim();
      const description = (typeof tool.description === 'string') ? tool.description : null;
      const inputSchema = (tool.input_schema && typeof tool.input_schema === 'object')
        ? tool.input_schema
        : ((tool.inputSchema && typeof tool.inputSchema === 'object') ? tool.inputSchema : null);
      const code = (tool.code && typeof tool.code === 'object') ? tool.code : null;
      const version = Number.isFinite(Number(tool.version)) ? Number(tool.version) : 1;

      const hasType = await pool.query(`SELECT 1 FROM mod_mcp2_type WHERE id=$1 LIMIT 1`, [typeId]);
      if (!hasType.rowCount) return res.status(404).json({ ok:false, error:'type_not_found' });

      const useCatalog = await hasToolCatalog();
      let toolId = String(tool.tool_id || tool.toolId || tool.id || '').trim();
      if (useCatalog) {
        if (!name && !toolId) return res.status(400).json({ ok:false, error:'bad_request', message:'tool.name_required' });
        // Upsert tool into catalog; avoid relying on UNIQUE(name) (some installs don't have it).
        if (!toolId) {
          try {
            const exName = name ? await pool.query(`SELECT id FROM mod_mcp2_tool WHERE lower(name)=lower($1) ORDER BY updated_at DESC LIMIT 1`, [name]) : null;
            const byNameId = exName?.rows?.[0]?.id ? String(exName.rows[0].id) : '';
            if (byNameId) toolId = byNameId;
          } catch {}
        }
        if (!toolId) toolId = `m2tool_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
        // Ensure tool exists; if not, create it
        const ex = await pool.query(`SELECT 1 FROM mod_mcp2_tool WHERE id=$1 LIMIT 1`, [toolId]);
        if (!ex.rowCount) {
          await pool.query(
            `INSERT INTO mod_mcp2_tool (id, name, description, input_schema, code, version, created_at, updated_at, org_id)
             VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,NOW(),NOW(),$7)`,
            [toolId, name || toolId, description, inputSchema ? JSON.stringify(inputSchema) : null, code ? JSON.stringify(code) : null, version, tool.org_id || null]
          );
        } else if (name || description || inputSchema || code) {
          await pool.query(
            `UPDATE mod_mcp2_tool
                SET name=COALESCE(NULLIF($2,''), name),
                    description=COALESCE($3, description),
                    input_schema=COALESCE($4::jsonb, input_schema),
                    code=COALESCE($5::jsonb, code),
                    version=COALESCE($6, version),
                    updated_at=NOW()
              WHERE id=$1`,
            [toolId, name, description, inputSchema ? JSON.stringify(inputSchema) : null, code ? JSON.stringify(code) : null, version]
          );
        }
        // Link tool to type
        await pool.query(
          `INSERT INTO mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
           VALUES ($1,$2,NOW(),$3)
           ON CONFLICT (type_id, tool_id) DO NOTHING`,
          [typeId, toolId, tool.org_id || null]
        );
        return res.status(201).json({ ok:true, type_id: typeId, tool_id: toolId });
      }
      // Fallback: no catalog, store definitions in type_tool
      if (!name && !toolId) return res.status(400).json({ ok:false, error:'bad_request', message:'tool.name_required' });
      if (!toolId) toolId = `m2tt_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
      await pool.query(
        `INSERT INTO mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
         VALUES ($1,$2,NOW(),$3)
         ON CONFLICT (type_id, tool_id) DO NOTHING`,
        [typeId, toolId, tool.org_id || null]
      );
      return res.status(201).json({ ok:true, type_id: typeId, tool_id: toolId });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });
  app.patch('/api/mcp2/types/:id/tools/:toolId', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const typeId = String(req.params.id || '').trim();
      const toolId = String(req.params.toolId || '').trim();
      if (!typeId || !toolId) return res.status(400).json({ ok:false, error:'bad_request' });
      const b = req.body || {};
      const allowed = new Set(['name', 'description', 'input_schema', 'inputSchema', 'code', 'version']);
      const ent = Object.entries(b).filter(([k]) => allowed.has(k));
      if (!ent.length) return res.status(400).json({ ok:false, error:'bad_request' });
      const useCatalog = await hasToolCatalog();
      if (useCatalog) {
        // Ensure mapping exists
        const ex = await pool.query(`SELECT 1 FROM mod_mcp2_type_tool WHERE type_id=$1 AND tool_id=$2 LIMIT 1`, [typeId, toolId]);
        if (!ex.rowCount) return res.status(404).json({ ok:false, error:'not_found' });

        // Update catalog tool (if fields provided)
        const updates = {};
        for (const [k0, v0] of ent) {
          const k = (k0 === 'inputSchema') ? 'input_schema' : k0;
          updates[k] = v0;
        }
        if (Object.keys(updates).length) {
          const sets = [];
          const vals = [toolId];
          const push = (sql, v) => { sets.push(sql.replace('$X', `$${vals.length + 1}`)); vals.push(v); };
          if (Object.prototype.hasOwnProperty.call(updates, 'name')) push('name = $X', String(updates.name || '').trim() || null);
          if (Object.prototype.hasOwnProperty.call(updates, 'description')) push('description = $X', updates.description);
          if (Object.prototype.hasOwnProperty.call(updates, 'input_schema')) push('input_schema = $X::jsonb', (updates.input_schema && typeof updates.input_schema === 'object') ? JSON.stringify(updates.input_schema) : null);
          if (Object.prototype.hasOwnProperty.call(updates, 'code')) push('code = $X::jsonb', (updates.code && typeof updates.code === 'object') ? JSON.stringify(updates.code) : null);
          if (Object.prototype.hasOwnProperty.call(updates, 'version')) push('version = $X', Number.isFinite(Number(updates.version)) ? Number(updates.version) : 1);
          sets.push('updated_at = NOW()');
          try { await pool.query(`UPDATE mod_mcp2_tool SET ${sets.join(', ')} WHERE id=$1`, vals); } catch {}
        }

        // Return combined view
        const r2 = await pool.query(
          `SELECT tt.type_id, tt.tool_id, tt.created_at, tt.org_id,
                  t.name, t.description, t.input_schema, t.code, t.version
             FROM mod_mcp2_type_tool tt
             JOIN mod_mcp2_tool t ON t.id = tt.tool_id
            WHERE tt.type_id=$1 AND tt.tool_id=$2
            LIMIT 1`,
          [typeId, toolId]
        );
        const row = r2?.rows?.[0];
        if (!row) return res.json({ ok:true });
        return res.json({
          ok:true,
          item: {
            type_id: row.type_id,
            tool_id: row.tool_id,
            created_at: row.created_at || null,
            org_id: row.org_id || null,
            name: row.name,
            description: row.description,
            input_schema: row.input_schema,
            code: row.code,
            version: row.version,
          }
        });
      }
      return res.status(400).json({ ok:false, error:'tool_catalog_missing' });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });
  app.delete('/api/mcp2/types/:id/tools/:toolId', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const typeId = String(req.params.id || '').trim();
      const toolId = String(req.params.toolId || '').trim();
      if (!typeId || !toolId) return res.status(400).json({ ok:false, error:'bad_request' });
      await pool.query(`DELETE FROM mod_mcp2_type_tool WHERE type_id=$1 AND tool_id=$2`, [typeId, toolId]);
      try {
        await pool.query(
          `DELETE FROM mod_mcp2_server_tool st
            USING mod_mcp2_server s
           WHERE st.server_id = s.id
             AND s.type_id = $1
             AND st.tool_id = $2`,
          [typeId, toolId]
        );
      } catch {}
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // Auto-link tools from catalog using type.tool_prefix (or type.code) prefixes.
  app.post('/api/mcp2/types/:id/link-tools', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const typeId = String(req.params.id || '').trim();
      if (!typeId) return res.status(400).json({ ok:false, error:'bad_request' });
      if (!(await hasToolCatalog())) return res.status(400).json({ ok:false, error:'tool_catalog_missing' });

      const rt = await pool.query(`SELECT id, code, tool_prefix, org_id FROM mod_mcp2_type WHERE id=$1 LIMIT 1`, [typeId]);
      if (!rt.rowCount) return res.status(404).json({ ok:false, error:'type_not_found' });
      const typeRow = rt.rows[0] || {};
      const body = req.body || {};
      const supplied = splitPrefixes(body.prefixes);
      const prefixes = supplied.length ? supplied : splitPrefixes(typeRow.tool_prefix || typeRow.code);
      const patterns = buildPrefixPatterns(prefixes);
      if (!patterns.length) return res.status(400).json({ ok:false, error:'no_prefixes', message:'Set type.tool_prefix (e.g. psdb, psapi) or pass { prefixes }' });

      const conds = [];
      const vals = [];
      for (const p of patterns) {
        vals.push(p.dot);
        conds.push(`name ILIKE $${vals.length} || '%'`);
        vals.push(p.underscore);
        conds.push(`name ILIKE $${vals.length} || '%'`);
      }
      const tools = await pool.query(`SELECT id, org_id FROM mod_mcp2_tool WHERE ${conds.join(' OR ')}`, vals);
      const ids = (tools.rows || []).map((r) => String(r.id || '').trim()).filter(Boolean);
      if (!ids.length) return res.json({ ok:true, inserted: 0, tools: 0 });

      const insertRes = await pool.query(
        `INSERT INTO mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
         SELECT $1, t.id, NOW(), COALESCE($2, t.org_id)
           FROM mod_mcp2_tool t
          WHERE t.id = ANY($3::text[])
         ON CONFLICT (type_id, tool_id) DO NOTHING`,
        [typeId, typeRow.org_id || null, ids]
      );
      let inserted = 0;
      try { inserted = Number(insertRes?.rowCount || 0) || 0; } catch {}

      // Best-effort: copy missing fields from catalog into type_tool snapshot columns (if present)
      return res.json({ ok:true, inserted, tools: ids.length });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) });
    }
  });

  // Modules exposing MCP tools (from module.config.json)
  app.get('/api/mcp2/modules', async (_req, res) => {
    try {
      const items = await listMcpToolModules();
      // Add hasProfil by reading module.config.json
      const out = (items||[]).map((it) => {
        let hasProfil = false;
        try {
          const p = path.join(repoRoot, 'modules', it.id, 'module.config.json');
          if (fs.existsSync(p)) { const j = JSON.parse(fs.readFileSync(p, 'utf8')); hasProfil = !!j.hasProfil; }
        } catch {}
        return { ...it, hasProfil };
      });
      return res.json({ ok:true, items: out });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // ----- Servers CRUD (mod_mcp2_server)
  app.get('/api/mcp2/servers', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const r=await pool.query(`SELECT id, name, kind_id, type_id, http_base, ws_url, stream_url, sse_url, token, enabled, options, notes, org_id, created_at, updated_at FROM mod_mcp2_server ORDER BY updated_at DESC`); return res.json({ ok:true, items:r.rows }); } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });
  app.post('/api/mcp2/servers', async (req, res) => {
    const u=requireAdmin(req,res); if(!u) return;
    try {
      const b=req.body||{};
      const id=`m2s_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
      const name=String(b.name||'').trim();
      if(!name) return res.status(400).json({ ok:false, error:'bad_request' });
      const kind_id=(typeof b.kind_id==='string'&&b.kind_id.trim())||null;
      let type_id=(typeof b.type_id==='string'&&b.type_id.trim())||null;
      if (type_id) type_id = (await resolveTypeId(type_id)) || type_id;
      const http_base=(typeof b.http_base==='string'&&b.http_base.trim())||null;
      const ws_url=(typeof b.ws_url==='string'&&b.ws_url.trim())||null;
      const stream_url=(typeof b.stream_url==='string'&&b.stream_url.trim())||null;
      const sse_url=(typeof b.sse_url==='string'&&b.sse_url.trim())||null;
      let token=(typeof b.token==='string'? b.token : null);
      const enabled=!!b.enabled;
      const notes=(typeof b.notes==='string'&&b.notes)||null;
      let options=null; try{ if(b.options&&typeof b.options==='object'&&!Array.isArray(b.options)) options=b.options; else if(typeof b.options==='string'&&b.options.trim()) options=JSON.parse(b.options); }catch{}
      const requireAuth = (()=>{ try{ const o=(typeof b.options==='string')? JSON.parse(b.options): (b.options||{}); if (o && o.require_auth===false) return false; }catch{} return token && String(token).trim().length>0; })();
      if (!requireAuth) { token = null; }
      else { if (!token || !String(token).trim()) token=(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)); }
      // persist options including require_auth
      const finalOptions = { ...(options||{}), require_auth: !!requireAuth };
      // Columns: 13 total. We supply 11 parameters + NOW(), NOW() for timestamps.
      // Keep options as JSON using an explicit cast.
      const r=await pool.query(
        `INSERT INTO mod_mcp2_server (
            id, name, kind_id, type_id, http_base, ws_url, stream_url, sse_url, token, enabled, options, notes, created_at, updated_at
         ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::json,$12,NOW(),NOW()
         )
         RETURNING id, name, kind_id, type_id, http_base, ws_url, stream_url, sse_url, token, enabled, options, notes, created_at, updated_at`,
        [id, name, kind_id, type_id, http_base, ws_url, stream_url, sse_url, token, enabled, JSON.stringify(finalOptions||{}), notes]
      );
      // Best-effort: seed server-level tool toggles for its type so Server Tools is not empty.
      try {
        if (type_id) {
          await pool.query(
            `INSERT INTO mod_mcp2_server_tool (server_id, tool_id, enabled, created_at, updated_at, org_id)
             SELECT $1, tt.tool_id, TRUE, NOW(), NOW(), NULL
               FROM mod_mcp2_type_tool tt
              WHERE tt.type_id = $2
             ON CONFLICT (server_id, tool_id) DO NOTHING`,
            [id, type_id]
          );
        }
      } catch {}
      return res.status(201).json({ ok:true, item:r.rows[0] });
    } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });
  app.patch('/api/mcp2/servers/:id', async (req, res) => {
    const u=requireAdmin(req,res); if(!u) return;
    try {
      const id=String(req.params.id||'').trim();
      let prevTypeId = null;
      try {
        const prev = await pool.query(`SELECT type_id FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
        if (prev?.rowCount) prevTypeId = prev.rows[0]?.type_id ? String(prev.rows[0].type_id) : null;
      } catch {}
      const allowed=new Set(['name','kind_id','type_id','http_base','ws_url','stream_url','sse_url','token','enabled','options','notes']);
      const body = req.body || {};
      // Normalize: allow clearing token by sending empty string or null
      if (Object.prototype.hasOwnProperty.call(body,'token') && (!body.token || String(body.token).trim()==='')) body.token = null;
      // Ensure options.require_auth reflects token presence if provided
      if (body.options && typeof body.options==='object') {
        if (!Object.prototype.hasOwnProperty.call(body.options,'require_auth')) {
          body.options.require_auth = !!(body.token && String(body.token).length);
        }
      }
      const ent=Object.entries(body).filter(([k])=>allowed.has(k)).map(([k,v])=> (k==='options' && v && typeof v==='object')?[k,JSON.stringify(v)]:[k,v]);
      if(!ent.length) return res.status(400).json({ ok:false, error:'bad_request' });
      // Canonicalize type_id when clients send a type code/name
      for (const row of ent) {
        if (row[0] === 'type_id' && row[1] != null) {
          const next = await resolveTypeId(row[1]);
          if (next) row[1] = next;
        }
      }
      const sets=ent.map(([k],i)=> (k==='options'?`${k} = $${i+1}::json`:`${k} = $${i+1}`));
      const vals=ent.map(([,v])=>v);
      sets.push('updated_at = NOW()');
      const r=await pool.query(`UPDATE mod_mcp2_server SET ${sets.join(', ')} WHERE id=$${vals.length+1} RETURNING id, name, kind_id, type_id, http_base, ws_url, stream_url, sse_url, token, enabled, options, notes, created_at, updated_at`, [...vals,id]);
      if(!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      // If the type changed, sync server tool toggle rows for the new type.
      try {
        const nextTypeId = r.rows[0]?.type_id ? String(r.rows[0].type_id) : null;
        if (nextTypeId && nextTypeId !== prevTypeId) {
          await pool.query(
            `DELETE FROM mod_mcp2_server_tool st
              WHERE st.server_id = $1
                AND NOT EXISTS (
                  SELECT 1 FROM mod_mcp2_type_tool tt
                   WHERE tt.type_id = $2 AND tt.tool_id = st.tool_id
                )`,
            [id, nextTypeId]
          );
          await pool.query(
            `INSERT INTO mod_mcp2_server_tool (server_id, tool_id, enabled, created_at, updated_at, org_id)
             SELECT $1, tt.tool_id, TRUE, NOW(), NOW(), NULL
               FROM mod_mcp2_type_tool tt
              WHERE tt.type_id = $2
             ON CONFLICT (server_id, tool_id) DO NOTHING`,
            [id, nextTypeId]
          );
        }
      } catch {}
      return res.json({ ok:true, item:r.rows[0] });
    } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  async function findCatalogToolIdByName(toolName) {
    try {
      const name = String(toolName || '').trim();
      if (!name) return null;
      if (!(await hasToolCatalog())) return null;
      const r = await pool.query(
        `SELECT id
           FROM mod_mcp2_tool
          WHERE lower(name) = lower($1)
             OR lower(replace(name,'.','_')) = lower($1)
             OR lower(replace(name,'_','.')) = lower($1)
          LIMIT 1`,
        [name]
      );
      return r?.rows?.[0]?.id ? String(r.rows[0].id) : null;
    } catch {
      return null;
    }
  }

  // Server tools toggles (available tools come from type standard tools; enabled flags stored in mod_mcp2_server_tool)
  app.get('/api/mcp2/servers/:id/tools', async (req, res) => {
    try {
      const u = requireAdmin(req, res); if (!u) return;
      const id = String(req.params.id||'').trim();
      const r = await pool.query(`SELECT id, name, type_id, options FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const srv = r.rows[0];
      const opt = safeJsonParse(srv.options||{},{});
      const origin = String((opt&&opt.origin_module)||'').trim();
      const profileId = opt.origin_profile_id || null;

      const useCatalog = await hasToolCatalog();
      let items = [];
      let source = 'none';

      // Type standard tools (only source of truth for "available tools")
      const typeRef = String(srv.type_id || '').trim() || null;
      const resolvedTypeId = typeRef ? (await resolveTypeId(typeRef)) : null;
      const typeId = resolvedTypeId || typeRef;
	      if (useCatalog && typeId) {
	        try {
	          const rt = await pool.query(
	            `SELECT t.id AS tool_id,
	                    t.name,
	                    t.description,
	                    t.input_schema,
	                    t.code,
	                    COALESCE(st.enabled, TRUE) AS enabled
	               FROM mod_mcp2_type_tool tt
	               JOIN mod_mcp2_tool t ON t.id = tt.tool_id
	               LEFT JOIN mod_mcp2_server_tool st ON st.server_id = $1 AND st.tool_id = t.id
	              WHERE tt.type_id = $2
	              ORDER BY lower(t.name)`,
	            [id, typeId]
	          );
		          items = (rt.rows || []).map((row) => ({
		            tool_id: String(row.tool_id),
		            name: String(row.name || '').trim(),
		            description: String(row.description || ''),
		            inputSchema: (row.input_schema && typeof row.input_schema === 'object') ? row.input_schema : { type:'object' },
		            code: (() => {
		              const raw = row.code;
		              const obj = typeof raw === 'string' ? safeJsonParse(raw, {}) : raw;
		              return redactObj((obj && typeof obj === 'object') ? obj : {});
		            })(),
		            enabled: row.enabled !== false,
		            toggleable: true,
		          })).filter((x) => x.name);
		          source = 'type';
		        } catch {}
		      }
      return res.json({ ok:true, items, origin_module: origin, origin_profile_id: profileId, source });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) });
    }
  });
  app.patch('/api/mcp2/servers/:id/tools', async (req, res) => {
    try {
      const u=requireAdmin(req,res); if(!u) return;
      const id=String(req.params.id||'').trim();
      const body=req.body||{};
      const enabled=!!body.enabled;
      let toolId = (body.tool_id != null && String(body.tool_id).trim()) ? String(body.tool_id).trim() : null;
      const name=String(body.name||'').trim();
      if (!toolId && name) toolId = await findCatalogToolIdByName(name);
      if(!toolId) return res.status(400).json({ ok:false, error:'bad_request', message:'tool_id_or_name_required' });
      const r=await pool.query(`SELECT id FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if(!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      await pool.query(
        `INSERT INTO mod_mcp2_server_tool (server_id, tool_id, enabled, created_at, updated_at, org_id)
         VALUES ($1,$2,$3,NOW(),NOW(),NULL)
         ON CONFLICT (server_id, tool_id) DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=NOW()`,
        [id, toolId, enabled]
      );
      return res.json({ ok:true, item:{ tool_id: toolId, name: name || toolId, enabled } });
    } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // Seed type tools from the selected Origin Module profile (useful when a type has no standard tools yet).
  app.post('/api/mcp2/servers/:id/seed-type-tools', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const id = String(req.params.id || '').trim();
      const r0 = await pool.query(`SELECT id, type_id, org_id, options FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r0.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const srv = r0.rows[0] || {};
      const opt = safeJsonParse(srv.options || {}, {});
      const origin = String(opt.origin_module || '').trim();
      const profileId = opt.origin_profile_id || null;
      const typeRef = String(srv.type_id || '').trim();
      if (!typeRef) return res.status(400).json({ ok:false, error:'no_type_selected' });
      if (!origin || !profileId) return res.status(400).json({ ok:false, error:'no_profile_selected' });

      const resolved = await resolveTypeId(typeRef);
      const typeId = resolved || typeRef;
      const orgId = (srv.org_id != null && String(srv.org_id).trim()) ? String(srv.org_id).trim() : null;

      // Load tools from origin profile
      let list = [];
      if (origin === 'db-mysql') {
        const pid = Number(profileId || 0);
        if (!pid) return res.status(400).json({ ok:false, error:'bad_profile_id' });
        const rr = await pool.query(`SELECT tools FROM mod_db_mysql_profiles WHERE id=$1 LIMIT 1`, [pid]);
        const raw = rr?.rows?.[0]?.tools;
        list = Array.isArray(raw) ? raw : safeJsonParse(raw || '[]', []);
      } else {
        const port = Number(process.env.PORT || 3010);
        const base = `http://127.0.0.1:${port}`;
        const headers = { 'Content-Type': 'application/json' };
        try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
        const r2 = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(profileId)}/tools`, { headers });
        const j2 = await r2.json().catch(()=>({}));
        list = (r2.ok && Array.isArray(j2?.items)) ? j2.items : [];
      }

      const tools = (Array.isArray(list) ? list : []).map((t) => {
        const name = String(t?.name || '').trim();
        if (!name) return null;
        const description = String(t?.description || '');
        const inputSchema = pickSchema(t);
        const cfg = (t?.config && typeof t.config === 'object' && !Array.isArray(t.config)) ? t.config
          : ((t?.code && typeof t.code === 'object' && !Array.isArray(t.code)) ? t.code : {});
        const version = Number(t?.version || 1) || 1;
        return { name, description, inputSchema, config: cfg, version };
      }).filter(Boolean);

      const useCatalog = await hasToolCatalog();
      if (!useCatalog) return res.status(400).json({ ok:false, error:'tool_catalog_missing' });
      let catalog_upserts = 0;
      let type_links = 0;
      for (const t of tools) {
        // 1) Upsert tool into catalog
        const newId = `m2tool_${createHash('sha1').update(String(t.name)).digest('hex').slice(0, 16)}`;
        let toolId = '';
        try {
          const exName = await pool.query(`SELECT id FROM mod_mcp2_tool WHERE lower(name)=lower($1) ORDER BY updated_at DESC LIMIT 1`, [t.name]);
          toolId = exName?.rows?.[0]?.id ? String(exName.rows[0].id) : '';
        } catch {}
        toolId = toolId || newId;
        try {
          const ex = await pool.query(`SELECT 1 FROM mod_mcp2_tool WHERE id=$1 LIMIT 1`, [toolId]);
          if (!ex.rowCount) {
            await pool.query(
              `INSERT INTO mod_mcp2_tool (id, name, description, input_schema, code, version, created_at, updated_at, org_id)
               VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,NOW(),NOW(),$7)`,
              [toolId, t.name, t.description, JSON.stringify(t.inputSchema || { type:'object' }), JSON.stringify(t.config || {}), t.version, orgId]
            );
          } else {
            await pool.query(
              `UPDATE mod_mcp2_tool
                  SET name=COALESCE(NULLIF($2,''), name),
                      description=COALESCE($3, description),
                      input_schema=COALESCE($4::jsonb, input_schema),
                      code = CASE
                        WHEN $5::jsonb IS NULL OR $5::jsonb = '{}'::jsonb THEN mod_mcp2_tool.code
                        ELSE $5::jsonb
                      END,
                      version=COALESCE($6, version),
                      updated_at=NOW()
                WHERE id=$1`,
              [toolId, t.name, t.description, JSON.stringify(t.inputSchema || { type:'object' }), JSON.stringify(t.config || {}), t.version]
            );
          }
        } catch {}
        if (!toolId) continue;
        catalog_upserts += 1;

        // 2) Link tool to type (mapping only)
        const rLink = await pool.query(
          `INSERT INTO mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
           VALUES ($1,$2,NOW(),$3)
           ON CONFLICT (type_id, tool_id) DO NOTHING`,
          [typeId, toolId, orgId]
        );
        try { type_links += Number(rLink?.rowCount || 0) || 0; } catch {}
      }

      // 3) Ensure server-level toggle rows exist (default enabled)
      try {
        await pool.query(
          `INSERT INTO mod_mcp2_server_tool (server_id, tool_id, enabled, created_at, updated_at, org_id)
           SELECT $1, tt.tool_id, TRUE, NOW(), NOW(), NULL
             FROM mod_mcp2_type_tool tt
            WHERE tt.type_id = $2
           ON CONFLICT (server_id, tool_id) DO NOTHING`,
          [id, typeId]
        );
      } catch {}

      return res.json({ ok:true, type_id: typeId, catalog_upserts, type_links, tools_count: tools.length });
    } catch (e) {
      const msg = String(e?.message || e);
      return res.status(500).json({ ok:false, error:'server_error', message: msg });
    }
  });

  // Clear persisted arrays and optionally disable persistence
  app.post('/api/mcp2/servers/:id/clear-persisted', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const id = String(req.params.id||'').trim();
      const body = req.body || {};
      const disable = !!body.disablePersistence;
      const r0 = await pool.query(`SELECT options FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r0.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const opt = safeJsonParse(r0.rows[0].options||{},{});
      const cleared = { ...(opt||{}) };
      try { delete cleared.resources_enabled; } catch {}
      try { delete cleared.resource_templates_enabled; } catch {}
      const next = disable ? { ...cleared, persist_disabled: true, persist_enabled: false } : cleared;
      try { await pool.query(`DELETE FROM mod_mcp2_server_tool WHERE server_id=$1`, [id]); } catch {}
      await pool.query(`UPDATE mod_mcp2_server SET resources=NULL, resource_templates=NULL, options=$1::json, updated_at=NOW() WHERE id=$2`, [JSON.stringify(next), id]);
      return res.json({ ok:true, disabled: disable });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message||e) });
    }
  });

  // ----- Server Resources: list from profile/manifest and toggle enabled -----
  app.get('/api/mcp2/servers/:id/resources', async (req, res) => {
    try {
      const u = requireAdmin(req, res); if (!u) return;
      const id = String(req.params.id||'').trim();
      const r = await pool.query(`SELECT id, name, options, resources FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const srv = r.rows[0];
      const opt = safeJsonParse(srv.options||{},{});
      const origin = String((opt&&opt.origin_module)||'').trim();
      const profileId = opt.origin_profile_id || null;
      // Build available list from profile
      let available = [];
      let source = 'none';
      if (origin && profileId) {
        try {
          const port = Number(process.env.PORT || 3010);
          const base = `http://127.0.0.1:${port}`;
          const headers = { 'Content-Type': 'application/json' };
          try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
          const r2 = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(profileId)}/resources`, { headers });
          const j2 = await r2.json().catch(()=>({}));
          if (r2.ok && Array.isArray(j2?.items)) { available = j2.items; source = 'profile'; }
        } catch {}
      }
      // Enabled set from server-scoped resources and options map
      const enabledSet = new Set((Array.isArray(srv.resources)? srv.resources: []).map(x => String(x?.uri||'').trim().toLowerCase()));
      const map = (opt && typeof opt.resources_enabled==='object') ? opt.resources_enabled : {};
      const out = available.length ? available.map(x => {
        const key = String(x?.uri||'').trim().toLowerCase();
        let on = enabledSet.has(key);
        if (map.hasOwnProperty(x.uri)) on = !!map[x.uri];
        return { uri: x.uri, name: x.name||'', description: x.description||'', mimeType: x.mimeType||null, enabled: !!on };
      }) : (Array.isArray(srv.resources)? srv.resources.map(x => ({ uri:String(x?.uri||'').trim(), name:String(x?.name||''), description:String(x?.description||''), mimeType:x?.mimeType?String(x.mimeType):null, enabled:true })) : []);
      return res.json({ ok:true, items: out, origin_module: origin, origin_profile_id: profileId, source });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });
  app.patch('/api/mcp2/servers/:id/resources', async (req, res) => {
    try {
      const u = requireAdmin(req, res); if (!u) return;
      const id = String(req.params.id||'').trim();
      const body = req.body || {};
      const uri = String(body.uri||'').trim();
      const enabled = !!body.enabled;
      if (!uri) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`SELECT id, options, resources FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0];
      const opt = safeJsonParse(row.options||{},{});
      const map = (opt && typeof opt.resources_enabled==='object') ? opt.resources_enabled : {};
      map[uri] = enabled;
      const next = { ...(opt||{}), resources_enabled: map };
      // Update server-scoped resources when present; if absent, materialize from profile for auto-save
      let srv = Array.isArray(row.resources) ? row.resources.slice() : null;
      if (!srv) {
        try {
          const origin = String((opt&&opt.origin_module)||'').trim();
          const pid = opt.origin_profile_id || null;
          if (origin && pid) {
            const port = Number(process.env.PORT || 3010);
            const base = `http://127.0.0.1:${port}`;
            const headers = { 'Content-Type': 'application/json' };
            try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
            const rr = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resources`, { headers });
            const jr = await rr.json().catch(()=>({}));
            if (rr.ok && Array.isArray(jr?.items)) {
              srv = jr.items.map(x => ({ uri:String(x?.uri||'').trim(), name:String(x?.name||''), description:String(x?.description||''), mimeType: x?.mimeType? String(x.mimeType): null, enabled:(String(x?.uri||'').trim().toLowerCase() === uri.toLowerCase()) ? enabled : false }))
                             .filter(x=>x.uri);
            }
          }
        } catch {}
      }
      if (srv) {
        const i = srv.findIndex(x => String(x?.uri||'').trim().toLowerCase() === uri.toLowerCase());
        if (i >= 0) {
          srv[i] = { ...srv[i], enabled };
        } else if (enabled) {
          // Try pick details for this single resource from profile
          let det = null;
          try {
            const origin = String((opt&&opt.origin_module)||'').trim();
            const pid = opt.origin_profile_id || null;
            if (origin && pid) {
              const port = Number(process.env.PORT || 3010);
              const base = `http://127.0.0.1:${port}`;
              const headers = { 'Content-Type': 'application/json' };
              try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
              const rr = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resources`, { headers });
              const jr = await rr.json().catch(()=>({}));
              const arr = Array.isArray(jr?.items) ? jr.items : [];
              det = arr.find(x => String(x?.uri||'').trim().toLowerCase() === uri.toLowerCase()) || null;
            }
          } catch {}
          srv.push({ uri, name: det?.name || '', description: det?.description || '', mimeType: det?.mimeType || null, enabled: true });
        }
        srv = srv.filter(x => !!x && String(x.uri||'').trim() && x.enabled !== false);
      }
      const sql = srv ? `UPDATE mod_mcp2_server SET options=$1::json, resources=$2::jsonb, updated_at=NOW() WHERE id=$3 RETURNING options` : `UPDATE mod_mcp2_server SET options=$1::json, updated_at=NOW() WHERE id=$2 RETURNING options`;
      const params = srv ? [JSON.stringify(next), JSON.stringify(srv), id] : [JSON.stringify(next), id];
      const r2 = await pool.query(sql, params);
      return res.json({ ok:true, item: { uri, enabled }, options: r2.rows[0].options });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // ----- Server Resource Templates: list from profile/manifest and toggle enabled -----
  app.get('/api/mcp2/servers/:id/resource-templates', async (req, res) => {
    try {
      const u = requireAdmin(req, res); if (!u) return;
      const id = String(req.params.id||'').trim();
      const r = await pool.query(`SELECT id, name, options, resource_templates FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const srv = r.rows[0];
      const opt = safeJsonParse(srv.options||{},{});
      const origin = String((opt&&opt.origin_module)||'').trim();
      const profileId = opt.origin_profile_id || null;
      // Build available list from profile
      let available = [];
      let source = 'none';
      if (origin && profileId) {
        try {
          const port = Number(process.env.PORT || 3010);
          const base = `http://127.0.0.1:${port}`;
          const headers = { 'Content-Type': 'application/json' };
          try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
          const r2 = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(profileId)}/resource-templates`, { headers });
          const j2 = await r2.json().catch(()=>({}));
          if (r2.ok && Array.isArray(j2?.items)) { available = j2.items; source='profile'; }
        } catch {}
      }
      const enabledSet = new Set((Array.isArray(srv.resource_templates)? srv.resource_templates: []).map(x => String(x?.name||'').trim().toLowerCase()));
      const map = (opt && typeof opt.resource_templates_enabled==='object') ? opt.resource_templates_enabled : {};
      const out = available.length ? available.map(x => {
        const key = String(x?.name||'').trim().toLowerCase();
        let on = enabledSet.has(key);
        if (map.hasOwnProperty(x.name)) on = !!map[x.name];
        return { name: x.name, description: x.description||'', inputSchema: x.inputSchema||{}, enabled: !!on };
      }) : (Array.isArray(srv.resource_templates)? srv.resource_templates.map(x => ({ name:String(x?.name||'').trim(), description:String(x?.description||''), inputSchema:(x?.inputSchema&&typeof x.inputSchema==='object')?x.inputSchema:{}, enabled:true })) : []);
      return res.json({ ok:true, items: out, origin_module: origin, origin_profile_id: profileId, source });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });
  app.patch('/api/mcp2/servers/:id/resource-templates', async (req, res) => {
    try {
      const u = requireAdmin(req, res); if (!u) return;
      const id = String(req.params.id||'').trim();
      const body = req.body || {};
      const name = String(body.name||'').trim();
      const enabled = !!body.enabled;
      if (!name) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`SELECT id, options, resource_templates FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0];
      const opt = safeJsonParse(row.options||{},{});
      const map = (opt && typeof opt.resource_templates_enabled==='object') ? opt.resource_templates_enabled : {};
      map[name] = enabled;
      const next = { ...(opt||{}), resource_templates_enabled: map };
      // Update server-scoped templates when present; if absent, materialize from profile for auto-save
      let srv = Array.isArray(row.resource_templates) ? row.resource_templates.slice() : null;
      if (!srv) {
        try {
          const origin = String((opt&&opt.origin_module)||'').trim();
          const pid = opt.origin_profile_id || null;
          if (origin && pid) {
            const port = Number(process.env.PORT || 3010);
            const base = `http://127.0.0.1:${port}`;
            const headers = { 'Content-Type': 'application/json' };
            try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
            const rr = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resource-templates`, { headers });
            const jr = await rr.json().catch(()=>({}));
            if (rr.ok && Array.isArray(jr?.items)) {
              srv = jr.items.map(x => ({ name:String(x?.name||'').trim(), description:String(x?.description||''), inputSchema: (x?.inputSchema && typeof x.inputSchema==='object') ? x.inputSchema : {}, uriTemplate: (typeof x?.uriTemplate==='string' && x.uriTemplate.trim()) ? x.uriTemplate.trim() : null, enabled:(String(x?.name||'').trim().toLowerCase() === name.toLowerCase()) ? enabled : false }))
                            .filter(x=>x.name);
            }
          }
        } catch {}
      }
      if (srv) {
        const i = srv.findIndex(x => String(x?.name||'').trim().toLowerCase() === name.toLowerCase());
        if (i >= 0) {
          srv[i] = { ...srv[i], enabled };
        } else if (enabled) {
          // Try fetch template detail for this item from profile
          let det = null;
          try {
            const origin = String((opt&&opt.origin_module)||'').trim();
            const pid = opt.origin_profile_id || null;
            if (origin && pid) {
              const port = Number(process.env.PORT || 3010);
              const base = `http://127.0.0.1:${port}`;
              const headers = { 'Content-Type': 'application/json' };
              try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}
              const rr = await fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resource-templates`, { headers });
              const jr = await rr.json().catch(()=>({}));
              const arr = Array.isArray(jr?.items) ? jr.items : [];
              det = arr.find(x => String(x?.name||'').trim().toLowerCase() === name.toLowerCase()) || null;
            }
          } catch {}
          const inputSchema = (det?.inputSchema && typeof det.inputSchema==='object') ? det.inputSchema : {};
          const description = typeof det?.description === 'string' ? det.description : '';
          const uriTemplate = (typeof det?.uriTemplate === 'string' && det.uriTemplate.trim()) ? det.uriTemplate.trim() : null;
          srv.push({ name, description, inputSchema, uriTemplate, enabled: true });
        }
        srv = srv.filter(x => !!x && String(x.name||'').trim() && x.enabled !== false);
      }
      const sql = srv ? `UPDATE mod_mcp2_server SET options=$1::json, resource_templates=$2::jsonb, updated_at=NOW() WHERE id=$3 RETURNING options` : `UPDATE mod_mcp2_server SET options=$1::json, updated_at=NOW() WHERE id=$2 RETURNING options`;
      const params = srv ? [JSON.stringify(next), JSON.stringify(srv), id] : [JSON.stringify(next), id];
      const r2 = await pool.query(sql, params);
      return res.json({ ok:true, item: { name, enabled }, options: r2.rows[0].options });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // Materialize profile/module proposals into server-scoped columns (resources/templates only; tools live in mod_mcp2_type_tool)
  app.post('/api/mcp2/servers/:id/apply-config', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const id = String(req.params.id||'').trim();
      const b = req.body || {};
      const toArray = (x) => (Array.isArray(x) ? x : []);
      // Tools: persist enabled/disabled in mod_mcp2_server_tool (no JSON duplication on server row).
      const tools_enabled = {};
      const tools = [];
      for (const t of toArray(b.tools)) {
        const enabled = t?.enabled !== false;
        const name = String(t?.name || '').trim();
        let toolId = (t?.tool_id != null && String(t.tool_id).trim()) ? String(t.tool_id).trim() : null;
        if (!toolId && name) toolId = await findCatalogToolIdByName(name);
        if (!toolId) continue;
        await pool.query(
          `INSERT INTO mod_mcp2_server_tool (server_id, tool_id, enabled, created_at, updated_at, org_id)
           VALUES ($1,$2,$3,NOW(),NOW(),NULL)
           ON CONFLICT (server_id, tool_id) DO UPDATE SET enabled=EXCLUDED.enabled, updated_at=NOW()`,
          [id, toolId, enabled]
        );
        tools.push({ tool_id: toolId, name: name || toolId, enabled });
        if (name) tools_enabled[name] = enabled;
      }
      const resources = toArray(b.resources).map(x => ({ uri:String(x?.uri||'').trim(), name:String(x?.name||''), description:String(x?.description||''), mimeType: x?.mimeType? String(x.mimeType): null, enabled: x?.enabled !== false })).filter(x=>x.uri);
      const templates = toArray(b.resourceTemplates).map(x => ({ name:String(x?.name||'').trim(), description:String(x?.description||''), inputSchema: (x?.inputSchema && typeof x.inputSchema==='object')? x.inputSchema : {}, uriTemplate: (typeof x?.uriTemplate==='string' && x.uriTemplate.trim())? x.uriTemplate.trim() : null, enabled: x?.enabled !== false })).filter(x=>x.name);

      await pool.query(
        `UPDATE mod_mcp2_server
           SET resources=$1::jsonb,
               resource_templates=$2::jsonb,
               updated_at=NOW()
         WHERE id=$3`,
        [JSON.stringify(resources), JSON.stringify(templates), id]
      );
      return res.json({ ok:true, tools, tools_enabled, resources, resourceTemplates: templates });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); }
  });

  // Inspect persisted server-scoped config (resources/resource_templates + options maps)
  app.get('/api/mcp2/servers/:id/persisted', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const id = String(req.params.id||'').trim();
      const r = await pool.query(`SELECT options, resources, resource_templates FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0] || {};
      const tools_enabled = {};
      const tools = [];
      try {
        const q = await pool.query(
          `SELECT st.tool_id, st.enabled, t.name
             FROM mod_mcp2_server_tool st
             LEFT JOIN mod_mcp2_tool t ON t.id = st.tool_id
            WHERE st.server_id = $1
            ORDER BY lower(COALESCE(t.name, st.tool_id))`,
          [id]
        );
        for (const rr of (q.rows || [])) {
          const nm = String(rr?.name || '').trim();
          const enabled = rr?.enabled !== false;
          tools.push({ tool_id: String(rr.tool_id), name: nm || String(rr.tool_id), enabled });
          if (nm) tools_enabled[nm] = enabled;
        }
      } catch {}
      const resources = Array.isArray(row.resources) ? row.resources : [];
      const resourceTemplates = Array.isArray(row.resource_templates) ? row.resource_templates : [];
      return res.json({ ok:true, tools_enabled, tools, resources, resourceTemplates });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message||e) }); }
  });

  // Copy current Origin Module Profile resources/templates into server-scoped columns.
  // Tools are type-scoped and are not materialized onto the server row.
  app.post('/api/mcp2/servers/:id/materialize-from-profile', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const id = String(req.params.id||'').trim();
      const r0 = await pool.query(`SELECT id, name, options FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r0.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const srv = r0.rows[0];
      const opt = safeJsonParse(srv.options||{},{});
      const origin = String(opt.origin_module||'').trim();
      const pid = opt.origin_profile_id || null;
      if (!origin || !pid) return res.status(400).json({ ok:false, error:'no_profile_selected' });
      const port = Number(process.env.PORT || 3010);
      const base = `http://127.0.0.1:${port}`;
      const headers = { 'Content-Type': 'application/json' };
      try { const t = String(process.env.ADMIN_TOKEN || '').trim(); if (t) headers['X-Admin-Token'] = t; } catch {}

      // Fetch lists from the origin profile
      const [rr, rtpl] = await Promise.all([
        fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resources`, { headers }),
        fetch(`${base}/api/${encodeURIComponent(origin)}/profiles/${encodeURIComponent(pid)}/resource-templates`, { headers }),
      ]);
      const jr = await rr.json().catch(()=>({}));
      const jtpl = await rtpl.json().catch(()=>({}));
      const toArray = (x) => (Array.isArray(x) ? x : []);
      const resources = toArray(jr.items).map(x => ({
        uri: String(x?.uri||'').trim(), name: String(x?.name||''), description: String(x?.description||''), mimeType: x?.mimeType? String(x.mimeType): null, enabled: true,
      })).filter(x=>x.uri);
      const resourceTemplates = toArray(jtpl.items).map(x => ({
        name: String(x?.name||'').trim(), description: String(x?.description||''), inputSchema: (x?.inputSchema && typeof x.inputSchema==='object') ? x.inputSchema : {}, enabled: true,
      })).filter(x=>x.name);

      await pool.query(
        `UPDATE mod_mcp2_server SET resources=$1::jsonb, resource_templates=$2::jsonb, updated_at=NOW() WHERE id=$3`,
        [JSON.stringify(resources), JSON.stringify(resourceTemplates), id]
      );
      return res.json({ ok:true, resources_count: resources.length, resource_templates_count: resourceTemplates.length });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) });
    }
  });
  app.delete('/api/mcp2/servers/:id', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const id=String(req.params.id||'').trim(); await pool.query(`DELETE FROM mod_mcp2_server WHERE id=$1`, [id]); return res.json({ ok:true }); } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });

  // Token helpers
  app.get('/api/mcp2/servers/:id/token', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const id=String(req.params.id||'').trim(); const r=await pool.query(`SELECT token FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]); if(!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' }); return res.json({ ok:true, token:r.rows[0].token||'' }); } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });
  app.post('/api/mcp2/servers/:id/token/regenerate', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const id=String(req.params.id||'').trim(); const tok=(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)); await pool.query(`UPDATE mod_mcp2_server SET token=$1, updated_at=NOW() WHERE id=$2`, [tok,id]); return res.json({ ok:true, token: tok }); } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });
  app.post('/api/mcp2/servers/:id/token/disable', async (req, res) => { const u=requireAdmin(req,res); if(!u) return; try { const id=String(req.params.id||'').trim(); await pool.query(`UPDATE mod_mcp2_server SET token=NULL, updated_at=NOW() WHERE id=$1`, [id]); return res.json({ ok:true }); } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message:String(e?.message||e) }); } });

  // Status endpoints (best-effort, non-blocking)
  app.get('/api/mcp2/servers/status', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const r = await pool.query(`SELECT id, name, http_base, stream_url, sse_url, token, options FROM mod_mcp2_server ORDER BY updated_at DESC`);
      const items = [];
      const now = () => Date.now();
      const pref = (opt) => {
        try { const o = typeof opt === 'string' ? JSON.parse(opt) : (opt||{}); const v = o.server_url_pref; return (v==='stream'||v==='sse')?v:'sse'; } catch { return 'sse'; }
      };
      const toAlias = (url, name) => {
        try {
          const n = name ? encodeURIComponent(name) : '';
          if (!url) return '';
          const uo = new URL(url, 'http://dummy');
          const m = (uo.pathname || '').match(/^\/mcp2\/([^/]+)\/(stream|events)$/);
          if (m) {
            uo.pathname = `/api/mcp2/transport/${n || m[1]}/${m[2]}`;
            return uo.toString();
          }
          return url;
        } catch { return url; }
      };
      for (const s of r.rows) {
        const method = pref(s.options);
        const direct = method === 'stream' ? (s.stream_url || s.sse_url) : (s.sse_url || s.stream_url);
        const url = toAlias(direct, s.name);
        let ok = false; let ms = null; let code = null; let errMsg = null;
        if (url) {
          const controller = new AbortController();
          const started = now();
          const timeout = setTimeout(()=>controller.abort(), 3000);
          try {
            const resp = await fetch(url, { method: 'GET', headers: s.token? { 'Authorization': `Bearer ${s.token}` } : {}, signal: controller.signal });
            ms = now() - started;
            ok = resp.ok; code = resp.status;
          } catch (e) { ok = false; ms = null; errMsg = e?.message || String(e); }
          finally { clearTimeout(timeout); }
        }
        items.push({ id: s.id, ok, method, ms, code, error: errMsg });
      }
      const mounted = hasTransportMounted();
      const loaded = (getLoadedModules()||[]).map(m=>m?.id).includes('mcp2');
      return res.json({ ok:true, items, mounted: !!mounted, moduleLoaded: !!loaded, node: process.version });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.get('/api/mcp2/servers/:id/status', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const id = String(req.params.id||'').trim();
      const r = await pool.query(`SELECT id, name, http_base, stream_url, sse_url, token, options FROM mod_mcp2_server WHERE id=$1 LIMIT 1`, [id]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const s = r.rows[0];
      const pref = (opt) => { try { const o = typeof opt === 'string' ? JSON.parse(opt) : (opt||{}); const v = o.server_url_pref; return (v==='stream'||v==='sse')?v:'sse'; } catch { return 'sse'; } };
      const method = pref(s.options);
      const toAlias = (url, name) => {
        try {
          const n = name ? encodeURIComponent(name) : '';
          if (!url) return '';
          const uo = new URL(url, 'http://dummy');
          const m = (uo.pathname || '').match(/^\/mcp2\/([^/]+)\/(stream|events)$/);
          if (m) {
            uo.pathname = `/api/mcp2/transport/${n || m[1]}/${m[2]}`;
            return uo.toString();
          }
          return url;
        } catch { return url; }
      };
      const direct = method === 'stream' ? (s.stream_url || s.sse_url) : (s.sse_url || s.stream_url);
      const url = toAlias(direct, s.name);
      let ok = false; let ms = null; let code = null; let errMsg = null;
      if (url) {
        const controller = new AbortController();
        const started = Date.now();
        const timeout = setTimeout(()=>controller.abort(), 3000);
        try {
          const resp = await fetch(url, { method: 'GET', headers: s.token? { 'Authorization': `Bearer ${s.token}` } : {}, signal: controller.signal });
          ms = Date.now() - started;
          ok = resp.ok; code = resp.status;
          try { resp.body?.cancel?.(); } catch {}
        } catch (e) { ok = false; ms = null; errMsg = e?.message || String(e); }
        finally { clearTimeout(timeout); }
      }
      return res.json({ ok:true, status: { id: s.id, ok, method, ms, code, error: errMsg } });
    } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.post('/api/mcp2/servers/test', async (req, res) => {
    const u=requireAdmin(req,res); if(!u) return;
    try {
      const b=req.body||{};
      const pref=tryPref(b.options);
      const method = pref || 'sse';
      const direct = method === 'stream'
        ? (String(b.stream_url||'').trim() || String(b.sse_url||'').trim())
        : (String(b.sse_url||'').trim() || String(b.stream_url||'').trim());
      // Allow testing both canonical /api/mcp2/:name/* and legacy /mcp2/:name/*
      const toAlias = (url) => {
        try {
          if (!url) return '';
          const uo = new URL(url, 'http://dummy');
          const m = (uo.pathname || '').match(/^\/mcp2\/([^/]+)\/(stream|events)$/);
          if (m) {
            uo.pathname = `/api/mcp2/transport/${encodeURIComponent(m[1])}/${m[2]}`;
            return uo.toString();
          }
          return url;
        } catch { return url; }
      };
      const url = toAlias(direct);
      let ok = false; let ms = null; let code = null; let errMsg = null; let contentType = null;
      if (url) {
        const controller = new AbortController();
        const started = Date.now();
        const timeout = setTimeout(()=>controller.abort(), 3000);
        try {
          const token = String(b.token || '').trim();
          const resp = await fetch(url, { method: 'GET', headers: token ? { 'Authorization': `Bearer ${token}` } : {}, signal: controller.signal });
          ms = Date.now() - started;
          ok = resp.ok; code = resp.status;
          try { contentType = resp.headers?.get?.('content-type') || null; } catch {}
          try { resp.body?.cancel?.(); } catch {}
        } catch (e) { ok = false; ms = null; errMsg = e?.message || String(e); }
        finally { clearTimeout(timeout); }
      } else {
        errMsg = 'missing_url';
      }
      try { ctx.logToFile?.(`[mcp2] server_test method=${method} ok=${ok} code=${code||''} ms=${ms||''}`); } catch {}
      return res.json({ ok:true, status: { ok, method, ms, code, error: errMsg, content_type: contentType } });
    } catch(e){
      try { ctx.logToFile?.(`[mcp2] server_test error: ${e?.message || e}`); } catch {}
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message||e) });
    }
  });

  // ----- Installer diagnostics (module migrations) -----
  app.get('/api/mcp2/installer/status', async (req, res) => {
    const u=requireAdmin(req,res); if(!u) return;
    try {
      const state = globalThis.__mcp2_installer_state || null;
      const out = { ok:true, state: state ? { ...state } : null, migrations: { applied: [], pending: [] }, tool: null };
      try {
        const migDir = path.join(repoRoot, 'modules', 'mcp2', 'db', 'migrations');
        const files = fs.existsSync(migDir) ? (fs.readdirSync(migDir).filter((f)=>String(f).endsWith('.sql')).sort()) : [];
        let applied = [];
        if (pool) {
          try {
            const r = await pool.query(`SELECT filename, applied_at FROM migrations_log WHERE module_name=$1 ORDER BY filename`, ['mcp2']);
            applied = (r.rows || []).map((x) => String(x.filename || '').trim()).filter(Boolean);
            out.migrations.applied = r.rows || [];
          } catch {}
          try {
            const toolName = 'postgresql.get_tracking_external_url_by_recipient_name_recipient_surname_email_id_order_customer_email';
            const r2 = await pool.query(`SELECT id, name, updated_at FROM public.mod_mcp2_tool WHERE lower(name)=lower($1) LIMIT 1`, [toolName]);
            out.tool = r2?.rowCount ? r2.rows[0] : null;
          } catch {}
        }
        const appliedSet = new Set(applied);
        out.migrations.pending = files.filter((f) => !appliedSet.has(f));
      } catch {}
      return res.json(out);
    } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/mcp2/installer/run', async (req, res) => {
    const u=requireAdmin(req,res); if(!u) return;
    try {
      const state = (globalThis.__mcp2_installer_state ||= { running: false, lastRunAt: 0, lastOk: null, lastError: null, lastResult: null });
      if (state.running) return res.status(409).json({ ok:false, error:'installer_running' });
      state.running = true;
      state.lastRunAt = Date.now();
      const { installModule } = await import('../installer.js');
      const log = (msg) => { try { ctx?.logToFile?.(`[mcp2-installer][manual] ${String(msg || '')}`); } catch {} };
      try {
        const r = await installModule({ log });
        state.lastOk = true; state.lastError = null; state.lastResult = r || null;
        return res.json({ ok:true, result: r || null });
      } catch (e) {
        state.lastOk = false; state.lastError = String(e?.message || e);
        try { ctx?.logToFile?.(`[mcp2-installer][manual] ERROR: ${state.lastError}`); } catch {}
        try { ctx?.chatLog?.('mcp2_installer_error', { message: state.lastError, manual: true }); } catch {}
        return res.status(500).json({ ok:false, error:'installer_failed', message: state.lastError });
      } finally {
        state.running = false;
      }
    } catch(e){ return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  function tryPref(options) { try { const opt = typeof options==='string'? JSON.parse(options): (options||{}); const p = opt && opt.server_url_pref; if (p==='sse' || p==='stream') return p; return 'sse'; } catch { return 'sse'; } }
}
