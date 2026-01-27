export function registerSharedRoutes(app, ctx = {}) {
  app.get('/api/shared/ping', (_req, res) => res.json({ ok: true, module: 'shared' }));
}

