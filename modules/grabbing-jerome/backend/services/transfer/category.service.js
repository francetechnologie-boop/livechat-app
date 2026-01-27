import { sendToPresta } from '../transfer.service.js';

export async function sendCategory(req, res, ctx = {}, utils = {}) {
  // Business rule: category pipeline uses page_type 'article' internally
  try { req.body = { ...(req.body || {}), force_page_type: 'article' }; } catch {}
  return sendToPresta(req, res, ctx, utils);
}

