import type { Express } from 'express';
import { registerDevManagerRoutes } from './routes/example.routes.js';

// Module backend entrypoint: called by loader to mount routes, etc.
export function register(app: Express, ctx?: { expressJson?: any }) {
  try {
    const key = '/api/dev-manager';
    const mounted: Set<string> = ((globalThis as any).__moduleJsonMounted ||= new Set());
    const json = ctx && (ctx as any).expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  registerDevManagerRoutes(app);
}
