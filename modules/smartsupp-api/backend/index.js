import { registerSmartsuppApiRoutes } from './routes/token.routes.js';
import { registerSmartsuppRoutes } from './routes/smartsupp.routes.js';

export function register(app, ctx) {
  // Mount JSON parser only when a body is expected (avoid stalling fast GET endpoints).
  try {
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    const bases = ['/api/smartsupp', '/api/smartsupp-api'];
    for (const base of bases) {
      const key = `${base}::guarded`;
      if (typeof json === 'function' && !mounted.has(key)) {
        app.use(base, (req, res, next) => {
          const wantsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase());
          return wantsBody ? json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next) : next();
        });
        mounted.add(key);
      }
    }
  } catch {}
  registerSmartsuppApiRoutes(app, ctx);
  registerSmartsuppRoutes(app, ctx);

  try { app.get('/api/smartsupp-api/ping', (_req, res) => res.json({ ok: true, module: 'smartsupp-api' })); } catch {}
}
