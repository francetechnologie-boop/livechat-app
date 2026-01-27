import { useEffect, useMemo, useState } from 'react';

async function readJsonOrText(res) {
  const text = await res.text().catch(() => '');
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
}

function fmtNum(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function typeLabel(value) {
  const s = String(value || '').trim();
  if (s === 'long_term') return 'Long term';
  if (s === 'short_term') return 'Short term';
  return s;
}

export default function BalancesPanel({ headers, orgId }) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);

  const effectiveHeaders = useMemo(() => {
    const h = { ...(headers || {}) };
    const cleaned = String(orgId || '').trim();
    if (cleaned) h['X-Org-Id'] = cleaned;
    return h;
  }, [headers, orgId]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fio-banka/balances', { headers: effectiveHeaders, credentials: 'include' });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    try {
      const body = { org_id: String(orgId || '').trim() || null };
      const res = await fetch('/api/fio-banka/balances/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...effectiveHeaders },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      setLastRefresh({ when: Date.now(), start_date: json.start_date, end_date: json.end_date, results: json.results || [] });
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const totalByCurrency = useMemo(() => {
    const map = new Map();
    for (const it of items || []) {
      const cur = String(it.currency || '').trim() || '—';
      const bal = Number(it.last_closing_balance);
      if (!Number.isFinite(bal)) continue;
      map.set(cur, (map.get(cur) || 0) + bal);
    }
    return Array.from(map.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="rounded border bg-gray-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white" onClick={load} disabled={loading || refreshing}>
            {loading ? 'Loading…' : 'Refresh list'}
          </button>
          <button className="rounded bg-gray-800 px-3 py-2 text-sm text-white" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh balances (API)'}
          </button>
          {totalByCurrency.length ? (
            <div className="ml-auto text-xs text-gray-700">
              Totals:{' '}
              {totalByCurrency.map(([cur, sum]) => (
                <span key={cur} className="ml-2">
                  <span className="font-medium">{fmtNum(sum)}</span> {cur}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {lastRefresh?.when ? (
          <div className="mt-2 text-xs text-gray-600">
            Last refresh: {new Date(lastRefresh.when).toLocaleString()} · range: {lastRefresh.start_date}..{lastRefresh.end_date}
          </div>
        ) : null}
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="overflow-auto rounded border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-100 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Currency</th>
              <th className="px-3 py-2">Closing</th>
              <th className="px-3 py-2">Opening</th>
              <th className="px-3 py-2">Statement</th>
              <th className="px-3 py-2">Last sync</th>
              <th className="px-3 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{it.label}</div>
                  <div className="text-xs text-gray-500">{it.fio_account_id || ''}</div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{it.owner || ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{typeLabel(it.account_type) || ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{it.currency || ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtNum(it.last_closing_balance)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtNum(it.last_opening_balance)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {(it.last_statement_start || it.last_statement_end) ? `${it.last_statement_start || ''}..${it.last_statement_end || ''}` : ''}
                </td>
                <td className="px-3 py-2 text-xs text-gray-700">{it.last_sync_at ? String(it.last_sync_at) : ''}</td>
                <td className="px-3 py-2 text-xs text-gray-700 whitespace-pre-wrap break-words max-w-[360px]">{it.notes || ''}</td>
              </tr>
            ))}
            {!(items || []).length ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-500">No accounts.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

