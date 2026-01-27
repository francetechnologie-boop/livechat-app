export async function onModuleLoaded(ctx = {}) {
  try { ctx.logToFile?.('[category_data_update] onModuleLoaded'); } catch (e) {}
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx.logToFile?.('[category_data_update] onModuleDisabled'); } catch (e) {}
}
