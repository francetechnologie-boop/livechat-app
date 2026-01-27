import { sendProducts } from '../services/transfer/products.service.js';

export function registerGrabbingJeromeTransferProductRoutes(app, ctx = {}, utils = {}) {
  if (!app) return;
  // POST /api/grabbing-jerome/transfer/product
  app.post('/api/grabbing-jerome/transfer/product', async (req, res) => {
    return sendProducts(req, res, ctx, utils);
  });
}

