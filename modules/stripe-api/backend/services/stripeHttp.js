import https from 'https';
import querystring from 'querystring';

function readBody(res) {
  return new Promise((resolve, reject) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve(data));
    res.on('error', reject);
  });
}

export async function stripeRequest({ secretKey, method = 'GET', path, params = null, timeoutMs = 15000 }) {
  const m = String(method || 'GET').toUpperCase();
  const qp = (params && m === 'GET') ? querystring.stringify(params) : '';
  const body = (params && m !== 'GET') ? querystring.stringify(params) : '';
  const reqPath = qp ? `${path}${path.includes('?') ? '&' : '?'}${qp}` : path;

  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'User-Agent': 'livechat-app/stripe-api',
  };
  if (m !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(body || '');
  }

  const res = await new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: 'api.stripe.com', port: 443, path: reqPath, method: m, headers, timeout: timeoutMs },
      resolve
    );
    req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch {} });
    req.on('error', reject);
    if (m !== 'GET' && body) req.write(body);
    req.end();
  });

  const raw = await readBody(res);
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }

  if (res.statusCode >= 200 && res.statusCode < 300) return { ok: true, status: res.statusCode, data: json };

  const msg = json?.error?.message || json?.message || raw || `Stripe API error (HTTP ${res.statusCode})`;
  const err = new Error(String(msg));
  err.status = res.statusCode;
  err.stripe = json?.error || json || null;
  throw err;
}

