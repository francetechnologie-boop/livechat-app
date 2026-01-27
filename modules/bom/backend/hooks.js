export async function onModuleLoaded(ctx = {}) {
  try { ctx.logToFile?.('[bom] onModuleLoaded'); } catch {}
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx.logToFile?.('[bom] onModuleDisabled'); } catch {}
}

