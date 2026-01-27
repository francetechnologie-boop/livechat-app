import nodePath from 'path';
import { createRequire } from 'module';

import { registerStripeApiHealthRoutes } from './routes/health.routes.js';
import { registerStripeApiKeysRoutes } from './routes/keys.routes.js';
import { registerStripeApiProfilesRoutes } from './routes/profiles.routes.js';
import { registerStripeApiTransactionsRoutes } from './routes/transactions.routes.js';
import { registerStripeApiBalancesRoutes } from './routes/balances.routes.js';

function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
  try {
    const here = nodePath.dirname(new URL(import.meta.url).pathname);
    return nodePath.resolve(here, '..', '..', '..', 'backend');
  } catch {
    return process.cwd();
  }
}

function getJsonMiddleware(ctx) {
  const json = ctx?.expressJson;
  if (typeof json === 'function') return json;
  try {
    const req = createRequire(nodePath.join(resolveBackendDir(ctx), 'package.json'));
    const exp = req('express');
    if (exp && typeof exp.json === 'function') return exp.json;
  } catch {}
  return null;
}

export function register(app, ctx = {}) {
  try { registerStripeApiHealthRoutes(app, ctx); } catch {}

  try {
    const key = '/api/stripe-api';
    if (!globalThis.__moduleJsonMounted) globalThis.__moduleJsonMounted = new Set();
    const mounted = globalThis.__moduleJsonMounted;
    const json = getJsonMiddleware(ctx);
    if (!mounted.has(key)) {
      app.use(key, (req, res, next) => {
        const wantsBody = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
        if (wantsBody && typeof json === 'function') {
          return json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next);
        }
        return next();
      });
      mounted.add(key);
    }
  } catch {}

  registerStripeApiKeysRoutes(app, ctx);
  registerStripeApiProfilesRoutes(app, ctx);
  registerStripeApiTransactionsRoutes(app, ctx);
  registerStripeApiBalancesRoutes(app, ctx);
}

export function registerRoutes(app, ctx = {}) {
  return register(app, ctx);
}
