// === BACKEND EXPRESS SETUP (multi-agent + visitors + visits + OpenAI) ===
import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import pg from "pg";
import bcrypt from "bcrypt"; // (kept if you add auth later)
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import OpenAI from "openai"; // (kept for future use)
import { respondWithPrompt, respondWithPromptAndTools } from "./lib/openaiResponses.js";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import { createMcpTools } from "./lib/mcpTools.js";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- LOG (defined early to avoid TDZ on first use)
const logFile = path.join(__dirname, "chat.log");
// Runtime-togglable logging controls (default enabled)
let LOG_ENABLED = !/^(0|false|no)$/i.test(process.env.LOG_ENABLED || "1");
let LOG_STDOUT = /^(1|true|yes)$/i.test(process.env.LOG_STDOUT || "");
function logToFile(message) {
  if (!LOG_ENABLED) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}\n`;
  try {
    // Async append to avoid blocking the event loop on hot paths
    fs.appendFile(logFile, line, () => {});
  } catch {}
  if (LOG_STDOUT) {
    try { console.log(line.trim()); } catch {}
  }
}

// Directory for MCP uploads (declared early to avoid TDZ when used below)
const mcpUploadDir = path.join(__dirname, 'uploads', 'mcp');
const mcpDevUploadDir = path.join(__dirname, 'uploads', 'mcp-dev');
try { fs.mkdirSync(mcpUploadDir, { recursive: true }); } catch {}
try { fs.mkdirSync(mcpDevUploadDir, { recursive: true }); } catch {}

// ---- App & Socket.IO
const app = express();
app.set("trust proxy", true);
const server = http.createServer(app);
// Disable WS per-message compression to reduce CPU usage under load
const io = new Server(server, { path: "/socket", cors: { origin: "*" }, perMessageDeflate: false });

app.use(cors());
// Defer JSON body parsing to specific route prefixes to avoid overhead on static/socket
// We'll mount JSON parsing later for ['\/api', '\/mcp', '\/messages'] only.

// Readiness flag: set to true after heavy init completes
let serverReady = false;

// Serve built frontend (Vite dist)
const distDir = path.join(__dirname, "../frontend/dist");
const indexHtml = path.join(distDir, "index.html");
logToFile(`🗂️  Static distDir = ${distDir}`);
logToFile(`📄 index.html exists? ${fs.existsSync(indexHtml)}`);
app.use(express.static(distDir)); // /index.html, /assets/*

// Mount JSON parser only for routes that need it
// Include /mcp-dev so its JSON endpoints receive parsed bodies
// Raise JSON limit to better accommodate base64 payloads (fallback path)
app.use(["/api", "/mcp", "/mcp-dev", "/messages"], express.json({ limit: "100mb" }));

// Early health endpoints and start listening ASAP to satisfy deploy smoke tests
// Note: Additional routes are registered below; Express allows adding routes after listen.
app.get("/__health", (_req, res) => {
  res.json({
    distDir,
    indexHtmlExists: fs.existsSync(indexHtml),
    cwd: process.cwd(),
    __dirname,
  });
});
app.get("/health", (_req, res) => {
  res.json({ openai_ready: true });
});

// Gate critical auth route during boot to avoid 404/500 before routes/DB ready
app.post('/api/auth/login', (req, res, next) => {
  if (!serverReady) return res.status(503).json({ error: 'starting' });
  return next();
});

// Start server only once (listen at the bottom)
// Previously we started early to expose /__health during init, but that caused
// duplicate listen attempts. We now rely on the single listen near the end.
// const EARLY_PORT = Number(process.env.PORT || 3010);
// if (!server.listening) {
//   try {
//     server.listen(EARLY_PORT, "0.0.0.0", () => {
//       console.log(`[startup] Listening on http://0.0.0.0:${EARLY_PORT}`);
//     });
//   } catch {}
// }

// ---- Postgres
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://livechat_user:Alexcaroline12@127.0.0.1:5432/livechat",
  ssl:
    String(process.env.PGSSL || "").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : false,
  max: Number(process.env.PG_POOL_MAX || 10),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 5000),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  // Keep TCP sockets alive to survive intermediate NAT/proxy idles
  keepAlive: true,
  keepAliveInitialDelayMillis: Number(process.env.PG_KEEPALIVE_DELAY_MS || 10000),
});

// Log idle client errors (e.g., network resets), helps diagnose intermittent drops
try {
  pool.on?.('error', (err) => {
    try { logToFile(`[pg] idle_client_error code=${err?.code || ''} msg=${err?.message || err}`); } catch {}
  });
} catch {}

// (logging already defined above)

/* ============================ AUTO MIGRATIONS ============================= */
async function ensureTables() {
  try {
    // messages table — accept both columns `content` and `message`
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // add optional columns if missing
    await pool.query(
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS content TEXT`
    );
    await pool.query(
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS message TEXT`
    );
    await pool.query(
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_html TEXT`
    );
    await pool.query(
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_id TEXT`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_messages_visitor ON messages(visitor_id)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`
    );

    // visitors table - ensure table exists (minimal; no JSON meta)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS visitors (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Bring visitors table closer to desired schema by adding missing columns
    const addCol = async (sql) => {
      try {
        await pool.query(sql);
      } catch (e) {
        /* ignore */
      }
    };
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS visitor_id TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS first_seen TIMESTAMP DEFAULT NOW()`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW()`
    );
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS ip INET`);
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS country_code TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS user_agent TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS "language" TEXT`
    );
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS origin TEXT`);
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS page_url_last TEXT`
    );
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS referrer TEXT`);
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS title TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS time_zone TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS screen_w INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS screen_h INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS screen_dpr NUMERIC`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS id_shop INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS shop_name TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS id_lang INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS lang_iso VARCHAR(16)`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS lang_name TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS currency VARCHAR(8)`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS cart_total NUMERIC`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS assistant_id TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS openai_enabled BOOLEAN`
    );
    // Customer/account context
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_logged BOOLEAN`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_id INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_email TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_firstname TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_lastname TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS orders_count INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS orders_amount NUMERIC`
    );
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS city TEXT`);
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS postcode TEXT`);
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_action TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMP`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS conversation_status TEXT`
    );

    // Agents settings (augment existing agents table if present)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agents (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          role TEXT DEFAULT 'agent',
          last_login TIMESTAMP
        );
      `);
      // Add optional columns for preferences/settings
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS preferred_lang TEXT`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS notifications JSONB`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS ip_allowlist TEXT[]`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_color TEXT`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_color2 TEXT`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS ui_state JSONB`);
    } catch (e) {
      logToFile(`ℹ️ ensure agents table/cols: ${e.code || ''} ${e.message}`);
    }

    // Backfill visitor_id from id when missing to keep both columns usable
    try {
      await pool.query(
        `UPDATE visitors SET visitor_id = COALESCE(visitor_id, id) WHERE visitor_id IS NULL AND id IS NOT NULL`
      );
    } catch {}
    // Backfill id from visitor_id when missing (satisfy NOT NULL id)
    try {
      await pool.query(
        `UPDATE visitors SET id = visitor_id WHERE id IS NULL AND visitor_id IS NOT NULL`
      );
    } catch {}

    // Ensure uniqueness even if a legacy table existed without PK/unique
    try {
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS visitors_id_unique ON visitors (id)`
      );
    } catch (e) {
      logToFile(
        `ℹ️ visitors_id_unique index attempt: ${e.code || ""} ${e.message}`
      );
    }

    // Also support the legacy column name if present
    try {
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS visitors_visitor_id_unique ON visitors (visitor_id)`
      );
    } catch {}

    // Keep id and visitor_id in sync at insert time (satisfy NOT NULL on id)
    // Make creation fully idempotent and lock-serialised to avoid concurrency errors
    try {
      await pool.query('SELECT pg_advisory_lock(884211)');
      try {
        await pool.query(`
          CREATE OR REPLACE FUNCTION visitors_sync_ids_before_insert() RETURNS trigger AS $$
          BEGIN
            IF NEW.id IS NULL AND NEW.visitor_id IS NOT NULL THEN
              NEW.id := NEW.visitor_id;
            END IF;
            IF NEW.visitor_id IS NULL AND NEW.id IS NOT NULL THEN
              NEW.visitor_id := NEW.id;
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
        `);
        await pool.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1
                FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
               WHERE t.tgname = 'visitors_sync_ids'
                 AND c.relname = 'visitors'
            ) THEN
              CREATE TRIGGER visitors_sync_ids
              BEFORE INSERT ON visitors
              FOR EACH ROW
              EXECUTE FUNCTION visitors_sync_ids_before_insert();
            END IF;
          END
          $$;
        `);
      } finally {
        try { await pool.query('SELECT pg_advisory_unlock(884211)'); } catch {}
      }
    } catch (e) {
      logToFile(`?? visitors_sync_ids trigger setup: ${e.code || ''} ${e.message}`);
    }

    // Helpful secondary indexes (match desired schema)
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_country ON visitors(country_code)`
      );
    } catch {}
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_lang ON visitors(id_lang)`
      );
    } catch {}
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen DESC)`
      );
    } catch {}
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_shop ON visitors(id_shop)`
      );
    } catch {}

    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_last_action_at ON visitors(last_action_at DESC)`
      );
    } catch {}

    // Dedup support for text/uuid message ids
    try {
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS messages_id_unique ON messages (id)`
      );
    } catch {}

    // visits table for page history (optional; used by right panel)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS visits (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        page_url TEXT,
        title TEXT,
        origin TEXT,
        referrer TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_term TEXT,
        utm_content TEXT,
        occurred_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_visits_vid_time ON visits(visitor_id, occurred_at DESC)`
    );

    // automations: automatic messages configuration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_messages (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        url_match TEXT,
        locale TEXT,
        trigger_type TEXT,
        enabled BOOLEAN DEFAULT FALSE,
        triggered_count INTEGER DEFAULT 0,
        conversations_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_auto_messages_enabled ON auto_messages(enabled)`
    );

    // welcome messages per shop_name + lang_iso
    await pool.query(`
      CREATE TABLE IF NOT EXISTS welcome_message (
        id_message TEXT PRIMARY KEY,
        shop_name TEXT NOT NULL,
        lang_iso VARCHAR(16) NOT NULL,
        title TEXT,
        content TEXT,
        enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS welcome_message_shop_lang_unique ON welcome_message (shop_name, lang_iso)`
    );

    // Chatbot (OpenAI Assistant) config per shop/lang
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chatbot_config (
        id_bot TEXT PRIMARY KEY,
        shop_name TEXT NOT NULL,
        lang_iso VARCHAR(16) NOT NULL,
        assistant_id TEXT,
        enabled BOOLEAN DEFAULT FALSE,
        file_ids TEXT[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS chatbot_config_shop_lang_unique ON chatbot_config (shop_name, lang_iso)`
    );
    // Add optional config columns if missing (minimal set only)
    const addColCfg = async (sql) => { try { await pool.query(sql); } catch {} };
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS openai_api_key TEXT`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS name TEXT`);
    // Responses API prompt support
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS prompt_id TEXT`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS prompt_version TEXT`);

    // Chatbot behaviour: 'manual' | 'auto_draft' | 'auto_reply'
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS bot_behavior TEXT`);

    // Drop unused legacy/advanced columns to keep the table minimal
    const dropCol = async (c) => {
      try { await pool.query(`ALTER TABLE chatbot_config DROP COLUMN IF EXISTS ${c}`); } catch {}
    };
    await dropCol('assistant_id');
    await dropCol('file_ids');
    await dropCol('instructions');
    await dropCol('model');
    await dropCol('temperature');
    await dropCol('top_p');
    await dropCol('response_format');
    await dropCol('tools_code_interpreter');
    await dropCol('tools_file_search');
    await dropCol('openai_org');
    await dropCol('openai_project');
    await dropCol('openai_base_url');
    await dropCol('vector_store_id');
    await dropCol('web_search_enabled');
    await dropCol('web_search_domains');
    await dropCol('web_search_context_size');
    await dropCol('text_verbosity');
    await dropCol('reasoning_effort');
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS web_search_enabled BOOLEAN`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS web_search_domains TEXT[]`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS web_search_context_size TEXT`);
  await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS text_verbosity TEXT`);
  await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS reasoning_effort TEXT`);
  // MCP integration per-bot (optional)
  await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN`);
  await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_tools TEXT[]`);
  await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_token TEXT`);
  // Files uploaded via MCP tools or HTTP
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_type TEXT,
      size_bytes INTEGER,
      bot_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Key/Value settings table for server-wide options (e.g., MCP token)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  } catch (e) {
    logToFile(`⚠️ ensureTables failed: ${e.code || ""} ${e.message}`);
  }
}

// ---- Debug toggles
const DEBUG_CHAT = /^(1|true|yes)$/i.test(process.env.DEBUG_CHAT || "");
const DEBUG_SQL = /^(1|true|yes)$/i.test(process.env.DEBUG_SQL || "");
const DEBUG_API = /^(1|true|yes)$/i.test(process.env.DEBUG_API || "");
const DEBUG_SOCKET = /^(1|true|yes)$/i.test(process.env.DEBUG_SOCKET || "");
const DEBUG_GEO = /^(1|true|yes)$/i.test(process.env.DEBUG_GEO || "");
const DEBUG_MCP = /^(1|true|yes)$/i.test(process.env.DEBUG_MCP || "");
const DEBUG_WIDGET = /^(1|true|yes)$/i.test(process.env.DEBUG_WIDGET || "");
const DEBUG_WIDGET_RAW = /^(1|true|yes)$/i.test(
  process.env.DEBUG_WIDGET_RAW || ""
);
const WIDGET_LOG_MAX = Math.max(
  0,
  Number(process.env.WIDGET_LOG_MAX || process.env.DEBUG_WIDGET_MAX || 500)
);

function logJson(label, obj) {
  try {
    // Compact JSON to reduce CPU and disk I/O
    logToFile(`${label} ${JSON.stringify(obj)}`);
  } catch {
    logToFile(`${label} <failed to stringify>`);
  }
}

// Optional geoip-lite loader (disabled by default to avoid deprecated transitive deps)
let geoipLite = null;
const ENABLE_GEOIP_LITE = /^(1|true|yes)$/i.test(process.env.ENABLE_GEOIP_LITE || "");
if (ENABLE_GEOIP_LITE) {
  try {
    const mod = await import('geoip-lite');
    geoipLite = mod?.default || mod;
    logToFile('🌐 geoip-lite enabled');
  } catch {
    logToFile('🌐 geoip-lite not installed; skipping');
  }
}

// --- Settings helpers (simple key/value store) ---
async function getSetting(key) {
  try {
    const r = await pool.query(`SELECT value FROM settings WHERE key = $1 LIMIT 1`, [key]);
    return r.rowCount ? r.rows[0].value : null;
  } catch {
    return null;
  }
}
async function setSetting(key, value) {
  try {
    await pool.query(
      `INSERT INTO settings(key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
    return true;
  } catch {
    return false;
  }
}

// Live MCP token (overrides env when present in DB)
// Global MCP token is optional and distinct from ADMIN_TOKEN.
// Only use MCP_TOKEN; ADMIN_TOKEN is for HTTP admin endpoints only.
let mcpToken = String(process.env.MCP_TOKEN || "");
const getMcpToken = () => mcpToken;
async function loadMcpTokenFromDb() {
  const v = await getSetting('MCP_TOKEN');
  if (typeof v === 'string') mcpToken = v;
}

// Separate token/public base for Dev MCP server
let mcpDevToken = String(process.env.MCP_DEV_TOKEN || "");
const getMcpDevToken = () => mcpDevToken;
async function loadMcpDevTokenFromDb() {
  const v = await getSetting('MCP_DEV_TOKEN');
  if (typeof v === 'string') mcpDevToken = v;
}

// Public base URL override for MCP/OpenAI Actions (schema and endpoints)
let mcpPublicBase = String(process.env.MCP_PUBLIC_BASE || process.env.PUBLIC_BASE_URL || "");
const getMcpPublicBase = () => mcpPublicBase;
async function loadMcpPublicBaseFromDb() {
  const v = await getSetting('MCP_PUBLIC_BASE');
  if (typeof v === 'string') mcpPublicBase = v;
}

let mcpDevPublicBase = String(process.env.MCP_DEV_PUBLIC_BASE || "");
const getMcpDevPublicBase = () => mcpDevPublicBase;
async function loadMcpDevPublicBaseFromDb() {
  const v = await getSetting('MCP_DEV_PUBLIC_BASE');
  if (typeof v === 'string') mcpDevPublicBase = v;
}

// Dynamic OpenAI API key (used by OpenAI SDK helpers and MCP tools)
let openaiApiKey = String(process.env.OPENAI_API_KEY || "");
const getOpenaiApiKey = () => openaiApiKey;
async function loadOpenaiApiKeyFromDb() {
  const v = await getSetting('OPENAI_API_KEY');
  if (typeof v === 'string') {
    openaiApiKey = v;
    // Reflect into process.env so libraries reading env directly see the update
    process.env.OPENAI_API_KEY = v;
  }
}

// Safer widget logger (truncate big strings)
function safeObj(o, max = WIDGET_LOG_MAX) {
  if (!o || typeof o !== "object") return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) {
      out[k] = v;
      continue;
    }
    if (typeof v === "string") {
      out[k] =
        max > 0 && v.length > max ? v.slice(0, max) + `…(${v.length})` : v;
    } else if (typeof v === "object") {
      out[k] = safeObj(v, max);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function logWidget(label, payload) {
  if (!DEBUG_WIDGET && !DEBUG_WIDGET_RAW) return;
  if (DEBUG_WIDGET) logJson(label, safeObj(payload));
  if (DEBUG_WIDGET_RAW) logJson(`${label} [RAW]`, payload);
}

/* ============================ SAFE HTML HELPERS ============================ */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
function escHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function escAttr(s = "") {
  return String(s).replaceAll('"', "&quot;");
}
function textToSafeHTML(raw = "") {
  let html = escHtml(raw);
  html = html.replace(
    URL_RE,
    (u) =>
      `<a href="${escAttr(
        u
      )}" target="_blank" rel="noreferrer nofollow">${u}</a>`
  );
  return html.replace(/\n/g, "<br/>");
}

/* ============================ SAFE HTML (agent → visitor) ================= */
const HTML_ALLOWED_TAGS = new Set([
  'a','br','strong','em','ul','ol','li','p','b','i','u','s','code','pre','blockquote','span'
]);
function sanitizeAgentHtmlServer(html = "") {
  try {
    let s = String(html);
    // strip script/style/iframe/object/embed blocks
    s = s.replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
    // strip event handlers
    s = s.replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "");
    // allowlist tags
    s = s.replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (m, tag, attrs) => {
      const t = String(tag || '').toLowerCase();
      if (!HTML_ALLOWED_TAGS.has(t)) return '';
      const isClose = /^<\//.test(m);
      if (t === 'a') {
        if (isClose) return '</a>';
        const hrefMatch = attrs.match(/\shref\s*=\s*(".*?"|'[^']*'|[^\s>]+)/i);
        const href = hrefMatch ? hrefMatch[0] : '';
        return `<a ${href} target="_blank" rel="noopener noreferrer">`;
      }
      return isClose ? `</${t}>` : `<${t}>`;
    });
    return s;
  } catch { return ""; }
}

/* ============================ AUTH HELPERS ================================ */
const AUTH_SECRET = process.env.AUTH_SECRET || "change-me-dev";
const COOKIE_SECURE = /^(1|true|yes)$/i.test(process.env.COOKIE_SECURE || "");

