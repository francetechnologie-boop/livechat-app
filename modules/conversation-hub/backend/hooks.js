export async function onModuleLoaded(ctx = {}) {
  try { console.log(`[conversation-hub] Loaded: ${ctx?.module?.name || 'conversation-hub'}`); } catch {}
  // Apply migrations idempotently when hooks load
  try {
    const m = await import('./installer.js');
    if (typeof m.installModule === 'function') await m.installModule(ctx);
  } catch {}
}

export async function onModuleDisabled({ module }) {
  try { console.log(`[conversation-hub] Disabled: ${module?.name || 'conversation-hub'}`); } catch {}
}

