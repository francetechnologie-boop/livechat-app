import nodePath from 'node:path';
import fs from 'node:fs';

import { registerSupplyPlanificationHealthRoutes } from './routes/health.routes.js';
import { registerSupplyPlanificationSettingsRoutes } from './routes/settings.routes.js';
import { registerSupplyPlanificationInventoryItemsRoutes } from './routes/inventory.items.routes.js';
import { registerSupplyPlanificationInventoryTransactionsRoutes } from './routes/inventory.transactions.routes.js';
import { registerSupplyPlanificationBoardRoutes } from './routes/board.routes.js';
import { registerSupplyPlanificationNeedsRoutes } from './routes/needs.routes.js';

function pickOrgId(req) {
  try {
    const v = req?.headers?.['x-org-id'] || req?.headers?.['x-orgid'] || req?.query?.org_id || null;
    if (v == null) return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function resolveBackendDir(ctx) {
  if (ctx?.backendDir) return ctx.backendDir;
  try {
    const here = nodePath.dirname(new URL(import.meta.url).pathname);
    return nodePath.resolve(here, '..', '..', '..', 'backend');
  } catch {
    return process.cwd();
  }
}

function getChatLogPath(ctx) {
  try {
    const backendDir = resolveBackendDir(ctx);
    return nodePath.join(backendDir, 'chat.log');
  } catch {
    return nodePath.join(process.cwd(), 'chat.log');
  }
}

function makeChatLogger(ctx) {
  const base = typeof ctx?.chatLog === 'function' ? ctx.chatLog : null;
  return function chatLog(event, payload = {}) {
    try {
      if (base) return base(event, payload);
    } catch {}
    try {
      const line = `[${new Date().toISOString()}] [supply-planification] ${event} ${JSON.stringify(payload)}`;
      fs.appendFileSync(getChatLogPath(ctx), line + '\n');
    } catch {}
  };
}

export function register(app, ctx = {}) {
  const base = '/api/supply-planification';
  const chatLog = makeChatLogger(ctx);
  try { chatLog('supply_planification_register', { base, note: 'mounting routes' }); } catch {}

  // Health routes first (fast, no parsers)
  try { registerSupplyPlanificationHealthRoutes(app, ctx, { base }); } catch (e) { try { chatLog('supply_planification_health_error', { error: String(e?.message || e) }); } catch {} }

  // Mount JSON parser only for methods with a body on this prefix
  try {
    const key = base;
    if (!globalThis.__moduleJsonMounted) globalThis.__moduleJsonMounted = new Set();
    const mounted = globalThis.__moduleJsonMounted;
    if (!mounted.has(key)) {
      app.use(key, (req, res, next) => {
        const wantsBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
        if (!wantsBody) return next();
        try {
          const jsonMw = ctx?.expressJson?.({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false });
          if (typeof jsonMw === 'function') return jsonMw(req, res, next);
        } catch {}
        return next();
      });
      mounted.add(key);
    }
  } catch {}

  const pool = ctx.pool;
  const utils = { base, pool, chatLog, pickOrgId };

  try { registerSupplyPlanificationSettingsRoutes(app, ctx, utils); } catch {}
  try { registerSupplyPlanificationInventoryItemsRoutes(app, ctx, utils); } catch {}
  try { registerSupplyPlanificationInventoryTransactionsRoutes(app, ctx, utils); } catch {}
  try { registerSupplyPlanificationBoardRoutes(app, ctx, utils); } catch {}
  try { registerSupplyPlanificationNeedsRoutes(app, ctx, utils); } catch {}
}

export function registerRoutes(app, ctx = {}) { return register(app, ctx); }