function signToken(claims = {}, ttlSeconds = 60 * 60 * 24 * 7) {
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds);
  const payload = { ...claims, exp };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(t) {
  try {
    if (!t || typeof t !== "string") return null;
    const [body, sig] = t.split(".");
    if (!body || !sig) return null;
    const expSig = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
    if (sig !== expSig) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
function parseCookie(h = "") {
  const out = {};
  String(h || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((kv) => {
      const idx = kv.indexOf("=");
      if (idx === -1) return;
      const k = decodeURIComponent(kv.slice(0, idx));
      const v = decodeURIComponent(kv.slice(idx + 1));
      out[k] = v;
    });
  return out;
}
function authFromRequest(req) {
  try {
    const cookies = parseCookie(req.headers.cookie || "");
    const t = cookies["auth"] || null;
    return verifyToken(t);
  } catch {
    return null;
  }
}
function setAuthCookie(res, token) {
  const parts = [
    `auth=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearAuthCookie(res) {
  const parts = [
    "auth=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}
function requireAuth(req, res) {
  const user = authFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return user;
}
function requireAdminAuth(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (String(user.role || "") !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return user;
}

/* ============================ DB INTROSPECTION ============================ */
const dbSchema = {
  loaded: false,
  visitors: {
    exists: false,
    idCol: null,
    hasCreatedAt: false,
    hasMeta: false,
    hasIdCol: false,
    hasVisitorIdCol: false,
    visitorIdNotNull: false,
    hasLastSeen: false,
    columns: [],
  },
  messages: {
    idType: null, // 'integer' | 'text' | 'uuid' | other
    hasContent: false,
    hasContentHtml: false,
    hasMessage: false,
    hasAgentId: false,
    hasVisitorId: false,
  },
  useDbDedup: false, // true if messages.id is text/uuid; false if integer
};

// Best-effort detection of tables/columns/types and constraints
async function introspectDb() {
  // Visitors: detect columns and constraints
  const vCols = await pool.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='visitors'`
  );
  if (vCols.rowCount) {
    dbSchema.visitors.exists = true;
    dbSchema.visitors.columns = vCols.rows.map((r) => r.column_name);
    let hasId = false;
    let hasVisitorId = false;
    for (const r of vCols.rows) {
      if (r.column_name === "id") hasId = true;
      if (r.column_name === "visitor_id") {
        hasVisitorId = true;
        if (String(r.is_nullable).toLowerCase() === "no")
          dbSchema.visitors.visitorIdNotNull = true;
      }
      if (r.column_name === "created_at") dbSchema.visitors.hasCreatedAt = true;
      if (r.column_name === "last_seen") dbSchema.visitors.hasLastSeen = true;
      if (r.column_name === "meta") dbSchema.visitors.hasMeta = true;
    }
    dbSchema.visitors.hasIdCol = hasId;
    dbSchema.visitors.hasVisitorIdCol = hasVisitorId;

    // Which column is UNIQUE/PK?
    const uniq = await pool.query(`
      SELECT kcu.column_name, tc.constraint_type
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema='public'
        AND tc.table_name='visitors'
        AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
    `);
    const uniqCols = new Set(uniq.rows.map((r) => r.column_name));

    // Prefer column referenced by messages FK if present
    let referencedCol = null;
    try {
      const fk = await pool.query(`
        SELECT ccu.column_name AS visitors_col
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.table_schema='public'
          AND tc.table_name='messages'
          AND tc.constraint_type='FOREIGN KEY'
          AND ccu.table_name='visitors'
          AND kcu.column_name='visitor_id'
      `);
      if (fk.rowCount) referencedCol = fk.rows[0].visitors_col || null;
    } catch {}

    if (
      referencedCol &&
      (referencedCol === "id" || referencedCol === "visitor_id")
    ) {
      dbSchema.visitors.idCol = referencedCol;
    } else if (uniqCols.has("visitor_id")) {
      dbSchema.visitors.idCol = "visitor_id";
    } else if (uniqCols.has("id")) {
      dbSchema.visitors.idCol = "id";
    } else if (hasVisitorId) {
      dbSchema.visitors.idCol = "visitor_id";
    } else if (hasId) {
      dbSchema.visitors.idCol = "id";
    }
  }

  // Do not auto-add visitors.meta; project now stores concrete columns only

  // Messages
  const mCols = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='messages'`
  );
  for (const r of mCols.rows) {
    if (r.column_name === "id") dbSchema.messages.idType = r.data_type; // integer/text/uuid
    if (r.column_name === "content") dbSchema.messages.hasContent = true;
    if (r.column_name === "content_html") dbSchema.messages.hasContentHtml = true;
    if (r.column_name === "message") dbSchema.messages.hasMessage = true;
    if (r.column_name === "agent_id") dbSchema.messages.hasAgentId = true;
    if (r.column_name === "visitor_id") dbSchema.messages.hasVisitorId = true;
  }
  dbSchema.useDbDedup =
    dbSchema.messages.idType && dbSchema.messages.idType !== "integer";

  dbSchema.loaded = true;

  logToFile(
    `🧭 DB schema: visitors=${JSON.stringify(
      dbSchema.visitors
    )}, messages=${JSON.stringify(dbSchema.messages)}, useDbDedup=${
      dbSchema.useDbDedup
    }`
  );
}

await ensureTables().catch((e) =>
  logToFile(`⚠️ Auto-migrations failed: ${e.message}`)
);
await introspectDb().catch((e) =>
  logToFile(`⚠️ DB introspection failed: ${e.message}`)
);
// Load dynamic MCP token from DB when available
await loadMcpTokenFromDb().catch(() => {});
await loadMcpPublicBaseFromDb().catch(() => {});
await loadMcpDevTokenFromDb().catch(() => {});
await loadMcpDevPublicBaseFromDb().catch(() => {});
await loadOpenaiApiKeyFromDb().catch(() => {});
// init MaxMind after function and reader are defined (see below)

// Optional one-shot backfill from meta and drop the column if requested
async function maybeBackfillAndDropMeta() {
  try {
    const flag = String(process.env.DROP_VISITORS_META || "").toLowerCase();
    const enabled = flag === "1" || flag === "true" || flag === "yes";
    if (!enabled) return;
    if (!dbSchema.visitors.exists) return;

    // Re-introspect to ensure we have the latest column info
    try {
      await introspectDb();
    } catch {}
    if (!dbSchema.visitors.hasMeta) {
      logToFile("ℹ️ visitors.meta does not exist; nothing to drop");
      return;
    }

    const idCol =
      dbSchema.visitors.idCol ||
      (dbSchema.visitors.hasVisitorIdCol ? "visitor_id" : "id") ||
      "visitor_id";

    logToFile("🛠️ Backfilling visitors columns from meta before drop…");
    await pool.query(`
      UPDATE public.visitors
      SET
        customer_logged = COALESCE(
          customer_logged,
          NULLIF(meta->>'customer_logged','')::boolean,
          NULLIF(meta->'customer'->>'logged','')::boolean,
          NULLIF(meta->'customer'->>'is_logged','')::boolean
        ),
        customer_id = COALESCE(
          customer_id,
          NULLIF(meta->>'customer_id','')::int,
          NULLIF(meta->>'id_customer','')::int,
          NULLIF(meta->'customer'->>'id','')::int,
          NULLIF(meta->'customer'->>'customer_id','')::int
        ),
        customer_email = COALESCE(
          customer_email,
          NULLIF(meta->>'customer_email',''),
          NULLIF(meta->'customer'->>'email','')
        ),
        customer_firstname = COALESCE(
          customer_firstname,
          NULLIF(meta->>'customer_firstname',''),
          NULLIF(meta->'customer'->>'firstname',''),
          NULLIF(meta->'customer'->>'first_name','')
        ),
        customer_lastname = COALESCE(
          customer_lastname,
          NULLIF(meta->>'customer_lastname',''),
          NULLIF(meta->'customer'->>'lastname',''),
          NULLIF(meta->'customer'->>'last_name','')
        ),
        orders_count = COALESCE(
          orders_count,
          NULLIF(meta->>'orders_count','')::int,
          NULLIF(meta->'customer'->>'orders_count','')::int
        ),
        orders_amount = COALESCE(
          orders_amount,
          NULLIF(meta->>'orders_amount','')::numeric,
          NULLIF(meta->'customer'->>'orders_amount','')::numeric
        ),
        last_action = COALESCE(last_action, NULLIF(meta->>'last_action','')),
        last_action_at = COALESCE(last_action_at, NULLIF(meta->>'last_action_at','')::timestamp),
        city = COALESCE(city, NULLIF(meta->>'city','')),
        postcode = COALESCE(postcode, NULLIF(meta->>'postcode',''), NULLIF(meta->>'zip',''))
    `);

    logToFile("🧹 Dropping visitors.meta column…");
    await pool.query(`ALTER TABLE public.visitors DROP COLUMN IF EXISTS meta`);

    // Update in-memory schema flags
    dbSchema.visitors.hasMeta = false;
    logToFile("✅ visitors.meta dropped");
  } catch (e) {
    logToFile(`⚠️ Backfill/drop meta failed: ${e.code || ""} ${e.message}`);
  }
}

// Optional geo debug logger
function geoDebugLog(ip) {
  if (!DEBUG_GEO || !ip) return;
  try {
    const lite = geoipLite?.lookup?.(ip);
    const liteOut = lite
      ? {
          country: lite.country,
          city: lite.city || null,
          zip: lite.zip || lite.postalCode || null,
        }
      : null;
    let mmOut = null;
    try {
      if (mmReader) {
        const r = mmReader.city(ip);
        mmOut = {
          country: r?.country?.isoCode || null,
          city:
            r?.city?.names?.fr || r?.city?.names?.en || r?.city?.name || null,
          postal: r?.postal?.code || null,
        };
      }
    } catch {}
    logToFile(
      `🛰️ GEO lookup ip=${ip} lite=${JSON.stringify(
        liteOut
      )} maxmind=${JSON.stringify(mmOut)}`
    );
  } catch (e) {
    logToFile(`⚠️ GEO debug failed for ip=${ip}: ${e.message}`);
  }
}

/* ============================ MAXMIND (optional) ========================== */
let mmReader = null; // @maxmind/geoip2-node Reader, if loaded
async function initMaxMind() {
  try {
    const dbPath = process.env.MAXMIND_DB_PATH || "";
    if (!dbPath) return;
    if (!fs.existsSync(dbPath)) {
      logToFile(`⚠️ MAXMIND_DB_PATH set but file not found: ${dbPath}`);
      return;
    }
    const mod = await import("@maxmind/geoip2-node");
    const buf = fs.readFileSync(dbPath);
    mmReader = mod.Reader.openBuffer(buf);
    logToFile(`🗺️  MaxMind GeoLite2 loaded from ${dbPath}`);
  } catch (e) {
    mmReader = null;
    logToFile(`⚠️ MaxMind init failed: ${e.message}`);
  }
}

function geoLookup(ip) {
  if (!ip) return { country_code: null, city: null, postcode: null };
  // Prefer MaxMind if available
  try {
    if (mmReader) {
      const r = mmReader.city(ip);
      const cc = (r && r.country && r.country.isoCode) || null;
      const city =
        (r &&
          r.city &&
          (r.city.names?.fr ||
            r.city.names?.en ||
            r.city.names?.de ||
            r.city.names?.es)) ||
        r?.city?.name ||
        null;
      const postcode = (r && r.postal && r.postal.code) || null;
      if (cc || city || postcode) return { country_code: cc, city, postcode };
    }
  } catch {}

  // Fallback to geoip-lite
  try {
    const g = geoipLite?.lookup?.(ip);
    const cc = (g && g.country) || null;
    const city = (g && g.city) || null;
    const postcode = (g && (g.zip || g.postalCode)) || null;
    return { country_code: cc, city, postcode };
  } catch {
    return { country_code: null, city: null, postcode: null };
  }
}

// Initialize MaxMind after declaration (avoids TDZ on mmReader)
await initMaxMind();

await maybeBackfillAndDropMeta();

// Mark server as ready: routes below are registered and DB/geo init completed
serverReady = true;

// Initialize MCP tools registry (reused for WS + OpenAI tool-calling)
const MCP = createMcpTools({
  pool,
  io,
  dbSchema,
  ensureVisitorExists,
  sanitizeAgentHtmlServer,
  textToSafeHTML,
  upsertVisitorColumns,
  uploadDir: mcpUploadDir,
  verifyToken: async (token, ctx={}) => {
    const t = String(token || '').trim();
    if (!t) return false;
    // Global token matches
    const g = getMcpToken();
    if (g && t === g) return true;
    // Bot-specific token
    const botId = String(ctx.id_bot || '').trim();
    if (botId) {
      const r = await pool.query(`SELECT 1 FROM chatbot_config WHERE id_bot=$1 AND COALESCE(mcp_token,'') <> '' AND mcp_token=$2 LIMIT 1`, [botId, t]);
      if (r.rowCount) return true;
    }
    // Any bot token
    const r = await pool.query(`SELECT 1 FROM chatbot_config WHERE COALESCE(mcp_token,'') <> '' AND mcp_token=$1 LIMIT 1`, [t]);
    return !!r.rowCount;
  },
  needsAuth: async (ctx={}) => {
    if (getMcpToken()) return true;
    const botId = String(ctx.id_bot || '').trim();
    if (botId) {
      const r = await pool.query(`SELECT 1 FROM chatbot_config WHERE id_bot=$1 AND COALESCE(mcp_token,'') <> '' LIMIT 1`, [botId]);
      return !!r.rowCount;
    }
    const r = await pool.query(`SELECT 1 FROM chatbot_config WHERE COALESCE(mcp_token,'') <> '' LIMIT 1`);
    return !!r.rowCount;
  }
});

/* ============================ DB HELPERS ================================== */
async function getVisitorRow(visitorId) {
  if (!dbSchema.visitors.exists) return null;
  const idCol =
    dbSchema.visitors.idCol ||
    (dbSchema.visitors.hasVisitorIdCol ? "visitor_id" : "id");
  if (!idCol) return null;
  try {
    const res = await pool.query(
      `SELECT * FROM visitors WHERE ${idCol} = $1 LIMIT 1`,
      [visitorId]
    );
    return res.rowCount ? res.rows[0] : null;
  } catch (e) {
    logToFile(`? getVisitorRow error: ${e.code || ""} ${e.message}`);
    return null;
  }
}
async function ensureVisitorExists(visitorId) {
  if (!dbSchema.visitors.exists) return; // nothing to do

  // Prefer inserting only into visitor_id to avoid type mismatches on id (some DBs use integer)
  let targetCol = null;
  if (dbSchema.visitors.hasVisitorIdCol) targetCol = 'visitor_id';
  else if (dbSchema.visitors.hasIdCol) targetCol = 'id';
  else if (dbSchema.visitors.idCol) targetCol = dbSchema.visitors.idCol;
  if (!targetCol) return;

  // Build columns to satisfy NOT NULL constraints: include both id and visitor_id when they exist
  const cols = [];
  const params = [];
  const ph = [];
  if (dbSchema.visitors.hasIdCol) { cols.push('id'); params.push(visitorId); ph.push(`$${params.length}`); }
  if (dbSchema.visitors.hasVisitorIdCol) { cols.push('visitor_id'); params.push(visitorId); ph.push(`$${params.length}`); }
  if (!cols.length) { cols.push(targetCol); params.push(visitorId); ph.push(`$${params.length}`); }
  if (dbSchema.visitors.hasCreatedAt) { cols.push('created_at'); ph.push('NOW()'); }

  const conflictCol = dbSchema.visitors.idCol || targetCol;
  const sql = `INSERT INTO visitors (${cols.join(', ')}) VALUES (${ph.join(', ')}) ON CONFLICT (${conflictCol}) DO NOTHING`;
  try {
    await pool.query(sql, params);
  } catch (e) {
    if (String(e.code) === '42P10') {
      // No unique constraint -> fallback WHERE NOT EXISTS
      const fb = `INSERT INTO visitors (${cols.join(', ')}) SELECT ${ph.join(', ')} WHERE NOT EXISTS (SELECT 1 FROM visitors WHERE ${targetCol} = $1)`;
      try { await pool.query(fb, params); logToFile('ℹ️ ensureVisitorExists fallback WHERE NOT EXISTS used'); return; } catch (e2) { logToFile(`❌ ensureVisitorExists fallback error: ${e2.code || ''} ${e2.message}`); }
    }
    logToFile(`❌ ensureVisitorExists error: ${e.code || ''} ${e.message}`);
  }

  // Optional: best-effort set id to same value when id column exists and compatible
  if (dbSchema.visitors.hasIdCol && targetCol !== 'id') {
    try { await pool.query(`UPDATE visitors SET id = $1 WHERE ${targetCol} = $1 AND id IS NULL`, [visitorId]); } catch {}
  }
}

// Hard-disable meta writes: legacy no-op after removing the column
async function upsertVisitorMeta(_visitorId, _patch = {}) {
  return; // intentionally no-op
}

// --- Hotfix: make ensureVisitorExists robust when visitors.id is NOT NULL/PRIMARY KEY
// Insert both id and visitor_id when present to satisfy constraints.
ensureVisitorExists = async function(visitorId) {
  if (!dbSchema.visitors.exists) return;

  const hasId = !!dbSchema.visitors.hasIdCol;
  const hasVid = !!dbSchema.visitors.hasVisitorIdCol;

  const cols = [];
  const params = [];
  const ph = [];

  if (hasId) { cols.push('id'); params.push(visitorId); ph.push(`$${params.length}`); }
  if (hasVid) { cols.push('visitor_id'); params.push(visitorId); ph.push(`$${params.length}`); }

  if (!cols.length && dbSchema.visitors.idCol) {
    cols.push(dbSchema.visitors.idCol);
    params.push(visitorId);
    ph.push(`$${params.length}`);
  }
  if (!cols.length) return;

  if (dbSchema.visitors.hasCreatedAt) { cols.push('created_at'); ph.push('NOW()'); }

  const conflictCol = dbSchema.visitors.idCol || (hasId ? 'id' : (hasVid ? 'visitor_id' : cols[0]));
  const sql = `INSERT INTO visitors (${cols.join(', ')}) VALUES (${ph.join(', ')}) ON CONFLICT (${conflictCol}) DO NOTHING`;
  try {
    await pool.query(sql, params);
  } catch (e) {
    if (String(e.code) === '42P10') {
      const targetCol = cols[0];
      const fb = `INSERT INTO visitors (${cols.join(', ')}) SELECT ${ph.join(', ')} WHERE NOT EXISTS (SELECT 1 FROM visitors WHERE ${targetCol} = $1)`;
      try { await pool.query(fb, params); logToFile('🟡 ensureVisitorExists fallback WHERE NOT EXISTS used'); return; } catch (e2) { logToFile(`❌ ensureVisitorExists fallback error: ${e2.code || ''} ${e2.message}`); }
    } else {
      logToFile(`❌ ensureVisitorExists error: ${e.code || ''} ${e.message}`);
    }
  }

  if (hasId && hasVid) {
    try { await pool.query(`UPDATE visitors SET id = $1 WHERE visitor_id = $1 AND id IS NULL`, [visitorId]); } catch {}
  }
}

  // Update concrete columns in visitors when they exist
  async function upsertVisitorColumns(visitorId, values = {}) {
  if (!dbSchema.visitors.exists) return;
  const colsAvailable = new Set(dbSchema.visitors.columns || []);
  const hasCols = colsAvailable.size > 0;
  const idCol =
    dbSchema.visitors.idCol ||
    (dbSchema.visitors.hasVisitorIdCol ? "visitor_id" : "id") ||
    "visitor_id";
  if (!idCol) return;

  const setters = [];
  const params = [visitorId];
  const push = (col, val) => {
    if (hasCols && !colsAvailable.has(col)) return;
    if (val === undefined || val === null) return;
    params.push(val);
    setters.push(`${col} = $${params.length}`);
  };
  // Avoid overwriting important identity fields with empty strings
  const pushNE = (col, val) => {
    if (val === undefined || val === null) return;
    if (typeof val === 'string' && val.trim() === '') return;
    push(col, val);
  };
  // Best-effort: if new columns are provided but not known in schema cache, try to add them
  const ensureCol = async (colName, ddl) => {
    if (!hasCols || colsAvailable.has(colName)) return;
    try {
      await pool.query(ddl);
      colsAvailable.add(colName);
      if (Array.isArray(dbSchema.visitors.columns)) dbSchema.visitors.columns.push(colName);
    } catch {}
  };
  if (values.conversation_status !== undefined && !colsAvailable.has('conversation_status')) {
    await ensureCol('conversation_status', `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS conversation_status TEXT`);
  }
  if (values.chatbot_id !== undefined && !colsAvailable.has('chatbot_id')) {
    await ensureCol('chatbot_id', `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS chatbot_id TEXT`);
  }
  if (values.archived !== undefined && !colsAvailable.has('archived')) {
    await ensureCol('archived', `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE`);
  }

  // Map provided values to columns
  push("ip", values.ip);
  push("country_code", values.country_code);
  push("user_agent", values.user_agent);
  push("language", values.lang || values.language);
  push("origin", values.origin);
  const pageUrlProvided = Boolean(values.page_url_last || values.page_url);
  push("page_url_last", values.page_url_last || values.page_url);
  push("referrer", values.referrer);
  push("time_zone", values.time_zone || values.timezone);
  push("screen_w", values.screen_w);
  push("screen_h", values.screen_h);
  push("screen_dpr", values.screen_dpr);
  push("id_shop", values.id_shop || values.shop_id);
  push("shop_name", values.shop_name);
  push("id_lang", values.id_lang);
  push("lang_iso", values.lang_iso || values.shop_lang_iso);
  push("lang_name", values.lang_name || values.shop_lang_name);
  push("currency", values.currency);
  push("cart_total", values.cart_total);
  push("assistant_id", values.assistant_id);
  push("chatbot_id", values.chatbot_id);
  push("openai_enabled", values.openai_enabled ?? values.assistant_enabled);
  push("archived", values.archived);
  push("conversation_status", values.conversation_status);
  push("first_seen", values.first_seen);
  // Customer/account context (if these columns exist in your schema)
  push("customer_logged", values.customer_logged);
  pushNE("customer_id", values.customer_id);
  pushNE("customer_email", values.customer_email);
  pushNE("customer_firstname", values.customer_firstname);
  pushNE("customer_lastname", values.customer_lastname);
  push("orders_count", values.orders_count);
  push("orders_amount", values.orders_amount);
  pushNE("city", values.city);
  pushNE("postcode", values.postcode || values.zip);
  const lastActionExplicit = values.last_action !== undefined && values.last_action !== null;
  const lastActionAtExplicit = values.last_action_at !== undefined && values.last_action_at !== null;
  push("last_action", values.last_action);
  push("last_action_at", values.last_action_at);

  // last_seen: set to NOW() if column exists, unless an explicit value provided
  if (colsAvailable.has("last_seen")) {
    if (values.last_seen) {
      push("last_seen", values.last_seen);
    } else {
      setters.push("last_seen = NOW()");
    }
  }

  // Derive screen_* from screen object if present
  if (values.screen && typeof values.screen === "object") {
    const sw = values.screen.width ?? values.screen.w;
    const sh = values.screen.height ?? values.screen.h;
    const sd = values.screen.pixelRatio ?? values.screen.dpr;
    push("screen_w", sw);
    push("screen_h", sh);
    push("screen_dpr", sd);
  }

  // Fallback: if we received a page URL but no explicit last_action(_at),
  // set sensible defaults only when the DB fields are currently NULL.
  if (pageUrlProvided) {
    if (colsAvailable.has("last_action") && !lastActionExplicit) {
      setters.push("last_action = COALESCE(last_action, 'page_view')");
    }
    if (colsAvailable.has("last_action_at") && !lastActionAtExplicit) {
      setters.push("last_action_at = COALESCE(last_action_at, NOW())");
    }
  }

  if (!setters.length) return;
  const sql = `UPDATE visitors SET ${setters.join(", ")} WHERE ${idCol} = $1`;
  try {
    await pool.query(sql, params);
  } catch (e) {
    logToFile(`❌ upsertVisitorColumns error: ${e.code || ""} ${e.message}`);
  }
}

/* ============================ DEDUP (when DB can't dedup) ================= */
// Env flags to control memory dedup when DB can't dedup by id
const MEM_DEDUP_ENABLED = !/^(0|false|no)$/i.test(process.env.CHAT_MEM_DEDUP || '1');
const MEM_DEDUP_LIMIT = Math.max(100, Number(process.env.CHAT_MEM_DEDUP_LIMIT || 10000));
const memDedup = new Set();
const memDedupQueue = [];
function rememberMsg(id) {
  if (!MEM_DEDUP_ENABLED) return;
  if (!id || memDedup.has(id)) return;
  memDedup.add(id);
  memDedupQueue.push(id);
  if (memDedupQueue.length > MEM_DEDUP_LIMIT) {
    const old = memDedupQueue.shift();
    memDedup.delete(old);
  }
}

/* ============================ HELPERS: client hints ======================= */
function clientNetworkInfo(s) {
  const h = s.handshake.headers || {};
  const firstIp = (v) =>
    String(v || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)[0] || null;
  // Prefer CDN/proxy-provided real client IPs
  const ip =
    h["cf-connecting-ip"] ||
    h["true-client-ip"] ||
    h["x-real-ip"] ||
    firstIp(h["x-forwarded-for"]) ||
    s.handshake.address ||
    null;
  const ua = h["user-agent"] || null;
  const lang = h["accept-language"] || null;
  return { ip, ua, lang };
}

/* ============================ SOCKET.IO =================================== */
io.on("connection", (socket) => {
  if (DEBUG_SOCKET) logToFile(`🟢 Socket connecté : ${socket.id}`);

  // Eviter les re-joins et handlers multiples
  let joinedVisitorId = null;
  socket.removeAllListeners("visitor_hello");
  socket.removeAllListeners("agent_hello");
  socket.removeAllListeners("chat_message");

  // --- Visitor joins their own room (only once) + persist meta
  socket.on("visitor_hello", async (data = {}) => {
    logWidget("🧾 WIDGET visitor_hello", data);
    const vid = typeof data.visitorId === "string" ? data.visitorId.trim() : "";
    if (!vid) return;
    if (joinedVisitorId === vid) return; // déjà joint
    joinedVisitorId = vid;
    socket.join(vid);

    await ensureVisitorExists(vid);

    const net = clientNetworkInfo(socket);
    geoDebugLog(net.ip);
    let country_code = null;
    let city = null;
    let postcode = null;
    if (net.ip) {
      const g = geoLookup(net.ip);
      country_code = g.country_code;
      city = g.city;
      postcode = g.postcode;
    }

    // Map customer fields (support nested shapes and aliases)
    const custHello =
      data && typeof data.customer === "object"
        ? data.customer
        : data && typeof data.account === "object"
        ? data.account
        : {};
    const hello_customer_logged =
      data.customer_logged ?? custHello.logged ?? custHello.is_logged ?? null;
    const hello_customer_id =
      data.customer_id ??
      data.id_customer ??
      custHello.id ??
      custHello.customer_id ??
      null;
    const hello_customer_email = data.customer_email ?? custHello.email ?? null;
    const hello_customer_firstname =
      data.customer_firstname ??
      custHello.firstname ??
      custHello.first_name ??
      null;
    const hello_customer_lastname =
      data.customer_lastname ??
      custHello.lastname ??
      custHello.last_name ??
      null;
    const hello_orders_count =
      data.orders_count ?? custHello.orders_count ?? null;
    const hello_orders_amount =
      data.orders_amount ?? custHello.orders_amount ?? null;

    const patch = {
      ip: net.ip || null,
      user_agent: net.ua || null,
      lang: data.lang || net.lang || null,
      time_zone: data.time_zone || null,
      screen: data.screen || null,
      origin: data.origin || null,
      page_url: data.page_url || null,
      page_url_last: data.page_url || null,
      title: data.title || null,
      referrer: data.referrer || null,
      currency: data.currency || null,
      shop_name: data.shop_name || null,
      id_shop: data.id_shop ?? data.shop_id ?? null,
      id_lang: data.id_lang ?? null,
      lang_iso: data.lang_iso ?? null,
      lang_name: data.lang_name ?? null,
      assistant_id: data.assistant_id || null,
      chatbot_id: data.chatbot_id || null,
      openai_enabled: data.assistant_enabled ?? null,
      customer_logged: hello_customer_logged,
      customer_id: hello_customer_id,
      customer_email: hello_customer_email,
      customer_firstname: hello_customer_firstname,
      customer_lastname: hello_customer_lastname,
      orders_count: hello_orders_count,
      orders_amount: hello_orders_amount,
      country_code,
      city,
      postcode,
      last_seen: new Date().toISOString(),
    };
    // Infer action on first hello
    if (data.page_url) {
      patch.last_action = "page_view";
      patch.last_action_at = new Date().toISOString();
    }
    // If explicit logout (false), record it but keep identity columns intact
    if (patch.customer_logged === false) {
      if (!patch.last_action) patch.last_action = "logout";
      if (!patch.last_action_at) patch.last_action_at = new Date().toISOString();
    }
    // Preserve existing customer_* data only when update is anonymous (no flag provided)
    try {
      const existing = await getVisitorRow(vid);
      if (
        existing &&
        existing.customer_logged === true &&
        (patch.customer_logged === null || patch.customer_logged === undefined)
      ) {
        patch.customer_id = undefined;
        patch.customer_email = undefined;
        patch.customer_firstname = undefined;
        patch.customer_lastname = undefined;
        patch.orders_count = undefined;
        patch.orders_amount = undefined;
      }
    } catch {}

    if (dbSchema.visitors.hasMeta) {
      await upsertVisitorMeta(vid, patch);
    }
    await upsertVisitorColumns(vid, {
      ip: patch.ip,
      user_agent: patch.user_agent,
      lang: patch.lang,
      time_zone: patch.time_zone,
      origin: patch.origin,
      page_url_last: patch.page_url_last,
      referrer: patch.referrer,
      currency: patch.currency,
      shop_name: patch.shop_name,
      id_shop: patch.id_shop,
      id_lang: patch.id_lang,
      lang_iso: patch.lang_iso,
      lang_name: patch.lang_name,
      customer_logged: patch.customer_logged,
      customer_id: patch.customer_id,
      customer_email: patch.customer_email,
      customer_firstname: patch.customer_firstname,
      customer_lastname: patch.customer_lastname,
      orders_count: patch.orders_count,
      orders_amount: patch.orders_amount,
      country_code,
      city: patch.city,
      postcode: patch.postcode,
      screen: patch.screen,
      assistant_id: patch.assistant_id,
      chatbot_id: patch.chatbot_id,
      openai_enabled: patch.openai_enabled,
      last_action: patch.last_action,
      last_action_at: patch.last_action_at,
    });

    // Optional: record visit for right panel history
    try {
      if (data.page_url) {
        await pool.query(
          `INSERT INTO visits (visitor_id, page_url, title, origin, referrer,
                               utm_source, utm_medium, utm_campaign, utm_term, utm_content)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
           WHERE NOT EXISTS (
             SELECT 1 FROM visits
             WHERE visitor_id=$1 AND page_url=$2 AND occurred_at >= NOW() - interval '2 minutes'
           )`,
          [
            vid,
            data.page_url || null,
            data.title || null,
            data.origin || null,
            data.referrer || null,
            data.utm_source || null,
            data.utm_medium || null,
            data.utm_campaign || null,
            data.utm_term || null,
            data.utm_content || null,
          ]
        );
      }
    } catch (e) {
      logToFile(`⚠️ visits insert failed: ${e.code || ""} ${e.message}`);
    }

    // If a real last_seen column exists, bump it
    if (dbSchema.visitors.hasLastSeen && dbSchema.visitors.idCol) {
      try {
        await pool.query(
          `UPDATE visitors SET last_seen = NOW() WHERE ${dbSchema.visitors.idCol} = $1`,
          [vid]
        );
      } catch {}
    }

    // Notify dashboards so right panel fills instantly
    io.to("agents").emit("visitor_update", { visitorId: vid, ...patch });

    if (DEBUG_SOCKET) logToFile(`👋 Visitor ${vid} joined room`);
  });

  // --- Rich context sent after hello (from your widget)
  socket.on("visitor_context", async (data = {}) => {
    logWidget("🧾 WIDGET visitor_context", data);
    try {
      const vid =
        (typeof data.visitorId === "string" && data.visitorId.trim()) ||
        joinedVisitorId;
      if (!vid) return;

      await ensureVisitorExists(vid);

      const net = clientNetworkInfo(socket);
      geoDebugLog(net.ip);
      let country_code = null;
      let city = null;
      let postcode = null;
      if (net.ip) {
        const g = geoLookup(net.ip);
        country_code = g.country_code;
        city = g.city;
        postcode = g.postcode;
      }

      // Normalize screen shape
      let screen = null;
      if (data.screen && typeof data.screen === "object") {
        const w = data.screen.width ?? data.screen.w ?? null;
        const h = data.screen.height ?? data.screen.h ?? null;
        const d = data.screen.pixelRatio ?? data.screen.dpr ?? null;
        screen = { w, h, dpr: d };
      }

      // Map customer fields (support nested shapes and aliases)
      const custCtx =
        data && typeof data.customer === "object"
          ? data.customer
          : data && typeof data.account === "object"
          ? data.account
          : {};
      const ctx_customer_logged =
        data.customer_logged ?? custCtx.logged ?? custCtx.is_logged ?? null;
      const ctx_customer_id =
        data.customer_id ??
        data.id_customer ??
        custCtx.id ??
        custCtx.customer_id ??
        null;
      const ctx_customer_email = data.customer_email ?? custCtx.email ?? null;
      const ctx_customer_firstname =
        data.customer_firstname ??
        custCtx.firstname ??
        custCtx.first_name ??
        null;
      const ctx_customer_lastname =
        data.customer_lastname ?? custCtx.lastname ?? custCtx.last_name ?? null;
      const ctx_orders_count =
        data.orders_count ?? custCtx.orders_count ?? null;
      const ctx_orders_amount =
        data.orders_amount ?? custCtx.orders_amount ?? null;

      // Build patch mapped to our meta fields
      const patch = {
        ip: net.ip || null,
        user_agent: data.user_agent || net.ua || null,
        lang: data.browser_languages || data.lang || net.lang || null,
        time_zone: data.timezone || data.time_zone || null,
        country_code: data.country_code || country_code || null,
        screen,
        origin:
          (data.first_url
            ? (() => {
                try {
                  return new URL(data.first_url).origin;
                } catch {
                  return null;
                }
              })()
            : null) || null,
        page_url: data.current_url || null,
        page_url_last: data.current_url || null,
        title: data.title || null,
        referrer: data.referrer || data.first_referrer || null,
        currency: data.currency || null,
        shop_name: data.shop_name || null,
        id_shop: data.shop_id ?? null,
        id_lang: data.id_lang ?? null,
        lang_iso: data.shop_lang_iso || data.lang_iso || null,
        lang_name: data.shop_lang_name || data.lang_name || null,
        cart_total: data.cart_total ?? null,
        assistant_id: data.assistant_id || null,
        openai_enabled: data.assistant_enabled ?? null,
        customer_logged: ctx_customer_logged,
        customer_id: ctx_customer_id,
        customer_email: ctx_customer_email,
        customer_firstname: ctx_customer_firstname,
        customer_lastname: ctx_customer_lastname,
        orders_count: ctx_orders_count,
        orders_amount: ctx_orders_amount,
        city: data.city || city || null,
        postcode: data.postcode || data.zip || postcode || null,
        last_seen: new Date().toISOString(),
      };

      // Infer and attach an action marker
      const inferredAction =
        (typeof data.action === "string" && data.action) ||
        (patch.customer_logged === true ? "login" : null) ||
        (patch.customer_logged === false ? "logout" : null) ||
        (typeof data.cart_total === "number" ? "cart_update" : null) ||
        (data.current_url ? "page_view" : null);
      if (inferredAction) {
        patch.last_action = inferredAction;
        patch.last_action_at = new Date().toISOString();
      }

      // Preserve existing customer_* data if this update is anonymous
      try {
        const existing = await getVisitorRow(vid);
        if (
          existing &&
          existing.customer_logged === true &&
          patch.customer_logged !== true
        ) {
          patch.customer_logged = undefined;
          patch.customer_id = undefined;
          patch.customer_email = undefined;
          patch.customer_firstname = undefined;
          patch.customer_lastname = undefined;
          patch.orders_count = undefined;
          patch.orders_amount = undefined;
        }
      } catch {}

      if (dbSchema.visitors.hasMeta) {
        await upsertVisitorMeta(vid, patch);
      }
      await upsertVisitorColumns(vid, {
        ip: patch.ip,
        user_agent: patch.user_agent,
        lang: patch.lang,
        time_zone: patch.time_zone,
        origin: patch.origin,
        page_url_last: patch.page_url_last,
        referrer: patch.referrer,
        currency: patch.currency,
        shop_name: patch.shop_name,
        id_shop: patch.id_shop,
        id_lang: patch.id_lang,
        lang_iso: patch.lang_iso,
        lang_name: patch.lang_name,
        cart_total: patch.cart_total,
        assistant_id: patch.assistant_id,
        openai_enabled: patch.openai_enabled,
        customer_logged: patch.customer_logged,
        customer_id: patch.customer_id,
        customer_email: patch.customer_email,
        customer_firstname: patch.customer_firstname,
        customer_lastname: patch.customer_lastname,
        orders_count: patch.orders_count,
        orders_amount: patch.orders_amount,
        country_code: patch.country_code,
        city: patch.city,
        postcode: patch.postcode,
        screen: patch.screen,
        last_action: patch.last_action,
        last_action_at: patch.last_action_at,
      });

      // If a dedicated last_seen column exists, bump it
      if (dbSchema.visitors.hasLastSeen && dbSchema.visitors.idCol) {
        try {
          await pool.query(
            `UPDATE visitors SET last_seen = NOW() WHERE ${dbSchema.visitors.idCol} = $1`,
            [vid]
          );
        } catch {}
      }

      // Optional: record a visit for the right panel
      try {
        if (data.current_url) {
          await pool.query(
            `INSERT INTO visits (visitor_id, page_url, title, origin, referrer,
                                 utm_source, utm_medium, utm_campaign, utm_term, utm_content)
             SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
             WHERE NOT EXISTS (
               SELECT 1 FROM visits
               WHERE visitor_id=$1 AND page_url=$2 AND occurred_at >= NOW() - interval '2 minutes'
             )`,
            [
              vid,
              data.current_url || null,
              data.title || null,
              patch.origin,
              patch.referrer,
              data.utm_source || null,
              data.utm_medium || null,
              data.utm_campaign || null,
              data.utm_term || null,
              data.utm_content || null,
            ]
          );
        }
      } catch (e) {
        logToFile(
          `⚠️ visits insert (context) failed: ${e.code || ""} ${e.message}`
        );
      }

      // Notify dashboards so the right panel updates instantly
      io.to("agents").emit("visitor_update", { visitorId: vid, ...patch });
    } catch (e) {
      logToFile(`❌ visitor_context error: ${e.message}`);
    }
  });

  // --- Agent joins dashboard room
  socket.on("agent_hello", () => {
    socket.join("agents");
    logToFile(`👨‍💻 Agent ${socket.id} joined room agents`);
  });

  // --- Visitor opens the chat UI (fires every open)
  socket.on("chat_opened", async (data = {}) => {
    try {
      const vid = (typeof data.visitorId === 'string' && data.visitorId.trim()) || joinedVisitorId;
      if (!vid) return;
      if (joinedVisitorId !== vid) {
        joinedVisitorId = vid;
        socket.join(vid);
      }
      await ensureVisitorExists(vid);
      // Mark last action for dashboards
      const nowIso = new Date().toISOString();
      await upsertVisitorColumns(vid, { last_action: 'chat_opened', last_action_at: nowIso });
      io.to("agents").emit("visitor_update", { visitorId: vid, last_action: 'chat_opened', last_action_at: nowIso });
      logToFile(`🟨 chat_opened from visitor ${vid}`);
    } catch (e) {
      logToFile(`⚠️ chat_opened handler error: ${e.message}`);
    }
  });

  // --- First-time chat start (one-time per browser via localStorage)
  socket.on("chat_started", async (data = {}) => {
    try {
      const vid = (typeof data.visitorId === 'string' && data.visitorId.trim()) || joinedVisitorId;
      if (!vid) return;
      if (joinedVisitorId !== vid) {
        joinedVisitorId = vid;
        socket.join(vid);
      }
      await ensureVisitorExists(vid);

      // If no messages yet, proactively greet to start the conversation
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS c FROM messages WHERE visitor_id = $1`,
        [vid]
      );
      const msgCount = (countRes.rows[0] && countRes.rows[0].c) || 0;
      if (msgCount === 0) {
        // Lookup welcome message based on (shop_name, lang_iso)
        let welcomeText = null;
        let langIso = null;
        try {
          const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id') || 'visitor_id';
          const r = await pool.query(
            `SELECT v.shop_name, v.lang_iso, wm.content, wm.enabled
             FROM visitors v
             LEFT JOIN welcome_message wm
               ON wm.shop_name = v.shop_name AND wm.lang_iso = v.lang_iso
             WHERE v.${idCol} = $1
             LIMIT 1`,
            [vid]
          );
          if (r.rowCount) {
            const row = r.rows[0];
            langIso = row.lang_iso || null;
            if (row && row.enabled && row.content && String(row.content).trim()) {
              welcomeText = String(row.content).trim().slice(0, 2000);
            }
          }
        } catch {}

        if (!welcomeText) {
          const isFr = /^fr/i.test(String(langIso || ''));
          welcomeText = isFr
            ? "Bonjour ! Comment pouvons-nous vous aider ?"
            : "Hello! How can we help you today?";
        }

        const greetId =
          globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        try {
          // Insert greeting as agent message
          const cols = [];
          const params = [];
          const ph = [];
          let onConflict = "";
          if (dbSchema.useDbDedup) {
            cols.push("id");
            params.push(greetId);
            ph.push(`$${params.length}`);
            onConflict = " ON CONFLICT (id) DO NOTHING";
          }
          if (dbSchema.messages.hasVisitorId) {
            cols.push("visitor_id");
            params.push(vid);
            ph.push(`$${params.length}`);
          }
          cols.push("sender");
          params.push("agent");
          ph.push(`$${params.length}`);
          const msgCol = dbSchema.messages.hasContent ? 'content' : (dbSchema.messages.hasMessage ? 'message' : 'content');
          cols.push(msgCol);
          params.push(welcomeText);
          ph.push(`$${params.length}`);
          if (dbSchema.messages.hasAgentId) {
            cols.push("agent_id");
            params.push(null);
            ph.push(`$${params.length}`);
          }
          const sql = `INSERT INTO messages (${cols.join(', ')}) VALUES (${ph.join(', ')})${onConflict} RETURNING id, created_at`;
          await pool.query(sql, params);

          // Update conversation status + notify agents
          const nowIso = new Date().toISOString();
          await upsertVisitorColumns(vid, {
            last_action: 'agent_message',
            last_action_at: nowIso,
            conversation_status: 'waiting_visitor',
          });
          io.to("agents").emit("visitor_update", {
            visitorId: vid,
            conversation_status: 'waiting_visitor',
            last_action: 'agent_message',
            last_action_at: nowIso,
          });

          // Emit greeting to visitor and mirror to dashboards
          const greetingOutgoing = {
            id: greetId,
            visitorId: vid,
            from: 'agent',
            message: welcomeText,
            html: textToSafeHTML(welcomeText),
            agentId: null,
            timestamp: Date.now(),
          };
          io.to(vid).emit("chat_message", greetingOutgoing);
          io.to("agents").emit("dashboard_message", greetingOutgoing);
          if (DEBUG_CHAT) {
            logJson("→ chat_message (greeting chat_started)", greetingOutgoing);
            logJson("→ dashboard_message (greeting chat_started)", greetingOutgoing);
          }
        } catch (e) {
          logToFile(`⚠️ auto-greeting (chat_started) failed for ${vid}: ${e.message}`);
        }
      }

      if (DEBUG_CHAT) logToFile(`🟩 chat_started from visitor ${vid}`);
    } catch (e) {
      logToFile(`⚠️ chat_started handler error: ${e.message}`);
    }
  });

  // --- Handle chat messages
  socket.on("chat_message", async (data = {}) => {
    if (DEBUG_CHAT) {
      logJson("💬 chat_message (in)", {
        from: data?.from,
        visitorId: data?.visitorId,
        len: (data?.message || "").length,
      });
    }
    if (data && data.from === "visitor") {
      logWidget("🧾 WIDGET chat_message", {
        id: data.id,
        visitorId: data.visitorId,
        message: typeof data.message === "string" ? data.message : "",
        timestamp: data.timestamp || Date.now(),
      });
    }
    // Normalisation
    const sender = data.from === "agent" ? "agent" : "visitor";
    const visitorId =
      typeof data.visitorId === "string" ? data.visitorId.trim() : "";
    if (!visitorId) return;

    // S'assurer que la room est join en cas de course au 1er message
    if (joinedVisitorId !== visitorId) {
      joinedVisitorId = visitorId;
      socket.join(visitorId);
    }

    await ensureVisitorExists(visitorId);

    // Accept multiple payload shapes from various widgets
    let raw = "";
    if (typeof data.message === "string") raw = data.message;
    else if (typeof data.content === "string") raw = data.content;
    else if (typeof data.text === "string") raw = data.text;
    else if (typeof data.body === "string") raw = data.body;
    const content = raw.trim().substring(0, 2000);
    if (!content) return;
    // Log: message received from visitor
    try {
      if (sender === 'visitor') {
        const sample = content.length > 160 ? content.slice(0, 160) + '…' : content;
        logToFile(`chat: message received from visitor visitorId=${visitorId} len=${content.length} text="${sample.replace(/\s+/g,' ').replace(/"/g,'\\"')}"`);
      }
    } catch {}

    // client-supplied id (UUID) used for routing and optional dedup
    const clientId =
      (typeof data.id === "string" && data.id) ||
      (typeof data.client_id === "string" && data.client_id) ||
      (typeof data.message_id === "string" && data.message_id) ||
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // If agent sent HTML (from rich editor), sanitize and keep tags; otherwise autolink plain text
    const looksHtml = /<\s*[a-z][\s\S]*>/i.test(content) || (typeof data.html === 'string' && data.html.trim().length > 0);
    const content_html = looksHtml ? sanitizeAgentHtmlServer((typeof data.html === 'string' && data.html.trim()) || content) : textToSafeHTML(content);
    const agentId = sender === "agent" ? data.agentId ?? null : null;

    // Build INSERT dynamically to match DB schema
    const cols = [];
    const params = [];
    const ph = [];

    // messages.id
    let onConflict = "";
    if (dbSchema.useDbDedup) {
      // DB can dedup by id (TEXT/UUID)
      cols.push("id");
      params.push(clientId);
      ph.push(`$${params.length}`);
      onConflict = " ON CONFLICT (id) DO NOTHING";
    } else {
      // DB id is integer -> optional memory dedup to avoid spamming
      if (MEM_DEDUP_ENABLED && memDedup.has(clientId)) {
        if (DEBUG_SQL) logToFile(`ℹ️  Duplicate (memory) ignored id=${clientId}`);
        return;
      }
    }

    // visitor_id
    if (dbSchema.messages.hasVisitorId) {
      cols.push("visitor_id");
      params.push(visitorId);
      ph.push(`$${params.length}`);
    }

    // sender
    cols.push("sender");
    params.push(sender);
    ph.push(`$${params.length}`);

    // content/message (store plain text – strip tags for readability if HTML)
    const msgCol = dbSchema.messages.hasContent
      ? "content"
      : dbSchema.messages.hasMessage
      ? "message"
      : "content"; // default
    const plain = looksHtml ? String(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim() : content;
    cols.push(msgCol);
    params.push(plain);
    ph.push(`$${params.length}`);

    // content_html (optional)
    if (dbSchema.messages.hasContentHtml) {
      cols.push("content_html");
      params.push(content_html);
      ph.push(`$${params.length}`);
    }

    // agent_id (optional)
    if (dbSchema.messages.hasAgentId) {
      cols.push("agent_id");
      params.push(agentId);
      ph.push(`$${params.length}`);
    }

    const sql = `INSERT INTO messages (${cols.join(", ")})
                 VALUES (${ph.join(", ")})${onConflict}
                 RETURNING id, created_at`;
    const tryInsert = async () => {
      if (DEBUG_SQL) logToFile(sql);
      const ins = await pool.query(sql, params);
      if (DEBUG_SQL) {
        if (ins.rowCount) {
          logToFile(`✅ DB INSERT ok id=${clientId} visitor=${visitorId}`);
        } else {
          logToFile(`ℹ️  Duplicate message ignored id=${clientId}`);
        }
      }
      rememberMsg(clientId);
    };
    try {
      await tryInsert();
    } catch (e) {
      const code = String(e.code || '');
      if (code === "23503") {
        try {
          await ensureVisitorExists(visitorId);
          await tryInsert();
        } catch (e2) {
          logToFile(`❌ DB INSERT retry error: ${e2.code || ""} ${e2.message}`);
        }
      } else if (code === '42P10') {
        // No unique constraint for ON CONFLICT; retry without it
        try {
          const sqlNoConflict = `INSERT INTO messages (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING id, created_at`;
          if (DEBUG_SQL) logToFile(sqlNoConflict);
          const ins2 = await pool.query(sqlNoConflict, params);
          if (DEBUG_SQL && ins2.rowCount) logToFile(`✅ DB INSERT (no conflict) ok id=${clientId} visitor=${visitorId}`);
          rememberMsg(clientId);
        } catch (e3) {
          logToFile(`❌ DB INSERT (no conflict) error: ${e3.code || ''} ${e3.message}`);
        }
      } else {
        logToFile(
          `❌ DB INSERT error: ${e.code || ""} ${
            e.message
          }. Columns: [${cols.join(", ")}]`
        );
      }
    }

    // Update conversation status based on who sent the last message
    try {
      const nowIso = new Date().toISOString();
      const fromVisitor = sender === 'visitor';
      const status = sender === 'agent' ? 'waiting_visitor' : 'waiting_agent';
      const patchCols = {
        last_action: sender === 'agent' ? 'agent_message' : 'visitor_message',
        last_action_at: nowIso,
        conversation_status: status,
      };
      // If a (known) visitor writes, unarchive the conversation so it comes back to Actives
      if (fromVisitor) patchCols.archived = false;
      await upsertVisitorColumns(visitorId, patchCols);
      const patchEvent = {
        visitorId,
        conversation_status: status,
        last_action: patchCols.last_action,
        last_action_at: nowIso,
      };
      if (fromVisitor) patchEvent.archived = false;
      io.to("agents").emit("visitor_update", patchEvent);
    } catch {}

    // Persist assistant/lang context if provided with the message (some widgets include it here)
    if (sender === "visitor") {
      const payload = (data && data.payload) || {};
      const assistant_id = data.assistant_id || payload.assistant_id || null;
      const openai_enabled =
        data.assistant_enabled ?? payload.assistant_enabled ?? null;
      const id_lang = data.id_lang ?? payload.id_lang ?? null;
      if (assistant_id != null || openai_enabled != null || id_lang != null) {
        try {
          await upsertVisitorColumns(visitorId, {
            assistant_id,
            openai_enabled,
            id_lang,
          });
          if (dbSchema.visitors.hasMeta) {
            await upsertVisitorMeta(visitorId, {
              assistant_id,
              openai_enabled,
              id_lang,
            });
          }
        } catch (e) {
          logToFile(
            `⚠️ persist assistant_id from message failed: ${e.code || ""} ${
              e.message
            }`
          );
        }
      }
    }

    // Objet propre émis sur le réseau (keep clientId for frontend correlation)
    const outgoing = {
      id: clientId,
      visitorId,
      from: sender,
      message: plain,
      html: content_html,
      agentId,
      timestamp: Date.now(),
    };

    // Routage :
    if (sender === "visitor") {
      // ne pas renvoyer au visiteur (UI optimiste)
      io.to("agents").emit("dashboard_message", outgoing);
      if (DEBUG_CHAT) logJson("→ dashboard_message", outgoing);

      // Behaviour: auto_draft / auto_reply per chatbot_config for this visitor
      try {
        const vr = await pool.query(
          `SELECT shop_name, lang_iso FROM visitors WHERE (visitor_id = $1 OR id = $1) LIMIT 1`,
          [visitorId]
        );
        const shop = vr.rows?.[0]?.shop_name || null;
        const lang = vr.rows?.[0]?.lang_iso || null;
        if (shop && lang) {
          const botId = makeBotId(shop, lang);
          const br = await pool.query(`SELECT * FROM chatbot_config WHERE id_bot = $1 LIMIT 1`, [botId]);
          if (br.rowCount) {
            const cfg = br.rows[0];
            if (cfg.openai_api_key && cfg.prompt_id && cfg.bot_behavior) {
              if (cfg.bot_behavior === 'auto_draft') {
                // generate draft and push to agents
                try {
                  const { text } = await respondWithPrompt({
                    apiKey: cfg.openai_api_key,
                    promptId: cfg.prompt_id,
                    promptVersion: cfg.prompt_version || undefined,
                    input: content || payload?.content || payload?.message || '',
                  });
                  if (text) io.to('agents').emit('assistant_draft', { visitorId, draft: text });
                } catch (e) { logToFile(`auto_draft error: ${e.message}`); }
              } else if (cfg.bot_behavior === 'auto_reply') {
                try {
                  // Log: message sent to OpenAI
                  try {
                    const inTxt = String(content || payload?.content || payload?.message || '');
                    const s = inTxt.length > 160 ? inTxt.slice(0,160) + '…' : inTxt;
                    logToFile(`chatbot: message sent to openai bot=${botId} visitor=${visitorId} len=${inTxt.length} text="${s.replace(/\s+/g,' ').replace(/"/g,'\\"')}"`);
                  } catch {}
                  const { text } = await respondWithPrompt({
                    apiKey: cfg.openai_api_key,
                    promptId: cfg.prompt_id,
                    promptVersion: cfg.prompt_version || undefined,
                    input: content || payload?.content || payload?.message || '',
                  });
                  // Log: reply from OpenAI
                  try {
                    const s = String(text || '');
                    const sm = s.length > 160 ? s.slice(0,160) + '…' : s;
                    logToFile(`chatbot: reply from openai bot=${botId} visitor=${visitorId} len=${s.length} text="${sm.replace(/\s+/g,' ').replace(/"/g,'\\"')}"`);
                  } catch {}
                  if (text) {
                    // Insert as agent message (respect DB schema columns)
                    const cols2 = [];
                    const params2 = [];
                    const ph2 = [];
                    if (dbSchema.messages.hasVisitorId) { cols2.push('visitor_id'); params2.push(visitorId); ph2.push(`$${params2.length}`); }
                    cols2.push('sender'); params2.push('agent'); ph2.push(`$${params2.length}`);
                    const msgCol2 = dbSchema.messages.hasContent ? 'content' : (dbSchema.messages.hasMessage ? 'message' : 'content');
                    cols2.push(msgCol2); params2.push(text); ph2.push(`$${params2.length}`);
                    if (dbSchema.messages.hasContentHtml) { cols2.push('content_html'); params2.push(textToSafeHTML(text)); ph2.push(`$${params2.length}`); }
                    if (dbSchema.messages.hasAgentId) { cols2.push('agent_id'); params2.push(null); ph2.push(`$${params2.length}`); }
                    const sql2 = `INSERT INTO messages (${cols2.join(', ')}) VALUES (${ph2.join(', ')}) RETURNING id, created_at`;
                    const ins = await pool.query(sql2, params2);

                    const out2 = {
                      id: ins.rows?.[0]?.id || undefined,
                      visitorId,
                      from: 'agent',
                      message: text,
                      html: textToSafeHTML(text),
                      timestamp: Date.parse(ins.rows?.[0]?.created_at) || Date.now(),
                    };
                    io.to(visitorId).emit('chat_message', out2);
                    io.to('agents').emit('dashboard_message', out2);
                    // Log: message sent to visitor (auto_reply)
                    try { logToFile(`chat: message sent to visitor visitorId=${visitorId} from=agent kind=auto_reply id=${out2.id || ''}`); } catch {}
                  }
                } catch (e) { logToFile(`auto_reply error: ${e.message}`); }
              }
            }
          }
        }
      } catch (e) { logToFile(`behaviour hook error: ${e.message}`); }
    } else {
      io.to(visitorId).emit("chat_message", outgoing);
      io.to("agents").emit("dashboard_message", outgoing);
      if (DEBUG_CHAT) {
        logJson("→ chat_message (to visitor)", outgoing);
        logJson("→ dashboard_message (mirror)", outgoing);
      }
    }

    // Log: message sent to visitor (manual agent or mirrored outgoing)
    try { if (sender !== 'visitor') logToFile(`chat: message sent to visitor visitorId=${visitorId} from=${sender} id=${outgoing.id || ''}`); } catch {}

    // Auto-greeting when a visitor starts a chat (first message)
    try {
      if (sender === "visitor") {
        // Check if this is the first message in this conversation
        const countRes = await pool.query(
          `SELECT COUNT(*)::int AS c FROM messages WHERE visitor_id = $1`,
          [visitorId]
        );
        const msgCount = (countRes.rows[0] && countRes.rows[0].c) || 0;
        if (msgCount === 1) {
          // Find a welcome message for this visitor's shop/lang if configured
          let welcomeText = null;
          let langIso = null;
          try {
            const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id') || 'visitor_id';
            const r = await pool.query(
              `SELECT v.shop_name, v.lang_iso, wm.content, wm.enabled
               FROM visitors v
               LEFT JOIN welcome_message wm
                 ON wm.shop_name = v.shop_name AND wm.lang_iso = v.lang_iso
               WHERE v.${idCol} = $1
               LIMIT 1`,
              [visitorId]
            );
            if (r.rowCount) {
              const row = r.rows[0];
              langIso = row.lang_iso || null;
              if (row && row.enabled && row.content && String(row.content).trim()) {
                welcomeText = String(row.content).trim().slice(0, 2000);
              }
            }
          } catch {}

          if (!welcomeText) {
            const isFr = /^fr/i.test(String(langIso || ''));
            welcomeText = isFr
              ? "Bonjour ! Comment pouvons-nous vous aider ?"
              : "Hello! How can we help you today?";
          }

          // Insert the greeting as an agent message, then emit to visitor and dashboards
          const greetId =
            globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${Math.random().toString(16).slice(2)}`;

          try {
            const cols2 = [];
            const params2 = [];
            const ph2 = [];
            let onConflict2 = "";
            if (dbSchema.useDbDedup) {
              cols2.push("id");
              params2.push(greetId);
              ph2.push(`$${params2.length}`);
              onConflict2 = " ON CONFLICT (id) DO NOTHING";
            }
            if (dbSchema.messages.hasVisitorId) {
              cols2.push("visitor_id");
              params2.push(visitorId);
              ph2.push(`$${params2.length}`);
            }
            cols2.push("sender");
            params2.push("agent");
            ph2.push(`$${params2.length}`);
            const msgCol2 = dbSchema.messages.hasContent
              ? "content"
              : dbSchema.messages.hasMessage
              ? "message"
              : "content";
            cols2.push(msgCol2);
            params2.push(welcomeText);
            ph2.push(`$${params2.length}`);
            if (dbSchema.messages.hasAgentId) {
              cols2.push("agent_id");
              params2.push(null);
              ph2.push(`$${params2.length}`);
            }
            const sql2 = `INSERT INTO messages (${cols2.join(", ")}) VALUES (${ph2.join(", ")})${onConflict2} RETURNING id, created_at`;
            await pool.query(sql2, params2);

            // Update conversation status for the agent message
            try {
              const nowIso2 = new Date().toISOString();
              await upsertVisitorColumns(visitorId, {
                last_action: 'agent_message',
                last_action_at: nowIso2,
                conversation_status: 'waiting_visitor',
              });
              io.to("agents").emit("visitor_update", {
                visitorId,
                conversation_status: 'waiting_visitor',
                last_action: 'agent_message',
                last_action_at: nowIso2,
              });
            } catch {}

            const greetingOutgoing = {
              id: greetId,
              visitorId,
              from: "agent",
              message: welcomeText,
              html: textToSafeHTML(welcomeText),
              agentId: null,
              timestamp: Date.now(),
            };
            io.to(visitorId).emit("chat_message", greetingOutgoing);
            io.to("agents").emit("dashboard_message", greetingOutgoing);
            if (DEBUG_CHAT) {
              logJson("→ chat_message (greeting)", greetingOutgoing);
              logJson("→ dashboard_message (greeting)", greetingOutgoing);
            }
          } catch (e) {
            logToFile(`⚠️ auto-greeting failed for ${visitorId}: ${e.message}`);
          }
        }
      }
    } catch {}
  });

  socket.on("disconnect", () => {
    if (DEBUG_SOCKET) logToFile(`🔴 Socket déconnecté : ${socket.id}`);
  });
});

/* ============================ API TRACE (optional) ======================== */
app.use("/api", (req, _res, next) => {
  if (DEBUG_API) logToFile(`➡️ API HIT ${req.method} ${req.originalUrl}`);
  next();
});

/* ============================ READ APIs for dashboard ===================== */
// List latest conversation per visitor (optionally last N days; days=0 = all time)
app.get("/api/conversations", async (req, res) => {
  try {
    const days = Math.max(0, Number(req.query.days || 30));
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 500)));

    const params = [];
    let where = "";
    if (days > 0) {
      params.push(days);
      where = `WHERE m.created_at >= NOW() - ($1::int || ' days')::interval`;
    }

    // Choose the right message column based on DB schema
    const msgExpr = dbSchema.messages.hasContent
      ? "m.content"
      : dbSchema.messages.hasMessage
      ? "m.message"
      : "m.message"; // fallback

    // Use DISTINCT ON for broader Postgres compatibility
    let sql;
    if (dbSchema.visitors.exists) {
      sql = `
        SELECT * FROM (
          SELECT DISTINCT ON (m.visitor_id)
            m.visitor_id,
            m.sender,
            ${msgExpr} AS content,
            m.created_at,
            m.created_at AS last_seen,
            v.archived,
            v.conversation_status
          FROM messages m
          LEFT JOIN visitors v ON v.${dbSchema.visitors.idCol || 'visitor_id'} = m.visitor_id
          ${where}
          ORDER BY m.visitor_id, m.created_at DESC
        ) AS t
        ORDER BY t.last_seen DESC
        LIMIT ${limit};
      `;
    } else {
      sql = `
        SELECT * FROM (
          SELECT DISTINCT ON (m.visitor_id)
            m.visitor_id,
            m.sender,
            ${msgExpr} AS content,
            m.created_at,
            m.created_at AS last_seen
          FROM messages m
          ${where}
          ORDER BY m.visitor_id, m.created_at DESC
        ) AS t
        ORDER BY t.last_seen DESC
        LIMIT ${limit};
      `;
    }
    const out = await pool.query(sql, params);
    res.json(out.rows || []);
  } catch (e) {
    logToFile(`❌ /api/conversations error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Full message history for one visitor
app.get("/api/conversations/:visitorId/messages", async (req, res) => {
  try {
    const visitorIdParam = String(req.params.visitorId || "").trim();
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));
    if (!visitorIdParam) return res.json([]);

    // Introspect messages table to adapt to actual column names
    let cols = [];
    try {
      const info = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'messages'`
      );
      cols = (info.rows || []).map(r => String(r.column_name || '').toLowerCase());
    } catch {}
    const has = (c) => cols.includes(String(c).toLowerCase());

    const pickCol = (...candidates) => candidates.find((c) => has(c)) || null;
    const cVisitor = pickCol('visitor_id', 'visitorid', 'visitor', 'visitor_uuid');
    const cContent = pickCol('content', 'message');
    const cSender = pickCol('sender');
    const cAgentId = pickCol('agent_id');
    const cCreated = pickCol('created_at', 'createdon', 'created', 'ts', 'timestamp');
    const cHtml = pickCol('content_html');

    if (!cVisitor) return res.json([]); // Cannot filter without a visitor id column
    // Build dynamic SELECT with safe aliases the frontend expects
    const sel = [];
    if (has('id')) sel.push('id');
    sel.push(`${cVisitor} AS visitor_id`);
    if (cSender) sel.push(`${cSender} AS sender`);
    else if (cAgentId) sel.push(`CASE WHEN ${cAgentId} IS NULL THEN 'visitor' ELSE 'agent' END AS sender`);
    else sel.push(`'visitor' AS sender`);
    if (cContent) sel.push(`COALESCE(${cContent}, '') AS content`);
    else sel.push(`'' AS content`);
    if (cAgentId) sel.push(`${cAgentId} AS agent_id`);
    else sel.push(`NULL::int AS agent_id`);
    if (cCreated) sel.push(`${cCreated} AS created_at`);
    else sel.push(`NOW() AS created_at`);
    if (cHtml) sel.push(`COALESCE(${cHtml}, '') AS content_html`);

    const sql = `SELECT ${sel.join(", ")}
                 FROM messages
                 WHERE ${cVisitor} = $1
                 ORDER BY ${cCreated || 'created_at'} ASC
                 LIMIT ${limit}`;
    const out = await pool.query(sql, [visitorIdParam]);
    res.json(out.rows || []);
  } catch (e) {
    logToFile(`❌ /api/conversations/:id/messages error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Recent visitors (optional helper for side panels)
app.get("/api/visitors/recent", async (_req, res) => {
  try {
    const idCol = dbSchema.visitors.idCol || "id";
    // If visitors table is missing, fall back to messages-only distinct list
    let out;
    if (!dbSchema.visitors.exists) {
      const sqlFallback = `
        SELECT visitor_id,
               MIN(created_at) AS first_seen,
               MAX(created_at) AS last_seen
        FROM messages
        GROUP BY visitor_id
        ORDER BY MAX(created_at) DESC
        LIMIT 200;
      `;
      out = await pool.query(sqlFallback);
    } else {
      const sql = `
        SELECT v.${idCol} AS visitor_id,
               MIN(v.created_at) AS first_seen,
               MAX(m.created_at) AS last_seen
        FROM visitors v
        LEFT JOIN messages m ON m.visitor_id = v.${idCol}
        GROUP BY v.${idCol}
        ORDER BY COALESCE(MAX(m.created_at), MIN(v.created_at)) DESC
        LIMIT 200;
      `;
      out = await pool.query(sql);
    }
    res.json(out.rows || []);
  } catch (e) {
    logToFile(`❌ /api/visitors/recent error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Ensure specific route is defined BEFORE the param route (/api/visitors/:visitorId)
// so that "/api/visitors/list" does not get captured as a :visitorId = "list".
app.get("/api/visitors/list", async (_req, res) => {
  try {
    const idCol =
      dbSchema.visitors.idCol ||
      (dbSchema.visitors.hasVisitorIdCol ? "visitor_id" : "id");
    const sql = `
      SELECT
        v.${idCol}               AS visitor_id,
        COALESCE(v.customer_firstname,'') AS customer_firstname,
        COALESCE(v.customer_lastname,'')  AS customer_lastname,
        COALESCE(v.customer_email,'')     AS customer_email,
        COALESCE(v.country_code,'')       AS country_code,
        COALESCE(v.lang_iso,'')           AS lang_iso,
        COALESCE(v.chatbot_id,'')         AS chatbot_id,
        v.last_seen,
        v.page_url_last,
        v.title,
        v.referrer,
        v.origin,
        (SELECT COUNT(*) FROM visits vi WHERE vi.visitor_id = v.${idCol}) AS visits_count,
        (SELECT COUNT(*) FROM messages m WHERE m.visitor_id = v.${idCol}) AS messages_count,
        (SELECT COUNT(*) FROM messages m WHERE m.visitor_id = v.${idCol} AND m.sender = 'agent') AS agent_messages_count
      FROM visitors v
      ORDER BY COALESCE(v.last_seen, v.created_at) DESC
      LIMIT 500`;
    const out = await pool.query(sql);
    res.json(out.rows || []);
  } catch (e) {
    logToFile(`❌ /api/visitors/list error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Minimal visitor info (fills right panel)
app.get("/api/visitors/:visitorId", async (req, res) => {
  try {
    const visitorId = String(req.params.visitorId || "").trim();
    if (!visitorId) return res.status(400).json({ error: "bad_request" });

    const idCol = dbSchema.visitors.idCol || "visitor_id";
    // Read the whole row safely as JSONB so we can use either real columns or meta
    const out = await pool.query(
      `SELECT to_jsonb(v) AS raw FROM visitors v WHERE ${idCol} = $1 LIMIT 1`,
      [visitorId]
    );
    const raw = (out.rows[0] && out.rows[0].raw) || {};
    const meta = raw.meta || {};

    const pick = (k, altK) =>
      raw[k] ?? (altK ? raw[altK] : undefined) ?? meta[k] ?? meta[altK] ?? null;

    const ip = pick("ip");
    let country_code = pick("country_code");
    if (!country_code && ip) {
      try {
        const g = geoip.lookup(ip);
        country_code = (g && g.country) || null;
      } catch {}
    }

    res.json({
      visitor_id: raw.visitor_id || raw.id || visitorId,
      created_at: raw.created_at || raw.first_seen || null,
      country_code,
      ip,
      city: pick("city"),
      postcode: pick("postcode"),
      lang: pick("language", "lang"),
      screen: pick("screen"),
      first_seen: raw.first_seen || raw.created_at || null,
      last_seen: raw.last_seen || meta.last_seen || null,
      last_action: pick("last_action"),
      last_action_at: pick("last_action_at"),
      archived: raw.archived ?? null,
      conversation_status: pick("conversation_status"),
      origin: pick("origin"),
      page_url: pick("page_url_last", "page_url"),
      title: pick("title"),
      referrer: pick("referrer"),
      currency: pick("currency"),
      cart_total: pick("cart_total"),
      shop_name: pick("shop_name"),
      user_agent: pick("user_agent"),
      id_shop: pick("id_shop"),
      id_lang: pick("id_lang"),
      lang_iso: pick("lang_iso"),
      lang_name: pick("lang_name"),
      screen_w: pick("screen_w"),
      screen_h: pick("screen_h"),
      screen_dpr: pick("screen_dpr"),
      openai_enabled: pick("openai_enabled"),
      assistant_id: pick("assistant_id"),
      // Customer/account context
      customer_logged: pick("customer_logged"),
      customer_id: pick("customer_id"),
      customer_email: pick("customer_email"),
      customer_firstname: pick("customer_firstname"),
      customer_lastname: pick("customer_lastname"),
      orders_count: pick("orders_count"),
      orders_amount: pick("orders_amount"),
    });
  } catch (e) {
    logToFile(`❌ /api/visitors/:id error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Visitors list with basic stats (for "Visiteurs" table)
app.get("/api/visitors/list", async (_req, res) => {
  try {
    const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
    const sql = `
      SELECT
        v.${idCol}               AS visitor_id,
        COALESCE(v.customer_firstname,'') AS customer_firstname,
        COALESCE(v.customer_lastname,'')  AS customer_lastname,
        COALESCE(v.customer_email,'')     AS customer_email,
        COALESCE(v.country_code,'')       AS country_code,
        COALESCE(v.lang_iso,'')           AS lang_iso,
        v.last_seen,
        v.page_url_last,
        v.title,
        v.referrer,
        v.origin,
        (SELECT COUNT(*) FROM visits vi WHERE vi.visitor_id = v.${idCol}) AS visits_count,
        (SELECT COUNT(*) FROM messages m WHERE m.visitor_id = v.${idCol}) AS messages_count,
        (SELECT COUNT(*) FROM messages m WHERE m.visitor_id = v.${idCol} AND m.sender = 'agent') AS agent_messages_count
      FROM visitors v
      ORDER BY COALESCE(v.last_seen, v.created_at) DESC
      LIMIT 500`;
    const out = await pool.query(sql);
    res.json(out.rows || []);
  } catch (e) {
    logToFile(`❌ /api/visitors/list error: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Archive/unarchive a visitor conversation
app.post("/api/visitors/:visitorId/archive", async (req, res) => {
  try {
    const visitorId = String(req.params.visitorId || "").trim();
    if (!visitorId) return res.status(400).json({ error: "bad_request" });
    const archived = Boolean(req.body?.archived ?? true);

    await ensureVisitorExists(visitorId);

    const status = archived ? 'archived' : 'open';
    // Tolerant WHERE: match by visitor_id or id to avoid schema drift
    const where = (dbSchema.visitors.hasVisitorIdCol && dbSchema.visitors.hasIdCol)
      ? '(visitor_id = $1 OR id = $1)'
      : (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id = $1' : (dbSchema.visitors.hasIdCol ? 'id = $1' : `${dbSchema.visitors.idCol || 'visitor_id'} = $1`));
    const sql = `UPDATE visitors SET archived = $2, conversation_status = $3 WHERE ${where}`;
    const result = await pool.query(sql, [visitorId, archived, status]);
    if (DEBUG_SQL) logToFile(`ARCHIVE rows=${result.rowCount} vid=${visitorId} -> archived=${archived}, status=${status}`);

    io.to("agents").emit("visitor_update", { visitorId, archived, conversation_status: status });
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "not_found", message: "No visitor matched id in DB" });
    }
    res.json({ ok: true, archived, rows: result.rowCount });
  } catch (e) {
    logToFile(`❌ /api/visitors/:id/archive error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// GET alias for quick testing: /api/visitors/:id/archive?archived=1
app.get("/api/visitors/:visitorId/archive", async (req, res) => {
  try {
    const visitorId = String(req.params.visitorId || "").trim();
    if (!visitorId) return res.status(400).json({ error: "bad_request" });
    const archivedParam = req.query.archived;
    const archived = archivedParam === undefined ? true : /^(1|true|yes)$/i.test(String(archivedParam));

    await ensureVisitorExists(visitorId);

    const status = archived ? 'archived' : 'open';
    const where = (dbSchema.visitors.hasVisitorIdCol && dbSchema.visitors.hasIdCol)
      ? '(visitor_id = $1 OR id = $1)'
      : (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id = $1' : (dbSchema.visitors.hasIdCol ? 'id = $1' : `${dbSchema.visitors.idCol || 'visitor_id'} = $1`));
    const sql = `UPDATE visitors SET archived = $2, conversation_status = $3 WHERE ${where}`;
    const result = await pool.query(sql, [visitorId, archived, status]);
    if (DEBUG_SQL) logToFile(`ARCHIVE(GET) rows=${result.rowCount} vid=${visitorId} -> archived=${archived}, status=${status}`);

    io.to("agents").emit("visitor_update", { visitorId, archived, conversation_status: status });
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, archived, rows: result.rowCount });
  } catch (e) {
    logToFile(`❌ /api/visitors/:id/archive (GET) error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Recent visits for one visitor (stub for UI; replace with real SELECT when you track visits)
app.get("/api/visitors/:visitorId/visits", async (_req, res) => {
  try {
    const visitorId = String(_req.params.visitorId || "").trim();
    if (!visitorId) return res.json([]);
    const limit = Math.max(1, Math.min(200, Number(_req.query.limit || 50)));
    const out = await pool.query(
      `SELECT visitor_id, page_url, title, origin, referrer,
              utm_source, utm_medium, utm_campaign, utm_term, utm_content,
              occurred_at
       FROM visits
       WHERE visitor_id = $1
       ORDER BY occurred_at DESC
       LIMIT ${limit}`,
      [visitorId]
    );
    res.json(out.rows || []);
  } catch (e) {
    logToFile(`❌ /api/visitors/:id/visits error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Upsert customer fields explicitly (use from PrestaShop on login)
app.post("/api/visitors/:visitorId/customer", async (req, res) => {
  try {
    const visitorId = String(req.params.visitorId || "").trim();
    if (!visitorId) return res.status(400).json({ error: "bad_request" });

    await ensureVisitorExists(visitorId);

    const b = req.body || {};
    // Support both flat and nested payloads
    const c = typeof b.customer === "object" && b.customer ? b.customer : b;

    const patch = {
      customer_logged: c.customer_logged ?? c.logged ?? c.is_logged ?? true,
      customer_id: c.customer_id ?? c.id_customer ?? c.id ?? null,
      customer_email: c.customer_email ?? c.email ?? null,
      customer_firstname:
        c.customer_firstname ?? c.firstname ?? c.first_name ?? null,
      customer_lastname:
        c.customer_lastname ?? c.lastname ?? c.last_name ?? null,
      orders_count: c.orders_count ?? null,
      orders_amount: c.orders_amount ?? null,
      last_action: c.last_action || "login",
      last_action_at: new Date().toISOString(),
    };

    if (dbSchema.visitors.hasMeta) {
      await upsertVisitorMeta(visitorId, patch);
    }
    await upsertVisitorColumns(visitorId, patch);

    // If a dedicated last_seen column exists, bump it
    if (dbSchema.visitors.hasLastSeen && dbSchema.visitors.idCol) {
      try {
        await pool.query(
          `UPDATE visitors SET last_seen = NOW() WHERE ${dbSchema.visitors.idCol} = $1`,
          [visitorId]
        );
      } catch {}
    }

    io.to("agents").emit("visitor_update", { visitorId, ...patch });
    res.json({ ok: true });
  } catch (e) {
    logToFile(`❌ POST /api/visitors/:id/customer error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Backfill named columns from existing meta for one visitor
app.post("/api/visitors/:visitorId/backfill_columns", async (req, res) => {
  try {
    const visitorId = String(req.params.visitorId || "").trim();
    if (!visitorId) return res.status(400).json({ error: "bad_request" });

    await ensureVisitorExists(visitorId);

    const idCol =
      dbSchema.visitors.idCol ||
      (dbSchema.visitors.hasVisitorIdCol ? "visitor_id" : "id");
    if (!idCol) return res.status(500).json({ error: "schema_error" });

    const out = await pool.query(
      `SELECT to_jsonb(v) AS raw FROM visitors v WHERE ${idCol} = $1 LIMIT 1`,
      [visitorId]
    );
    if (!out.rowCount) return res.status(404).json({ error: "not_found" });

    const raw = out.rows[0].raw || {};
    const meta = raw.meta || {};
    const nested =
      typeof meta.customer === "object" && meta.customer ? meta.customer : {};

    const pick = (k, ...alts) => {
      const tryKeys = [k, ...alts].filter(Boolean);
      for (const key of tryKeys) {
        if (raw[key] != null) return raw[key];
        if (meta[key] != null) return meta[key];
        if (nested[key] != null) return nested[key];
      }
      return null;
    };

    const values = {
      customer_logged: pick("customer_logged", "logged", "is_logged"),
      customer_id: pick("customer_id", "id_customer", "id", "customer_id"),
      customer_email: pick("customer_email", "email"),
      customer_firstname: pick("customer_firstname", "firstname", "first_name"),
      customer_lastname: pick("customer_lastname", "lastname", "last_name"),
      orders_count: pick("orders_count"),
      orders_amount: pick("orders_amount"),
      last_action: pick("last_action"),
      last_action_at: pick("last_action_at"),
      city: pick("city"),
      postcode: pick("postcode", "zip"),
    };

    await upsertVisitorColumns(visitorId, values);

    io.to("agents").emit("visitor_update", { visitorId, ...values });
    res.json({
      ok: true,
      updated: Object.keys(values).filter((k) => values[k] != null),
    });
  } catch (e) {
    logToFile(`❌ POST /api/visitors/:id/backfill_columns error: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

/* ============================ HEALTH & SPA ================================= */
// Simple health used by the dashboard to show IA badge
app.get("/health", (_req, res) => {
  res.json({ openai_ready: true });
});

// Simple DB health endpoint (fast SELECT 1)
app.get('/__dbcheck', async (_req, res) => {
  try {
    const r = await pool.query('SELECT 1 AS ok');
    return res.json({ ok: true, db: r?.rows?.[0]?.ok === 1 });
  } catch (e) {
    try { logToFile(`[health] dbcheck failed: ${e?.code || ''} ${e?.message || e}`); } catch {}
    return res.status(503).json({ ok: false, error: 'db_unavailable' });
  }
});

app.get("/__health", (_req, res) => {
  res.json({
    distDir,
    indexHtmlExists: fs.existsSync(indexHtml),
    cwd: process.cwd(),
    __dirname,
  });
});

// SPA fallback (exclude static and API routes)
// Exclude: assets, favicon, socket, api, mcp, mcp-dev, oauth2
app.get(/^\/(?!assets\/|favicon\.ico$|socket\/|api\/|mcp\/|mcp-dev\/|oauth2\/).*/, (_req, res) => {
  res.sendFile(indexHtml);
});

// Debug: inject a message (admin only) to verify DB writes
app.post('/api/debug/message', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const b = req.body || {};
    const visitorId = String(b.visitorId || b.visitor_id || '').trim();
    const from = String(b.from || 'visitor').trim() === 'agent' ? 'agent' : 'visitor';
    const msg = String(b.message || b.content || b.text || '').trim();
    if (!visitorId || !msg) return res.status(400).json({ ok: false, error: 'bad_request' });
    io.emit('chat_message', { visitorId, from, message: msg, timestamp: Date.now() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

/* ============================ ADMIN BACKFILL =============================== */
function isLocalhost(req) {
  const ip = (req.ip || req.connection?.remoteAddress || "").replace(
    "::ffff:",
    ""
  );
  return ip === "127.0.0.1" || ip === "::1";
}
function requireAdmin(req, res) {
  const expected = process.env.ADMIN_TOKEN || "";
  if (expected) {
    const got = req.headers["x-admin-token"] || req.query.admin_token;
    if (String(got) !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return false;
    }
    return true;
  }
  // If no token configured, allow only localhost
  if (!isLocalhost(req)) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

async function adminBackfillActions(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const out1 = await pool.query(
      `UPDATE visitors
         SET last_action = 'page_view'
       WHERE last_action IS NULL AND page_url_last IS NOT NULL`
    );
    const out2 = await pool.query(
      `UPDATE visitors
         SET last_action_at = COALESCE(last_action_at, last_seen, created_at, NOW())
       WHERE last_action_at IS NULL AND (last_action IS NOT NULL OR page_url_last IS NOT NULL)`
    );
    res.json({
      ok: true,
      updated_last_action: out1.rowCount || 0,
      updated_last_action_at: out2.rowCount || 0,
    });
  } catch (e) {
    logToFile(`❌ backfill_actions failed: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
}
app.post("/api/admin/backfill_actions", adminBackfillActions);
app.get("/api/admin/backfill_actions", adminBackfillActions);

async function adminBackfillGeo(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const limit = Math.max(
      1,
      Math.min(5000, Number(req.body?.limit || req.query?.limit || 1000))
    );
    const idCol =
      dbSchema.visitors.idCol ||
      (dbSchema.visitors.hasVisitorIdCol ? "visitor_id" : "id") ||
      "visitor_id";
    const rows = await pool.query(
      `SELECT ${idCol} AS vid, ip
         FROM visitors
        WHERE ip IS NOT NULL
          AND (city IS NULL OR postcode IS NULL OR country_code IS NULL)
        LIMIT $1`,
      [limit]
    );
    let updated = 0;
    for (const r of rows.rows) {
      const vid = r.vid;
      const ip = r.ip;
      if (!vid || !ip) continue;
      const g = geoLookup(ip);
      const cc = g.country_code;
      const city = g.city;
      const pc = g.postcode;
      if (cc || city || pc) {
        await upsertVisitorColumns(vid, {
          country_code: cc,
          city,
          postcode: pc,
        });
        updated++;
      }
    }
    res.json({ ok: true, scanned: rows.rowCount || 0, updated });
  } catch (e) {
    logToFile(`❌ backfill_geo failed: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
}
app.post("/api/admin/backfill_geo", adminBackfillGeo);
app.get("/api/admin/backfill_geo", adminBackfillGeo);

// Simple debug endpoint to test geolocation for a given IP
app.get('/api/debug/geo', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const ip = String(req.query.ip || '').trim();
  if (!ip) return res.status(400).json({ error: 'bad_request', message: 'ip required' });
  const g = geoLookup(ip);
  // Also include raw provider outputs for transparency
  let lite = null; let mm = null;
  try { const r = geoip.lookup(ip); if (r) lite = { country: r.country||null, city: r.city||null, zip: r.zip || r.postalCode || null }; } catch {}
  try { if (mmReader) { const r = mmReader.city(ip); mm = { country: r?.country?.isoCode || null, city: r?.city?.names?.fr || r?.city?.names?.en || r?.city?.name || null, postal: r?.postal?.code || null }; } } catch {}
  res.json({ ip, result: g, lite, maxmind: mm });
});

/* ============================ ADMIN LOGS ================================ */
// Fetch current logging status
app.get('/api/admin/logs/status', async (req, res) => {
  // No auth required: read-only status for convenience during development
  try {
    let exists = false; let sizeBytes = 0; let mtime = null;
    try {
      const st = fs.statSync(logFile);
      exists = true; sizeBytes = st.size; mtime = st.mtimeMs;
    } catch {}
    res.json({ ok: true, enabled: LOG_ENABLED, stdout: LOG_STDOUT, file: logFile, exists, sizeBytes, mtime });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Get the last N lines of the log file
app.get('/api/admin/logs', async (req, res) => {
  // No auth required: read-only tail for convenience during development
  try {
    const maxLines = Math.max(1, Math.min(5000, Number(req.query.lines || 500)));
    let content = '';
    try { content = fs.readFileSync(logFile, 'utf8'); } catch {}
    const lines = content.split(/\r?\n/);
    const tail = lines.slice(-maxLines).join('\n');
    let sizeBytes = 0; let mtime = null; let exists = false;
    try { const st = fs.statSync(logFile); sizeBytes = st.size; mtime = st.mtimeMs; exists = true; } catch {}
    res.json({ ok: true, content: tail, lines: maxLines, exists, sizeBytes, mtime });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Enable/disable file logging at runtime
app.post('/api/admin/logs/enable', async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    const enabled = !!(req.body && (req.body.enabled === true || req.body.enabled === 'true' || req.body.enabled === 1 || req.body.enabled === '1'));
    LOG_ENABLED = enabled;
    logToFile(`⚙️ Logging ${enabled ? 'ENABLED' : 'DISABLED'} by admin`);
    res.json({ ok: true, enabled: LOG_ENABLED });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Toggle stdout echoing
app.post('/api/admin/logs/stdout', async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    const stdout = !!(req.body && (req.body.stdout === true || req.body.stdout === 'true' || req.body.stdout === 1 || req.body.stdout === '1'));
    LOG_STDOUT = stdout;
    logToFile(`⚙️ LOG_STDOUT set to ${stdout ? 'ON' : 'OFF'} by admin`);
    res.json({ ok: true, stdout: LOG_STDOUT });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Clear the log file contents
app.post('/api/admin/logs/clear', async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    try { fs.writeFileSync(logFile, ''); } catch {}
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

/* ============================ AGENTS API ================================ */
// Agents management (admin only)
app.get('/api/agents', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
  const r = await pool.query(`SELECT id, name, email, is_active, role, last_login, preferred_lang, notifications, theme_color FROM mod_agents_agents ORDER BY id ASC`);
    res.json(r.rows || []);
  } catch (e) {
    logToFile(`❌ GET /api/agents: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/agents', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const b = req.body || {};
    const email = String(b.email || '').trim();
    const name = String(b.name || email || 'Agent').trim();
    const pwd = String(b.password || '').trim();
    if (!email || !pwd) return res.status(400).json({ error: 'bad_request', message: 'email and password required' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
    if (pwd.length < 8) return res.status(400).json({ error: 'weak_password' });
    const hash = await bcrypt.hash(pwd, 10);
    const role = (String(b.role || 'agent').toLowerCase() === 'admin') ? 'admin' : 'agent';
    const isActive = b.is_active == null ? true : Boolean(b.is_active);
    try {
      const r = await pool.query(
        `INSERT INTO mod_agents_agents (name, email, password, role, is_active, preferred_lang, notifications, theme_color, theme_color2)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name, email, is_active, role, last_login, preferred_lang, notifications, theme_color, theme_color2`,
        [name, email, hash, role, isActive, b.preferred_lang || null, b.notifications || null, b.theme_color || null, b.theme_color2 || null]
      );
      return res.status(201).json(r.rows[0]);
    } catch (e) {
      if (String(e.code) === '23505') {
        // unique violation
        return res.status(409).json({ error: 'email_exists' });
      }
      throw e;
    }
  } catch (e) {
    logToFile(`❌ POST /api/agents: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/api/agents/:id', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_request' });
  const r = await pool.query(`SELECT id, name, email, is_active, role, last_login, preferred_lang, notifications, theme_color, theme_color2 FROM mod_agents_agents WHERE id=$1`, [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    logToFile(`❌ GET /api/agents/:id: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

app.patch('/api/agents/:id', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_request' });
    const b = req.body || {};

    const sets = [];
    const vals = [];
    function push(col, val) {
      sets.push(`${col} = $${sets.length + 1}`);
      vals.push(val);
    }

    if (b.name != null) push('name', String(b.name));
    if (b.email != null) push('email', String(b.email));
    if (b.is_active != null) push('is_active', Boolean(b.is_active));
    if (b.role != null) push('role', String(b.role));
    if (b.preferred_lang != null) push('preferred_lang', String(b.preferred_lang || ''));
    if (b.notifications != null) push('notifications', b.notifications);
    if (b.theme_color != null) push('theme_color', String(b.theme_color || ''));
    if (b.theme_color2 != null) push('theme_color2', String(b.theme_color2 || ''));
    // ip_allowlist removed from product scope

    // Password change
    if (b.password) {
      const pwd = String(b.password || '').trim();
      if (pwd.length < 8) return res.status(400).json({ error: 'weak_password' });
      const hash = await bcrypt.hash(pwd, 10);
      push('password', hash);
    }

    if (sets.length === 0) return res.status(400).json({ error: 'bad_request', message: 'no valid fields' });
    const sql = `UPDATE mod_agents_agents SET ${sets.join(', ') } WHERE id = $${sets.length + 1} RETURNING id, name, email, is_active, role, last_login, preferred_lang, notifications, theme_color, theme_color2`;
    const r = await pool.query(sql, [...vals, id]);
    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    logToFile(`❌ PATCH /api/agents/:id: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/agents/:id', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_request' });
    const r = await pool.query(`DELETE FROM mod_agents_agents WHERE id = $1`, [id]);
    res.json({ ok: true, rows: r.rowCount || 0 });
  } catch (e) {
    logToFile(`❌ DELETE /api/agents/:id: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Auth: login/logout/me + self profile update
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const pwd = String(req.body?.password || '').trim();
    if (!email || !pwd) return res.status(400).json({ error: 'bad_request' });
    const r = await pool.query(`SELECT id, name, email, password, is_active, role, preferred_lang, notifications FROM mod_agents_agents WHERE lower(email) = $1 LIMIT 1`, [email]);
    if (!r.rowCount) return res.status(401).json({ error: 'invalid_credentials' });
    const a = r.rows[0];
    if (a.is_active === false) return res.status(403).json({ error: 'inactive' });
    const ok = await bcrypt.compare(pwd, a.password || '');
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = signToken({ id: a.id, email: a.email, role: a.role || 'agent' });
    setAuthCookie(res, token);
    res.json({ id: a.id, name: a.name, email: a.email, role: a.role, preferred_lang: a.preferred_lang, notifications: a.notifications, theme_color: a.theme_color || null, theme_color2: a.theme_color2 || null });
  } catch (e) {
    logToFile(`❌ POST /api/auth/login: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/auth/logout', async (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const u = authFromRequest(req);
    if (!u) return res.status(401).json({ error: 'unauthorized' });
    const r = await pool.query(`SELECT id, name, email, is_active, role, preferred_lang, notifications, theme_color, theme_color2, last_login FROM mod_agents_agents WHERE id = $1`, [u.id]);
    if (!r.rowCount) return res.status(401).json({ error: 'unauthorized' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'server_error' });
  }
});

app.patch('/api/me', async (req, res) => {
  try {
    const u = requireAuth(req, res); if (!u) return;
    const b = req.body || {};
    const sets = [];
    const vals = [];
    function push(col, val) { sets.push(`${col} = $${sets.length + 1}`); vals.push(val); }
    if (b.name != null) push('name', String(b.name));
    if (b.email != null) push('email', String(b.email));
    if (b.preferred_lang != null) push('preferred_lang', String(b.preferred_lang || ''));
    if (b.notifications != null) push('notifications', b.notifications);
    if (b.theme_color != null) push('theme_color', String(b.theme_color || ''));
    if (b.theme_color2 != null) push('theme_color2', String(b.theme_color2 || ''));
    if (b.password) {
      const current = String(b.current_password || '');
      const nr = await pool.query(`SELECT password FROM mod_agents_agents WHERE id = $1`, [u.id]);
      const ok = await bcrypt.compare(current, nr.rows?.[0]?.password || '');
      if (!ok) return res.status(400).json({ error: 'bad_current_password' });
      const hash = await bcrypt.hash(String(b.password), 10);
      push('password', hash);
    }
    if (!sets.length) return res.status(400).json({ error: 'bad_request' });
    const sql = `UPDATE mod_agents_agents SET ${sets.join(', ')} WHERE id = $${sets.length + 1} RETURNING id, name, email, is_active, role, preferred_lang, notifications, theme_color, theme_color2`;
    const r = await pool.query(sql, [...vals, u.id]);
    res.json(r.rows[0]);
  } catch (e) {
    logToFile(`❌ PATCH /api/me: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ============================ AUTOMATIONS API ============================ */
// MCP Server Integration
app.get("/api/automations/mcp", async (_req, res) => {
  try {
    // Example: Fetch data from MCP server
    const mcpData = await fetchMCPData();
    res.json({ success: true, data: mcpData });
  } catch (e) {
    logToFile(`❌ MCP server error: ${e.message}`);
    res.status(500).json({ error: "mcp_server_error" });
  }
});

// List automatic messages
app.get("/api/automations/messages", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, title, url_match, locale, trigger_type, enabled, triggered_count, conversations_count, created_at, updated_at
       FROM auto_messages ORDER BY id DESC`
    );
    res.json(r.rows || []);
  } catch (e) {
    logToFile(`❌ /api/automations/messages: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Create a new automatic message
app.post("/api/automations/messages", async (req, res) => {
  try {
    const { title, url_match = null, locale = null, trigger_type = null, enabled = false } = req.body || {};
    if (!title || !`${title}`.trim()) return res.status(400).json({ error: "bad_request", message: "title required" });
    const r = await pool.query(
      `INSERT INTO auto_messages (title, url_match, locale, trigger_type, enabled)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, url_match, locale, trigger_type, enabled, triggered_count, conversations_count, created_at, updated_at`,
      [String(title).trim(), url_match, locale, trigger_type, Boolean(enabled)]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    logToFile(`❌ POST /api/automations/messages: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Update fields (partial)
app.patch("/api/automations/messages/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_request" });
    const allowed = ["title", "url_match", "locale", "trigger_type", "enabled", "triggered_count", "conversations_count"];
    const entries = Object.entries(req.body || {}).filter(([k, _]) => allowed.includes(k));
    if (!entries.length) return res.status(400).json({ error: "bad_request", message: "no valid fields" });
    const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
    const values = entries.map(([, v]) => v);
    sets.push(`updated_at = NOW()`);
    const sql = `UPDATE auto_messages SET ${sets.join(", ")} WHERE id = $${values.length + 1} RETURNING *`;
    const r = await pool.query(sql, [...values, id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "not_found" });
    res.json(r.rows[0]);
  } catch (e) {
    logToFile(`❌ PATCH /api/automations/messages/:id: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Delete
app.delete("/api/automations/messages/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_request" });
    const r = await pool.query(`DELETE FROM auto_messages WHERE id = $1`, [id]);
    res.json({ ok: true, rows: r.rowCount });
  } catch (e) {
    logToFile(`❌ DELETE /api/automations/messages/:id: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// -------- Welcome messages (per shop_name + lang_iso) --------
function makeWelcomeId(shop, lang) {
  const s = String(shop || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  const l = String(lang || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  return `${s}_${l}`;
}

function makeBotId(shop, lang) {
  return `bot_${makeWelcomeId(shop, lang)}`;
}

// List (computed from visitors, with join to welcome_message)
app.get("/api/automations/welcome", async (_req, res) => {
  try {
    const v = await pool.query(
      `SELECT DISTINCT shop_name, lang_iso
       FROM visitors
       WHERE shop_name IS NOT NULL AND shop_name <> ''
         AND lang_iso IS NOT NULL AND lang_iso <> ''`
    );
    const existing = await pool.query(`SELECT * FROM welcome_message`);
    const byId = new Map((existing.rows || []).map((r) => [String(r.id_message), r]));
    const out = [];
    for (const row of v.rows || []) {
      const shop = row.shop_name;
      const lang = row.lang_iso;
      const id = makeWelcomeId(shop, lang);
      const name = `${shop} / ${lang}`;
      const rec = byId.get(id) || null;
      out.push({
        id_message: id,
        name,
        shop_name: shop,
        lang_iso: lang,
        enabled: rec ? !!rec.enabled : false,
        title: rec?.title || null,
        content: rec?.content || null,
        exists: !!rec,
      });
    }
    // Sort by shop then lang for stable UI
    out.sort((a, b) => (a.shop_name || '').localeCompare(b.shop_name || '') || (a.lang_iso || '').localeCompare(b.lang_iso || ''));
    res.json(out);
  } catch (e) {
    logToFile(`❌ GET /api/automations/welcome: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Ensure records exist for all current distinct (shop_name, lang_iso)
app.post("/api/automations/welcome/sync", async (_req, res) => {
  try {
    const v = await pool.query(
      `SELECT DISTINCT shop_name, lang_iso
       FROM visitors
       WHERE shop_name IS NOT NULL AND shop_name <> ''
         AND lang_iso IS NOT NULL AND lang_iso <> ''`
    );
    let created = 0;
    for (const row of v.rows || []) {
      const id = makeWelcomeId(row.shop_name, row.lang_iso);
      const r = await pool.query(
        `INSERT INTO welcome_message (id_message, shop_name, lang_iso, title, content, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id_message) DO NOTHING`,
        [id, row.shop_name, row.lang_iso, 'Bienvenue', null, false]
      );
      created += r.rowCount || 0;
    }
    res.json({ ok: true, created });
  } catch (e) {
    logToFile(`❌ POST /api/automations/welcome/sync: ${e.message}`);
    res.status(500).json({ error: "server_error" });
  }
});

// Update a welcome message by id_message
app.patch("/api/automations/welcome/:id", async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const allowed = ["title", "content", "enabled"];
    const entries = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
    if (!entries.length) return res.status(400).json({ error: 'bad_request', message: 'no valid fields' });
    const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
    const values = entries.map(([, v]) => v);
    sets.push(`updated_at = NOW()`);
    const sql = `UPDATE welcome_message SET ${sets.join(', ')} WHERE id_message = $${values.length + 1} RETURNING *`;
    const r = await pool.query(sql, [...values, id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) {
    logToFile(`❌ PATCH /api/automations/welcome/:id: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Create or upsert a welcome message row
app.post("/api/automations/welcome", async (req, res) => {
  try {
    const b = req.body || {};
    const shop = String(b.shop_name || '').trim();
    const lang = String(b.lang_iso || '').trim();
    const id = String(b.id_message || '').trim() || makeWelcomeId(shop, lang);
    if (!shop || !lang || !id) return res.status(400).json({ error: 'bad_request' });
    const title = b.title ?? null;
    const content = b.content ?? null;
    const enabled = Boolean(b.enabled);
    const r = await pool.query(
      `INSERT INTO welcome_message (id_message, shop_name, lang_iso, title, content, enabled)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id_message) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, enabled = EXCLUDED.enabled, updated_at = NOW()
       RETURNING *`,
      [id, shop, lang, title, content, enabled]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    logToFile(`❌ POST /api/automations/welcome: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ============================ CHATBOTS (Assistants) ====================== */
function openaiForConfig(cfgRow) {
  // Enforce per-bot key from DB only (no env fallback)
  const key = cfgRow?.openai_api_key;
  if (!key) return null;
  try {
    return new OpenAI({
      apiKey: key,
      organization: cfgRow?.openai_org || undefined,
      project: cfgRow?.openai_project || undefined,
      baseURL: cfgRow?.openai_base_url || undefined,
    });
  } catch {
    return null;
  }
}

// List (computed from visitors, with join to chatbot_config)
app.get("/api/automations/chatbots", async (_req, res) => {
  try {
    const v = await pool.query(
      `SELECT DISTINCT shop_name, lang_iso
       FROM visitors
       WHERE shop_name IS NOT NULL AND shop_name <> ''
         AND lang_iso IS NOT NULL AND lang_iso <> ''`
    );
    const existing = await pool.query(`SELECT * FROM chatbot_config`);
    const byId = new Map((existing.rows || []).map((r) => [String(r.id_bot), r]));
    const out = [];
    for (const row of v.rows || []) {
      const shop = row.shop_name;
      const lang = row.lang_iso;
      const id = makeBotId(shop, lang);
      const name = `${shop} / ${lang}`;
      const rec = byId.get(id) || null;
      out.push({
        id_bot: id,
        name,
        shop_name: shop,
        lang_iso: lang,
        enabled: rec ? !!rec.enabled : false,
        has_api_key: !!rec?.openai_api_key,
        // Minimal config for the admin UI
        openai_api_key: rec?.openai_api_key || null,
        prompt_id: rec?.prompt_id || null,
        prompt_version: rec?.prompt_version || null,
        bot_behavior: rec?.bot_behavior || 'manual',
        mcp_enabled: rec?.mcp_enabled ?? null,
        mcp_tools: rec?.mcp_tools || null,
        web_search_enabled: rec?.web_search_enabled ?? null,
        exists: !!rec,
      });
    }
    // Also include rows that exist only in chatbot_config (e.g., no visitors yet)
    const present = new Set(out.map(r => r.id_bot));
    for (const rec of existing.rows || []) {
      const id = String(rec.id_bot);
      if (!id || present.has(id)) continue;
      const shop = rec.shop_name || '';
      const lang = rec.lang_iso || '';
      const name = shop && lang ? `${shop} / ${lang}` : id;
      out.push({
        id_bot: id,
        name,
        shop_name: shop || null,
        lang_iso: lang || null,
        enabled: !!rec.enabled,
        has_api_key: !!rec.openai_api_key,
        openai_api_key: rec.openai_api_key || null,
        prompt_id: rec.prompt_id || null,
        prompt_version: rec.prompt_version || null,
        bot_behavior: rec.bot_behavior || 'manual',
        mcp_enabled: rec.mcp_enabled ?? null,
        mcp_tools: rec.mcp_tools || null,
        web_search_enabled: rec.web_search_enabled ?? null,
        exists: true,
      });
    }
    // sort by shop/lang
    out.sort((a, b) => (a.shop_name || '').localeCompare(b.shop_name || '') || (a.lang_iso || '').localeCompare(b.lang_iso || ''));
    res.json(out);
  } catch (e) {
    logToFile(`❌ GET /api/automations/chatbots: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Ensure records exist for all current distinct (shop_name, lang_iso)
app.post("/api/automations/chatbots/sync", async (_req, res) => {
  try {
    const v = await pool.query(
      `SELECT DISTINCT shop_name, lang_iso
       FROM visitors
       WHERE shop_name IS NOT NULL AND shop_name <> ''
         AND lang_iso IS NOT NULL AND lang_iso <> ''`
    );
    let created = 0;
    for (const row of v.rows || []) {
      const id = makeBotId(row.shop_name, row.lang_iso);
      const r = await pool.query(
        `INSERT INTO chatbot_config (id_bot, shop_name, lang_iso, assistant_id, enabled)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id_bot) DO NOTHING`,
        [id, row.shop_name, row.lang_iso, null, false]
      );
      created += r.rowCount || 0;
    }
    res.json({ ok: true, created });
  } catch (e) {
    logToFile(`❌ POST /api/automations/chatbots/sync: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Create or upsert a chatbot config
app.post("/api/automations/chatbots", async (req, res) => {
  try {
    const b = req.body || {};
    const shop = String(b.shop_name || '').trim();
    const lang = String(b.lang_iso || '').trim();
    const id = String(b.id_bot || '').trim() || makeBotId(shop, lang);
    if (!shop || !lang || !id) return res.status(400).json({ error: 'bad_request' });
    const assistant_id = b.assistant_id ?? null;
    const enabled = Boolean(b.enabled);
    const name = b.name ?? null;
    const instructions = b.instructions ?? null;
    const model = b.model ?? null;
    const temperature = b.temperature ?? null;
    const top_p = b.top_p ?? null;
    const response_format = b.response_format ?? null;
    const tools_code_interpreter = b.tools_code_interpreter ?? null;
    const tools_file_search = b.tools_file_search ?? null;
    const openai_api_key = b.openai_api_key ?? null;
    const openai_org = b.openai_org ?? null;
    const openai_project = b.openai_project ?? null;
    const openai_base_url = b.openai_base_url ?? null;
    const prompt_id = b.prompt_id ?? null;
    const prompt_version = b.prompt_version ?? null;
    const mcp_enabled = b.mcp_enabled === true;
    const mcp_tools = Array.isArray(b.mcp_tools) && b.mcp_tools.length ? b.mcp_tools : null;
    const r = await pool.query(
      `INSERT INTO chatbot_config (id_bot, shop_name, lang_iso, enabled, name, openai_api_key, prompt_id, prompt_version, bot_behavior, mcp_enabled, mcp_tools)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id_bot) DO UPDATE SET enabled = EXCLUDED.enabled, name = EXCLUDED.name, openai_api_key = COALESCE(EXCLUDED.openai_api_key, chatbot_config.openai_api_key), prompt_id = EXCLUDED.prompt_id, prompt_version = EXCLUDED.prompt_version, bot_behavior = COALESCE(EXCLUDED.bot_behavior, chatbot_config.bot_behavior), mcp_enabled = COALESCE(EXCLUDED.mcp_enabled, chatbot_config.mcp_enabled), mcp_tools = EXCLUDED.mcp_tools, updated_at = NOW()
        RETURNING *`,
      [id, shop, lang, enabled, name, openai_api_key, prompt_id, prompt_version, b.bot_behavior || null, mcp_enabled, mcp_tools]
    );
    const row = r.rows[0];
    res.status(201).json(row);
  } catch (e) {
    logToFile(`❌ POST /api/automations/chatbots: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Update fields (assistant_id, enabled)
app.patch("/api/automations/chatbots/:id", async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const allowed = ["enabled", "name", "openai_api_key", "prompt_id", "prompt_version", "bot_behavior", "mcp_enabled", "mcp_tools", "web_search_enabled"];
    const entries = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
    if (!entries.length) return res.status(400).json({ error: 'bad_request', message: 'no valid fields' });
    const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
    const values = entries.map(([, v]) => v);
    sets.push(`updated_at = NOW()`);
    const sql = `UPDATE chatbot_config SET ${sets.join(', ')} WHERE id_bot = $${values.length + 1} RETURNING *`;
    let r;
    try {
      r = await pool.query(sql, [...values, id]);
    } catch (e) {
      // If a column is missing (e.g., web_search_enabled), attempt to auto-migrate and retry once
      if (String(e?.code) === '42703' /* undefined_column */) {
        try {
          await ensureTables();
          r = await pool.query(sql, [...values, id]);
        } catch (e2) {
          throw e2;
        }
      } else {
        throw e;
      }
    }
    if (r.rowCount === 0) {
      // Fallback upsert: create minimal row when missing
      let shop = null, lang = null;
      try {
        const m = /^bot_(.+)_([a-z]{2})$/i.exec(id);
        if (m) { shop = m[1].replace(/_/g, ' '); lang = m[2].toLowerCase(); }
      } catch {}
      if (!shop || !lang) {
        // Try to discover from visitors (best-effort)
        try {
          const vr = await pool.query(`SELECT DISTINCT shop_name, lang_iso FROM visitors WHERE shop_name IS NOT NULL AND shop_name<>'' AND lang_iso IS NOT NULL AND lang_iso<>'' LIMIT 1`);
          if (vr.rowCount) { shop = shop || vr.rows[0].shop_name; lang = lang || vr.rows[0].lang_iso; }
        } catch {}
      }
      if (shop && lang) {
        const enabled = req.body?.enabled === true;
        const name = req.body?.name || null;
        const openai_api_key = req.body?.openai_api_key || null;
        const prompt_id = req.body?.prompt_id || null;
        const prompt_version = req.body?.prompt_version || null;
        const bot_behavior = req.body?.bot_behavior || null;
        const mcp_enabled = req.body?.mcp_enabled === true;
        const mcp_tools = Array.isArray(req.body?.mcp_tools) && req.body.mcp_tools.length ? req.body.mcp_tools : null;
        const ins = await pool.query(
          `INSERT INTO chatbot_config (id_bot, shop_name, lang_iso, enabled, name, openai_api_key, prompt_id, prompt_version, bot_behavior, mcp_enabled, mcp_tools, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
           ON CONFLICT (id_bot) DO NOTHING
           RETURNING *`,
          [id, shop, lang, enabled, name, openai_api_key, prompt_id, prompt_version, bot_behavior, mcp_enabled, mcp_tools]
        );
        if (ins.rowCount) {
          r = ins; // Treat as the new row
        }
      }
      if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    }
    const row = r.rows[0];
    // Try to apply config to OpenAI assistant if available
    try {
      const openai = openaiForConfig(row);
      if (openai && row.assistant_id) {
        const tools = [];
        if (row.tools_code_interpreter) tools.push({ type: 'code_interpreter' });
        if (row.tools_file_search) tools.push({ type: 'file_search' });
        const respFormat = row.response_format === 'json_object' ? { type: 'json_object' } : 'text';
        await openai.beta.assistants.update(row.assistant_id, {
          model: row.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
          instructions: row.instructions || undefined,
          tools: tools.length ? tools : undefined,
          response_format: respFormat,
        });
      }
    } catch (e) {
      logToFile(`⚠️ OpenAI assistant update failed: ${e.message}`);
    }
    res.json(row);
  } catch (e) {
    logToFile(`❌ PATCH /api/automations/chatbots/:id: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST alias for environments that block PATCH at the proxy layer.
// Semantics: same as the PATCH route above (update fields; create minimal row if missing).
app.post("/api/automations/chatbots/:id/save", async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const allowed = ["enabled", "name", "openai_api_key", "prompt_id", "prompt_version", "bot_behavior", "mcp_enabled", "mcp_tools", "web_search_enabled"];
    const entries = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
    if (!entries.length) return res.status(400).json({ error: 'bad_request', message: 'no valid fields' });
    const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
    const values = entries.map(([, v]) => v);
    sets.push(`updated_at = NOW()`);
    const sql = `UPDATE chatbot_config SET ${sets.join(', ')} WHERE id_bot = $${values.length + 1} RETURNING *`;
    let r;
    try {
      r = await pool.query(sql, [...values, id]);
    } catch (e) {
      // If a column is missing (e.g., web_search_enabled), attempt to auto-migrate and retry once
      if (String(e?.code) === '42703' /* undefined_column */) {
        try {
          await ensureTables();
          r = await pool.query(sql, [...values, id]);
        } catch (e2) {
          throw e2;
        }
      } else {
        throw e;
      }
    }
    if (r.rowCount === 0) {
      // Fallback upsert (same as in PATCH)
      let shop = null, lang = null;
      try { const m = /^bot_(.+)_([a-z]{2})$/i.exec(id); if (m) { shop = m[1].replace(/_/g, ' '); lang = m[2].toLowerCase(); } } catch {}
      if (!shop || !lang) {
        try { const vr = await pool.query(`SELECT DISTINCT shop_name, lang_iso FROM visitors WHERE shop_name IS NOT NULL AND shop_name<>'' AND lang_iso IS NOT NULL AND lang_iso<>'' LIMIT 1`); if (vr.rowCount) { shop = shop || vr.rows[0].shop_name; lang = lang || vr.rows[0].lang_iso; } } catch {}
      }
      if (shop && lang) {
        const enabled = req.body?.enabled === true;
        const name = req.body?.name || null;
        const openai_api_key = req.body?.openai_api_key || null;
        const prompt_id = req.body?.prompt_id || null;
        const prompt_version = req.body?.prompt_version || null;
        const bot_behavior = req.body?.bot_behavior || null;
        const ins = await pool.query(
          `INSERT INTO chatbot_config (id_bot, shop_name, lang_iso, enabled, name, openai_api_key, prompt_id, prompt_version, bot_behavior, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (id_bot) DO NOTHING
           RETURNING *`,
          [id, shop, lang, enabled, name, openai_api_key, prompt_id, prompt_version, bot_behavior]
        );
        if (ins.rowCount) r = ins;
      }
      if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    }
    const row = r.rows[0];
    res.json(row);
  } catch (e) {
    logToFile(`❌ POST /api/automations/chatbots/:id/save: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Alias: some proxies block certain paths; provide "/update" as a stable alternative
app.post("/api/automations/chatbots/:id/update", async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const allowed = ["enabled", "name", "openai_api_key", "prompt_id", "prompt_version", "bot_behavior", "mcp_enabled", "mcp_tools", "web_search_enabled"];
    const entries = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
    if (!entries.length) return res.status(400).json({ error: 'bad_request', message: 'no valid fields' });
    const sets = entries.map(([k], i) => `${k} = $${i + 1}`);
    const values = entries.map(([, v]) => v);
    sets.push(`updated_at = NOW()`);
    const sql = `UPDATE chatbot_config SET ${sets.join(', ')} WHERE id_bot = $${values.length + 1} RETURNING *`;
    let r = await pool.query(sql, [...values, id]);
    if (r.rowCount === 0) {
      // Create minimal row if missing (same logic as /save)
      let shop = null, lang = null;
      try { const m = /^bot_(.+)_([a-z]{2})$/i.exec(id); if (m) { shop = m[1].replace(/_/g, ' '); lang = m[2].toLowerCase(); } } catch {}
      if (!shop || !lang) {
        try { const vr = await pool.query(`SELECT DISTINCT shop_name, lang_iso FROM visitors WHERE shop_name IS NOT NULL AND shop_name<>'' AND lang_iso IS NOT NULL AND lang_iso<>'' LIMIT 1`); if (vr.rowCount) { shop = shop || vr.rows[0].shop_name; lang = lang || vr.rows[0].lang_iso; } } catch {}
      }
      if (shop && lang) {
        const enabled = req.body?.enabled === true;
        const name = req.body?.name || null;
        const openai_api_key = req.body?.openai_api_key || null;
        const prompt_id = req.body?.prompt_id || null;
        const prompt_version = req.body?.prompt_version || null;
        const bot_behavior = req.body?.bot_behavior || null;
        const mcp_enabled = req.body?.mcp_enabled === true;
        const mcp_tools = Array.isArray(req.body?.mcp_tools) && req.body.mcp_tools.length ? req.body.mcp_tools : null;
        const ins = await pool.query(
          `INSERT INTO chatbot_config (id_bot, shop_name, lang_iso, enabled, name, openai_api_key, prompt_id, prompt_version, bot_behavior, mcp_enabled, mcp_tools, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
           ON CONFLICT (id_bot) DO NOTHING
           RETURNING *`,
          [id, shop, lang, enabled, name, openai_api_key, prompt_id, prompt_version, bot_behavior, mcp_enabled, mcp_tools]
        );
        if (ins.rowCount) r = ins;
      }
      if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    }
    res.json(r.rows[0]);
  } catch (e) {
    logToFile(`❌ POST /api/automations/chatbots/:id/update: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Upload and attach a file to the assistant (by URL or base64 content)
app.post("/api/automations/chatbots/:id/files", async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const r0 = await pool.query(`SELECT * FROM chatbot_config WHERE id_bot = $1`, [id]);
    if (!r0.rowCount) return res.status(404).json({ error: 'not_found' });
    const cfgRow = r0.rows[0];
    const openai = openaiForConfig(cfgRow);
    if (!openai) return res.status(400).json({ error: 'openai_disabled' });

    // Prefer Responses API + Vector Store flow.
    // Ensure a vector store exists for this bot.
    let vectorStoreId = cfgRow.vector_store_id || null;
    try {
      if (!vectorStoreId) {
        const vs = await openai.vectorStores.create({ name: `kb_${id}` });
        vectorStoreId = vs?.id || null;
        if (vectorStoreId) {
          await pool.query(
            `UPDATE chatbot_config SET vector_store_id = $1, updated_at = NOW() WHERE id_bot = $2`,
            [vectorStoreId, id]
          );
        }
      }
    } catch (e) {
      logToFile(`⚠️ vector store create failed: ${e.message}`);
    }
    if (!vectorStoreId) return res.status(500).json({ error: 'no_vector_store' });

    const { file_url, filename, content_b64, items } = req.body || {};
    const uploads = [];

    const ensureDir = () => { try { fs.mkdirSync(path.join(__dirname, 'tmp_uploads'), { recursive: true }); } catch {} };
    ensureDir();

    const uploadOne = async (payload) => {
      let name = String(payload.filename || '').trim() || 'attachment.txt';
      let dataBuf = null;
      if (payload.content_b64) {
        try { dataBuf = Buffer.from(String(payload.content_b64), 'base64'); } catch {}
      } else if (payload.file_url) {
        const resp = await fetch(String(payload.file_url));
        if (!resp.ok) throw new Error(`download_failed_${resp.status}`);
        const ab = await resp.arrayBuffer();
        dataBuf = Buffer.from(ab);
        if (!payload.filename) {
          try { const u = new URL(String(payload.file_url)); const base = u.pathname.split('/').pop(); if (base) name = base; } catch {}
        }
      }
      if (!dataBuf || !dataBuf.length) throw new Error('no_content');
      const tmpPath = path.join(__dirname, 'tmp_uploads', `${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
      await fs.promises.writeFile(tmpPath, dataBuf);
      const stream = fs.createReadStream(tmpPath);
      // Upload file then attach to vector store
      const up = await openai.files.create({ file: stream, purpose: 'assistants' });
      const fileId = up?.id;
      if (!fileId) throw new Error('upload_failed');
      await openai.vectorStores.files.create(vectorStoreId, { file_id: fileId });
      await pool.query(
        `UPDATE chatbot_config SET file_ids = COALESCE(file_ids, '{}'::text[]) || $1::text, updated_at = NOW() WHERE id_bot = $2`,
        [fileId, id]
      );
      uploads.push({ filename: name, file_id: fileId, vector_store_id: vectorStoreId });
    };

    if (Array.isArray(items) && items.length) {
      for (const it of items) {
        try { await uploadOne(it || {}); } catch (e) { uploads.push({ error: String(e?.message || e) }); }
      }
    } else {
      try { await uploadOne({ file_url, filename, content_b64 }); } catch (e) { return res.status(400).json({ error: 'upload_failed', message: String(e?.message || e) }); }
    }

    res.status(201).json({ ok: true, uploads, vector_store_id: vectorStoreId });
  } catch (e) {
    logToFile(`❌ POST /api/automations/chatbots/:id/files: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Inspect remote OpenAI assistant vs local config (debug helper)
app.get("/api/automations/chatbots/:id/inspect", async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const r0 = await pool.query(`SELECT * FROM chatbot_config WHERE id_bot = $1`, [id]);
    if (!r0.rowCount) return res.status(404).json({ error: 'not_found' });
    const row = r0.rows[0];
    const openai = openaiForConfig(row);
    if (!openai || !row.assistant_id) {
      return res.json({
        has_openai: !!openai,
        assistant_id: row.assistant_id || null,
        local: {
          name: row.name || null,
          model: row.model || null,
          instructions_len: (row.instructions || '').length,
          tools: {
            code_interpreter: !!row.tools_code_interpreter,
            file_search: !!row.tools_file_search,
          },
        },
        remote: null,
      });
    }
    // Assistant (legacy) details if present
    let asst = null; let remoteTools = [];
    try {
      asst = await openai.beta.assistants.retrieve(row.assistant_id);
      remoteTools = Array.isArray(asst.tools) ? asst.tools.map((t) => t?.type) : [];
    } catch {}
    // Vector store info (Responses API)
    let vsFiles = [];
    if (row.vector_store_id) {
      try {
        const list = await openai.vectorStores.files.list(row.vector_store_id, { limit: 100 });
        vsFiles = (list?.data || []).map((f) => ({ id: f.id, status: f.status }));
      } catch {}
    }
    return res.json({
      has_openai: true,
      assistant_id: row.assistant_id,
      local: {
        name: row.name || null,
        model: row.model || null,
        instructions_len: (row.instructions || '').length,
        instructions_preview: (row.instructions || '').slice(0, 200),
        tools: {
          code_interpreter: !!row.tools_code_interpreter,
          file_search: !!row.tools_file_search,
        },
      },
      remote: {
        name: asst?.name || null,
        model: asst?.model || null,
        instructions_len: ((asst && asst.instructions) || '').length,
        instructions_preview: ((asst && asst.instructions) || '').slice(0, 200),
        tools: remoteTools,
        vector_store_id: row.vector_store_id || null,
        vector_store_files: vsFiles,
      },
      match: {
        model: (row.model || '') === ((asst && asst.model) || ''),
        has_code_interpreter: remoteTools.includes('code_interpreter') === !!row.tools_code_interpreter,
        has_file_search: remoteTools.includes('file_search') === !!row.tools_file_search,
        instructions_same_len: ((row.instructions || '').length) === ((((asst && asst.instructions) || '').length)),
      }
    });
  } catch (e) {
    logToFile(`❌ GET /api/automations/chatbots/:id/inspect: ${e.message}`);
    res.status(500).json({ error: 'server_error' });
  }
});

// Force-push local config (name, instructions, tools, model) to the OpenAI assistant
app.post("/api/automations/chatbots/:id/push", async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const r0 = await pool.query(`SELECT * FROM chatbot_config WHERE id_bot = $1`, [id]);
    if (!r0.rowCount) return res.status(404).json({ error: 'not_found' });
    const row = r0.rows[0];
    const openai = openaiForConfig(row);
    if (!openai || !row.assistant_id) return res.status(400).json({ error: 'openai_disabled_or_no_assistant' });
    const tools = [];
    if (row.tools_code_interpreter) tools.push({ type: 'code_interpreter' });
    if (row.tools_file_search) tools.push({ type: 'file_search' });
    const respFormat = row.response_format === 'json_object' ? { type: 'json_object' } : 'text';
    const asst = await openai.beta.assistants.update(row.assistant_id, {
      model: row.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      name: row.name || undefined,
      instructions: row.instructions || undefined,
      tools: tools.length ? tools : undefined,
      response_format: respFormat,
    });
    res.json({ ok: true, assistant_id: asst.id, model: asst.model, tools: asst.tools });
  } catch (e) {
    logToFile(`❌ POST /api/automations/chatbots/:id/push: ${e.message}`);
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// Generate a reply using the Responses API (no Assistants object required)
app.post("/api/automations/chatbots/:id/respond", async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const r0 = await pool.query(`SELECT * FROM chatbot_config WHERE id_bot = $1`, [id]);
    if (!r0.rowCount) return res.status(404).json({ error: 'not_found' });
    const row = r0.rows[0];
    if (!row.openai_api_key) {
      return res.status(400).json({ error: 'bad_request', message: 'openai_api_key missing in chatbot_config' });
    }
    const b = req.body || {};
    const userInput = b.input ?? b.message ?? '';
    if (!`${userInput}`.trim()) return res.status(400).json({ error: 'bad_request', message: 'input required' });
    const fnTools = MCP.toFunctionTools(Array.isArray(row.mcp_tools) ? row.mcp_tools : null);
    async function botNeedsAuth(botId) {
      if (getMcpToken()) return true;
      try {
        const r = await pool.query(`SELECT 1 FROM chatbot_config WHERE id_bot=$1 AND COALESCE(mcp_token,'') <> '' LIMIT 1`, [botId]);
        return !!r.rowCount;
      } catch { return false; }
    }
    const needAuth = await botNeedsAuth(id);
    const session = { authed: !needAuth };
    let result;
    if (fnTools && fnTools.length) {
      result = await respondWithPromptAndTools({
        apiKey: row.openai_api_key,
        model: row.model,
        promptId: row.prompt_id,
        promptVersion: row.prompt_version,
        input: `${userInput}`,
        instructions: row.instructions,
        responseFormat: row.response_format,
        temperature: row.temperature,
        topP: row.top_p,
        organization: row.openai_org || undefined,
        project: row.openai_project || undefined,
        functionTools: fnTools,
        onToolCall: async ({ name, arguments: args }) => {
          const ctx = { shop_name: row.shop_name, lang_iso: row.lang_iso, id_bot: id, session };
          return await MCP.run(name, args, ctx);
        },
      });
    } else {
      result = await respondWithPrompt({
        apiKey: row.openai_api_key,
        model: row.model,
        promptId: row.prompt_id,
        promptVersion: row.prompt_version,
        input: `${userInput}`,
        instructions: row.instructions,
        toolsFileSearch: !!row.tools_file_search,
        toolsCodeInterpreter: !!row.tools_code_interpreter,
        vectorStoreId: row.vector_store_id,
        responseFormat: row.response_format,
        temperature: row.temperature,
        topP: row.top_p,
        organization: row.openai_org || undefined,
        project: row.openai_project || undefined,
      });
    }
    res.json({ ok: true, text: result.text, raw: result.raw });
  } catch (e) {
    logToFile(`❌ POST /api/automations/chatbots/:id/respond: ${e.message}`);
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// Generic test endpoint allowing per-call overrides (for admin/testing only)
app.post("/api/responses/test", async (req, res) => {
  try {
    const b = req.body || {};
    const apiKey = b.apiKey || b.openai_api_key;
    const promptId = b.promptId || b.prompt_id;
    const promptVersion = b.promptVersion || b.prompt_version;
    const msg = (b.message || b.content || b.input || "").trim();
    if (!apiKey) return res.status(400).json({ error: 'bad_request', message: 'apiKey required' });
    if (!promptId) return res.status(400).json({ error: 'bad_request', message: 'promptId required' });
    if (!msg) return res.status(400).json({ error: 'bad_request', message: 'message/content required' });

    const { text, raw } = await respondWithPrompt({
      apiKey,
      promptId,
      promptVersion,
      input: msg,
    });
    res.json({ ok: true, text, raw });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// Simple API health endpoint for frontend checks
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, openai_ready: true });
});

/* ============================ MCP (Model Context Protocol) =============== */
// Minimal MCP status/info endpoint to expose server availability and URLs.
// This is not a full MCP implementation, but provides the information panel
// requested by the admin UI and a stable place to expand later.
app.get('/mcp/status', (req, res) => {
  try {
    // Prefer stored public base when configured; else infer from request
    let httpBase = (getMcpPublicBase() || '').trim();
    let wsUrl = '';
    if (httpBase) {
      try {
        const u = new URL(httpBase);
        const wsScheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsScheme}//${u.host}/mcp/ws`;
        httpBase = `${u.protocol}//${u.host}`;
      } catch {
        httpBase = '';
      }
    }
    if (!httpBase) {
      const fproto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
      const fhost = String(req.headers['x-forwarded-host'] || '').split(',')[0]?.trim();
      const proto = (fproto || req.protocol || 'http').toLowerCase();
      const host = (fhost || req.headers.host || 'localhost').trim();
      httpBase = `${proto}://${host}`;
      const wsScheme = proto === 'https' ? 'wss' : 'ws';
      wsUrl = `${wsScheme}://${host}/mcp/ws`;
    }
    const now = new Date().toISOString();
    res.json({
      ok: true,
      version: '0.1',
      time: now,
      httpBase,
      wsUrl,
      notes: 'MCP status online. This server exposes /mcp/status and can be extended to full MCP JSON-RPC over WebSocket.',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'mcp_status_failed', message: e?.message || String(e) });
  }
});

// --- MCP WebSocket endpoint implementing a minimal JSON-RPC interface ---
// Accept common subprotocols used by MCP clients (e.g., 'mcp', 'jsonrpc')
const wssMcp = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols /* Set<string> */, _req) => {
    try {
      if (protocols && protocols.size) {
        const offered = Array.from(protocols);
        // Prefer any variant of vnd.mcp+json (optionally with parameters)
        for (const p of offered) { if (/^vnd\.mcp\+json\b/i.test(p)) return p; }
        // Common alternates seen in some clients
        for (const p of offered) { if (/^model[-]context[-]?protocol\b/i.test(p)) return p; }
        if (protocols.has('mcp')) return 'mcp';
        if (protocols.has('jsonrpc')) return 'jsonrpc';
        // Fallback to the first offered protocol to keep the connection
        return offered[0];
      }
    } catch {}
    return false; // no subprotocol
  },
});

// Auth helper for HTTP endpoints under /mcp (except /mcp/status)
function checkBearer(h = "") {
  const m = /^Bearer\s+(.+)$/i.exec(String(h || ""));
  return m ? m[1] : null;
}
async function isMcpAuthorized(req) {
  const q = req.query?.mcp_token || req.query?.token;
  const b = checkBearer(req.headers?.authorization);
  const t = String(q || b || "").trim();
  const g = getMcpToken();

  // Global token present → require match everywhere
  if (g) return t === g;

  // Per-bot behavior: if bot_id is present, require token only when that bot has one
  const botId = String(req.query?.bot_id || req.body?.bot_id || '').trim();
  if (botId) {
    try {
      const r = await pool.query(`SELECT mcp_token FROM chatbot_config WHERE id_bot=$1 LIMIT 1`, [botId]);
      const btok = r.rowCount ? String(r.rows[0].mcp_token || '') : '';
      if (!btok) return true; // open for this bot
      return !!t && t === btok;
    } catch { return false; }
  }

  // No bot_id: if any bot has a token, require a token that matches any bot; else open
  try {
    const any = await pool.query(`SELECT 1 FROM chatbot_config WHERE COALESCE(mcp_token,'') <> '' LIMIT 1`);
    if (!any.rowCount) return true;
    if (!t) return false;
    const r = await pool.query(`SELECT 1 FROM chatbot_config WHERE COALESCE(mcp_token,'') <> '' AND mcp_token=$1 LIMIT 1`, [t]);
    return !!r.rowCount;
  } catch { return false; }
}
async function requireMcpAuth(req, res) {
  const ok = await isMcpAuthorized(req);
  if (!ok) { res.status(401).json({ ok: false, error: 'unauthorized' }); return false; }
  return true;
}

// File storage dir for MCP uploads (declared earlier)

function wsSend(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch {}
}
const jsonrpcOk = (id, result) => ({ jsonrpc: '2.0', id, result });
const jsonrpcErr = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, data } });

async function mcp_getVisitor(args = {}) {
  const vid = String(args.visitorId || '').trim();
  if (!vid) throw new Error('visitorId required');
  const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
  const r = await pool.query(`SELECT * FROM visitors WHERE ${idCol} = $1 LIMIT 1`, [vid]);
  return r.rowCount ? r.rows[0] : null;
}
async function mcp_listRecentVisitors(args = {}) {
  const limit = Math.max(1, Math.min(100, Number(args.limit || 20)));
  const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
  const r = await pool.query(
    `SELECT ${idCol} AS visitor_id, shop_name, lang_iso, last_seen, last_action, conversation_status
       FROM visitors
      ORDER BY COALESCE(last_seen, NOW()) DESC
      LIMIT $1`,
    [limit]
  );
  return r.rows || [];
}
async function mcp_sendAgentMessage(args = {}) {
  const visitorId = String(args.visitorId || '').trim();
  const raw = String(args.message || '').trim();
  if (!visitorId) throw new Error('visitorId required');
  if (!raw) throw new Error('message required');

  await ensureVisitorExists(visitorId);
  const looksHtml = /<\s*[a-z][\s\S]*>/i.test(raw);
  const content_html = looksHtml ? sanitizeAgentHtmlServer(raw) : textToSafeHTML(raw);
  const msgCol = dbSchema.messages.hasContent ? 'content' : (dbSchema.messages.hasMessage ? 'message' : 'content');
  const cols = [];
  const params = [];
  const ph = [];
  let onConflict = '';
  const msgId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (dbSchema.useDbDedup) { cols.push('id'); params.push(msgId); ph.push(`$${params.length}`); onConflict = ' ON CONFLICT (id) DO NOTHING'; }
  if (dbSchema.messages.hasVisitorId) { cols.push('visitor_id'); params.push(visitorId); ph.push(`$${params.length}`); }
  cols.push('sender'); params.push('agent'); ph.push(`$${params.length}`);
  cols.push(msgCol); params.push(raw); ph.push(`$${params.length}`);
  if (dbSchema.messages.hasContentHtml) { cols.push('content_html'); params.push(content_html); ph.push(`$${params.length}`); }
  if (dbSchema.messages.hasAgentId) { cols.push('agent_id'); params.push(null); ph.push(`$${params.length}`); }
  const sql = `INSERT INTO messages (${cols.join(', ')}) VALUES (${ph.join(', ')})${onConflict} RETURNING id, created_at`;
  await pool.query(sql, params);

  const out = { id: msgId, visitorId, from: 'agent', message: raw, html: content_html, agentId: null, timestamp: Date.now() };
  io.to(visitorId).emit('chat_message', out);
  io.to('agents').emit('dashboard_message', out);

  try { await upsertVisitorColumns(visitorId, { last_action: 'agent_message', last_action_at: new Date().toISOString(), conversation_status: 'waiting_visitor' }); } catch {}
  return { ok: true, message: out };
}

const MCP_TOOLS = [
  { name: 'get_visitor', description: 'Fetch a visitor by visitorId', inputSchema: { type: 'object', properties: { visitorId: { type: 'string' } }, required: ['visitorId'] }, run: mcp_getVisitor },
  { name: 'list_recent_visitors', description: 'List recent visitors', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } }, run: mcp_listRecentVisitors },
  { name: 'send_agent_message', description: 'Send an agent message to a visitor', inputSchema: { type: 'object', properties: { visitorId: { type: 'string' }, message: { type: 'string' } }, required: ['visitorId','message'] }, run: mcp_sendAgentMessage },
];
function listToolsForClient() {
  try {
    const ts = MCP.tools();
    // Normalize to camelCase (inputSchema) for ChatGPT MCP loader compatibility
    return (ts || []).map(t => {
      const schema = t.inputSchema || t.input_schema || { type: 'object' };
      // Return both camelCase and snake_case to satisfy various MCP clients
      return {
        name: t.name,
        description: t.description,
        inputSchema: schema,
        input_schema: schema,
      };
    });
  } catch { return []; }
}

wssMcp.on('connection', async (ws, req) => {
  // Authorize connection and maintain a per-WS session context
  try {
    const url = new URL(req?.url || '', 'http://local');
    const q = url.searchParams.get('token') || url.searchParams.get('mcp_token');
    // Accept token from Authorization: Bearer <token> or from query
    const auth = String(req.headers?.authorization || '').trim();
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    const presented = String(q || (m ? m[1] : '') || '').trim();
    const botId = String(url.searchParams.get('bot_id') || '').trim();
    if (DEBUG_MCP) {
      logToFile(`🔌 MCP WS connect: path=${url.pathname} bot_id=${botId || '-'} proto_req=${String(req.headers['sec-websocket-protocol']||'').trim()}`);
    }

    let authorized = true;
    const g = getMcpToken();
    if (g) {
      authorized = presented === g;
    } else if (botId) {
      try {
        const r = await pool.query(`SELECT mcp_token FROM chatbot_config WHERE id_bot=$1 LIMIT 1`, [botId]);
        const btok = r.rowCount ? String(r.rows[0].mcp_token || '') : '';
        authorized = btok ? (presented === btok) : true; // open when no bot token
      } catch {
        authorized = false;
      }
    } else {
      try {
        const any = await pool.query(`SELECT 1 FROM chatbot_config WHERE COALESCE(mcp_token,'') <> '' LIMIT 1`);
        if (any.rowCount) {
          if (!presented) authorized = false;
          else {
            const r = await pool.query(`SELECT 1 FROM chatbot_config WHERE COALESCE(mcp_token,'') <> '' AND mcp_token=$1 LIMIT 1`, [presented]);
            authorized = !!r.rowCount;
          }
        }
      } catch {
        authorized = false;
      }
    }

    if (!authorized) { if (DEBUG_MCP) logToFile(`⛔ MCP WS unauthorized bot=${botId || '-'} token=${presented ? 'yes' : 'no'}`); try { ws.close(1008, 'unauthorized'); } catch {} ; return; }
    if (DEBUG_MCP) logToFile(`✅ MCP WS authorized bot=${botId || '-'} subprotocol=${ws.protocol || '-'} session open`);

    // Per-connection session state for tools that need auth
    const session = { authed: !!presented }; // auto-auth when a valid token was presented
    const baseCtx = { id_bot: botId, session };

    ws.on('message', async (buf) => {
      let msg; try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
      const id = msg.id; const method = msg.method; const params = msg.params || {};
      if (DEBUG_MCP) logToFile(`📩 MCP WS msg method=${method}`);
      try {
        if (method === 'initialize') {
          wsSend(ws, jsonrpcOk(id, {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'livechat-mcp', version: '0.1' },
            capabilities: {
              logging: {},
              tools: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
              prompts: { listChanged: true },
            }
          }));
          wsSend(ws, { jsonrpc: '2.0', method: 'initialized', params: {} });
          return;
        }
        if (method === 'tools/list') return wsSend(ws, jsonrpcOk(id, { tools: listToolsForClient() }));
        if (method === 'resources/list') return wsSend(ws, jsonrpcOk(id, { resources: [] }));
        if (method === 'prompts/list') return wsSend(ws, jsonrpcOk(id, { prompts: [] }));
        if (method === 'resources/subscribe') return wsSend(ws, jsonrpcOk(id, { ok: true }));
        if (method === 'resources/unsubscribe') return wsSend(ws, jsonrpcOk(id, { ok: true }));
        if (method === 'resources/templates/list') return wsSend(ws, jsonrpcOk(id, { templates: [] }));
        if (method === 'tools/call') {
          const name = params.name || params.tool || '';
          const args = params.arguments || params.args || {};
          // Allow per-call bot override, but default to connection bot
          const ctx = { ...baseCtx, id_bot: String(args.bot_id || baseCtx.id_bot || '') };
          const result = await MCP.run(name, args, ctx);
          // If tool was 'authenticate', update session from ctx
          if (name === 'authenticate' && ctx?.session) session.authed = !!ctx.session.authed;
          return wsSend(ws, jsonrpcOk(id, { content: [{ type: 'json', json: result }] }));
        }
        if (method === 'ping') return wsSend(ws, jsonrpcOk(id, { pong: true, time: new Date().toISOString() }));
        return wsSend(ws, jsonrpcErr(id, -32601, `Unknown method: ${method}`));
      } catch (e) {
        return wsSend(ws, jsonrpcErr(id, -32000, e?.message || 'server_error'));
      }
    });
  } catch {
    try { ws.close(1011, 'internal_error'); } catch {}
  }
});

// Helper to attach MCP upgrade handling to any HTTP server
function attachMcpUpgrade(srv) {
  srv.on('upgrade', (req, socket, head) => {
    try {
      let url = req.url || '';
      // Support path alias: /mcp/ws/bot/:id[?token=...] -> /mcp/ws?bot_id=:id
      if (url.startsWith('/mcp/ws/bot/')) {
        try {
          const u = new URL(url, 'http://local');
          const parts = u.pathname.split('/');
          const botId = decodeURIComponent(parts.slice(4).join('/'));
          const qs = u.search ? u.search + '&' : '?';
          url = `/mcp/ws${qs}bot_id=${encodeURIComponent(botId)}`;
          req.url = url;
        } catch {}
      }
      if (url.startsWith('/mcp/ws')) {
        wssMcp.handleUpgrade(req, socket, head, (ws) => {
          wssMcp.emit('connection', ws, req);
        });
      }
    } catch {
      try { socket.destroy(); } catch {}
    }
  });
}

// Attach to main Express server (port PORT)
attachMcpUpgrade(server);

// Optional: dedicated MCP WebSocket port via MCP_PORT or MCP_WS_PORT
const MCP_PORT = Number(process.env.MCP_PORT || process.env.MCP_WS_PORT || 0);
let mcpServer = null;
if (Number.isFinite(MCP_PORT) && MCP_PORT > 0) {
  mcpServer = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('MCP WebSocket endpoint is at /mcp/ws');
  });
  attachMcpUpgrade(mcpServer);
  // Avoid crashing the whole app if this port is taken
  mcpServer.on('error', (e) => {
    logToFile(`❌ MCP WS server error on ${MCP_PORT}: ${e?.code || ''} ${e?.message || e}`);
    try { mcpServer.close(); } catch {}
  });
  try {
    mcpServer.listen(MCP_PORT, '0.0.0.0', () => {
      logToFile(`🚀 MCP WS listening on 0.0.0.0:${MCP_PORT}`);
    });
  } catch (e) {
    logToFile(`❌ Failed to bind MCP_PORT ${MCP_PORT}: ${e?.message || e}`);
  }
}

/* ====================== MCP-DEV (Development MCP Server) =================== */
// Separate, OpenAI-compatible MCP server under /mcp-dev with its own token
app.get('/mcp-dev/status', (req, res) => {
  try {
    let httpBase = (getMcpDevPublicBase() || '').trim();
    let wsUrl = '';
    if (httpBase) {
      try {
        const u = new URL(httpBase);
        const wsScheme = u.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsScheme}//${u.host}/mcp-dev/ws`;
        httpBase = `${u.protocol}//${u.host}`;
      } catch { httpBase = ''; }
    }
    if (!httpBase) {
      const fproto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
      const fhost = String(req.headers['x-forwarded-host'] || '').split(',')[0]?.trim();
      const proto = (fproto || req.protocol || 'http').toLowerCase();
      const host = (fhost || req.headers.host || 'localhost').trim();
      httpBase = `${proto}://${host}`;
      const wsScheme = proto === 'https' ? 'wss' : 'ws';
      wsUrl = `${wsScheme}://${host}/mcp-dev/ws`;
    }
    // Optionally include token when caller presents ADMIN token or is localhost
    function isAdminLike(rq) {
      try {
        const expected = process.env.ADMIN_TOKEN || '';
        if (expected) {
          const got = rq.headers['x-admin-token'] || rq.query.admin_token;
          return String(got) === expected;
        }
        // No ADMIN_TOKEN set → allow localhost to view
        return isLocalhost(rq);
      } catch { return false; }
    }
    const maybeToken = isAdminLike(req) ? (getMcpDevToken() || null) : undefined;
    res.json({ ok: true, version: '0.1', httpBase, wsUrl, notes: 'MCP-DEV ready', token: maybeToken });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'mcp_dev_status_failed', message: e?.message || String(e) });
  }
});

// Dev MCP WS server with explicit subprotocol negotiation (helps some clients)
const wssMcpDev = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols /* Set<string> */, _req) => {
    try {
      if (protocols && protocols.size) {
        const offered = Array.from(protocols);
        // Prefer any variant of vnd.mcp+json (optionally with parameters)
        for (const p of offered) { if (/^vnd\.mcp\+json\b/i.test(p)) return p; }
        // Common alternates seen in some clients
        for (const p of offered) { if (/^mcp\.version\./i.test(p)) return p; }
        for (const p of offered) { if (/^model[-]context[-]?protocol\b/i.test(p)) return p; }
        if (protocols.has('mcp')) return 'mcp';
        if (protocols.has('jsonrpc')) return 'jsonrpc';
        // Fallback to the first offered protocol to keep the connection
        return offered[0];
      }
    } catch {}
    return false; // no subprotocol
  },
});
async function isMcpDevAuthorized(req) {
  const q = req.query?.mcp_token || req.query?.token;
  const b = checkBearer(req.headers?.authorization);
  const t = String(q || b || "").trim();
  const g = getMcpDevToken();
  // If dev token is set, require exact match; if empty, open
  if (!g) return true;
  return t === g;
}
async function requireMcpDevAuth(req, res) {
  const ok = await isMcpDevAuthorized(req);
  if (!ok) { res.status(401).json({ ok: false, error: 'unauthorized' }); }
  return ok;
}

// Minimal JSON-RPC over WS mirroring the main MCP server
wssMcpDev.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url || '', 'http://local');
    const headerTok = checkBearer(req.headers?.authorization || '');
    const presented = (headerTok || url.searchParams.get('token') || url.searchParams.get('mcp_token') || '').trim();
    const session = { authed: !getMcpDevToken() || presented === getMcpDevToken() };
    const baseCtx = { id_bot: 'mcp_dev', session };

    ws.on('message', async (buf) => {
      let msg; try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
      const id = msg.id; const method = msg.method; const params = msg.params || {};
      try {
        if (method === 'initialize') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'livechat-mcp-dev', version: '0.1' },
            capabilities: {
              logging: {},
              tools: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
              prompts: { listChanged: true },
            }
          } }));
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));
          return;
        }
        if (method === 'tools/list') {
          const tools = listToolsForClient();
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { tools } }));
          return;
        }
        if (method === 'ping') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { pong: true, time: new Date().toISOString() } }));
          return;
        }
        if (method === 'resources/list') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { resources: [] } }));
          return;
        }
        if (method === 'prompts/list') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { prompts: [] } }));
          return;
        }
        if (method === 'resources/subscribe') { ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } })); return; }
        if (method === 'resources/unsubscribe') { ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } })); return; }
        if (method === 'resources/templates/list') { ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { templates: [] } })); return; }
        if (method === 'tools/call') {
          const name = params.name || params.tool || '';
          const args = params.arguments || params.args || {};
          const ctx = { ...baseCtx };
          const result = await MCP.run(name, args, ctx);
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'json', json: result }] } }));
          return;
        }
        if (method === 'resources/list') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { resources: [] } }));
          return;
        }
        if (method === 'prompts/list') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id, result: { prompts: [] } }));
          return;
        }
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } }));
      } catch (e) {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: e?.message || 'server_error' } }));
      }
    });
  } catch { try { ws.close(1011, 'internal_error'); } catch {} }
});

