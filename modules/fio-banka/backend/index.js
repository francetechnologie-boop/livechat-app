import nodePath from 'path';
import fs from 'fs';
import { createRequire } from 'module';

import { registerFioBankaHealthRoutes } from './routes/health.routes.js';
import { registerFioBankaAccountsRoutes } from './routes/accounts.routes.js';
import { registerFioBankaTransactionsRoutes } from './routes/transactions.routes.js';
import { registerFioBankaSyncRoutes } from './routes/sync.routes.js';
import { registerFioBankaBalancesRoutes } from './routes/balances.routes.js';
import { installModule } from './installer.js';

function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
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

function redact(key, value) {
  const k = String(key || '').toLowerCase();
  if (k.includes('token') || k.includes('secret') || k.includes('password') || k.includes('authorization') || k.includes('api_key') || k === 'apikey') return '****';
  return value;
}

function makeChatLogger(ctx) {
  return function chatLog(event, payload = {}) {
    try {
      const line = `[${new Date().toISOString()}] [fio-banka] ${event} ${JSON.stringify(payload, redact)}`;
      fs.appendFileSync(getChatLogPath(ctx), line + '\n');
    } catch {}
    try { ctx?.logToFile?.(`[fio-banka] ${event} ${JSON.stringify(payload, redact)}`); } catch {}
  };
}

function getJsonMiddleware(ctx) {
  const json = ctx?.expressJson;
  if (typeof json === 'function') return json;
  try {
    const req = createRequire(nodePath.join(resolveBackendDir(ctx), 'package.json'));
    const exp = req('express');
    if (exp && typeof exp.json === 'function') return exp.json;
  } catch {}
  return null;
}

export function register(app, ctx = {}) {
  const chatLog = makeChatLogger(ctx);
  const nextCtx = { ...ctx, chatLog };

  try { registerFioBankaHealthRoutes(app, nextCtx); } catch {}

  try {
    const key = '/api/fio-banka';
    if (!globalThis.__moduleJsonMounted) globalThis.__moduleJsonMounted = new Set();
    const mounted = globalThis.__moduleJsonMounted;
    const json = getJsonMiddleware(ctx);
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

  try {
    if (!globalThis.__moduleInstalledOnce) globalThis.__moduleInstalledOnce = new Set();
    const k = 'fio-banka';
    if (!globalThis.__moduleInstalledOnce.has(k)) {
      globalThis.__moduleInstalledOnce.add(k);
      installModule().catch(() => {});
    }
  } catch {}

  registerFioBankaAccountsRoutes(app, nextCtx);
  registerFioBankaTransactionsRoutes(app, nextCtx);
  registerFioBankaSyncRoutes(app, nextCtx);
  registerFioBankaBalancesRoutes(app, nextCtx);
}

export function registerRoutes(app, ctx = {}) {
  return register(app, ctx);
}

export async function onModuleLoaded(ctx = {}) {
  try {
    if (!globalThis.__moduleInstalledOnce) globalThis.__moduleInstalledOnce = new Set();
    const k = 'fio-banka';
    if (!globalThis.__moduleInstalledOnce.has(k)) {
      globalThis.__moduleInstalledOnce.add(k);
      await installModule();
    }
  } catch {}
  try { ctx?.logToFile?.('[fio-banka] onModuleLoaded'); } catch {}
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx?.logToFile?.('[fio-banka] onModuleDisabled'); } catch {}
}
