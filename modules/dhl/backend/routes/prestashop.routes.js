import { resolvePrestaOrderTrackingNumber } from '../services/prestashop-tracking.service.js';
import { getDhlTracking } from '../services/dhl-tracking.service.js';
import { getDhlProfile, getDefaultDhlProfile } from '../services/dhl-profiles.service.js';

function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

export function registerDhlPrestashopRoutes(app, ctx = {}) {
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

  // GET /api/dhl/prestashop/order-tracking?id_order=123&profile_id=1&prefix=ps_&language=en
  // Returns (default): { ok:true, id_order, tracking_number, tracking_link, ... }
  // Returns (lite=1): { ok:true, tracking_link } (or ok:false with error/message)
  app.get('/api/dhl/prestashop/order-tracking', async (req, res) => {
    try {
      const idOrder = Number(req.query?.id_order || req.query?.idOrder || 0) || 0;
      const explicitMysqlProfileId = Number(req.query?.profile_id || req.query?.profileId || 0) || 0;
      const explicitPrefix = String(req.query?.prefix || '');
      const language = String(req.query?.language || req.query?.lang || '').trim();
      const service = String(req.query?.service || '').trim();
      const originCountryCode = String(req.query?.originCountryCode || req.query?.origin_country_code || '').trim();
      const requesterCountryCode = String(req.query?.requesterCountryCode || req.query?.requester_country_code || '').trim();
      const dhlProfileId = (req.query?.dhl_profile_id != null) ? Number(req.query.dhl_profile_id || 0) || null : null;
      const raw = String(req.query?.raw || '').trim() === '1';
      const lite = String(req.query?.lite || '').trim() === '1';
      const noCache = String(req.query?.nocache || '').trim() === '1';
      if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'id_order required' });

      const orgId = resolveOrgId(req);
      let dhlProf = null;
      try {
        dhlProf = dhlProfileId
          ? await getDhlProfile(ctx, { orgId, id: dhlProfileId })
          : await getDefaultDhlProfile(ctx, { orgId });
      } catch {}

      const profileId = explicitMysqlProfileId || (dhlProf?.mysql_profile_id != null ? Number(dhlProf.mysql_profile_id) : 0);
      const prefix = (explicitPrefix && explicitPrefix.trim()) ? explicitPrefix : (String(dhlProf?.presta_prefix || '').trim() || 'ps_');
      if (!profileId) return res.status(400).json({ ok: false, error: 'bad_request', message: 'profile_id required (or configure mysql_profile_id in DHL profile)' });

      const resolved = await resolvePrestaOrderTrackingNumber(ctx, { idOrder, profileId, prefix, orgId });
      if (!resolved?.ok) return res.status(resolved?.http_status || 500).json(resolved);
      // If Presta doesn't have a tracking number yet, attempt DHL "reference search":
      // Unified Tracking API tries trackingNumber as tracking number, piece id, or reference.
      if (!resolved.tracking_number) {
        const ref = String(resolved.order_reference || '').trim();
        if (ref) {
          // Express Commerce shipments are typically DHL Express; default service=express for reference search unless caller overrides.
          const byRef = await getDhlTracking(ctx, { trackingNumber: ref, language, noCache, service: service || String(dhlProf?.service || '').trim() || 'express', originCountryCode, requesterCountryCode, orgId, dhlProfileId, raw });
          const status = byRef?.ok ? 200 : (byRef?.http_status || 500);
          const derived = String(byRef?.shipment?.id || '').trim() || null;
          const trackingLink = byRef?.tracking_link || null;
          if (lite) {
            if (byRef?.ok && trackingLink) return res.status(200).json({ ok: true, tracking_number: derived, tracking_link: trackingLink });
            return res.status(status).json({ ok: false, error: byRef?.error || 'tracking_link_not_found', message: byRef?.message || 'Tracking link not found', tracking_link: null });
          }
          return res.status(status).json({
            ok: byRef?.ok === true,
            id_order: idOrder,
            profile_id: profileId,
            prefix,
            tracking_number: derived,
            tracking_link: trackingLink,
            proof_of_delivery_url: byRef?.proof_of_delivery_url || null,
            source: 'dhl_reference_search',
            prestashop: { order_reference: ref, customer: resolved.customer || null },
            tracking: byRef,
          });
        }
        return res.status(404).json({ ok: false, error: 'tracking_number_not_found', id_order: idOrder, order_reference: resolved.order_reference || null });
      }

      const tracking = await getDhlTracking(ctx, { trackingNumber: resolved.tracking_number, language, noCache, service, originCountryCode, requesterCountryCode, orgId, dhlProfileId, raw });
      const status = tracking?.ok ? 200 : (tracking?.http_status || 500);
      if (lite) {
        const trackingLink = tracking?.tracking_link || null;
        if (tracking?.ok && trackingLink) return res.status(200).json({ ok: true, tracking_number: resolved.tracking_number, tracking_link: trackingLink });
        return res.status(status).json({ ok: false, error: tracking?.error || 'tracking_link_not_found', message: tracking?.message || 'Tracking link not found', tracking_link: null });
      }
      return res.status(status).json({
        ok: tracking?.ok === true,
        id_order: idOrder,
        profile_id: profileId,
        prefix,
        tracking_number: resolved.tracking_number,
        tracking_link: tracking?.tracking_link || null,
        proof_of_delivery_url: tracking?.proof_of_delivery_url || null,
        source: resolved.source || null,
        prestashop: { order_reference: resolved.order_reference || null, customer: resolved.customer || null },
        tracking,
      });
    } catch (e) {
      try { ctx?.chatLog?.('prestashop_order_tracking_failed', { message: e?.message || String(e) }); } catch {}
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
}
