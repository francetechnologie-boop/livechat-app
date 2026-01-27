import fs from 'fs';
import path from 'path';

export function registerTestMcpAdminRoutes(app, ctx = {}) {
  const pool = ctx.pool || null;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ ok:false, error:'unauthorized' }); return null; });

  function dataFile() {
    try {
      const repoRoot = ctx.repoRoot || path.resolve(process.cwd(), '..');
      return path.join(repoRoot, 'modules', 'testmcp', 'data', 'tools.json');
    } catch { return null; }
  }
  function readToolsJson() {
    try { const f = dataFile(); if (!f || !fs.existsSync(f)) return { items: [] }; return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { items: [] }; }
  }
  function writeToolsJson(obj) {
    try {
      const f = dataFile(); if (!f) return false;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(obj || { items: [] }, null, 2));
      return true;
    } catch { return false; }
  }

  app.get('/api/testmcp/tools', async (req, res) => {
    try {
      const u = requireAdmin(req, res); if (!u) return;
      const json = readToolsJson();
      let items = Array.isArray(json.items) ? json.items.slice() : [];
      // Optionally merge DB tools if reachable
      try {
        if (pool) {
          const r = await pool.query(`SELECT name, description FROM mod_testmcp_tool ORDER BY lower(name)`);
          const dbItems = (r.rows || []).map(x => ({ name: x.name, description: x.description || '' }));
          const by = new Map(items.map(t => [t.name, t]));
          for (const t of dbItems) by.set(t.name, t);
          items = Array.from(by.values());
        }
      } catch {}
      try { ctx.logToFile?.(`[testmcp] admin GET tools count=${items.length} db=${pool?1:0}`); } catch {}
      return res.json({ ok: true, items });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/testmcp/tools', async (req, res) => {
    try {
      const u = requireAdmin(req, res); if (!u) return;
      const b = req.body || {};
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ ok:false, error:'bad_request' });
      const description = typeof b.description === 'string' ? b.description : null;
      const orgId = b.org_id == null ? null : Number(b.org_id) || null;
      // Try DB first, fallback to JSON file store
      let stored = false;
      try {
        if (pool) {
          await pool.query(
            `INSERT INTO mod_testmcp_tool (name, description, org_id, created_at, updated_at)
             VALUES ($1,$2,$3,NOW(),NOW())
             ON CONFLICT (name) DO UPDATE SET description=EXCLUDED.description, org_id=COALESCE(EXCLUDED.org_id, mod_testmcp_tool.org_id), updated_at=NOW()`,
            [name, description, orgId]
          );
          stored = true;
        }
      } catch { stored = false; }
      if (!stored) {
        const json = readToolsJson();
        const by = new Map((Array.isArray(json.items) ? json.items : []).map(t => [String(t?.name||''), t]));
        by.set(name, { name, description: description || '' });
        writeToolsJson({ items: Array.from(by.values()) });
      }
      // Broadcast a tools/list_changed notification if transport sessions exist
      try {
        const sessions = (globalThis.__testmcp_sessions ||= new Map());
        const map = sessions.get('testMCP');
        if (map && map.size) {
          const notif = { jsonrpc: '2.0', method: 'tools/list_changed', params: {} };
          for (const { res: r2 } of map.values()) { try { r2.write(`event: message\n`); r2.write(`data: ${JSON.stringify(notif)}\n\n`); } catch {} }
        }
      } catch {}
      try { ctx.logToFile?.(`[testmcp] admin POST tool name=${name} via=${stored?'db':'json'}`); } catch {}
      return res.status(201).json({ ok:true, item: { name, description } });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/testmcp/events/recent', async (req, res) => {
    try {
      const u = requireAdmin(req, res); if (!u) return;
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 50));
      if (!pool) return res.json({ ok:true, items: [] });
      const r = await pool.query(`SELECT id, kind, payload, org_id, created_at FROM mod_testmcp_events ORDER BY created_at DESC LIMIT $1`, [limit]);
      try { ctx.logToFile?.(`[testmcp] admin GET events/recent limit=${limit} rows=${r.rows?.length||0}`); } catch {}
      return res.json({ ok:true, items: r.rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // DB status: connection + table presence (+ optional row counts)
  app.get('/api/testmcp/db/status', async (req, res) => {
    try {
      const u = requireAdmin(req, res); if (!u) return;
      const out = { ok: true, connected: false, tables: { mod_testmcp_tool: false, mod_testmcp_events: false, organizations: false }, counts: {} };
      if (!pool) return res.json(out);
      try { await pool.query('SELECT 1'); out.connected = true; } catch { out.connected = false; }
      try {
        const r = await pool.query(`
          SELECT
            to_regclass('public.mod_testmcp_tool')  AS t_tool,
            to_regclass('public.mod_testmcp_events') AS t_events,
            to_regclass('public.organizations')      AS t_orgs
        `);
        const row = r.rows && r.rows[0] || {};
        out.tables.mod_testmcp_tool = !!row.t_tool;
        out.tables.mod_testmcp_events = !!row.t_events;
        out.tables.organizations = !!row.t_orgs;
      } catch {}
      // Best-effort counts (only when tables exist)
      try { if (out.tables.mod_testmcp_tool) { const r = await pool.query('SELECT COUNT(*)::int AS c FROM mod_testmcp_tool'); out.counts.mod_testmcp_tool = r.rows[0]?.c || 0; } } catch { out.counts.mod_testmcp_tool = 0; }
      try { if (out.tables.mod_testmcp_events) { const r = await pool.query('SELECT COUNT(*)::int AS c FROM mod_testmcp_events'); out.counts.mod_testmcp_events = r.rows[0]?.c || 0; } } catch { out.counts.mod_testmcp_events = 0; }
      try { if (out.tables.organizations) { const r = await pool.query('SELECT COUNT(*)::int AS c FROM organizations'); out.counts.organizations = r.rows[0]?.c || 0; } } catch { out.counts.organizations = 0; }
      try { ctx.logToFile?.(`[testmcp] admin GET db/status connected=${out.connected} tables=${JSON.stringify(out.tables)}`); } catch {}
      return res.json(out);
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
