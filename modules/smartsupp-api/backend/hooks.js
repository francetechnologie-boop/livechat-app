export async function onModuleLoaded(ctx = {}) {
  const pool = ctx.pool;
  const log = (msg) => { try { ctx.logToFile?.(`[smartsupp-api] ${msg}`); } catch {} };
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mod_smartsupp_api_settings (
        id SERIAL PRIMARY KEY,
        org_id TEXT DEFAULT 'org_default',
        api_token TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT uq_mod_smartsupp_api_settings_org UNIQUE(org_id)
      );
    `);

    // One-time backfill from legacy storage (settings table / env)
    // Only if no token set yet for org_default
    const cur = await pool.query(`SELECT api_token FROM mod_smartsupp_api_settings WHERE org_id='org_default' LIMIT 1`);
    const already = cur.rowCount && String(cur.rows[0].api_token || '').trim();
    if (!already) {
      let legacy = null;
      try {
        const r = await pool.query(`SELECT value FROM settings WHERE key='SMARTSUPP_API_TOKEN' LIMIT 1`);
        legacy = (r.rowCount ? (r.rows[0].value || '') : '').trim();
      } catch {}
      if (!legacy) {
        legacy = String(process.env.SMARTSUPP_API_TOKEN || process.env.SMARTSUPP_ACCESS_TOKEN || process.env.SMARTSUPP_TOKEN || '').trim();
      }
      if (legacy) {
        await pool.query(`
          INSERT INTO mod_smartsupp_api_settings (org_id, api_token, created_at, updated_at)
          VALUES ('org_default', $1, NOW(), NOW())
          ON CONFLICT (org_id) DO UPDATE SET api_token = EXCLUDED.api_token, updated_at = NOW();
        `, [legacy]);
        log('Imported legacy SMARTSUPP_API_TOKEN into module table');
      }
    }

    log('onModuleLoaded completed');
  } catch (e) {
    log(`onModuleLoaded error: ${e?.message || e}`);
  }
}

export async function onModuleDisabled(_ctx = {}) {
  // No-op placeholder; keep data intact.
}
