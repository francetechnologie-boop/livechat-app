export async function onModuleLoaded({ module }) { try { console.log(`[gateway] Loaded: ${module?.name||'gateway'}`); } catch {} }
export async function onModuleDisabled({ module }) { try { console.log(`[gateway] Disabled: ${module?.name||'gateway'}`); } catch {} }

