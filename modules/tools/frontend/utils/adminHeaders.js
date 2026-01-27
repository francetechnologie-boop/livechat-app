export function getAdminTokenFromStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    const direct = String(window.localStorage.getItem('ADMIN_TOKEN') || '').trim();
    if (direct) return direct;
    return String(window.localStorage.getItem('admin_token') || '').trim();
  } catch {
    return '';
  }
}

export function attachAdminHeaders(original = {}) {
  const token = getAdminTokenFromStorage();
  if (!token) return { ...original };
  const result = { ...original };
  const hasAdminHeader = Object.keys(result).some((key) => key.toLowerCase() === 'x-admin-token');
  if (!hasAdminHeader) {
    result['x-admin-token'] = token;
  }
  return result;
}
