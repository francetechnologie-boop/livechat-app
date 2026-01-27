export function registerFioBankaHealthRoutes(app) {
  app.get('/api/fio-banka/__ping', (_req, res) => res.json({ ok: true, module: 'fio-banka' }));
  app.get('/api/fio-banka/__routes', (_req, res) => res.json({
    ok: true,
    routes: [
      'GET /api/fio-banka/__ping',
      'GET /api/fio-banka/accounts',
      'POST /api/fio-banka/accounts/test',
      'POST /api/fio-banka/accounts/:id/test',
      'POST /api/fio-banka/accounts',
      'PATCH /api/fio-banka/accounts/:id',
      'DELETE /api/fio-banka/accounts/:id',
      'GET /api/fio-banka/transactions',
      'POST /api/fio-banka/sync',
      'GET /api/fio-banka/balances',
      'POST /api/fio-banka/balances/refresh',
    ],
  }));
}
