export async function onModuleLoaded(ctx = {}) {
  try { ctx.logToFile?.('[grabbing-sensorex] onModuleLoaded'); } catch (e) {}
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx.logToFile?.('[grabbing-sensorex] onModuleDisabled'); } catch (e) {}
}
