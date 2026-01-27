export async function onModuleLoaded(ctx = {}) {
  try { ctx?.logToFile?.(`[security] onModuleLoaded ok`); } catch {}
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx?.logToFile?.(`[security] onModuleDisabled`); } catch {}
}

