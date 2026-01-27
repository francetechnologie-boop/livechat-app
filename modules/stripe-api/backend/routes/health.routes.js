export function registerStripeApiHealthRoutes(app) {
  try { app.get('/api/stripe-api/__ping', (_req, res) => res.json({ ok: true, module: 'stripe-api' })); } catch {}
  try {
    app.get('/api/stripe-api/__routes', (_req, res) => res.json({ ok: true, routes: [
      'GET /api/stripe-api/__ping',
      'GET /api/stripe-api/keys',
      'POST /api/stripe-api/keys/test',
      'POST /api/stripe-api/keys',
      'POST /api/stripe-api/keys/:id/default',
      'PATCH /api/stripe-api/keys/:id',
      'DELETE /api/stripe-api/keys/:id',
      'GET /api/stripe-api/transactions',
      'POST /api/stripe-api/transactions/sync',
      'GET /api/stripe-api/balances',
      'POST /api/stripe-api/balances/refresh',
    ] }));
  } catch {}
}
