import { getDhlTracking, getDhlTrackingBatch } from '../services/dhl-tracking.service.js';

function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

export function registerDhlTrackingRoutes(app, ctx = {}) {
  const requireAuth = ctx.requireAuth || null;
  const resolveOrgId = (req) => {
    const fromHeader = pickOrgId(req);
    if (fromHeader) return String(fromHeader);
    try {
      if (typeof requireAuth === 'function') {
        const me = requireAuth(req, null);
        if (me?.org_id) return String(me.org_id);
      }
    } catch {}
    return 'org_default';
  };

  // GET /api/dhl/track?trackingNumber=...&language=en&nocache=1
  app.get('/api/dhl/track', async (req, res) => {
    try {
      const trackingNumber = String(req.query?.trackingNumber || req.query?.tracking_number || '').trim();
      const language = String(req.query?.language || req.query?.lang || '').trim();
      const service = String(req.query?.service || '').trim();
      const originCountryCode = String(req.query?.originCountryCode || req.query?.origin_country_code || '').trim();
      const requesterCountryCode = String(req.query?.requesterCountryCode || req.query?.requester_country_code || '').trim();
      const dhlProfileId = (req.query?.dhl_profile_id != null) ? Number(req.query.dhl_profile_id || 0) || null : null;
      const raw = String(req.query?.raw || '').trim() === '1';
      const noCache = String(req.query?.nocache || '').trim() === '1';
      if (!trackingNumber) return res.status(400).json({ ok: false, error: 'bad_request', message: 'trackingNumber required' });

      const out = await getDhlTracking(ctx, { trackingNumber, language, noCache, service, originCountryCode, requesterCountryCode, orgId: resolveOrgId(req), dhlProfileId, raw });
      const status = out?.ok ? 200 : (out?.http_status || 500);
      return res.status(status).json(out);
    } catch (e) {
      try { ctx?.chatLog?.('track_failed', { message: e?.message || String(e) }); } catch {}
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // POST /api/dhl/track { trackingNumber, language?, nocache? }
  app.post('/api/dhl/track', async (req, res) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const trackingNumber = String(b.trackingNumber || b.tracking_number || '').trim();
      const language = String(b.language || b.lang || '').trim();
      const service = String(b.service || '').trim();
      const originCountryCode = String(b.originCountryCode || b.origin_country_code || '').trim();
      const requesterCountryCode = String(b.requesterCountryCode || b.requester_country_code || '').trim();
      const dhlProfileId = (b.dhl_profile_id != null) ? Number(b.dhl_profile_id || 0) || null : null;
      const raw = b.raw === true || String(b.raw || '').trim() === '1';
      const noCache = b.nocache === true || String(b.nocache || '') === '1';
      if (!trackingNumber) return res.status(400).json({ ok: false, error: 'bad_request', message: 'trackingNumber required' });

      const out = await getDhlTracking(ctx, { trackingNumber, language, noCache, service, originCountryCode, requesterCountryCode, orgId: resolveOrgId(req), dhlProfileId, raw });
      const status = out?.ok ? 200 : (out?.http_status || 500);
      return res.status(status).json(out);
    } catch (e) {
      try { ctx?.chatLog?.('track_failed', { message: e?.message || String(e) }); } catch {}
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // POST /api/dhl/track/batch { trackingNumbers:[], language?, dhl_profile_id?, raw?, nocache? }
  app.post('/api/dhl/track/batch', async (req, res) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const trackingNumbers = Array.isArray(b.trackingNumbers) ? b.trackingNumbers
        : (Array.isArray(b.tracking_numbers) ? b.tracking_numbers : []);
      const language = String(b.language || b.lang || '').trim();
      const service = String(b.service || '').trim();
      const originCountryCode = String(b.originCountryCode || b.origin_country_code || '').trim();
      const requesterCountryCode = String(b.requesterCountryCode || b.requester_country_code || '').trim();
      const dhlProfileId = (b.dhl_profile_id != null) ? Number(b.dhl_profile_id || 0) || null : null;
      const raw = b.raw === true || String(b.raw || '').trim() === '1';
      const noCache = b.nocache === true || String(b.nocache || '') === '1';
      const timeoutMs = (b.timeout_ms != null || b.timeoutMs != null) ? Number(b.timeout_ms || b.timeoutMs || 0) || 20_000 : 20_000;

      const out = await getDhlTrackingBatch(ctx, {
        trackingNumbers,
        language,
        noCache,
        timeoutMs,
        service,
        originCountryCode,
        requesterCountryCode,
        orgId: resolveOrgId(req),
        dhlProfileId,
        raw,
      });
      const status = out?.ok ? 200 : (out?.http_status || 500);
      return res.status(status).json(out);
    } catch (e) {
      try { ctx?.chatLog?.('track_batch_failed', { message: e?.message || String(e) }); } catch {}
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // GET /api/dhl/mysql/profiles?org_id=...
  app.get('/api/dhl/mysql/profiles', async (req, res) => {
    try {
      const pool = ctx?.pool;
      if (!pool || typeof pool.query !== 'function') return res.status(500).json({ ok: false, error: 'db_unavailable' });
      const orgId = pickOrgId(req);
      const args = [];
      const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
      if (orgId) args.push(orgId);
      const query = async (table) => (
        pool.query(
          `SELECT id, name, host, port, "database", ssl, is_default, org_id
             FROM ${table}${whereOrg}
            ORDER BY updated_at DESC`,
          args
        )
      );
      let r = null;
      try { r = await query('mod_db_mysql_profiles'); }
      catch {
        // Best-effort fallback for environments where schema qualification is required
        r = await query('public.mod_db_mysql_profiles');
      }
      return res.json({ ok: true, items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
}
