export async function registerDbPostgresqlRoutes(app, ctx = {}) {
  const mods = [
    './profiles.routes.js',
    './test.routes.js',
    './views.routes.js',
    './resources.routes.js',
  ];
  for (const m of mods) {
    try {
      const mod = await import(m);
      const fns = Object.values(mod).filter(fn => typeof fn === 'function' && /register.*Routes/i.test(fn.name));
      for (const fn of fns) { try { fn(app, ctx); } catch {} }
    } catch {}
  }
}
