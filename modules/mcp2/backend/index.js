import { registerMcp2Routes } from './routes/admin.routes.js';
import { registerMcp2TransportRoutes } from './routes/transport.routes.js';
import { installModule } from './installer.js';

export function register(app, ctx) {
  // Run installer/migrations (non-blocking).
  // Note: module-manager reload does not restart the Node process, so we re-check periodically
  // to ensure newly synced migration files are applied.
  try {
    const state = (globalThis.__mcp2_installer_state ||= { running: false, lastRunAt: 0, lastOk: null, lastError: null, lastResult: null });
    const now = Date.now();
    const minIntervalMs = Math.max(10_000, Math.min(300_000, Number(process.env.MCP2_INSTALLER_INTERVAL_MS || 60_000)));
    const shouldRun = !state.running && (!state.lastRunAt || (now - state.lastRunAt) > minIntervalMs);
    if (shouldRun) {
      state.running = true;
      state.lastRunAt = now;
      const log = (msg) => { try { ctx?.logToFile?.(`[mcp2-installer] ${String(msg || '')}`); } catch {} };
      installModule({ log })
        .then((r) => { state.lastOk = true; state.lastError = null; state.lastResult = r || null; })
        .catch((e) => {
          state.lastOk = false;
          state.lastError = String(e?.message || e);
          try { ctx?.logToFile?.(`[mcp2-installer] ERROR: ${state.lastError}`); } catch {}
          try { ctx?.chatLog?.('mcp2_installer_error', { message: state.lastError }); } catch {}
        })
        .finally(() => { state.running = false; });
    }
  } catch {}

  // Mount JSON parser for this module's API namespace
  try {
    const key = '/api/mcp2';
    const mounted = globalThis.__moduleJsonMounted || (globalThis.__moduleJsonMounted = new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  registerMcp2Routes(app, ctx);
  // Mount test transports under /mcp2/* for connectivity validation
  try { registerMcp2TransportRoutes(app, ctx); } catch {}
  // Attach WebSocket echo on /mcp2/:name/ws via server upgrade (decoupled from server.js)
  try { registerMcp2WsEcho(app, ctx); } catch {}
  // Register process supervisor endpoints (start/stop/status)
  try { registerMcp2ProcessRoutes(app, ctx); } catch {}
}

function registerMcp2WsEcho(app, ctx) {
  try {
    const pool = ctx && ctx.pool;
    const extras = (ctx && ctx.extras) || {};
    const server = extras && extras.server;
    if (!server || !pool) return;
    if (globalThis.__mcp2_ws_registered) return;
    globalThis.__mcp2_ws_registered = true;

    (async () => {
      let WebSocketServer;
      try {
        const wsPkg = await import('ws');
        WebSocketServer = wsPkg.WebSocketServer || (wsPkg.default && wsPkg.default.Server) || null;
      } catch (e) { return; }
      if (!WebSocketServer) return;
      const wss = new WebSocketServer({ noServer: true });

      async function resolveServerByNameOrId(nameOrId) {
        try {
          const raw = String(nameOrId || '');
          if (/^m2srv_/i.test(raw)) {
            const r = await pool.query('SELECT id, name, token FROM mod_mcp2_server WHERE id=$1 LIMIT 1', [raw]);
            if (r && r.rowCount) return r.rows[0];
          }
          const dec = (function(){ try { return decodeURIComponent(raw); } catch (e) { return raw; } })();
          const r2 = await pool.query('SELECT id, name, token FROM mod_mcp2_server WHERE name=$1 LIMIT 1', [dec]);
          if (r2 && r2.rowCount) return r2.rows[0];
          const r3 = await pool.query('SELECT id, name, token FROM mod_mcp2_server WHERE lower(name)=lower($1) LIMIT 1', [dec]);
          if (r3 && r3.rowCount) return r3.rows[0];
        } catch (e) {}
        return null;
      }

      server.on('upgrade', async function(req, socket, head) {
        try {
          const url = new URL(req.url || '/', 'http://localhost');
          const m = url.pathname.match(/^\/mcp2\/([^/]+)\/ws$/);
          if (!m) return; // not for this module
          const key = m[1];
          const srv = await resolveServerByNameOrId(key);
          if (!srv) { try { socket.destroy(); } catch (e) {} return; }
          // Token via Authorization Bearer or ?token=
          const auth = String((req.headers && req.headers['authorization']) || '').trim();
          let token = '';
          if (/^Bearer\s+/i.test(auth)) token = auth.replace(/^Bearer\s+/i, '').trim();
          if (!token) token = String((url.searchParams && url.searchParams.get('token')) || '');
          if (String(srv.token || '') && token !== String(srv.token)) { try { socket.destroy(); } catch (e) {} return; }

          wss.handleUpgrade(req, socket, head, function(ws) {
            try { ws.send(JSON.stringify({ type:'ws_hello', name: srv.name, ts: Date.now() })); } catch (e) {}
            ws.on('message', function(msg) {
              try { ws.send(JSON.stringify({ type:'ws_echo', ts: Date.now(), data: (msg && msg.toString ? msg.toString() : String(msg)) })); } catch (e) {}
            });
          });
        } catch (e) {
          try { socket.destroy(); } catch (e2) {}
        }
      });
    })();
  } catch (e) {}
}

// Local MCP server process supervisor
function registerMcp2ProcessRoutes(app, ctx) {
  const pool = ctx && ctx.pool;
  if (!pool) return;

  const state = (globalThis.__mcp2_proc_state ||= { procs: new Map() });

  const nowIso = () => new Date().toISOString();

  function getStatus(id) {
    const rec = state.procs.get(id);
    if (!rec) return { running: false };
    const child = rec.child;
    const alive = !!(child && !child.killed && child.exitCode == null);
    return {
      running: alive,
      pid: child?.pid || rec.pid || null,
      startedAt: rec.startedAt || null,
      status: alive ? 'running' : (rec.status || 'exited'),
      exitCode: child?.exitCode ?? rec.exitCode ?? null,
      signal: rec.signal ?? null,
    };
  }

  async function loadServerRow(id) {
    const r = await pool.query(
      `SELECT id, name, options FROM mod_mcp2_server WHERE id=$1 LIMIT 1`,
      [id],
    );
    if (!r.rowCount) return null;
    const row = r.rows[0];
    let options = {};
    try { options = typeof row.options === 'string' ? JSON.parse(row.options) : (row.options || {}); } catch {}
    return { id: row.id, name: row.name, options };
  }

  function sanitizeArgs(a) {
    if (!Array.isArray(a)) return [];
    return a.map((x) => (x == null ? '' : String(x))).filter((s) => s.length);
  }

  app.post('/api/mcp2/servers/:id/start', async (req, res) => {
    const guard = ctx?.requireAdmin; if (typeof guard === 'function') { if (!guard(req, res)) return; }
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'invalid_id' });
      const existing = state.procs.get(id);
      if (existing && existing.child && !existing.child.killed && existing.child.exitCode == null) {
        return res.json({ ok:true, alreadyRunning:true, status: getStatus(id) });
      }

      const info = await loadServerRow(id);
      if (!info) return res.status(404).json({ ok:false, error:'not_found' });
      const opt = info.options || {};
      const command = String(opt.command || '').trim();
      const args = sanitizeArgs(opt.args);
      const cwd = typeof opt.cwd === 'string' && opt.cwd.trim() ? opt.cwd : undefined;
      const envExtra = (opt.env && typeof opt.env === 'object') ? opt.env : {};
      if (!command) return res.status(400).json({ ok:false, error:'command_missing' });

      const { spawn } = await import('child_process');
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...envExtra },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      const rec = { child, startedAt: nowIso(), pid: child.pid, status: 'running', exitCode: null, signal: null };
      state.procs.set(id, rec);
      child.on('exit', (code, signal) => { rec.status = 'exited'; rec.exitCode = code; rec.signal = signal || null; });
      child.on('error', () => { rec.status = 'error'; });

      return res.json({ ok:true, started:true, id, pid: child.pid, status: getStatus(id) });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/mcp2/servers/:id/stop', async (req, res) => {
    const guard = ctx?.requireAdmin; if (typeof guard === 'function') { if (!guard(req, res)) return; }
    try {
      const id = String(req.params.id || '').trim();
      const rec = state.procs.get(id);
      if (!rec || !rec.child) return res.json({ ok:true, alreadyStopped:true, status: getStatus(id) });
      const child = rec.child;
      let ok = false;
      try { ok = child.kill('SIGTERM'); } catch {}
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 4000);
      child.once('exit', () => clearTimeout(t));
      return res.json({ ok:true, stopped: ok || true, status: getStatus(id) });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  app.get('/api/mcp2/servers/:id/process', async (req, res) => {
    const guard = ctx?.requireAdmin; if (typeof guard === 'function') { if (!guard(req, res)) return; }
    try {
      const id = String(req.params.id || '').trim();
      return res.json({ ok:true, status: getStatus(id) });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}


