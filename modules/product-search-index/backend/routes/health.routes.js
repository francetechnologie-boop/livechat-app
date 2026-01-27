export function registerPsiHealthRoutes(app, _ctx = {}) {
  app.get('/api/product-search-index/__ping', (_req, res) => res.json({ ok: true }));
  // Quick route list (minimal)
  app.get('/api/product-search-index/__routes', (_req, res) => res.json({ ok: true, routes: [
    'GET  /api/product-search-index/__ping',
    'GET  /api/product-search-index/__routes',
    'POST /api/product-search-index/runs',
    'GET  /api/product-search-index/runs/:id/stream',
  ] }));
}

