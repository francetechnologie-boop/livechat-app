import { ensureFioBankaTransactionsTable, getFioTransactionStats, listFioTransactions, loadFioAccountsForOrg } from '../services/fioTransactions.js';
import { pickOrgId, requireAdminGuard, toOrgInt } from '../services/fioOrg.js';

function parseYmd(value) {
  try {
    const s = String(value || '').trim();
    if (!s) return null;
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function registerFioBankaTransactionsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  if (!pool) return;

  app.get('/api/fio-banka/transactions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureFioBankaTransactionsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const accountId = req.query?.account_id != null ? Number(req.query.account_id) : null;
      const limit = Math.max(1, Number(req.query?.limit || 100));
      const dateAfter = parseYmd(req.query?.date_after);
      const dateBefore = parseYmd(req.query?.date_before);

      const accounts = await loadFioAccountsForOrg(pool, orgId);
      const items = await listFioTransactions(pool, {
        orgId,
        accountId: Number.isFinite(accountId) ? accountId : null,
        limit,
        dateAfter,
        dateBefore,
      });
      const stats = await getFioTransactionStats(pool, {
        orgId,
        accountId: Number.isFinite(accountId) ? accountId : null,
        dateAfter,
        dateBefore,
      });

      return res.json({ ok: true, accounts, items, stats });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'transactions_failed', message: e?.message || String(e) });
    }
  });
}

