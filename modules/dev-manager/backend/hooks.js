export async function onModuleLoaded(ctx = {}) {
  try { ctx.logToFile?.('[hooks] dev-manager loaded'); } catch {}
  // No routes to mount explicitly; UI is front-end only for now.
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx.logToFile?.('[hooks] dev-manager disabled'); } catch {}
}

