import { connectMySql, makeSqlHelpers, getMysql2FromCtx } from '../../../grabbing-jerome/backend/services/transfer/mysql.js';
import { loadProfileConfig } from '../../../product-search-index/backend/services/indexer.service.js';

export function registerGatewayRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ ok:false, error:'unauthorized' }); return null; });
  const getSetting = ctx.getSetting || (async () => null);
  const setSetting = ctx.setSetting || (async () => {});
  const io = (ctx.extras && ctx.extras.io) || null;
  const log = (msg) => { try { ctx.logToFile?.(`[gateway] ${msg}`); } catch {} };
  // In-memory diagnostics log
  const recent = [];
  const pushLog = (entry) => {
    try {
      recent.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, when: Date.now(), ...entry });
      if (recent.length > 200) recent.splice(0, recent.length - 200);
    } catch {}
  };

  // Runtime connection state (per process)
  let gatewaySocketIds = new Set();
  const gatewaySocketMeta = new Map(); // socket.id -> { kind, connected_at, last_seen, ua }
  let gatewayConnectedAt = null; // first connection time
  let gatewayLastActivityAt = null; // last event/connection time
  let lastSocket = null;

  function socketClientKind(socket) {
    try {
      const raw = String(socket?.data?.gateway_client_kind || socket?.handshake?.query?.client || socket?.handshake?.auth?.client || '').trim();
      if (raw === 'admin_temp') return 'admin_temp';
      if (raw) return raw;
    } catch {}
    // Heuristic: browsers will typically include an `Origin` header; native clients often won't.
    // If there is an Origin and no explicit kind, treat it as an admin temp client to avoid
    // false-positive "device connected" states from the in-browser temp socket.
    try {
      const origin = String(socket?.handshake?.headers?.origin || '').trim();
      if (origin) return 'admin_temp';
    } catch {}
    return 'device';
  }

  function getGatewaySocketCounts(ns = null) {
    try {
      const live = ns ? listNamespaceSockets(ns) : null;
      if (Array.isArray(live)) {
        const socket_count = live.length;
        let device_socket_count = 0;
        let temp_socket_count = 0;
        for (const s of live) {
          const kind = socketClientKind(s);
          if (kind === 'admin_temp') temp_socket_count++;
          else device_socket_count++;
        }
        return { socket_count, device_socket_count, temp_socket_count, source: 'ns' };
      }

      const socket_count = gatewaySocketIds.size;
      let device_socket_count = 0;
      let temp_socket_count = 0;
      for (const id of gatewaySocketIds) {
        const meta = gatewaySocketMeta.get(id);
        const kind = meta?.kind || 'device';
        if (kind === 'admin_temp') temp_socket_count++;
        else device_socket_count++;
      }
      return { socket_count, device_socket_count, temp_socket_count, source: 'set' };
    } catch {
      return { socket_count: 0, device_socket_count: 0, temp_socket_count: 0, source: 'error' };
    }
  }

  function listNamespaceSockets(ns) {
    try {
      if (ns?.sockets?.values) return Array.from(ns.sockets.values());
      if (ns?.sockets && typeof ns.sockets === 'object') return Object.values(ns.sockets);
    } catch {}
    return [];
  }

  function filterDeviceSockets(sockets = []) {
    const out = [];
    for (const s of sockets) {
      const kind = socketClientKind(s);
      if (kind !== 'admin_temp') out.push(s);
    }
    return out;
  }

  async function emitWithAck(socket, event, payload, timeoutMs) {
    return new Promise((resolve) => {
      try {
        socket.timeout(timeoutMs).emit(event, payload, (err, data) => {
          if (err) return resolve({ ok: false, error: String(err?.message || err || 'timeout'), ack: null });
          // Reject loopback ACKs for actual sends (this is a temp client/test ACK, not a real SMS dispatch).
          try {
            if (data && typeof data === 'object' && data.loopback === true) {
              return resolve({ ok: false, error: 'loopback_client', ack: data ?? null });
            }
          } catch {}

          // ACK semantics:
          // - Some clients call ack() with no payload (data === undefined/null) → treat as accepted.
          // - Some clients return { ok:true } / { accepted:true } / { sent:true } / { status:'sent' }.
          // - Treat explicit negatives as failure: { ok:false } or { error:'...' } without ok:true.
          try {
            if (data == null) return resolve({ ok: true, error: null, ack: null });

            if (typeof data === 'object') {
              const okFlag = data.ok;
              if (okFlag === false) {
                const ackErr = data.error || data.message || 'device_nack';
                return resolve({ ok: false, error: String(ackErr), ack: data });
              }
              if (okFlag === true) return resolve({ ok: true, error: null, ack: data });
              if (data.accepted === true || data.sent === true) return resolve({ ok: true, error: null, ack: data });
              if (typeof data.status === 'string' && /^(ok|accepted|queued|sent|submitted|enqueued)$/i.test(data.status.trim())) {
                return resolve({ ok: true, error: null, ack: data });
              }
              // If the client included an error/message without ok:true, treat as failure.
              if (data.error || data.message) return resolve({ ok: false, error: String(data.error || data.message), ack: data });
              // Otherwise: ack payload is present but doesn't match a known schema → treat as accepted.
              return resolve({ ok: true, error: null, ack: data });
            }

            // Non-object payloads (string/number/etc.) still mean the client acked the request.
            return resolve({ ok: true, error: null, ack: data });
          } catch (e) {
            // If we can't parse ACK payload, still treat the fact we got an ACK callback as success.
            return resolve({ ok: true, error: null, ack: data ?? null });
          }
        });
      } catch (e) {
        return resolve({ ok: false, error: String(e?.message || e), ack: null });
      }
    });
  }

  async function isGatewayAuthorized(req) {
    try {
      const provided = String(
        (req.headers['x-gateway-token']) ||
        (req.query && (req.query.token || req.query.GATEWAY_TOKEN)) ||
        String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
      ).trim();
      const expected = String(await modGet('GATEWAY_TOKEN') || (await getSetting('GATEWAY_TOKEN')) || '').trim();
      return !!expected && !!provided && provided === expected;
    } catch { return false; }
  }

  function logUnauthorized(req, kind) {
    try {
      const hasHeader = !!(req.headers && (req.headers['x-gateway-token'] || req.headers['authorization']));
      const hasQuery = !!(req.query && (req.query.token || req.query.GATEWAY_TOKEN));
      pushLog({
        kind: kind || 'unauthorized',
        path: String(req.path || ''),
        method: String(req.method || ''),
        ip: String(req.headers?.['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null,
        has_auth: hasHeader || hasQuery,
        ua: req.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, 160) : null,
      });
    } catch {}
  }

  // Module-scoped settings helpers (fallback to server-level settings)
  async function ensureModSettingsTable() {
    if (!pool) return;
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS public.mod_gateway_settings (
           id BIGSERIAL PRIMARY KEY,
           org_id INTEGER NULL,
           key TEXT NOT NULL,
           value TEXT NULL,
           updated_at TIMESTAMP DEFAULT NOW(),
           CONSTRAINT uq_mod_gateway_settings UNIQUE (org_id, key)
         )`
      );
    } catch {}
    // Guarded FK to organizations(id)
    try {
      await pool.query(`
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
              ALTER TABLE public.mod_gateway_settings
                ADD CONSTRAINT fk_mod_gateway_settings_org
                FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
          END IF;
        END $$;
      `);
    } catch {}
  }

  async function modGet(key, orgId = null) {
    try {
      if (!pool) return null;
      await ensureModSettingsTable();
      const r = await pool.query(
        `SELECT value
           FROM public.mod_gateway_settings
          WHERE key=$1
            AND (($2::int IS NULL AND org_id IS NULL) OR org_id=$2)
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT 1`,
        [String(key||'').trim(), orgId]
      );
      return r.rowCount ? (r.rows[0].value || null) : null;
    } catch { return null; }
  }
  async function modSet(key, value, orgId = null) {
    try {
      if (!pool) return false;
      await ensureModSettingsTable();
      const k = String(key||'').trim();
      const v = value == null ? '' : String(value);
      // NOTE: Postgres UNIQUE(org_id,key) allows multiple NULL org_id rows. Handle NULL org_id explicitly.
      if (orgId === null || orgId === undefined) {
        const u = await pool.query(
          `UPDATE public.mod_gateway_settings
              SET value=$1, updated_at=NOW()
            WHERE org_id IS NULL
              AND key=$2`,
          [v, k]
        );
        if (!u.rowCount) {
          await pool.query(
            `INSERT INTO public.mod_gateway_settings(org_id, key, value, updated_at)
             VALUES(NULL,$1,$2,NOW())`,
            [k, v]
          );
        }
      } else {
        await pool.query(
          `INSERT INTO public.mod_gateway_settings(org_id, key, value, updated_at)
           VALUES($1,$2,$3,NOW())
           ON CONFLICT (org_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
          [orgId, k, v]
        );
      }
      return true;
    } catch { return false; }
  }

  function pickOrgId(req) {
    try {
      const raw = req.headers['x-org-id'] || req.query?.org_id || req.body?.org_id;
      if (raw === undefined || raw === null || raw === '') return null;
      const n = Number(String(raw).trim());
      return Number.isFinite(n) ? Math.trunc(n) : null;
    } catch {
      return null;
    }
  }

  function normalizePrefix(raw) {
    const s = String(raw || '').trim();
    if (!s) return 'ps_';
    if (!/^[a-z0-9_]+$/i.test(s)) return 'ps_';
    return s;
  }

  const KEY_PRESTA_PROFILE_ID = 'PRESTA_MYSQL_PROFILE_ID';
  const KEY_PRESTA_PREFIX = 'PRESTA_TABLE_PREFIX';
  const KEY_SHOP_SUB_MAP = 'SHOP_SUBSCRIPTION_MAP';

  async function readModSettingRow(key, orgId) {
    if (!pool) return null;
    await ensureModSettingsTable();
    const r = await pool.query(
      `SELECT value, updated_at
         FROM public.mod_gateway_settings
        WHERE key=$1
          AND (($2::int IS NULL AND org_id IS NULL) OR org_id=$2)
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [String(key || '').trim(), orgId]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  function safeParseJsonObject(value) {
    try {
      const s = String(value || '').trim();
      if (!s) return null;
      const parsed = JSON.parse(s);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  // SMS storage (DB) helpers (kept idempotent for safety)
  let smsTableReady = false;
  async function ensureSmsMessagesTable() {
    if (!pool || smsTableReady) return;
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS public.mod_gateway_sms_messages (
           id BIGSERIAL PRIMARY KEY,
           org_id INTEGER NULL,
           direction TEXT NOT NULL,
           message_id TEXT NULL,
           device_id TEXT NULL,
           subscription_id INTEGER NULL,
           sim_slot INTEGER NULL,
           from_msisdn TEXT NULL,
           to_msisdn TEXT NULL,
           body TEXT NULL,
           status TEXT NULL,
           error TEXT NULL,
           meta JSONB NULL,
           created_at TIMESTAMP NOT NULL DEFAULT NOW(),
           updated_at TIMESTAMP NOT NULL DEFAULT NOW()
         )`
      );
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_gateway_sms_messages_message_id
           ON public.mod_gateway_sms_messages (message_id)
           WHERE message_id IS NOT NULL`
      );
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_messages_created_at ON public.mod_gateway_sms_messages (created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_messages_from ON public.mod_gateway_sms_messages (from_msisdn)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_messages_to ON public.mod_gateway_sms_messages (to_msisdn)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_messages_org ON public.mod_gateway_sms_messages (org_id)`);
    } catch {}
    // Guarded FK to organizations(id)
    try {
      await pool.query(`
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
              ALTER TABLE public.mod_gateway_sms_messages
                ADD CONSTRAINT fk_mod_gateway_sms_messages_org
                FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
          END IF;
        END $$;
      `);
    } catch {}
    smsTableReady = true;
  }

  let smsStatusReady = false;
  async function ensureSmsStatusTable() {
    if (!pool || smsStatusReady) return;
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS public.mod_gateway_sms_status (
           id BIGSERIAL PRIMARY KEY,
           org_id INTEGER NULL,
           message_id TEXT NULL,
           status TEXT NULL,
           error TEXT NULL,
           raw JSONB NULL,
           created_at TIMESTAMP DEFAULT NOW()
         )`
      );
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_status_created ON public.mod_gateway_sms_status (created_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_status_msg ON public.mod_gateway_sms_status (message_id)`);
    } catch {}
    smsStatusReady = true;
  }

  let callLogsReady = false;
  async function ensureCallLogsTable() {
    if (!pool || callLogsReady) return;
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS public.mod_gateway_call_logs (
           id BIGSERIAL PRIMARY KEY,
           org_id INTEGER NULL,
           from_number TEXT NOT NULL,
           to_number TEXT NULL,
           direction TEXT NULL,
           status TEXT NULL,
           duration_sec INTEGER NULL,
           started_at TIMESTAMP NULL,
           ended_at TIMESTAMP NULL,
           raw JSONB NULL,
           created_at TIMESTAMP DEFAULT NOW()
         )`
      );
      // If the table already existed (legacy), ensure new columns exist (best-effort).
      // NOTE: legacy `public.call_logs` did not include org_id.
      try { await pool.query(`ALTER TABLE public.mod_gateway_call_logs ADD COLUMN IF NOT EXISTS org_id INTEGER NULL`); } catch {}
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gateway_call_logs_created ON public.mod_gateway_call_logs (created_at DESC)`);
    } catch {}
    callLogsReady = true;
  }

  function genMessageId() {
    try { return globalThis.crypto?.randomUUID?.() || `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
    catch { return `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
  }

  app.get('/api/gateway/ping', (_req, res) => res.json({ ok:true, module: 'gateway' }));

  // Admin: list Presta shops (ps_shop) to map id_shop -> subscription_id
  app.get('/api/admin/gateway/prestashop/shops', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
    const orgId = pickOrgId(req);
    const profileIdRaw = req.query?.profile_id || req.query?.mysql_profile_id || '';
    const profileId = Number(String(profileIdRaw || '').trim());
    if (!Number.isFinite(profileId) || profileId <= 0) {
      return res.status(400).json({ ok:false, error:'missing_profile_id', message:'profile_id required' });
    }
    const prefix = normalizePrefix(req.query?.prefix || 'ps_');
    let conn = null;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId ? String(orgId) : null, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);
      const tShop = `\`${prefix}shop\``;
      const rows = await q(`SELECT id_shop, name, active, id_shop_group FROM ${tShop} ORDER BY id_shop ASC`, []);
      const items = (rows || []).map((r) => ({
        id_shop: r?.id_shop != null ? Number(r.id_shop) : null,
        name: r?.name != null ? String(r.name) : '',
        active: r?.active != null ? Number(r.active) : null,
        id_shop_group: r?.id_shop_group != null ? Number(r.id_shop_group) : null,
      })).filter((x) => Number.isFinite(x.id_shop));
      return res.json({ ok:true, items, count: items.length, profile_id: profileId, prefix });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'mysql_query_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  // Admin: persist shop -> subscription mapping (and optional profile/prefix helper settings)
  app.get('/api/admin/gateway/shop-subscriptions', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
    const orgId = pickOrgId(req);
    try {
      const [rMap, rPid, rPref] = await Promise.all([
        readModSettingRow(KEY_SHOP_SUB_MAP, orgId),
        readModSettingRow(KEY_PRESTA_PROFILE_ID, orgId),
        readModSettingRow(KEY_PRESTA_PREFIX, orgId),
      ]);
      const mapping = safeParseJsonObject(rMap?.value) || {};
      const profileId = (() => {
        const v = String(rPid?.value || '').trim();
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : null;
      })();
      const prefix = normalizePrefix(rPref?.value || 'ps_');
      return res.json({
        ok: true,
        org_id: orgId,
        prestashop: { profile_id: profileId, prefix },
        mapping,
        updated_at: rMap?.updated_at || null,
      });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  app.post('/api/admin/gateway/shop-subscriptions', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
    const orgId = pickOrgId(req);
    const body = req.body || {};
    try {
      // Load existing mapping
      const rMap = await readModSettingRow(KEY_SHOP_SUB_MAP, orgId);
      const mapping = safeParseJsonObject(rMap?.value) || {};

      // Optional: persist Presta helper settings
      if (Object.prototype.hasOwnProperty.call(body, 'prestashop_profile_id')) {
        const n = Number(String(body.prestashop_profile_id || '').trim());
        if (Number.isFinite(n) && n > 0) await modSet(KEY_PRESTA_PROFILE_ID, String(Math.trunc(n)), orgId);
        else await modSet(KEY_PRESTA_PROFILE_ID, '', orgId);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'prestashop_prefix')) {
        const pref = normalizePrefix(body.prestashop_prefix || 'ps_');
        await modSet(KEY_PRESTA_PREFIX, pref, orgId);
      }

      // Update mapping (accept either full mapping OR a single pair)
      if (body.mapping && typeof body.mapping === 'object' && !Array.isArray(body.mapping)) {
        const next = {};
        for (const [k, v] of Object.entries(body.mapping)) {
          const idShop = Number(String(k).trim());
          const sub = Number(v);
          if (!Number.isFinite(idShop) || idShop <= 0) continue;
          if (!Number.isFinite(sub) || sub <= 0) continue;
          next[String(Math.trunc(idShop))] = Math.trunc(sub);
        }
        for (const k of Object.keys(mapping)) delete mapping[k];
        Object.assign(mapping, next);
      } else if (body.id_shop != null) {
        const idShop = Number(String(body.id_shop).trim());
        if (!Number.isFinite(idShop) || idShop <= 0) return res.status(400).json({ ok:false, error:'bad_request', message:'id_shop invalid' });
        const key = String(Math.trunc(idShop));
        const subRaw = body.subscription_id;
        if (subRaw === null || subRaw === '' || subRaw === undefined) {
          delete mapping[key];
        } else {
          const sub = Number(String(subRaw).trim());
          if (!Number.isFinite(sub) || sub <= 0) return res.status(400).json({ ok:false, error:'bad_request', message:'subscription_id invalid' });
          mapping[key] = Math.trunc(sub);
        }
      }

      await modSet(KEY_SHOP_SUB_MAP, JSON.stringify(mapping), orgId);
      const updated = await readModSettingRow(KEY_SHOP_SUB_MAP, orgId);
      return res.json({ ok:true, org_id: orgId, mapping, updated_at: updated?.updated_at || null });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // Diagnostics: list lines (module table name)
  app.get('/api/gateway/lines', async (_req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const r = await pool.query(`SELECT id, org_id, device_id, subscription_id, sim_slot, carrier, display_name, msisdn, last_seen FROM mod_gateway_lines ORDER BY last_seen DESC NULLS LAST, subscription_id`);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Admin: list lines + default subscription id (moved from server.js)
  app.get('/api/admin/gateway/lines', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const r = await pool.query(`SELECT id, org_id, device_id, subscription_id, sim_slot, carrier, display_name, msisdn, last_seen FROM mod_gateway_lines ORDER BY last_seen DESC NULLS LAST, subscription_id`);
      const defSub = await getSetting('SMS_DEFAULT_SUBSCRIPTION_ID').catch(()=>null);
      res.json({ ok:true, items: r.rows || [], default_subscription_id: defSub ? Number(defSub) : null });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  // Namespaced admin alias
  app.get('/api/gateway/admin/lines', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const r = await pool.query(`SELECT id, org_id, device_id, subscription_id, sim_slot, carrier, display_name, msisdn, last_seen FROM mod_gateway_lines ORDER BY last_seen DESC NULLS LAST, subscription_id`);
      const defSub = await getSetting('SMS_DEFAULT_SUBSCRIPTION_ID').catch(()=>null);
      res.json({ ok:true, items: r.rows || [], default_subscription_id: defSub ? Number(defSub) : null });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Admin: set default subscription id
  app.post('/api/admin/gateway/lines/default', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const sub = Number(req.body?.subscription_id || req.body?.sub_id || 0) || null;
      if (!sub) return res.status(400).json({ ok:false, error:'bad_request' });
      await setSetting('SMS_DEFAULT_SUBSCRIPTION_ID', String(sub));
      res.json({ ok:true, subscription_id: sub });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  // Namespaced admin alias
  app.post('/api/gateway/admin/lines/default', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const sub = Number(req.body?.subscription_id || req.body?.sub_id || 0) || null;
      if (!sub) return res.status(400).json({ ok:false, error:'bad_request' });
      await setSetting('SMS_DEFAULT_SUBSCRIPTION_ID', String(sub));
      res.json({ ok:true, subscription_id: sub });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Admin: upsert MSISDN for a subscription id
  app.post('/api/admin/gateway/lines/set_msisdn', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const sub = Number(req.body?.subscription_id || req.body?.sub_id || 0) || null;
      const msisdn = String(req.body?.msisdn || '').trim();
      if (!sub) return res.status(400).json({ ok:false, error:'bad_request' });
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await pool.query(
        `INSERT INTO mod_gateway_lines (subscription_id, msisdn, last_seen) VALUES ($1,$2,NOW())
         ON CONFLICT (subscription_id) DO UPDATE SET msisdn=EXCLUDED.msisdn, last_seen=NOW()`,
        [sub, msisdn || null]
      );
      res.json({ ok:true, subscription_id: sub, msisdn: msisdn || null });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  // Namespaced admin alias
  app.post('/api/gateway/admin/lines/set_msisdn', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const sub = Number(req.body?.subscription_id || req.body?.sub_id || 0) || null;
      const msisdn = String(req.body?.msisdn || '').trim();
      if (!sub) return res.status(400).json({ ok:false, error:'bad_request' });
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await pool.query(
        `INSERT INTO mod_gateway_lines (subscription_id, msisdn, last_seen) VALUES ($1,$2,NOW())
         ON CONFLICT (subscription_id) DO UPDATE SET msisdn=EXCLUDED.msisdn, last_seen=NOW()`,
        [sub, msisdn || null]
      );
      res.json({ ok:true, subscription_id: sub, msisdn: msisdn || null });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Admin: show gateway config (urls and token presence)
  app.get('/api/admin/gateway/config', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      // Prefer DB-configured public base; fall back to request headers
      const baseFromDb = (await modGet('GATEWAY_BASE_URL')) || (await getSetting('PUBLIC_BASE_URL')) || (await getSetting('GATEWAY_BASE_URL')) || '';
      const baseComputed = (() => {
        try {
          const fproto = String(req.headers['x-forwarded-proto']||'').split(',')[0]?.trim();
          const fhost = String(req.headers['x-forwarded-host']||'').split(',')[0]?.trim();
          const proto = (fproto || req.protocol || 'http').toLowerCase();
          const host = (fhost || req.headers.host || 'localhost').trim();
          return `${proto}://${host}`;
        } catch { return ''; }
      })();
      const base = String((baseFromDb || baseComputed || '').trim() || '') || '';
      const tok = (await modGet('GATEWAY_TOKEN')) || (await getSetting('GATEWAY_TOKEN'));
      const reveal = String(req.query?.reveal || '').trim() === '1';
      res.json({
        ok: true,
        base_url: base || null,
        endpoints: base ? { sms_incoming: `${base}/api/gateway/sms/incoming`, sms_status: `${base}/api/gateway/sms/status`, calls: `${base}/api/gateway/calls` } : null,
        legacy_endpoints: base ? { sms_incoming: `${base}/api/sms/incoming`, sms_status: `${base}/api/sms/status`, calls: `${base}/api/calls` } : null,
        has_token: !!tok,
        token: reveal ? (tok || null) : undefined,
        source: baseFromDb ? 'db' : (base ? 'request' : null),
      });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message||String(e) }); }
  });
  // Admin: set public base URL for endpoints
  app.post('/api/admin/gateway/base-url', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const raw = String(req.body?.base_url || req.body?.baseUrl || '').trim();
      if (!raw) return res.status(400).json({ ok:false, error:'bad_request' });
      // Basic validation: must be http(s) URL without trailing slash
      try {
        const url = new URL(raw);
        if (!/^https?:$/.test(url.protocol)) return res.status(400).json({ ok:false, error:'invalid_scheme' });
        try { url.hash = ''; url.search = ''; } catch {}
        const norm = `${url.protocol}//${url.host}` + (url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/$/, '') : '');
        // Prefer module-scoped storage; keep global as fallback for compatibility
        await modSet('GATEWAY_BASE_URL', norm, null);
        try { await setSetting('PUBLIC_BASE_URL', norm); } catch {}
        return res.json({ ok:true, base_url: norm });
      } catch { return res.status(400).json({ ok:false, error:'invalid_url' }); }
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.get('/api/admin/gateway/status', (_req, res) => {
    try {
      const ns = io ? io.of('/gateway') : null;
      const { socket_count, device_socket_count, temp_socket_count } = getGatewaySocketCounts(ns);
      const payload = {
        ok: true,
        socket_connected: socket_count > 0,
        socket_count,
        device_socket_connected: device_socket_count > 0,
        device_socket_count,
        temp_socket_count,
        socket_since: gatewayConnectedAt ? new Date(gatewayConnectedAt).toISOString() : null,
        last_activity_at: gatewayLastActivityAt ? new Date(gatewayLastActivityAt).toISOString() : null,
      };
      return res.json(payload);
    } catch { return res.json({ ok:true, socket_connected:false, socket_count:0 }); }
  });
  // Namespaced admin alias
  app.get('/api/gateway/admin/status', (_req, res) => {
    try {
      const ns = io ? io.of('/gateway') : null;
      const { socket_count, device_socket_count, temp_socket_count } = getGatewaySocketCounts(ns);
      const payload = {
        ok: true,
        socket_connected: socket_count > 0,
        socket_count,
        device_socket_connected: device_socket_count > 0,
        device_socket_count,
        temp_socket_count,
        socket_since: gatewayConnectedAt ? new Date(gatewayConnectedAt).toISOString() : null,
        last_activity_at: gatewayLastActivityAt ? new Date(gatewayLastActivityAt).toISOString() : null,
      };
      return res.json(payload);
    } catch { return res.json({ ok:true, socket_connected:false, socket_count:0 }); }
  });
  app.post('/api/admin/gateway/test', async (_req, res) => {
    if (!io) return res.status(503).json({ ok:false, error:'socket_unavailable' });
    try {
      const ns = io.of('/gateway');
      const allSockets = listNamespaceSockets(ns);
      const deviceSockets = filterDeviceSockets(allSockets);
      if (!allSockets.length) return res.status(503).json({ ok:false, error:'no_client' });
      if (!deviceSockets.length) {
        const { socket_count, device_socket_count, temp_socket_count } = getGatewaySocketCounts(ns);
        return res.status(503).json({ ok:false, error:'no_device', details: { socket_count, device_socket_count, temp_socket_count } });
      }
      const count = deviceSockets.length;
      const timeoutMs = Number(process.env.GATEWAY_PING_TIMEOUT_MS || 2000);
      let acked = false; let ackData = null; let errText = null;
      try {
        // Prefer the last connected socket if still present
        let sock = lastSocket && lastSocket.id ? deviceSockets.find((s) => s && s.id === lastSocket.id) : null;
        if (!sock) sock = deviceSockets[0] || null;
        if (!sock) throw new Error('no_client');
        await new Promise((resolve) => {
          try {
            sock.timeout(timeoutMs).emit('server:ping', { ts: Date.now() }, (err, data) => {
              const ok = !err && (data === true || (data && typeof data === 'object' && data.ok === true));
              if (ok) { acked = true; ackData = data || null; }
              else { ackData = data || null; errText = err ? String(err?.message || err || 'timeout') : String((data && (data.error || data.message)) || 'no_ack'); }
              resolve();
            });
          } catch (e) { errText = String(e?.message || e); resolve(); }
        });
      } catch (e) { errText = String(e?.message || e); }
      const payload = {
        ok: acked,
        error: acked ? null : (errText || 'no_ack'),
        socket_count: count,
        socket_since: gatewayConnectedAt ? new Date(gatewayConnectedAt).toISOString() : null,
        last_activity_at: gatewayLastActivityAt ? new Date(gatewayLastActivityAt).toISOString() : null,
        ack: ackData || null,
      };
      return res.json(payload);
    } catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  });
  // Namespaced admin alias
  app.post('/api/gateway/admin/test', async (_req, res) => {
    if (!io) return res.status(503).json({ ok:false, error:'socket_unavailable' });
    try {
      const ns = io.of('/gateway');
      const allSockets = listNamespaceSockets(ns);
      const deviceSockets = filterDeviceSockets(allSockets);
      if (!allSockets.length) return res.status(503).json({ ok:false, error:'no_client' });
      if (!deviceSockets.length) {
        const { socket_count, device_socket_count, temp_socket_count } = getGatewaySocketCounts(ns);
        return res.status(503).json({ ok:false, error:'no_device', details: { socket_count, device_socket_count, temp_socket_count } });
      }
      const count = deviceSockets.length;
      const timeoutMs = Number(process.env.GATEWAY_PING_TIMEOUT_MS || 2000);
      let acked = false; let ackData = null; let errText = null;
      try {
        let sock = lastSocket && lastSocket.id ? deviceSockets.find((s) => s && s.id === lastSocket.id) : null;
        if (!sock) sock = deviceSockets[0] || null;
        if (!sock) throw new Error('no_client');
        await new Promise((resolve) => {
          try {
            sock.timeout(timeoutMs).emit('server:ping', { ts: Date.now() }, (err, data) => {
              const ok = !err && (data === true || (data && typeof data === 'object' && data.ok === true));
              if (ok) { acked = true; ackData = data || null; }
              else { ackData = data || null; errText = err ? String(err?.message || err || 'timeout') : String((data && (data.error || data.message)) || 'no_ack'); }
              resolve();
            });
          } catch (e) { errText = String(e?.message || e); resolve(); }
        });
      } catch (e) { errText = String(e?.message || e); }
      const payload = {
        ok: acked,
        error: acked ? null : (errText || 'no_ack'),
        socket_count: count,
        socket_since: gatewayConnectedAt ? new Date(gatewayConnectedAt).toISOString() : null,
        last_activity_at: gatewayLastActivityAt ? new Date(gatewayLastActivityAt).toISOString() : null,
        ack: ackData || null,
      };
      return res.json(payload);
    } catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  });
  app.post('/api/admin/gateway/token/regenerate', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try { const tok = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)) + '-' + Math.random().toString(16).slice(2); await modSet('GATEWAY_TOKEN', tok, null); try { await setSetting('GATEWAY_TOKEN', tok); } catch {}; res.json({ ok:true, token: tok }); }
    catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message||String(e) }); }
  });
  app.post('/api/admin/gateway/token', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try { const tok = String(req.body?.token||'').trim(); if (!tok) return res.status(400).json({ ok:false, error:'bad_request' }); await modSet('GATEWAY_TOKEN', tok, null); try { await setSetting('GATEWAY_TOKEN', tok); } catch {}; res.json({ ok:true }); }
    catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message||String(e) }); }
  });

  // Socket.IO namespace for Android gateway
  if (io) {
    const ns = io.of('/gateway');
    ns.use(async (socket, next) => {
      try {
        const provided = String(socket?.handshake?.query?.token || socket?.handshake?.auth?.token || (socket?.handshake?.headers?.authorization||'').replace(/^Bearer\s+/i,'') || '').trim();
        const expected = String((await modGet('GATEWAY_TOKEN')) || (await getSetting('GATEWAY_TOKEN')) || '');
        if (expected && provided && provided === expected) return next();
      } catch {}
      try {
        const ua = socket?.handshake?.headers?.['user-agent'] ? String(socket.handshake.headers['user-agent']).slice(0, 160) : null;
        const origin = socket?.handshake?.headers?.origin ? String(socket.handshake.headers.origin).slice(0, 160) : null;
        const ip = socket?.handshake?.address ? String(socket.handshake.address).slice(0, 80) : null;
        pushLog({ kind: 'unauthorized_ws', ua, origin, ip });
        log(`unauthorized_ws ip=${ip || '-'} origin=${origin || '-'} ua=${ua || '-'}`);
      } catch {}
      next(new Error('unauthorized'));
    });
    ns.on('connection', (socket) => {
      try { log(`ws connected ${socket.id}`); } catch {}
      try {
        const kind = socketClientKind(socket);
        try { socket.data.gateway_client_kind = kind; } catch {}
        gatewaySocketMeta.set(socket.id, {
          kind,
          connected_at: Date.now(),
          last_seen: Date.now(),
          ua: socket?.handshake?.headers?.['user-agent'] ? String(socket.handshake.headers['user-agent']).slice(0, 120) : null,
          origin: socket?.handshake?.headers?.origin ? String(socket.handshake.headers.origin).slice(0, 120) : null,
        });
        gatewaySocketIds.add(socket.id);
        lastSocket = socket;
        if (!gatewayConnectedAt) gatewayConnectedAt = Date.now();
        gatewayLastActivityAt = Date.now();
      } catch {}
      // Observe generic activity
      const touch = () => {
        try { gatewayLastActivityAt = Date.now(); } catch {}
        try { const m = gatewaySocketMeta.get(socket.id); if (m) m.last_seen = Date.now(); } catch {}
      };
      try { socket.onAny(touch); } catch {}
      // Optional echo handlers for diagnostics
      try { socket.on('client:ping', (payload, cb) => { touch(); if (typeof cb === 'function') cb({ ok:true, pong:true, ts: Date.now(), payload }); }); } catch {}
      // Client-originated 'sms:send' can be used for loopback/testing; acknowledge only.
      try { socket.on('sms:send', (payload, cb) => { touch(); pushLog({ kind:'device_ack', event:'sms:send', ok:true, payload }); if (typeof cb === 'function') cb({ ok:true, loopback:true }); }); } catch {}

      // Phone → server over socket: incoming SMS (alternative to HTTP POST /api/gateway/sms/incoming)
      try {
        socket.on('sms:incoming', async (payload, cb) => {
          touch();
          try {
            if (!pool) throw new Error('db_unavailable');
            await ensureSmsMessagesTable();
            const b = payload || {};
            const message_id = String(b.message_id || b.id || '').trim() || null;
            const device_id = (typeof b.device_id === 'string' && b.device_id.trim()) || socket.id;
            const subscription_id = b.subscription_id != null ? Number(b.subscription_id) : (b.sub_id != null ? Number(b.sub_id) : null);
            const sim_slot = b.sim_slot != null ? Number(b.sim_slot) : (b.sim != null ? Number(b.sim) : null);
            const from = String(b.from || b.from_msisdn || b.msisdn || '').trim();
            const to = String(b.to || b.to_msisdn || '').trim();
            const body = String(b.message || b.text || b.body || '').trim();
            if (!from || !body) throw new Error('bad_request');

            await pool.query(
              `INSERT INTO public.mod_gateway_sms_messages
                 (org_id, direction, message_id, device_id, subscription_id, sim_slot, from_msisdn, to_msisdn, body, status, error, meta, created_at, updated_at)
               VALUES
                 (NULL, 'in', $1, $2, $3, $4, $5, $6, $7, 'received', NULL, $8::jsonb, NOW(), NOW())
               ON CONFLICT (message_id) WHERE message_id IS NOT NULL
               DO UPDATE SET
                 device_id=EXCLUDED.device_id,
                 subscription_id=EXCLUDED.subscription_id,
                 sim_slot=EXCLUDED.sim_slot,
                 from_msisdn=EXCLUDED.from_msisdn,
                 to_msisdn=EXCLUDED.to_msisdn,
                 body=EXCLUDED.body,
                 status=EXCLUDED.status,
                 error=EXCLUDED.error,
                 meta=EXCLUDED.meta,
                 updated_at=NOW()`,
              [
                message_id,
                device_id || null,
                Number.isFinite(subscription_id) ? subscription_id : null,
                Number.isFinite(sim_slot) ? sim_slot : null,
                from || null,
                to || null,
                body || null,
                JSON.stringify({ source: 'socket', socket_id: socket.id }),
              ]
            );
            try { pushLog({ kind:'incoming_sms', via: 'socket', from: from || null, to: to || null, message_len: (body || '').length }); } catch {}
            if (typeof cb === 'function') cb({ ok:true });
          } catch (e) {
            try { pushLog({ kind:'sms_incoming_error', via: 'socket', error: String(e?.message || e) }); } catch {}
            if (typeof cb === 'function') cb({ ok:false, error: String(e?.message || e) });
          }
        });
      } catch {}

      // Phone → server over socket: SMS status update (alternative to HTTP POST /api/gateway/sms/status)
      try {
        socket.on('sms:status', async (payload, cb) => {
          touch();
          try {
            if (!pool) throw new Error('db_unavailable');
            await ensureSmsMessagesTable();
            await ensureSmsStatusTable();
            const b = payload || {};
            const message_id = String(b.message_id || b.id || '').trim();
            const status = String(b.status || b.state || b.event || '').trim();
            const error = b.error != null ? String(b.error).trim() : null;
            if (!message_id) throw new Error('bad_request');

            await pool.query(
              `UPDATE public.mod_gateway_sms_messages
                 SET status=$2, error=$3, updated_at=NOW()
               WHERE message_id=$1`,
              [message_id, status || null, error]
            );
            try {
              await pool.query(
                `INSERT INTO public.mod_gateway_sms_status (org_id, message_id, status, error, raw, created_at)
                 VALUES (NULL, $1, $2, $3, $4::jsonb, NOW())`,
                [message_id, status || null, error, JSON.stringify(b || {})]
              );
            } catch {}
            try { pushLog({ kind:'sms_status', via: 'socket', message_id, status: status || null }); } catch {}
            if (typeof cb === 'function') cb({ ok:true });
          } catch (e) {
            try { pushLog({ kind:'sms_status_error', via: 'socket', error: String(e?.message || e) }); } catch {}
            if (typeof cb === 'function') cb({ ok:false, error: String(e?.message || e) });
          }
        });
      } catch {}

      // Phone → server over socket: call log (alternative to HTTP POST /api/gateway/calls)
      try {
        socket.on('call:log', async (payload, cb) => {
          touch();
          try {
            if (!pool) throw new Error('db_unavailable');
            await ensureCallLogsTable();
            const b = payload || {};
            const from_number = String(b.from_number || b.from || b.from_msisdn || '').trim();
            const to_number = String(b.to_number || b.to || b.to_msisdn || '').trim() || null;
            const direction = b.direction != null ? String(b.direction).trim() : null;
            const status = b.status != null ? String(b.status).trim() : null;
            const duration_sec = b.duration_sec != null ? Number(b.duration_sec) : (b.duration != null ? Number(b.duration) : null);
            const started_at = b.started_at ? new Date(b.started_at) : null;
            const ended_at = b.ended_at ? new Date(b.ended_at) : null;
            if (!from_number) throw new Error('bad_request');
            await pool.query(
              `INSERT INTO public.mod_gateway_call_logs
                 (org_id, from_number, to_number, direction, status, duration_sec, started_at, ended_at, raw, created_at)
               VALUES
                 (NULL, $1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())`,
              [
                from_number,
                to_number,
                direction,
                status,
                Number.isFinite(duration_sec) ? duration_sec : null,
                started_at instanceof Date && !Number.isNaN(started_at.getTime()) ? started_at.toISOString() : null,
                ended_at instanceof Date && !Number.isNaN(ended_at.getTime()) ? ended_at.toISOString() : null,
                JSON.stringify(b || {}),
              ]
            );
            try { pushLog({ kind:'call_log', via: 'socket', from: from_number, to: to_number }); } catch {}
            if (typeof cb === 'function') cb({ ok:true });
          } catch (e) {
            try { pushLog({ kind:'call_log_error', via: 'socket', error: String(e?.message || e) }); } catch {}
            if (typeof cb === 'function') cb({ ok:false, error: String(e?.message || e) });
          }
        });
      } catch {}

      socket.on('disconnect', () => {
        try { log(`ws disconnected ${socket.id}`); } catch {}
        try { gatewaySocketIds.delete(socket.id); gatewaySocketMeta.delete(socket.id); gatewayLastActivityAt = Date.now(); if (lastSocket && lastSocket.id === socket.id) lastSocket = null; } catch {}
      });
    });
  }

  // Admin: list currently connected gateway sockets (diagnostics)
  app.get('/api/admin/gateway/sockets', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!io) return res.status(503).json({ ok:false, error:'socket_unavailable' });
      const ns = io.of('/gateway');
      const sockets = listNamespaceSockets(ns);
      const items = sockets.map((s) => {
        const meta = gatewaySocketMeta.get(s.id) || null;
        const kind = socketClientKind(s);
        return {
          id: s.id,
          kind,
          ua: meta?.ua || (s?.handshake?.headers?.['user-agent'] ? String(s.handshake.headers['user-agent']).slice(0, 160) : null),
          origin: meta?.origin || (s?.handshake?.headers?.origin ? String(s.handshake.headers.origin).slice(0, 160) : null),
          connected_at: meta?.connected_at ? new Date(meta.connected_at).toISOString() : null,
          last_seen: meta?.last_seen ? new Date(meta.last_seen).toISOString() : null,
        };
      });
      return res.json({ ok:true, count: items.length, items });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
  // Namespaced admin alias
  app.get('/api/gateway/admin/sockets', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!io) return res.status(503).json({ ok:false, error:'socket_unavailable' });
      const ns = io.of('/gateway');
      const sockets = listNamespaceSockets(ns);
      const items = sockets.map((s) => {
        const meta = gatewaySocketMeta.get(s.id) || null;
        const kind = socketClientKind(s);
        return {
          id: s.id,
          kind,
          ua: meta?.ua || (s?.handshake?.headers?.['user-agent'] ? String(s.handshake.headers['user-agent']).slice(0, 160) : null),
          origin: meta?.origin || (s?.handshake?.headers?.origin ? String(s.handshake.headers.origin).slice(0, 160) : null),
          connected_at: meta?.connected_at ? new Date(meta.connected_at).toISOString() : null,
          last_seen: meta?.last_seen ? new Date(meta.last_seen).toISOString() : null,
        };
      });
      return res.json({ ok:true, count: items.length, items });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Admin: list persisted SMS inbox/outbox (DB-backed)
  app.get('/api/admin/gateway/sms/inbox', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureSmsMessagesTable();

      const limitRaw = Number(req.query?.limit || 200);
      const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 200));
      const phone = String(req.query?.phone || '').trim();
      const direction = String(req.query?.direction || '').trim(); // optional: 'in'|'out'
      const statusFilter = String(req.query?.status || '').trim();

      const where = [];
      const params = [];
      if (phone) {
        params.push(phone);
        where.push(`(from_msisdn = $${params.length} OR to_msisdn = $${params.length})`);
      }
      if (direction === 'in' || direction === 'out') {
        params.push(direction);
        where.push(`direction = $${params.length}`);
      }
      if (statusFilter) {
        params.push(statusFilter);
        where.push(`status = $${params.length}`);
      }
      params.push(limit);

      const r = await pool.query(
        `
        SELECT
          id, org_id, direction, message_id, device_id, subscription_id, sim_slot,
          from_msisdn, to_msisdn, body, status, error, created_at, updated_at
        FROM public.mod_gateway_sms_messages
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY id DESC
        LIMIT $${params.length}
        `,
        params
      );
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Admin: delete an entire SMS conversation (all messages to/from a peer phone)
  app.delete('/api/admin/gateway/sms/conversation', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureSmsMessagesTable();
      const phone = String(req.query?.phone || '').trim();
      if (!phone) return res.status(400).json({ ok:false, error:'bad_request', message:'phone required' });
      const r = await pool.query(
        `DELETE FROM public.mod_gateway_sms_messages WHERE from_msisdn=$1 OR to_msisdn=$1`,
        [phone]
      );
      // Best-effort: if a conversation metadata table exists (legacy), clear it too
      try {
        await pool.query(`DELETE FROM public.mod_gateway_sms_conversation WHERE phone=$1`, [phone]);
      } catch {}
      try { pushLog({ kind:'sms_conversation_deleted', phone, deleted: r.rowCount || 0 }); } catch {}
      return res.json({ ok:true, phone, deleted: r.rowCount || 0 });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Admin: inject an incoming SMS for testing (does not require GATEWAY_TOKEN)
  app.post('/api/admin/gateway/sms/incoming-test', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureSmsMessagesTable();
      const b = req.body || {};
      const from = String(b.from || b.from_msisdn || b.msisdn || '').trim();
      const to = String(b.to || b.to_msisdn || '').trim();
      const body = String(b.message || b.text || b.body || '').trim();
      const message_id = String(b.message_id || b.id || '').trim() || genMessageId();
      if (!from || !body) return res.status(400).json({ ok:false, error:'bad_request', message:'from + message required' });

      const r = await pool.query(
        `INSERT INTO public.mod_gateway_sms_messages
           (org_id, direction, message_id, device_id, subscription_id, sim_slot, from_msisdn, to_msisdn, body, status, error, meta, created_at, updated_at)
         VALUES
           (NULL, 'in', $1, NULL, NULL, NULL, $2, $3, $4, 'received', NULL, $5::jsonb, NOW(), NOW())
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL
         DO UPDATE SET
           from_msisdn=EXCLUDED.from_msisdn,
           to_msisdn=EXCLUDED.to_msisdn,
           body=EXCLUDED.body,
           status=EXCLUDED.status,
           meta=EXCLUDED.meta,
           updated_at=NOW()
         RETURNING id`,
        [message_id, from, to || null, body, JSON.stringify({ source: 'admin_test' })]
      );
      try { pushLog({ kind:'incoming_sms_test', from, to: to || null, message: body }); } catch {}
      return res.json({ ok:true, id: r.rowCount ? r.rows[0].id : null, message_id });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Admin: forward an SMS send command to a connected gateway client over Socket.IO
  app.post('/api/admin/gateway/sms/send', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureSmsMessagesTable();
      if (!io) return res.status(503).json({ ok:false, error:'socket_unavailable' });
      const ns = io.of('/gateway');
      const to = String(req.body?.to || req.body?.number || '').trim();
      const message = String(req.body?.message || req.body?.text || '').trim();
      const subscription_id = req.body?.subscription_id != null ? Number(req.body.subscription_id) : null;
      if (!to || !message) return res.status(400).json({ ok:false, error:'bad_request' });

      // Resolve from_msisdn from the selected line (best-effort)
      let from_msisdn = null;
      try {
        if (subscription_id != null && Number.isFinite(subscription_id)) {
          const rLine = await pool.query(
            `SELECT msisdn FROM public.mod_gateway_lines WHERE subscription_id=$1 LIMIT 1`,
            [subscription_id]
          );
          from_msisdn = rLine.rowCount ? (rLine.rows[0].msisdn || null) : null;
        }
      } catch {}

      const message_id = genMessageId();
      let rowId = null;
      try {
        const rIns = await pool.query(
          `INSERT INTO public.mod_gateway_sms_messages
             (org_id, direction, message_id, device_id, subscription_id, sim_slot, from_msisdn, to_msisdn, body, status, error, meta, created_at, updated_at)
           VALUES
             (NULL, 'out', $1, NULL, $2, NULL, $3, $4, $5, 'queued', NULL, $6::jsonb, NOW(), NOW())
           RETURNING id`,
          [message_id, subscription_id, from_msisdn, to, message, JSON.stringify({ via: 'socket', source: 'admin' })]
        );
        rowId = rIns.rowCount ? rIns.rows[0].id : null;
      } catch {}

      const allSockets = listNamespaceSockets(ns);
      const sockets = filterDeviceSockets(allSockets);
      if (!sockets.length) {
        try {
          await pool.query(
            `UPDATE public.mod_gateway_sms_messages SET status=$2, error=$3, updated_at=NOW() WHERE message_id=$1`,
            [message_id, 'no_device', 'no_device']
          );
        } catch {}
        const { socket_count, device_socket_count, temp_socket_count } = getGatewaySocketCounts(ns);
        return res.status(503).json({ ok:false, error:'no_device', message_id, id: rowId, details: { socket_count, device_socket_count, temp_socket_count } });
      }

      const payload = { message_id, to, message, subscription_id: subscription_id ?? undefined };
      const timeoutMs = Number(process.env.GATEWAY_FORWARD_TIMEOUT_MS || process.env.GATEWAY_PING_TIMEOUT_MS || 2500);
      const startedAt = Date.now();
      let first = null;
      let lastErr = null;
      let lastAck = null;
      let lastSock = null;
      for (const s of sockets) {
        const r = await emitWithAck(s, 'sms:send', payload, timeoutMs);
        lastSock = s.id;
        lastAck = r.ack || null;
        if (r.ok) { first = { ok: true, error: null, ack: r.ack || null, socket: s.id }; break; }
        lastErr = r.error || 'no_ack';
      }
      if (!first) first = { ok: false, error: lastErr || 'no_ack', ack: lastAck || null, socket: lastSock || null };
      const elapsed = Date.now() - startedAt;
      try { pushLog({ kind:'send', to, subscription_id, ok: first.ok, error: first.error || null, ack: first.ack || null, socket: first.socket || null, ms: elapsed }); } catch {}
      try {
        await pool.query(
          `UPDATE public.mod_gateway_sms_messages
             SET status=$2, error=$3, updated_at=NOW(), device_id=COALESCE(device_id, $4)
           WHERE message_id=$1`,
          [
            message_id,
            first.ok ? 'device_ack' : 'device_nack',
            first.ok ? null : (first.error || 'no_ack'),
            first.socket || null,
          ]
        );
      } catch {}
      return res.json({ ok: first.ok, error: first.ok ? null : (first.error || 'no_ack'), ack: first.ack || null, ms: elapsed, message_id, id: rowId });
    } catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  });

  // Admin: forward a CALL make command to a connected gateway client over Socket.IO
  const forwardCall = async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!io) return res.status(503).json({ ok:false, error:'socket_unavailable' });
      const ns = io.of('/gateway');
      const to = String(req.body?.to || req.body?.number || '').trim();
      const subscription_id = req.body?.subscription_id != null ? Number(req.body.subscription_id) : null;
      if (!to) return res.status(400).json({ ok:false, error:'bad_request' });
      const allSockets = listNamespaceSockets(ns);
      const sockets = filterDeviceSockets(allSockets);
      if (!sockets.length) {
        const { socket_count, device_socket_count, temp_socket_count } = getGatewaySocketCounts(ns);
        return res.status(503).json({ ok:false, error:'no_device', details: { socket_count, device_socket_count, temp_socket_count } });
      }
      const payload = { to, subscription_id: subscription_id ?? undefined };
      const timeoutMs = Number(process.env.GATEWAY_FORWARD_TIMEOUT_MS || process.env.GATEWAY_PING_TIMEOUT_MS || 2500);
      const startedAt = Date.now();
      let first = null;
      let lastErr = null;
      let lastAck = null;
      let lastSock = null;
      for (const s of sockets) {
        const r = await emitWithAck(s, 'call:make', payload, timeoutMs);
        lastSock = s.id;
        lastAck = r.ack || null;
        if (r.ok) { first = { ok: true, error: null, ack: r.ack || null, socket: s.id }; break; }
        lastErr = r.error || 'no_ack';
      }
      if (!first) first = { ok: false, error: lastErr || 'no_ack', ack: lastAck || null, socket: lastSock || null };
      const elapsed = Date.now() - startedAt;
      try { pushLog({ kind:'call', to, subscription_id, ok: first.ok, error: first.error || null, ack: first.ack || null, socket: first.socket || null, ms: elapsed }); } catch {}
      return res.json({ ok: first.ok, error: first.ok ? null : (first.error || 'no_ack'), ack: first.ack || null, ms: elapsed });
    } catch (e) { return res.status(500).json({ ok:false, error:String(e?.message||e) }); }
  };
  app.post('/api/admin/gateway/call/make', forwardCall);
  app.post('/api/admin/gateway/call', forwardCall);
  app.post('/api/admin/gateway/calls/make', forwardCall);

  // Admin: recent logs (in-memory)
  app.get('/api/admin/gateway/logs', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try { res.json({ ok:true, items: recent.slice().reverse() }); } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });
  app.post('/api/admin/gateway/logs/clear', (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try { while (recent.length) recent.pop(); res.json({ ok:true }); } catch (e) { res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Phone reports active lines over HTTP (authorized by GATEWAY_TOKEN)
  app.post('/api/gateway/lines', async (req, res) => {
    try {
      if (!(await isGatewayAuthorized(req))) {
        logUnauthorized(req, 'unauthorized_lines');
        return res.status(401).json({ ok:false, error:'unauthorized' });
      }
    } catch {
      logUnauthorized(req, 'unauthorized_lines');
      return res.status(401).json({ ok:false, error:'unauthorized' });
    }
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const b = req.body || {};
      const deviceId = (typeof b.device_id === 'string' && b.device_id.trim()) || null;
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!lines.length) return res.json({ ok:true, updated: 0 });
      let updated = 0;
      for (const x of lines) {
        const sub = Number(x.subscription_id || x.sub_id || 0) || null;
        const slot = (x.sim_slot != null) ? Number(x.sim_slot) : (x.sim != null ? Number(x.sim) : null);
        const carrier = typeof x.carrier === 'string' ? x.carrier : null;
        const dn = typeof x.display_name === 'string' ? x.display_name : null;
        const msisdn = typeof x.msisdn === 'string' ? x.msisdn : null;
        if (!sub && !msisdn) continue;
        await pool.query(
          `INSERT INTO mod_gateway_lines (device_id, subscription_id, sim_slot, carrier, display_name, msisdn, last_seen)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (subscription_id) DO UPDATE SET device_id=EXCLUDED.device_id, sim_slot=EXCLUDED.sim_slot, carrier=EXCLUDED.carrier, display_name=EXCLUDED.display_name, msisdn=EXCLUDED.msisdn, last_seen=NOW()`,
          [deviceId, sub, slot, carrier, dn, msisdn]
        );
        updated++;
      }
      try { gatewayLastActivityAt = Date.now(); } catch {}
      try { pushLog({ kind:'lines', device_id: deviceId, count: lines.length, updated }); } catch {}
      res.json({ ok:true, updated });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Minimal SMS endpoints (accept + 200) — namespaced per AGENTS.md
  app.post('/api/gateway/sms/incoming', async (req, res) => {
    try {
      if (!(await isGatewayAuthorized(req))) {
        logUnauthorized(req, 'unauthorized_sms_incoming');
        return res.status(401).json({ ok:false, error:'unauthorized' });
      }
    } catch {
      logUnauthorized(req, 'unauthorized_sms_incoming');
      return res.status(401).json({ ok:false, error:'unauthorized' });
    }
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureSmsMessagesTable();
      const b = req.body || {};
      const message_id = String(b.message_id || b.id || '').trim() || null;
      const device_id = (typeof b.device_id === 'string' && b.device_id.trim()) || null;
      const subscription_id = b.subscription_id != null ? Number(b.subscription_id) : (b.sub_id != null ? Number(b.sub_id) : null);
      const sim_slot = b.sim_slot != null ? Number(b.sim_slot) : (b.sim != null ? Number(b.sim) : null);
      const from = String(b.from || b.from_msisdn || b.msisdn || '').trim();
      const to = String(b.to || b.to_msisdn || '').trim();
      const body = String(b.message || b.text || b.body || '').trim();
      if (!from && !to && !body) return res.status(400).json({ ok:false, error:'bad_request' });

      await pool.query(
        `INSERT INTO public.mod_gateway_sms_messages
           (org_id, direction, message_id, device_id, subscription_id, sim_slot, from_msisdn, to_msisdn, body, status, error, meta, created_at, updated_at)
         VALUES
           (NULL, 'in', $1, $2, $3, $4, $5, $6, $7, 'received', NULL, $8::jsonb, NOW(), NOW())
         ON CONFLICT (message_id) WHERE message_id IS NOT NULL
         DO UPDATE SET
           device_id=EXCLUDED.device_id,
           subscription_id=EXCLUDED.subscription_id,
           sim_slot=EXCLUDED.sim_slot,
           from_msisdn=EXCLUDED.from_msisdn,
           to_msisdn=EXCLUDED.to_msisdn,
           body=EXCLUDED.body,
           status=EXCLUDED.status,
           error=EXCLUDED.error,
           meta=EXCLUDED.meta,
           updated_at=NOW()`,
        [
          message_id,
          device_id,
          Number.isFinite(subscription_id) ? subscription_id : null,
          Number.isFinite(sim_slot) ? sim_slot : null,
          from || null,
          to || null,
          body || null,
          JSON.stringify({ source: 'http' }),
        ]
      );
      try { gatewayLastActivityAt = Date.now(); } catch {}
      try { pushLog({ kind:'incoming_sms', via: 'http', from: from || null, to: to || null, message_len: (body || '').length }); } catch {}
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  app.post('/api/gateway/sms/status', async (req, res) => {
    try {
      if (!(await isGatewayAuthorized(req))) {
        logUnauthorized(req, 'unauthorized_sms_status');
        return res.status(401).json({ ok:false, error:'unauthorized' });
      }
    } catch {
      logUnauthorized(req, 'unauthorized_sms_status');
      return res.status(401).json({ ok:false, error:'unauthorized' });
    }
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureSmsMessagesTable();
      await ensureSmsStatusTable();
      const b = req.body || {};
      const message_id = String(b.message_id || b.id || '').trim();
      const status = String(b.status || b.state || b.event || '').trim();
      const error = b.error != null ? String(b.error).trim() : null;
      if (!message_id) return res.status(400).json({ ok:false, error:'bad_request' });

      const r = await pool.query(
        `UPDATE public.mod_gateway_sms_messages
           SET status=$2, error=$3, updated_at=NOW()
         WHERE message_id=$1`,
        [message_id, status || null, error]
      );
      try {
        await pool.query(
          `INSERT INTO public.mod_gateway_sms_status (org_id, message_id, status, error, raw, created_at)
           VALUES (NULL, $1, $2, $3, $4::jsonb, NOW())`,
          [message_id, status || null, error, JSON.stringify(b || {})]
        );
      } catch {}
      try { gatewayLastActivityAt = Date.now(); } catch {}
      try { pushLog({ kind:'sms_status', message_id, status: status || null, error: error || null, updated: r.rowCount || 0 }); } catch {}
      return res.json({ ok:true, updated: r.rowCount || 0 });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
  // Phone → server: call logs (authorized by GATEWAY_TOKEN)
  app.post('/api/gateway/calls', async (req, res) => {
    try {
      if (!(await isGatewayAuthorized(req))) {
        logUnauthorized(req, 'unauthorized_calls');
        return res.status(401).json({ ok:false, error:'unauthorized' });
      }
    } catch {
      logUnauthorized(req, 'unauthorized_calls');
      return res.status(401).json({ ok:false, error:'unauthorized' });
    }
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureCallLogsTable();
      const b = req.body || {};

      // Bulk upload: { calls: [{ number, type, date, duration, ... }, ...] }
      // Used by Android CallLog pushers.
      try {
        if (Array.isArray(b.calls)) {
          let inserted = 0;
          for (const item of b.calls) {
            const c = item || {};
            const num = String(c.number || c.from || c.from_number || c.msisdn || '').trim();
            if (!num) continue;
            const type = c.type != null ? Number(c.type) : null; // CallLog: 1=in,2=out,3=missed
            const direction =
              type === 1 ? 'in' :
              type === 2 ? 'out' :
              null;
            const duration_sec = c.duration != null ? Number(c.duration) : (c.duration_sec != null ? Number(c.duration_sec) : null);
            const startedAt = c.date != null ? new Date(Number(c.date)) : (c.started_at ? new Date(c.started_at) : null);
            const startedIso =
              startedAt instanceof Date && !Number.isNaN(startedAt.getTime()) ? startedAt.toISOString() : null;
            const endedIso =
              startedIso && Number.isFinite(duration_sec) && duration_sec > 0
                ? new Date(startedAt.getTime() + Math.floor(duration_sec * 1000)).toISOString()
                : null;
            const status =
              type === 3 ? 'missed' :
              (Number.isFinite(duration_sec) && duration_sec > 0 ? 'answered' : null);

            await pool.query(
              `INSERT INTO public.mod_gateway_call_logs
                 (org_id, from_number, to_number, direction, status, duration_sec, started_at, ended_at, raw, created_at)
               VALUES
                 (NULL, $1, NULL, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
              [
                num,
                direction,
                status,
                Number.isFinite(duration_sec) ? Math.floor(duration_sec) : null,
                startedIso,
                endedIso,
                JSON.stringify(c || {}),
              ]
            );
            inserted++;
          }
          try { gatewayLastActivityAt = Date.now(); } catch {}
          try { pushLog({ kind: 'call_log', via: 'http', mode: 'bulk', inserted }); } catch {}
          return res.json({ ok: true, inserted });
        }
      } catch (e) {
        try { pushLog({ kind: "call_log_error", via: "http", mode: "bulk", error: String(e?.message || e) }); } catch {}
        return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
      }

      // Accept multiple client payload shapes (older gateway apps may send `incoming` + `state`)
      const from_number = String(
        b.from_number ||
        b.from ||
        b.from_msisdn ||
        b.incoming ||
        b.incoming_number ||
        ''
      ).trim();
      const to_number = String(
        b.to_number ||
        b.to ||
        b.to_msisdn ||
        b.outgoing ||
        b.outgoing_number ||
        b.own_number ||
        ''
      ).trim() || null;
      const state = b.state != null ? String(b.state).trim() : null;
      const directionRaw = b.direction != null ? String(b.direction).trim() : null;
      const direction =
        directionRaw ||
        (state === 'RINGING' ? 'in' : null);
      const status = (b.status != null ? String(b.status).trim() : null) || state;
      const duration_sec = b.duration_sec != null ? Number(b.duration_sec) : (b.duration != null ? Number(b.duration) : null);
      const started_at = b.started_at ? new Date(b.started_at) : (b.ts ? new Date(Number(b.ts)) : null);
      const ended_at = b.ended_at ? new Date(b.ended_at) : null;
      if (!from_number) {
        // Some Android PHONE_STATE transitions can fire before the number is available.
        // Treat as a no-op but keep a breadcrumb for diagnostics.
        try {
          pushLog({
            kind: "call_log_ignored",
            via: "http",
            reason: "missing_from_number",
            state: state || null,
            keys: Object.keys(b || {}).slice(0, 30),
          });
        } catch {}
        return res.json({ ok: true, ignored: true });
      }

      await pool.query(
        `INSERT INTO public.mod_gateway_call_logs
           (org_id, from_number, to_number, direction, status, duration_sec, started_at, ended_at, raw, created_at)
         VALUES
           (NULL, $1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())`,
        [
          from_number,
          to_number,
          direction,
          status,
          Number.isFinite(duration_sec) ? duration_sec : null,
          started_at instanceof Date && !Number.isNaN(started_at.getTime()) ? started_at.toISOString() : null,
          ended_at instanceof Date && !Number.isNaN(ended_at.getTime()) ? ended_at.toISOString() : null,
          JSON.stringify(b || {}),
        ]
      );
      try { gatewayLastActivityAt = Date.now(); } catch {}
      try { pushLog({ kind:'call_log', via: 'http', from: from_number, to: to_number, status: status || null }); } catch {}
      return res.json({ ok:true });
    } catch (e) {
      try { pushLog({ kind: "call_log_error", via: "http", error: String(e?.message || e) }); } catch {}
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Admin: list call logs for Tools → Call
  app.get('/api/admin/gateway/calls', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureCallLogsTable();
      const limitRaw = Number(req.query?.limit || 200);
      const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 200));
      const r = await pool.query(
        `
        SELECT id, from_number, to_number, direction, status, duration_sec, started_at, ended_at, raw, created_at
        FROM public.mod_gateway_call_logs
        ORDER BY created_at DESC
        LIMIT $1
        `,
        [limit]
      );
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) {
      try { pushLog({ kind: "calls_list_error", error: String(e?.message || e) }); } catch {}
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Compatibility aliases (legacy non-namespaced paths). Safe to remove after clients migrate.
  try { app.post('/api/sms/incoming', async (req, res) => { res.redirect(307, '/api/gateway/sms/incoming'); }); } catch {}
  try { app.post('/api/sms/status', async (req, res) => { res.redirect(307, '/api/gateway/sms/status'); }); } catch {}
  // POST /api/calls is used by the phone (authorized by gateway token)
  try { app.post('/api/calls', async (req, res) => { res.redirect(307, '/api/gateway/calls'); }); } catch {}
  // GET /api/calls is used by the admin UI (cookie + x-admin-token)
  try { app.get('/api/calls', async (req, res) => { res.redirect(307, '/api/admin/gateway/calls'); }); } catch {}
}
