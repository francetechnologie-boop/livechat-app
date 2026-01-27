import nodePath from 'path';
import fs from 'fs';
import { installModule } from './installer.js';
import { makeEnsureHelpers } from './utils/ensure.js';

// Route groups
import { registerGrabbingJeromeHealthRoutes } from './routes/health.routes.js';
import { registerGrabbingJeromeDomainsRoutes } from './routes/domains.routes.js';
import { registerGrabbingJeromeTableSettingsRoutes } from './routes/settings.routes.js';
import { registerGrabbingJeromeTransferRoutes } from './routes/transfer.routes.js';
import { registerGrabbingJeromeTransferProductRoutes } from './routes/transfer.products.routes.js';
import { registerGrabbingJeromeTransferCategoryRoutes } from './routes/transfer.category.routes.js';
import { registerGrabbingJeromeExtractionRoutes } from './routes/extraction.routes.js';
import { registerGrabbingJeromeUrlsRoutes } from './routes/urls.routes.js';
import { registerGrabbingJeromeMappingRoutes } from './routes/mapping.routes.js';
import { registerGrabbingJeromeAdminRoutes } from './routes/admin.routes.js';
import { registerGrabbingJeromeMysqlRoutes } from './routes/mysql.routes.js';

// Minimal helpers retained from the monolith
function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
  try {
    const here = nodePath.dirname(new URL(import.meta.url).pathname);
    return nodePath.resolve(here, '..', '..', '..', 'backend');
  } catch { return process.cwd(); }
}
function getChatLogPath(ctx) {
  try {
    const backendDir = resolveBackendDir(ctx);
    const dir = nodePath.join(backendDir, 'logs');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    return nodePath.join(dir, 'chat.log');
  } catch { return nodePath.join(process.cwd(), 'chat.log'); }
}
function redact(key, value) {
  const k = String(key || '').toLowerCase();
  if (k.includes('password') || k.includes('api_key') || k === 'apikey' || k === 'authorization' || k.includes('token') || k.includes('secret')) return '****';
  return value;
}
function makeChatLogger(ctx) {
  return function chatLog(event, payload = {}) {
    try {
      const line = `[${new Date().toISOString()}] [grabbing-jerome] ${event} ${JSON.stringify(payload, redact)}`;
      fs.appendFileSync(getChatLogPath(ctx), line + '\n');
    } catch {}
    try { ctx?.logToFile?.(`[grabbing-jerome] ${event} ${JSON.stringify(payload, redact)}`); } catch {}
  };
}

export function register(app, ctx = {}) {
  // Health routes must come before any body parser on this prefix
  try { registerGrabbingJeromeHealthRoutes(app, ctx); } catch {}

  // Mount JSON parser only for methods with a body (avoid stalling GETs)
  try {
    const key = '/api/grabbing-jerome';
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

  // Apply module migrations (non-blocking)
  try { installModule().catch(() => {}); } catch {}

  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { try { res.status(401).json({ error: 'unauthorized' }); } catch {} return null; });
  const normDomain = (input) => {
    let raw = String(input || '').trim();
    if (!raw) return '';
    try { if (/^https?:\/\//i.test(raw)) { const u = new URL(raw); raw = (u.hostname || '').toLowerCase(); } } catch {}
    return raw.toLowerCase().replace(/^www\./, '');
  };

  async function hasUnaccentExt() {
    try {
      const r = await pool.query(`select 1 from pg_extension where extname='unaccent' limit 1`);
      return !!r.rowCount;
    } catch { return false; }
  }

  const ensures = makeEnsureHelpers(pool);
  const chatLog = makeChatLogger(ctx);

  const utils = {
    pool,
    chatLog,
    normDomain,
    getChatLogPath: () => getChatLogPath(ctx),
    // Ensure helpers (prefer versions from utils/ensure.js)
    ensureDomainsTable: ensures.ensureDomainsTable,
    ensureTableSettingsTable: ensures.ensureTableSettingsTable,
    ensureDomainTypeConfigTable: ensures.ensureDomainTypeConfigTable,
    ensureDomainTypeConfigHistoryTable: ensures.ensureDomainTypeConfigHistoryTable,
    hasTable: async () => false, // not needed by current routes
    ensureExtractionRunsTable: ensures.ensureExtractionRunsTable,
    ensureExtractionTable: ensures.ensureExtractionTable,
    ensureMappingToolsTable: ensures.ensureMappingToolsTable,
    ensureSendErrorLogsTable: ensures.ensureSendErrorLogsTable,
    ensureImageMapTable: ensures.ensureImageMapTable,
    ensureUrlTables: ensures.ensureUrlTables,
    hasUnaccentExt,
  };

  // Register route groups
  // Register URLs routes before domains routes to avoid path conflicts
  // e.g., DELETE /api/grabbing-jerome/domains/urls must not be captured by /api/grabbing-jerome/domains/:domain
  try { registerGrabbingJeromeUrlsRoutes(app, ctx, utils); } catch {}
  try { registerGrabbingJeromeDomainsRoutes(app, ctx, utils); } catch {}
  try { registerGrabbingJeromeTableSettingsRoutes(app, ctx, utils); } catch {}
  try { registerGrabbingJeromeTransferRoutes(app, ctx, utils); } catch {}
  try { registerGrabbingJeromeTransferProductRoutes(app, ctx, utils); } catch {}
  try { registerGrabbingJeromeTransferCategoryRoutes(app, ctx, utils); } catch {}
  try { registerGrabbingJeromeExtractionRoutes(app, ctx, utils); } catch {}
  try { registerGrabbingJeromeMappingRoutes(app, ctx, utils); } catch {}
  try { registerGrabbingJeromeAdminRoutes(app, ctx, utils); } catch {}
  try { registerGrabbingJeromeMysqlRoutes(app, ctx, utils); } catch {}
}

// Some loaders expect registerRoutes instead of register
export function registerRoutes(app, ctx = {}) { return register(app, ctx); }
