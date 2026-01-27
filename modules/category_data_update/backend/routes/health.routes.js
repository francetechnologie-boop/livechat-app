export function registerCategoryDataUpdateHealthRoutes(app, _ctx = {}) {
  app.get('/api/category_data_update/__ping', (_req, res) => res.json({ ok: true }));
  // Introspection helper to list mounted routes under this module's prefix
  app.get('/api/category_data_update/__routes', (req, res) => {
    try {
      const out = [];
      const stack = (app && app._router && app._router.stack) ? app._router.stack : [];
      for (const layer of stack) {
        try {
          if (layer.route && layer.route.path) {
            const methods = Object.keys(layer.route.methods||{}).filter(m=>layer.route.methods[m]);
            const path = String(layer.route.path||'');
            if (path.startsWith('/api/category_data_update')) out.push({ method: methods.join(','), path });
          }
        } catch (e) {}
      }
      out.sort((a,b)=>String(a.path).localeCompare(String(b.path)));
      res.json({ ok:true, items: out });
    } catch (e) {
      res.status(500).json({ ok:false, error:'introspection_failed', message: e?.message || String(e) });
    }
  });
}
