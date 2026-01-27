import { registerToolsRoutes } from './routes/tools.routes.js';
import { registerToolsDevisRoutes } from './routes/devis.routes.js';
import { registerOpenaiRoutes } from './routes/openai.routes.js';
import { registerToolsEmailFromTemplateRoutes } from './routes/email-from-template.routes.js';
import { registerToolsEmailTemplateCreatorRoutes } from './routes/email-template-creator.routes.js';
import { registerToolsEmailTicketsRoutes } from './routes/email-tickets.routes.js';
import { registerToolsTicketRoutes } from './routes/ticket.routes.js';
import { registerToolsSettingsRoutes } from './routes/settings.routes.js';
import { registerToolsPurchaseOrdersRoutes } from './routes/purchase-orders.routes.js';
import { registerToolsRelanceRoutes } from './routes/relance.routes.js';
import { registerToolsInformationRoutes } from './routes/information.routes.js';

export function register(app, ctx) {
  // Mount JSON parser for this module's API namespace
  try {
    const key = '/api/tools';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) {
      app.use(key, (req, res, next) => {
        const m = req.method;
        const wantsBody = m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
        return wantsBody ? json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next) : next();
      });
      mounted.add(key);
    }
  } catch {}
  // Register routes exposed by this module
  registerToolsRoutes(app, ctx);
  registerToolsDevisRoutes(app, ctx);
  registerToolsEmailFromTemplateRoutes(app, ctx);
  registerToolsEmailTemplateCreatorRoutes(app, ctx);
  registerOpenaiRoutes(app, ctx);
  registerToolsEmailTicketsRoutes(app, ctx);
  registerToolsTicketRoutes(app, ctx);
  registerToolsSettingsRoutes(app, ctx);
  registerToolsPurchaseOrdersRoutes(app, ctx);
  registerToolsRelanceRoutes(app, ctx);
  registerToolsInformationRoutes(app, ctx);
}

// Do not declare inline routes here (policy: keep under backend/routes)
