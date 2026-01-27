import fs from 'fs';

export function registerProductDataUpdateLogsRoutes(app, ctx = {}, utils = {}) {
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  const getLogPath = (utils && typeof utils.getChatLogPath === 'function') ? utils.getChatLogPath : (() => null);

  // GET /api/product_data_update/logs/tail?lines=200&grep=
  app.get('/api/product_data_update/logs/tail', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const lines = Math.max(1, Math.min(5000, Number(req.query?.lines || 200)));
    const grep = (req.query?.grep ? String(req.query.grep) : '').trim();
    const path = getLogPath?.();
    if (!path || !fs.existsSync(path)) return res.json({ ok:true, lines: [] });
    try {
      const txt = fs.readFileSync(path, 'utf8');
      let arr = txt.split(/\r?\n/);
      if (grep) arr = arr.filter(l => l.includes(grep));
      const out = arr.slice(-lines);
      return res.json({ ok:true, lines: out });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // GET /api/product_data_update/logs/info
  app.get('/api/product_data_update/logs/info', async (_req, res) => {
    const path = getLogPath?.();
    try {
      const st = path && fs.existsSync(path) ? fs.statSync(path) : null;
      return res.json({ ok:true, file: path || null, size: st?.size || 0, mtime: st?.mtime?.toISOString?.() || null, now: new Date().toISOString() });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}

