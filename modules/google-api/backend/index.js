import { registerGoogleRoutes } from './routes/google.routes.js';
import { registerGoogleApiMcp2SourcesRoutes } from './routes/mcp2-sources.routes.js';
import { onModuleLoaded } from './hooks.js';

export function register(app, ctx) {
  // Mount JSON parser for this module's API namespace
  try {
    const key = '/api/google-api';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) {
      app.use(key, (req, res, next) => {
        const m = req.method;
        const wantsBody = m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
        return wantsBody ? json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next) : next();
      });
      mounted.add(key);
    }
  } catch {}
  onModuleLoaded(ctx).catch(() => {});
  registerGoogleRoutes(app, ctx);
  // lightweight readiness route
  try { app.get('/api/google-api/ping', (_req, res) => res.json({ ok: true, module: 'google-api' })); } catch {}
  try { registerGoogleApiMcp2SourcesRoutes(app, ctx); } catch {}
}

