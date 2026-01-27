import type { Express, Request, Response } from "express";

// Register Dev Manager HTTP routes, fully namespaced
export function registerDevManagerRoutes(app: Express) {
  app.get("/api/dev-manager/examples", (_req: Request, res: Response) => {
    res.json({ items: [] });
  });
}

// Backward-compat export for any loaders referencing the old name
export const registerExampleRoutes = registerDevManagerRoutes;
