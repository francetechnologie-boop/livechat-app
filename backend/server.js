import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import pgPkg from "pg";
import { createLogger } from "./src/core/logger.js";
import { textToSafeHTML, sanitizeAgentHtmlServer } from "./src/shared/safeHtml.js";
import { createAuthModule } from "./src/modules/auth/index.js";
import { loadModuleHooks, loadModuleRoutes, getLoadedModules as getRuntimeLoadedModules } from "./src/modules/loader.js";
// Server is decoupled: modules own their routes, middleware and websockets.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logger
const logger = createLogger({
  logFile: path.join(__dirname, "chat.log"),
  defaultEnabled: !/^(0|false|no)$/i.test(process.env.LOG_ENABLED || "1"),
  defaultStdout: /^(1|true|yes)$/i.test(process.env.LOG_STDOUT || ""),
});
const logToFile = (message) => logger.logToFile(message);
const getLogFilePath = () => logger.getLogFile();
const isLogEnabled = () => logger.isEnabled();
const isLogStdout = () => logger.isStdout();
const setLogStdout = (value) => logger.setStdout(value);

// Global error handlers
try {
  process.on("uncaughtException", (e) => {
    try { logToFile(`[uncaughtException] ${e?.stack || e}`); } catch {}
  });
  process.on("unhandledRejection", (e) => {
    try { logToFile(`[unhandledRejection] ${e?.stack || e}`); } catch {}
  });
} catch {}

// Optional PostgreSQL connection (used by modules)
let pgPool = null;
let lastPgError = null;
function sanitizePgErrorMessage(msg) {
  try {
    let s = String(msg || '');
    // Redact credentials if a connection string ever leaks into the message.
    s = s.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)([^@\s]+)(@)/gi, '$1****$3');
    // Prevent overly verbose output.
    if (s.length > 400) s = s.slice(0, 400) + '…';
    return s;
  } catch {
    return '';
  }
}
async function getPg() {
  if (pgPool) return pgPool;
  try {
    const { Pool } = pgPkg;
    // Always load backend-local .env to ensure consistent DB config
    // (roll back change that skipped override; this matches previous behavior)
    try {
      const localEnv = path.join(__dirname, ".env");
      if (fs.existsSync(localEnv)) {
        const dotenv = await import("dotenv");
        try { dotenv.config({ path: localEnv, override: true }); } catch {}
      }
    } catch {}

    const url = String(process.env.DATABASE_URL || "").trim();
    const enabled = !!url || !!process.env.PGHOST || !!process.env.PGDATABASE;
    if (!enabled) return null;
    const ctm = Number(process.env.PG_CONN_TIMEOUT_MS || 3000);
    const idle = Number(process.env.PG_IDLE_TIMEOUT_MS || 30000);
    const kad = Number(process.env.PG_KEEPALIVE_DELAY_MS || 10000);
    const max = Number(process.env.PG_POOL_MAX || 10);
    const sslOpt = (() => {
      try {
        if (/^(1|true|yes|require)$/i.test(String(process.env.PGSSL || ''))) {
          // Accept self-signed by default; tighten if you manage certs
          return { rejectUnauthorized: false };
        }
      } catch {}
      return undefined;
    })();
    const common = { connectionTimeoutMillis: ctm, idleTimeoutMillis: idle, keepAlive: true, keepAliveInitialDelayMillis: kad, max, ssl: sslOpt };
    if (url) pgPool = new Pool({ connectionString: url, ...common });
    else pgPool = new Pool({
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || "",
      database: process.env.PGDATABASE || "postgres",
      ...common,
    });
    await pgPool.query("select 1");
    lastPgError = null;
    return pgPool;
  } catch (e) {
    lastPgError = {
      at: Date.now(),
      code: e?.code ? String(e.code) : undefined,
      message: sanitizePgErrorMessage(e?.message || e),
    };
    try { logToFile(`[pg] connect_failed ${e?.message || e}`); } catch {}
    return null;
  }
}

