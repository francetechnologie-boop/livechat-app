export async function onModuleLoaded(ctx = {}) {
  try { console.log(`[automation-suite] Loaded: ${ctx?.module?.name || 'automation-suite'}`); } catch {}
  // Apply module migrations idempotently when hooks are loaded
  try {
    const m = await import('./installer.js');
    if (typeof m.onModuleLoaded === 'function') await m.onModuleLoaded(ctx);
  } catch {}
}
export async function onModuleDisabled({ module }) { try { console.log(`[automation-suite] Disabled: ${module?.name||'automation-suite'}`); } catch {} }
