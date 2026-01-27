export function registerHomeAssistantRoutes(app, ctx = {}) {
  app.get('/api/home-assistant/ping', (_req, res) => res.json({ ok: true, module: 'home-assistant' }));
}

