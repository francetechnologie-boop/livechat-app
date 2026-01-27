import { stripeRequest } from '../services/stripeHttp.js';

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
      last_balance JSONB NULL,
      last_balance_at TIMESTAMPTZ NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_mod_stripe_api_keys UNIQUE(org_id, name)
    );
  `);
  await pool.query(`ALTER TABLE public.mod_stripe_api_keys ADD COLUMN IF NOT EXISTS last_balance JSONB NULL;`);
  await pool.query(`ALTER TABLE public.mod_stripe_api_keys ADD COLUMN IF NOT EXISTS last_balance_at TIMESTAMPTZ NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_keys_org ON public.mod_stripe_api_keys(org_id);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_stripe_api_keys_default_org ON public.mod_stripe_api_keys (COALESCE(org_id,0)) WHERE is_default;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_keys_org_balance_at ON public.mod_stripe_api_keys(org_id, last_balance_at DESC NULLS LAST);`);
}

function maskKey(secret) {
  const s = String(secret || '');
  if (!s) return { has_secret: false, secret_last4: null };
  const last4 = s.length >= 4 ? s.slice(-4) : s;
  return { has_secret: true, secret_last4: last4 };
}

function inferMode(secretKey) {
  const s = String(secretKey || '');
  if (s.startsWith('sk_test_')) return 'test';
  if (s.startsWith('sk_live_')) return 'live';
  return null;
}

export function registerStripeApiKeysRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const chatLog = typeof ctx.chatLog === 'function' ? ctx.chatLog : (() => {});
  if (!pool) return;

  app.get('/api/stripe-api/keys', async (req, res) => {
    try {
      await ensureKeysTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const r = await pool.query(
        `
          SELECT id, org_id, name, is_default, value, created_at, updated_at
            FROM public.mod_stripe_api_keys
           WHERE org_id = $1
           ORDER BY is_default DESC, updated_at DESC, id DESC
        `,
        [orgId]
      );
      const items = (r.rows || []).map((row) => {
        const value = row.value && typeof row.value === 'object' ? row.value : {};
        const secretKey = value.secret_key ? String(value.secret_key) : '';
        const masked = maskKey(secretKey);
        return {
          id: row.id,
          org_id: row.org_id,
          name: row.name,
          is_default: !!row.is_default,
          mode: value.mode || inferMode(secretKey),
          account_id: value.account_id || null,
          publishable_key: value.publishable_key || null,
          has_secret: masked.has_secret,
          secret_last4: masked.secret_last4,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      });
      return res.json({ ok: true, items, org_id: orgId });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'keys_list_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/stripe-api/keys/test', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const secretKey = String(req.body?.secret_key || '').trim();
      if (!secretKey) return res.status(400).json({ ok: false, error: 'secret_key_required' });
      const r = await stripeRequest({ secretKey, method: 'GET', path: '/v1/account' });
      return res.json({
        ok: true,
        account: {
          id: r.data?.id || null,
          country: r.data?.country || null,
          default_currency: r.data?.default_currency || null,
          charges_enabled: !!r.data?.charges_enabled,
          payouts_enabled: !!r.data?.payouts_enabled,
          livemode: !!r.data?.livemode,
        },
        mode: inferMode(secretKey),
      });
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'stripe_test_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/stripe-api/keys', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureKeysTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const name = String(req.body?.name || '').trim();
      const secretKey = String(req.body?.secret_key || '').trim();
      const publishableKey = (req.body?.publishable_key != null) ? String(req.body.publishable_key).trim() : null;
      const makeDefault = req.body?.is_default === true;
      if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
      if (!secretKey) return res.status(400).json({ ok: false, error: 'secret_key_required' });
      if (!secretKey.startsWith('sk_')) return res.status(400).json({ ok: false, error: 'invalid_secret_key' });

      const test = await stripeRequest({ secretKey, method: 'GET', path: '/v1/account' });
      const value = {
        mode: inferMode(secretKey),
        account_id: test.data?.id || null,
        publishable_key: publishableKey || null,
        secret_key: secretKey,
      };

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (makeDefault) {
          await client.query(`UPDATE public.mod_stripe_api_keys SET is_default=FALSE, updated_at=NOW() WHERE org_id=$1`, [orgId]);
        }
        const ins = await client.query(
          `
            INSERT INTO public.mod_stripe_api_keys(org_id, name, value, is_default, created_at, updated_at)
            VALUES ($1,$2,$3,$4,NOW(),NOW())
            RETURNING id, org_id, name, is_default, value, created_at, updated_at
          `,
          [orgId, name, value, makeDefault]
        );
        await client.query('COMMIT');
        const row = ins.rows[0];
        chatLog('stripe_api_key_created', { org_id: orgId, id: row?.id, name });
        const masked = maskKey(secretKey);
        return res.status(201).json({
          ok: true,
          item: {
            id: row.id,
            org_id: row.org_id,
            name: row.name,
            is_default: !!row.is_default,
            mode: value.mode,
            account_id: value.account_id,
            publishable_key: value.publishable_key,
            has_secret: masked.has_secret,
            secret_last4: masked.secret_last4,
            created_at: row.created_at,
            updated_at: row.updated_at,
          },
        });
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'keys_create_failed', message: e?.message || String(e) });
    }
  });

  app.post('/api/stripe-api/keys/:id/default', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureKeysTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad_id' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE public.mod_stripe_api_keys SET is_default=FALSE, updated_at=NOW() WHERE org_id=$1`, [orgId]);
        const r = await client.query(
          `UPDATE public.mod_stripe_api_keys SET is_default=TRUE, updated_at=NOW() WHERE org_id=$1 AND id=$2 RETURNING id`,
          [orgId, id]
        );
        await client.query('COMMIT');
        if (!r.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
        chatLog('stripe_api_key_default_set', { org_id: orgId, id });
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

  app.patch('/api/stripe-api/keys/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureKeysTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad_id' });
      const name = (req.body?.name != null) ? String(req.body.name).trim() : null;
      const secretKey = (req.body?.secret_key != null) ? String(req.body.secret_key).trim() : null;
      const publishableKey = (req.body?.publishable_key != null) ? String(req.body.publishable_key).trim() : null;
      const makeDefault = req.body?.is_default === true;

      const cur = await pool.query(`SELECT id, value FROM public.mod_stripe_api_keys WHERE org_id=$1 AND id=$2`, [orgId, id]);
      if (!cur.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      const prev = cur.rows[0]?.value && typeof cur.rows[0].value === 'object' ? cur.rows[0].value : {};
      const nextValue = { ...prev };
      if (publishableKey !== null) nextValue.publishable_key = publishableKey || null;

      if (secretKey !== null) {
        if (!secretKey) return res.status(400).json({ ok: false, error: 'secret_key_required' });
        if (!secretKey.startsWith('sk_')) return res.status(400).json({ ok: false, error: 'invalid_secret_key' });
        const test = await stripeRequest({ secretKey, method: 'GET', path: '/v1/account' });
        nextValue.secret_key = secretKey;
        nextValue.mode = inferMode(secretKey);
        nextValue.account_id = test.data?.id || null;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (makeDefault) {
          await client.query(`UPDATE public.mod_stripe_api_keys SET is_default=FALSE, updated_at=NOW() WHERE org_id=$1`, [orgId]);
        }
        const upd = await client.query(
          `
            UPDATE public.mod_stripe_api_keys
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
        const row = upd.rows[0];
        const secret = nextValue.secret_key ? String(nextValue.secret_key) : '';
        const masked = maskKey(secret);
        chatLog('stripe_api_key_updated', { org_id: orgId, id });
        return res.json({
          ok: true,
          item: {
            id: row.id,
            org_id: row.org_id,
            name: row.name,
            is_default: !!row.is_default,
            mode: row.value?.mode || inferMode(secret),
            account_id: row.value?.account_id || null,
            publishable_key: row.value?.publishable_key || null,
            has_secret: masked.has_secret,
            secret_last4: masked.secret_last4,
            created_at: row.created_at,
            updated_at: row.updated_at,
          },
        });
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch {}
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'keys_update_failed', message: e?.message || String(e) });
    }
  });

  app.delete('/api/stripe-api/keys/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await ensureKeysTable(pool);
      const orgId = toOrgInt(pickOrgId(req)) ?? 1;
      const id = Number(req.params?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad_id' });
      const r = await pool.query(`DELETE FROM public.mod_stripe_api_keys WHERE org_id=$1 AND id=$2`, [orgId, id]);
      if (!r.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      chatLog('stripe_api_key_deleted', { org_id: orgId, id });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'keys_delete_failed', message: e?.message || String(e) });
    }
  });
}
