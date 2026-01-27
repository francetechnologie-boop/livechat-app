import { registerAgentsRoutes } from './routes/agents.routes.js';
import { installModule } from './installer.js';

export function register(app, ctx = {}) {
  // Mount JSON parser for this module's API namespace
  try {
    const key = '/api/agents';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  // Apply module migrations (non-blocking) then mount routes
  try { installModule().catch(() => {}); } catch {}
  registerAgentsRoutes(app, ctx);
  // Auto-added ping for compliance
  try { app.get('/api/agents/ping', (_req, res) => res.json({ ok: true, module: 'agents' })); } catch {}
}
