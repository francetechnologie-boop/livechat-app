export function registerSupplyPlanificationHealthRoutes(app, _ctx = {}, utils = {}) {
  const base = utils.base || '/api/supply-planification';
  app.get(base + '/__ping', (_req, res) => res.json({ ok: true, module: 'supply-planification' }));

  // Friendly health alias (some tools call /health instead of /__ping)
  app.get(base + '/health', (_req, res) => res.json({ ok: true, module: 'supply-planification' }));

  // Lightweight route list to debug mounting
  app.get(base + '/__routes', (_req, res) =>
    res.json({
      ok: true,
      module: 'supply-planification',
      routes: [
        '__ping',
        'health',
        'settings',
        'inventory/items',
        'inventory/po-lines',
        'inventory/transactions',
        'board',
        'needs/monthly',
      ],
    })
  );
}
