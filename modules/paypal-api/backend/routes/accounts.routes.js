import { paypalGetAccessToken } from '../services/paypalHttp.js';
import {
  ensurePaypalApiAccountsTable,
  maskClientId,
  maskSecret,
  normalizeMode,
  pickOrgId,
  requireAdminGuard,
  sanitizePaypalAccountRow,
  toOrgInt,
} from '../services/paypalAccounts.js';

export function registerPaypalApiAccountsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : (() => {});
  if (!pool) return;

  app.get('/api/paypal-api/accounts', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const r = await pool.query(
        `
          SELECT id, org_id, name, is_default, value, created_at, updated_at
            FROM public.mod_paypal_api_accounts
           WHERE org_id = $1
           ORDER BY is_default DESC, updated_at DESC, id DESC
        `,
        [orgId]
      );
      const items = (r.rows || []).map(sanitizePaypalAccountRow);
      return res.json({ ok: true, items, org_id: orgId });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'accounts_list_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/paypal-api/accounts/test', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const clientId = String(req.body?.client_id || '').trim();
      const clientSecret = String(req.body?.client_secret || '').trim();
      const mode = normalizeMode(req.body?.mode);
      if (!clientId) return res.status(400).json({ ok: false, error: 'client_id_required' });
      if (!clientSecret) return res.status(400).json({ ok: false, error: 'client_secret_required' });

      const token = await paypalGetAccessToken({ clientId, clientSecret, mode });
      return res.json({
        ok: true,
        mode,
        token_type: token.token_type || null,
        expires_in: token.expires_in || null,
        scope: token.scope || null,
        app_id: token.app_id || null,
        client_id: { ...maskClientId(clientId) },
        secret: { ...maskSecret(clientSecret) },
      });
    } catch (e) {
      const code = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 400;
      return res.status(code).json({ ok: false, error: 'paypal_test_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/paypal-api/accounts', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const name = String(req.body?.name || '').trim();
      const clientId = String(req.body?.client_id || '').trim();
      const clientSecret = String(req.body?.client_secret || '').trim();
      const mode = normalizeMode(req.body?.mode);
      const makeDefault = req.body?.is_default === true;
      if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
      if (!clientId) return res.status(400).json({ ok: false, error: 'client_id_required' });
      if (!clientSecret) return res.status(400).json({ ok: false, error: 'client_secret_required' });

      // Do not block persistence on external network / credential validation.
      // Users can validate explicitly via POST /api/paypal-api/accounts/test.
      const value = { mode, client_id: clientId, client_secret: clientSecret };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (makeDefault) {
          await client.query(`UPDATE public.mod_paypal_api_accounts SET is_default=FALSE, updated_at=NOW() WHERE org_id=$1`, [orgId]);
        }
        const ins = await client.query(
          `
            INSERT INTO public.mod_paypal_api_accounts(org_id, name, value, is_default, created_at, updated_at)
            VALUES ($1,$2,$3,$4,NOW(),NOW())
            RETURNING id, org_id, name, is_default, value, created_at, updated_at
          `,
          [orgId, name, value, makeDefault]
        );
        await client.query('COMMIT');
        const row = ins.rows[0];
        chatLog('paypal_api_account_created', { org_id: orgId, id: row?.id, name, mode });
        return res.status(201).json({ ok: true, item: sanitizePaypalAccountRow(row) });
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

  app.post('/api/paypal-api/accounts/:id/default', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad_id' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE public.mod_paypal_api_accounts SET is_default=FALSE, updated_at=NOW() WHERE org_id=$1`, [orgId]);
        const r = await client.query(
          `UPDATE public.mod_paypal_api_accounts SET is_default=TRUE, updated_at=NOW() WHERE org_id=$1 AND id=$2 RETURNING id`,
          [orgId, id]
        );
        await client.query('COMMIT');
        if (!r.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
        chatLog('paypal_api_account_default_set', { org_id: orgId, id });
        return res.json({ ok: true });
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'default_set_failed', message: e?.message || String(e) });
    }
  });

  app.patch('/api/paypal-api/accounts/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad_id' });

      const name = (req.body?.name != null) ? String(req.body.name).trim() : null;
      const clientId = (req.body?.client_id != null) ? String(req.body.client_id).trim() : null;
      const clientSecret = (req.body?.client_secret != null) ? String(req.body.client_secret).trim() : null;
      const mode = (req.body?.mode != null) ? normalizeMode(req.body.mode) : null;
      const makeDefault = req.body?.is_default === true;
      const verify = req.body?.verify === true;

      const cur = await pool.query(`SELECT id, value FROM public.mod_paypal_api_accounts WHERE org_id=$1 AND id=$2`, [orgId, id]);
      if (!cur.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      const prev = cur.rows[0]?.value && typeof cur.rows[0].value === 'object' ? cur.rows[0].value : {};
      const nextValue = { ...prev };
      if (mode !== null) nextValue.mode = mode;
      if (clientId !== null) {
        if (!clientId) return res.status(400).json({ ok: false, error: 'client_id_required' });
        nextValue.client_id = clientId;
      }
      if (clientSecret !== null) {
        if (!clientSecret) return res.status(400).json({ ok: false, error: 'client_secret_required' });
        nextValue.client_secret = clientSecret;
      }

      // Only verify credentials if explicitly requested (to avoid blocking simple edits).
      if (verify) {
        const effectiveMode = normalizeMode(nextValue.mode);
        const effectiveClientId = String(nextValue.client_id || '').trim();
        const effectiveClientSecret = String(nextValue.client_secret || '').trim();
        if (!effectiveClientId) return res.status(400).json({ ok: false, error: 'client_id_required' });
        if (!effectiveClientSecret) return res.status(400).json({ ok: false, error: 'client_secret_required' });
        const token = await paypalGetAccessToken({ clientId: effectiveClientId, clientSecret: effectiveClientSecret, mode: effectiveMode });
        nextValue.mode = effectiveMode;
        nextValue.app_id = token.app_id || nextValue.app_id || null;
        nextValue.scope = token.scope || nextValue.scope || null;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (makeDefault) {
          await client.query(`UPDATE public.mod_paypal_api_accounts SET is_default=FALSE, updated_at=NOW() WHERE org_id=$1`, [orgId]);
        }
        const upd = await client.query(
          `
            UPDATE public.mod_paypal_api_accounts
               SET name = COALESCE($3, name),
                   value = $4,
                   is_default = CASE WHEN $5 THEN TRUE ELSE is_default END,
                   updated_at = NOW()
             WHERE org_id = $1 AND id = $2
            RETURNING id, org_id, name, is_default, value, created_at, updated_at
          `,
          [orgId, id, name, nextValue, makeDefault]
        );
        await client.query('COMMIT');
        if (!upd.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
        chatLog('paypal_api_account_updated', { org_id: orgId, id });
        return res.json({ ok: true, item: sanitizePaypalAccountRow(upd.rows[0]) });
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

  app.delete('/api/paypal-api/accounts/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensurePaypalApiAccountsTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad_id' });
      const r = await pool.query(`DELETE FROM public.mod_paypal_api_accounts WHERE org_id=$1 AND id=$2 RETURNING id`, [orgId, id]);
      if (!r.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      chatLog('paypal_api_account_deleted', { org_id: orgId, id });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'accounts_delete_failed', message: e?.message || String(e) });
    }
  });
}
