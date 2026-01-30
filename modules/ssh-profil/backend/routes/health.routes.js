export function registerSshProfilHealthRoutes(app, _ctx = {}, utils = {}) {
  const base = utils?.base || '/api/ssh-profil';
  if (!app) return;
  app.get(`${base}/__ping`, (_req, res) => res.json({ ok: true }));
}

