export async function onModuleLoaded({ module }) { try { console.log(`[shared] Loaded: ${module?.name||'shared'}`); } catch {} }
export async function onModuleDisabled({ module }) { try { console.log(`[shared] Disabled: ${module?.name||'shared'}`); } catch {} }

