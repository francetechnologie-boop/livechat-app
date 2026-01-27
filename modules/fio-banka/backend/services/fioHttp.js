export class HttpError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

function safeText(text, max = 1200) {
  try {
    const s = String(text || '');
    if (s.length <= max) return s;
    return s.slice(0, max) + ' [truncated]';
  } catch {
    return '';
  }
}

export async function fioFetchTransactions({ token, startDate, endDate, signal } = {}) {
  const t = String(token || '').trim();
  if (!t) throw new HttpError('Missing Fio token', 400, { error: 'missing_token' });
  const from = String(startDate || '').trim();
  const to = String(endDate || '').trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(from)) throw new HttpError('Invalid startDate (expected YYYY-MM-DD)', 400, { error: 'bad_start_date' });
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(to)) throw new HttpError('Invalid endDate (expected YYYY-MM-DD)', 400, { error: 'bad_end_date' });

  const url = `https://fioapi.fio.cz/v1/rest/periods/${encodeURIComponent(t)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}/transactions.json`;
  const res = await fetch(url, { method: 'GET', headers: { accept: 'application/json' }, signal });
  if (!res.ok) {
    const body = safeText(await res.text().catch(() => ''), 1200);
    throw new HttpError(`Fio API request failed (${res.status})`, res.status, { url, body });
  }
  const json = await res.json();
  return json;
}

