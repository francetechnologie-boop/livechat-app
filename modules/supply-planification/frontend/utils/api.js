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
  const has = Object.keys(result).some((key) => key.toLowerCase() === 'x-admin-token');
  if (!has) result['x-admin-token'] = token;
  return result;
}

export async function api(url, options = {}) {
  const headers = attachAdminHeaders({
    Accept: 'application/json',
    ...(options.headers || {}),
  });
  const init = {
    credentials: 'include',
    ...options,
    headers,
  };
  const res = await fetch(url, init);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error((data && (data.message || data.error)) || `HTTP_${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

