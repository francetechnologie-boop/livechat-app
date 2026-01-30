import { ensureProfilesTable } from './utils/ensure.js';

export async function onModuleLoaded(ctx = {}) {
  try { ctx?.chatLog?.('ssh_profil_loaded', { module: 'ssh-profil' }); } catch {}
  try {
    const pool = ctx?.pool;
    if (pool && typeof pool.query === 'function') {
      await ensureProfilesTable(pool);
      try { ctx?.chatLog?.('ssh_profil_profiles_table_ensured', { table: 'public.mod_ssh_profil_profiles' }); } catch {}
    }
  } catch (e) {
    try { ctx?.chatLog?.('ssh_profil_profiles_table_ensure_failed', { error: String(e?.message || e) }); } catch {}
  }
}

