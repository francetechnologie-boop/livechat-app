export function pickOrgId(req) {
  try {
    const raw = req.body?.org_id ?? req.headers['x-org-id'] ?? req.query?.org_id;
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export function toOrgInt(value) {
  try {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  } catch {
    return null;
  }
}

export function requireAdminGuard(ctx = {}) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