// Minimal settings store (DB-backed when Postgres available)
async function ensureSettingsTable() {
  try {
    const p = await getPg();
    if (!p) return;
    await p.query(
      `CREATE TABLE IF NOT EXISTS settings (
         key TEXT PRIMARY KEY,
         value TEXT,
         updated_at TIMESTAMP DEFAULT NOW()
       )`
    );
  } catch {}
}
async function getSetting(key) {
  try {
    const k = String(key || "").trim();
    if (!k) return null;
    const envKey = k.toUpperCase();
    if (process.env[envKey]) return String(process.env[envKey]);
    const p = await getPg();
    if (!p) return null;
    await ensureSettingsTable();
    const r = await p.query(`SELECT value FROM settings WHERE key=$1 LIMIT 1`, [k]);
    return r.rowCount ? (r.rows[0].value || null) : null;
  } catch { return null; }
}
async function setSetting(key, value) {
  try {
    const k = String(key || "").trim();
    const v = value == null ? "" : String(value);
    const envKey = k.toUpperCase();
    if (["OPENAI_API_KEY", "MCP_TOKEN", "MCP_DEV_TOKEN", "DATABASE_URL"].includes(envKey)) {
      try { process.env[envKey] = v; } catch {}
    }
    const p = await getPg();
    if (!p) return;
    await ensureSettingsTable();
    await p.query(
      `INSERT INTO settings(key, value, updated_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [k, v]
    );
  } catch {}
}
function getOpenaiApiKey() { try { return String(process.env.OPENAI_API_KEY || ""); } catch { return ""; } }
function getMcpToken() { try { return String(process.env.MCP_TOKEN || ""); } catch { return ""; } }

// Auth shim (modules may override via createAuthModule)
let __requireAdminImpl = null;
function requireAdminAuth(req, res) {
  try {
    const expected = String(process.env.ADMIN_TOKEN || "");
    const got = req.headers["x-admin-token"] || (req.query && (req.query.admin_token || req.query.ADMIN_TOKEN));
    // Prefer explicit admin token/header first so module auth cannot block token-based admin calls
    if (expected) {
      if (String(got) === expected) return { role: "admin" };
    } else {
      if (isLocalhost(req)) return { role: "admin" };
      if (got && String(got).trim()) return { role: "admin" };
    }
    // Fallback to module-provided admin auth (cookie/session based)
    if (typeof __requireAdminImpl === "function") {
      const out = __requireAdminImpl(req, res);
      if (out) return out;
      return null;
    }
    res.status(401).json({ error: "unauthorized" });
    return null;
  } catch {
    try { res.status(401).json({ error: "unauthorized" }); } catch {}
    return null;
  }
}
function hasAdminTokenNonDestructive(req) {
  try {
    const expected = process.env.ADMIN_TOKEN || "";
    if (expected) {
      const got = req.headers["x-admin-token"] || req.query?.admin_token;
      return String(got) === expected;
    }
    return isLocalhost(req);
  } catch { return false; }
}
function isLocalhost(req) {
  try {
    const ip = (req.ip || "").toString();
    return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.0.0.1");
  } catch { return false; }
}

// Express + Socket.IO
const app = express();
app.set("trust proxy", true);
const server = http.createServer(app);
const io = new Server(server, { path: "/socket", cors: { origin: "*" }, perMessageDeflate: false, allowEIO3: true });

app.use(cors());

// Global no-cache toggle for development. Set NO_CACHE=1 to disable all browser caching
// of API responses and static assets served by this process.
const NO_CACHE = String(process.env.NO_CACHE || '').trim() === '1';
const applyNoCache = (res) => {
  try {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } catch {}
};

if (NO_CACHE) {
  // Disable caching for all /api responses during development
  app.use('/api', (req, res, next) => { applyNoCache(res); next(); });
}

// Scoped JSON body parser for auth endpoints
// Note: server-level routes do not mount a global parser; modules own their parsers.
// Auth lives at server level, so we mount a narrowly scoped parser here.
app.use('/api/auth', express.json({ limit: process.env.API_JSON_LIMIT || '50mb', strict: false }));
// Scoped JSON parser for Module Manager admin endpoints
app.use('/api/module-manager', express.json({ limit: '2mb', strict: false }));

// Allow passing admin token via query (?admin_token=...) as a fallback
app.use((req, _res, next) => {
  try {
    const q = req.query && (req.query.admin_token || req.query.ADMIN_TOKEN);
    if (q && !req.headers["x-admin-token"]) req.headers["x-admin-token"] = String(q);
  } catch {}
  next();
});

// Static frontend (Vite dist)
const distDir = path.resolve(process.env.FRONTEND_DIST_DIR || path.join(__dirname, "../frontend/dist"));
const indexHtml = path.join(distDir, "index.html");
const distExists = (() => { try { return fs.existsSync(indexHtml); } catch { return false; } })();
logToFile(`[static] distDir = ${distDir}`);
logToFile(`[static] index.html exists? ${distExists}`);
if (distExists) {
  try {
    // 1) Static assets under /assets
    const assetsDir = path.join(distDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      app.use('/assets', express.static(assetsDir, {
        setHeaders: (res, filePath) => {
          try {
            if (NO_CACHE) applyNoCache(res);
            else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } catch {}
        },
      }));
    }
    // 2) Other static files from dist. index.html is always no-cache
    app.use(express.static(distDir, {
      setHeaders: (res, filePath) => {
        try {
          const base = path.basename(filePath);
          if (base === 'index.html') applyNoCache(res);
          else if (NO_CACHE) applyNoCache(res);
          else res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        } catch {}
      },
    }));
  } catch {
    // Fallback to default static if something goes wrong
    app.use(express.static(distDir));
  }
}

// No server-level JSON parser. Modules mount their own via ctx.expressJson under /api/<module>.
// Graceful JSON parse error handling
app.use(function jsonErrorHandler(err, req, res, next) {
  try {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: 'invalid_json' });
    }
  } catch {}
  return next(err);
});

// Health endpoints
app.get("/__health", (_req, res) => {
  res.json({ distDir, indexHtmlExists: fs.existsSync(indexHtml), cwd: process.cwd(), __dirname });
});
app.get("/health", (_req, res) => { res.json({ ok: true }); });
// DB health: returns 200 when DB reachable; 503 otherwise
app.get("/api/health/db", async (_req, res) => {
  try {
    const p = await getPg();
    if (!p) return res.status(503).json({ ok: false, db: false, error: "db_unavailable", last_error: lastPgError || undefined });
    try { await p.query("select 1"); } catch { return res.status(503).json({ ok: false, db: false, error: "db_unavailable", last_error: lastPgError || undefined }); }
    return res.json({ ok: true, db: true });
  } catch {
    return res.status(503).json({ ok: false, db: false, error: "db_unavailable", last_error: lastPgError || undefined });
  }
});

// SPA fallback for non-API routes
try {
  // Exclude static assets and known API paths only.
  // Note: /mcp2/* transport URLs have /api/mcp2/aliases; non-API /mcp2/* GETs fall back to SPA.
  // Exclude /mcp/* and /testmcp/* from SPA fallback so module streams work on clean paths
  app.get(/^(?!\/(assets\/|favicon\.ico$|api\/|mcp\/|testmcp\/|messages\/|socket|__health$|health$)).*/, (req, res, next) => {
    try {
      if (!fs.existsSync(indexHtml)) return next();
      try { applyNoCache(res); } catch {}
      return res.sendFile(indexHtml);
    } catch { return next(); }
  });
} catch {}

// Settings + Module Loader
// Lightweight DB wrapper compatible with modules
const modulePool = {
  async query(...args) {
    const p = await getPg();
    if (!p) throw new Error("db_unavailable");
    return p.query(...args);
  },
  async connect() {
    const p = await getPg();
    if (!p) throw new Error("db_unavailable");
    return p.connect();
  },
};

// Safe defaults for extras used by some modules
const dbSchema = { useDbDedup: false, visitors: { idCol: "id", hasVisitorIdCol: true }, messages: { hasContent: true, hasMessage: false, hasContentHtml: true, hasAgentId: true } };
async function ensureVisitorExists(_id) { return; }
async function upsertVisitorColumns(_id, _cols) { return; }

// Readiness flag
let serverReady = false;

// Server.js now avoids defining module-specific /api/* routes; modules own APIs.

// Boot guard for login route: only pass-through after modules loaded
app.post("/api/auth/login", (req, res, next) => {
  if (!serverReady) return res.status(503).json({ error: "starting" });
  return next();
});

// Generic helpers
function publicBaseFromReq(req) {
  try {
    const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString();
    const host = (req.headers["x-forwarded-host"] || req.headers["host"] || "").toString();
    if (!host) return "";
    return `${proto}://${host}`.replace(/\/$/, "");
  } catch { return ""; }
}

// Initialize Auth and dynamically load modules
try {
  const auth = createAuthModule({ app, pool: modulePool, logToFile });
  var authFromRequest = auth.authFromRequest;
  var requireAuth = auth.requireAuth;
  var requireAdmin = auth.requireAdmin;
  __requireAdminImpl = requireAdmin;
} catch (e) { try { logToFile("auth module init failed: " + (e?.message || e)); } catch {} }

try {
  await loadModuleHooks({ app, pool: modulePool, requireAdmin: requireAdminAuth, getSetting, setSetting, logToFile, extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout } });
} catch (e) { try { logToFile("module hooks load failed: " + (e?.message || e)); } catch {} }

