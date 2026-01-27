export function registerCompanyChatHealthRoutes(app, ctx = {}) {
  app.get('/api/company-chat/ping', (_req, res) => res.json({ ok: true, module: 'company-chat' }));
  app.get('/api/company-chat/__ping', (_req, res) => res.json({ ok: true, module: 'company-chat' }));
  app.get('/api/company-chat/__routes', (_req, res) => {
    try {
      const stack = app?._router?.stack;
      const out = [];
      for (const layer of Array.isArray(stack) ? stack : []) {
        try {
          const route = layer?.route;
          if (!route?.path) continue;
          const p = String(route.path);
          if (!p.startsWith('/api/company-chat')) continue;
          const methods = Object.keys(route.methods || {}).filter((k) => route.methods[k]);
          out.push({ path: p, methods });
        } catch {}
      }
      res.json({ ok: true, routes: out });
    } catch {
      res.json({ ok: true, routes: [] });
    }
  });
}