function attachMcpDevUpgrade(srv) {
  srv.on('upgrade', (req, socket, head) => {
    try {
      const url = req.url || '';
      if (url.startsWith('/mcp-dev/ws')) {
        wssMcpDev.handleUpgrade(req, socket, head, (ws) => {
          wssMcpDev.emit('connection', ws, req);
        });
      }
    } catch { try { socket.destroy(); } catch {} }
  });
}
attachMcpDevUpgrade(server);

// Dev MCP file upload/list/download (stored with bot_id='mcp_dev')
app.post('/mcp-dev/files/base64', async (req, res) => {
  if (!await requireMcpDevAuth(req, res)) return;
  try {
    const b = req.body || {};
    const filename = String(b.filename || '').trim();
    const base64 = String(b.content_base64 || '').trim();
    if (!filename || !base64) return res.status(400).json({ ok: false, error: 'bad_request' });
    const buf = Buffer.from(base64, 'base64');
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const rel = id + '-' + filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const full = path.join(mcpDevUploadDir, rel);
    fs.writeFileSync(full, buf);
    const ct = String(b.content_type || 'application/octet-stream');
    await pool.query(`INSERT INTO mcp_files (id, file_name, file_path, content_type, size_bytes, bot_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, filename, rel, ct, buf.length, 'mcp_dev']);
    res.json({ ok: true, id, file_name: filename, size_bytes: buf.length, content_type: ct });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e.message });
  }
});

// Binary streaming upload (multipart-free); send file body as application/octet-stream
app.post('/mcp-dev/files/upload', async (req, res) => {
  if (!await requireMcpDevAuth(req, res)) return;
  try {
    const filename = String(req.query.filename || '').trim();
    if (!filename) return res.status(400).json({ ok: false, error: 'bad_request', message: 'filename required' });
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const rel = id + '-' + filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const full = path.join(mcpDevUploadDir, rel);
    const ct = String(req.query.content_type || req.headers['content-type'] || 'application/octet-stream');
    let size = 0;
    const ws = fs.createWriteStream(full);
    req.on('data', (chunk) => { try { size += chunk.length; } catch {} });
    req.on('error', () => { try { ws.destroy(); } catch {}; try { fs.unlinkSync(full); } catch {}; });
    ws.on('error', () => { try { fs.unlinkSync(full); } catch {}; });
    ws.on('finish', async () => {
      try {
        await pool.query(`INSERT INTO mcp_files (id, file_name, file_path, content_type, size_bytes, bot_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, filename, rel, ct, size, 'mcp_dev']);
        res.json({ ok: true, id, file_name: filename, size_bytes: size, content_type: ct });
      } catch (e) {
        res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
      }
    });
    req.pipe(ws);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

