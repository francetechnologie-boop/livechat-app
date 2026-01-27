import { registerTestMcpTransportRoutes } from './routes/transport.routes.js';
import { registerTestMcpAdminRoutes } from './routes/admin.routes.js';
import { installModule } from './installer.js';

export function register(app, ctx) {
  try {
    const key = '/api/testmcp';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}

  // Ensure migrations are applied (non-blocking)
  try { installModule().catch(() => {}); } catch {}

  // Register routes
  try { registerTestMcpTransportRoutes(app, ctx); } catch {}
  try { registerTestMcpAdminRoutes(app, ctx); } catch {}

  // Simple ping for compliance
  try { app.get('/api/testmcp/ping', (_req, res) => res.json({ ok: true, module: 'testmcp' })); } catch {}
}

