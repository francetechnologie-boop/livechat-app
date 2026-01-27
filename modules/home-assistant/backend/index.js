import { registerHomeAssistantRoutes } from './routes/home-assistant.routes.js';

export function register(app, ctx) {
  try {
    const key = '/api/home-assistant';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  registerHomeAssistantRoutes(app, ctx);
}


// Auto-added ping for compliance
try { app.get('/api/home-assistant/ping', (_req, res) => res.json({ ok: true, module: 'home-assistant' })); } catch {}
