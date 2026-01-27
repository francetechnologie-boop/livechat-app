import { fioFetchTransactions } from '../services/fioHttp.js';
import { ensureFioBankaAccountsTable, sanitizeFioAccountRow } from '../services/fioAccounts.js';
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

export function registerFioBankaAccountsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : (() => {});
  if (!pool) return;

  const normalizeAccountType = (value) => {
    const s = String(value || '').trim().toLowerCase();
    if (!s) return null;
    if (s === 'long' || s === 'long_term' || s === 'long-term' || s === 'long term') return 'long_term';
    if (s === 'short' || s === 'short_term' || s === 'short-term' || s === 'short term') return 'short_term';
    return null;
  };

  const normalizeCurrency = (value) => {
    const s = String(value || '').trim().toUpperCase();
    if (!s) return null;
    if (s === 'CZK' || s === 'EUR' || s === 'USD') return s;
    return null;
  };

  const parseRate = (value) => {
    const raw = value;
    if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
    const n = Number(String(raw).trim().replace(',', '.'));
    if (!Number.isFinite(n)) return { ok: false, value: null };
    return { ok: true, value: n };
  };

  app.get('/api/fio-banka/accounts', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureFioBankaAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const r = await pool.query(
        `
          SELECT id, org_id, label, owner, account_type, notes, value, is_default, fio_account_id, currency, id_to, last_sync_at, last_sync_from, last_sync_to, expected_interest_rate, created_at, updated_at
            FROM public.mod_fio_banka_accounts
           WHERE org_id = $1
           ORDER BY is_default DESC, updated_at DESC, id DESC
        `,
        [orgId]
      );
      const items = (r.rows || []).map(sanitizeFioAccountRow);
      return res.json({ ok: true, items, org_id: orgId });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'accounts_list_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/fio-banka/accounts/test', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const token = String(req.body?.token || '').trim();
      if (!token) return res.status(400).json({ ok: false, error: 'token_required' });
      const now = new Date();
      const end = parseYmd(req.body?.end_date) || now.toISOString().slice(0, 10);
      const start = parseYmd(req.body?.start_date) || new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const json = await fioFetchTransactions({ token, startDate: start, endDate: end });
      const info = json?.accountStatement?.info || null;
      const txCount = Array.isArray(json?.accountStatement?.transactionList?.transaction) ? json.accountStatement.transactionList.transaction.length : 0;
      return res.json({
        ok: true,
        info: info ? {
          accountId: info.accountId || null,
          currency: info.currency || null,
          idTo: info.idTo || null,
          dateStart: info.dateStart || null,
          dateEnd: info.dateEnd || null,
        } : null,
        tx_count: txCount,
      });
    } catch (e) {
      const code = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 400;
      return res.status(code).json({ ok: false, error: 'accounts_test_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/fio-banka/accounts/:id/test', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureFioBankaAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad_id' });

      const r = await pool.query(
        `SELECT label, value FROM public.mod_fio_banka_accounts WHERE org_id=$1 AND id=$2 LIMIT 1`,
        [orgId, id]
      );
      if (!r.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      const row = r.rows[0] || {};
      const value = row?.value && typeof row.value === 'object' ? row.value : {};
      const token = String(value.token || '').trim();
      if (!token) return res.status(400).json({ ok: false, error: 'token_required', message: 'No token stored for this account.' });

      const now = new Date();
      const end = parseYmd(req.body?.end_date) || now.toISOString().slice(0, 10);
      const start = parseYmd(req.body?.start_date) || new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const json = await fioFetchTransactions({ token, startDate: start, endDate: end });
      const info = json?.accountStatement?.info || null;
      const txCount = Array.isArray(json?.accountStatement?.transactionList?.transaction) ? json.accountStatement.transactionList.transaction.length : 0;
      chatLog('fio_banka_account_test', { org_id: orgId, id, label: row?.label || null, tx_count: txCount });
      return res.json({
        ok: true,
        account_id: id,
        info: info ? {
          accountId: info.accountId || null,
          currency: info.currency || null,
          idTo: info.idTo || null,
          dateStart: info.dateStart || null,
          dateEnd: info.dateEnd || null,
        } : null,
        tx_count: txCount,
      });
    } catch (e) {
      const code = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 400;
      return res.status(code).json({ ok: false, error: 'account_test_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/fio-banka/accounts', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureFioBankaAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const label = String(req.body?.label || '').trim();
      const owner = String(req.body?.owner || '').trim() || null;
      const typeRaw = req.body?.account_type ?? req.body?.type;
      const accountType = (typeRaw === '' || typeRaw === null) ? null : normalizeAccountType(typeRaw);
      const notesRaw = req.body?.notes;
      const notes = (notesRaw === null || notesRaw === undefined) ? null : String(notesRaw).trim();
      const currencyRaw = req.body?.currency;
      const currency = (currencyRaw === '' || currencyRaw === null) ? null : normalizeCurrency(currencyRaw);
      const expectedInterestRateRaw = req.body?.expected_interest_rate ?? req.body?.expectedInterestRate;
      const expectedRateParsed = parseRate(expectedInterestRateRaw);
      const token = String(req.body?.token || '').trim();
      const makeDefault = req.body?.is_default === true;
      if (!label) return res.status(400).json({ ok: false, error: 'label_required' });
      if (!token) return res.status(400).json({ ok: false, error: 'token_required' });
      if ((currencyRaw != null) && currencyRaw !== '' && !currency) return res.status(400).json({ ok: false, error: 'bad_currency', message: 'currency must be CZK/EUR/USD' });
      if ((typeRaw != null) && typeRaw !== '' && typeRaw !== null && !accountType) return res.status(400).json({ ok: false, error: 'bad_account_type', message: 'account_type must be long_term/short_term (or blank)' });
      if (!expectedRateParsed.ok) return res.status(400).json({ ok: false, error: 'bad_expected_interest_rate', message: 'expected_interest_rate must be a number (or blank)' });

      const value = { token };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (makeDefault) {
          await client.query(`UPDATE public.mod_fio_banka_accounts SET is_default=FALSE, updated_at=NOW() WHERE org_id=$1`, [orgId]);
        }
        const ins = await client.query(
          `
            INSERT INTO public.mod_fio_banka_accounts(org_id, label, owner, account_type, notes, currency, expected_interest_rate, value, is_default, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
            RETURNING id, org_id, label, owner, account_type, notes, value, is_default, fio_account_id, currency, id_to, last_sync_at, last_sync_from, last_sync_to, expected_interest_rate, created_at, updated_at
          `,
          [orgId, label, owner, accountType, notes, currency, expectedRateParsed.value, value, makeDefault]
        );
        await client.query('COMMIT');
        const row = ins.rows[0];
        chatLog('fio_banka_account_created', { org_id: orgId, id: row?.id, label, owner, account_type: accountType, currency, expected_interest_rate: expectedRateParsed.value });
        return res.status(201).json({ ok: true, item: sanitizeFioAccountRow(row) });
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'accounts_create_failed', message: e?.message || String(e) });
    }
  });

  app.patch('/api/fio-banka/accounts/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureFioBankaAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad_id' });

      const hasOwner = Object.prototype.hasOwnProperty.call(req.body || {}, 'owner');
      const hasCurrency = Object.prototype.hasOwnProperty.call(req.body || {}, 'currency');
      const hasAccountType = Object.prototype.hasOwnProperty.call(req.body || {}, 'account_type') || Object.prototype.hasOwnProperty.call(req.body || {}, 'type');
      const hasNotes = Object.prototype.hasOwnProperty.call(req.body || {}, 'notes');
      const hasExpectedRate = Object.prototype.hasOwnProperty.call(req.body || {}, 'expected_interest_rate')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'expectedInterestRate');

      const label = (req.body?.label != null) ? String(req.body.label).trim() : null;
      const token = (req.body?.token != null) ? String(req.body.token).trim() : null;
      const owner = hasOwner ? (String(req.body?.owner || '').trim() || null) : null;
      const currencyRaw = req.body?.currency;
      const currency = hasCurrency ? ((currencyRaw === '' || currencyRaw === null) ? null : normalizeCurrency(currencyRaw)) : null;
      const typeRaw2 = req.body?.account_type ?? req.body?.type;
      const accountType = hasAccountType ? ((typeRaw2 === '' || typeRaw2 === null) ? null : normalizeAccountType(typeRaw2)) : null;
      const notes = hasNotes ? String(req.body?.notes || '').trim() : null;
      const expectedInterestRateRaw = req.body?.expected_interest_rate ?? req.body?.expectedInterestRate;
      const expectedRateParsed = hasExpectedRate ? parseRate(expectedInterestRateRaw) : { ok: true, value: null };
      const makeDefault = req.body?.is_default === true;
      if (label !== null && !label) return res.status(400).json({ ok: false, error: 'label_required' });
      if (token !== null && !token) return res.status(400).json({ ok: false, error: 'token_required' });
      if (hasCurrency && currencyRaw !== '' && currencyRaw !== null && !currency) return res.status(400).json({ ok: false, error: 'bad_currency', message: 'currency must be CZK/EUR/USD' });
      if (hasAccountType && typeRaw2 !== '' && typeRaw2 !== null && !accountType) return res.status(400).json({ ok: false, error: 'bad_account_type', message: 'account_type must be long_term/short_term (or blank)' });
      if (hasExpectedRate && !expectedRateParsed.ok) return res.status(400).json({ ok: false, error: 'bad_expected_interest_rate', message: 'expected_interest_rate must be a number (or blank)' });

      const cur = await pool.query(`SELECT id, value FROM public.mod_fio_banka_accounts WHERE org_id=$1 AND id=$2`, [orgId, id]);
      if (!cur.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      const prev = cur.rows[0]?.value && typeof cur.rows[0].value === 'object' ? cur.rows[0].value : {};
      const nextValue = { ...prev };
      if (token !== null) nextValue.token = token;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (makeDefault) {
          await client.query(`UPDATE public.mod_fio_banka_accounts SET is_default=FALSE, updated_at=NOW() WHERE org_id=$1`, [orgId]);
        }
        const upd = await client.query(
          `
            UPDATE public.mod_fio_banka_accounts
               SET label = COALESCE($3, label),
                   owner = CASE WHEN $4 THEN $5 ELSE owner END,
                   account_type = CASE WHEN $6 THEN $7 ELSE account_type END,
                   notes = CASE WHEN $8 THEN $9 ELSE notes END,
                   currency = CASE WHEN $10 THEN $11 ELSE currency END,
                   expected_interest_rate = CASE WHEN $12 THEN $13 ELSE expected_interest_rate END,
                   value = $14,
                   is_default = CASE WHEN $15 THEN TRUE ELSE is_default END,
                   updated_at = NOW()
             WHERE org_id = $1 AND id = $2
            RETURNING id, org_id, label, owner, account_type, notes, value, is_default, fio_account_id, currency, id_to, last_sync_at, last_sync_from, last_sync_to, expected_interest_rate, created_at, updated_at
          `,
          [
            orgId,
            id,
            label,
            hasOwner,
            owner,
            hasAccountType,
            accountType,
            hasNotes,
            notes,
            hasCurrency,
            currency,
            hasExpectedRate,
            expectedRateParsed.value,
            nextValue,
            makeDefault,
          ]
        );
        await client.query('COMMIT');
        if (!upd.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
        chatLog('fio_banka_account_updated', { org_id: orgId, id });
        return res.json({ ok: true, item: sanitizeFioAccountRow(upd.rows[0]) });
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'accounts_update_failed', message: e?.message || String(e) });
    }
  });

  app.delete('/api/fio-banka/accounts/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureFioBankaAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad_id' });
      const del = await pool.query(`DELETE FROM public.mod_fio_banka_accounts WHERE org_id=$1 AND id=$2`, [orgId, id]);
      if (!del.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      chatLog('fio_banka_account_deleted', { org_id: orgId, id });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'accounts_delete_failed', message: e?.message || String(e) });
    }
  });
}
