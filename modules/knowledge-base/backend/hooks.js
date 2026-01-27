export async function onModuleLoaded(ctx = {}) {
  try { ctx.logToFile?.('[hooks] knowledge-base loaded'); } catch {}
  // Add backend routes here if/when needed.
}

export async function onModuleDisabled(ctx = {}) {
  try { ctx.logToFile?.('[hooks] knowledge-base disabled'); } catch {}
}