app.get('/mcp-dev/files', async (req, res) => {
  if (!await requireMcpDevAuth(req, res)) return;
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const r = await pool.query(`SELECT id, file_name, content_type, size_bytes, bot_id, created_at FROM mcp_files WHERE bot_id = 'mcp_dev' ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json({ ok: true, files: r.rows || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e.message });
  }
});

app.get('/mcp-dev/file/:id/download', async (req, res) => {
  if (!await requireMcpDevAuth(req, res)) return;
  try {
    const id = String(req.params.id || '').trim();
    const r = await pool.query(`SELECT * FROM mcp_files WHERE id=$1 AND bot_id='mcp_dev' LIMIT 1`, [id]);
    if (!r.rowCount) return res.status(404).end();
    const row = r.rows[0];
    const full = path.join(mcpDevUploadDir, row.file_path);
    if (!fs.existsSync(full)) return res.status(404).end();
    res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${row.file_name}"`);
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e.message });
  }
});

// Delete a DEV file
app.delete('/mcp-dev/file/:id', async (req, res) => {
  if (!await requireMcpDevAuth(req, res)) return;
  try {
    const id = String(req.params.id || '').trim();
    const r = await pool.query(`SELECT * FROM mcp_files WHERE id=$1 AND bot_id='mcp_dev' LIMIT 1`, [id]);
    if (!r.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
    const row = r.rows[0];
    const full = path.join(mcpDevUploadDir, row.file_path);
    try { if (fs.existsSync(full)) fs.unlinkSync(full); } catch {}
    await pool.query(`DELETE FROM mcp_files WHERE id=$1 AND bot_id='mcp_dev'`, [id]);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// OpenAI Actions-friendly bridge for DEV
app.get('/mcp-dev/actions/tools', async (req, res) => {
  if (!await requireMcpDevAuth(req, res)) return;
  try {
    res.json({ ok: true, tools: listToolsForClient() });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

app.post('/mcp-dev/actions/tools/call', async (req, res) => {
  if (!await requireMcpDevAuth(req, res)) return;
  try {
    const b = req.body || {};
    const name = String(b.name || b.tool || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'bad_request', message: 'name required' });
    let args = b.arguments ?? b.args ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    const result = await MCP.run(name, args, { id_bot: 'mcp_dev', session: { authed: true } });
    res.json({ ok: true, tool: name, bot_id: 'mcp_dev', output: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

app.get('/mcp-dev/actions/openapi.json', (req, res) => {
  try {
    const fproto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
    const fhost = String(req.headers['x-forwarded-host'] || '').split(',')[0]?.trim();
    const proto = (fproto || req.protocol || 'http').toLowerCase();
    const host = (fhost || req.headers.host || 'localhost').trim();
    const base = `${proto}://${host}`;
    const spec = {
      openapi: '3.0.3',
      info: { title: 'MCP DEV Tools', version: '0.1.0' },
      servers: [{ url: base }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, tokenQuery: { type: 'apiKey', in: 'query', name: 'token' } } },
      security: [{ tokenQuery: [] }],
      paths: {
        '/mcp-dev/actions/tools': { get: { summary: 'List tools', responses: { '200': { description: 'ok' } } } },
        '/mcp-dev/actions/tools/call': { post: { summary: 'Call tool', requestBody: { required: true }, responses: { '200': { description: 'ok' } } } }
      }
    };
    res.json(spec);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

/* ====================== MCP SSE (for Inspector) =========================== */
// Minimal SSE transport compatible with @modelcontextprotocol/inspector "SSE".
// Pattern:
//  - Client opens GET /mcp/events (or /mcp-dev/events) as EventSource
//  - Server immediately emits an `endpoint` event whose data is the POST URL
//    to send JSON-RPC messages to (we use /mcp/message?sessionId=...)
//  - Client POSTs JSON-RPC messages to that endpoint; responses are emitted
//    back on the SSE stream as `data: {json}` frames.

// Shared helpers
function sseWriteEvent(res, eventName, data) {
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${data}\n\n`);
  } catch {}
}
function sseWriteJson(res, obj) {
  try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
}
function sseWriteComment(res, text = '') {
  try { res.write(`:${text}\n\n`); } catch {}
}

// In-memory session stores (simple; ok for dev/inspector usage)
const sseSessions = new Map(); // sessionId -> { res, ctx, keepalive }
const sseDevSessions = new Map();

function createSseSession(store, res, ctx, messagePath) {
  const sessionId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  store.set(sessionId, { res, ctx, keepalive: null });
  // Send endpoint for this session (relative/absolute path accepted by client)
  const sep = messagePath.includes('?') ? '&' : '?';
  const endpoint = `${messagePath}${sep}sessionId=${encodeURIComponent(sessionId)}`;
  sseWriteEvent(res, 'endpoint', endpoint);
  // Kick a keepalive every 20s
  const t = setInterval(() => sseWriteComment(res, 'ka'), 20000);
  store.get(sessionId).keepalive = t;
  // Cleanup on close
  res.on('close', () => {
    try { clearInterval(store.get(sessionId)?.keepalive); } catch {}
    store.delete(sessionId);
  });
  return sessionId;
}

// --- DEV SSE endpoints (/mcp-dev)
app.get(['/mcp-dev/events', '/mcp-dev/sse'], async (req, res) => {
  try {
    if (!await requireMcpDevAuth(req, res)) return;
    // Prepare headers for SSE
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Establish a simple authed context (mirrors WS dev behavior)
    const headerTok = checkBearer(req.headers?.authorization || '');
    const qTok = String(req.query?.token || req.query?.mcp_token || '').trim();
    const presented = (headerTok || qTok || '').trim();
    const session = { authed: !getMcpDevToken() || presented === getMcpDevToken() };
    const baseCtx = { id_bot: 'mcp_dev', session };
    // Create session and announce absolute POST endpoint for broad client support
    const fproto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
    const fhost = String(req.headers['x-forwarded-host'] || '').split(',')[0]?.trim();
    const proto = (fproto || req.protocol || 'http').toLowerCase();
    const host = (fhost || req.headers.host || 'localhost').trim();
    const absoluteMessage = `${proto}://${host}/mcp-dev/message`;
    createSseSession(sseDevSessions, res, baseCtx, absoluteMessage);
  } catch (e) {
    try { res.status(500).end(); } catch {}
  }
});

app.post('/mcp-dev/message', async (req, res) => {
  try {
    if (!await requireMcpDevAuth(req, res)) return;
    const sessionId = String(req.query?.sessionId || '').trim();
    const sess = sseDevSessions.get(sessionId);
    if (!sess) { return res.status(404).end('session_not_found'); }
    const msg = req.body || {};
    const outRes = sess.res;
    const id = msg.id; const method = msg.method; const params = msg.params || {};
    try {
      if (method === 'initialize') {
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'livechat-mcp-dev', version: '0.1' },
          capabilities: {
            logging: {},
            tools: { listChanged: true },
            resources: { subscribe: true, listChanged: true },
            prompts: { listChanged: true },
          }
        } });
        sseWriteJson(outRes, { jsonrpc: '2.0', method: 'initialized', params: {} });
        return res.status(204).end();
      }
      if (method === 'tools/list') {
        const tools = listToolsForClient();
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { tools } });
        return res.status(204).end();
      }
      if (method === 'resources/list') {
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { resources: [] } });
        return res.status(204).end();
      }
      if (method === 'prompts/list') {
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { prompts: [] } });
        return res.status(204).end();
      }
      if (method === 'ping') {
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { pong: true, time: new Date().toISOString() } });
        return res.status(204).end();
      }
      if (method === 'resources/subscribe') { sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { ok: true } }); return res.status(204).end(); }
      if (method === 'resources/unsubscribe') { sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { ok: true } }); return res.status(204).end(); }
      if (method === 'resources/templates/list') { sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { templates: [] } }); return res.status(204).end(); }
      if (method === 'tools/call') {
        const name = params.name || params.tool || '';
        const args = params.arguments || params.args || {};
        const ctx = { ...sess.ctx };
        const result = await MCP.run(name, args, ctx);
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { content: [{ type: 'json', json: result }] } });
        return res.status(204).end();
      }
      sseWriteJson(outRes, { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
      return res.status(204).end();
    } catch (e) {
      sseWriteJson(outRes, { jsonrpc: '2.0', id, error: { code: -32000, message: e?.message || 'server_error' } });
      return res.status(204).end();
    }
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e?.message || String(e) });
  }
});