try {
  await loadModuleRoutes({
    app,
    pool: modulePool,
    requireAuth,
    requireAdmin: requireAdminAuth,
    getSetting,
    setSetting,
    logToFile,
    extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout, io, dbSchema, ensureVisitorExists, upsertVisitorColumns, sanitizeAgentHtmlServer, textToSafeHTML, getOpenaiApiKey, getMcpToken, publicBaseFromReq },
  });
} catch (e) { try { logToFile("module routes load failed: " + (e?.message || e)); } catch {} }

// Legacy filesystem-scanned sidebar is removed in favor of the Module Manager.

// Final catch-all error handler (including JSON parse errors from module routes)
try {
  app.use(function finalErrorHandler(err, req, res, next) {
    try {
      if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ ok: false, error: 'invalid_json' });
      }
    } catch {}
    if (res.headersSent) return next(err);
    try { return res.status(500).json({ ok: false, error: 'server_error' }); } catch { return next(err); }
  });
} catch {}

// Minimal Module Manager helpers (DB-backed)
try {
  // List modules from DB table if present, and include runtime-mounted flag
  app.get('/api/module-manager/modules', async (req, res) => {
    try {
      const p = await getPg(); if (!p) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const r = await p.query(`
        SELECT module_name AS id,
               (install::int = 1) AS installed,
               (active::int = 1) AS active,
               version,
               installed_at,
               updated_at
          FROM public.mod_module_manager_modules
         ORDER BY module_name ASC
      `);
      // Prefer module loader state (accurate) over Express router inspection.
      const mountedSet = (() => {
        try {
          const list = typeof getRuntimeLoadedModules === 'function' ? (getRuntimeLoadedModules() || []) : [];
          return new Set(list.map((m) => (m && m.id) ? String(m.id) : '').filter(Boolean));
        } catch { return new Set(); }
      })();
      const readMeta = (id) => {
        try {
          const modId = String(id || '').trim();
          if (!modId) return {};
          const modDir = path.join(__dirname, '..', 'modules', modId);
          let configJson = {};
          let moduleConfig = {};
          try {
            const cfgPath = path.join(modDir, 'config.json');
            if (fs.existsSync(cfgPath)) configJson = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
          } catch { configJson = {}; }
          try {
            const p = path.join(modDir, 'module.config.json');
            if (fs.existsSync(p)) moduleConfig = JSON.parse(fs.readFileSync(p, 'utf8'));
          } catch { moduleConfig = {}; }
          return {
            name: configJson && configJson.name ? String(configJson.name) : undefined,
            description: configJson && configJson.description ? String(configJson.description) : undefined,
            category: configJson && configJson.category ? String(configJson.category) : undefined,
            defaultInstalled: !!(configJson && configJson.defaultInstalled),
            defaultActive: !!(configJson && configJson.defaultActive),
            hasMcpTool: !!(moduleConfig && moduleConfig.hasMcpTool),
            hasProfil: !!(moduleConfig && moduleConfig.hasProfil),
            mcpTools: Array.isArray(moduleConfig && moduleConfig.mcpTools) ? moduleConfig.mcpTools : undefined,
          };
        } catch { return {}; }
      };
      const items = (r.rows || []).map((row) => {
        const meta = readMeta(row && row.id);
        return { ...row, ...meta, mounted: mountedSet.has(String(row.id)) };
      });
      return res.json({ ok:true, items });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Reload module hooks and routes (soft reload). Requires admin token.
  app.post('/api/module-manager/reload', async (req, res) => {
    // Accept either admin token header or cookie-based admin session.
    if (!requireAdminAuth(req, res)) return;
    try {
      await loadModuleHooks({ app, pool: modulePool, requireAdmin: requireAdminAuth, getSetting, setSetting, logToFile, extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout } });
      await loadModuleRoutes({ app, pool: modulePool, requireAuth, requireAdmin: requireAdminAuth, getSetting, setSetting, logToFile, extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout, io, dbSchema, ensureVisitorExists, upsertVisitorColumns, sanitizeAgentHtmlServer, textToSafeHTML, getOpenaiApiKey, getMcpToken, publicBaseFromReq } });
      return res.json({ ok:true, reloaded:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'reload_failed', message: e?.message || String(e) }); }
  });
} catch (e) { try { logToFile("module-manager helper routes failed: " + (e?.message || e)); } catch {} }

// Legacy compatibility endpoints for older frontend bundles.
// Modules should own their routes, but some deployments still request:
//   - GET /api/modules
//   - GET /api/sidebar, /api/sidebar/tree, /api/sidebar/modules
//   - GET /api/sidebar/links, /api/sidebar/submenus
// If the Module Manager module is not mounted (or migrations are partially applied),
// these handlers keep the UI functional and always return JSON.
try {
  function readModuleManifestMeta(id) {
    try {
      const modId = String(id || '').trim();
      if (!modId) return {};
      const modDir = path.join(__dirname, '..', 'modules', modId);

      // Module Manager manifest (UI metadata)
      let configJson = {};
      try {
        const cfgPath = path.join(modDir, 'config.json');
        if (fs.existsSync(cfgPath)) configJson = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      } catch { configJson = {}; }

      // Runtime module config (capability flags)
      let moduleConfig = {};
      try {
        const p = path.join(modDir, 'module.config.json');
        if (fs.existsSync(p)) moduleConfig = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch { moduleConfig = {}; }

      const mcpTools = Array.isArray(moduleConfig && moduleConfig.mcpTools) ? moduleConfig.mcpTools : undefined;
      return {
        name: configJson && configJson.name ? String(configJson.name) : undefined,
        description: configJson && configJson.description ? String(configJson.description) : undefined,
        category: configJson && configJson.category ? String(configJson.category) : undefined,
        version: configJson && configJson.version ? String(configJson.version) : undefined,
        defaultInstalled: !!(configJson && configJson.defaultInstalled),
        defaultActive: !!(configJson && configJson.defaultActive),
        hasMcpTool: !!(moduleConfig && moduleConfig.hasMcpTool),
        hasProfil: !!(moduleConfig && moduleConfig.hasProfil),
        mcpTools,
      };
    } catch {
      return {};
    }
  }

  async function pgTableExists(tableName) {
    try {
      const p = await getPg();
      if (!p) return false;
      const r = await p.query(`SELECT to_regclass($1) AS reg`, [String(tableName)]);
      return !!(r && r.rows && r.rows[0] && r.rows[0].reg);
    } catch {
      return false;
    }
  }

  async function readModulesFromDb() {
    const p = await getPg();
    if (!p) return [];
    if (!(await pgTableExists('public.mod_module_manager_modules'))) return [];
    await ensureModuleManagerModulesTable();
    const r = await p.query(`
      SELECT module_name AS id,
             (install::int = 1) AS installed,
             (active::int = 1) AS active,
             version,
             (has_mcp_tool::int = 1) AS has_mcp_tool,
             (has_profil::int = 1) AS has_profil,
             mcp_tools,
             installed_at,
             updated_at
        FROM public.mod_module_manager_modules
       ORDER BY module_name ASC
    `);
    const rows = r.rows || [];
    // Enrich with manifest metadata so UI can render Category/labels even in fallback mode.
    return rows.map((row) => {
      const id = String(row && row.id ? row.id : '').trim();
      const meta = readModuleManifestMeta(id);
      // Prefer DB flags when present; fall back to module.config.json.
      const hasMcpTool = (row && typeof row.has_mcp_tool === 'boolean') ? row.has_mcp_tool : (meta.hasMcpTool === true);
      const hasProfil = (row && typeof row.has_profil === 'boolean') ? row.has_profil : (meta.hasProfil === true);
      const mcpTools = (row && row.mcp_tools != null) ? row.mcp_tools : (meta.mcpTools || null);
      return {
        ...row,
        ...meta,
        hasMcpTool,
        hasProfil,
        mcpTools,
      };
    });
  }

  async function ensureModuleManagerModulesTable() {
    try {
      const p = await getPg();
      if (!p) return false;
      // If the legacy table exists, rename it into place (idempotent).
      try {
        const regNew = await p.query(`SELECT to_regclass('public.mod_module_manager_modules') AS t`).catch(() => null);
        const regOld = await p.query(`SELECT to_regclass('public.modules') AS t`).catch(() => null);
        if ((!regNew || !regNew.rows || !regNew.rows[0] || !regNew.rows[0].t) && (regOld && regOld.rows && regOld.rows[0] && regOld.rows[0].t)) {
          await p.query(`ALTER TABLE public.modules RENAME TO mod_module_manager_modules`).catch(() => null);
        }
      } catch {}

      await p.query(`
        CREATE TABLE IF NOT EXISTS public.mod_module_manager_modules (
          id_module   SERIAL PRIMARY KEY,
          module_name VARCHAR(64) NOT NULL,
          active      SMALLINT NOT NULL DEFAULT 0,
          version     VARCHAR(32) NOT NULL DEFAULT '0.0.0',
          install     SMALLINT NOT NULL DEFAULT 0,
          has_mcp_tool SMALLINT NOT NULL DEFAULT 0,
          has_profil SMALLINT NOT NULL DEFAULT 0,
          mcp_tools JSONB NULL,
          installed_at TIMESTAMP NULL DEFAULT NULL,
          updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `).catch(() => null);
      // Backward compat: rename legacy column "name" -> "module_name" if it still exists.
      try { await p.query(`ALTER TABLE public.mod_module_manager_modules RENAME COLUMN name TO module_name`).catch(() => null); } catch {}
      await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_mm_modules_module_name ON public.mod_module_manager_modules(module_name)`).catch(() => null);
      await p.query(`ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS schema_ok BOOLEAN NULL`).catch(() => null);
      await p.query(`ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS install_error TEXT NULL`).catch(() => null);
      await p.query(`ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS has_mcp_tool SMALLINT NOT NULL DEFAULT 0`).catch(() => null);
      await p.query(`ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS has_profil SMALLINT NOT NULL DEFAULT 0`).catch(() => null);
      await p.query(`ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS mcp_tools JSONB NULL`).catch(() => null);
      return true;
    } catch {
      return false;
    }
  }

  async function upsertModuleState(id, patch = {}) {
    const modId = String(id || '').trim();
    if (!modId) return;
    const p = await getPg();
    if (!p) throw new Error('db_unavailable');
    await ensureModuleManagerModulesTable();
    const active = (patch.active == null) ? null : (patch.active ? 1 : 0);
    const install = (patch.install == null) ? null : (patch.install ? 1 : 0);
    const version = (patch.version == null) ? null : String(patch.version || '0.0.0');
    const hasMcpTool = (patch.hasMcpTool == null) ? null : (patch.hasMcpTool ? 1 : 0);
    const hasProfil = (patch.hasProfil == null) ? null : (patch.hasProfil ? 1 : 0);
    const mcpTools = (patch.mcpTools == null) ? null : patch.mcpTools;
    // Insert or update (requires unique index on module_name)
    await p.query(
      `
      INSERT INTO public.mod_module_manager_modules(module_name, active, install, version, has_mcp_tool, has_profil, mcp_tools, installed_at, updated_at)
      VALUES ($1, COALESCE($2,0), COALESCE($3,0), COALESCE($4,'0.0.0'), COALESCE($5,0), COALESCE($6,0), $7, CASE WHEN COALESCE($3,0) = 1 THEN NOW() ELSE NULL END, NOW())
      ON CONFLICT (module_name)
      DO UPDATE SET
        active = COALESCE(EXCLUDED.active, public.mod_module_manager_modules.active),
        install = COALESCE(EXCLUDED.install, public.mod_module_manager_modules.install),
        version = COALESCE(EXCLUDED.version, public.mod_module_manager_modules.version),
        has_mcp_tool = COALESCE(EXCLUDED.has_mcp_tool, public.mod_module_manager_modules.has_mcp_tool),
        has_profil = COALESCE(EXCLUDED.has_profil, public.mod_module_manager_modules.has_profil),
        mcp_tools = COALESCE(EXCLUDED.mcp_tools, public.mod_module_manager_modules.mcp_tools),
        installed_at = CASE
          WHEN COALESCE(EXCLUDED.install, public.mod_module_manager_modules.install) = 1
            THEN COALESCE(public.mod_module_manager_modules.installed_at, NOW())
          ELSE public.mod_module_manager_modules.installed_at
        END,
        updated_at = NOW()
      `,
      [modId, active, install, version, hasMcpTool, hasProfil, mcpTools]
    );
  }

  function buildFallbackSidebarFromModules(modRows) {
    const out = [];
    const seen = new Set();
    const push = (id, pos) => {
      const mid = String(id || '').trim();
      if (!mid || seen.has(mid)) return;
      seen.add(mid);
      out.push({
        entry_id: `mod-${mid}`,
        label: mid,
        hash: `#/${mid}`,
        position: pos,
        icon: null,
        logo: null,
        active: true,
        org_id: 'org_default',
        attached: true,
        level: 0,
        parent_entry_id: null,
        type: 'module',
      });
    };
    push('module-manager', 0);
    let pos = 1;
    for (const r of Array.isArray(modRows) ? modRows : []) {
      if (!r || !r.active) continue;
      push(r.id, pos++);
    }
    return out;
  }

  app.get('/api/modules', async (req, res) => {
    // Used by the main app shell to detect active modules after login.
    // Prefer auth gating (cookie/session) when available, but keep it non-admin.
    try {
      if (typeof requireAuth === 'function') { if (!requireAuth(req, res)) return; }
    } catch {}
    try {
      const items = await readModulesFromDb();
      return res.json({ ok: true, modules: items, fallback: true });
    } catch {
      return res.status(503).json({ ok: false, error: 'db_unavailable' });
    }
  });

  // Compatibility: Module Manager install/activate actions when the module routes are missing.
  app.post('/api/modules/install', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = String((req.body && req.body.id) || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_module' });
      const meta = readModuleManifestMeta(id);
      const version = (req.body && req.body.version) ? String(req.body.version) : (meta.version || '1.0.0');
      const active = (req.body && typeof req.body.active === 'boolean') ? req.body.active : !!meta.defaultActive;
      await upsertModuleState(id, { install: true, active, version });
      return res.json({ ok: true, action: 'install', module: id, needs_restart: true, fallback: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
  app.post('/api/modules/uninstall', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = String((req.body && req.body.id) || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_module' });
      await upsertModuleState(id, { install: false, active: false });
      return res.json({ ok: true, action: 'uninstall', module: id, needs_restart: true, fallback: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
  app.post('/api/modules/activate', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = String((req.body && req.body.id) || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_module' });
      await upsertModuleState(id, { install: true, active: true });
      return res.json({ ok: true, action: 'activate', module: id, needs_restart: true, fallback: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
  app.post('/api/modules/deactivate', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = String((req.body && req.body.id) || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_module' });
      await upsertModuleState(id, { active: false });
      return res.json({ ok: true, action: 'deactivate', module: id, needs_restart: true, fallback: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
  app.post('/api/modules/refresh', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    // Best-effort: trigger a reload. This doesn't unmount stale routes; a restart is still the safest.
    try {
      await loadModuleHooks({ app, pool: modulePool, requireAdmin: requireAdminAuth, getSetting, setSetting, logToFile, extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout } });
      await loadModuleRoutes({ app, pool: modulePool, requireAuth, requireAdmin: requireAdminAuth, getSetting, setSetting, logToFile, extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout, io, dbSchema, ensureVisitorExists, upsertVisitorColumns, sanitizeAgentHtmlServer, textToSafeHTML, getOpenaiApiKey, getMcpToken, publicBaseFromReq } });
    } catch {}
    return res.json({ ok: true, action: 'refresh', fallback: true });
  });

  app.get('/api/sidebar', async (_req, res) => {
    try {
      try { res.setHeader('Cache-Control', 'no-store'); } catch {}
      const p = await getPg();
      if (!p) return res.status(503).json({ ok: false, error: 'db_unavailable' });

      const table = 'public.mod_module_manager_sidebar_entries';
      if (!(await pgTableExists(table))) {
        const mods = await readModulesFromDb();
        return res.json({ ok: true, items: buildFallbackSidebarFromModules(mods), fallback: true });
      }
      const r = await p.query(
        `SELECT entry_id, label, hash, position, icon, logo, active, org_id, attached, level, parent_entry_id, type
           FROM public.mod_module_manager_sidebar_entries
          WHERE active IS TRUE
            AND (org_id = 'org_default' OR org_id IS NULL)
          ORDER BY position ASC, label ASC`
      );
      return res.json({ ok: true, items: r.rows || [], fallback: true });
    } catch {
      return res.status(503).json({ ok: false, error: 'db_unavailable' });
    }
  });

  app.get('/api/sidebar/tree', async (req, res) => {
    try {
      try { res.setHeader('Cache-Control', 'no-store'); } catch {}
      const p = await getPg();
      if (!p) return res.status(503).json({ ok: false, error: 'db_unavailable' });

      const table = 'public.mod_module_manager_sidebar_entries';
      if (!(await pgTableExists(table))) {
        const mods = await readModulesFromDb();
        return res.json({ ok: true, items: buildFallbackSidebarFromModules(mods), fallback: true });
      }

      const lvl = Number((req.query && req.query.level) || 0) | 0;
      const parent = (req.query && req.query.parent_entry_id) ? String(req.query.parent_entry_id) : null;
      const r = await p.query(
        `SELECT entry_id, label, hash, position, icon, logo, active, org_id, level, parent_entry_id, type, attached
           FROM public.mod_module_manager_sidebar_entries
          WHERE active IS TRUE
            AND attached IS TRUE
            AND (org_id = 'org_default' OR org_id IS NULL)
            AND level = $1::smallint
            AND ( ($2::text IS NULL AND parent_entry_id IS NULL) OR ($2::text IS NOT NULL AND parent_entry_id = $2::text) )
          ORDER BY position ASC, label ASC`,
        [lvl, parent]
      );
      return res.json({ ok: true, items: r.rows || [], fallback: true });
    } catch {
      return res.status(503).json({ ok: false, error: 'db_unavailable' });
    }
  });

  app.get('/api/sidebar/modules', async (_req, res) => {
    try {
      const mods = await readModulesFromDb();
      const items = (Array.isArray(mods) ? mods : [])
        .map((m) => {
          const id = String(m && m.id ? m.id : '').trim();
          if (!id) return null;
          return {
            id,
            entry_id: `mod-${id}`,
            label: (m && m.name) ? String(m.name) : id,
            hash: `#/${id}`,
            type: 'module',
            active: !!m.active,
            install: !!m.installed,
            version: m.version || null,
            routes: [''],
          };
        })
        .filter(Boolean);
      return res.json({ ok: true, items, fallback: true });
    } catch {
      return res.json({ ok: true, items: [], fallback: true });
    }
  });

  // Library (Menus Builder): list unattached submenus (type='sous-menu')
  app.get('/api/sidebar/submenus', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      try { res.setHeader('Cache-Control', 'no-store'); } catch {}
      const p = await getPg();
      if (!p) return res.status(503).json({ ok: false, error: 'db_unavailable' });

      const table = 'public.mod_module_manager_sidebar_entries';
      if (!(await pgTableExists(table))) return res.json({ ok: true, items: [], fallback: true });

      const r = await p.query(
        `SELECT entry_id, label, hash, position, icon, logo, active, org_id, attached, level, parent_entry_id, type
           FROM public.mod_module_manager_sidebar_entries
          WHERE active IS TRUE AND attached IS FALSE
            AND (
              lower(coalesce(type,'module')) = 'sous-menu'
              OR (hash IS NULL OR hash = '')
            )
            AND (org_id = 'org_default' OR org_id IS NULL)
          ORDER BY position ASC, label ASC`
      );
      return res.json({ ok: true, items: r.rows || [], fallback: true });
    } catch {
      return res.status(503).json({ ok: false, error: 'db_unavailable' });
    }
  });

  // Library (Menus Builder): list unattached custom links (type='lien' or external hash)
  app.get('/api/sidebar/links', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      try { res.setHeader('Cache-Control', 'no-store'); } catch {}
      const p = await getPg();
      if (!p) return res.status(503).json({ ok: false, error: 'db_unavailable' });

      const table = 'public.mod_module_manager_sidebar_entries';
      if (!(await pgTableExists(table))) return res.json({ ok: true, items: [], fallback: true });

      const r = await p.query(
        `SELECT entry_id, label, hash, position, icon, logo, active, org_id, attached, level, parent_entry_id, type
           FROM public.mod_module_manager_sidebar_entries
          WHERE active IS TRUE AND attached IS FALSE
            AND (
              lower(coalesce(type,'module')) = 'lien'
              OR (hash IS NOT NULL AND hash <> '' AND LEFT(hash,2) <> '#/')
            )
            AND (org_id = 'org_default' OR org_id IS NULL)
          ORDER BY position ASC, label ASC`
      );
      return res.json({ ok: true, items: r.rows || [], fallback: true });
    } catch {
      return res.status(503).json({ ok: false, error: 'db_unavailable' });
    }
  });

  // Some frontend builds probe these endpoints to decide whether to show the Module Manager UI.
  // Provide lightweight aliases so the UI doesn't hard-fail when module-manager isn't mounted.
  app.get('/api/module-manager/mounted', async (_req, res) => {
    try {
      const list = typeof getRuntimeLoadedModules === 'function' ? (getRuntimeLoadedModules() || []) : [];
      const ids = Array.from(new Set(list.map((m) => (m && m.id) ? String(m.id) : '').filter(Boolean))).sort();
      const items = ids.map((id) => ({ id }));
      return res.json({ ok: true, items, mounted: true, count: items.length, fallback: true });
    } catch {
      return res.json({ ok: true, items: [], mounted: false, count: 0, fallback: true });
    }
  });

  // Alias to /api/module-manager/reload for older UIs.
  app.post('/api/module-manager/mount', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      await loadModuleHooks({ app, pool: modulePool, requireAdmin: requireAdminAuth, getSetting, setSetting, logToFile, extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout } });
      await loadModuleRoutes({ app, pool: modulePool, requireAuth, requireAdmin: requireAdminAuth, getSetting, setSetting, logToFile, extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout, io, dbSchema, ensureVisitorExists, upsertVisitorColumns, sanitizeAgentHtmlServer, textToSafeHTML, getOpenaiApiKey, getMcpToken, publicBaseFromReq } });
      return res.json({ ok: true, mounted: true, reloaded: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'mount_failed', message: e?.message || String(e) });
    }
  });

  // Compatibility: migrations listing used by Module Manager UI.
  app.get('/api/modules/:id/migrations', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_module' });

      // Grabbing-Sensorex migrations are intentionally disabled at runtime.
      // The module uses idempotent ensure helpers instead of installer-driven migrations.
      if (id === 'grabbing-sensorex') {
        return res.json({
          ok: true,
          module: id,
          module_name: id,
          available: [],
          applied: [],
          pending: [],
          disabled: true,
          reason: 'migrations_disabled',
          fallback: true,
        });
      }

      const migDir = path.join(__dirname, '..', 'modules', id, 'db', 'migrations');
      let available = [];
      try {
        if (fs.existsSync(migDir)) available = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
      } catch {}

      const p = await getPg();
      let applied = [];
      try {
        if (p) {
          const reg = await p.query(`SELECT to_regclass('public.migrations_log') AS reg`).catch(() => null);
          if (reg && reg.rows && reg.rows[0] && reg.rows[0].reg) {
            const r = await p.query(
              `SELECT filename, applied_at
                 FROM public.migrations_log
                WHERE module_name = $1
                ORDER BY applied_at DESC, filename DESC`,
              [id]
            );
            applied = (r.rows || [])
              .map((row) => ({ filename: String(row.filename || ''), applied_at: row.applied_at || null }))
              .filter((x) => x.filename);
          }
        }
      } catch {}

      const appliedSet = new Set(applied.map((x) => x.filename));
      const pending = available.filter((f) => !appliedSet.has(f));
      return res.json({ ok: true, module: id, module_name: id, available, applied, pending, fallback: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Compatibility: schema report used by "Rapport" in Module Manager UI.
  app.get('/api/modules/:id/schema-report', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_module' });
      const p = await getPg();
      if (!p) return res.status(503).json({ ok: false, error: 'db_unavailable' });

      const migDir = path.join(__dirname, '..', 'modules', id, 'db', 'migrations');
      const files = (fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')) : []);
      const expects = { tables: new Set(), indexes: [] };
      const norm = (n) => String(n || '').replace(/^"|"$/g, '');
      const isEphemeral = (t) => /__new\\b/i.test(String(t || '')) || /__tmp\\b/i.test(String(t || '')) || /__temp\\b/i.test(String(t || ''));
      for (const f of files) {
        let sql = '';
        try { sql = fs.readFileSync(path.join(migDir, f), 'utf8'); } catch {}
        if (!sql) continue;
        let m;
        const reTab = /CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+([A-Za-z0-9_\\.\\\"-]+)/ig;
        while ((m = reTab.exec(sql))) {
          const t = norm(m[1]);
          if (t && !isEphemeral(t)) expects.tables.add(t);
        }
        let k;
        const reIdx = /CREATE\\s+INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+([A-Za-z0-9_\\.\\\"-]+)\\s+ON\\s+([A-Za-z0-9_\\.\\\"-]+)/ig;
        while ((k = reIdx.exec(sql))) {
          const idxName = norm(k[1]);
          const idxTable = norm(k[2]);
          if (!idxName || !idxTable || isEphemeral(idxTable)) continue;
          expects.indexes.push({ name: idxName, table: idxTable });
        }
      }
      // De-dupe expected indexes
      try {
        const seen = new Set();
        expects.indexes = (expects.indexes || []).filter((x) => {
          const key = `${String(x?.name || '')}@@${String(x?.table || '')}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } catch {}

      const tables = Array.from(expects.tables);
      const results = [];
      for (const t of tables) {
        let exists = false;
        let columns = [];
        let idx = [];
        try {
          const name = t.includes('.') ? t : `public.${t}`;
          const rr = await p.query(`SELECT to_regclass($1) AS oid`, [name]);
          exists = !!(rr.rows && rr.rows[0] && rr.rows[0].oid);
        } catch {}
        try {
          if (exists) {
            const parts = t.split('.'); const tbl = parts.pop();
            const cr = await p.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`, [tbl]);
            columns = cr.rows || [];
            const ir = await p.query(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1`, [tbl]);
            idx = (ir.rows || []).map((r) => r.indexname);
          }
        } catch {}
        results.push({ name: t, exists, columns, indexes: idx });
      }

      const expectedIdx = (expects.indexes || []).map((it) => ({ ...it, exists: false }));
      try {
        for (const it of expectedIdx) {
          const parts = String(it.table || '').split('.');
          const tbl = parts.pop();
          const rr = await p.query(`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2 LIMIT 1`, [tbl, it.name]);
          it.exists = !!(rr.rowCount);
        }
      } catch {}

      const missingTables = results.filter((r) => !r.exists).map((r) => r.name);
      const missingIdx = expectedIdx.filter((x) => !x.exists).map((x) => `${x.name} ON ${x.table}`);
      const derivedOk = (missingTables.length === 0 && missingIdx.length === 0);

      // Store derived flags for UI (best-effort)
      try {
        await ensureModuleManagerModulesTable();
        await p.query(
          `UPDATE public.mod_module_manager_modules
              SET schema_ok = $1,
                  updated_at = NOW()
            WHERE module_name = $2`,
          [derivedOk, id]
        );
      } catch {}

      return res.json({
        ok: true,
        module: id,
        schema_ok: derivedOk,
        install_error: null,
        derived_ok: derivedOk,
        expected: { tables, indexes: expects.indexes || [] },
        present: { tables: results, missingTables, missingIndexes: missingIdx },
        fallback: true,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Compatibility: scan all modules schema status (heavy).
  app.post('/api/modules/schema-scan', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const mods = await readModulesFromDb();
      const installed = (Array.isArray(mods) ? mods : []).filter((m) => m && m.installed);
      const out = [];
      for (const m of installed) {
        const id = String(m.id || '').trim();
        if (!id) continue;
        // Call local schema-report logic by reusing the same code path via fetch is overkill.
        // We inline a minimal check: missingTables+missingIndexes counts.
        try {
          const p = await getPg();
          if (!p) throw new Error('db_unavailable');
          const migDir = path.join(__dirname, '..', 'modules', id, 'db', 'migrations');
          const files = (fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')) : []);
          const expects = { tables: new Set(), indexes: [] };
          const norm = (n) => String(n || '').replace(/^"|"$/g, '');
          for (const f of files) {
            let sql = '';
            try { sql = fs.readFileSync(path.join(migDir, f), 'utf8'); } catch {}
            if (!sql) continue;
            let mm;
            const reTab = /CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+([A-Za-z0-9_\\.\\\"-]+)/ig;
            while ((mm = reTab.exec(sql))) expects.tables.add(norm(mm[1]));
            let kk;
            const reIdx = /CREATE\\s+INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+([A-Za-z0-9_\\.\\\"-]+)\\s+ON\\s+([A-Za-z0-9_\\.\\\"-]+)/ig;
            while ((kk = reIdx.exec(sql))) expects.indexes.push({ name: norm(kk[1]), table: norm(kk[2]) });
          }
          const missingTables = [];
          for (const t of Array.from(expects.tables)) {
            if (!t) continue;
            const rr = await p.query(`SELECT to_regclass($1) AS oid`, [t.includes('.') ? t : `public.${t}`]).catch(() => null);
            const exists = !!(rr && rr.rows && rr.rows[0] && rr.rows[0].oid);
            if (!exists) missingTables.push(t);
          }
          const missingIdx = [];
          for (const it of expects.indexes) {
            if (!it || !it.name || !it.table) continue;
            const parts = String(it.table).split('.');
            const tbl = parts.pop();
            const rr = await p.query(`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2 LIMIT 1`, [tbl, it.name]).catch(() => null);
            if (!(rr && rr.rowCount)) missingIdx.push(`${it.name} ON ${it.table}`);
          }
          const derivedOk = (missingTables.length === 0 && missingIdx.length === 0);
          try {
            await ensureModuleManagerModulesTable();
            await p.query(`UPDATE public.mod_module_manager_modules SET schema_ok=$1, updated_at=NOW() WHERE module_name=$2`, [derivedOk, id]).catch(() => null);
          } catch {}
          out.push({ id, derived_ok: derivedOk, missingTables, missingIndexes: missingIdx });
        } catch (e) {
          out.push({ id, error: String(e?.message || e) });
        }
      }
      return res.json({ ok: true, items: out, fallback: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Compatibility: run a module installer (admin only).
  app.post('/api/modules/:id/run-installer', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_module' });

      if (id === 'grabbing-sensorex') {
        return res.json({
          ok: true,
          action: 'run-installer',
          module: id,
          skipped: true,
          reason: 'migrations_disabled',
          output: 'Installer skipped: grabbing-sensorex relies on ensure helpers; migrations are disabled.',
          fallback: true,
        });
      }

      const installer = path.join(__dirname, '..', 'modules', id, 'backend', 'installer.js');
      if (!fs.existsSync(installer)) {
        return res.status(404).json({ ok: false, error: 'missing_installer' });
      }
      const out = await new Promise((resolve) => {
        const child = spawn(process.execPath, [installer], { stdio: ['ignore', 'pipe', 'pipe'] });
        let buf = '';
        const onData = (d) => { try { buf += String(d); if (buf.length > 20000) buf = buf.slice(-20000); } catch {} };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', (code) => resolve({ code: Number(code || 0), output: buf }));
        child.on('error', (e) => resolve({ code: 1, output: String(e?.message || e) }));
      });
      const ok = out.code === 0;
      return res.status(ok ? 200 : 500).json({ ok, action: 'run-installer', module: id, code: out.code, output: out.output, fallback: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Compatibility: list mounted routes for a given module id (used by "Routes" button).
  app.get('/api/module-manager/routes', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = String((req.query && req.query.id) || '').trim();
      const stack = (app && app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];
      const itemsById = new Map();
      const push = (modId, routePath, methods) => {
        const mid = String(modId || '').trim();
        if (!mid) return;
        if (id && mid !== id) return;
        const entry = itemsById.get(mid) || { id: mid, module: mid, routes: [] };
        entry.routes.push({ path: routePath, methods });
        itemsById.set(mid, entry);
      };
      const walk = (layers, base = '') => {
        for (const layer of layers || []) {
          try {
            if (layer && layer.route && layer.route.path) {
              const pth = String(layer.route.path || '');
              const full = base ? `${base}${pth}` : pth;
              const seg = full.split('/').filter(Boolean);
              const modId = (seg[0] === 'api' && seg[1]) ? seg[1] : '';
              const methods = Object.keys(layer.route.methods || {}).filter((k) => layer.route.methods[k]).map((k) => k.toUpperCase());
              if (modId) push(modId, full, methods);
            } else if (layer && layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
              // Express stores mountpath in layer.regexp; we can't perfectly reconstruct, but nested routes still contain full /api/<id> paths in most cases.
              walk(layer.handle.stack, base);
            }
          } catch {}
        }
      };
      walk(stack, '');
      const items = Array.from(itemsById.values()).map((it) => {
        // De-dupe routes list
        const seen = new Set();
        it.routes = (it.routes || []).filter((r) => {
          const key = `${String(r.path)}@@${(r.methods || []).join(',')}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return it;
      }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return res.json({ ok: true, items, fallback: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Compatibility: mount diagnostics endpoint expected by the UI.
  app.get('/api/module-manager/mount/diagnostics', async (req, res) => {
    if (!requireAdminAuth(req, res)) return;
    try {
      const id = String((req.query && req.query.id) || '').trim();
      const modDir = id ? path.join(__dirname, '..', 'modules', id) : null;
      const exists = modDir ? fs.existsSync(modDir) : false;
      const idxJs = modDir ? path.join(modDir, 'backend', 'index.js') : null;
      const cfg = modDir ? path.join(modDir, 'module.config.json') : null;
      const loaded = (() => {
        try {
          const list = typeof getRuntimeLoadedModules === 'function' ? (getRuntimeLoadedModules() || []) : [];
          return !!list.find((m) => m && String(m.id) === id);
        } catch { return false; }
      })();
      return res.json({
        ok: true,
        id,
        moduleDir: modDir,
        exists,
        hasModuleConfig: cfg ? fs.existsSync(cfg) : false,
        hasBackendIndex: idxJs ? fs.existsSync(idxJs) : false,
        loaded,
        note: loaded ? 'module_loaded' : 'module_not_loaded',
        fallback: true,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  try { logToFile?.('[legacy] fallback routes mounted: /api/modules + /api/sidebar*'); } catch {}
} catch (e) {
  try { logToFile?.(`[legacy] fallback mount failed: ${e?.message || e}`); } catch {}
}

// Ensure API routes never fall back to HTML responses when something is missing.
// This prevents frontend `response.json()` crashes when an endpoint is not mounted.
app.use('/api', (req, res, next) => {
  try {
    if (res.headersSent) return next();
    try { logToFile?.(`[api_404] ${req.method} ${req.originalUrl}`); } catch {}
    return res.status(404).json({ ok: false, error: 'not_found', path: req.originalUrl });
  } catch {
    return next();
  }
});
app.use('/api', (err, req, res, next) => {
  try {
    if (res.headersSent) return next(err);
    try { logToFile?.(`[api_error] ${req.method} ${req.originalUrl} ${err?.message || err}`); } catch {}
    return res.status(500).json({ ok: false, error: 'server_error', message: err?.message || String(err) });
  } catch {
    return next(err);
  }
});

// Mark server ready
serverReady = true;
// Startup
const PORT = Number(process.env.PORT || 3010);

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    logToFile(`❌ Port ${PORT} already in use. Exiting.`);
    process.exit(1);
  } else {
    throw err;
  }
});

if (!server.listening) {
  server.listen(PORT, "0.0.0.0", () => {
    logToFile(`🚀 Server listening at http://0.0.0.0:${PORT}`);
  });
}
