export async function onModuleLoaded({ module, logToFile }) {
  try { logToFile?.(`[company-chat] Loaded: ${module?.name || 'company-chat'}`); } catch {}
}
export async function onModuleDisabled({ module, logToFile }) {
  try { logToFile?.(`[company-chat] Disabled: ${module?.name || 'company-chat'}`); } catch {}
}
