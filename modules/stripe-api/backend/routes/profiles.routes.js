function pickOrgId(req) {
  try {
    const raw = req.body?.org_id ?? req.headers['x-org-id'] ?? req.query?.org_id;
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

function toOrgInt(value) {
  try {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  } catch {
    return null;
  }
}

function requireAdminGuard(ctx = {}) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

async function ensureKeysTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mod_stripe_api_keys (
      id SERIAL PRIMARY KEY,
      org_id INT NULL,
      name TEXT NOT NULL,
      value JSONB NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_mod_stripe_api_keys UNIQUE(org_id, name)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_keys_org ON public.mod_stripe_api_keys(org_id);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_stripe_api_keys_default_org ON public.mod_stripe_api_keys (COALESCE(org_id,0)) WHERE is_default;`);
}

export function registerStripeApiProfilesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  if (!pool) return;

  // Used by MCP2 Admin "Origin Module → Profile" dropdown.
  // Returns { items: [{ id, name }] }.
  app.get('/api/stripe-api/profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureKeysTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const r = await pool.query(
        `
          SELECT id, name, is_default, updated_at
            FROM public.mod_stripe_api_keys
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

