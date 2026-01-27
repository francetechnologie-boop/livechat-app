export async function onModuleLoaded({ module }) {
  try { console.log(`[testmcp] Loaded: ${module?.name || 'testmcp'}`); } catch {}
}

export async function onModuleDisabled() {}

