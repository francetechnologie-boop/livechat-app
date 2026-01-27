export function registerProductDataUpdateHealthRoutes(app, _ctx = {}) {
  app.get('/api/product_data_update/__ping', (_req, res) => res.json({ ok: true }));
}

