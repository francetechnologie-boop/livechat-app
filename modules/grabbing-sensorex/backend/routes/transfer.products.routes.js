// Loader-agnostic (CJS/ESM) registration for product transfer
export function registerGrabbingSensorexTransferProductRoutes(app, ctx = {}, utils = {}) {
  if (!app) return;
  // POST /api/grabbing-sensorex/transfer/product
  app.post('/api/grabbing-sensorex/transfer/product', async (req, res) => {
    try {
      try {
        const log = (utils && typeof utils.chatLog === 'function') ? utils.chatLog : (ctx && typeof ctx.chatLog === 'function' ? ctx.chatLog : null);
        if (log) log('transfer_route_enter', { route: '/api/grabbing-sensorex/transfer/product' });
      } catch {}
      const mod = await import('../services/transfer/products.service.js');
      const fn = mod?.sendProducts || mod?.default?.sendProducts;
      if (typeof fn === 'function') return fn(req, res, ctx, utils);
      return res.status(500).json({ ok:false, error:'products_service_missing' });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'products_service_error', message: e?.message || String(e) });
    }
  });
}
