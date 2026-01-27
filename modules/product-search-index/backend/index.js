import path from 'path';
import fs from 'fs';
import { registerPsiHealthRoutes } from './routes/health.routes.js';
import { registerPsiRunsRoutes } from './routes/runs.routes.js';
import { registerPsiMysqlRoutes } from './routes/mysql.routes.js';
import { registerPsiProfilesRoutes } from './routes/profiles.routes.js';
import { installModule } from './installer.js';

function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
  try { return path.resolve(process.cwd(), 'backend'); } catch { return process.cwd(); }
}

function getChatLogPath(ctx) {
  try {
    const backendDir = resolveBackendDir(ctx);
    return path.join(backendDir, 'chat.log'); // Standard shared log file
  } catch { return path.join(process.cwd(), 'chat.log'); }
}

function redact(key, value) {
  const k = String(key || '').toLowerCase();
  if (k.includes('password') || k.includes('api_key') || k === 'apikey' || k === 'authorization' || k.includes('token') || k.includes('secret')) return '****';
  return value;
}

function makeChatLogger(ctx) {
  return function chatLog(event, payload = {}) {
    try {
      const line = `[${new Date().toISOString()}] [product-search-index] ${event} ${JSON.stringify(payload, redact)}`;
      fs.appendFileSync(getChatLogPath(ctx), line + '\n');
    } catch {}
    try { ctx?.logToFile?.(`[product-search-index] ${event} ${JSON.stringify(payload, redact)}`); } catch {}
  };
}

export function register(app, ctx = {}) {
  // Health before parsers
  try { registerPsiHealthRoutes(app, ctx); } catch {}

  // Mount JSON parser only for methods with a body
  try {
    const key = '/api/product-search-index';
    if (!globalThis.__moduleJsonMounted) globalThis.__moduleJsonMounted = new Set();
    const mounted = globalThis.__moduleJsonMounted;
    const json = ctx?.expressJson;
    if (!mounted.has(key)) {
      app.use(key, (req, res, next) => {
        const wantsBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
        if (wantsBody && typeof json === 'function') {
          return json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next);
        }
        return next();
      });
      mounted.add(key);
    }
  } catch {}

  const chatLog = makeChatLogger(ctx);
  const utils = { chatLog, getChatLogPath: () => getChatLogPath(ctx) };

  // Run migrations/installer (non-blocking)
  try { installModule().catch(() => {}); } catch {}

  // Run + streaming routes
  try { registerPsiRunsRoutes(app, ctx, utils); } catch {}
  try { registerPsiMysqlRoutes(app, ctx, utils); } catch {}
  try { registerPsiProfilesRoutes(app, ctx, utils); } catch {}
}

export function registerRoutes(app, ctx = {}) { return register(app, ctx); }
