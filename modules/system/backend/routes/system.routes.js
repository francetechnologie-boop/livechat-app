export function registerSystemRoutes(app, ctx = {}) {
  app.get('/api/system/ping', (_req, res) => res.json({ ok: true, module: 'system' }));
}

