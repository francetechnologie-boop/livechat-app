import { ensureProfilesTable } from './utils/ensure.js';

export async function onModuleLoaded(ctx = {}) {
  try { ctx?.chatLog?.('ftp_connection_loaded', { module: 'ftp-connection' }); } catch {}
  try {
    const pool = ctx?.pool;
    if (pool && typeof pool.query === 'function') {
      await ensureProfilesTable(pool);
      try { ctx?.chatLog?.('ftp_profiles_table_ensured', { table: 'public.mod_ftp_connection_profiles' }); } catch {}
    }
  } catch (e) {
    try { ctx?.chatLog?.('ftp_profiles_table_ensure_failed', { error: String(e?.message||e) }); } catch {}
  }
}
