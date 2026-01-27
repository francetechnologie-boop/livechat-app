import { fioFetchTransactions } from '../services/fioHttp.js';
import { ensureFioBankaAccountsTable } from '../services/fioAccounts.js';
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

function addDaysYmd(ymd, days) {
  try {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function registerFioBankaBalancesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : (() => {});
  if (!pool) return;

  app.get('/api/fio-banka/balances', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureFioBankaAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const r = await pool.query(
        `
          SELECT id, label, owner, account_type, currency, fio_account_id, id_to,
                 last_sync_at, last_sync_from, last_sync_to,
                 last_statement_start, last_statement_end,
                 last_opening_balance, last_closing_balance,
                 expected_interest_rate, notes, updated_at
            FROM public.mod_fio_banka_accounts
           WHERE org_id = $1
           ORDER BY label ASC, id ASC
        `,
        [orgId]
      );
      return res.json({ ok: true, org_id: orgId, items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'balances_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/fio-banka/balances/refresh', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureFioBankaAccountsTable(pool);
      const orgId = toOrgInt(req.body?.org_id ?? pickOrgId(req)) ?? 1;
      const today = new Date().toISOString().slice(0, 10);
      const end = parseYmd(req.body?.end_date) || today;
      const start = parseYmd(req.body?.start_date) || addDaysYmd(end, -1) || end;

      const r = await pool.query(
        `SELECT id, label, value FROM public.mod_fio_banka_accounts WHERE org_id=$1 ORDER BY id ASC`,
        [orgId]
      );
      const out = [];
      for (const row of r.rows || []) {
        const id = Number(row.id);
        const value = row?.value && typeof row.value === 'object' ? row.value : {};
        const token = String(value.token || '').trim();
        if (!token) {
          out.push({ id, label: row.label || `#${id}`, ok: false, error: 'missing_token' });
          continue;
        }
        try {
          const json = await fioFetchTransactions({ token, startDate: start, endDate: end });
          const info = json?.accountStatement?.info || null;
          if (info) {
            await pool.query(
              `
                UPDATE public.mod_fio_banka_accounts
                   SET fio_account_id = COALESCE($3, fio_account_id),
                       currency = COALESCE(currency, $4),
                       id_to = COALESCE($5, id_to),
                       last_statement_start = COALESCE($6::DATE, last_statement_start),
                       last_statement_end = COALESCE($7::DATE, last_statement_end),
                       last_opening_balance = COALESCE($8::NUMERIC, last_opening_balance),
                       last_closing_balance = COALESCE($9::NUMERIC, last_closing_balance),
                       updated_at = NOW()
                 WHERE org_id=$1 AND id=$2
              `,
              [
                orgId,
                id,
                info.accountId || null,
                info.currency || null,
                info.idTo || null,
                info.dateStart || null,
                info.dateEnd || null,
                info.openingBalance ?? null,
                info.closingBalance ?? null,
              ]
            );
          }
          out.push({
            id,
            label: row.label || `#${id}`,
            ok: true,
            statement: info ? {
              accountId: info.accountId || null,
              currency: info.currency || null,
              idTo: info.idTo || null,
              dateStart: info.dateStart || null,
              dateEnd: info.dateEnd || null,
              openingBalance: info.openingBalance ?? null,
              closingBalance: info.closingBalance ?? null,
            } : null,
          });
        } catch (e) {
          out.push({ id, label: row.label || `#${id}`, ok: false, error: 'refresh_failed', message: e?.message || String(e) });
        }
      }

      chatLog('fio_banka_balances_refresh', { org_id: orgId, count: out.length, start_date: start, end_date: end });
      return res.json({ ok: true, org_id: orgId, start_date: start, end_date: end, results: out });
    } catch (e) {
      const code = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 500;
      return res.status(code).json({ ok: false, error: 'balances_refresh_failed', message: e?.message || String(e) });
    }
  });
}

