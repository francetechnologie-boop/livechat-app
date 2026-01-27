const _cache = (globalThis.__dhlTrackingCache ||= new Map());

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function getCacheTtlMs() {
  return clampInt(process.env.DHL_CACHE_TTL_MS, 1_000, 24 * 60 * 60 * 1000, 20 * 60 * 1000);
}

function getErrorCacheTtlMs() {
  return clampInt(process.env.DHL_CACHE_TTL_ERROR_MS, 1_000, 60 * 60 * 1000, 5 * 60 * 1000);
}

function nowMs() {
  return Date.now();
}

function normalizeTrackingNumber(v) {
  let s = String(v || '').trim();
  if (!s) return '';
  // If multiple values are provided (common copy/paste), keep the first token.
  try {
    const parts = s.split(/[\s,;|]+/g).filter(Boolean);
    if (parts.length) s = parts[0];
  } catch {}
  // Remove common junk characters that break links/API calls.
  // Keep alphanumerics and most punctuation; only strip separators that are never part of the tracking id.
  try { s = s.replace(/[\\\/]/g, ''); } catch {}
  try { s = s.replace(/\s+/g, ''); } catch {}
  // Avoid cache key explosions on weird input
  return s.slice(0, 80);
}

function redactHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const kk = String(k || '');
    if (/api[-_ ]?key|authorization|token|secret/i.test(kk)) out[kk] = '****';
    else out[kk] = v;
  }
  return out;
}

async function dhlFetchJson({ baseUrl, apiKey, trackingNumber, language, timeoutMs, service, originCountryCode, requesterCountryCode }) {
  const url = new URL(String(baseUrl || '').replace(/\/$/, '') + '/track/shipments');
  url.searchParams.set('trackingNumber', trackingNumber);
  try { if (service) url.searchParams.set('service', String(service)); } catch {}
  try { if (originCountryCode) url.searchParams.set('originCountryCode', String(originCountryCode)); } catch {}
  try { if (requesterCountryCode) url.searchParams.set('requesterCountryCode', String(requesterCountryCode)); } catch {}
  const ctrl = new AbortController();
  const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, clampInt(timeoutMs, 100, 60_000, 20_000));
  try {
    const headers = { Accept: 'application/json', 'DHL-API-Key': apiKey };
    if (language) headers['Accept-Language'] = language;
    const r = await fetch(url.toString(), { method: 'GET', headers, signal: ctrl.signal });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: r.ok, status: r.status, headers: Object.fromEntries(r.headers || []), body: body ?? text };
  } finally {
    try { clearTimeout(t); } catch {}
  }
}

function normalizeDhlResponse(payload, trackingNumber) {
  const shipments = Array.isArray(payload?.shipments) ? payload.shipments : [];
  const shipment = shipments[0] || null;
  const status = shipment?.status || null;
  const events = Array.isArray(shipment?.events) ? shipment.events : [];
  const delivered = String(status?.status || '').toLowerCase() === 'delivered';
  const lastEvent = events.length ? events[events.length - 1] : null;
  const podUrl = shipment?.details?.proofOfDelivery?.documentUrl || null;
  const signatureUrl = shipment?.details?.proofOfDelivery?.signatureUrl || null;
  const pieceIds = Array.isArray(shipment?.details?.pieceIds) ? shipment.details.pieceIds : [];
  const trackingLink = trackingNumber
    ? `https://www.dhl.com/cz-en/home/tracking.html?locale=true&tracking-id=${encodeURIComponent(trackingNumber)}`
    : null;
  return {
    tracking_number: trackingNumber,
    tracking_link: trackingLink,
    proof_of_delivery_url: (typeof podUrl === 'string' && podUrl.trim()) ? podUrl : null,
    proof_of_delivery_signature_url: (typeof signatureUrl === 'string' && signatureUrl.trim()) ? signatureUrl : null,
    piece_ids: pieceIds,
    delivered,
    status: status ? { status: status.status ?? null, timestamp: status.timestamp ?? null } : null,
    last_event: lastEvent ? {
      description: lastEvent.description ?? null,
      timestamp: lastEvent.timestamp ?? null,
      location: {
        city: lastEvent?.location?.address?.addressLocality ?? null,
        countryCode: lastEvent?.location?.address?.countryCode ?? null,
      },
    } : null,
    events: events.map((ev) => ({
      description: ev?.description ?? null,
      timestamp: ev?.timestamp ?? null,
      location: {
        city: ev?.location?.address?.addressLocality ?? null,
        countryCode: ev?.location?.address?.countryCode ?? null,
      },
    })),
    shipment,
  };
}

