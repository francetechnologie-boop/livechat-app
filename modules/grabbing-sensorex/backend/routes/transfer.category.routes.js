// Loader-agnostic (CJS/ESM) registration for category transfer
export function registerGrabbingSensorexTransferCategoryRoutes(app, ctx = {}, utils = {}) {
  if (!app) return;
  // POST /api/grabbing-sensorex/transfer/category
  app.post('/api/grabbing-sensorex/transfer/category', async (req, res) => {
    try {
      try {
        const log = (utils && typeof utils.chatLog === 'function') ? utils.chatLog : (ctx && typeof ctx.chatLog === 'function' ? ctx.chatLog : null);
        if (log) log('transfer_route_enter', { route: '/api/grabbing-sensorex/transfer/category' });
      } catch {}
      const mod = await import('../services/transfer/category.service.js');
      const fn = mod?.sendCategory || mod?.default?.sendCategory;
      if (typeof fn === 'function') return fn(req, res, ctx, utils);
      return res.status(500).json({ ok:false, error:'category_service_missing' });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'category_service_error', message: e?.message || String(e) });
    }
  });
}
