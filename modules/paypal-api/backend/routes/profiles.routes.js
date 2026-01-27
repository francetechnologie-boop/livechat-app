import { ensurePaypalApiAccountsTable, pickOrgId, requireAdminGuard, toOrgInt } from '../services/paypalAccounts.js';

export function registerPaypalApiProfilesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  if (!pool) return;

  app.get('/api/paypal-api/profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const r = await pool.query(
        `
          SELECT id, name, is_default, updated_at
            FROM public.mod_paypal_api_accounts
           WHERE org_id = $1
           ORDER BY is_default DESC, updated_at DESC, id DESC
        `,
        [orgId]
      );
      const items = (r.rows || []).map((row) => ({
        id: row.id,
        name: row.name || `#${row.id}`,
        is_default: row.is_default === true,
        updated_at: row.updated_at || null,
      }));
      return res.json({ ok: true, items, org_id: orgId });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'profiles_list_failed', message: e?.message || String(e) });
    }
  });
}

