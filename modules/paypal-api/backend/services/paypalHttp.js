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

function normalizeHost(mode) {
  const m = String(mode || '').toLowerCase();
  if (m === 'sandbox') return 'api-m.sandbox.paypal.com';
  return 'api-m.paypal.com';
}

export async function paypalGetAccessToken({ clientId, clientSecret, mode = 'live', timeoutMs = 15000 }) {
  const host = normalizeHost(mode);
  const body = 'grant_type=client_credentials';
  const auth = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');

  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
    'User-Agent': 'livechat-app/paypal-api',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
  };

  const res = await new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: host, port: 443, path: '/v1/oauth2/token', method: 'POST', headers, timeout: timeoutMs },
      resolve
    );
    req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch {} });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const raw = await readBody(res);
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }

  if (res.statusCode >= 200 && res.statusCode < 300) {
    if (!json || typeof json !== 'object') {
      const err = new Error('paypal_bad_response');
      err.status = res.statusCode;
      err.paypal = raw || null;
      throw err;
    }
    return json;
  }

  const msg = json?.error_description || json?.message || raw || `PayPal API error (HTTP ${res.statusCode})`;
  const err = new Error(String(msg));
  err.status = res.statusCode;
  err.paypal = json || raw || null;
  throw err;
}

export async function paypalApiRequest({ accessToken, mode = 'live', method = 'GET', path, params = null, jsonBody = null, timeoutMs = 20000 }) {
  const host = normalizeHost(mode);
  const m = String(method || 'GET').toUpperCase();
  const qp = (params && m === 'GET') ? querystring.stringify(params) : '';
  const reqPath = qp ? `${path}${path.includes('?') ? '&' : '?'}${qp}` : path;
  const body = jsonBody != null ? JSON.stringify(jsonBody) : '';

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'livechat-app/paypal-api',
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  const res = await new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: host, port: 443, path: reqPath, method: m, headers, timeout: timeoutMs },
      resolve
    );
    req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch {} });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

  const raw = await readBody(res);
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }

  if (res.statusCode >= 200 && res.statusCode < 300) return { ok: true, status: res.statusCode, data: json };

  const msg = json?.message || json?.details?.[0]?.description || raw || `PayPal API error (HTTP ${res.statusCode})`;
  const err = new Error(String(msg));
  err.status = res.statusCode;
  err.paypal = json || raw || null;
  throw err;
}

export async function paypalListReportingTransactions({ accessToken, mode = 'live', startDate, endDate, pageSize = 100, page = 1, fields = 'all', timeoutMs = 25000 }) {
  const params = {
    start_date: String(startDate),
    end_date: String(endDate),
    fields: String(fields || 'all'),
    page_size: Math.max(1, Math.min(500, Number(pageSize || 100))),
    page: Math.max(1, Number(page || 1)),
  };
  const r = await paypalApiRequest({ accessToken, mode, method: 'GET', path: '/v1/reporting/transactions', params, timeoutMs });
  return r.data;
}

export async function paypalGetBalances({ accessToken, mode = 'live', asOfTime = null, currencyCode = null, timeoutMs = 20000 } = {}) {
  const params = {};
  if (asOfTime) params.as_of_time = String(asOfTime);
  if (currencyCode) params.currency_code = String(currencyCode);
  const r = await paypalApiRequest({ accessToken, mode, method: 'GET', path: '/v1/reporting/balances', params, timeoutMs });
  return r.data;
}
