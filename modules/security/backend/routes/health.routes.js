export function registerSecurityHealthRoutes(app, _ctx = {}) {
  app.get('/api/security/__ping', (_req, res) => res.json({ ok: true, module: 'security' }));
  app.get('/api/security/__routes', (_req, res) => res.json({
    ok: true,
    routes: [
      'GET /api/security/__ping',
      'GET /api/security/__routes',
      'GET /api/security/notes/:tab',
      'PUT /api/security/notes/:tab',
      'GET /api/security/ufw/status',
      'GET /api/security/remote/apache/access-log',
      'GET /api/security/remote/apache/files',
      'GET /api/security/remote/apache/tail',
      'GET /api/security/settings',
      'PUT /api/security/settings',
      'GET /api/security/fail2ban/jails',
      'GET /api/security/fail2ban/jails/:jail',
      'GET /api/security/fail2ban/analyze',
      'GET /api/security/commands',
      'POST /api/security/commands',
      'PUT /api/security/commands/:id',
      'DELETE /api/security/commands/:id',
      'POST /api/security/commands/:id/run',
      'GET /api/security/goaccess/dashboards',
      'POST /api/security/goaccess/dashboards',
      'PUT /api/security/goaccess/dashboards/:id',
      'DELETE /api/security/goaccess/dashboards/:id'
    ]
  }));
}
