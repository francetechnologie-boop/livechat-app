// ESM runtime version of dev-manager routes
export function registerDevManagerRoutes(app) {
  app.get('/api/dev-manager/examples', (_req, res) => {
    res.json({ items: [] });
  });
}

// Back-compat alias
export const registerExampleRoutes = registerDevManagerRoutes;

