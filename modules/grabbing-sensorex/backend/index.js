import nodePath from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { makeEnsureHelpers } from './utils/ensure.js';

// Route groups
import { registerGrabbingSensorexHealthRoutes } from './routes/health.routes.js';
import { registerGrabbingSensorexDomainsRoutes } from './routes/domains.routes.js';
import { registerGrabbingSensorexTableSettingsRoutes } from './routes/settings.routes.js';
import { registerGrabbingSensorexTransferRoutes } from './routes/transfer.routes.js';
import { registerGrabbingSensorexTransferProductRoutes } from './routes/transfer.products.routes.js';
import { registerGrabbingSensorexTransferCategoryRoutes } from './routes/transfer.category.routes.js';
import { registerGrabbingSensorexCategoryRoutes } from './routes/category.routes.js';
import { registerGrabbingSensorexExtractionRoutes } from './routes/extraction.routes.js';
import { registerGrabbingSensorexUrlsRoutes } from './routes/urls.routes.js';
import { registerGrabbingSensorexMappingRoutes } from './routes/mapping.routes.js';
import { registerGrabbingSensorexMysqlRoutes } from './routes/mysql.routes.js';
import { registerTransferLogsRoutes } from './routes/transfer.logs.routes.js';

// Minimal helpers retained from the monolith
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
    // Project convention: write to backend/chat.log (not backend/logs/chat.log)
    // Ensure backendDir exists (it does in deployed environments)
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
      const line = `[${new Date().toISOString()}] [grabbing-sensorex] ${event} ${JSON.stringify(payload, redact)}`;
      fs.appendFileSync(getChatLogPath(ctx), line + '\n');
    } catch (e) {}
    try { ctx?.logToFile?.(`[grabbing-sensorex] ${event} ${JSON.stringify(payload, redact)}`); } catch (e) {}
  };
}

export function register(app, ctx = {}) {
  // Health routes must come before any body parser on this prefix
  try { registerGrabbingSensorexHealthRoutes(app, ctx); } catch (e) {}

  // Mount JSON parser only for methods with a body (avoid stalling GETs)
  try {
    const key = '/api/grabbing-sensorex';
    if (!globalThis.__moduleJsonMounted) globalThis.__moduleJsonMounted = new Set();
    const mounted = globalThis.__moduleJsonMounted;
    let jsonMw = ctx?.expressJson;
    if (typeof jsonMw !== 'function') {
      try {
        // Fallback to local express.json() when the loader didn't provide ctx.expressJson
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

  // Migrations disabled for this module per project policy

  // Best-effort bootstrap: ensure core tables exist if migrations could not run.
  // Runs once per process to avoid repeated DDL attempts.
  try {
    if (!globalThis.__moduleEnsuredOnce) globalThis.__moduleEnsuredOnce = new Set();
    const keyEnsure = 'grabbing-sensorex';
    if (!globalThis.__moduleEnsuredOnce.has(keyEnsure)) {
      globalThis.__moduleEnsuredOnce.add(keyEnsure);
      setTimeout(async () => {
        try {
          await Promise.allSettled([
            ensures.ensureDomainsTable(),
            ensures.ensureUrlTables(),
            ensures.ensureTableSettingsTable(),
            ensures.ensureExtractionRunsTable(),
            ensures.ensureExtractionTable(),
            ensures.ensureMappingToolsTable(),
            ensures.ensureSendErrorLogsTable(),
            ensures.ensureSendSuccessLogsTable(),
            ensures.ensureCategoryExtractTable(),
          ]);
        } catch (e) {}
      }, 0);
    }
  } catch (e) {}

  const pool = ctx.pool;
  const normDomain = (input) => {
    let raw = String(input || '').trim();
    if (!raw) return '';
    try { if (/^https?:\/\//i.test(raw)) { const u = new URL(raw); raw = (u.hostname || '').toLowerCase(); } } catch (e) {}
    return raw.toLowerCase().replace(/^www\./, '');
  };

  async function hasUnaccentExt() {
    try {
      const r = await pool.query(`select 1 from pg_extension where extname='unaccent' limit 1`);
      return !!r.rowCount;
    } catch (e) { return false; }
  }

  const ensures = makeEnsureHelpers(pool);
  // Ensure wrappers: run expensive DDL only once per process to avoid catalog locks under concurrent GETs
  function once(fn) {
    let done = false; let inflight = null;
    return async function wrappedOnce() {
      if (done) return;
      if (inflight) return inflight;
      inflight = Promise.resolve().then(() => fn()).then((r) => { done = true; return r; }).finally(() => { inflight = null; });
      return inflight;
    };
  }
  const chatLog = makeChatLogger(ctx);

  async function hasTable(name) {
    try {
      const tbl = String(name||'').includes('.') ? name : `public.${name}`;
      const r = await pool.query('select to_regclass($1) is not null as ok', [tbl]);
      return !!(r.rows && r.rows[0] && r.rows[0].ok);
    } catch (e) { return false; }
  }

  const utils = {
    pool,
    chatLog,
    normDomain,
    getChatLogPath: () => getChatLogPath(ctx),
    // Ensure helpers (prefer versions from utils/ensure.js)
    ensureDomainsTable: once(ensures.ensureDomainsTable),
    ensureTableSettingsTable: once(ensures.ensureTableSettingsTable),
    // unified tables removed; do not expose ensureDomainTypeConfig* helpers
    hasTable,
    ensureExtractionRunsTable: once(ensures.ensureExtractionRunsTable),
    ensureExtractionTable: once(ensures.ensureExtractionTable),
    ensureMappingToolsTable: once(ensures.ensureMappingToolsTable),
    ensureSendErrorLogsTable: once(ensures.ensureSendErrorLogsTable),
    ensureSendSuccessLogsTable: once(ensures.ensureSendSuccessLogsTable),
    ensureImageMapTable: once(ensures.ensureImageMapTable),
    ensureUrlTables: once(ensures.ensureUrlTables),
    ensureCategoryExtractTable: once(ensures.ensureCategoryExtractTable),
    hasUnaccentExt,
  };

  // Register route groups
  // Register URLs routes before domains routes to avoid path conflicts
  // e.g., DELETE /api/grabbing-sensorex/domains/urls must not be captured by /api/grabbing-sensorex/domains/:domain
  // Mount compat early so its aliases (including table-settings override) take precedence
  // compat routes removed
  try { registerGrabbingSensorexUrlsRoutes(app, ctx, utils); } catch (e) {}
  try { registerGrabbingSensorexDomainsRoutes(app, ctx, utils); } catch (e) {}
  try { registerGrabbingSensorexTableSettingsRoutes(app, ctx, utils); } catch (e) {}
  try { registerGrabbingSensorexTransferRoutes(app, ctx, utils); } catch (e) {}
  try { registerGrabbingSensorexTransferProductRoutes(app, ctx, utils); } catch (e) {}
  try { registerGrabbingSensorexTransferCategoryRoutes(app, ctx, utils); } catch (e) {}
  try { registerGrabbingSensorexCategoryRoutes(app, ctx, utils); } catch (e) {}
  try { registerGrabbingSensorexExtractionRoutes(app, ctx, utils); } catch (e) {}
  try { registerGrabbingSensorexMappingRoutes(app, ctx, utils); } catch (e) {}
  try { registerGrabbingSensorexMysqlRoutes(app, ctx, utils); } catch (e) {}
  try { registerTransferLogsRoutes(app, { ...ctx, pool }, utils); } catch (e) {}
}

// Some loaders expect registerRoutes instead of register
export function registerRoutes(app, ctx = {}) { return register(app, ctx); }
