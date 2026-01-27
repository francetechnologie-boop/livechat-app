// Test MCP transport endpoints (no token):
// - GET /testmcp/stream            -> NDJSON stream (handshake + tools + pings)
// - GET /mcp/testMCP/stream        -> Alias path requested by user
// - POST /testmcp/message          -> Call tools (manual JSON parsing)
// - POST /api/testmcp/message      -> Same with JSON body parser

import fs from 'fs';
import path from 'path';

export function registerTestMcpTransportRoutes(app, ctx = {}) {
  const pool = ctx.pool || null;

  // In-memory sessions keyed by server name ('testMCP') -> sessionId -> { res, createdAt }
  // Use a global to allow other files (admin routes) to broadcast notifications.
  const sessions = (globalThis.__testmcp_sessions ||= new Map());
  const SERVER_NAME = 'testMCP';

  function writeLine(res, obj) {
    try { res.write(JSON.stringify(obj) + "\n"); } catch {}
  }

  function listToolsStatic() {
    const tools = [
      { name: 'ping', description: 'Responds with ok:true', input_schema: { type: 'object', additionalProperties: false, properties: {} } },
      { name: 'time.now', description: 'Returns ISO timestamp', input_schema: { type: 'object', additionalProperties: false, properties: {} } },
      { name: 'random.int', description: 'Random integer in [min,max]', input_schema: { type: 'object', additionalProperties: false, properties: { min: { type: 'integer', default: 1 }, max: { type: 'integer', default: 100 } } } },
      { name: 'echo', description: 'Echo back a message', input_schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } } },
    ];
    // Include both input_schema and inputSchema for client compatibility
    return tools.map(t => ({ ...t, inputSchema: t.input_schema }));
  }

  function getDataFile() {
    try {
      const repoRoot = ctx.repoRoot || path.resolve(process.cwd(), '..');
      const modDir = path.join(repoRoot, 'modules', 'testmcp');
      const dataFile = path.join(modDir, 'data', 'tools.json');
      try { ctx.logToFile?.(`[testmcp] tools.json path: ${dataFile}`); } catch {}
      return dataFile;
    } catch { return null; }
  }

  function listToolsFromJson() {
    try {
      const f = getDataFile();
      if (!f || !fs.existsSync(f)) return [];
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const items = Array.isArray(j?.items) ? j.items : [];
      try { ctx.logToFile?.(`[testmcp] tools.json items=${items.length}`); } catch {}
      return items.filter(it => it && it.name).map(it => ({
        name: String(it.name),
        description: typeof it.description === 'string' ? it.description : '',
        input_schema: it.input_schema && typeof it.input_schema === 'object' ? it.input_schema : { type: 'object' },
        inputSchema: it.inputSchema && typeof it.inputSchema === 'object' ? it.inputSchema : (it.input_schema || { type: 'object' }),
      }));
    } catch { return []; }
  }

  async function listToolsDb(orgId = null) {
    try {
      if (!pool) return listToolsStatic();
      const params = [];
      let sql = `SELECT name, description FROM mod_testmcp_tool`;
      if (orgId != null) { sql += ` WHERE org_id = $1`; params.push(orgId); }
      sql += ` ORDER BY lower(name)`;
      const r = await pool.query(sql, params);
      const rows = Array.isArray(r.rows) ? r.rows : [];
      const dbTools = rows.map((x) => ({ name: x.name, description: x.description || '', input_schema: { type: 'object' }, inputSchema: { type: 'object' } }));
      const jsonTools = listToolsFromJson();
      // Merge: static + json + db (db overrides, then json, then static)
      const byName = new Map();
      for (const t of listToolsStatic()) byName.set(t.name, t);
      for (const t of jsonTools) byName.set(t.name, t);
      for (const t of dbTools) byName.set(t.name, t);
      const merged = Array.from(byName.values());
      try { ctx.logToFile?.(`[testmcp] tools merged: static=${listToolsStatic().length} json=${jsonTools.length} db=${dbTools.length} merged=${merged.length}`); } catch {}
      return merged;
    } catch {
      // No DB: combine static + JSON
      const byName = new Map();
      for (const t of listToolsStatic()) byName.set(t.name, t);
      const jsonTools = listToolsFromJson();
      for (const t of jsonTools) byName.set(t.name, t);
      const merged = Array.from(byName.values());
      try { ctx.logToFile?.(`[testmcp] tools merged (no-db): static=${listToolsStatic().length} json=${jsonTools.length} merged=${merged.length}`); } catch {}
      return merged;
    }
  }

  function broadcastToolsListChanged() {
    try {
      const map = sessions.get(SERVER_NAME);
      if (!map) return;
      const notif = { jsonrpc: '2.0', method: 'tools/list_changed', params: {} };
      for (const { res: r } of map.values()) {
        try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(notif)}\n\n`); } catch {}
      }
      try { ctx.logToFile?.('[testmcp] notify tools/list_changed'); } catch {}
    } catch {}
  }

  async function recordEvent(kind, payload, orgId = null) {
    try {
      if (!pool) return;
      await pool.query(
        `INSERT INTO mod_testmcp_events (kind, payload, org_id, created_at) VALUES ($1, $2::jsonb, $3, NOW())`,
        [String(kind||'event'), JSON.stringify(payload||{}), orgId]
      );
    } catch {}
  }

  async function handleCall(tool, params, orgId = null) {
    switch (String(tool || '').trim()) {
      case 'ping':
        return { ok: true };
      case 'time.now':
        return { now: new Date().toISOString() };
      case 'random.int': {
        const min = Number.isFinite(params?.min) ? Number(params.min) : 1;
        const max = Number.isFinite(params?.max) ? Number(params.max) : 100;
        const a = Math.min(min, max);
        const b = Math.max(min, max);
        return { value: Math.floor(Math.random() * (b - a + 1)) + a };
      }
      case 'echo': {
        const text = typeof params?.text === 'string' ? params.text : '';
        return { text };
      }
      default:
        return { ok: false, error: 'unknown_tool' };
    }
  }

  function mountNdjsonRoute(path) {
    app.get(path, async (req, res) => {
      try {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}

        const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
        const byName = sessions.get(SERVER_NAME) || new Map();
        byName.set(sessionId, { res, createdAt: Date.now() });
        sessions.set(SERVER_NAME, byName);

        // Handshake + tools
        writeLine(res, { type: 'server_hello', protocol: 'mcp-stream/0.1', name: SERVER_NAME, sessionId, caps: { tools: true } });
        writeLine(res, { type: 'tools', items: await listToolsDb(null) });

        // Heartbeats
        const iv = setInterval(() => writeLine(res, { type: 'ping', ts: Date.now(), sessionId }), 10000);
        req.on('close', () => {
          clearInterval(iv);
          try { res.end(); } catch {}
          try { const map = sessions.get(SERVER_NAME); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(SERVER_NAME); } } catch {}
        });
      } catch (e) {
        try { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); } catch {}
      }
    });
  }

  // Primary NDJSON paths (kept for manual testing and backward-compat)
  // Use distinct NDJSON paths to avoid colliding with Inspector SSE endpoints below
  mountNdjsonRoute('/testmcp/ndjson');
  mountNdjsonRoute('/mcp/testMCP/ndjson');

  // Streamable HTTP (SSE) for Inspector compatibility
  app.get('/api/testmcp/stream', async (req, res) => {
    try {
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}

      const byName = sessions.get(SERVER_NAME) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(SERVER_NAME, byName);

      // Lightweight server logs for connect/close
      const log = (m) => { try { ctx.logToFile?.(m); } catch {} };
      const ip = (() => { try { return (req.headers['x-forwarded-for'] || req.ip || '').toString(); } catch { return ''; } })();
      const ua = (() => { try { return (req.headers['user-agent'] || '').toString(); } catch { return ''; } })();
      log(`[testmcp] SSE connect session=${sessionId} ip=${ip} ua=${ua}`);

      const send = (obj, eventId) => {
        try {
          if (eventId) res.write(`id: ${eventId}\n`);
          res.write(`event: message\n`);
          res.write(`data: ${JSON.stringify(obj)}\n\n`);
        } catch {}
      };

      // Optional hello notification (non-JSONRPC) to help manual testing; clients will ignore unknown events
      try { res.write(`event: hello\n`); res.write(`data: {"ok":true,"name":"${SERVER_NAME}"}\n\n`); } catch {}

      // Keepalive comment line every 10s
      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => {
        clearInterval(iv);
        try { res.end(); } catch {}
        try { const map = sessions.get(SERVER_NAME); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(SERVER_NAME); } } catch {}
        log(`[testmcp] SSE close   session=${sessionId}`);
      });

      // Expose a per-request helper on res.locals to allow other routes to emit
      try { res.locals.__testmcpSseSend = send; } catch {}
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); } catch {}
    }
  });

  // Canonical SSE events endpoint under /api for subscribe-only clients
  app.get('/api/testmcp/events', async (req, res) => {
    try {
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}

      const byName = sessions.get(SERVER_NAME) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(SERVER_NAME, byName);

      const log = (m) => { try { ctx.logToFile?.(m); } catch {} };
      const ip = (() => { try { return (req.headers['x-forwarded-for'] || req.ip || '').toString(); } catch { return ''; } })();
      const ua = (() => { try { return (req.headers['user-agent'] || '').toString(); } catch { return ''; } })();
      log(`[testmcp] SSE connect session=${sessionId} ip=${ip} ua=${ua}`);

      // Keepalive
      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => {
        clearInterval(iv);
        try { res.end(); } catch {}
        try { const map = sessions.get(SERVER_NAME); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(SERVER_NAME); } } catch {}
        log(`[testmcp] SSE close   session=${sessionId}`);
      });
      try { res.locals.__testmcpSseSend = (obj, eventId) => { try { if (eventId) res.write(`id: ${eventId}\n`); res.write(`event: message\n`); res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} }; } catch {}
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); } catch {}
    }
  });

  // Alias SSE endpoints to support Inspector on legacy paths as well
  app.get('/testmcp/stream', async (req, res) => {
    try {
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}

      const byName = sessions.get(SERVER_NAME) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(SERVER_NAME, byName);

      const log = (m) => { try { ctx.logToFile?.(m); } catch {} };
      const ip = (() => { try { return (req.headers['x-forwarded-for'] || req.ip || '').toString(); } catch { return ''; } })();
      const ua = (() => { try { return (req.headers['user-agent'] || '').toString(); } catch { return ''; } })();
      log(`[testmcp] SSE connect session=${sessionId} ip=${ip} ua=${ua}`);

      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => {
        clearInterval(iv);
        try { res.end(); } catch {}
        try { const map = sessions.get(SERVER_NAME); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(SERVER_NAME); } } catch {}
        log(`[testmcp] SSE close   session=${sessionId}`);
      });
      try { res.locals.__testmcpSseSend = (obj, eventId) => { try { if (eventId) res.write(`id: ${eventId}\n`); res.write(`event: message\n`); res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} }; } catch {}
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); } catch {}
    }
  });
  app.get('/mcp/testMCP/stream', async (req, res) => {
    try {
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}

      const byName = sessions.get(SERVER_NAME) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(SERVER_NAME, byName);

      const log = (m) => { try { ctx.logToFile?.(m); } catch {} };
      const ip = (() => { try { return (req.headers['x-forwarded-for'] || req.ip || '').toString(); } catch { return ''; } })();
      const ua = (() => { try { return (req.headers['user-agent'] || '').toString(); } catch { return ''; } })();
      log(`[testmcp] SSE connect session=${sessionId} ip=${ip} ua=${ua}`);

      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => {
        clearInterval(iv);
        try { res.end(); } catch {}
        try { const map = sessions.get(SERVER_NAME); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(SERVER_NAME); } } catch {}
        log(`[testmcp] SSE close   session=${sessionId}`);
      });
      try { res.locals.__testmcpSseSend = (obj, eventId) => { try { if (eventId) res.write(`id: ${eventId}\n`); res.write(`event: message\n`); res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} }; } catch {}
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); } catch {}
    }
  });

  // Also expose explicit "/events" aliases (SSE-only) to match common conventions
  app.get('/testmcp/events', async (req, res) => {
    try {
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}

      const byName = sessions.get(SERVER_NAME) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(SERVER_NAME, byName);

      const log = (m) => { try { ctx.logToFile?.(m); } catch {} };
      const ip = (() => { try { return (req.headers['x-forwarded-for'] || req.ip || '').toString(); } catch { return ''; } })();
      const ua = (() => { try { return (req.headers['user-agent'] || '').toString(); } catch { return ''; } })();
      log(`[testmcp] SSE connect session=${sessionId} ip=${ip} ua=${ua}`);

      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => {
        clearInterval(iv);
        try { res.end(); } catch {}
        try { const map = sessions.get(SERVER_NAME); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(SERVER_NAME); } } catch {}
        log(`[testmcp] SSE close   session=${sessionId}`);
      });
      try { res.locals.__testmcpSseSend = (obj, eventId) => { try { if (eventId) res.write(`id: ${eventId}\n`); res.write(`event: message\n`); res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} }; } catch {}
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); } catch {}
    }
  });
  app.get('/mcp/testMCP/events', async (req, res) => {
    try {
      const sessionId = Math.random().toString(16).slice(2) + Date.now().toString(36);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { res.setHeader('mcp-session-id', sessionId); } catch {}
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}

      const byName = sessions.get(SERVER_NAME) || new Map();
      byName.set(sessionId, { res, createdAt: Date.now() });
      sessions.set(SERVER_NAME, byName);

      const log = (m) => { try { ctx.logToFile?.(m); } catch {} };
      const ip = (() => { try { return (req.headers['x-forwarded-for'] || req.ip || '').toString(); } catch { return ''; } })();
      const ua = (() => { try { return (req.headers['user-agent'] || '').toString(); } catch { return ''; } })();
      log(`[testmcp] SSE connect session=${sessionId} ip=${ip} ua=${ua}`);

      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => {
        clearInterval(iv);
        try { res.end(); } catch {}
        try { const map = sessions.get(SERVER_NAME); if (map) { map.delete(sessionId); if (!map.size) sessions.delete(SERVER_NAME); } } catch {}
        log(`[testmcp] SSE close   session=${sessionId}`);
      });
      try { res.locals.__testmcpSseSend = (obj, eventId) => { try { if (eventId) res.write(`id: ${eventId}\n`); res.write(`event: message\n`); res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} }; } catch {}
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); } catch {}
    }
  });

  // Streamable HTTP JSON-RPC POST on the same endpoint (Inspector expects POST to same URL)
  app.post('/api/testmcp/stream', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (!(body && typeof body === 'object' && body.jsonrpc === '2.0')) {
        return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      }
      const id = body.id ?? null;
      const method = String(body.method || '').trim();
      const params = body.params || {};
      let result;
      if (method === 'initialize') {
        result = {
          protocolVersion: '2025-06-18',
          serverInfo: { name: 'testmcp', version: '1.0.0' },
          capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: false }, resourceTemplates: { listChanged: false }, prompts: { listChanged: false }, logging: {} },
        };
        try { const sess = Math.random().toString(16).slice(2) + Date.now().toString(36); res.setHeader('mcp-session-id', sess); } catch {}
      } else if (method === 'tools/list') {
        const _tools = await listToolsDb(null);
        try { ctx.logToFile?.(`[testmcp] tools/list (stream) count=${Array.isArray(_tools)?_tools.length:0}`); } catch {}
        result = { tools: _tools };
      } else if (method === 'tools/call') {
        const tool = String(params?.name || '').trim();
        const args = params?.arguments || params || {};
        result = await handleCall(tool, args, null);
        try { const p = (()=>{ try{ const s=JSON.stringify(args); return s.length>120?s.slice(0,120)+'…':s; }catch{return ''} })(); ctx.logToFile?.(`[testmcp] tools/call (stream) name=${tool} args=${p}`); } catch {}
      } else {
        return res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
      }
      const response = { jsonrpc: '2.0', id, result };
      try { ctx.logToFile?.(`[testmcp] RPC ${method} -> ${id != null ? 'id='+id : 'notif'} ok`); } catch {}
      // Fan out JSON-RPC response to SSE listeners
      try {
        const map = sessions.get(SERVER_NAME);
        if (map) for (const { res: r } of map.values()) {
          try {
            r.write(`event: message\n`);
            r.write(`data: ${JSON.stringify(response)}\n\n`);
          } catch {}
        }
      } catch {}
      await recordEvent('rpc', { id, method, result }, null);
      // Send a best-effort initialized notification for clients expecting it
      if (method === 'initialize') {
        try {
          const notif = { jsonrpc: '2.0', method: 'initialized', params: {} };
          const map = sessions.get(SERVER_NAME);
          if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(notif)}\n\n`); } catch {} }
        } catch {}
      }
      return res.json(response);
    } catch (e) { return res.status(500).json({ jsonrpc:'2.0', id: null, error: { code: -32000, message: 'server_error', data: String(e?.message || e) } }); }
  });

  // JSON-RPC POST aliases for Inspector on legacy paths
  app.post('/testmcp/stream', async (req, res) => {
    try {
      // Manual JSON parse (no module-wide JSON parser on this alias path)
      const chunks = [];
      await new Promise((resolve) => { req.on('data', (c)=>chunks.push(c)); req.on('end', resolve); req.on('error', resolve); });
      let body = {};
      try { const buf = Buffer.concat(chunks); if (buf.length) body = JSON.parse(buf.toString('utf8')); } catch {}
      if (!(body && typeof body === 'object' && body.jsonrpc === '2.0')) {
        return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      }
      const id = body.id ?? null;
      const method = String(body.method || '').trim();
      const params = body.params || {};
      let result;
      if (method === 'initialize') {
        result = { protocolVersion: '2025-06-18', serverInfo: { name: 'testmcp', version: '1.0.0' }, capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: false }, resourceTemplates: { listChanged: false }, prompts: { listChanged: false }, logging: {} } };
        try { const sess = Math.random().toString(16).slice(2) + Date.now().toString(36); res.setHeader('mcp-session-id', sess); } catch {}
      } else if (method === 'tools/list') {
        const _tools = await listToolsDb(null);
        try { ctx.logToFile?.(`[testmcp] tools/list (alias stream) count=${Array.isArray(_tools)?_tools.length:0}`); } catch {}
        result = { tools: _tools };
      } else if (method === 'tools/call') {
        const tool = String(params?.name || '').trim();
        const args = params?.arguments || params || {};
        result = await handleCall(tool, args, null);
        try { const p = (()=>{ try{ const s=JSON.stringify(args); return s.length>120?s.slice(0,120)+'.':s; }catch{return ''} })(); ctx.logToFile?.(`[testmcp] tools/call (alias stream) name=${tool} args=${p}`); } catch {}
      } else {
        return res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
      }
      const response = { jsonrpc: '2.0', id, result };
      try { ctx.logToFile?.(`[testmcp] RPC ${method} -> ${id != null ? 'id='+id : 'notif'} ok`); } catch {}
      try { const map = sessions.get(SERVER_NAME); if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(response)}\n\n`); } catch {} } } catch {}
      await recordEvent('rpc', { id, method, result }, null);
      if (method === 'initialize') {
        try { const notif = { jsonrpc: '2.0', method: 'initialized', params: {} }; const map = sessions.get(SERVER_NAME); if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(notif)}\n\n`); } catch {} } } catch {}
      }
      return res.json(response);
    } catch (e) { return res.status(500).json({ jsonrpc:'2.0', id: null, error: { code: -32000, message: 'server_error', data: String(e?.message || e) } }); }
  });
  app.post('/mcp/testMCP/stream', async (req, res) => {
    try {
      // Manual JSON parse (no module-wide JSON parser on this alias path)
      const chunks = [];
      await new Promise((resolve) => { req.on('data', (c)=>chunks.push(c)); req.on('end', resolve); req.on('error', resolve); });
      let body = {};
      try { const buf = Buffer.concat(chunks); if (buf.length) body = JSON.parse(buf.toString('utf8')); } catch {}
      if (!(body && typeof body === 'object' && body.jsonrpc === '2.0')) {
        return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      }
      const id = body.id ?? null;
      const method = String(body.method || '').trim();
      const params = body.params || {};
      let result;
      if (method === 'initialize') {
        result = { protocolVersion: '2025-06-18', serverInfo: { name: 'testmcp', version: '1.0.0' }, capabilities: { tools: { listChanged: true } } };
        try { const sess = Math.random().toString(16).slice(2) + Date.now().toString(36); res.setHeader('mcp-session-id', sess); } catch {}
      } else if (method === 'tools/list') {
        const _tools = await listToolsDb(null);
        try { ctx.logToFile?.(`[testmcp] tools/list (alias stream) count=${Array.isArray(_tools)?_tools.length:0}`); } catch {}
        result = { tools: _tools };
      } else if (method === 'tools/call') {
        const tool = String(params?.name || '').trim();
        const args = params?.arguments || params || {};
        result = await handleCall(tool, args, null);
        try { const p = (()=>{ try{ const s=JSON.stringify(args); return s.length>120?s.slice(0,120)+'.':s; }catch{return ''} })(); ctx.logToFile?.(`[testmcp] tools/call (alias stream) name=${tool} args=${p}`); } catch {}
      } else {
        return res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
      }
      const response = { jsonrpc: '2.0', id, result };
      try { ctx.logToFile?.(`[testmcp] RPC ${method} -> ${id != null ? 'id='+id : 'notif'} ok`); } catch {}
      try { const map = sessions.get(SERVER_NAME); if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(response)}\n\n`); } catch {} } } catch {}
      await recordEvent('rpc', { id, method, result }, null);
      if (method === 'initialize') {
        try { const notif = { jsonrpc: '2.0', method: 'initialized', params: {} }; const map = sessions.get(SERVER_NAME); if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(notif)}\n\n`); } catch {} } } catch {}
      }
      return res.json(response);
    } catch (e) { return res.status(500).json({ jsonrpc:'2.0', id: null, error: { code: -32000, message: 'server_error', data: String(e?.message || e) } }); }
  });

  // Optional: allow DELETE to end session (no-op)
  app.delete('/api/testmcp/stream', async (_req, res) => {
    try { return res.status(405).json({ jsonrpc:'2.0', id:null, error: { code: -32000, message: 'Method not allowed' } }); } catch { return; }
  });

  // Admin: manually trigger tools list changed notification (requires admin)
  app.post('/api/testmcp/tools/notify-changed', async (req, res) => {
    try {
      const u = (ctx.requireAdmin || ((_req, r)=>{ r.status(401).json({ ok:false, error:'unauthorized' }); return null; }))(req, res); if (!u) return;
      broadcastToolsListChanged();
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Message endpoints (no token)
  app.post('/testmcp/message', async (req, res) => {
    try {
      const chunks = [];
      await new Promise((resolve) => { req.on('data', (c)=>chunks.push(c)); req.on('end', resolve); req.on('error', resolve); });
      let body = {}; try { const buf = Buffer.concat(chunks); if (buf.length) body = JSON.parse(buf.toString('utf8')); } catch {}
      const id = body.id || null;
      const method = String(body.method || '').trim();
      const params = body.params || {};

      let result;
      if (method === 'tools/list') {
        const _tools = await listToolsDb(null);
        try { ctx.logToFile?.(`[testmcp] tools/list (legacy) count=${Array.isArray(_tools)?_tools.length:0}`); } catch {}
        result = { tools: _tools };
      } else if (method === 'tools/call') {
        const tool = String(params?.name || '').trim();
        const a = params?.arguments || params || {};
        result = await handleCall(tool, a, null);
        try { const p = (()=>{ try{ const s=JSON.stringify(a); return s.length>120?s.slice(0,120)+'…':s; }catch{return ''} })(); ctx.logToFile?.(`[testmcp] tools/call (legacy) name=${tool} args=${p}`); } catch {}
      } else {
        result = { ok:false, error:'unknown_method' };
      }

      const out = { type: 'result', id, method, result };
      try { const map = sessions.get(SERVER_NAME); if (map) for (const { res: r } of map.values()) { try { r.write(JSON.stringify(out) + '\n'); } catch {} } } catch {}
      await recordEvent('message', { id, method, result }, null);
      return res.json({ ok: true, ...out });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/testmcp/message', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};

      // Support JSON-RPC 2.0 for Streamable HTTP clients
      const isRpc = body && typeof body === 'object' && body.jsonrpc === '2.0' && (body.method || body.result || body.error);
      if (isRpc) {
        const id = body.id ?? null;
        const method = String(body.method || '').trim();
        const params = body.params || {};
        let result;
        if (method === 'initialize') {
          // Minimal initialize response with proper MCP fields
          result = {
            protocolVersion: '1.0',
            serverInfo: { name: 'testmcp', version: '1.0.0' },
            capabilities: { tools: { listChanged: true } },
          };
      } else if (method === 'tools/list') {
        const _tools = await listToolsDb(null);
        try { ctx.logToFile?.(`[testmcp] tools/list (stream RPC) count=${Array.isArray(_tools)?_tools.length:0}`); } catch {}
        result = { tools: _tools };
      } else if (method === 'tools/call') {
        const tool = String(params?.name || '').trim();
        const args = params?.arguments || params || {};
        result = await handleCall(tool, args, null);
        try { const p = (()=>{ try{ const s=JSON.stringify(args); return s.length>120?s.slice(0,120)+'…':s; }catch{return ''} })(); ctx.logToFile?.(`[testmcp] tools/call (stream RPC) name=${tool} args=${p}`); } catch {}
      } else {
        return res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
      }
        const response = { jsonrpc: '2.0', id, result };
        try { ctx.logToFile?.(`[testmcp] RPC ${method} -> ${id != null ? 'id='+id : 'notif'} ok`); } catch {}
        // Fan out JSON-RPC response to SSE listeners
        try {
          const map = sessions.get(SERVER_NAME);
          if (map) for (const { res: r } of map.values()) {
            try {
              r.write(`event: message\n`);
              r.write(`data: ${JSON.stringify(response)}\n\n`);
            } catch {}
          }
        } catch {}
        await recordEvent('rpc', { id, method, result }, null);
        if (method === 'initialize') {
          try {
            const notif = { jsonrpc: '2.0', method: 'notifications/initialized', params: {} };
            const map = sessions.get(SERVER_NAME);
            if (map) for (const { res: r } of map.values()) { try { r.write(`event: message\n`); r.write(`data: ${JSON.stringify(notif)}\n\n`); } catch {} }
          } catch {}
        }
        return res.json(response);
      }

      // Legacy simple shape for our Admin page
      const id = body.id || null;
      const method = String(body.method || '').trim();
      const params = body.params || {};
      let result;
      if (method === 'tools/list') {
        const _tools = await listToolsDb(null);
        try { ctx.logToFile?.(`[testmcp] tools/list (message RPC) count=${Array.isArray(_tools)?_tools.length:0}`); } catch {}
        result = { tools: _tools };
      } else if (method === 'tools/call') {
        const tool = String(params?.name || '').trim();
        const a = params?.arguments || params || {};
        result = await handleCall(tool, a, null);
        try { const p = (()=>{ try{ const s=JSON.stringify(a); return s.length>120?s.slice(0,120)+'…':s; }catch{return ''} })(); ctx.logToFile?.(`[testmcp] tools/call (message RPC) name=${tool} args=${p}`); } catch {}
      } else {
        result = { ok:false, error:'unknown_method' };
      }
      const out = { type: 'result', id, method, result };
      // Note: legacy path only fans out on NDJSON endpoints
      await recordEvent('message', { id, method, result }, null);
      return res.json({ ok: true, ...out });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
