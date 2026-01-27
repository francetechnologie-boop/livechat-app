import {
  ensurePaypalApiTransactionsTable,
  getPaypalTransactionStats,
  getLatestPaypalTransactionTime,
  backfillPaypalIdCart,
  listPaypalTransactions,
  loadPaypalAccountsForOrg,
  paypalTransactionToRow,
  upsertPaypalTransactionRows,
} from '../services/paypalTransactions.js';
import { paypalGetAccessToken, paypalListReportingTransactions } from '../services/paypalHttp.js';

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
    const d = new Date(String(value).trim());
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

export function registerPaypalApiTransactionsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : (() => {});
  if (!pool) return;

  app.get('/api/paypal-api/transactions', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiTransactionsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const accountId = req.query?.account_id != null ? Number(req.query.account_id) : null;
      const status = req.query?.status != null ? String(req.query.status) : null;
      const limit = Math.max(1, Number(req.query?.limit || 50));
      const createdAfter = parseDateParam(req.query?.created_after);
      const createdBefore = parseDateParam(req.query?.created_before);

      const accounts = await loadPaypalAccountsForOrg(pool, orgId);
      const items = await listPaypalTransactions(pool, {
        orgId,
        accountId: Number.isFinite(accountId) ? accountId : null,
        status,
        limit,
        createdAfter,
        createdBefore,
      });
      const stats = await getPaypalTransactionStats(pool, {
        orgId,
        accountId: Number.isFinite(accountId) ? accountId : null,
        createdAfter,
        createdBefore,
      });

      return res.json({ ok: true, accounts, items, stats });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'transactions_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/paypal-api/transactions/sync', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiTransactionsTable(pool);
      const orgId = toOrgInt(req.body?.org_id ?? pickOrgId(req)) ?? 1;
      const accountId = req.body?.account_id != null ? Number(req.body.account_id) : null;
      const pageSize = Math.max(1, Math.min(500, Number(req.body?.page_size || 100)));
      const pages = Math.max(1, Math.min(50, Number(req.body?.pages || 3)));
      const chunkDays = Math.max(0, Math.min(31, Number(req.body?.chunk_days || 30)));
      const overlapDays = Math.max(0, Math.min(31, Number(req.body?.overlap_days ?? 3)));
      const incremental = req.body?.incremental !== false;

      const accountsAll = await loadPaypalAccountsForOrg(pool, orgId);
      const selected = Number.isFinite(accountId) ? accountsAll.filter((a) => Number(a.id) === accountId) : accountsAll;
      if (!selected.length) return res.status(400).json({ ok: false, error: 'missing_account', message: 'Configure at least one PayPal account first.' });

      const parseIso = (v) => {
        try {
          if (!v) return null;
          const d = new Date(String(v).trim());
          if (Number.isNaN(d.getTime())) return null;
          return d.toISOString();
        } catch { return null; }
      };

      const explicitStart = parseIso(req.body?.start_date || req.body?.startDate);
      const explicitEnd = parseIso(req.body?.end_date || req.body?.endDate);
      const nowIso = new Date().toISOString();
      const fallbackEnd = explicitEnd || nowIso;

      const addDaysIso = (iso, days) => {
        try {
          const d = new Date(String(iso));
          d.setUTCDate(d.getUTCDate() + Number(days || 0));
          return d.toISOString();
        } catch { return null; }
      };

      const results = [];
      for (const acc of selected) {
        const accId = Number(acc.id);
        const cfgRow = await pool.query(
          `SELECT value FROM public.mod_paypal_api_accounts WHERE org_id=$1 AND id=$2 LIMIT 1`,
          [orgId, accId]
        );
        const value = cfgRow.rows?.[0]?.value && typeof cfgRow.rows[0].value === 'object' ? cfgRow.rows[0].value : {};
        const clientId = String(value.client_id || '').trim();
        const clientSecret = String(value.client_secret || '').trim();
        const mode = String(value.mode || acc.mode || 'live').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'live';
        if (!clientId || !clientSecret) {
          results.push({ account_id: accId, name: acc.name, ok: false, error: 'missing_credentials', fetched: 0, upserted: 0 });
          continue;
        }

        let start = explicitStart;
        let end = fallbackEnd;
        if (incremental && !start) {
          const latest = await getLatestPaypalTransactionTime(pool, { orgId, accountId: accId });
          if (latest) {
            // overlap a bit to avoid missing late-arriving updates
            const overlap = addDaysIso(latest, -overlapDays) || latest;
            start = overlap;
          }
        }
        if (!start) start = addDaysIso(end, -30) || end;

        if (new Date(start).getTime() > new Date(end).getTime()) {
          const tmp = start; start = end; end = tmp;
        }

        const access = await paypalGetAccessToken({ clientId, clientSecret, mode });
        const accessToken = String(access.access_token || '').trim();
        if (!accessToken) {
          results.push({ account_id: accId, name: acc.name, ok: false, error: 'missing_access_token', fetched: 0, upserted: 0 });
          continue;
        }

        let fetched = 0;
        let upserted = 0;

        const windows = [];
        if (chunkDays > 0) {
          let cursor = start;
          while (new Date(cursor).getTime() < new Date(end).getTime()) {
            const next = addDaysIso(cursor, chunkDays) || end;
            const wEnd = new Date(next).getTime() > new Date(end).getTime() ? end : next;
            windows.push([cursor, wEnd]);
            cursor = wEnd;
          }
        } else {
          windows.push([start, end]);
        }

        for (const [wStart, wEnd] of windows) {
          for (let page = 1; page <= pages; page++) {
            const data = await paypalListReportingTransactions({
              accessToken,
              mode,
              startDate: wStart,
              endDate: wEnd,
              pageSize,
              page,
              fields: 'all',
            });
            const details = Array.isArray(data?.transaction_details) ? data.transaction_details : [];
            fetched += details.length;
            if (!details.length) break;
            const rows = details.map((d) => paypalTransactionToRow(d, { orgId, accountId: accId }));
            const u = await upsertPaypalTransactionRows(pool, rows);
            upserted += u.upserted || 0;
            // Stop early when we reached the last page reported by PayPal
            const totalPages = Number(data?.total_pages || 0);
            if (Number.isFinite(totalPages) && totalPages > 0 && page >= totalPages) break;
          }
        }

        // Backfill id_cart for rows that were inserted before the extractor existed
        // or if PayPal returned data in a slightly different shape.
        try {
          const b = await backfillPaypalIdCart(pool, { orgId, accountId: accId });
          if ((b.updated || 0) > 0) chatLog('paypal_api_transactions_backfill_id_cart', { org_id: orgId, account_id: accId, updated: b.updated });
        } catch {}

        chatLog('paypal_api_transactions_sync', { org_id: orgId, account_id: accId, fetched, upserted, start, end, mode });
        results.push({ account_id: accId, name: acc.name, ok: true, fetched, upserted, start_date: start, end_date: end, mode });
      }

      return res.json({
        ok: true,
        results,
        total_fetched: results.reduce((a, x) => a + (x.fetched || 0), 0),
        total_upserted: results.reduce((a, x) => a + (x.upserted || 0), 0),
      });
    } catch (e) {
      const code = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 500;
      return res.status(code).json({ ok: false, error: 'transactions_sync_failed', message: e?.message || String(e) });
    }
  });
}
