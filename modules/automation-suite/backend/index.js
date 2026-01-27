import { registerAutomationSuiteRoutes } from './routes/automation-suite.routes.js';
import { registerAutomationSuitePromptsRoutes } from './routes/prompts.routes.js';
import { registerAutomationSuiteVectorRoutes } from './routes/vector.routes.js';

export function register(app, ctx) {
  // Mount JSON parser for this module's API namespace
  try {
    const key = '/api/automation-suite';
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const json = ctx?.expressJson;
    if (typeof json === 'function' && !mounted.has(key)) { app.use(key, json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })); mounted.add(key); }
  } catch {}
  registerAutomationSuiteRoutes(app, ctx);
  registerAutomationSuitePromptsRoutes(app, ctx);
  registerAutomationSuiteVectorRoutes(app, ctx);
}
