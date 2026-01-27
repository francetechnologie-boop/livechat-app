export async function registerDbMysqlRoutes(app, ctx = {}) {
  const mods = [
    './test.routes.js',
    './views.routes.js',
    './ai.routes.js',
    './profiles.routes.js',
    './tables.routes.js',
  ];
  for (const m of mods) {
    try {
      const mod = await import(m);
      const fns = Object.values(mod).filter(fn => typeof fn === 'function' && /register.*Routes/i.test(fn.name));
      for (const fn of fns) { try { fn(app, ctx); } catch {} }
    } catch {}
  }
}
