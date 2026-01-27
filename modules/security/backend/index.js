import { registerSecurityHealthRoutes } from './routes/health.routes.js';
import { registerSecurityNotesRoutes } from './routes/notes.routes.js';
import { registerSecurityUfwRoutes } from './routes/ufw.routes.js';
import { registerSecurityFail2banRoutes } from './routes/fail2ban.routes.js';
import { registerSecurityRemoteLogRoutes } from './routes/remoteLog.routes.js';
import { registerSecurityRemoteConnectionsRoutes } from './routes/remoteConnections.routes.js';
import { registerSecuritySettingsRoutes } from './routes/settings.routes.js';
import { registerSecurityCommandsRoutes } from './routes/commands.routes.js';
import { registerSecurityGoaccessRoutes } from './routes/goaccess.routes.js';

export function register(app, ctx = {}) {
  registerSecurityHealthRoutes(app, ctx);

  // Mount JSON parser only when a body is expected (avoid stalling fast GET endpoints).
  try {
    const base = '/api/security';
    const json = ctx?.expressJson;
    const mounted = (globalThis.__moduleJsonMounted ||= new Set());
    const key = `${base}::guarded`;
    if (typeof json === 'function' && !mounted.has(key)) {
      app.use(base, (req, res, next) => {
        const wantsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase());
        return wantsBody ? json({ limit: String(process.env.API_JSON_LIMIT || '50mb'), strict: false })(req, res, next) : next();
      });
      mounted.add(key);
    }
  } catch {}

  registerSecurityNotesRoutes(app, ctx);
  registerSecurityUfwRoutes(app, ctx);
  registerSecurityFail2banRoutes(app, ctx);
  registerSecurityRemoteConnectionsRoutes(app, ctx);
  registerSecurityRemoteLogRoutes(app, ctx);
  registerSecuritySettingsRoutes(app, ctx);
  registerSecurityCommandsRoutes(app, ctx);
  registerSecurityGoaccessRoutes(app, ctx);
}

export default register;
