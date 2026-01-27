import { fioFetchTransactions } from '../services/fioHttp.js';
import { ensureFioBankaAccountsTable } from '../services/fioAccounts.js';
import {
  ensureFioBankaTransactionsTable,
  fioTransactionToRow,
  getLatestFioBookingDate,
  loadFioAccountsForOrg,
  upsertFioTransactionRows,
} from '../services/fioTransactions.js';
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

function compareYmd(a, b) {
  try { return new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime(); } catch { return 0; }
}

function buildWindows(startYmd, endYmd, chunkDays) {
  const windows = [];
  if (!chunkDays || chunkDays <= 0) return [[startYmd, endYmd]];
  let cursor = startYmd;
  while (compareYmd(cursor, endYmd) <= 0) {
    const tentativeEnd = addDaysYmd(cursor, Math.max(0, chunkDays - 1));
    const wEnd = tentativeEnd && compareYmd(tentativeEnd, endYmd) < 0 ? tentativeEnd : endYmd;
    windows.push([cursor, wEnd]);
    if (wEnd === endYmd) break;
    const next = addDaysYmd(wEnd, 1);
    if (!next || next === cursor) break;
    cursor = next;
  }
  if (!windows.length) windows.push([startYmd, endYmd]);
  return windows;
}

export function registerFioBankaSyncRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : (() => {});
  if (!pool) return;

  app.post('/api/fio-banka/sync', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureFioBankaTransactionsTable(pool);
      await ensureFioBankaAccountsTable(pool);

      const orgId = toOrgInt(req.body?.org_id ?? pickOrgId(req)) ?? 1;
      const accountId = req.body?.account_id != null ? Number(req.body.account_id) : null;
      const incremental = req.body?.incremental !== false;
      const overlapDays = Math.max(0, Math.min(31, Number(req.body?.overlap_days ?? 2)));
      const chunkDays = Math.max(0, Math.min(120, Number(req.body?.chunk_days ?? 30)));

      const explicitStart = parseYmd(req.body?.start_date || req.body?.startDate);
      const explicitEnd = parseYmd(req.body?.end_date || req.body?.endDate);
      const today = new Date().toISOString().slice(0, 10);
      const endDefault = explicitEnd || today;
      const minAllowed = addDaysYmd(today, -89) || today;

      const accountsAll = await loadFioAccountsForOrg(pool, orgId);
      const selected = Number.isFinite(accountId) ? accountsAll.filter((a) => Number(a.id) === accountId) : accountsAll;
      if (!selected.length) return res.status(400).json({ ok: false, error: 'missing_account', message: 'Configure at least one Fio account first.' });

      const results = [];
      for (const acc of selected) {
        const accId = Number(acc.id);
        const cfgRow = await pool.query(
          `SELECT value FROM public.mod_fio_banka_accounts WHERE org_id=$1 AND id=$2 LIMIT 1`,
          [orgId, accId]
        );
        const value = cfgRow.rows?.[0]?.value && typeof cfgRow.rows[0].value === 'object' ? cfgRow.rows[0].value : {};
        const token = String(value.token || '').trim();
        if (!token) {
          results.push({ account_id: accId, label: acc.label, ok: false, error: 'missing_token', fetched: 0, upserted: 0 });
          continue;
        }

        let start = explicitStart;
        let end = endDefault;
        const warnings = [];
        if (incremental && !start) {
          const latest = await getLatestFioBookingDate(pool, { orgId, accountId: accId });
          if (latest) start = addDaysYmd(latest, -overlapDays) || latest;
        }
        if (!start) start = addDaysYmd(end, -89) || end;
        if (compareYmd(start, end) > 0) { const tmp = start; start = end; end = tmp; }

        // Fio API typically only exposes ~90 days of history via the API for a token.
        // If the requested period is too old, fail early (or clamp the start when possible).
        if (compareYmd(end, minAllowed) < 0) {
          results.push({
            account_id: accId,
            label: acc.label,
            ok: false,
            error: 'fio_history_limit',
            message: `Fio API history limit: only the last ~90 days are available (${minAllowed}..${today}). Your end date ${end} is older than allowed.`,
            fetched: 0,
            upserted: 0,
            start_date: start,
            end_date: end,
          });
          continue;
        }
        if (compareYmd(start, minAllowed) < 0) {
          warnings.push(`start_clamped_to_${minAllowed}`);
          start = minAllowed;
        }
        if (compareYmd(end, today) > 0) {
          warnings.push(`end_clamped_to_${today}`);
          end = today;
        }

        let fetched = 0;
        let upserted = 0;
        let lastInfo = null;

        const windows = buildWindows(start, end, chunkDays);
        for (const [wStart, wEnd] of windows) {
          let json;
          try {
            json = await fioFetchTransactions({ token, startDate: wStart, endDate: wEnd });
          } catch (e) {
            if (Number(e?.status) === 409) {
              const err = new Error(
                `Fio API request failed (409) for ${wStart}..${wEnd}. This usually means the requested period is outside the API history window (last ~90 days: ${minAllowed}..${today}) or the export is rate-limited/locked. Try a smaller range, increase chunk_days (avoid 1), or retry later.`
              );
              err.status = 409;
              throw err;
            }
            throw e;
          }
          const info = json?.accountStatement?.info || null;
          if (info) lastInfo = info;
          const txs = Array.isArray(json?.accountStatement?.transactionList?.transaction) ? json.accountStatement.transactionList.transaction : [];
          fetched += txs.length;
          const rows = txs.map((t) => fioTransactionToRow(t, { orgId, accountId: accId, currency: info?.currency || acc.currency || null }));
          const u = await upsertFioTransactionRows(pool, rows);
          upserted += u.upserted || 0;
        }

        try {
          if (lastInfo) {
            await pool.query(
              `
                UPDATE public.mod_fio_banka_accounts
                   SET fio_account_id = COALESCE($3, fio_account_id),
                       currency = COALESCE(currency, $4),
                       id_to = COALESCE($5, id_to),
                       last_sync_at = NOW(),
                       last_sync_from = $6::DATE,
                       last_sync_to = $7::DATE,
                       last_statement_start = COALESCE($8::DATE, last_statement_start),
                       last_statement_end = COALESCE($9::DATE, last_statement_end),
                       last_opening_balance = COALESCE($10::NUMERIC, last_opening_balance),
                       last_closing_balance = COALESCE($11::NUMERIC, last_closing_balance),
                       updated_at = NOW()
                 WHERE org_id=$1 AND id=$2
              `,
              [
                orgId,
                accId,
                lastInfo.accountId || null,
                lastInfo.currency || null,
                lastInfo.idTo || null,
                start,
                end,
                lastInfo.dateStart || null,
                lastInfo.dateEnd || null,
                lastInfo.openingBalance ?? null,
                lastInfo.closingBalance ?? null,
              ]
            );
          } else {
            await pool.query(
              `
                UPDATE public.mod_fio_banka_accounts
                   SET last_sync_at = NOW(),
                       last_sync_from = $3::DATE,
                       last_sync_to = $4::DATE,
                       updated_at = NOW()
                 WHERE org_id=$1 AND id=$2
              `,
              [orgId, accId, start, end]
            );
          }
        } catch {}

        chatLog('fio_banka_transactions_sync', { org_id: orgId, account_id: accId, fetched, upserted, start_date: start, end_date: end, windows: windows.length, warnings });
        results.push({ account_id: accId, label: acc.label, ok: true, fetched, upserted, start_date: start, end_date: end, windows: windows.length, warnings });
      }

      return res.json({
        ok: true,
        results,
        total_fetched: results.reduce((a, x) => a + (x.fetched || 0), 0),
        total_upserted: results.reduce((a, x) => a + (x.upserted || 0), 0),
      });
    } catch (e) {
      const code = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 500;
      return res.status(code).json({ ok: false, error: 'sync_failed', message: e?.message || String(e) });
    }
  });
}
