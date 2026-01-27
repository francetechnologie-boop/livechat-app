import { registerDevManagerRoutes } from './routes/example.routes.js';
import { registerDevManagerKanbanRoutes } from './routes/kanban.routes.js';

export function register(app, ctx) {
  const base = '/api/dev-manager';
  try {
    const json = ctx?.expressJson?.({ limit: process.env.API_JSON_LIMIT || '50mb', strict: false });
    if (json) app.use(base, json);
  } catch {}

  // Example/demo routes kept for compatibility
  try { registerDevManagerRoutes(app, ctx); } catch {}

  // Kanban (boards/cards/files) routes
  try { registerDevManagerKanbanRoutes(app, ctx); } catch {}

  // Ping
  try { app.get(base + '/ping', (_req, res) => res.json({ ok: true, module: 'dev-manager' })); } catch {}
}

