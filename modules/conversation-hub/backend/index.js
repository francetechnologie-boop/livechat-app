import { registerConversationHubRoutes } from './routes/hub.routes.js';
import { registerConversationHubAndroidRoutes } from './routes/android.routes.js';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export function register(app, ctx) {
  // Mount JSON parser for this module's API namespace
  try {
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    const paths = ['/api/conversation-hub', '/api/automations/conversation-hub', '/api/visitors'];
    for (const key of paths) {
      if (typeof json === 'function' && !mounted.has(key)) {
        app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false }));
        mounted.add(key);
      }
    }
  } catch {}

  registerConversationHubRoutes(app, ctx);
  registerConversationHubAndroidRoutes(app, ctx);

  // Attach Socket.IO handlers (standalone; replaces visitors_sockets)
  try {
    const io = ctx?.extras?.io;
    if (io && !globalThis.__convHubSocketsAttached) {
      globalThis.__convHubSocketsAttached = true;
      const pool = ctx?.pool;
      const log = (m) => { try { ctx.logToFile?.(`[conversation-hub:sockets] ${m}`); } catch {} };
      const getSetting = typeof ctx?.getSetting === 'function' ? ctx.getSetting : (async () => null);

      function toNullableInt(v) {
        if (v == null) return null;
        const s = String(v).trim();
        if (!s) return null;
        if (!/^-?\d+$/.test(s)) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      }

      function stripHtmlToText(html) {
        try {
          return String(html || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        } catch {
          return '';
        }
      }

      function decodeBasicEntities(s) {
        try {
          return String(s || '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#0*39;/g, "'")
            .replace(/&amp;/g, '&');
        } catch {
          return String(s || '');
        }
      }

      function escapeHtml(s) {
        return String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function looksBrokenAnchorsHtml(html) {
        const s = String(html || '');
        return (
          /href\s*=\s*["']\s*(?:<a|&lt;\s*a)\s+href=/i.test(s) ||
          /<a[^>]+href\s*=\s*["']\s*&lt;\s*a/i.test(s)
        );
      }

      function textToSafeHtml(text) {
        const raw = String(text || '').trim();
        if (!raw) return '';
        const escaped = escapeHtml(raw);
        const autolinked = escaped.replace(/((https?:\/\/|www\.)[^\s<]+)/gi, (m) => {
          const href = m.startsWith('http') ? m : `https://${m}`;
          return `<a href="${href}" target="_blank" rel="noopener noreferrer">${m}</a>`;
        });
        // Preserve simple paragraphs
        const parts = autolinked.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
        if (parts.length <= 1) return `<p>${autolinked.replace(/\n/g, '<br/>')}</p>`;
        return parts.map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');
      }

      async function getHubSelectedBotIdsCached() {
        const cache = (globalThis.__convHubSelectedBotsCache ||= { at: 0, ids: null });
        if (cache.ids && (Date.now() - cache.at) < 30_000) return cache.ids;
        try {
          const raw = await getSetting('conversation_hub_bots');
          let ids = [];
          try {
            const j = raw ? JSON.parse(raw) : null;
            if (j && Array.isArray(j.ids)) ids = j.ids.map((x) => String(x || '').trim()).filter(Boolean);
          } catch {}
          cache.at = Date.now();
          cache.ids = ids;
          return ids;
        } catch {
          cache.at = Date.now();
          cache.ids = [];
          return [];
        }
      }

      async function canSendWelcome(vid) {
        try {
          // In-memory throttle (fast path)
          const memo = (globalThis.__convHubWelcomeMemo ||= new Map());
          const last = memo.get(vid) || 0;
          if (last && (Date.now() - last) < 60_000) return false;

          // If payload log exists, use it for idempotency across restarts
          try {
            if (globalThis.__convHubPayloadLogAvailable === undefined) {
              const chk = await pool.query(`SELECT to_regclass('public.mod_conversation_hub_payload_log') AS oid`);
              globalThis.__convHubPayloadLogAvailable = !!chk?.rows?.[0]?.oid;
            }
          } catch {}
          if (globalThis.__convHubPayloadLogAvailable) {
            try {
              const r = await pool.query(
                `SELECT 1
                   FROM public.mod_conversation_hub_payload_log
                  WHERE visitor_id = $1
                    AND direction = 'sent'
                    AND event = 'chat_message'
                    AND payload->>'action' = 'welcome'
                    AND created_at > NOW() - INTERVAL '6 hours'
                  LIMIT 1`,
                [String(vid)]
              );
              if (r.rowCount) return false;
            } catch {}
          }

          memo.set(vid, Date.now());
          return true;
        } catch {
          return true;
        }
      }

      async function pickWelcomeMessageForVisitor({ chatbotId, idShop, idLang, allowedBotIds }) {
        if (!pool) return null;
        try {
          const hasBots = await pool.query(`SELECT to_regclass('public.mod_automation_suite_chatbots') AS oid`).catch(() => null);
          const hasWelcome = await pool.query(`SELECT to_regclass('public.mod_automation_suite_welcome_messages') AS oid`).catch(() => null);
          const hasLink = await pool.query(`SELECT to_regclass('public.mod_automation_suite_chatbot_welcome_link') AS oid`).catch(() => null);
          if (!hasBots?.rows?.[0]?.oid || !hasWelcome?.rows?.[0]?.oid) return null;
          const linkExists = !!hasLink?.rows?.[0]?.oid;

          let wmCols = [];
          try {
            const r = await pool.query(
              `SELECT column_name
                 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='mod_automation_suite_welcome_messages'`
            );
            wmCols = (r.rows || []).map((x) => x.column_name);
          } catch {}
          const hasWmShop = wmCols.includes('id_shop');
          const hasWmLang = wmCols.includes('id_lang');

          const allowSet = Array.isArray(allowedBotIds) ? new Set(allowedBotIds.map(String)) : null;

          const tryBot = async (id_bot) => {
            if (!id_bot) return null;
            if (allowSet && allowSet.size && !allowSet.has(String(id_bot))) return null;
            try {
              const r = await pool.query(
                linkExists
                  ? `SELECT c.id_bot, c.id_shop, c.id_lang,
                            l.welcome_message_id,
                            wm.id AS wm_id, wm.title AS wm_title, wm.content AS wm_content, COALESCE(wm.enabled, TRUE) AS wm_enabled,
                            ${hasWmShop ? 'wm.id_shop' : 'NULL::int'} AS wm_shop,
                            ${hasWmLang ? 'wm.id_lang' : 'NULL::int'} AS wm_lang
                       FROM public.mod_automation_suite_chatbots c
                  LEFT JOIN public.mod_automation_suite_chatbot_welcome_link l ON l.id_bot = c.id_bot
                  LEFT JOIN public.mod_automation_suite_welcome_messages wm ON wm.id = l.welcome_message_id
                      WHERE c.id_bot = $1
                      LIMIT 1`
                  : `SELECT c.id_bot, c.id_shop, c.id_lang,
                            NULL::text AS welcome_message_id,
                            NULL::text AS wm_id, NULL::text AS wm_title, NULL::text AS wm_content, TRUE AS wm_enabled,
                            NULL::int AS wm_shop, NULL::int AS wm_lang
                       FROM public.mod_automation_suite_chatbots c
                      WHERE c.id_bot = $1
                      LIMIT 1`,
                [String(id_bot)]
              );
              return r.rowCount ? r.rows[0] : null;
            } catch {
              return null;
            }
          };

          let botRow = null;
          if (chatbotId) botRow = await tryBot(chatbotId);

          if (!botRow && idShop != null && idLang != null) {
            try {
              const r = await pool.query(
                (linkExists
                  ? `SELECT c.id_bot, c.id_shop, c.id_lang,
                            l.welcome_message_id,
                            wm.id AS wm_id, wm.title AS wm_title, wm.content AS wm_content, COALESCE(wm.enabled, TRUE) AS wm_enabled,
                            ${hasWmShop ? 'wm.id_shop' : 'NULL::int'} AS wm_shop,
                            ${hasWmLang ? 'wm.id_lang' : 'NULL::int'} AS wm_lang
                       FROM public.mod_automation_suite_chatbots c
                  LEFT JOIN public.mod_automation_suite_chatbot_welcome_link l ON l.id_bot = c.id_bot
                  LEFT JOIN public.mod_automation_suite_welcome_messages wm ON wm.id = l.welcome_message_id
                      WHERE c.id_shop = $1 AND c.id_lang = $2
                      ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST
                      LIMIT 1`
                  : `SELECT c.id_bot, c.id_shop, c.id_lang,
                            NULL::text AS welcome_message_id,
                            NULL::text AS wm_id, NULL::text AS wm_title, NULL::text AS wm_content, TRUE AS wm_enabled,
                            NULL::int AS wm_shop, NULL::int AS wm_lang
                       FROM public.mod_automation_suite_chatbots c
                      WHERE c.id_shop = $1 AND c.id_lang = $2
                      ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST
                      LIMIT 1`),
                [Number(idShop), Number(idLang)]
              );
              if (r.rowCount) {
                const row = r.rows[0];
                if (!allowSet || !allowSet.size || allowSet.has(String(row.id_bot))) botRow = row;
              }
            } catch {}
          }

          // Prefer linked welcome message when it matches shop/lang (if specified)
          if (botRow && botRow.wm_enabled && String(botRow.wm_content || '').trim()) {
            const shopOk = (botRow.wm_shop == null || idShop == null || Number(botRow.wm_shop) === Number(idShop));
            const langOk = (botRow.wm_lang == null || idLang == null || Number(botRow.wm_lang) === Number(idLang));
            if (shopOk && langOk) {
              return {
                id_bot: botRow.id_bot,
                welcome_message_id: botRow.wm_id || botRow.welcome_message_id || null,
                html: botRow.wm_content,
                title: botRow.wm_title || null,
              };
            }
          }

          // Fallback: pick an enabled welcome message matching shop/lang (if columns exist)
          if (idShop != null || idLang != null) {
            try {
              const sql = (hasWmShop || hasWmLang)
                ? `SELECT id, title, content, COALESCE(enabled, TRUE) AS enabled,
                          ${hasWmShop ? 'id_shop' : 'NULL::int AS id_shop'},
                          ${hasWmLang ? 'id_lang' : 'NULL::int AS id_lang'}
                     FROM public.mod_automation_suite_welcome_messages
                    WHERE COALESCE(enabled, TRUE) = TRUE
                      ${hasWmShop ? 'AND ($1::int IS NULL OR id_shop IS NULL OR id_shop = $1::int)' : ''}
                      ${hasWmLang ? 'AND ($2::int IS NULL OR id_lang IS NULL OR id_lang = $2::int)' : ''}
                    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                    LIMIT 1`
                : `SELECT id, title, content, COALESCE(enabled, TRUE) AS enabled,
                          NULL::int AS id_shop,
                          NULL::int AS id_lang
                     FROM public.mod_automation_suite_welcome_messages
                    WHERE COALESCE(enabled, TRUE) = TRUE
                    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                    LIMIT 1`;
              const w = await pool.query(sql, [idShop != null ? Number(idShop) : null, idLang != null ? Number(idLang) : null]);
              if (w.rowCount) {
                const row = w.rows[0];
                const html = String(row.content || '').trim();
                if (html) {
                  return {
                    id_bot: botRow?.id_bot || chatbotId || null,
                    welcome_message_id: row.id,
                    html,
                    title: row.title || null,
                  };
                }
              }
            } catch {}
          }

          return null;
        } catch {
          return null;
        }
      }

      // Geo resolver (MaxMind first, then geoip-lite if available)
      let __geoReader = globalThis.__convHubGeoReader || null;
      async function ensureGeo() {
        if (__geoReader !== null) return __geoReader;
        try {
          const fs = await import('fs');
          const envPath = String(process.env.MAXMIND_DB_PATH || '').trim();
          const candidates = [];
          if (envPath) candidates.push(envPath);
          try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const repoRoot = path.resolve(__dirname, '..', '..', '..');
            candidates.push(path.join(repoRoot, 'GeoIP', 'GeoLite2-City.mmdb'));
          } catch {}
          candidates.push('/usr/share/GeoIP/GeoLite2-City.mmdb');
          candidates.push('/usr/share/GeoIP/GeoLite2-Country.mmdb');

          const dbPath = candidates.find((p) => p && fs.existsSync(p));
          if (dbPath) {
            try {
              let mm = null;
              try {
                mm = await import('@maxmind/geoip2-node');
              } catch {
                try {
                  const __filename = fileURLToPath(import.meta.url);
                  const __dirname = path.dirname(__filename);
                  const repoRoot = path.resolve(__dirname, '..', '..', '..');
                  const alt = path.join(repoRoot, 'backend', 'node_modules', '@maxmind', 'geoip2-node', 'dist', 'src', 'index.js');
                  mm = await import(pathToFileURL(alt).href);
                } catch {}
              }
              const mod = mm && (mm.default || mm);
              const Reader = mod?.Reader;
              const reader = Reader ? await Reader.open(dbPath) : null;
              if (!reader) throw new Error('maxmind_reader_unavailable');
              __geoReader = { type: 'maxmind', reader };
              globalThis.__convHubGeoReader = __geoReader;
              return __geoReader;
            } catch {}
          }
        } catch {}
        try {
          const gl = await import('geoip-lite');
          __geoReader = { type: 'geoip-lite', reader: gl };
          globalThis.__convHubGeoReader = __geoReader;
          return __geoReader;
        } catch {
          __geoReader = undefined;
          globalThis.__convHubGeoReader = __geoReader;
          return __geoReader;
        }
      }
      async function geoLookup(ip) {
        try {
          if (!ip) return null;
          const g = await ensureGeo();
          if (!g) return null;
          if (g.type === 'maxmind') {
            try {
              const r = await g.reader.city(ip);
              return {
                country_code: r?.country?.isoCode || r?.registeredCountry?.isoCode || null,
                city: (r?.city?.names && (r.city.names['fr'] || r.city.names['en'])) || r?.city?.name || null,
                postcode: r?.postal?.code || null,
              };
            } catch { return null; }
          }
          if (g.type === 'geoip-lite') {
            try {
              const r = g.reader.lookup(ip);
              if (!r) return null;
              return { country_code: r.country || null, city: r.city || null, postcode: null };
            } catch { return null; }
          }
          return null;
        } catch { return null; }
      }
      io.on('connection', (socket) => {
        try { log(`socket connected: ${socket.id}`); } catch {}
        let joinedVisitorId = null;
        let lastOnlinePersistAt = 0;
        socket.removeAllListeners('visitor_hello');
        socket.removeAllListeners('visitor_online');
        socket.removeAllListeners('visitor_context');
        socket.removeAllListeners('visitor_change_page');
        socket.removeAllListeners('chat_opened');
        socket.removeAllListeners('chat_started');
        socket.removeAllListeners('agent_hello');
        socket.removeAllListeners('chat_message');

        function getVisitorId(data) {
          try {
            const raw = (data && (data.visitorId ?? data.visitor_id ?? data.visitorID ?? data.visitor)) ?? '';
            return String(raw || '').trim();
          } catch { return ''; }
        }

        function ensureJoined(vid) {
          try {
            if (!vid) return false;
            if (joinedVisitorId !== vid) { joinedVisitorId = vid; socket.join(vid); }
            return true;
          } catch { return false; }
        }

        async function getTables() {
          if (!pool) return { visitors: 'visitors', visits: 'visits', messages: 'messages' };
          try {
            const q = (sql) => pool.query(sql).then(r => !!(r.rows && r.rows[0] && r.rows[0].oid)).catch(()=>false);
            const hasV = await q(`SELECT to_regclass('public.mod_conversation_hub_visitors') AS oid`);
            const hasVi = await q(`SELECT to_regclass('public.mod_conversation_hub_visits') AS oid`);
            const hasM = await q(`SELECT to_regclass('public.mod_conversation_hub_messages') AS oid`);
            return {
              visitors: hasV ? 'mod_conversation_hub_visitors' : 'visitors',
              visits: hasVi ? 'mod_conversation_hub_visits' : 'visits',
              messages: hasM ? 'mod_conversation_hub_messages' : 'messages',
            };
          } catch { return { visitors: 'visitors', visits: 'visits', messages: 'messages' }; }
        }

        async function tableColumns(table) {
          if (!pool) return [];
          try { const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]); return (r.rows||[]).map(x=>x.column_name); } catch { return []; }
        }

        async function upsertVisitor(visitorId, patch) {
          if (!pool) return;
          const tables = await getTables();
          const t = tables.visitors;
          const cols = await tableColumns(t);
          // Ensure row exists (schema varies across installs):
          // - Some tables use `id` as PK, others use `visitor_id`, some have both.
          try {
            if (cols.includes('id') && cols.includes('visitor_id')) {
              await pool.query(
                `INSERT INTO ${t} (id, visitor_id, created_at)
                 VALUES ($1,$1,NOW())
                 ON CONFLICT DO NOTHING`,
                [visitorId]
              );
            } else if (cols.includes('id')) {
              await pool.query(
                `INSERT INTO ${t} (id, created_at)
                 VALUES ($1,NOW())
                 ON CONFLICT DO NOTHING`,
                [visitorId]
              );
            } else if (cols.includes('visitor_id')) {
              await pool.query(
                `INSERT INTO ${t} (visitor_id, created_at)
                 VALUES ($1,NOW())
                 ON CONFLICT DO NOTHING`,
                [visitorId]
              );
            }
          } catch {}
          const sets = []; const vals = []; let i = 1;
          for (const [k, v] of Object.entries(patch || {})) {
            if (!cols.includes(k)) continue;
            sets.push(`${k} = $${++i}`);
            vals.push(v);
          }
          if (!sets.length) return;
          const where = (cols.includes('visitor_id') && cols.includes('id'))
            ? '(visitor_id = $1 OR id = $1)'
            : (cols.includes('visitor_id') ? 'visitor_id = $1' : (cols.includes('id') ? 'id = $1' : '1=0'));
          await pool.query(`UPDATE ${t} SET ${sets.join(', ')} WHERE ${where}`, [visitorId, ...vals]).catch(()=>{});
        }

        async function insertVisit(visitorId, data) {
          if (!pool) return;
          const tables = await getTables();
          const t = tables.visits;
          const cols = await tableColumns(t);
          const fields = []; const placeholders = []; const values = [];
          function add(col, val){ if (cols.includes(col) && val != null) { fields.push(col); placeholders.push(`$${placeholders.length+1}`); values.push(val); } }
          add('visitor_id', visitorId);
          add('page_url', data.page_url || data.page_url_last);
          add('title', data.title);
          add('origin', data.origin);
          add('referrer', data.referrer);
          add('utm_source', data.utm_source || data.utmSource);
          add('utm_medium', data.utm_medium || data.utmMedium);
          add('utm_campaign', data.utm_campaign || data.utmCampaign);
          add('utm_term', data.utm_term || data.utmTerm);
          add('utm_content', data.utm_content || data.utmContent);
          add('occurred_at', new Date().toISOString());
          if (!fields.length) return;
          try {
            await pool.query(`INSERT INTO ${t} (${fields.join(',')}) VALUES (${placeholders.join(',')})`, values);
          } catch (e) {
            try {
              const memo = (globalThis.__convHubVisitInsertErrMemo ||= { at: 0, n: 0 });
              // Throttle noisy errors (max 3 per 60s)
              if ((Date.now() - memo.at) > 60_000) { memo.at = Date.now(); memo.n = 0; }
              if (memo.n < 3) {
                memo.n += 1;
                log(`insertVisit failed on ${t}: ${e?.code || ''} ${e?.message || e}`);
                try { ctx?.chatLog?.('conversation-hub:insertVisit_failed', { table: t, code: e?.code || null }); } catch {}
              }
            } catch {}
          }
        }

        async function insertMessage(msg) {
          if (!pool) return;
          const tables = await getTables();
          const t = tables.messages;
          const cols = await tableColumns(t);
          const fields = []; const placeholders = []; const values = [];
          function add(col, val){ if (cols.includes(col) && val != null) { fields.push(col); placeholders.push(`$${placeholders.length+1}`); values.push(val); } }
          add('visitor_id', String(msg.visitorId || ''));
          add('sender', String((msg.from || msg.sender || 'visitor') || 'visitor'));
          // Prefer 'content' column; if absent, try legacy 'message'
          const plain = (msg.message != null ? String(msg.message) : (msg.content != null ? String(msg.content) : ''));
          if (cols.includes('content')) add('content', plain);
          else if (cols.includes('message')) add('message', plain);
          if (cols.includes('content_html')) add('content_html', msg.content_html || null);
          if (cols.includes('agent_id')) add('agent_id', msg.agent_id || null);
          if (cols.includes('created_at')) add('created_at', new Date().toISOString());
          if (!fields.length) return;
          try {
            await pool.query(`INSERT INTO ${t} (${fields.join(',')}) VALUES (${placeholders.join(',')})`, values);
          } catch (e) {
            try { log(`insertMessage failed on ${t}: ${e?.message||e}`); } catch {}
          }
        }

        async function insertPayloadLog({ visitorId = null, direction, event, payload }) {
          if (!pool) return;
          const dir = String(direction || '').trim();
          const ev = String(event || '').trim();
          if (!dir || !ev) return;
          // Cache table existence to avoid repetitive to_regclass queries.
          if (globalThis.__convHubPayloadLogAvailable === undefined) {
            try {
              const chk = await pool.query(`SELECT to_regclass('public.mod_conversation_hub_payload_log') AS oid`);
              globalThis.__convHubPayloadLogAvailable = !!chk?.rows?.[0]?.oid;
            } catch {
              globalThis.__convHubPayloadLogAvailable = false;
            }
          }
          if (!globalThis.__convHubPayloadLogAvailable) return;
          try {
            await pool.query(
              `INSERT INTO public.mod_conversation_hub_payload_log (visitor_id, direction, event, payload, created_at)
               VALUES ($1,$2,$3,$4,NOW())`,
              [visitorId ? String(visitorId) : null, dir, ev, payload != null ? JSON.stringify(payload) : null]
            );
          } catch {}
        }

        socket.on('visitor_hello', async (data = {}) => {
          try {
            const vid = getVisitorId(data);
            if (!vid) return;
            ensureJoined(vid);
            await insertPayloadLog({ visitorId: vid, direction: 'received', event: 'visitor_hello', payload: data });
            // Enrich with headers (IP, UA, language) and optional client hints
            const h = (socket.handshake && socket.handshake.headers) || {};
            const ipGuess = (
              h['cf-connecting-ip'] ||
              h['x-real-ip'] ||
              ((h['x-forwarded-for'] || '').toString().split(',')[0].trim()) ||
              (socket.handshake && socket.handshake.address) ||
              ''
            ).toString().trim();
            const ipRaw = ipGuess.replace(/^::ffff:/, '').trim();
            const userAgent = (h['user-agent'] || '').toString();
            const langHeader = (h['accept-language'] || '').toString();
            const lang = langHeader ? langHeader.split(',')[0].trim() : null;
            const ccHeader = (h['cf-ipcountry'] || h['x-country-code'] || '').toString().toUpperCase();
            const ccData = (data.country_code || '').toString().toUpperCase();
            const cc = ccHeader || ccData || null;
            const tz = (data.time_zone || h['x-time-zone'] || '').toString() || null;
            const geo = (!cc || !data.city || !data.postcode) ? (await geoLookup(ipRaw)) : null;

            // Fallback page URL from Referer header if widget didn't send page_url
            let referer = (h['referer'] || h['referrer'] || '').toString();
            let originHdr = '';
            try { if (referer) originHdr = new URL(referer).origin; } catch {}
            const currentUrl = (data.current_url || data.currentUrl || '').toString() || null;
            const effectivePageUrl = data.page_url || data.page_url_last || currentUrl || referer || null;
            let originFromUrl = '';
            try { if (effectivePageUrl) originFromUrl = new URL(effectivePageUrl).origin; } catch {}

            const patch = {
              page_url: data.page_url || null,
              page_url_last: effectivePageUrl || null,
              title: data.title || null,
              referrer: data.referrer || referer || null,
              origin: data.origin || originHdr || originFromUrl || null,
              last_action: data.page_url ? 'page_view' : null,
              last_action_at: data.page_url ? new Date().toISOString() : null,
              last_seen: new Date().toISOString(),
              ip: ipRaw || null,
              user_agent: userAgent || null,
              language: data.language || lang || null,
              country_code: cc || geo?.country_code || null,
              time_zone: tz,
              screen_w: Number(data.screen_w || data.w || 0) || null,
              screen_h: Number(data.screen_h || data.h || 0) || null,
              screen_dpr: data.screen_dpr != null ? Number(data.screen_dpr) : (data.dpr != null ? Number(data.dpr) : null),
              city: data.city || geo?.city || null,
              postcode: data.postcode || data.postal || geo?.postcode || null,
              archived: false,
              conversation_status: 'open',
            };

            // Extra fields from Presta widget visitor_hello payload (best-effort; stored in payload log and emitted to agents)
            const id_shop = toNullableInt(data.id_shop ?? data.shop_id ?? data.shopId ?? data.shopID ?? null);
            const id_lang = toNullableInt(data.id_lang ?? data.lang_id ?? data.idLang ?? data.id_Lang ?? null);
            const extra = {
              id_shop,
              shop_name: data.shop_name != null ? String(data.shop_name) : null,
              id_lang,
              lang_iso: data.shop_lang_iso != null ? String(data.shop_lang_iso) : (data.lang_iso != null ? String(data.lang_iso) : null),
              lang_name: data.shop_lang_name != null ? String(data.shop_lang_name) : (data.lang_name != null ? String(data.lang_name) : null),
              currency: data.currency != null ? String(data.currency) : null,
              cart_total: data.cart_total != null ? Number(data.cart_total) : null,
              chatbot_id: data.chatbot_id != null ? String(data.chatbot_id) : (data.chatbotId != null ? String(data.chatbotId) : null),
              assistant_id: data.assistant_id != null ? String(data.assistant_id) : null,
              customer_id: toNullableInt(data.customer_id ?? data.customerId ?? null),
              customer_email: data.customer_email != null ? String(data.customer_email) : null,
              customer_logged: data.customer_logged != null ? Boolean(data.customer_logged) : null,
              customer_firstname: data.customer_firstname != null ? String(data.customer_firstname) : null,
              customer_lastname: data.customer_lastname != null ? String(data.customer_lastname) : null,
              orders_count: toNullableInt(data.orders_count ?? data.ordersCount ?? null),
              orders_amount: data.orders_amount != null ? Number(data.orders_amount) : (data.ordersAmount != null ? Number(data.ordersAmount) : null),
              current_url: currentUrl,
            };
            for (const [k, v] of Object.entries(extra)) {
              if (v == null || v === '') continue;
              patch[k] = v;
            }
            await upsertVisitor(vid, patch);
            const pageForVisit = effectivePageUrl;
            if (pageForVisit || data.title) await insertVisit(vid, {
              page_url: pageForVisit,
              title: data.title,
              origin: data.origin,
              referrer: data.referrer,
              utm_source: data.utm_source || data.utmSource,
              utm_medium: data.utm_medium || data.utmMedium,
              utm_campaign: data.utm_campaign || data.utmCampaign,
              utm_term: data.utm_term || data.utmTerm,
              utm_content: data.utm_content || data.utmContent,
            });
            io.to('agents').emit('visitor_update', { visitorId: vid, ...patch });

            // Auto-send a welcome message (once) based on chatbot_id or (id_shop, id_lang) selection.
            try {
              const allowedBotIds = await getHubSelectedBotIdsCached();
              const chatbotId = (extra.chatbot_id || '').toString().trim() || null;
              const okToSend = await canSendWelcome(vid);
              if (okToSend) {
                const picked = await pickWelcomeMessageForVisitor({ chatbotId, idShop: id_shop, idLang: id_lang, allowedBotIds });
                const html = String(picked?.html || '').trim();
                if (html) {
                  const plain = stripHtmlToText(html) || ' ';
                  const payload = {
                    visitorId: vid,
                    from: 'agent',
                    message: plain,
                    content_html: html,
                    timestamp: Date.now(),
                    action: 'welcome',
                    welcome_message_id: picked?.welcome_message_id || null,
                    chatbot_id: picked?.id_bot || chatbotId || null,
                    id_shop: id_shop,
                    id_lang: id_lang,
                  };
                  await insertPayloadLog({ visitorId: vid, direction: 'sent', event: 'chat_message', payload });
                  io.to(vid).emit('chat_message', payload);
                  io.to('agents').emit('dashboard_message', payload);
                  await insertMessage(payload);
                }
              }
            } catch {}
          } catch {}
        });

        socket.on('visitor_online', async (data = {}) => {
          try {
            const vid = getVisitorId(data);
            if (!vid) return;
            ensureJoined(vid);
            const now = Date.now();
            const nowIso = new Date(now).toISOString();
            const isHeartbeat = Boolean(data && data.__heartbeat);
            if (!isHeartbeat) {
              await insertPayloadLog({ visitorId: vid, direction: 'received', event: 'visitor_online', payload: data });
            }
            // Persist last_seen at most once per 2 minutes per socket (avoid write amplification).
            if (!isHeartbeat || (now - lastOnlinePersistAt) > 120000) {
              lastOnlinePersistAt = now;
              await upsertVisitor(vid, { last_seen: nowIso });
            }
            io.to('agents').emit('visitor_update', { visitorId: vid, last_seen: nowIso });
          } catch {}
        });

        socket.on('visitor_context', async (data = {}) => {
          try {
            const vid = getVisitorId(data);
            if (!vid) return;
            ensureJoined(vid);
            await insertPayloadLog({ visitorId: vid, direction: 'received', event: 'visitor_context', payload: data });
            const nowIso = new Date().toISOString();
            const patch = {
              last_action: 'context',
              last_action_at: nowIso,
              last_seen: nowIso,
              archived: false,
              conversation_status: 'open',
              id_shop: toNullableInt(data.id_shop ?? data.shop_id ?? data.idShop ?? data.shopId ?? null),
              id_lang: toNullableInt(data.id_lang ?? data.lang_id ?? data.idLang ?? data.id_Lang ?? null),
              shop_name: data.shop_name != null ? String(data.shop_name) : null,
              lang_iso: data.lang_iso != null ? String(data.lang_iso) : (data.shop_lang_iso != null ? String(data.shop_lang_iso) : null),
              lang_name: data.lang_name != null ? String(data.lang_name) : (data.shop_lang_name != null ? String(data.shop_lang_name) : null),
              currency: data.currency != null ? String(data.currency) : null,
              cart_total: data.cart_total != null ? Number(data.cart_total) : null,
              customer_id: toNullableInt(data.customer_id ?? data.customerId ?? data.id_customer ?? null),
              customer_email: (data.customer_email || data.email || null),
              customer_firstname: (data.customer_firstname || data.firstname || null),
              customer_lastname: (data.customer_lastname || data.lastname || null),
              customer_logged: (data.customer_logged != null ? Boolean(data.customer_logged) : null),
            };
            await upsertVisitor(vid, patch);
            io.to('agents').emit('visitor_update', { visitorId: vid, ...patch });
          } catch {}
        });

        socket.on('visitor_change_page', async (data = {}) => {
          try {
            const vid = getVisitorId(data);
            if (!vid) return;
            ensureJoined(vid);
            await insertPayloadLog({ visitorId: vid, direction: 'received', event: 'visitor_change_page', payload: data });
            const h = (socket.handshake && socket.handshake.headers) || {};
            const referer = (h['referer'] || h['referrer'] || '').toString();
            const currentUrl = (data.current_url || data.currentUrl || data.page_url || data.pageUrl || '').toString() || null;
            const pageUrl = data.page_url || data.page_url_last || currentUrl || referer || null;
            const nowIso = new Date().toISOString();
            const patch = {
              last_action: 'page_view',
              last_action_at: nowIso,
              last_seen: nowIso,
              page_url_last: pageUrl,
              current_url: currentUrl || pageUrl,
              title: data.title || null,
              origin: data.origin || null,
              referrer: data.referrer || referer || null,
            };
            await upsertVisitor(vid, patch);
            io.to('agents').emit('visitor_update', { visitorId: vid, ...patch });
            if (pageUrl || data.title) await insertVisit(vid, {
              page_url: pageUrl,
              title: data.title,
              origin: data.origin,
              referrer: data.referrer,
              utm_source: data.utm_source || data.utmSource,
              utm_medium: data.utm_medium || data.utmMedium,
              utm_campaign: data.utm_campaign || data.utmCampaign,
              utm_term: data.utm_term || data.utmTerm,
              utm_content: data.utm_content || data.utmContent,
            });
          } catch {}
        });

        socket.on('chat_opened', async (data = {}) => {
          try {
            const vid = getVisitorId(data);
            if (!vid) return;
            ensureJoined(vid);
            await insertPayloadLog({ visitorId: vid, direction: 'received', event: 'chat_opened', payload: data });
            const nowIso = new Date().toISOString();
            const patch = { last_action: 'chat_opened', last_action_at: nowIso, last_seen: nowIso, archived: false, conversation_status: 'open' };
            await upsertVisitor(vid, patch);
            io.to('agents').emit('visitor_update', { visitorId: vid, ...patch });
          } catch {}
        });

        socket.on('chat_started', async (data = {}) => {
          try {
            const vid = getVisitorId(data);
            if (!vid) return;
            ensureJoined(vid);
            await insertPayloadLog({ visitorId: vid, direction: 'received', event: 'chat_started', payload: data });
            const nowIso = new Date().toISOString();
            const patch = { last_action: 'chat_started', last_action_at: nowIso, last_seen: nowIso, archived: false, conversation_status: 'open' };
            await upsertVisitor(vid, patch);
            io.to('agents').emit('visitor_update', { visitorId: vid, ...patch });
          } catch {}
        });

        socket.on('agent_hello', async (_data = {}) => { try { socket.join('agents'); log(`agent room joined: ${socket.id}`); } catch {} });

        socket.on('chat_message', async (msg = {}) => {
          try {
            const vid = getVisitorId(msg);
            if (!vid) return;
            const h = (socket.handshake && socket.handshake.headers) || {};
            const referer = (h['referer'] || h['referrer'] || '').toString();
            const originHdr = (h['origin'] || '').toString();
            const payload = { ...msg, timestamp: Date.now() };
            try {
              const from = String(payload.from || payload.sender || '').toLowerCase().trim();
              if (from === 'agent') {
                const htmlRaw = (typeof payload.content_html === 'string' ? payload.content_html : (typeof payload.html === 'string' ? payload.html : '')).trim();
                let html = htmlRaw;
                if (html && /&lt;\s*\/?\s*[a-z][^>]*&gt;/i.test(html)) html = decodeBasicEntities(html);
                if (html && looksBrokenAnchorsHtml(html)) {
                  const txt = stripHtmlToText(html) || String(payload.message || '').trim();
                  payload.content_html = textToSafeHtml(txt);
                  payload.html = payload.content_html;
                  payload.message = stripHtmlToText(payload.content_html) || txt || ' ';
                } else if (html) {
                  payload.content_html = html;
                  payload.html = html;
                  const m = String(payload.message || '').trim();
                  // If the plain message contains HTML-attribute artifacts, rebuild it from HTML.
                  if (!m || /\\\"\\s+target=/.test(m) || /\"\\s+target=/.test(m)) {
                    payload.message = stripHtmlToText(html) || m || ' ';
                  }
                } else {
                  const txt = String(payload.message || '').trim();
                  if (txt) {
                    payload.content_html = textToSafeHtml(txt);
                    payload.html = payload.content_html;
                  }
                }
              }
            } catch {}
            try {
              const from = String(payload.from || payload.sender || '').toLowerCase().trim();
              if (from === 'agent') {
                await insertPayloadLog({ visitorId: vid, direction: 'sent', event: 'chat_message', payload });
              } else if (from === 'visitor' || !from) {
                await insertPayloadLog({ visitorId: vid, direction: 'received', event: 'chat_message', payload });
              } else {
                await insertPayloadLog({ visitorId: vid, direction: 'received', event: 'chat_message', payload });
              }
            } catch {}
            io.to(vid).emit('chat_message', payload);
            io.to('agents').emit('dashboard_message', payload);
            await insertMessage(payload);

            // Record a lightweight visit even when the website doesn't emit visitor_hello.
            try {
              const from = String(payload.from || payload.sender || '').toLowerCase().trim();
              if (from !== 'agent') {
                const pageUrl = (payload.page_url || payload.pageUrl || payload.current_url || payload.currentUrl || referer || '').toString().trim() || null;
                let origin = (payload.origin || originHdr || '').toString().trim() || null;
                if (!origin && pageUrl) {
                  try { origin = new URL(pageUrl).origin; } catch {}
                }
                const title = (payload.title || '').toString().trim() || null;
                const referrer = (payload.referrer || payload.referer || referer || '').toString().trim() || null;
                await insertVisit(vid, {
                  page_url: pageUrl,
                  title,
                  origin,
                  referrer,
                  utm_source: payload.utm_source || payload.utmSource,
                  utm_medium: payload.utm_medium || payload.utmMedium,
                  utm_campaign: payload.utm_campaign || payload.utmCampaign,
                  utm_term: payload.utm_term || payload.utmTerm,
                  utm_content: payload.utm_content || payload.utmContent,
                });
              }
            } catch {}

            // Unarchive and mark conversation open on any activity
            await upsertVisitor(vid, {
              archived: false,
              conversation_status: 'open',
              last_action: 'message',
              last_action_at: new Date().toISOString(),
              last_seen: new Date().toISOString(),
              page_url_last: (payload.page_url_last || payload.page_url || payload.pageUrl || payload.current_url || payload.currentUrl || referer || null),
              current_url: (payload.current_url || payload.currentUrl || payload.page_url || payload.pageUrl || null),
              title: (payload.title || null),
              origin: (payload.origin || originHdr || null),
              referrer: (payload.referrer || payload.referer || referer || null),
              id_shop: toNullableInt(payload.id_shop ?? payload.shop_id ?? payload.idShop ?? payload.shopId ?? null),
              id_lang: toNullableInt(payload.id_lang ?? payload.lang_id ?? payload.idLang ?? payload.id_Lang ?? null),
              shop_name: payload.shop_name != null ? String(payload.shop_name) : null,
              lang_iso: payload.lang_iso != null ? String(payload.lang_iso) : null,
              currency: payload.currency != null ? String(payload.currency) : null,
              cart_total: payload.cart_total != null ? Number(payload.cart_total) : null,
              customer_email: (payload.customer_email || payload.email || null),
              customer_firstname: (payload.customer_firstname || payload.firstname || null),
              customer_lastname: (payload.customer_lastname || payload.lastname || null),
              customer_logged: (payload.customer_logged != null ? Boolean(payload.customer_logged) : null),
            });

            // Live-update agent UI (current page, etc.)
            try {
              io.to('agents').emit('visitor_update', {
                visitorId: vid,
                last_seen: new Date().toISOString(),
                page_url_last: (payload.page_url_last || payload.page_url || payload.pageUrl || payload.current_url || payload.currentUrl || referer || null),
                current_url: (payload.current_url || payload.currentUrl || payload.page_url || payload.pageUrl || null),
                title: (payload.title || null),
                origin: (payload.origin || originHdr || null),
                referrer: (payload.referrer || payload.referer || referer || null),
                id_shop: toNullableInt(payload.id_shop ?? payload.shop_id ?? payload.idShop ?? payload.shopId ?? null),
                id_lang: toNullableInt(payload.id_lang ?? payload.lang_id ?? payload.idLang ?? payload.id_Lang ?? null),
                shop_name: payload.shop_name != null ? String(payload.shop_name) : null,
                lang_iso: payload.lang_iso != null ? String(payload.lang_iso) : null,
                customer_id: toNullableInt(payload.customer_id ?? payload.customerId ?? payload.id_customer ?? null),
                customer_email: (payload.customer_email || payload.email || null),
                customer_firstname: (payload.customer_firstname || payload.firstname || null),
                customer_lastname: (payload.customer_lastname || payload.lastname || null),
              });
            } catch {}
          } catch {}
        });

        socket.on('disconnect', () => { try { log(`socket disconnected: ${socket.id}`); } catch {} });
      });
    }
  } catch {}
}
