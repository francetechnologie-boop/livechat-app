import { registerDbMysqlRoutes } from './routes/db-mysql.routes.js';

export function register(app, ctx) {
  try {
    const key = '/api/db-mysql';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  try { app.get('/api/db-mysql/__ping', (_req, res) => res.json({ ok: true })); } catch {}
  registerDbMysqlRoutes(app, ctx);
}

export function registerRoutes(app, ctx) {
  return register(app, ctx);
}

