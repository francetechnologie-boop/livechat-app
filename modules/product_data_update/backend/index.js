import nodePath from 'path';
import fs from 'fs';
import { createRequire } from 'module';

import { registerProductDataUpdateHealthRoutes } from './routes/health.routes.js';
import { registerProductDataUpdateConfigRoutes } from './routes/config.routes.js';
import { registerProductDataUpdateProductsRoutes } from './routes/products.routes.js';
import { registerProductDataUpdateMysqlRoutes } from './routes/mysql.routes.js';
import { registerProductDataUpdateFillProfilesRoutes } from './routes/fill-profiles.routes.js';
import { registerProductDataUpdateRunsRoutes } from './routes/runs.routes.js';
import { registerProductDataUpdateTranslatorProfilesRoutes } from './routes/translator-profiles.routes.js';
import { registerProductDataUpdateTranslatorRunsRoutes } from './routes/translator-runs.routes.js';
import { registerProductDataUpdateTroublesRoutes } from './routes/troubles.routes.js';
import { installModule } from './installer.js';
import { registerProductDataUpdateAttrGroupsRoutes } from './routes/attr-groups.routes.js';
import { registerProductDataUpdateJobsRoutes } from './routes/jobs.routes.js';
import { registerProductDataUpdateLogsRoutes } from './routes/logs.routes.js';
import { startPduWorker } from './services/worker.js';
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
    // De-duplicate logging: prefer server logger (ctx.logToFile) when available;
    // fall back to direct file append only if server logger is not provided.
    const msg = `[product_data_update] ${event} ${JSON.stringify(payload, redact)}`;
    if (ctx && typeof ctx.logToFile === 'function') {
      try { ctx.logToFile(msg); } catch {}
    } else {
      try {
        const line = `[${new Date().toISOString()}] ${msg}`;
        fs.appendFileSync(getChatLogPath(ctx), line + '\n');
      } catch {}
    }
  };
}

export function register(app, ctx = {}) {
  // Health routes come before any parser on this prefix
  try { registerProductDataUpdateHealthRoutes(app, ctx); } catch {}

  // Mount JSON parser only for methods with a body
  try {
    const key = '/api/product_data_update';
    if (!globalThis.__moduleJsonMounted) globalThis.__moduleJsonMounted = new Set();
    const mounted = globalThis.__moduleJsonMounted;
    let jsonMw = ctx?.expressJson;
    if (typeof jsonMw !== 'function') {
      try {
        const req = createRequire(nodePath.join(resolveBackendDir(ctx), 'package.json'));
        const exp = req('express');
        if (exp && typeof exp.json === 'function') jsonMw = exp.json;
      } catch {}
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
  } catch {}

  const pool = ctx.pool;
  const chatLog = makeChatLogger(ctx);
  const utils = { pool, chatLog, getChatLogPath: () => getChatLogPath(ctx) };
  // expose sse emitter through utils for route files
  try { utils.sseEmit = emitRunEvent; } catch {}

  // Best-effort: ensure troubles table exists even if migrations were skipped
  try {
    if (!globalThis.__pduEnsuredOnce) globalThis.__pduEnsuredOnce = new Set();
    const keyEnsure = 'pdu_troubles_table';
    if (pool && !globalThis.__pduEnsuredOnce.has(keyEnsure)) {
      globalThis.__pduEnsuredOnce.add(keyEnsure);
      setTimeout(async () => {
        try {
          const r = await pool.query("select to_regclass('public.mod_product_data_translator_troubles') is not null as ok");
          const exists = !!(r.rows && r.rows[0] && r.rows[0].ok);
          if (!exists) {
            const sql = `
CREATE TABLE IF NOT EXISTS public.mod_product_data_translator_troubles (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  run_id INTEGER NULL,
  id_product INTEGER NOT NULL,
  id_lang INTEGER NOT NULL,
  id_shop INTEGER NOT NULL,
  code TEXT NULL,
  message TEXT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
DO $$ BEGIN BEGIN CREATE INDEX IF NOT EXISTS idx_pdu_troubles_org ON public.mod_product_data_translator_troubles((COALESCE(org_id,-1))); EXCEPTION WHEN others THEN NULL; END; END $$;
DO $$ BEGIN BEGIN CREATE INDEX IF NOT EXISTS idx_pdu_troubles_key ON public.mod_product_data_translator_troubles(id_product, id_lang, id_shop); EXCEPTION WHEN others THEN NULL; END; END $$;
DO $$ BEGIN BEGIN CREATE INDEX IF NOT EXISTS idx_pdu_troubles_run ON public.mod_product_data_translator_troubles(run_id); EXCEPTION WHEN others THEN NULL; END; END $$;
DO $$ BEGIN
  IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
     WHERE n.nspname = 'public' AND t.relname = 'organizations'
       AND i.indisunique = TRUE
       AND array_length(i.indkey,1) = 1
       AND a.attname = 'id'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_product_data_translator_troubles
        ADD CONSTRAINT fk_pdu_troubles_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;`;
            await pool.query(sql);
            try { chatLog('ensure_troubles_table_ok'); } catch {}
          }
        } catch (e) { try { chatLog('ensure_troubles_table_error', { error: e?.message || String(e) }); } catch {} }
      }, 0);
    }
  } catch {}

  try { registerProductDataUpdateConfigRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateProductsRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateMysqlRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateFillProfilesRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateRunsRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateTranslatorProfilesRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateTranslatorRunsRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateTroublesRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateAttrGroupsRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateJobsRoutes(app, ctx, utils); } catch {}
  try { registerProductDataUpdateLogsRoutes(app, ctx, utils); } catch {}
  try { registerSseRoutes(app, ctx, utils); } catch {}
  try { installModule().catch(() => {}); } catch {}
  // Start async worker loop (singleton)
  try { startPduWorker(ctx, utils); } catch {}
}

export function registerRoutes(app, ctx = {}) { return register(app, ctx); }
