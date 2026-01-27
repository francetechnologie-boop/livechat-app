import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { registerDhlHealthRoutes } from './routes/health.routes.js';
import { registerDhlProfilesRoutes } from './routes/profiles.routes.js';
import { registerDhlTrackingRoutes } from './routes/tracking.routes.js';
import { registerDhlPrestashopRoutes } from './routes/prestashop.routes.js';

function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', '..', '..', 'backend');
  } catch { return process.cwd(); }
}

function getChatLogPath(ctx) {
  try {
    const backendDir = resolveBackendDir(ctx);
    return path.join(backendDir, 'chat.log');
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
      const line = `[${new Date().toISOString()}] [dhl] ${event} ${JSON.stringify(payload, redact)}`;
      fs.appendFileSync(getChatLogPath(ctx), line + '\n');
    } catch {}
    try { ctx?.logToFile?.(`[dhl] ${event} ${JSON.stringify(payload, redact)}`); } catch {}
  };
}

export function register(app, ctx = {}) {
  const chatLog = (typeof ctx?.chatLog === 'function') ? ctx.chatLog : makeChatLogger(ctx);
  const ctx2 = { ...ctx, chatLog };

  // Health routes must come before any body parser on this prefix
  registerDhlHealthRoutes(app, ctx2);

  // Mount JSON parser only for methods with a body (avoid stalling GETs)
  try {
    const key = '/api/dhl';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx2?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) {
      app.use(key, (req, res, next) => {
        const m = req.method;
        const wantsBody = m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
        return wantsBody ? json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next) : next();
      });
      mounted.add(key);
    }
  } catch {}

  registerDhlTrackingRoutes(app, ctx2);
  registerDhlPrestashopRoutes(app, ctx2);
  registerDhlProfilesRoutes(app, ctx2);
}
