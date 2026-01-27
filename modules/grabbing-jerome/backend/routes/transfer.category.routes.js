import { sendCategory } from '../services/transfer/category.service.js';

export function registerGrabbingJeromeTransferCategoryRoutes(app, ctx = {}, utils = {}) {
  if (!app) return;
  // POST /api/grabbing-jerome/transfer/category
  app.post('/api/grabbing-jerome/transfer/category', async (req, res) => {
    return sendCategory(req, res, ctx, utils);
  });
}

