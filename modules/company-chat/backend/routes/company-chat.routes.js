export function registerCompanyChatRoutes(app, ctx = {}) {
  app.get('/api/company-chat/ping', (_req, res) => res.json({ ok: true, module: 'company-chat' }));
}

