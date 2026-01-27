import { listDhlProfiles, createDhlProfile, updateDhlProfile, deleteDhlProfile } from '../services/dhl-profiles.service.js';

function pickOrgId(req, ctx) {
  try {
    const h = req.headers['x-org-id'];
    if (h != null && String(h).trim()) return String(h).trim();
  } catch {}
  try {
    const q = req.query?.org_id;
    if (q != null && String(q).trim()) return String(q).trim();
  } catch {}
  try {
    const requireAuth = ctx?.requireAuth;
    if (typeof requireAuth === 'function') {
      const me = requireAuth(req, null);
      if (me?.org_id) return String(me.org_id);
    }
  } catch {}
  return 'org_default';
}

export function registerDhlProfilesRoutes(app, ctx = {}) {
  const requireAuth = ctx.requireAuth || ((_req, res) => { res?.status?.(401)?.json?.({ error: 'unauthorized' }); return null; });
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res?.status?.(403)?.json?.({ error: 'forbidden' }); return null; });

  // List DHL profiles (no secrets)
  app.get('/api/dhl/profiles', async (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    try {
      const orgId = pickOrgId(req, ctx);
      const items = await listDhlProfiles(ctx, { orgId });
      return res.json({ ok: true, items });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Create a DHL profile (admin only). Accepts api_key but does not return it.
  app.post('/api/dhl/profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = pickOrgId(req, ctx);
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const out = await createDhlProfile(ctx, { orgId, input: b });
      return res.json({ ok: true, id: out.id });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Update a DHL profile (admin only). Accepts api_key but does not return it.
  app.put('/api/dhl/profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = pickOrgId(req, ctx);
      const id = Number(req.params.id || 0) || 0;
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      await updateDhlProfile(ctx, { orgId, id, patch: b });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Delete a DHL profile (admin only)
  app.delete('/api/dhl/profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const orgId = pickOrgId(req, ctx);
      const id = Number(req.params.id || 0) || 0;
      await deleteDhlProfile(ctx, { orgId, id });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
}

