import { registerCronRoutes } from './routes/cron.routes.js';
import { onModuleLoaded } from './hooks.js';
import { startCronRunner } from './services/cron-runner.js';

export function register(app, ctx) {
  try {
    const key = '/api/cron-management';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  // Ensure tables via hook and then mount routes
  onModuleLoaded(ctx).catch(() => {});
  // Background scheduler for enabled jobs
  try { startCronRunner(ctx); } catch {}
  registerCronRoutes(app, ctx);
  // Auto-added ping for compliance
  try { app.get('/api/cron-management/ping', (_req, res) => res.json({ ok: true, module: 'cron-management' })); } catch {}
}