// --- MAIN SSE endpoints (/mcp)
app.get(['/mcp/events', '/mcp/sse'], async (req, res) => {
  try {
    if (!await requireMcpAuth(req, res)) return;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    const headerTok = checkBearer(req.headers?.authorization || '');
    const qTok = String(req.query?.token || req.query?.mcp_token || '').trim();
    const presented = (headerTok || qTok || '').trim();
    const botId = String(req.query?.bot_id || '').trim();
    // Session is considered authed when a valid token was presented per isMcpAuthorized
    const ok = await isMcpAuthorized(req).catch(() => false);
    const session = { authed: !!ok };
    const baseCtx = { id_bot: botId || null, session };
    const fproto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
    const fhost = String(req.headers['x-forwarded-host'] || '').split(',')[0]?.trim();
    const proto = (fproto || req.protocol || 'http').toLowerCase();
    const host = (fhost || req.headers.host || 'localhost').trim();
    const absoluteMessage = `${proto}://${host}/mcp/message`;
    createSseSession(sseSessions, res, baseCtx, absoluteMessage);
  } catch (e) { try { res.status(500).end(); } catch {} }
});

app.post('/mcp/message', async (req, res) => {
  try {
    if (!await requireMcpAuth(req, res)) return;
    const sessionId = String(req.query?.sessionId || '').trim();
    const sess = sseSessions.get(sessionId);
    if (!sess) return res.status(404).end('session_not_found');
    const msg = req.body || {};
    const outRes = sess.res;
    const id = msg.id; const method = msg.method; const params = msg.params || {};
    try {
      if (method === 'initialize') {
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'livechat-mcp', version: '0.1' },
          capabilities: {
            logging: {},
            tools: { listChanged: true },
            resources: { subscribe: true, listChanged: true },
            prompts: { listChanged: true },
          }
        } });
        sseWriteJson(outRes, { jsonrpc: '2.0', method: 'initialized', params: {} });
        return res.status(204).end();
      }
      if (method === 'tools/list') {
        const tools = listToolsForClient();
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { tools } });
        return res.status(204).end();
      }
      if (method === 'resources/list') {
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { resources: [] } });
        return res.status(204).end();
      }
      if (method === 'prompts/list') {
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { prompts: [] } });
        return res.status(204).end();
      }
      if (method === 'ping') {
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { pong: true, time: new Date().toISOString() } });
        return res.status(204).end();
      }
      if (method === 'resources/subscribe') { sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { ok: true } }); return res.status(204).end(); }
      if (method === 'resources/unsubscribe') { sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { ok: true } }); return res.status(204).end(); }
      if (method === 'resources/templates/list') { sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { templates: [] } }); return res.status(204).end(); }
      if (method === 'tools/call') {
        const name = params.name || params.tool || '';
        const args = params.arguments || params.args || {};
        const ctx = { ...sess.ctx, id_bot: String(args?.bot_id || sess.ctx?.id_bot || '') };
        const result = await MCP.run(name, args, ctx);
        sseWriteJson(outRes, { jsonrpc: '2.0', id, result: { content: [{ type: 'json', json: result }] } });
        return res.status(204).end();
      }
      sseWriteJson(outRes, { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
      return res.status(204).end();
    } catch (e) {
      sseWriteJson(outRes, { jsonrpc: '2.0', id, error: { code: -32000, message: e?.message || 'server_error' } });
      return res.status(204).end();
    }
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e?.message || String(e) });
  }
});

