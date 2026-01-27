import { registerPrestashopApiRoutes } from './routes/prestashop-api.routes.js';
import { registerPrestashopApiMcp2SourcesRoutes } from './routes/mcp2-sources.routes.js';

export function register(app, ctx) {
  try {
    const key = '/api/prestashop-api';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  // Mount module routes under /api/prestashop-api/*
  registerPrestashopApiRoutes(app, ctx);
  registerPrestashopApiMcp2SourcesRoutes(app, ctx);
}

export function registerRoutes(app, ctx) {
  // Some loaders call registerRoutes instead of register
  registerPrestashopApiRoutes(app, ctx);
  registerPrestashopApiMcp2SourcesRoutes(app, ctx);
}
