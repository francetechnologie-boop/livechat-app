import { ensurePaypalApiAccountsTable, pickOrgId, requireAdminGuard, toOrgInt } from '../services/paypalAccounts.js';
import { paypalGetAccessToken, paypalGetBalances } from '../services/paypalHttp.js';

function inferModeFromClientId(clientId) {
  const s = String(clientId || '').trim();
  if (!s) return null;
  // Not reliable, keep null (PayPal doesn't prefix like Stripe). Mode is stored in config.
  return null;
}

function summarizeBalances(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(data.balances) ? data.balances : (Array.isArray(data?.balance?.balances) ? data.balance.balances : []);
  const items = [];
  for (const b of list) {
    const currency = b?.currency_code || b?.currency || b?.currencyCode || null;
    const total = b?.total_balance || b?.totalBalance || b?.total_balance_value || null;
    const available = b?.available_balance || b?.availableBalance || null;
    const withheld = b?.withheld_balance || b?.withheldBalance || null;
    items.push({ currency: currency ? String(currency).toUpperCase() : null, total, available, withheld });
  }
  return { items };
}

export function registerPaypalApiBalancesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : (() => {});
  if (!pool) return;

  app.get('/api/paypal-api/balances', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const r = await pool.query(
        `
          SELECT id, org_id, name, is_default, value, last_balance, last_balance_at, updated_at
            FROM public.mod_paypal_api_accounts
           WHERE org_id = $1
           ORDER BY is_default DESC, updated_at DESC, id DESC
        `,
        [orgId]
      );
      const items = (r.rows || []).map((row) => {
        const value = row.value && typeof row.value === 'object' ? row.value : {};
        const mode = value.mode || inferModeFromClientId(value.client_id);
        const last = row.last_balance && typeof row.last_balance === 'object' ? row.last_balance : null;
        return {
          id: row.id,
          org_id: row.org_id,
          name: row.name,
          is_default: !!row.is_default,
          mode: mode || 'live',
          last_balance_at: row.last_balance_at || null,
          balance: last ? summarizeBalances(last) : null,
        };
      });
      return res.json({ ok: true, org_id: orgId, items });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'balances_list_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/paypal-api/balances/refresh', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiAccountsTable(pool);
      const orgId = toOrgInt(req.body?.org_id ?? pickOrgId(req)) ?? 1;
      const accountId = req.body?.account_id != null ? Number(req.body.account_id) : null;

      const params = [orgId];
      let where = 'org_id=$1';
      if (Number.isFinite(accountId)) { params.push(accountId); where += ` AND id=$${params.length}`; }

      const r = await pool.query(
        `
          SELECT id, name, value
            FROM public.mod_paypal_api_accounts
           WHERE ${where}
           ORDER BY id ASC
        `,
        params
      );

      const results = [];
      for (const row of r.rows || []) {
        const value = row?.value && typeof row.value === 'object' ? row.value : {};
        const clientId = String(value.client_id || '').trim();
        const clientSecret = String(value.client_secret || '').trim();
        const mode = String(value.mode || 'live').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'live';
        if (!clientId || !clientSecret) {
          results.push({ account_id: row.id, name: row.name || `#${row.id}`, ok: false, error: 'missing_credentials' });
          continue;
        }
        try {
          const access = await paypalGetAccessToken({ clientId, clientSecret, mode });
          const accessToken = String(access.access_token || '').trim();
          if (!accessToken) throw new Error('missing_access_token');
          const data = await paypalGetBalances({ accessToken, mode });
          await pool.query(
            `UPDATE public.mod_paypal_api_accounts SET last_balance=$3, last_balance_at=NOW(), updated_at=NOW() WHERE org_id=$1 AND id=$2`,
            [orgId, row.id, data]
          );
          results.push({ account_id: row.id, name: row.name || `#${row.id}`, ok: true, balance: summarizeBalances(data) });
        } catch (e) {
          results.push({ account_id: row.id, name: row.name || `#${row.id}`, ok: false, error: 'paypal_balance_failed', message: e?.message || String(e) });
        }
      }

      chatLog('paypal_api_balances_refresh', { org_id: orgId, count: results.length, account_id: Number.isFinite(accountId) ? accountId : null });
      return res.json({ ok: true, org_id: orgId, results });
    } catch (e) {
      const code = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 500;
      return res.status(code).json({ ok: false, error: 'balances_refresh_failed', message: e?.message || String(e) });
    }
  });
}