async function resolveDhlConfig(ctx = {}, { orgId = 'org_default', dhlProfileId = null } = {}) {
  const baseUrl = String(process.env.DHL_API_BASE_URL || 'https://api-eu.dhl.com').trim().replace(/\/$/, '');
  let apiKey = '';
  let defaults = { service: null, originCountryCode: null, requesterCountryCode: null, language: null, presta_prefix: null, mysql_profile_id: null };

  // 1) DB profile (preferred)
  try {
    const pool = ctx?.pool;
    if (pool?.query) {
      const mod = await import('./dhl-profiles.service.js');
      const prof = dhlProfileId
        ? await mod.getDhlProfile(ctx, { orgId, id: dhlProfileId })
        : await mod.getDefaultDhlProfile(ctx, { orgId });
      if (prof) {
        apiKey = String(prof.api_key || '').trim();
        defaults = {
          service: String(prof.service || '').trim() || null,
          originCountryCode: String(prof.origin_country_code || '').trim() || null,
          requesterCountryCode: String(prof.requester_country_code || '').trim() || null,
          language: String(prof.language || '').trim() || null,
          presta_prefix: String(prof.presta_prefix || '').trim() || null,
          mysql_profile_id: (prof.mysql_profile_id != null ? Number(prof.mysql_profile_id) : null),
        };
      }
    }
  } catch {}

  // 2) Optional: resolve from mcp_server_config by name (avoid hardcoding key in env)
  try {
    const serverName = String(process.env.DHL_MCP_SERVER_NAME || '').trim();
    if (!apiKey && serverName && ctx?.pool?.query) {
      const r = await ctx.pool.query(`SELECT options FROM public.mcp_server_config WHERE name=$1 LIMIT 1`, [serverName]).catch(() => null);
      if (r?.rowCount) {
        let opt = r.rows[0]?.options || {};
        try { if (typeof opt === 'string') opt = JSON.parse(opt); } catch { opt = {}; }
        apiKey = String(opt.api_key || opt.DHL_API_KEY || opt.apiKey || '').trim();
      }
    }
  } catch {}

  // 3) Environment fallback
  if (!apiKey) apiKey = String(process.env.DHL_API_KEY || '').trim();
  return { baseUrl, apiKey, defaults };
}

