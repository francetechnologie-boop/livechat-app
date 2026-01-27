/** @param {{ module?: { name?: string } }} param0 */
export async function onModuleLoaded({ module }) {
  try { console.log(`[Tools] Loaded: ${module?.name}`); } catch {}
}

/** @param {{ module?: { name?: string } }} param0 */
export async function onModuleDisabled({ module }) {
  try { console.log(`[Tools] Disabled: ${module?.name}`); } catch {}
}
