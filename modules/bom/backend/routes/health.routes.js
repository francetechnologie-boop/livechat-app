export function registerBomHealthRoutes(app, _ctx = {}) {
  try { app.get('/api/bom/__ping', (_req, res) => res.json({ ok: true, module: 'bom' })); } catch {}
}

