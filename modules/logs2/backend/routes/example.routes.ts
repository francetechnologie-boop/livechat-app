import type { Express, Request, Response } from "express";

export function registerExampleRoutes(app: Express) {
  app.get("/api/module-template/examples", (_req: Request, res: Response) => {
    res.json({ items: [] });
  });
}