export async function getDhlTracking(ctx = {}, { trackingNumber, language = '', noCache = false, timeoutMs = 20_000, service = '', originCountryCode = '', requesterCountryCode = '', orgId = 'org_default', dhlProfileId = null } = {}) {
  const tn = normalizeTrackingNumber(trackingNumber);
  if (!tn) return { ok: false, error: 'bad_request', message: 'trackingNumber required', http_status: 400 };
  const raw = arguments?.[1]?.raw === true;

  const svc = String(service || '').trim().toLowerCase();
  const occ = String(originCountryCode || '').trim().toUpperCase();
  const rcc = String(requesterCountryCode || '').trim().toUpperCase();
  const pid = (dhlProfileId != null ? String(dhlProfileId) : '');
  const key = `tn:${tn}|lang:${String(language || '').trim().toLowerCase()}|svc:${svc}|orig:${occ}|req:${rcc}|org:${String(orgId || '')}|prof:${pid}|raw:${raw ? '1' : '0'}`;
  const cached = _cache.get(key);
  if (!noCache && cached && cached.expiresAt > nowMs()) {
    return { ...cached.value, cached: true, cache_expires_at: cached.expiresAt };
  }

  const cfg = await resolveDhlConfig(ctx, { orgId, dhlProfileId });
  const baseUrl = cfg.baseUrl;
  const apiKey = cfg.apiKey;
  if (!apiKey) {
    return {
      ok: false,
      error: 'dhl_api_key_missing',
      message: 'Missing DHL API key (configure a DHL profile in DB, or set DHL_API_KEY / DHL_MCP_SERVER_NAME).',
      http_status: 500,
    };
  }

  const effLang = String(language || '').trim() || (cfg.defaults.language || '');
  const effSvc = svc || String(cfg.defaults.service || '').trim();
  const effOcc = occ || String(cfg.defaults.originCountryCode || '').trim();
  const effRcc = rcc || String(cfg.defaults.requesterCountryCode || '').trim();
  const r = await dhlFetchJson({
    baseUrl,
    apiKey,
    trackingNumber: tn,
    language: effLang,
    timeoutMs,
    service: effSvc || undefined,
    originCountryCode: effOcc || undefined,
    requesterCountryCode: effRcc || undefined,
  });
  const headers = redactHeaders(r.headers || {});

  if (!r.ok) {
    const ttl = getErrorCacheTtlMs();
    const err = {
      ok: false,
      error: 'dhl_http_error',
      http_status: r.status,
      message: typeof r.body === 'string' ? r.body.slice(0, 500) : (r.body?.errors || r.body?.error || `http_${r.status}`),
      headers,
      tracking_number: tn,
    };
    _cache.set(key, { expiresAt: nowMs() + ttl, value: err });
    try { ctx?.chatLog?.('dhl_http_error', { status: r.status, tracking_number: tn }); } catch {}
    return err;
  }

  const normalized = normalizeDhlResponse(r.body, tn);
  const out = {
    ok: true,
    http_status: 200,
    cached: false,
    cache_ttl_ms: getCacheTtlMs(),
    headers,
    ...normalized,
  };
  if (raw) out.raw = r.body;

  _cache.set(key, { expiresAt: nowMs() + getCacheTtlMs(), value: out });
  return out;
}

export async function getDhlTrackingBatch(ctx = {}, { trackingNumbers, language = '', noCache = false, timeoutMs = 20_000, service = '', originCountryCode = '', requesterCountryCode = '', orgId = 'org_default', dhlProfileId = null, raw = false } = {}) {
  const list = Array.isArray(trackingNumbers) ? trackingNumbers : [];
  const maxItems = clampInt(process.env.DHL_BATCH_MAX_ITEMS, 1, 200, 30);
  const concurrency = clampInt(process.env.DHL_BATCH_CONCURRENCY, 1, 10, 4);

  const uniq = [];
  const seen = new Set();
  for (const v of list) {
    const tn = normalizeTrackingNumber(v);
    if (!tn) continue;
    const k = tn.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(tn);
    if (uniq.length >= maxItems) break;
  }
  if (!uniq.length) return { ok: false, error: 'bad_request', message: 'trackingNumbers required', http_status: 400 };

  const out = new Array(uniq.length);
  let idx = 0;
  const runOne = async (i) => {
    const tn = uniq[i];
    try {
      const r = await getDhlTracking(ctx, { trackingNumber: tn, language, noCache, timeoutMs, service, originCountryCode, requesterCountryCode, orgId, dhlProfileId, raw });
      out[i] = r;
    } catch (e) {
      out[i] = { ok: false, error: 'server_error', message: e?.message || String(e), http_status: 500, tracking_number: tn };
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, uniq.length) }, async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= uniq.length) break;
      await runOne(i);
    }
  });
  await Promise.all(workers);

  const errors = out.filter((x) => !x || x.ok !== true).length;
  return { ok: true, http_status: 200, count: out.length, errors, items: out };
}
