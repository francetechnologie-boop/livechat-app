import { sendToPresta } from '../transfer.service.js';

export async function sendProducts(req, res, ctx = {}, utils = {}) {
  try { req.body = { ...(req.body || {}), force_page_type: 'product' }; } catch {}
  return sendToPresta(req, res, ctx, utils);
}

