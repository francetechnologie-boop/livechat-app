import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import pgPkg from "pg";
import { createLogger } from "./src/core/logger.js";
import { textToSafeHTML, sanitizeAgentHtmlServer } from "./src/shared/safeHtml.js";
import { createAuthModule } from "./src/modules/auth/index.js";
import { loadModuleHooks, loadModuleRoutes } from "./src/modules/loader.js";
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
    return pgPool;
  } catch (e) {
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
    if (!p) return res.status(503).json({ ok: false, db: false, error: "db_unavailable" });
    try { await p.query("select 1"); } catch { return res.status(503).json({ ok: false, db: false, error: "db_unavailable" }); }
    return res.json({ ok: true, db: true });
  } catch {
    return res.status(503).json({ ok: false, db: false, error: "db_unavailable" });
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
      // Inspect runtime app router to detect mounted module prefixes
      const mountedSet = (() => {
        try {
          const seen = new Set();
          const stack = (app && app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];
          const extract = (layer) => {
            try {
              if (layer && layer.route && layer.route.path) {
                const path = String(layer.route.path || '');
                if (!path.startsWith('/api/')) return;
                const seg = path.split('/').filter(Boolean); // [ 'api', '<module>', ... ]
                const modId = seg.length >= 2 ? seg[1] : '';
                if (modId) seen.add(modId);
              } else if (layer && layer.name === 'router' && Array.isArray(layer.handle && layer.handle.stack)) {
                for (const sub of layer.handle.stack) extract(sub);
              }
            } catch {}
          };
          for (const l of stack) extract(l);
          return seen;
        } catch { return new Set(); }
      })();
      const items = (r.rows || []).map((row) => ({ ...row, mounted: mountedSet.has(String(row.id)) }));
      return res.json({ ok:true, items });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Reload module hooks and routes (soft reload). Requires admin token.
  app.post('/api/module-manager/reload', async (req, res) => {
    if (!hasAdminTokenNonDestructive(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
    try {
      await loadModuleHooks({ app, pool: modulePool, requireAdmin: requireAdminAuth, getSetting, setSetting, logToFile, extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout } });
      await loadModuleRoutes({ app, pool: modulePool, requireAuth, requireAdmin: requireAdminAuth, getSetting, setSetting, logToFile, extras: { server, getLogFilePath, isLogEnabled, isLogStdout, setLogStdout, io, dbSchema, ensureVisitorExists, upsertVisitorColumns, sanitizeAgentHtmlServer, textToSafeHTML, getOpenaiApiKey, getMcpToken, publicBaseFromReq } });
      return res.json({ ok:true, reloaded:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'reload_failed', message: e?.message || String(e) }); }
  });
} catch (e) { try { logToFile("module-manager helper routes failed: " + (e?.message || e)); } catch {} }

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
