import nodePath from 'path';
import fs from 'fs';
import { createRequire } from 'module';

import { registerCategoryDataUpdateHealthRoutes } from './routes/health.routes.js';
import { registerCategoryDataUpdateConfigRoutes } from './routes/config.routes.js';
import { registerCategoryDataUpdateCategoriesRoutes } from './routes/categories.routes.js';
import { registerCategoryDataUpdateMysqlRoutes } from './routes/mysql.routes.js';
import { registerCategoryDataUpdateFillProfilesRoutes } from './routes/fill-profiles.routes.js';
import { registerCategoryDataUpdateMakerProfilesRoutes } from './routes/maker-profiles.routes.js';
import { registerCategoryDataUpdateRunsRoutes } from './routes/runs.routes.js';
import { registerCategoryDataUpdateTranslatorProfilesRoutes } from './routes/translator-profiles.routes.js';
import { registerCategoryDataUpdateTranslatorRunsRoutes } from './routes/translator-runs.routes.js';
import { registerCategoryDataUpdateImageProfilesRoutes } from './routes/image-profiles.routes.js';
import { registerCategoryDataUpdateImageMakeRoutes } from './routes/image-make.routes.js';
import { installModule } from './installer.js';
import { registerSseRoutes, emitRunEvent } from './services/sse.js';

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
      const line = `[${new Date().toISOString()}] [category_data_update] ${event} ${JSON.stringify(payload, redact)}`;
      fs.appendFileSync(getChatLogPath(ctx), line + '\n');
    } catch (e) {}
    try { ctx?.logToFile?.(`[category_data_update] ${event} ${JSON.stringify(payload, redact)}`); } catch (e) {}
  };
}

export function register(app, ctx = {}) {
  // Health routes come before any parser on this prefix
  try { registerCategoryDataUpdateHealthRoutes(app, ctx); } catch (e) {}

  // Mount JSON parser only for methods with a body
  try {
    const key = '/api/category_data_update';
    if (!globalThis.__moduleJsonMounted) globalThis.__moduleJsonMounted = new Set();
    const mounted = globalThis.__moduleJsonMounted;
    let jsonMw = ctx?.expressJson;
    if (typeof jsonMw !== 'function') {
      try {
        const req = createRequire(nodePath.join(resolveBackendDir(ctx), 'package.json'));
        const exp = req('express');
        if (exp && typeof exp.json === 'function') jsonMw = exp.json;
      } catch (e) {}
    }
    if (!mounted.has(key)) {
      app.use(key, (req, res, next) => {
        const wantsBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
        if (wantsBody && typeof jsonMw === 'function') {
          return jsonMw({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next);
        }
        return next();
      });
      mounted.add(key);
    }
  } catch (e) {}

  const pool = ctx.pool;
  const chatLog = makeChatLogger(ctx);
  const utils = { pool, chatLog, getChatLogPath: () => getChatLogPath(ctx) };
  try { utils.sseEmit = emitRunEvent; } catch (e) {}

  try { registerCategoryDataUpdateConfigRoutes(app, ctx, utils); } catch (e) {}
  try { registerCategoryDataUpdateCategoriesRoutes(app, ctx, utils); } catch (e) {}
  try { registerCategoryDataUpdateMysqlRoutes(app, ctx, utils); } catch (e) {}
  try { registerCategoryDataUpdateFillProfilesRoutes(app, ctx, utils); } catch (e) {}
  try { registerCategoryDataUpdateMakerProfilesRoutes(app, ctx, utils); } catch (e) {}
  try { registerCategoryDataUpdateRunsRoutes(app, ctx, utils); } catch (e) {}
  try { registerCategoryDataUpdateTranslatorProfilesRoutes(app, ctx, utils); } catch (e) {}
  try { registerCategoryDataUpdateTranslatorRunsRoutes(app, ctx, utils); } catch (e) {}
  try { registerCategoryDataUpdateImageProfilesRoutes(app, ctx, utils); } catch (e) {}
  try { registerCategoryDataUpdateImageMakeRoutes(app, ctx, utils); } catch (e) {}
  try { registerSseRoutes(app, ctx, utils); } catch (e) {}
  try { installModule().catch(() => {}); } catch (e) {}
}

export function registerRoutes(app, ctx = {}) { return register(app, ctx); }
