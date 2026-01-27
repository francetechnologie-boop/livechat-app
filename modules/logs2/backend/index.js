import path from 'path';
import { createLogs2Routes } from './routes/logs2.routes.js';

export function register(app, ctx = {}) {
  // Mount JSON parser for this module's API namespace
  try {
    const key = '/api/logs2';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  const registerCron = (action) => { try { ctx?.registerCronAction?.(action); } catch {} };
  registerCron({
    id: 'logs2_clear',
    module_id: 'logs2',
    name: 'Flush Logs2',
    description: 'Clear chat.log via the Logs2 clear endpoint.',
    method: 'POST',
    path: '/api/logs2/clear',
    payload_template: {},
  });
  // Keep existing endpoints under /api/modules/logs2/* for backward compatibility
  try { createLogs2Routes({ app, ...ctx, requireAuth: ctx.requireAdmin || ctx.requireAuth }); } catch {}

  // Minimal namespaced aliases under /api/logs2/* to comply with checklist
  const { getLogFilePath, isLogEnabled, isLogStdout, setLogStdout, logToFile } = ctx || {};
  const backendDir = (() => {
    try {
      const fromCtx = String(ctx?.backendDir || '').trim();
      if (fromCtx) return fromCtx;
    } catch {}
    try {
      const cwd = process.cwd();
      return path.basename(cwd) === 'backend' ? cwd : path.join(cwd, 'backend');
    } catch {
      return path.join(process.cwd(), 'backend');
    }
  })();
  const filePath = () => {
    try { return getLogFilePath?.() || path.join(backendDir, 'chat.log'); } catch { return path.join(backendDir, 'chat.log'); }
  };
  app.get('/api/logs2/ping', (_req, res) => res.json({ ok: true, module: 'logs2' }));
  app.get('/api/logs2/status', async (_req, res) => {
    try {
      const fs = await import('fs');
      let exists = false; let sizeBytes = 0; let mtime = null;
      try { const st = fs.statSync(filePath()); exists = true; sizeBytes = st.size; mtime = st.mtimeMs; } catch {}
      res.json({ ok: true, enabled: !!(isLogEnabled?.() ?? true), stdout: !!(isLogStdout?.() ?? false), file: filePath(), exists, sizeBytes, mtime });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.get('/api/logs2/tail', async (req, res) => {
    try {
      const fs = await import('fs');
      const maxLines = Math.max(1, Math.min(5000, Number(req.query.lines || 500)));
      let content = '';
      try { content = fs.readFileSync(filePath(), 'utf8'); } catch {}
      const lines = content.split(/\r?\n/);
      const tail = lines.slice(-maxLines).join('\n');
      let sizeBytes = 0; let mtime = null; let exists = false;
      try { const st = fs.statSync(filePath()); sizeBytes = st.size; mtime = st.mtimeMs; exists = true; } catch {}
      res.json({ ok: true, content: tail, lines: maxLines, exists, sizeBytes, mtime });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.post('/api/logs2/stdout', async (req, res) => {
    if (!ctx.requireAdmin?.(req, res)) return;
    try {
      const stdout = !!(req.body && (req.body.stdout === true || req.body.stdout === 'true' || req.body.stdout === 1 || req.body.stdout === '1'));
      setLogStdout?.(stdout);
      try { logToFile?.(`logs2: stdout ${stdout ? 'ON' : 'OFF'}`); } catch {}
      res.json({ ok: true, stdout: !!(isLogStdout?.() ?? false) });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.post('/api/logs2/clear', async (req, res) => {
    if (!ctx.requireAdmin?.(req, res)) return;
    try { const fs = await import('fs'); fs.writeFileSync(filePath(), ''); res.json({ ok:true }); }
    catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}

export default register;