/* ============================ MCP FILE ENDPOINTS ========================= */
// JSON upload endpoint: { filename, content_base64, content_type?, bot_id? }
app.post('/mcp/files/base64', async (req, res) => {
  if (!await requireMcpAuth(req, res)) return;
  try {
    const b = req.body || {};
    const filename = String(b.filename || '').trim();
    const base64 = String(b.content_base64 || '').trim();
    if (!filename || !base64) return res.status(400).json({ ok: false, error: 'bad_request' });
    const buf = Buffer.from(base64, 'base64');
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const rel = id + '-' + filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const full = path.join(mcpUploadDir, rel);
    fs.writeFileSync(full, buf);
    const ct = String(b.content_type || 'application/octet-stream');
    const botId = (b.bot_id && String(b.bot_id).trim()) || null;
    await pool.query(`INSERT INTO mcp_files (id, file_name, file_path, content_type, size_bytes, bot_id) VALUES ($1,$2,$3,$4,$5,$6)`, [id, filename, rel, ct, buf.length, botId]);
    res.json({ ok: true, id, file_name: filename, size_bytes: buf.length, content_type: ct });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e.message });
  }
});

app.get('/mcp/files', async (req, res) => {
  if (!await requireMcpAuth(req, res)) return;
  try {
    const botId = String(req.query.bot_id || '').trim();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const where = [];
    const params = [];
    if (botId) { where.push('bot_id = $' + (params.push(botId))); }
    params.push(limit);
    const r = await pool.query(`SELECT id, file_name, content_type, size_bytes, bot_id, created_at FROM mcp_files ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    res.json({ ok: true, files: r.rows || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e.message });
  }
});

app.get('/mcp/file/:id/download', async (req, res) => {
  if (!await requireMcpAuth(req, res)) return;
  try {
    const id = String(req.params.id || '').trim();
    const r = await pool.query(`SELECT * FROM mcp_files WHERE id=$1 LIMIT 1`, [id]);
    if (!r.rowCount) return res.status(404).end();
    const row = r.rows[0];
    const full = path.join(mcpUploadDir, row.file_path);
    if (!fs.existsSync(full)) return res.status(404).end();
    res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${row.file_name}"`);
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e.message });
  }
});

