export function parseOrgIdFromRequest(req) {
  try {
    const raw = req.query?.org_id ?? req.headers?.['x-org-id'];
    if (raw == null) return null;
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.trunc(parsed);
  } catch {
    return null;
  }
}
