export function registerGrabbingSensorexHealthRoutes(app) {
  try { app.get('/api/grabbing-sensorex/__ping', (_req, res) => res.json({ ok: true, module: 'grabbing-sensorex' })); } catch (e) {}
}
