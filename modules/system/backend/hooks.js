export async function onModuleLoaded({ module }) { try { console.log(`[system] Loaded: ${module?.name||'system'}`); } catch {} }
export async function onModuleDisabled({ module }) { try { console.log(`[system] Disabled: ${module?.name||'system'}`); } catch {} }

