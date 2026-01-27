import {
  ensureKeysTable,
  ensureTransactionsTable,
  STRIPE_SYNC_CREATED_GTE_EPOCH,
  STRIPE_SYNC_CREATED_GTE_LABEL,
  getTransactionStats,
  listTransactions,
  loadStripeKeysForOrg,
  syncChargesForKey,
} from '../services/stripeTransactions.js';

function pickOrgId(req) {
  try {
    const raw = req.headers['x-org-id'] ?? req.query?.org_id;
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

function parseDateParam(value) {
  try {
    if (!value) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const n = Math.trunc(value);
      // Heuristic: seconds (10 digits) vs ms (13 digits)
      if (n > 1e12) return Math.floor(n / 1000);
      if (n > 1e9) return n;
    }
    const d = new Date(String(value).trim());
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor(d.getTime() / 1000);
  } catch {
    return null;
  }
}

export function registerStripeApiTransactionsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  if (!pool) return;

  app.get('/api/stripe-api/transactions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureKeysTable(pool);
      await ensureTransactionsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const createdAfter = parseDateParam(req.query?.created_after);
      const createdBefore = parseDateParam(req.query?.created_before);
      const limit = Math.max(1, Number(req.query?.limit || 25));
      const keyId = req.query?.key_id != null ? Number(req.query.key_id) : null;
      const status = req.query?.status != null ? String(req.query.status) : null;
      const keys = await loadStripeKeysForOrg(pool, orgId, null);
      const keysPublic = keys.map((k) => ({ id: k.id, name: k.name, is_default: !!k.is_default, mode: k.mode || null, account_id: k.account_id || null }));

      const items = await listTransactions(pool, {
        orgId,
        keyId: Number.isFinite(keyId) ? keyId : null,
        status,
        limit,
        createdAfter,
        createdBefore,
      });
      const stats = await getTransactionStats(pool, { orgId, keyId: Number.isFinite(keyId) ? keyId : null, createdAfter, createdBefore });

      return res.json({
        ok: true,
        keys: keysPublic,
        items,
        stats,
        window: { created_gte_epoch: STRIPE_SYNC_CREATED_GTE_EPOCH, created_gte_date: STRIPE_SYNC_CREATED_GTE_LABEL },
      });
    } catch (e) {
      const code = Number(e?.status) === 401 ? 401 : 500;
      return res.status(code).json({ ok: false, error: 'transactions_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/stripe-api/transactions/sync', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureKeysTable(pool);
      await ensureTransactionsTable(pool);
      const orgId = toOrgInt(req.body?.org_id ?? pickOrgId(req)) ?? 1;
      const keyId = req.body?.key_id != null ? Number(req.body.key_id) : null;
      const limit = Math.min(100, Math.max(1, Number(req.body?.limit || 50)));
      const pages = Math.min(24, Math.max(1, Number(req.body?.pages || 1)));
      const chunkMonths = Math.min(12, Math.max(0, Number(req.body?.chunk_months || 0)));
      const createdAfter = parseDateParam(req.body?.created_after ?? req.body?.createdAfter);
      const createdBefore = parseDateParam(req.body?.created_before ?? req.body?.createdBefore);
      const incremental = req.body?.incremental !== false;

      const keys = await loadStripeKeysForOrg(pool, orgId, Number.isFinite(keyId) ? keyId : null);
      if (!keys.length) return res.status(400).json({ ok: false, error: 'missing_api_key', message: 'Configure at least one Stripe secret key first.' });

      const results = [];
      for (const k of keys) {
        const { fetched, upserted } = await syncChargesForKey({
          pool,
          orgId,
          key: { ...k, limit, pages },
          limit,
          pages,
          chunkMonths,
          createdGte: Number.isFinite(createdAfter) ? createdAfter : null,
          createdLte: Number.isFinite(createdBefore) ? createdBefore : null,
          incremental,
        });
        results.push({ key_id: k.id, name: k.name, fetched, upserted });
      }

      return res.json({
        ok: true,
        results,
        total_fetched: results.reduce((a, x) => a + (x.fetched || 0), 0),
        total_upserted: results.reduce((a, x) => a + (x.upserted || 0), 0),
        window: { created_gte_epoch: STRIPE_SYNC_CREATED_GTE_EPOCH, created_gte_date: STRIPE_SYNC_CREATED_GTE_LABEL },
      });
    } catch (e) {
      const code = Number(e?.status) === 401 ? 401 : 500;
      return res.status(code).json({ ok: false, error: 'transactions_sync_failed', message: e?.message || String(e) });
    }
  });
}
