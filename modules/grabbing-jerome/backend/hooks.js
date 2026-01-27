export async function onModuleLoaded(ctx = {}) {
  try { ctx.logToFile?.('[grabbing-jerome] onModuleLoaded'); } catch {}
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx.logToFile?.('[grabbing-jerome] onModuleDisabled'); } catch {}
}

