import { registerGatewayRoutes } from './routes/gateway.routes.js';

export function register(app, ctx) {
  try {
    const keys = ['/api/gateway', '/api/admin/gateway'];
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    for (const key of keys) {
      if (typeof json === 'function' && !mounted.has(key)) {
        app.use(key, (req, res, next) => {
          const m = req.method;
          const wantsBody = m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
          return wantsBody ? json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next) : next();
        });
        mounted.add(key);
      }
    }
  } catch {}
  registerGatewayRoutes(app, ctx);
}
