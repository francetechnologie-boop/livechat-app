// SSH Profil module – backend entry
// Exports register(app, ctx) and mounts routes under /api/ssh-profil

import { registerSshProfilHealthRoutes } from './routes/health.routes.js';
import { registerSshProfilProfilesRoutes } from './routes/profiles.routes.js';

export function register(app, ctx = {}) {
  if (!app) return;
  const base = '/api/ssh-profil';

  // Mount JSON parser only for methods that can carry a body
  const wantsBody = (req) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req?.method || '').toUpperCase());
  try {
    const json = ctx?.expressJson || ((opts) => ((req, res, next) => next()));
    app.use(base, (req, res, next) =>
      wantsBody(req)
        ? json({ limit: process.env.API_JSON_LIMIT || '50mb', strict: false })(req, res, next)
        : next()
    );
  } catch {}

  try { registerSshProfilHealthRoutes(app, ctx, { base }); } catch {}
  try { registerSshProfilProfilesRoutes(app, ctx, { base }); } catch {}
}

