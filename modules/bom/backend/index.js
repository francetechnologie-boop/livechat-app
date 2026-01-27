import nodePath from 'path';
import fs from 'fs';
import { createRequire } from 'module';

import { registerBomHealthRoutes } from './routes/health.routes.js';
import { registerBomSuppliersRoutes } from './routes/suppliers.routes.js';
import { registerBomSupplierContactsRoutes } from './routes/supplier.contacts.routes.js';
import { registerBomItemsRoutes } from './routes/items.routes.js';
import { registerBomBomsRoutes } from './routes/boms.routes.js';
import { registerBomItemVendorsRoutes } from './routes/item.vendors.routes.js';
import { registerBomItemPricesRoutes } from './routes/item.prices.routes.js';
import { registerBomExplodeRoutes } from './routes/bom.explode.routes.js';
import { registerBomFxRoutes } from './routes/fx.routes.js';
import { registerBomImportVendorsRoutes } from './routes/import.vendors.routes.js';
import { registerBomPrestaRoutes } from './routes/presta.routes.js';

function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
  try {
    const here = nodePath.dirname(new URL(import.meta.url).pathname);
    return nodePath.resolve(here, '..', '..', '..', 'backend');
  } catch (e) { return process.cwd(); }
}
function getChatLogPath(ctx) {
  try {
    const backendDir = resolveBackendDir(ctx);
    return nodePath.join(backendDir, 'chat.log');
  } catch (e) { return nodePath.join(process.cwd(), 'chat.log'); }
}
function redact(key, value) {
  const k = String(key || '').toLowerCase();
  if (k.includes('password') || k.includes('api_key') || k === 'apikey' || k === 'authorization' || k.includes('token') || k.includes('secret')) return '****';
  return value;
}
function makeChatLogger(ctx) {
  return function chatLog(event, payload = {}) {
    try {
      const line = `[${new Date().toISOString()}] [bom] ${event} ${JSON.stringify(payload, redact)}`;
      fs.appendFileSync(getChatLogPath(ctx), line + '\n');
    } catch (e) {}
    try { ctx?.logToFile?.(`[bom] ${event} ${JSON.stringify(payload, redact)}`); } catch (e) {}
  };
}

export function register(app, ctx = {}) {
  // Health first, before any parsers
  try { registerBomHealthRoutes(app, ctx); } catch {}

  // Mount JSON parser only for methods with a body on this prefix
  try {
    const key = '/api/bom';
    if (!globalThis.__moduleJsonMounted) globalThis.__moduleJsonMounted = new Set();
    const mounted = globalThis.__moduleJsonMounted;
    let jsonMw = ctx?.expressJson;
    if (typeof jsonMw !== 'function') {
      try { const req = createRequire(nodePath.join(resolveBackendDir(ctx), 'package.json')); const exp = req('express'); if (exp && typeof exp.json === 'function') jsonMw = exp.json; } catch {}
    }
    if (!mounted.has(key)) {
      app.use(key, (req, res, next) => {
        const wantsBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
        if (wantsBody && typeof jsonMw === 'function') return jsonMw({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next);
        return next();
      });
      mounted.add(key);
    }
  } catch {}

  const pool = ctx.pool;
  const chatLog = makeChatLogger(ctx);
  const utils = { pool, chatLog, getChatLogPath: () => getChatLogPath(ctx) };

  try { registerBomSuppliersRoutes(app, ctx, utils); } catch {}
  try { registerBomItemsRoutes(app, ctx, utils); } catch {}
  try { registerBomItemVendorsRoutes(app, ctx, utils); } catch {}
  try { registerBomItemPricesRoutes(app, ctx, utils); } catch {}
  try { registerBomExplodeRoutes(app, ctx, utils); } catch {}
  try { registerBomSupplierContactsRoutes(app, ctx, utils); } catch {}
  try { registerBomBomsRoutes(app, ctx, utils); } catch {}
  try { registerBomImportVendorsRoutes(app, ctx, utils); } catch {}
  try { registerBomFxRoutes(app, ctx, utils); } catch {}
  try { registerBomPrestaRoutes(app, ctx, utils); } catch {}
  // admin routes removed as dead code
}

export function registerRoutes(app, ctx = {}) { return register(app, ctx); }
