import { installModule } from '../installer.js';

function requireAdminGuard(ctx = {}) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

// Tools module routes (namespaced under /api/tools/*)
export function registerToolsRoutes(app, ctx = {}) {
  // Health routes
  app.get('/api/tools/__ping', (_req, res) => res.json({ ok: true, module: 'tools' }));
  // Compatibility alias
  app.get('/api/tools/ping', (_req, res) => res.json({ ok: true, module: 'tools' }));

  // Diagnostics/info
  app.get('/api/tools/info', (_req, res) => {
    const info = {
      ok: true,
      module: 'tools',
      time: new Date().toISOString(),
    };
    res.json(info);
  });

  // List available routes for this module (lightweight)
  try {
    app.get('/api/tools/__routes', (req, res) => {
      const items = [
        'GET /api/tools/__ping',
        'GET /api/tools/ping',
        'GET /api/tools/info',
        'GET /api/tools/__routes',
        'GET /api/tools/email-from-template/__ping',
        'GET /api/tools/email-from-template/types',
        'GET /api/tools/email-from-template/render',
        'POST /api/tools/email-from-template/template',
        'POST /api/tools/email-template/translate',
        'GET /api/tools/devis/data',
        'GET /api/tools/devis/products',
        'GET /api/tools/devis/products/:id',
        'GET /api/tools/purchase-orders',
        'POST /api/tools/purchase-orders/preview',
        'POST /api/tools/purchase-orders/draft',
        'POST /api/tools/email/tickets',
        'POST /api/tools/installer/run',
        'GET /api/tools/openai/models',
        'GET /api/tools/relance/__ping',
        'GET /api/tools/relance/virement-bancaire',
        'GET /api/tools/relance/numero-de-maison',
        'GET /api/tools/relance/tracking',
        'GET /api/tools/relance/settings',
        'POST /api/tools/relance/settings',
        'POST /api/tools/relance/virement-bancaire/:idOrder/email-generate',
        'POST /api/tools/relance/virement-bancaire/:idOrder/email-draft',
        'POST /api/tools/relance/virement-bancaire/:idOrder/email-send',
        'POST /api/tools/relance/numero-de-maison/:idOrder/sms-draft',
        'POST /api/tools/relance/numero-de-maison/:idOrder/email-generate',
        'POST /api/tools/relance/numero-de-maison/:idOrder/email-send',
        'POST /api/tools/relance/tracking/:idOrder/sms-draft',
        'POST /api/tools/relance/tracking/:idOrder/email-generate',
        'POST /api/tools/relance/tracking/:idOrder/email-send',
        'GET /api/tools/information/__ping',
        'GET /api/tools/information/settings',
        'POST /api/tools/information/settings'
      ];
      res.json({ ok: true, items });
    });
  } catch {}

  const requireAdmin = requireAdminGuard(ctx);
  let installerRunning = false;
  app.post('/api/tools/installer/run', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (installerRunning) {
      return res.status(409).json({ ok: false, error: 'installer_busy', message: 'Installer already running' });
    }
    installerRunning = true;
    try {
      await installModule();
      return res.json({ ok: true, message: 'Installer completed' });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'installer_failed',
        message: String(error?.message || error),
      });
    } finally {
      installerRunning = false;
    }
  });
}
