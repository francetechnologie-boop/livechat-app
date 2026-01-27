export function registerConversationHubRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const log = (m) => { try { ctx.logToFile?.(`[conversation-hub] ${m}`); } catch {} };
  const getSetting = ctx.getSetting || (async () => null);
  const setSetting = ctx.setSetting || (async () => {});
  const io = ctx?.extras?.io;
  const requireAdmin = (req, res) => {
    try {
      if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin(req, res);
    } catch {}
    try { res.status(401).json({ ok: false, error: 'unauthorized' }); } catch {}
    return null;
  };

  function toNullableInt(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (!/^-?\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  async function geoLookup(ipRaw) {
    const ip = String(ipRaw || '').trim().replace(/^::ffff:/, '');
    if (!ip) return null;
    const cache = (globalThis.__convHubHttpGeo ||= { reader: null, tried: false });
    if (!cache.tried) {
      cache.tried = true;
      try {
        const fsMod = await import('fs');
        const pathMod = await import('path');
        const urlMod = await import('url');
        const fs = fsMod.default || fsMod;
        const p = pathMod.default || pathMod;
        const envPath = String(process.env.MAXMIND_DB_PATH || '').trim();
        const candidates = [];
        if (envPath) candidates.push(envPath);
        try {
          const __filename = urlMod.fileURLToPath(import.meta.url);
          const __dirname = p.dirname(__filename);
          const repoRoot = p.resolve(__dirname, '..', '..', '..', '..');
          candidates.push(p.join(repoRoot, 'GeoIP', 'GeoLite2-City.mmdb'));
        } catch {}
        candidates.push('/usr/share/GeoIP/GeoLite2-City.mmdb');
        candidates.push('/usr/share/GeoIP/GeoLite2-Country.mmdb');

        const dbPath = candidates.find((pp) => pp && fs.existsSync(pp));
        if (dbPath) {
          let mm = null;
          try {
            mm = await import('@maxmind/geoip2-node');
          } catch {
            try {
              const __filename = urlMod.fileURLToPath(import.meta.url);
              const __dirname = p.dirname(__filename);
              const repoRoot = p.resolve(__dirname, '..', '..', '..', '..');
              const alt = p.join(repoRoot, 'backend', 'node_modules', '@maxmind', 'geoip2-node', 'dist', 'src', 'index.js');
              mm = await import(urlMod.pathToFileURL(alt).href);
            } catch {}
          }
          const mod = mm && (mm.default || mm);
          const Reader = mod?.Reader;
          if (Reader?.open) cache.reader = await Reader.open(dbPath);
        }
      } catch {}
    }
    if (!cache.reader) return null;
    try {
      const r = await cache.reader.city(ip);
      return {
        country_code: r?.country?.isoCode || r?.registeredCountry?.isoCode || null,
        city: (r?.city?.names && (r.city.names['fr'] || r.city.names['en'])) || r?.city?.name || null,
        postcode: r?.postal?.code || null,
      };
    } catch {
      return null;
    }
  }

  // Minimal health endpoint
  app.get('/api/conversation-hub/ping', (_req, res) => res.json({ ok: true, module: 'conversation-hub' }));

  // Payload report (received from / sent to website)
  app.get('/api/conversation-hub/payload-report', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    try {
      await ensureSchema();
      const visitorIdRaw = String(req.query.visitorId || '').trim();
      const visitorId = visitorIdRaw ? visitorIdRaw : null;
      const limit = Math.max(10, Math.min(1000, Number(req.query.limit || 200)));

      let rows = [];
      let hasLog = false;
      try {
        const chk = await pool.query(`SELECT to_regclass('public.mod_conversation_hub_payload_log') AS oid`);
        hasLog = !!chk?.rows?.[0]?.oid;
      } catch {}

      if (hasLog) {
        const params = [];
        const where = visitorId ? (params.push(visitorId), 'WHERE visitor_id = $1') : '';
        const r = await pool.query(
          `SELECT id, visitor_id, direction, event, payload, created_at
             FROM public.mod_conversation_hub_payload_log
             ${where}
             ORDER BY created_at DESC
             LIMIT ${limit}`,
          params
        );
        rows = r.rows || [];
      } else if (visitorId) {
        const { base, html } = msgExprSelect();
        const r = await pool.query(
          `SELECT id, visitor_id, sender, ${base} AS content, agent_id, created_at${html}
             FROM ${dbSchema.messages.table}
            WHERE visitor_id = $1
            ORDER BY created_at DESC
            LIMIT ${limit}`,
          [visitorId]
        );
        rows = (r.rows || []).map((m) => {
          const sender = String(m.sender || '').toLowerCase().trim();
          return {
            id: m.id,
            visitor_id: m.visitor_id,
            direction: sender === 'agent' ? 'sent' : 'received',
            event: 'chat_message',
            payload: {
              visitorId: m.visitor_id,
              from: m.sender || null,
              message: m.content || '',
              content_html: m.content_html || null,
              agent_id: m.agent_id ?? null,
              created_at: m.created_at || null,
            },
            created_at: m.created_at,
          };
        });
      }

      const received = rows.filter((x) => String(x.direction) === 'received');
      const sent = rows.filter((x) => String(x.direction) === 'sent');
      res.json({ ok: true, visitorId, received, sent });
    } catch (e) {
      log(`GET /api/conversation-hub/payload-report error: ${e.message}`);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  function toNullableInt(v) {
    try {
      if (v == null) return null;
      const s = String(v).trim();
      if (!s) return null;
      if (!/^-?\d+$/.test(s)) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  async function hasOpenAiLogTable() {
    try {
      const chk = await pool.query(`SELECT to_regclass('public.mod_conversation_hub_openai_log') AS oid`);
      return !!chk?.rows?.[0]?.oid;
    } catch {
      return false;
    }
  }

  function capJson(v, maxChars) {
    try {
      const s = JSON.stringify(v);
      const max = Number(maxChars) > 0 ? Number(maxChars) : 120000;
      if (s.length <= max) return v;
      return { truncated: true, text: s.slice(0, max) + '…' };
    } catch {
      return { error: 'unserializable' };
    }
  }

  // OpenAI log (request/response snapshots)
  app.get('/api/conversation-hub/openai-log', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    try {
      const visitorIdRaw = String(req.query.visitorId || '').trim();
      const visitorId = visitorIdRaw ? visitorIdRaw : null;
      const limit = Math.max(10, Math.min(1000, Number(req.query.limit || 200)));
      if (!(await hasOpenAiLogTable())) {
        return res.status(404).json({ ok: false, error: 'table_missing', message: 'OpenAI log table is missing.', hint: 'Run module migrations (conversation-hub installer) to create mod_conversation_hub_openai_log.' });
      }
      const params = [];
      const where = visitorId ? (params.push(visitorId), 'WHERE visitor_id = $1') : '';
      const r = await pool.query(
        `SELECT id, org_id, visitor_id, id_bot, prompt_config_id, request, response, created_at
           FROM public.mod_conversation_hub_openai_log
           ${where}
           ORDER BY created_at DESC
           LIMIT ${limit}`,
        params
      );
      res.json({ ok: true, visitorId, items: r.rows || [] });
    } catch (e) {
      log(`GET /api/conversation-hub/openai-log error: ${e.message}`);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/conversation-hub/openai-log', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    try {
      const b = req.body || {};
      const visitorId = b.visitorId != null ? String(b.visitorId).trim() : null;
      const idBot = b.id_bot != null ? String(b.id_bot).trim() : (b.idBot != null ? String(b.idBot).trim() : null);
      const promptConfigId = b.prompt_config_id != null ? String(b.prompt_config_id).trim() : (b.promptConfigId != null ? String(b.promptConfigId).trim() : null);
      const orgId = toNullableInt(req.headers?.['x-org-id'] ?? req.headers?.['X-Org-Id'] ?? null);
      const requestObj = capJson(b.request ?? b.request_body ?? null, 120000);
      const responseObj = capJson(b.response ?? null, 120000);
      if (!visitorId) return res.status(400).json({ ok: false, error: 'bad_request', message: 'visitorId required' });
      if (!(await hasOpenAiLogTable())) {
        return res.status(404).json({ ok: false, error: 'table_missing', message: 'OpenAI log table is missing.', hint: 'Run module migrations (conversation-hub installer) to create mod_conversation_hub_openai_log.' });
      }
      await pool.query(
        `INSERT INTO public.mod_conversation_hub_openai_log (org_id, visitor_id, id_bot, prompt_config_id, request, response, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [orgId, visitorId, idBot || null, promptConfigId || null, requestObj, responseObj]
      );
      res.json({ ok: true });
    } catch (e) {
      log(`POST /api/conversation-hub/openai-log error: ${e.message}`);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // Schema snapshot (best effort) for flexible queries
  const dbSchema = {
    loaded: false,
    visitors: { exists: false, table: 'visitors', idCol: null, hasVisitorIdCol: false, hasIdCol: false, hasCreatedAt: false, hasLastSeen: false, columns: [] },
    visits: { exists: false, table: 'visits' },
    messages: { exists: false, table: 'messages', hasContent: false, hasContentHtml: false, hasMessage: false, hasVisitorId: false, idType: null },
  };
  async function introspectDb() {
    if (!pool) return; // if no DB, keep 404s for data routes
    try {
      // Pick prefixed visitors table if present
      const pref = await pool.query(`SELECT to_regclass('public.mod_conversation_hub_visitors') AS oid`);
      const hasPref = !!(pref.rows && pref.rows[0] && pref.rows[0].oid);
      dbSchema.visitors.table = hasPref ? 'mod_conversation_hub_visitors' : 'visitors';
      const vCols = await pool.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [dbSchema.visitors.table]);
      if (vCols.rowCount) {
        dbSchema.visitors.exists = true;
        dbSchema.visitors.columns = vCols.rows.map(r => r.column_name);
        dbSchema.visitors.hasIdCol = dbSchema.visitors.columns.includes('id');
        dbSchema.visitors.hasVisitorIdCol = dbSchema.visitors.columns.includes('visitor_id');
        dbSchema.visitors.hasCreatedAt = dbSchema.visitors.columns.includes('created_at');
        dbSchema.visitors.hasLastSeen = dbSchema.visitors.columns.includes('last_seen');
        dbSchema.visitors.idCol = dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : (dbSchema.visitors.hasIdCol ? 'id' : null);
      }
    } catch {}
    try {
      const prefV = await pool.query(`SELECT to_regclass('public.mod_conversation_hub_visits') AS oid`);
      const hasPrefV = !!(prefV.rows && prefV.rows[0] && prefV.rows[0].oid);
      dbSchema.visits.table = hasPrefV ? 'mod_conversation_hub_visits' : 'visits';
      const chk = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [dbSchema.visits.table]);
      dbSchema.visits.exists = !!(chk && chk.rowCount);
    } catch {}
    try {
      // Prefer module-prefixed messages table
      const prefM = await pool.query(`SELECT to_regclass('public.mod_conversation_hub_messages') AS oid`);
      const hasPrefM = !!(prefM.rows && prefM.rows[0] && prefM.rows[0].oid);
      dbSchema.messages.table = hasPrefM ? 'mod_conversation_hub_messages' : 'messages';
      const mCols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [dbSchema.messages.table]);
      if (mCols.rowCount) dbSchema.messages.exists = true;
      for (const r of mCols.rows) {
        if (r.column_name === 'id') dbSchema.messages.idType = r.data_type;
        if (r.column_name === 'content') dbSchema.messages.hasContent = true;
        if (r.column_name === 'content_html') dbSchema.messages.hasContentHtml = true;
        if (r.column_name === 'message') dbSchema.messages.hasMessage = true;
        if (r.column_name === 'visitor_id') dbSchema.messages.hasVisitorId = true;
      }
    } catch {}
    dbSchema.loaded = true;
    log(`schema visitors=${JSON.stringify(dbSchema.visitors)} messages=${JSON.stringify(dbSchema.messages)}`);
  }
  function msgExpr() { if (dbSchema.messages.hasContent) return 'm.content'; if (dbSchema.messages.hasMessage) return 'm.message'; return 'm.message'; }
  function msgExprSelect() {
    const base = dbSchema.messages.hasContent
      ? "COALESCE(content, '')"
      : (dbSchema.messages.hasMessage ? "COALESCE(message, '')" : "COALESCE(message, '')");
    const html = dbSchema.messages.hasContentHtml ? ", COALESCE(content_html,'') AS content_html" : '';
    return { base, html };
  }
  async function ensureSchema() { if (!dbSchema.loaded) await introspectDb(); }

  async function getHubSelectedBotIds() {
    try {
      const raw = await getSetting('conversation_hub_bots');
      const j = raw ? JSON.parse(raw) : null;
      const ids = j && Array.isArray(j.ids) ? j.ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
      return ids;
    } catch {
      return [];
    }
  }

  // Resolve the Automation Suite chatbot (id_bot) for a visitor.
  // Priority: visitor.chatbot_id (from visitor_hello) → match by (id_shop,id_lang) → any selected bot.
  app.get('/api/conversation-hub/assistant/config', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    try {
      await ensureSchema();
      const visitorId = String(req.query.visitorId || '').trim();
      if (!visitorId) return res.status(400).json({ ok: false, error: 'bad_request' });

      const selectedBotIds = await getHubSelectedBotIds();
      const allowSet = selectedBotIds.length ? new Set(selectedBotIds.map(String)) : null;

      let visitorRow = null;
      if (dbSchema.visitors.exists) {
        const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
        const vr = await pool.query(`SELECT * FROM ${dbSchema.visitors.table} WHERE ${idCol} = $1 LIMIT 1`, [visitorId]);
        visitorRow = vr.rowCount ? vr.rows[0] : null;
      }

      const chatbotIdRaw = (visitorRow?.chatbot_id ?? visitorRow?.chatbotId ?? '').toString().trim();
      const idShop = toNullableInt(visitorRow?.id_shop ?? visitorRow?.shop_id ?? null);
      const idLang = toNullableInt(visitorRow?.id_lang ?? visitorRow?.id_Lang ?? visitorRow?.lang_id ?? null);

      const hasBots = await pool.query(`SELECT to_regclass('public.mod_automation_suite_chatbots') AS oid`).catch(() => null);
      if (!hasBots?.rows?.[0]?.oid) {
        return res.json({ ok: true, chatbot_id: null, bot_behavior: 'manual', id_shop: idShop, id_lang: idLang });
      }

      const tryBot = async (id_bot) => {
        const key = String(id_bot || '').trim();
        if (!key) return null;
        if (allowSet && allowSet.size && !allowSet.has(key)) return null;
        try {
          const r = await pool.query(
            `SELECT id_bot, bot_behavior, prompt_config_id, id_shop, id_lang
               FROM public.mod_automation_suite_chatbots
              WHERE id_bot = $1
              LIMIT 1`,
            [key]
          );
          return r.rowCount ? r.rows[0] : null;
        } catch {
          return null;
        }
      };

      let bot = null;
      if (chatbotIdRaw) bot = await tryBot(chatbotIdRaw);

      if (!bot && idShop != null && idLang != null) {
        try {
          const params = [Number(idShop), Number(idLang)];
          const allowWhere = (allowSet && allowSet.size) ? (params.push(Array.from(allowSet)), ` AND id_bot = ANY($${params.length}::text[])`) : '';
          const r = await pool.query(
            `SELECT id_bot, bot_behavior, prompt_config_id, id_shop, id_lang
               FROM public.mod_automation_suite_chatbots
              WHERE id_shop = $1 AND id_lang = $2${allowWhere}
              ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
              LIMIT 1`,
            params
          );
          bot = r.rowCount ? r.rows[0] : null;
        } catch {}
      }

      if (!bot && allowSet && allowSet.size) {
        try {
          const arr = Array.from(allowSet);
          const r = await pool.query(
            `SELECT id_bot, bot_behavior, prompt_config_id, id_shop, id_lang
               FROM public.mod_automation_suite_chatbots
              WHERE id_bot = ANY($1::text[])
              ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
              LIMIT 1`,
            [arr]
          );
          bot = r.rowCount ? r.rows[0] : null;
        } catch {}
      }

      const botId = bot?.id_bot ? String(bot.id_bot) : null;
      const behavior = (bot?.bot_behavior != null ? String(bot.bot_behavior) : '').trim() || 'manual';
      res.json({
        ok: true,
        chatbot_id: botId,
        bot_behavior: behavior,
        prompt_config_id: bot?.prompt_config_id || null,
        id_shop: bot?.id_shop ?? idShop ?? null,
        id_lang: bot?.id_lang ?? idLang ?? null,
      });
    } catch (e) {
      log(`GET /api/conversation-hub/assistant/config error: ${e.message}`);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // Hub bot mapping table (as in legacy)
  async function ensureHubBotMapTable() {
    if (!pool) return;
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS hub_bot_map (
        assistant_id_ext TEXT PRIMARY KEY,
        id_bot TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )`);
    } catch {}
  }

  // List latest conversation per visitor
  app.get('/api/conversation-hub/conversations', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'db_unavailable' });
    try {
      await ensureSchema();
      const days = Math.max(0, Number(req.query.days || 30));
      const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 500)));
      const params = [];
      let where = '';
      if (days > 0) { params.push(days); where = `WHERE m.created_at >= NOW() - ($1::int || ' days')::interval`; }
      let sql;
      if (dbSchema.visitors.exists) {
        sql = `SELECT * FROM (SELECT DISTINCT ON (m.visitor_id) m.visitor_id, m.sender, ${msgExpr()} AS content, m.created_at, m.created_at AS last_seen, v.archived, v.conversation_status FROM ${dbSchema.messages.table} m LEFT JOIN ${dbSchema.visitors.table} v ON v.${dbSchema.visitors.idCol || 'visitor_id'} = m.visitor_id ${where} ORDER BY m.visitor_id, m.created_at DESC) AS t ORDER BY t.last_seen DESC LIMIT ${limit}`;
      } else {
        sql = `SELECT * FROM (SELECT DISTINCT ON (m.visitor_id) m.visitor_id, m.sender, ${msgExpr()} AS content, m.created_at, m.created_at AS last_seen FROM ${dbSchema.messages.table} m ${where} ORDER BY m.visitor_id, m.created_at DESC) AS t ORDER BY t.last_seen DESC LIMIT ${limit}`;
      }
      const out = await pool.query(sql, params);
      res.json(out.rows || []);
    } catch (e) { log(`GET /api/conversation-hub/conversations error: ${e.message}`); res.status(500).json({ error: 'server_error' }); }
  });

  // Lightweight client helper to emit visitor_hello with page context
  // Usage on any website: <script src="/conversation-hub/widget/hello.js"></script>
  function patchConversationHubHelloWidgetJs(js) {
    if (!js || typeof js !== 'string') return js;
    let out = js;

    // 1) Add stable identity support for logged-in Presta customers (survives localStorage clears).
    const ensureSocketMarker = '\n\n  function ensureSocket(cb) {';
    if (out.includes(ensureSocketMarker) && !out.includes('function computeVisitorId(')) {
      const injection = `\n\n  function guestVisitorId() {\n    try {\n      // Prefer a dedicated guest key (so logged-in identity can be stable and separate)\n      const g = localStorage.getItem('chub_vid_guest');\n      if (g) return g;\n      // Back-compat: some installs used chub_vid as the only key\n      const legacy = localStorage.getItem('chub_vid');\n      if (legacy) {\n        try { localStorage.setItem('chub_vid_guest', legacy); } catch {}\n        return legacy;\n      }\n      const id = uuidv4();\n      try { localStorage.setItem('chub_vid_guest', id); } catch {}\n      try { localStorage.setItem('chub_vid', id); } catch {}\n      return id;\n    } catch {\n      return uuidv4();\n    }\n  }\n\n  function computeVisitorId(ctx) {\n    try {\n      const idShop = (ctx && ctx.id_shop != null) ? String(ctx.id_shop).trim() : '';\n      const customerId = (ctx && ctx.customer_id != null) ? String(ctx.customer_id).trim() : '';\n      const customerEmail = (ctx && ctx.customer_email != null) ? String(ctx.customer_email).trim() : '';\n      const customerLogged = Boolean(ctx && ctx.customer_logged);\n      if (idShop && customerId && customerId !== '0' && (customerLogged || customerEmail)) {\n        return 'ps:' + idShop + ':c:' + customerId;\n      }\n    } catch {}\n    return guestVisitorId();\n  }\n`;
      out = out.replace(ensureSocketMarker, injection + ensureSocketMarker);
    }

    // 2) Compute ctx once and use computeVisitorId(ctx) for visitorId.
    const visitorIdLine =
      "\n     const base = {\n       visitorId: (localStorage.getItem('chub_vid') || (function(){ const id = uuidv4(); try{ localStorage.setItem('chub_vid', id); }catch{} return id; })()),\n";
    if (out.includes(visitorIdLine) && out.includes('function payload()')) {
      const replacement =
        '\n     let ctx = {};\n     try { ctx = getCtx() || {}; } catch { ctx = {}; }\n     const base = {\n       visitorId: computeVisitorId(ctx),\n';
      out = out.replace(visitorIdLine, replacement);
    }

    // 3) Reuse the ctx variable in the merge loop (avoid calling getCtx twice).
    out = out.replace('\n       const ctx = getCtx();\n', '\n');

    // 4) Emit richer storefront events (presence/context/page changes) without spamming visitor_hello.
    const connectBlock =
      "\n       const emitHello = () => { try { sock.emit('visitor_hello', payload()); } catch {} };\n       if (sock.connected) emitHello();\n       sock.on('connect', emitHello);\n       ['visibilitychange','popstate','hashchange'].forEach((ev) => window.addEventListener(ev, emitHello));\n       window.addEventListener('pageshow', emitHello);\n";
    if (out.includes(connectBlock)) {
      const newBlock =
        "\n       const emitHello = () => { try { sock.emit('visitor_hello', payload()); } catch {} };\n       const emitOnline = (heartbeat) => { try { const p = payload(); if (heartbeat) p.__heartbeat = 1; sock.emit('visitor_online', p); } catch {} };\n       const emitContext = () => { try { sock.emit('visitor_context', payload()); } catch {} };\n       const emitPage = () => { try { sock.emit('visitor_change_page', payload()); } catch {} };\n\n       const onConnect = () => { emitOnline(false); emitHello(); emitContext(); };\n       if (sock.connected) onConnect();\n       sock.on('connect', onConnect);\n\n       let lastUrl = '';\n       let pageTimer = null;\n       const schedulePage = () => {\n         try { if (pageTimer) clearTimeout(pageTimer); } catch {}\n         pageTimer = setTimeout(() => {\n           try {\n             const url = location.href;\n             if (url && url !== lastUrl) { lastUrl = url; emitPage(); }\n           } catch {}\n         }, 150);\n       };\n\n       ['popstate','hashchange'].forEach((ev) => window.addEventListener(ev, schedulePage));\n       window.addEventListener('pageshow', schedulePage);\n       try {\n         const _ps = history.pushState;\n         history.pushState = function() { try { return _ps.apply(this, arguments); } finally { schedulePage(); } };\n         const _rs = history.replaceState;\n         history.replaceState = function() { try { return _rs.apply(this, arguments); } finally { schedulePage(); } };\n       } catch {}\n\n       window.addEventListener('visibilitychange', () => { try { if (!document.hidden) emitOnline(true); } catch {} });\n       try { setInterval(() => emitOnline(true), 45000); } catch {}\n\n       try {\n         window.__CHUB = window.__CHUB || {};\n         window.__CHUB.emitChatOpened = () => { try { sock.emit('chat_opened', payload()); } catch {} };\n         window.__CHUB.emitChatStarted = () => { try { sock.emit('chat_started', payload()); } catch {} };\n       } catch {}\n";
      out = out.replace(connectBlock, newBlock);
    }

    return out;
  }

  try {
    app.get('/conversation-hub/widget/hello.js', (req, res) => {
      const base = (req.query && (req.query.base || req.query.BASE)) || (req.protocol + '://' + req.get('host'));
      const js = `(() => {\n\n  function uuidv4() {\n    try { return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); } catch {\n      const s = Date.now().toString(16) + Math.random().toString(16).slice(2);\n      return s.slice(0,8)+'-'+s.slice(8,12)+'-4'+s.slice(13,16)+'-a'+s.slice(17,20)+'-'+s.slice(20,32);\n    }\n  }\n\n  function ensureSocket(cb) {\n    if (window.io) return cb(window.io);\n    const s = document.createElement('script');\n    s.src = 'https://cdn.socket.io/4.8.1/socket.io.min.js';\n    s.async = true;\n    s.onload = () => cb(window.io);\n    document.head.appendChild(s);\n  }\n\n  function readUtm() {\n    const out = {};\n    try {\n      const qs = location.search || '';\n      if (!qs) return out;\n      const sp = new URLSearchParams(qs);\n      const keys = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];\n      for (const k of keys) {\n        const v = (sp.get(k) || '').toString().trim();\n        if (v) out[k] = v;\n      }\n    } catch {}\n    return out;\n  }\n\n   function readMeta(name) {\n     try {\n       const el = document.querySelector('meta[name=\"' + name + '\"]');\n       return el ? (el.getAttribute('content') || '') : '';\n     } catch { return ''; }\n   }\n\n   function toNum(v) {\n     const n = Number(v);\n     return Number.isFinite(n) ? n : null;\n   }\n\n   function getCtx() {\n     // Optional integration surface for Presta (or any website):\n     //   window.CONVERSATION_HUB_CTX = { id_shop, id_lang, shop_name, lang_iso, customer_email, ... }\n     // Also supported: window.CHUB_CTX / window.__CHUB_CTX and HTML <meta name=\"chub:id_shop\" content=\"...\">.\n     const w = window;\n     const raw = w.CONVERSATION_HUB_CTX || w.CHUB_CTX || w.__CHUB_CTX || w.PRESTA_CTX || w.__PRESTA_CTX || null;\n     const ds = (document.documentElement && document.documentElement.dataset) ? document.documentElement.dataset : {};\n     const ctx = {};\n\n    // Best-effort PrestaShop globals (for stores that don't inject CONVERSATION_HUB_CTX)\n    try {\n      const ps = w.prestashop || w.Prestashop || null;\n      if (ps && typeof ps === 'object') {\n        const psShop = ps.shop || {};\n        const psLang = ps.language || {};\n        const psCur = ps.currency || {};\n        const psCustomer = ps.customer || {};\n        const psCart = ps.cart || {};\n\n        const idShopPs = toNum(psShop.id || psShop.id_shop || ps.id_shop || '');\n        const idLangPs = toNum(psLang.id || psLang.id_lang || ps.id_lang || '');\n        if (ctx.id_shop == null && idShopPs != null) ctx.id_shop = idShopPs;\n        if (ctx.id_lang == null && idLangPs != null) ctx.id_lang = idLangPs;\n\n        if (!ctx.shop_name) {\n          const v = (psShop.name || psShop.shop_name || ps.shop_name || '').toString().trim();\n          if (v) ctx.shop_name = v;\n        }\n        if (!ctx.lang_iso) {\n          const v = (psLang.iso_code || psLang.iso || ps.lang_iso || '').toString().trim();\n          if (v) ctx.lang_iso = v;\n        }\n        if (!ctx.lang_name) {\n          const v = (psLang.name || ps.lang_name || '').toString().trim();\n          if (v) ctx.lang_name = v;\n        }\n        if (!ctx.currency) {\n          const v = (psCur.iso_code || psCur.iso || ps.currency || '').toString().trim();\n          if (v) ctx.currency = v;\n        }\n        if (ctx.cart_total == null) {\n          let total = null;\n          try { total = psCart.totals && psCart.totals.total && (psCart.totals.total.amount != null ? psCart.totals.total.amount : psCart.totals.total.value); } catch {}\n          try { if (total == null) total = psCart.totals && psCart.totals.total_including_tax && (psCart.totals.total_including_tax.amount != null ? psCart.totals.total_including_tax.amount : psCart.totals.total_including_tax.value); } catch {}\n          const n = Number(total);\n          if (Number.isFinite(n)) ctx.cart_total = n;\n        }\n        if (ctx.customer_logged == null) {\n          if (psCustomer.is_logged != null) ctx.customer_logged = Boolean(psCustomer.is_logged);\n          else if (psCustomer.isLogged != null) ctx.customer_logged = Boolean(psCustomer.isLogged);\n        }\n        if (!ctx.customer_id) {\n          const v = (psCustomer.id || psCustomer.id_customer || '').toString().trim();\n          if (v) ctx.customer_id = v;\n        }\n        if (!ctx.customer_email) {\n          const v = (psCustomer.email || '').toString().trim();\n          if (v) ctx.customer_email = v;\n        }\n        if (!ctx.customer_firstname) {\n          const v = (psCustomer.firstname || psCustomer.first_name || '').toString().trim();\n          if (v) ctx.customer_firstname = v;\n        }\n        if (!ctx.customer_lastname) {\n          const v = (psCustomer.lastname || psCustomer.last_name || '').toString().trim();\n          if (v) ctx.customer_lastname = v;\n        }\n      }\n    } catch {}\n\n     const idShop = toNum((raw && (raw.id_shop ?? raw.idShop)) ?? ds.chubIdShop ?? readMeta('chub:id_shop') ?? '');\n     const idLang = toNum((raw && (raw.id_lang ?? raw.idLang ?? raw.id_Lang)) ?? ds.chubIdLang ?? readMeta('chub:id_lang') ?? '');\n     if (idShop != null) ctx.id_shop = idShop;\n     if (idLang != null) ctx.id_lang = idLang;\n\n     const shopName = (raw && (raw.shop_name ?? raw.shopName)) ?? ds.chubShopName ?? readMeta('chub:shop_name') ?? '';\n     const langIso = (raw && (raw.lang_iso ?? raw.langIso ?? raw.shop_lang_iso)) ?? ds.chubLangIso ?? readMeta('chub:lang_iso') ?? '';\n    const langName = (raw && (raw.lang_name ?? raw.langName ?? raw.shop_lang_name)) ?? ds.chubLangName ?? readMeta('chub:lang_name') ?? '';\n    const currency = (raw && (raw.currency ?? raw.currency_iso ?? raw.currencyIso)) ?? ds.chubCurrency ?? readMeta('chub:currency') ?? '';\n    const cartTotal = (raw && (raw.cart_total ?? raw.cartTotal)) ?? ds.chubCartTotal ?? readMeta('chub:cart_total') ?? '';\n     const chatbotId = (raw && (raw.chatbot_id ?? raw.chatbotId)) ?? ds.chubChatbotId ?? readMeta('chub:chatbot_id') ?? '';\n     if (shopName) ctx.shop_name = String(shopName);\n     if (langIso) ctx.lang_iso = String(langIso);\n    if (langName) ctx.lang_name = String(langName);\n    if (currency) ctx.currency = String(currency);\n    {\n      const n = Number(cartTotal);\n      if (Number.isFinite(n)) ctx.cart_total = n;\n    }\n     if (chatbotId) ctx.chatbot_id = String(chatbotId);\n\n     // Optional customer context (best-effort)\n     const email = (raw && (raw.customer_email ?? raw.email)) ?? ds.chubCustomerEmail ?? readMeta('chub:customer_email') ?? '';\n     const firstname = (raw && (raw.customer_firstname ?? raw.firstname)) ?? ds.chubCustomerFirstname ?? readMeta('chub:customer_firstname') ?? '';\n     const lastname = (raw && (raw.customer_lastname ?? raw.lastname)) ?? ds.chubCustomerLastname ?? readMeta('chub:customer_lastname') ?? '';\n    const customerLogged = (raw && (raw.customer_logged ?? raw.customerLogged)) ?? ds.chubCustomerLogged ?? readMeta('chub:customer_logged') ?? '';\n    const customerId = (raw && (raw.customer_id ?? raw.customerId)) ?? ds.chubCustomerId ?? readMeta('chub:customer_id') ?? '';\n     if (email) ctx.customer_email = String(email);\n     if (firstname) ctx.customer_firstname = String(firstname);\n     if (lastname) ctx.customer_lastname = String(lastname);\n    if (customerId) ctx.customer_id = String(customerId);\n    if (customerLogged !== '') ctx.customer_logged = (customerLogged === true || customerLogged === 'true' || customerLogged === 1 || customerLogged === '1');\n\n     return ctx;\n   }\n\n   function payload() {\n     const tz = (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || '' ;\n     const base = {\n       visitorId: (localStorage.getItem('chub_vid') || (function(){ const id = uuidv4(); try{ localStorage.setItem('chub_vid', id); }catch{} return id; })()),\n       page_url: location.href,\n       current_url: location.href,\n       title: document.title || '',\n       referrer: document.referrer || '',\n       origin: location.origin || '',\n       language: (navigator.language || navigator.userLanguage || '').toString(),\n       screen_w: (window.screen && (screen.width || screen.availWidth)) || null,\n       screen_h: (window.screen && (screen.height || screen.availHeight)) || null,\n       screen_dpr: (window.devicePixelRatio || 1),\n       time_zone: tz\n     };\n    try {\n      const utm = readUtm();\n      for (const k in utm) {\n        if (utm[k] == null || utm[k] === '') continue;\n        base[k] = utm[k];\n      }\n    } catch {}\n     try {\n       const ctx = getCtx();\n       for (const k in ctx) {\n         if (ctx[k] == null || ctx[k] === '') continue;\n         base[k] = ctx[k];\n       }\n     } catch {}\n     return base;\n   }\n\n   ensureSocket((io) => {\n     try {\n       const sock = io('${base.replace(/\\/g,'\\\\').replace(/`/g,'\\`')}', { path: '/socket' });\n       const emitHello = () => { try { sock.emit('visitor_hello', payload()); } catch {} };\n       if (sock.connected) emitHello();\n       sock.on('connect', emitHello);\n       ['visibilitychange','popstate','hashchange'].forEach((ev) => window.addEventListener(ev, emitHello));\n       window.addEventListener('pageshow', emitHello);\n     } catch {}\n   });\n\n })();`;
      try { res.setHeader('Content-Type', 'application/javascript; charset=utf-8'); } catch {}
      res.send(patchConversationHubHelloWidgetJs(js));
    });
  } catch {}

  // Full message history for one visitor
  app.get('/api/conversation-hub/conversations/:visitorId/messages', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'db_unavailable' });
    try {
      await ensureSchema();
      const visitorId = String(req.params.visitorId || '').trim();
      const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));
      const scope = String(req.query.scope || '').trim().toLowerCase();
      if (!visitorId) return res.json([]);
      const { base, html } = msgExprSelect();
      // Scope='email': return all messages across all visitor_ids sharing the same customer_email,
      // but alias visitor_id to the requested visitorId so the UI shows a single thread.
      if (scope === 'email' && dbSchema.visitors.exists) {
        try {
          const vCols = dbSchema.visitors.columns || [];
          const hasCustomerEmail = vCols.includes('customer_email');
          const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
          const where = (dbSchema.visitors.hasVisitorIdCol && dbSchema.visitors.hasIdCol)
            ? '(visitor_id = $1 OR id = $1)'
            : `${idCol} = $1`;
          if (hasCustomerEmail && idCol) {
            const vr = await pool.query(`SELECT customer_email FROM ${dbSchema.visitors.table} WHERE ${where} LIMIT 1`, [visitorId]);
            const email = (vr.rows?.[0]?.customer_email || '').toString().trim();
            if (email) {
              const idsRes = await pool.query(
                `SELECT ${idCol} AS visitor_id
                   FROM ${dbSchema.visitors.table}
                  WHERE lower(customer_email) = lower($1)
                    AND ${idCol} IS NOT NULL`,
                [email]
              );
              const ids = (idsRes.rows || []).map((r) => String(r.visitor_id || '').trim()).filter(Boolean);
              if (ids.length) {
                const out = await pool.query(
                  `SELECT id,
                          $2::text AS visitor_id,
                          visitor_id AS visitor_id_src,
                          sender,
                          ${base} AS content,
                          agent_id,
                          created_at${html}
                     FROM ${dbSchema.messages.table}
                    WHERE visitor_id = ANY($1::text[])
                    ORDER BY created_at ASC
                    LIMIT ${limit}`,
                  [ids, visitorId]
                );
                return res.json(out.rows || []);
              }
            }
          }
        } catch {}
      }

      const out = await pool.query(
        `SELECT id, visitor_id, sender, ${base} AS content, agent_id, created_at${html}
           FROM ${dbSchema.messages.table}
          WHERE visitor_id = $1
          ORDER BY created_at ASC
          LIMIT ${limit}`,
        [visitorId]
      );
      res.json(out.rows || []);
    } catch (e) { log(`GET /api/conversation-hub/conversations/:id/messages error: ${e.message}`); res.status(500).json({ error: 'server_error' }); }
  });

  // Recent visitors (fallback to messages when no visitors table)
  app.get('/api/conversation-hub/visitors/recent', async (_req, res) => {
    if (!pool) return res.status(503).json({ error: 'db_unavailable' });
    try {
      await ensureSchema();
      if (dbSchema.visitors.exists) {
        const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
        const cols = dbSchema.visitors.columns || [];
        const extra = [];
        const add = (c) => { if (cols.includes(c)) extra.push(c); };
        // Customer identity fields (for grouping conversations by person)
        add('customer_logged');
        add('customer_id');
        add('customer_email');
        add('customer_firstname');
        add('customer_lastname');
        // Shop/lang context
        add('id_shop');
        add('shop_name');
        add('id_lang');
        add('lang_iso');
        // Navigation context
        add('current_url');
        add('page_url');
        // Analytics
        add('country_code');
        add('city');
        add('postcode');
        const extraSql = extra.length ? `, ${extra.join(', ')}` : '';
        const sql = `SELECT ${idCol} AS visitor_id, archived, conversation_status, last_seen, created_at, page_url_last, title, referrer, origin${extraSql} FROM ${dbSchema.visitors.table} ORDER BY COALESCE(last_seen, created_at) DESC LIMIT 200`;
        const out = await pool.query(sql);
        return res.json(out.rows || []);
      }
      const out = await pool.query(`SELECT DISTINCT ON (visitor_id) visitor_id, sender, ${msgExpr()} AS content, created_at AS last_seen FROM messages ORDER BY visitor_id, created_at DESC LIMIT 200`);
      res.json(out.rows || []);
    } catch (e) { log(`GET /api/conversation-hub/visitors/recent error: ${e.message}`); res.status(500).json({ error: 'server_error' }); }
  });

  // One visitor info
  app.get('/api/conversation-hub/visitors/:visitorId', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'db_unavailable' });
    try {
      await ensureSchema();
      const visitorId = String(req.params.visitorId || '').trim();
      if (!visitorId || !dbSchema.visitors.exists) return res.status(404).json({ error: 'not_found' });
      const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
      const out = await pool.query(`SELECT * FROM ${dbSchema.visitors.table} WHERE ${idCol} = $1 LIMIT 1`, [visitorId]);
      if (!out.rowCount) return res.status(404).json({ error: 'not_found' });
      const row = out.rows[0] || {};
      try {
        const needsGeo = !row.country_code || (!row.city && !row.postcode);
        const ip = row.ip || null;
        if (needsGeo && ip) {
          const geo = await geoLookup(ip);
          if (geo && (geo.country_code || geo.city || geo.postcode)) {
            // Best-effort persist; columns exist on most installs but keep it safe.
            try {
              await pool.query(
                `UPDATE ${dbSchema.visitors.table}
                    SET country_code = COALESCE($2, country_code),
                        city = COALESCE($3, city),
                        postcode = COALESCE($4, postcode)
                  WHERE ${idCol} = $1`,
                [visitorId, geo.country_code, geo.city, geo.postcode]
              );
              row.country_code = row.country_code || geo.country_code;
              row.city = row.city || geo.city;
              row.postcode = row.postcode || geo.postcode;
            } catch {}
          }
        }
      } catch {}
      res.json(row);
    } catch (e) { log(`GET /api/conversation-hub/visitors/:id error: ${e.message}`); res.status(500).json({ error: 'server_error' }); }
  });

  // Archive/unarchive a visitor conversation
  app.post('/api/conversation-hub/visitors/:visitorId/archive', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'db_unavailable' });
    try {
      await ensureSchema();
      const visitorId = String(req.params.visitorId || '').trim();
      if (!visitorId || !dbSchema.visitors.exists) return res.status(404).json({ error: 'not_found' });
      const archived = Boolean(req.body?.archived ?? true);
      const status = archived ? 'archived' : 'open';
      const where = (dbSchema.visitors.hasVisitorIdCol && dbSchema.visitors.hasIdCol)
        ? '(visitor_id = $1 OR id = $1)'
        : (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id = $1' : (dbSchema.visitors.hasIdCol ? 'id = $1' : `${dbSchema.visitors.idCol || 'visitor_id'} = $1`));
      const r = await pool.query(`UPDATE ${dbSchema.visitors.table} SET archived = $2, conversation_status = $3 WHERE ${where}`, [visitorId, archived, status]);
      if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
      try {
        if (io) {
          io.to('agents').emit('visitor_update', {
            visitorId,
            archived,
            conversation_status: status,
            last_action: archived ? 'archived' : 'unarchived',
            last_action_at: new Date().toISOString(),
          });
        }
      } catch {}
      res.json({ ok: true, archived, rows: r.rowCount });
    } catch (e) { log(`POST /api/conversation-hub/visitors/:id/archive error: ${e.message}`); res.status(500).json({ error: 'server_error' }); }
  });

  // Recent visits for one visitor
  app.get('/api/conversation-hub/visitors/:visitorId/visits', async (req, res) => {
    if (!pool) return res.status(503).json({ error: 'db_unavailable' });
    try {
      const visitorId = String(req.params.visitorId || '').trim();
      if (!visitorId) return res.json([]);
      const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
      const scope = String(req.query.scope || '').trim().toLowerCase();
      const visitsTable = dbSchema.visits.table || 'visits';
      if (scope === 'email' && dbSchema.visitors.exists) {
        try {
          const vCols = dbSchema.visitors.columns || [];
          const hasCustomerEmail = vCols.includes('customer_email');
          const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
          const where = (dbSchema.visitors.hasVisitorIdCol && dbSchema.visitors.hasIdCol)
            ? '(visitor_id = $1 OR id = $1)'
            : `${idCol} = $1`;
          if (hasCustomerEmail && idCol) {
            const vr = await pool.query(`SELECT customer_email FROM ${dbSchema.visitors.table} WHERE ${where} LIMIT 1`, [visitorId]);
            const email = (vr.rows?.[0]?.customer_email || '').toString().trim();
            if (email) {
              const idsRes = await pool.query(
                `SELECT ${idCol} AS visitor_id
                   FROM ${dbSchema.visitors.table}
                  WHERE lower(customer_email) = lower($1)
                    AND ${idCol} IS NOT NULL`,
                [email]
              );
              const ids = (idsRes.rows || []).map((r) => String(r.visitor_id || '').trim()).filter(Boolean);
              if (ids.length) {
                const out = await pool.query(
                  `SELECT $2::text AS visitor_id,
                          visitor_id AS visitor_id_src,
                          page_url, title, origin, referrer,
                          utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                          occurred_at
                     FROM ${visitsTable}
                    WHERE visitor_id = ANY($1::text[])
                    ORDER BY occurred_at DESC
                    LIMIT ${limit}`,
                  [ids, visitorId]
                );
                return res.json(out.rows || []);
              }
            }
          }
        } catch {}
      }

      const out = await pool.query(
        `SELECT visitor_id, page_url, title, origin, referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content, occurred_at
           FROM ${visitsTable}
          WHERE visitor_id = $1
          ORDER BY occurred_at DESC
          LIMIT ${limit}`,
        [visitorId]
      );
      res.json(out.rows || []);
    } catch (e) { log(`GET /api/conversation-hub/visitors/:id/visits error: ${e.message}`); res.status(500).json({ error: 'server_error' }); }
  });

  // ---------------- Admin cleanup (irreversible) ----------------
  // These endpoints are used by the Settings panel "Danger zone".
  // All require admin auth.

  function normScope(v) {
    const s = String(v || '').trim().toLowerCase();
    return (s === 'email') ? 'email' : 'visitor';
  }

  async function visitorIdsByScope(visitorId, scope) {
    const vid = String(visitorId || '').trim();
    if (!vid) return [];
    if (scope !== 'email') return [vid];
    if (!dbSchema.visitors.exists) return [vid];
    const cols = dbSchema.visitors.columns || [];
    if (!cols.includes('customer_email')) return [vid];
    const idCol = dbSchema.visitors.idCol || (dbSchema.visitors.hasVisitorIdCol ? 'visitor_id' : 'id');
    if (!idCol) return [vid];
    const where = (dbSchema.visitors.hasVisitorIdCol && dbSchema.visitors.hasIdCol)
      ? '(visitor_id = $1 OR id = $1)'
      : `${idCol} = $1`;
    const vr = await pool.query(`SELECT customer_email FROM ${dbSchema.visitors.table} WHERE ${where} LIMIT 1`, [vid]);
    const email = (vr.rows?.[0]?.customer_email || '').toString().trim();
    if (!email) return [vid];
    const idsRes = await pool.query(
      `SELECT ${idCol} AS visitor_id
         FROM ${dbSchema.visitors.table}
        WHERE lower(customer_email) = lower($1)
          AND ${idCol} IS NOT NULL`,
      [email]
    );
    const ids = (idsRes.rows || []).map((r) => String(r.visitor_id || '').trim()).filter(Boolean);
    return ids.length ? ids : [vid];
  }

  app.post('/api/conversation-hub/admin/delete', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    if (!requireAdmin(req, res)) return;
    try {
      await ensureSchema();
      const b = req.body || {};
      const visitorId = String(b.visitorId || b.visitor_id || '').trim();
      const scope = normScope(b.scope);
      const what = (b.what && typeof b.what === 'object') ? b.what : {};
      const delMessages = what.messages !== false && what.messages != null ? Boolean(what.messages) : false;
      const delVisits = what.visits !== false && what.visits != null ? Boolean(what.visits) : false;
      const delVisitor = what.visitor !== false && what.visitor != null ? Boolean(what.visitor) : false;
      if (!visitorId) return res.status(400).json({ ok: false, error: 'bad_request', message: 'visitorId required' });

      const ids = await visitorIdsByScope(visitorId, scope);
      if (!ids.length) return res.json({ ok: true, scope, ids: [], deleted: { messages: 0, visits: 0, visitors: 0 } });

      const deleted = { messages: 0, visits: 0, visitors: 0 };
      await pool.query('BEGIN');
      try {
        if (delMessages && dbSchema.messages.exists && dbSchema.messages.hasVisitorId) {
          const r = await pool.query(`DELETE FROM ${dbSchema.messages.table} WHERE visitor_id = ANY($1::text[])`, [ids]).catch(async () => {
            // Fallback for older schemas where visitor_id may not be text
            const ints = ids.map((x) => Number(x)).filter((n) => Number.isFinite(n));
            return pool.query(`DELETE FROM ${dbSchema.messages.table} WHERE visitor_id = ANY($1::int[])`, [ints]);
          });
          deleted.messages = Number(r?.rowCount || 0);
        }
        if (delVisits && dbSchema.visits.exists) {
          const r = await pool.query(`DELETE FROM ${dbSchema.visits.table} WHERE visitor_id = ANY($1::text[])`, [ids]).catch(async () => {
            const ints = ids.map((x) => Number(x)).filter((n) => Number.isFinite(n));
            return pool.query(`DELETE FROM ${dbSchema.visits.table} WHERE visitor_id = ANY($1::int[])`, [ints]);
          });
          deleted.visits = Number(r?.rowCount || 0);
        }
        if (delVisitor && dbSchema.visitors.exists && dbSchema.visitors.idCol) {
          const idCol = dbSchema.visitors.idCol;
          // If PK is numeric on some installs, try int[] fallback.
          const r = await pool.query(`DELETE FROM ${dbSchema.visitors.table} WHERE ${idCol} = ANY($1::text[])`, [ids]).catch(async () => {
            const ints = ids.map((x) => Number(x)).filter((n) => Number.isFinite(n));
            return pool.query(`DELETE FROM ${dbSchema.visitors.table} WHERE ${idCol} = ANY($1::int[])`, [ints]);
          });
          deleted.visitors = Number(r?.rowCount || 0);
        }
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }
      res.json({ ok: true, scope, ids, deleted });
    } catch (e) {
      log(`POST /api/conversation-hub/admin/delete error: ${e.message}`);
      try { await pool.query('ROLLBACK'); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/conversation-hub/admin/truncate', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    if (!requireAdmin(req, res)) return;
    try {
      await ensureSchema();
      const b = req.body || {};
      const whatRaw = Array.isArray(b.what) ? b.what : [b.what];
      const what = new Set(whatRaw.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
      const deleted = { messages: 0, visits: 0, visitors: 0 };
      if (!what.size) return res.status(400).json({ ok: false, error: 'bad_request', message: 'what is required' });

      const tables = [];
      const wantedKeys = [];
      if (what.has('messages') && dbSchema.messages.exists) { tables.push(dbSchema.messages.table); wantedKeys.push('messages'); }
      if (what.has('visits') && dbSchema.visits.exists) { tables.push(dbSchema.visits.table); wantedKeys.push('visits'); }
      if (what.has('visitors') && dbSchema.visitors.exists) { tables.push(dbSchema.visitors.table); wantedKeys.push('visitors'); }
      if (!tables.length) return res.json({ ok: true, deleted, truncated_tables: [], note: 'no_matching_tables' });

      await pool.query('BEGIN');
      try {
        const onlyVisitors = wantedKeys.length === 1 && wantedKeys[0] === 'visitors';
        const allowCascade = onlyVisitors || wantedKeys.includes('visitors');
        let cascadeUsed = false;

        const truncateSql = (cascade) => `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY${cascade ? ' CASCADE' : ''}`;

        try {
          await pool.query(truncateSql(false));
        } catch (e) {
          const msg = String(e?.message || '');
          const looksLikeFk = /foreign key|referenced in a foreign key|cannot truncate/i.test(msg);
          if (allowCascade && looksLikeFk) {
            cascadeUsed = true;
            await pool.query(truncateSql(true));
          } else {
            throw e;
          }
        }

        if (wantedKeys.includes('messages')) deleted.messages = 1;
        if (wantedKeys.includes('visits')) deleted.visits = 1;
        if (wantedKeys.includes('visitors')) deleted.visitors = 1;
        await pool.query('COMMIT');
        return res.json({ ok: true, deleted, truncated_tables: tables, cascade_used: cascadeUsed });
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }
    } catch (e) {
      const msg = String(e?.message || '');
      log(`POST /api/conversation-hub/admin/truncate error: ${msg}`);
      try { await pool.query('ROLLBACK'); } catch {}
      res.status(500).json({
        ok: false,
        error: 'server_error',
        message: msg || 'truncate_failed',
        hint: 'If this is a foreign-key constraint, use Truncate ALL or Truncate visitors (which may cascade).',
      });
    }
  });

  app.post('/api/conversation-hub/admin/purge', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    if (!requireAdmin(req, res)) return;
    try {
      await ensureSchema();
      const b = req.body || {};
      const days = Number(b.olderThanDays ?? b.days ?? 0);
      const olderThanDays = Number.isFinite(days) ? Math.max(1, Math.min(3650, Math.floor(days))) : 0;
      if (!olderThanDays) return res.status(400).json({ ok: false, error: 'bad_request', message: 'olderThanDays required' });
      const whatRaw = Array.isArray(b.what) ? b.what : [b.what];
      const what = new Set(whatRaw.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
      const deleted = { messages: 0, visits: 0 };

      async function hasColumn(tableName, colName) {
        try {
          const r = await pool.query(
            `SELECT 1
               FROM information_schema.columns
              WHERE table_schema='public'
                AND table_name=$1
                AND column_name=$2
              LIMIT 1`,
            [String(tableName).replace(/^public\./, ''), String(colName)]
          );
          return !!r.rowCount;
        } catch {
          return false;
        }
      }

      await pool.query('BEGIN');
      try {
        if (what.has('messages') && dbSchema.messages.exists) {
          const hasCreated = await hasColumn(dbSchema.messages.table, 'created_at');
          if (hasCreated) {
            const r = await pool.query(
              `DELETE FROM ${dbSchema.messages.table}
                WHERE created_at < NOW() - ($1::int || ' days')::interval`,
              [olderThanDays]
            );
            deleted.messages = Number(r?.rowCount || 0);
          }
        }
        if (what.has('visits') && dbSchema.visits.exists) {
          const hasOccurred = await hasColumn(dbSchema.visits.table, 'occurred_at');
          if (hasOccurred) {
            const r = await pool.query(
              `DELETE FROM ${dbSchema.visits.table}
                WHERE occurred_at < NOW() - ($1::int || ' days')::interval`,
              [olderThanDays]
            );
            deleted.visits = Number(r?.rowCount || 0);
          }
        }
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }
      res.json({ ok: true, olderThanDays, deleted });
    } catch (e) {
      log(`POST /api/conversation-hub/admin/purge error: ${e.message}`);
      try { await pool.query('ROLLBACK'); } catch {}
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/conversation-hub/admin/payload-log/clear', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    if (!requireAdmin(req, res)) return;
    try {
      // This table is optional; keep it safe.
      const chk = await pool.query(`SELECT to_regclass('public.mod_conversation_hub_payload_log') AS oid`).catch(() => null);
      const exists = !!(chk && chk.rows && chk.rows[0] && chk.rows[0].oid);
      if (!exists) return res.status(404).json({ ok: false, error: 'table_missing' });
      await pool.query('TRUNCATE TABLE public.mod_conversation_hub_payload_log');
      res.json({ ok: true });
    } catch (e) {
      log(`POST /api/conversation-hub/admin/payload-log/clear error: ${e.message}`);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // ---------------- Legacy behavior compatibility ----------------
  // Selected chatbot IDs for the hub, stored in settings as conversation_hub_bots
  app.get('/api/conversation-hub/bots', async (_req, res) => {
    try {
      const raw = await getSetting('conversation_hub_bots');
      let ids = [];
      try { const j = raw ? JSON.parse(raw) : null; if (j && Array.isArray(j.ids)) ids = j.ids.map(String); } catch {}
      res.json({ ok: true, ids });
    } catch (e) { log(`GET /api/conversation-hub/bots error: ${e.message}`); res.status(500).json({ ok: false, error: 'server_error' }); }
  });
  app.post('/api/conversation-hub/bots', async (req, res) => {
    try {
      const arr = Array.isArray(req.body?.ids) ? req.body.ids.map((x)=> String(x || '').trim()).filter(Boolean) : [];
      await setSetting('conversation_hub_bots', JSON.stringify({ ids: arr }));
      res.json({ ok: true, ids: arr });
    } catch (e) { log(`POST /api/conversation-hub/bots error: ${e.message}`); res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  // Map external assistant_id -> internal id_bot
  app.get('/api/conversation-hub/visitors/:id/chatbot-map', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    try {
      const vid = String(req.params.id || '').trim();
      if (!vid) return res.status(400).json({ ok: false, error: 'bad_request' });
      const vr = await pool.query(`SELECT visitor_id, shop_name, lang_iso, assistant_id FROM ${dbSchema.visitors.table} WHERE (visitor_id=$1 OR id=$1) LIMIT 1`, [vid]);
      if (!vr.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      const v = vr.rows[0];
      const assistantIdExt = v.assistant_id || null;
      let linkedId = null;
      if (assistantIdExt) {
        try { await ensureHubBotMapTable(); } catch {}
        try { const mr = await pool.query(`SELECT id_bot FROM hub_bot_map WHERE assistant_id_ext=$1 LIMIT 1`, [assistantIdExt]); if (mr.rowCount) linkedId = mr.rows[0].id_bot || null; } catch {}
      }
      let candidates = [];
      try {
        // chatbot_config is optional; guard if table absent
        const cr = await pool.query(`SELECT id_bot, name FROM chatbot_config ORDER BY name`);
        candidates = (cr.rows || []).map(r => ({ id_bot: r.id_bot, name: r.name || null }));
      } catch {}
      res.json({ ok: true, visitor_id: v.visitor_id, assistant_id_ext: assistantIdExt, linked_id_bot: linkedId, candidates });
    } catch (e) { log(`GET /api/conversation-hub/visitors/:id/chatbot-map error: ${e.message}`); res.status(500).json({ ok: false, error: 'server_error' }); }
  });
  app.post('/api/conversation-hub/visitors/:id/chatbot-map', async (req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    try {
      const vid = String(req.params.id || '').trim();
      if (!vid) return res.status(400).json({ ok: false, error: 'bad_request' });
      const target = String(req.body?.id_bot || '').trim();
      if (!target) return res.status(400).json({ ok: false, error: 'bad_request', message: 'id_bot required' });
      // Ensure visitor has external assistant id
      const vr = await pool.query(`SELECT assistant_id FROM ${dbSchema.visitors.table} WHERE (visitor_id=$1 OR id=$1) LIMIT 1`, [vid]);
      if (!vr.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      const assistantIdExt = vr.rows[0]?.assistant_id || null;
      if (!assistantIdExt) return res.status(400).json({ ok: false, error: 'bad_request', message: 'visitor has no assistant_id' });
      // Ensure target exists (if table exists)
      try {
        const ex = await pool.query(`SELECT 1 FROM chatbot_config WHERE id_bot=$1 LIMIT 1`, [target]);
        if (!ex.rowCount) return res.status(404).json({ ok: false, error: 'not_found', message: 'id_bot not found' });
      } catch {}
      await ensureHubBotMapTable();
      await pool.query(
        `INSERT INTO hub_bot_map (assistant_id_ext, id_bot, updated_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (assistant_id_ext) DO UPDATE SET id_bot=EXCLUDED.id_bot, updated_at=NOW()`,
        [assistantIdExt, target]
      );
      res.json({ ok: true, assistant_id_ext: assistantIdExt, linked_id_bot: target });
    } catch (e) { log(`POST /api/conversation-hub/visitors/:id/chatbot-map error: ${e.message}`); res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  // Mapping stats
  app.get('/api/conversation-hub/stats', async (_req, res) => {
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    try {
      await ensureHubBotMapTable();
      const r = await pool.query(`SELECT id_bot, COUNT(*)::INT AS count FROM hub_bot_map GROUP BY id_bot`);
      const items = (r.rows || []).map(row => ({ id_bot: row.id_bot, count: Number(row.count) || 0 }));
      res.json({ ok: true, items });
    } catch (e) { log(`GET /api/conversation-hub/stats error: ${e.message}`); res.status(500).json({ ok: false, error: 'server_error' }); }
  });

  // Optional legacy paths passthrough (temporary compatibility)
  try {
    app.get('/api/automations/conversation-hub', async (req, res) => {
      try { const r = await getSetting('conversation_hub_bots'); let ids = []; try { const j = r ? JSON.parse(r) : null; if (j && Array.isArray(j.ids)) ids = j.ids.map(String); } catch {}; res.json({ ok: true, ids }); } catch { res.status(500).json({ ok:false }); }
    });
    app.post('/api/automations/conversation-hub', async (req, res) => {
      try { const arr = Array.isArray(req.body?.ids) ? req.body.ids.map((x)=> String(x || '').trim()).filter(Boolean) : []; await setSetting('conversation_hub_bots', JSON.stringify({ ids: arr })); res.json({ ok: true, ids: arr }); } catch { res.status(500).json({ ok:false }); }
    });
    app.get('/api/automations/conversation-hub/stats', async (req, res) => {
      try { await ensureHubBotMapTable(); const r = await pool.query(`SELECT id_bot, COUNT(*)::INT AS count FROM hub_bot_map GROUP BY id_bot`); res.json({ ok: true, items: (r.rows||[]).map(row => ({ id_bot: row.id_bot, count: Number(row.count)||0 })) }); } catch { res.status(500).json({ ok:false }); }
    });
    app.get('/api/visitors/:id/chatbot-map', async (req, res) => {
      req.url = `/api/conversation-hub/visitors/${encodeURIComponent(req.params.id)}/chatbot-map`; app._router.handle(req, res, () => res.status(404).end());
    });
    app.post('/api/visitors/:id/chatbot-map', async (req, res) => {
      req.url = `/api/conversation-hub/visitors/${encodeURIComponent(req.params.id)}/chatbot-map`; app._router.handle(req, res, () => res.status(404).end());
    });
  } catch {}
}