// === OpenAI Actions-friendly HTTP interface for MCP tools ===
// List available tools (name, description, inputSchema)
app.get('/mcp/actions/tools', async (req, res) => {
  if (!await requireMcpAuth(req, res)) return;
  try {
    const tools = listToolsForClient();
    res.json({ ok: true, tools });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Call a specific tool over HTTP for use as an OpenAI Action endpoint
// Body: { name: string, arguments?: object|string, bot_id?: string }
app.post('/mcp/actions/tools/call', async (req, res) => {
  if (!await requireMcpAuth(req, res)) return;
  try {
    const b = req.body || {};
    const name = String(b.name || b.tool || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'bad_request', message: 'name required' });
    let args = b.arguments ?? b.args ?? {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    if (typeof args !== 'object' || Array.isArray(args) || args === null) args = {};
    const botId = String(b.bot_id || req.query.bot_id || args.bot_id || '').trim();

    const ctx = { id_bot: botId || undefined, session: { authed: true } };
    const result = await MCP.run(name, args, ctx);
    res.json({ ok: true, tool: name, bot_id: botId || null, output: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Dynamic OpenAPI spec to register in OpenAI Actions UI
app.get(['/mcp/actions/openapi.json', '/.well-known/openapi.json'], (req, res) => {
  try {
    const fproto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
    const fhost = String(req.headers['x-forwarded-host'] || '').split(',')[0]?.trim();
    const proto = (fproto || req.protocol || 'http').toLowerCase();
    const host = (fhost || req.headers.host || 'localhost').trim();
    const base = `${proto}://${host}`;
    const spec = {
      openapi: '3.0.3',
      info: { title: 'MCP Tools HTTP Bridge', version: '0.1.0' },
      servers: [{ url: base }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          tokenQuery: { type: 'apiKey', in: 'query', name: 'token' },
        },
        schemas: {
          ToolCallRequest: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', description: 'Tool name' },
              arguments: { type: 'object', additionalProperties: true },
              bot_id: { type: 'string' },
            },
          },
          ToolCallResponse: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              tool: { type: 'string' },
              bot_id: { type: 'string', nullable: true },
              output: { type: 'object', additionalProperties: true },
            },
          },
          ToolsListResponse: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              tools: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    inputSchema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      security: [{ bearerAuth: [] }, { tokenQuery: [] }],
      paths: {
        '/mcp/actions/tools': {
          get: {
            summary: 'List available MCP tools',
            security: [{ bearerAuth: [] }, { tokenQuery: [] }],
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolsListResponse' } } } },
              '401': { description: 'Unauthorized' },
            },
          },
        },
        '/mcp/actions/tools/call': {
          post: {
            summary: 'Call an MCP tool',
            security: [{ bearerAuth: [] }, { tokenQuery: [] }],
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ToolCallRequest' } },
              },
            },
            responses: {
              '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolCallResponse' } } } },
              '400': { description: 'Bad request' },
              '401': { description: 'Unauthorized' },
              '500': { description: 'Server error' },
            },
          },
        },
      },
    };
    res.json(spec);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Issue MCP access token for authenticated agents. Returns the configured
// MCP token if set; otherwise indicates that no token is required.
app.get('/api/mcp/token', (req, res) => {
  const u = authFromRequest(req);
  if (!u) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const t = getMcpToken();
  if (!t) return res.json({ ok: true, required: false, token: null });
  res.json({ ok: true, required: true, token: t });
});

// Per-bot MCP token management (stored in chatbot_config)
app.get('/api/automations/chatbots/:id/mcp/token', async (req, res) => {
  const u = authFromRequest(req);
  if (!u) return res.status(401).json({ ok: false, error: 'unauthorized' });
  try {
    const id = String(req.params.id || '').trim();
    let r = await pool.query(`SELECT mcp_token FROM chatbot_config WHERE id_bot=$1`, [id]);
    if (!r.rowCount) {
      // Auto-create minimal chatbot_config when missing (derive shop/lang from visitors)
      try {
        const v = await pool.query(`SELECT DISTINCT shop_name, lang_iso FROM visitors WHERE shop_name IS NOT NULL AND shop_name<>'' AND lang_iso IS NOT NULL AND lang_iso<>''`);
        let found = null;
        for (const row of v.rows || []) {
          const bid = makeBotId(row.shop_name, row.lang_iso);
          if (bid === id) { found = row; break; }
        }
        if (found) {
          await pool.query(
            `INSERT INTO chatbot_config (id_bot, shop_name, lang_iso, enabled)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (id_bot) DO NOTHING`,
            [id, found.shop_name, found.lang_iso, false]
          );
          r = await pool.query(`SELECT mcp_token FROM chatbot_config WHERE id_bot=$1`, [id]);
        }
      } catch {}
    }
    const token = r.rowCount ? (r.rows[0].mcp_token || null) : null;
    res.json({ ok: true, required: !!token, token });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});
app.post('/api/automations/chatbots/:id/mcp/token/regenerate', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const id = String(req.params.id || '').trim();
    const tok = (globalThis.crypto?.randomUUID?.() || '') + '-' + (crypto.randomBytes ? crypto.randomBytes(16).toString('hex') : Math.random().toString(16).slice(2));
    await pool.query(`UPDATE chatbot_config SET mcp_token=$1, updated_at=NOW() WHERE id_bot=$2`, [tok, id]);
    res.json({ ok: true, token: tok });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});
app.post('/api/automations/chatbots/:id/mcp/token/disable', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const id = String(req.params.id || '').trim();
    await pool.query(`UPDATE chatbot_config SET mcp_token=NULL, updated_at=NOW() WHERE id_bot=$1`, [id]);
    res.json({ ok: true, token: null, required: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});
app.post('/api/automations/chatbots/:id/mcp/token', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const id = String(req.params.id || '').trim();
    const t = String(req.body?.token || '').trim();
    await pool.query(`UPDATE chatbot_config SET mcp_token=$1, updated_at=NOW() WHERE id_bot=$2`, [t || null, id]);
    res.json({ ok: true, token: t || null, required: !!t });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Admin: regenerate or set/disable MCP token
app.post('/api/admin/mcp/token/regenerate', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const tok = (globalThis.crypto?.randomUUID?.() || '') + '-' + (crypto.randomBytes ? crypto.randomBytes(16).toString('hex') : Math.random().toString(16).slice(2));
    await setSetting('MCP_TOKEN', tok);
    mcpToken = tok;
    res.json({ ok: true, token: tok });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

app.post('/api/admin/mcp/token/disable', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    await setSetting('MCP_TOKEN', '');
    mcpToken = '';
    res.json({ ok: true, token: null, required: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

app.post('/api/admin/mcp/token', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const t = String(req.body?.token || '').trim();
    await setSetting('MCP_TOKEN', t);
    mcpToken = t;
    res.json({ ok: true, token: t || null, required: !!t });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Admin: get/set public base URL for MCP/OpenAI Actions
app.get('/api/admin/mcp/public-base', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    res.json({ ok: true, value: getMcpPublicBase() || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});
app.post('/api/admin/mcp/public-base', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    const v = String(req.body?.value || '').trim();
    await setSetting('MCP_PUBLIC_BASE', v);
    mcpPublicBase = v;
    res.json({ ok: true, value: v || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// ---- Admin endpoints for MCP-DEV token/public base ----
app.post('/api/admin/mcp-dev/token/regenerate', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    const tok = crypto.randomUUID();
    await setSetting('MCP_DEV_TOKEN', tok);
    mcpDevToken = tok;
    res.json({ ok: true, token: tok, required: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// Fetch current MCP-DEV token (admin only)
app.get('/api/admin/mcp-dev/token', async (req, res) => {
  // Allow either cookie-authenticated admin OR ADMIN_TOKEN header/query
  try {
    const u = authFromRequest(req);
    let allowed = u && String(u.role || '') === 'admin';
    if (!allowed) {
      const expected = process.env.ADMIN_TOKEN || '';
      if (expected) {
        const got = req.headers['x-admin-token'] || req.query.admin_token;
        allowed = String(got) === expected;
      } else {
        // No ADMIN_TOKEN configured → allow only localhost
        allowed = isLocalhost(req);
      }
    }
    if (!allowed) return res.status(401).json({ ok: false, error: 'unauthorized' });
    const t = getMcpDevToken();
    res.json({ ok: true, token: t || null, required: !!t });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

app.post('/api/admin/mcp-dev/token/disable', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    await setSetting('MCP_DEV_TOKEN', '');
    mcpDevToken = '';
    res.json({ ok: true, token: null, required: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

app.post('/api/admin/mcp-dev/token', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    const t = String(req.body?.token || '').trim();
    await setSetting('MCP_DEV_TOKEN', t);
    mcpDevToken = t;
    res.json({ ok: true, token: t || null, required: !!t });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

app.get('/api/admin/mcp-dev/public-base', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    res.json({ ok: true, value: getMcpDevPublicBase() || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});
app.post('/api/admin/mcp-dev/public-base', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    const v = String(req.body?.value || '').trim();
    await setSetting('MCP_DEV_PUBLIC_BASE', v);
    mcpDevPublicBase = v;
    res.json({ ok: true, value: v || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// ---- Admin endpoints for OpenAI API key ----
app.get('/api/admin/openai/key', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    res.json({ ok: true, value: getOpenaiApiKey() || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});
app.post('/api/admin/openai/key', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    const v = String(req.body?.value || '').trim();
    await setSetting('OPENAI_API_KEY', v);
    openaiApiKey = v; process.env.OPENAI_API_KEY = v;
    res.json({ ok: true, value: v || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});
app.post('/api/admin/openai/key/clear', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    await setSetting('OPENAI_API_KEY', '');
    openaiApiKey = ''; process.env.OPENAI_API_KEY = '';
    res.json({ ok: true, value: null });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// ---- Admin: Development panel note (server-side) ----
app.get('/api/admin/dev/note', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    const v = await getSetting('DEV_PANEL_NOTE');
    res.json({ ok: true, value: v || '' });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});
app.post('/api/admin/dev/note', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    const v = String(req.body?.value ?? '');
    await setSetting('DEV_PANEL_NOTE', v);
    res.json({ ok: true, value: v });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
  }
});

// --- Minimal Messages endpoint (Responses API + Prompt-only) ---
// Usage: POST /messages { content: "..." }
// Env required: OPENAI_API_KEY, PROMPT_ID (and optional PROMPT_VERSION)
app.post("/messages", async (req, res) => {
  try {
    const input = String(
      req.body?.content ?? req.body?.message ?? req.body?.input ?? ""
    ).trim();
    if (!input) return res.status(400).json({ error: "bad_request", message: "content required" });

    let apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) apiKey = (await getSetting('OPENAI_API_KEY')) || "";
    let promptId = process.env.PROMPT_ID || process.env.OPENAI_PROMPT_ID || "";
    if (!promptId) promptId = (await getSetting('PROMPT_ID')) || "";
    let promptVersion = process.env.PROMPT_VERSION || process.env.OPENAI_PROMPT_VERSION || undefined;
    if (!promptVersion) promptVersion = await getSetting('PROMPT_VERSION');
    if (!apiKey) return res.status(400).json({ error: "bad_request", message: "OPENAI_API_KEY missing" });
    if (!promptId) return res.status(400).json({ error: "bad_request", message: "PROMPT_ID missing" });

    const { text, request } = await respondWithPrompt({
      apiKey,
      model: String(req.body?.model || req.query?.model || "").trim() || undefined,
      promptId,
      promptVersion,
      input,
    });
    res.json({ content: text, text, request });
  } catch (e) {
    logToFile(`❌ POST /messages error: ${e.message}`);
    res.status(500).json({ error: "server_error", message: e.message });
  }
});

// Messages endpoint with MCP function-tools enabled (DEV helper)
// Usage: POST /messages/tools { content: "...", model?: "gpt-..." }
app.post("/messages/tools", async (req, res) => {
  try {
    const input = String(
      req.body?.content ?? req.body?.message ?? req.body?.input ?? ""
    ).trim();
    if (!input) return res.status(400).json({ error: "bad_request", message: "content required" });

    let apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) apiKey = (await getSetting('OPENAI_API_KEY')) || "";
    let promptId = process.env.PROMPT_ID || process.env.OPENAI_PROMPT_ID || "";
    if (!promptId) promptId = (await getSetting('PROMPT_ID')) || "";
    let promptVersion = process.env.PROMPT_VERSION || process.env.OPENAI_PROMPT_VERSION || undefined;
    if (!promptVersion) promptVersion = await getSetting('PROMPT_VERSION');
    if (!apiKey) return res.status(400).json({ error: "bad_request", message: "OPENAI_API_KEY missing" });
    if (!promptId) return res.status(400).json({ error: "bad_request", message: "PROMPT_ID missing" });

    const functionTools = MCP.toFunctionTools();
    const { text, raw, request } = await respondWithPromptAndTools({
      apiKey,
      model: String(req.body?.model || req.query?.model || "").trim() || undefined,
      promptId,
      promptVersion,
      input,
      functionTools,
      onToolCall: async ({ name, arguments: args }) => {
        const ctx = { id_bot: 'mcp_dev', session: { authed: true } };
        return await MCP.run(name, args, ctx);
      },
    });
    res.json({ content: text, text, raw, request });
  } catch (e) {
    logToFile(`❌ POST /messages/tools error: ${e.message}`);
    res.status(500).json({ error: "server_error", message: e.message });
  }
});

// Suggest an AI draft for the latest visitor message using bot config (Prompt-only)
app.post("/api/assistant/draft", async (req, res) => {
  try {
    const b = req.body || {};
    const visitorId = String(b.visitorId || "").trim();
    if (!visitorId) return res.status(400).json({ ok: false, error: "bad_request", message: "visitorId required" });

    // Resolve chatbot id in priority order: explicit chatbot_id (external) -> mapping -> visitor context shop/lang
    let botId = null;
    // 1) Explicit external chatbot_id from request (e.g., Prestashop front)
    const extId = String(b.chatbot_id || '').trim();
    if (extId) {
      try {
        await ensureHubBotMapTable();
        const mr = await pool.query(`SELECT id_bot FROM hub_bot_map WHERE assistant_id_ext=$1 LIMIT 1`, [extId]);
        if (mr.rowCount) botId = mr.rows[0].id_bot;
      } catch {}
      if (!botId) {
        // If extId directly matches an internal id_bot, accept it
        try { const chk = await pool.query(`SELECT 1 FROM chatbot_config WHERE id_bot=$1 LIMIT 1`, [extId]); if (chk.rowCount) botId = extId; } catch {}
      }
    }
    // 2) Mapping via visitor.assistant_id if still unresolved
    if (!botId) {
      const vrow = await pool.query(
        `SELECT shop_name, lang_iso, assistant_id, chatbot_id FROM visitors WHERE (visitor_id = $1 OR id = $1) LIMIT 1`,
        [visitorId]
      );
      const shop = vrow.rows?.[0]?.shop_name || null;
      const lang = vrow.rows?.[0]?.lang_iso || null;
      const assistantExt = vrow.rows?.[0]?.assistant_id || null;
      if (assistantExt) {
        try {
          await ensureHubBotMapTable();
          const mr2 = await pool.query(`SELECT id_bot FROM hub_bot_map WHERE assistant_id_ext=$1 LIMIT 1`, [assistantExt]);
          if (mr2.rowCount) botId = mr2.rows[0].id_bot;
        } catch {}
      }
      if (!botId) {
        const vc = vrow.rows?.[0]?.chatbot_id || null;
        if (vc) {
          try { await ensureHubBotMapTable(); const mr3 = await pool.query(`SELECT id_bot FROM hub_bot_map WHERE assistant_id_ext=$1 LIMIT 1`, [vc]); if (mr3.rowCount) botId = mr3.rows[0].id_bot; } catch {}
          if (!botId) { try { const chk2 = await pool.query(`SELECT 1 FROM chatbot_config WHERE id_bot=$1 LIMIT 1`, [vc]); if (chk2.rowCount) botId = vc; } catch {} }
        }
      }
      // 3) Fallback to shop/lang derived id
      if (!botId) {
        if (!shop || !lang) return res.status(400).json({ ok: false, error: "no_bot_context", message: "shop_name/lang_iso missing for visitor" });
        botId = makeBotId(shop, lang);
      }
    }
    const cr = await pool.query(`SELECT * FROM chatbot_config WHERE id_bot = $1 LIMIT 1`, [botId]);
    if (!cr.rowCount) return res.status(404).json({ ok: false, error: "bot_not_found", message: `No chatbot_config for ${botId}` });
    const cfg = cr.rows[0];
    if (!cfg.openai_api_key) return res.status(400).json({ ok: false, error: "openai_key_missing" });
    if (!cfg.prompt_id) return res.status(400).json({ ok: false, error: "prompt_missing" });

    // Fetch latest visitor message
    const mr = await pool.query(
      `SELECT COALESCE(content, message) AS m
         FROM messages
        WHERE visitor_id = $1 AND (sender IS NULL OR sender <> 'agent')
        ORDER BY created_at DESC
        LIMIT 1`,
      [visitorId]
    );
    const lastMsg = (mr.rows?.[0]?.m || "").trim();
    if (!lastMsg) return res.status(400).json({ ok: false, error: "no_visitor_message" });

    const extraContext = String(b.extraContext || "").trim();
    const input = extraContext ? `${lastMsg}\n\n${extraContext}` : lastMsg;

    const { text, raw } = await respondWithPrompt({
      apiKey: cfg.openai_api_key,
      promptId: cfg.prompt_id,
      promptVersion: cfg.prompt_version || undefined,
      input,
    });
    try {
      logToFile(`AI_DRAFT visitor=${visitorId} bot=${botId} text_len=${(text||'').length}`);
      logToFile(`AI_DRAFT_RAW ${JSON.stringify(raw)?.slice(0,2000)}`);
    } catch {}
    return res.json({ ok: true, draft: text || "" });
  } catch (e) {
    logToFile(`❌ /api/assistant/draft: ${e.message}`);
    return res.status(500).json({ ok: false, error: "server_error", message: e.message });
  }
});

// ---- Admin endpoints for Prompt settings (Responses API) ----
app.get('/api/admin/prompt/id', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try { res.json({ ok: true, value: (await getSetting('PROMPT_ID')) || null }); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
});
app.post('/api/admin/prompt/id', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    const v = String(req.body?.value || '').trim();
    await setSetting('PROMPT_ID', v);
    process.env.PROMPT_ID = v;
    res.json({ ok: true, value: v || null });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
});
app.get('/api/admin/prompt/version', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try { res.json({ ok: true, value: (await getSetting('PROMPT_VERSION')) || null }); }
  catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
});
app.post('/api/admin/prompt/version', async (req, res) => {
  const u = requireAdminAuth(req, res); if (!u) return;
  try {
    const v = String(req.body?.value || '').trim();
    await setSetting('PROMPT_VERSION', v);
    process.env.PROMPT_VERSION = v;
    res.json({ ok: true, value: v || null });
  } catch (e) { res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) }); }
});

// Lightweight config lookup for a visitor → returns chatbot behavior
// GET /api/assistant/config?visitorId=...
app.get("/api/assistant/config", async (req, res) => {
  try {
    const visitorId = String(req.query.visitorId || "").trim();
    if (!visitorId) return res.status(400).json({ ok: false, error: "bad_request" });

    // Find shop/lang for this visitor
    const vrow = await pool.query(
      `SELECT shop_name, lang_iso
         FROM visitors
        WHERE (visitor_id = $1 OR id = $1)
        LIMIT 1`,
      [visitorId]
    );
    const shop = vrow.rows?.[0]?.shop_name || null;
    const lang = vrow.rows?.[0]?.lang_iso || null;
    if (!shop || !lang) return res.json({ ok: true, bot_behavior: 'manual' });

    const botId = makeBotId(shop, lang);
    const cr = await pool.query(
      `SELECT bot_behavior, enabled, prompt_id, openai_api_key
         FROM chatbot_config
        WHERE id_bot = $1
        LIMIT 1`,
      [botId]
    );
    if (!cr.rowCount) return res.json({ ok: true, bot_behavior: 'manual' });
    const row = cr.rows[0] || {};
    return res.json({
      ok: true,
      id_bot: botId,
      bot_behavior: row.bot_behavior || 'manual',
      enabled: !!row.enabled,
      has_prompt: !!row.prompt_id,
      has_api_key: !!row.openai_api_key,
    });
  } catch (e) {
    logToFile(`❌ /api/assistant/config: ${e.message}`);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/* ====================== MCP Streamable HTTP (Inspector) =================== */
// Minimal JSON-only Streamable HTTP endpoints so the MCP Inspector can
// connect using transport "streamable-http". These respond with JSON rather
// than opening SSE streams.

function jsonrpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function jsonrpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

app.post('/mcp-dev/stream', async (req, res) => {
  if (!await requireMcpDevAuth(req, res)) return;
  try {
    const msg = req.body || {};
    const id = msg.id; const method = msg.method; const params = msg.params || {};
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('mcp-session-id', 'mcp-dev-' + (Date.now()));

    if (method === 'initialize') {
      return res.status(200).json(jsonrpcResponse(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'livechat-mcp-dev', version: '0.1' },
        capabilities: {
          logging: {},
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
        }
      }));
    }
    if (method === 'tools/list') {
      return res.status(200).json(jsonrpcResponse(id, { tools: listToolsForClient() }));
    }
    if (method === 'resources/list') {
      return res.status(200).json(jsonrpcResponse(id, { resources: [] }));
    }
    if (method === 'prompts/list') {
      return res.status(200).json(jsonrpcResponse(id, { prompts: [] }));
    }
    if (method === 'resources/subscribe') {
      return res.status(200).json(jsonrpcResponse(id, { ok: true }));
    }
    if (method === 'resources/unsubscribe') {
      return res.status(200).json(jsonrpcResponse(id, { ok: true }));
    }
    if (method === 'resources/templates/list') {
      return res.status(200).json(jsonrpcResponse(id, { templates: [] }));
    }
    if (method === 'ping') {
      return res.status(200).json(jsonrpcResponse(id, { pong: true, time: new Date().toISOString() }));
    }
    if (method === 'tools/call') {
      const name = params.name || params.tool || '';
      const args = params.arguments || params.args || {};
      const result = await MCP.run(name, args, { id_bot: 'mcp_dev', session: { authed: true } });
      return res.status(200).json(jsonrpcResponse(id, { content: [{ type: 'json', json: result }] }));
    }
    return res.status(200).json(jsonrpcError(id, -32601, `Unknown method: ${method}`));
  } catch (e) {
    return res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: e?.message || 'server_error' } });
  }
});

app.post('/mcp/stream', async (req, res) => {
  if (!await requireMcpAuth(req, res)) return;
  try {
    const msg = req.body || {};
    const id = msg.id; const method = msg.method; const params = msg.params || {};
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('mcp-session-id', 'mcp-' + (Date.now()));

    if (method === 'initialize') {
      return res.status(200).json(jsonrpcResponse(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'livechat-mcp', version: '0.1' },
        capabilities: {
          logging: {},
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
        }
      }));
    }
    if (method === 'tools/list') {
      return res.status(200).json(jsonrpcResponse(id, { tools: listToolsForClient() }));
    }
    if (method === 'resources/list') {
      return res.status(200).json(jsonrpcResponse(id, { resources: [] }));
    }
    if (method === 'prompts/list') {
      return res.status(200).json(jsonrpcResponse(id, { prompts: [] }));
    }
    if (method === 'resources/subscribe') {
      return res.status(200).json(jsonrpcResponse(id, { ok: true }));
    }
    if (method === 'resources/unsubscribe') {
      return res.status(200).json(jsonrpcResponse(id, { ok: true }));
    }
    if (method === 'resources/templates/list') {
      return res.status(200).json(jsonrpcResponse(id, { templates: [] }));
    }
    if (method === 'ping') {
      return res.status(200).json(jsonrpcResponse(id, { pong: true, time: new Date().toISOString() }));
    }
    if (method === 'tools/call') {
      const name = params.name || params.tool || '';
      const args = params.arguments || params.args || {};
      const ctx = { id_bot: String(args?.bot_id || req.query?.bot_id || ''), session: { authed: true } };
      const result = await MCP.run(name, args, ctx);
      return res.status(200).json(jsonrpcResponse(id, { content: [{ type: 'json', json: result }] }));
    }
    return res.status(200).json(jsonrpcError(id, -32601, `Unknown method: ${method}`));
  } catch (e) {
    return res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: e?.message || 'server_error' } });
  }
});

// Helpful GET handlers so a direct browser visit doesn't show "Cannot GET".
app.get('/mcp-dev/stream', (_req, res) => {
  res.status(405).type('text/plain; charset=utf-8').send('Use POST JSON (application/json) to /mcp-dev/stream for Streamable HTTP (MCP).');
});
app.get('/mcp/stream', (_req, res) => {
  res.status(405).type('text/plain; charset=utf-8').send('Use POST JSON (application/json) to /mcp/stream for Streamable HTTP (MCP).');
});

/* ============================ START ======================================= */
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
    logToFile(`🚀 Serveur démarré sur http://0.0.0.0:${PORT}`);
  });
}

// As the very last middleware: make unknown /api/* return JSON 404 (not HTML)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found' });
});
