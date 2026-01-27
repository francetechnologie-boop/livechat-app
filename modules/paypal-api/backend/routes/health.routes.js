export function registerPaypalApiHealthRoutes(app) {
  try { app.get('/api/paypal-api/__ping', (_req, res) => res.json({ ok: true, module: 'paypal-api' })); } catch {}
  try {
    app.get('/api/paypal-api/__routes', (_req, res) => res.json({ ok: true, routes: [
      'GET /api/paypal-api/__ping',
      'GET /api/paypal-api/transactions',
      'POST /api/paypal-api/transactions/sync',
      'GET /api/paypal-api/accounts',
      'POST /api/paypal-api/accounts/test',
      'POST /api/paypal-api/accounts',
      'POST /api/paypal-api/accounts/:id/default',
      'PATCH /api/paypal-api/accounts/:id',
      'DELETE /api/paypal-api/accounts/:id',
      'GET /api/paypal-api/profiles',
      'GET /api/paypal-api/balances',
      'POST /api/paypal-api/balances/refresh',
    ] })); 
  } catch {}
}
