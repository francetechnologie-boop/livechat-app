import { sendToPresta } from '../transfer.service.js';

export async function sendCategory(req, res, ctx = {}, utils = {}) {
  // Align page_type with mapping tools rows (use 'category').
  // Mapping selection is type-specific and the UI posts mapping_version accordingly.
  try { req.body = { ...(req.body || {}), force_page_type: 'category' }; } catch {}
  return sendToPresta(req, res, ctx, utils);
}
