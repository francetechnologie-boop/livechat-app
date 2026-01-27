// FTP Connection module – backend entry
// Exports register(app, ctx) and mounts routes under /api/ftp-connection

export function register(app, ctx = {}) {
  if (!app) return;
  const base = '/api/ftp-connection';
  // Mount JSON parser only for methods that can carry a body
  const wantsBody = (req) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req?.method || '').toUpperCase());
  try {
    const json = ctx?.expressJson || ((opts)=>((req,res,next)=>next()));
    app.use(base, (req, res, next) => wantsBody(req) ? json({ limit: process.env.API_JSON_LIMIT || '50mb', strict: false })(req, res, next) : next());
  } catch {}

  // Register routes
  (async () => {
    try {
      const m = await import('./routes/profiles.routes.js');
      if (m && typeof m.registerFtpProfilesRoutes === 'function') m.registerFtpProfilesRoutes(app, ctx, { base });
    } catch {}
  })();
}

