import { registerCompanyChatAutomationCompatRoutes } from './routes/automation-compat.routes.js';
import { registerCompanyChatConfigRoutes } from './routes/config.routes.js';
import { registerCompanyChatHealthRoutes } from './routes/health.routes.js';
import { registerCompanyChatPrestaRoutes } from './routes/prestashop.routes.js';
import { registerCompanyChatRespondRoutes } from './routes/respond.routes.js';
import { registerCompanyChatSessionsRoutes } from './routes/sessions.routes.js';
import { registerCompanyChatTabsRoutes } from './routes/tabs.routes.js';

export function register(app, ctx) {
  // Health must be fast and must not depend on JSON parsing
  registerCompanyChatHealthRoutes(app, ctx);

  // Mount JSON parser only for methods that carry a body
  try {
    const base = '/api/company-chat';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(base)) {
      app.use(base, (req, res, next) => {
        const wantsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase());
        if (!wantsBody) return next();
        return json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next);
      });
      mounted.add(base);
    }
  } catch {}

  // API routes (namespaced)
  registerCompanyChatConfigRoutes(app, ctx);
  registerCompanyChatTabsRoutes(app, ctx);
  registerCompanyChatSessionsRoutes(app, ctx);
  registerCompanyChatRespondRoutes(app, ctx);
  registerCompanyChatPrestaRoutes(app, ctx);
  registerCompanyChatAutomationCompatRoutes(app, ctx);
}
