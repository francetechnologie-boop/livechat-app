import { installModule } from './installer.js';

export async function onModuleLoaded(ctx = {}) {
  try {
    if (!globalThis.__moduleInstalledOnce) globalThis.__moduleInstalledOnce = new Set();
    const k = 'fio-banka';
    if (!globalThis.__moduleInstalledOnce.has(k)) {
      globalThis.__moduleInstalledOnce.add(k);
      await installModule();
    }
  } catch {}
  try { ctx?.logToFile?.('[fio-banka] onModuleLoaded'); } catch {}
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx?.logToFile?.('[fio-banka] onModuleDisabled'); } catch {}
}
