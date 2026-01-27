export function registerDhlHealthRoutes(app, ctx = {}) {
  app.get('/api/dhl/__ping', (_req, res) => res.json({ ok: true, module: 'dhl' }));

  // Quick diagnostics: list mounted DHL routes for this module (best-effort)
  app.get('/api/dhl/__routes', (_req, res) => {
    try {
      const stack = app?._router?.stack || [];
      const routes = [];
      for (const layer of stack) {
        try {
          if (!layer?.route?.path) continue;
          const path = layer.route.path;
          if (typeof path !== 'string' || !path.startsWith('/api/dhl')) continue;
          const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m]);
          routes.push({ path, methods });
        } catch {}
      }
      routes.sort((a, b) => String(a.path).localeCompare(String(b.path)));
      return res.json({ ok: true, routes });
    } catch (e) {
      try { ctx?.chatLog?.('routes_list_failed', { message: e?.message || String(e) }); } catch {}
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}

