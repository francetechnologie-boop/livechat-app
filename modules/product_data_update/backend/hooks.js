export async function onModuleLoaded(ctx = {}) {
  try { ctx.logToFile?.('[product_data_update] onModuleLoaded'); } catch {}
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx.logToFile?.('[product_data_update] onModuleDisabled'); } catch {}
}

