export async function onModuleLoaded(ctx = {}) {
  const pool = ctx.pool;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_google_api_settings (
        id SERIAL PRIMARY KEY,
        org_id TEXT DEFAULT 'org_default',
        client_id TEXT,
        client_secret TEXT,
        redirect_uri TEXT,
        scopes TEXT[],
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_mod_google_api_settings_org UNIQUE(org_id)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_google_api_tokens (
        id SERIAL PRIMARY KEY,
        org_id TEXT DEFAULT 'org_default',
        access_token TEXT,
        refresh_token TEXT,
        token_type TEXT,
        expiry_date BIGINT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    ctx.logToFile?.('[google-api] onModuleLoaded completed');

    // Idempotent legacy backfill from settings/env into module tables
    try {
      // Only backfill config if no row exists yet
      const cur = await pool.query(`SELECT 1 FROM mod_google_api_settings WHERE org_id='org_default' LIMIT 1`);
      if (!cur.rowCount) {
        // Prefer settings table
        const get = async (k) => {
          try { const r = await pool.query(`SELECT value FROM settings WHERE key=$1 LIMIT 1`, [k]); return (r.rowCount && r.rows[0].value) ? String(r.rows[0].value).trim() : ''; } catch { return ''; }
        };
        const clientId = (await get('GOOGLE_OAUTH_CLIENT_ID')) || String(process.env.GOOGLE_OAUTH_CLIENT_ID||'').trim();
        const clientSecret = (await get('GOOGLE_OAUTH_CLIENT_SECRET')) || String(process.env.GOOGLE_OAUTH_CLIENT_SECRET||'').trim();
        const redirectUri = (await get('GOOGLE_OAUTH_REDIRECT_URI')) || String(process.env.GOOGLE_OAUTH_REDIRECT_URI||'').trim();
        const scopesRaw = await get('GOOGLE_OAUTH_SCOPES');
        let scopes = [];
        try { if (scopesRaw) { const j = JSON.parse(scopesRaw); if (Array.isArray(j)) scopes = j.map(String); } } catch {}
        if (!scopes.length) scopes = ['https://www.googleapis.com/auth/userinfo.email'];
        if (clientId || clientSecret || redirectUri) {
          await pool.query(`
            INSERT INTO mod_google_api_settings (org_id, client_id, client_secret, redirect_uri, scopes, updated_at)
            VALUES ('org_default',$1,$2,$3,$4::text[],NOW())
            ON CONFLICT (org_id)
            DO UPDATE SET client_id=EXCLUDED.client_id, client_secret=EXCLUDED.client_secret, redirect_uri=EXCLUDED.redirect_uri, scopes=EXCLUDED.scopes, updated_at=NOW()
          `, [clientId||null, clientSecret||null, redirectUri||null, scopes]);
          ctx.logToFile?.('[google-api] Backfilled settings from legacy settings/env');
        }
      }
    } catch (e) {
      ctx.logToFile?.(`[google-api] backfill error: ${e?.message || e}`);
    }
  } catch (e) {
    ctx.logToFile?.(`[google-api] onModuleLoaded error: ${e?.message || e}`);
  }
}

export async function onModuleDisabled(_ctx = {}) {}
