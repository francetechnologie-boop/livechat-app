export async function onModuleLoaded({ module }) {
  try { console.log(`[agents] Loaded: ${module?.name||'agents'}`); } catch {}
}
export async function onModuleDisabled({ module }) {
  try { console.log(`[agents] Disabled: ${module?.name||'agents'}`); } catch {}
}
