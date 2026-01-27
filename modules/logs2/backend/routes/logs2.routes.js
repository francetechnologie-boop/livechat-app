import fs from 'fs';
import path from 'path';

// Factory to mount Logs2 endpoints under /api/modules/logs2/*
// ctx: { app, requireAuth, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout, logToFile }
export function createLogs2Routes(ctx) {
  const { app, requireAuth, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout, logToFile } = ctx || {};
  if (!app) throw new Error('createLogs2Routes: app missing');

  const backendDir = (() => {
    try {
      const fromCtx = String(ctx?.backendDir || '').trim();
      if (fromCtx) return fromCtx;
    } catch {}
    try {
      const cwd = process.cwd();
      return path.basename(cwd) === 'backend' ? cwd : path.resolve(cwd, 'backend');
    } catch {
      return path.resolve(process.cwd(), 'backend');
    }
  })();

  const filePath = () => {
    try { return getLogFilePath?.() || path.join(backendDir, 'chat.log'); }
    catch { return path.join(backendDir, 'chat.log'); }
  };

  app.get('/api/modules/logs2/status', async (_req, res) => {
    try {
      let exists = false; let sizeBytes = 0; let mtime = null;
      try { const st = fs.statSync(filePath()); exists = true; sizeBytes = st.size; mtime = st.mtimeMs; } catch {}
      res.json({ ok: true, enabled: !!(isLogEnabled?.() ?? true), stdout: !!(isLogStdout?.() ?? false), file: filePath(), exists, sizeBytes, mtime });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.get('/api/modules/logs2/tail', async (req, res) => {
    try {
      const maxLines = Math.max(1, Math.min(5000, Number(req.query.lines || 500)));
      let content = '';
      try { content = fs.readFileSync(filePath(), 'utf8'); } catch {}
      const lines = content.split(/\r?\n/);
      const tail = lines.slice(-maxLines).join('\n');
      let sizeBytes = 0; let mtime = null; let exists = false;
      try { const st = fs.statSync(filePath()); sizeBytes = st.size; mtime = st.mtimeMs; exists = true; } catch {}
      res.json({ ok: true, content: tail, lines: maxLines, exists, sizeBytes, mtime });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/modules/logs2/stdout', async (req, res) => {
    if (!requireAuth?.(req, res)) return;
    try {
      const stdout = !!(req.body && (req.body.stdout === true || req.body.stdout === 'true' || req.body.stdout === 1 || req.body.stdout === '1'));
      setLogStdout?.(stdout);
      try { logToFile?.(`⚙️ LOG2_STDOUT set to ${stdout ? 'ON' : 'OFF'} by admin`); } catch {}
      res.json({ ok: true, stdout: !!(isLogStdout?.() ?? false) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  app.post('/api/modules/logs2/clear', async (req, res) => {
    if (!requireAuth?.(req, res)) return;
    try { fs.writeFileSync(filePath(), ''); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
  });
}

export default createLogs2Routes;
