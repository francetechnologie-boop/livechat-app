import { stripeRequest } from '../services/stripeHttp.js';
import { centsToAmount, ensureKeysTable } from '../services/stripeTransactions.js';

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

function inferMode(secretKey) {
  const s = String(secretKey || '');
  if (s.startsWith('sk_test_')) return 'test';
  if (s.startsWith('sk_live_')) return 'live';
  return null;
}

function buildBalanceSummary(balance) {
  const avail = Array.isArray(balance?.available) ? balance.available : [];
  const pend = Array.isArray(balance?.pending) ? balance.pending : [];

  const sum = (rows) => {
    const map = new Map();
    for (const r of rows) {
      const cur = r?.currency ? String(r.currency).toUpperCase() : null;
      const amount = r?.amount != null ? Number(r.amount) : null;
      if (!cur || !Number.isFinite(amount)) continue;
      map.set(cur, (map.get(cur) || 0) + Math.trunc(amount));
    }
    return Array.from(map.entries()).map(([currency, amount_cents]) => ({
      currency,
      amount_cents,
      amount: centsToAmount(amount_cents, currency),
    }));
  };

  return {
    available: sum(avail),
    pending: sum(pend),
    livemode: balance?.livemode === true,
  };
}

export function registerStripeApiBalancesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : (() => {});
  if (!pool) return;

  app.get('/api/stripe-api/balances', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureKeysTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const r = await pool.query(
        `
          SELECT id, org_id, name, is_default, value, last_balance, last_balance_at, updated_at
            FROM public.mod_stripe_api_keys
           WHERE org_id = $1
           ORDER BY is_default DESC, updated_at DESC, id DESC
        `,
        [orgId]
      );
      const items = (r.rows || []).map((row) => {
        const value = row.value && typeof row.value === 'object' ? row.value : {};
        const secretKey = value.secret_key ? String(value.secret_key) : '';
        const lastBalance = row.last_balance && typeof row.last_balance === 'object' ? row.last_balance : null;
        return {
          id: row.id,
          org_id: row.org_id,
          name: row.name,
          is_default: !!row.is_default,
          mode: value.mode || inferMode(secretKey),
          account_id: value.account_id || null,
          last_balance_at: row.last_balance_at || null,
          balance: lastBalance ? buildBalanceSummary(lastBalance) : null,
        };
      });
      return res.json({ ok: true, org_id: orgId, items });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'balances_list_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/stripe-api/balances/refresh', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureKeysTable(pool);
      const orgId = toOrgInt(req.body?.org_id ?? pickOrgId(req)) ?? 1;
      const keyId = req.body?.key_id != null ? Number(req.body.key_id) : null;

      const params = [orgId];
      let where = 'org_id=$1';
      if (Number.isFinite(keyId)) { params.push(keyId); where += ` AND id=$${params.length}`; }
      const r = await pool.query(
        `
          SELECT id, name, value
            FROM public.mod_stripe_api_keys
           WHERE ${where}
           ORDER BY id ASC
        `,
        params
      );
      const results = [];
      for (const row of r.rows || []) {
        const value = row?.value && typeof row.value === 'object' ? row.value : {};
        const secretKey = value.secret_key ? String(value.secret_key).trim() : '';
        if (!secretKey) {
          results.push({ id: row.id, name: row.name || `#${row.id}`, ok: false, error: 'missing_secret_key' });
          continue;
        }
        try {
          const resp = await stripeRequest({ secretKey, method: 'GET', path: '/v1/balance' });
          const bal = resp?.data && typeof resp.data === 'object' ? resp.data : null;
          await pool.query(
            `UPDATE public.mod_stripe_api_keys SET last_balance=$3, last_balance_at=NOW(), updated_at=NOW() WHERE org_id=$1 AND id=$2`,
            [orgId, row.id, bal]
          );
          results.push({ id: row.id, name: row.name || `#${row.id}`, ok: true, balance: buildBalanceSummary(bal) });
        } catch (e) {
          results.push({ id: row.id, name: row.name || `#${row.id}`, ok: false, error: 'stripe_balance_failed', message: e?.message || String(e) });
        }
      }
      chatLog('stripe_api_balances_refresh', { org_id: orgId, count: results.length, key_id: Number.isFinite(keyId) ? keyId : null });
      return res.json({ ok: true, org_id: orgId, results });
    } catch (e) {
      const code = Number(e?.status) === 401 ? 401 : 500;
      return res.status(code).json({ ok: false, error: 'balances_refresh_failed', message: e?.message || String(e) });
    }
  });
}

