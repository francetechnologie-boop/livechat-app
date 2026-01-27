export function registerKnowledgeBaseRoutes(app, ctx = {}) {
  app.get('/api/knowledge-base/ping', (_req, res) => res.json({ ok: true, module: 'knowledge-base' }));
}

