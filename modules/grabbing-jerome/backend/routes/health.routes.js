export function registerGrabbingJeromeHealthRoutes(app, _ctx) {
  try { app.get('/api/grabbing-jerome/__ping', (_req, res) => res.json({ ok: true, module: 'grabbing-jerome' })); } catch {}
  try { app.get('/api/grabbing-jerome/ping', (_req, res) => res.json({ ok: true, module: 'grabbing-jerome' })); } catch {}
  // Legacy aliases (plural grabbings) for older UI
  try { app.get('/api/grabbings/jerome/__ping', (_req, res) => res.json({ ok: true, module: 'grabbing-jerome' })); } catch {}
  try { app.get('/api/grabbings/jerome/ping', (_req, res) => res.json({ ok: true, module: 'grabbing-jerome' })); } catch {}
  // Admin-only: list mounted routes for this module (sanity check after reload)
  try {
    app.get('/api/grabbing-jerome/__routes', (req, res) => {
      try {
        const requireAdmin = _ctx && typeof _ctx.requireAdmin === 'function' ? _ctx.requireAdmin : null;
        if (requireAdmin) { const u = requireAdmin(req, res); if (!u) return; }
      } catch {}
      try {
        const out = [];
        const stack = (app && app._router && Array.isArray(app._router.stack)) ? app._router.stack : [];
        for (const layer of stack) {
          try {
            if (layer && layer.route && layer.route.path) {
              const path = String(layer.route.path || '');
              if (path.startsWith('/api/grabbing-jerome')) {
                const methods = Object.keys(layer.route.methods || {}).filter(m => layer.route.methods[m]);
                out.push({ path, methods });
              }
            } else if (layer && layer.name === 'router' && Array.isArray(layer.handle && layer.handle.stack)) {
              for (const sub of layer.handle.stack) {
                try {
                  if (sub && sub.route && sub.route.path) {
                    const p = String(sub.route.path || '');
                    if (p.startsWith('/api/grabbing-jerome')) {
                      const ms = Object.keys(sub.route.methods || {}).filter(m => sub.route.methods[m]);
                      out.push({ path: p, methods: ms });
                    }
                  }
                } catch {}
              }
            }
          } catch {}
        }
        return res.json({ ok: true, items: out });
      } catch (e) { return res.status(500).json({ ok:false, error:'routes_dump_failed', message: e?.message || String(e) }); }
    });
  } catch {}
}
