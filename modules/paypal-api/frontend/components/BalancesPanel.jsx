import { useEffect, useMemo, useState } from 'react';

async function readJsonOrText(res) {
  const text = await res.text().catch(() => '');
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
}

function fmtBalanceLine(item) {
  const cur = String(item?.currency || '').trim();
  if (!cur) return null;
  const total = item?.total?.value ?? item?.total ?? null;
  const available = item?.available?.value ?? item?.available ?? null;
  const withheld = item?.withheld?.value ?? item?.withheld ?? null;
  const parts = [];
  if (total != null) parts.push(`total ${total}`);
  if (available != null) parts.push(`available ${available}`);
  if (withheld != null) parts.push(`withheld ${withheld}`);
  return `${cur}: ${parts.join(' · ') || '—'}`;
}

function joinLines(items) {
  const arr = Array.isArray(items) ? items : [];
  const lines = arr.map(fmtBalanceLine).filter(Boolean);
  return lines.length ? lines.join(' | ') : '—';
}

export default function BalancesPanel({ headers = {} }) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState('');
  const [items, setItems] = useState([]);

  const fetchApi = useMemo(() => {
    return async (url, opts = {}) => {
      const res = await fetch(url, { credentials: 'include', ...opts, headers: { ...(opts.headers || {}), ...(headers || {}) } });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || json?.ok === false) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      return json;
    };
  }, [headers]);

  const load = async () => {
    setLoading(true);
    setMsg('');
    try {
      const j = await fetchApi('/api/paypal-api/balances');
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setItems([]);
      setMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setMsg('');
    try {
      await fetchApi('/api/paypal-api/balances/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      await load();
      setMsg('Balances refreshed.');
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { load().catch(() => {}); }, [fetchApi]);

  return (
    <div className="space-y-3">
      {msg ? <div className="text-sm text-gray-700">{msg}</div> : null}
      <div className="flex flex-wrap gap-2">
        <button className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white" onClick={load} disabled={loading || refreshing}>
          {loading ? 'Loading…' : 'Refresh list'}
        </button>
        <button className="rounded bg-gray-800 px-3 py-1.5 text-sm text-white" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh balances (API)'}
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Balances</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {items.length ? items.map((it) => (
              <tr key={it.id}>
                <td className="px-4 py-2 text-sm text-gray-900">
                  {it.is_default ? <span className="mr-2 text-yellow-600">★</span> : null}
                  {it.name}
                </td>
                <td className="px-4 py-2 text-sm text-gray-800">{it.mode || '—'}</td>
                <td className="px-4 py-2 text-sm text-gray-800">{it.balance ? joinLines(it.balance.items) : '—'}</td>
                <td className="px-4 py-2 text-xs text-gray-600">{it.last_balance_at ? String(it.last_balance_at) : '—'}</td>
              </tr>
            )) : (
              <tr>
                <td className="px-4 py-6 text-sm text-gray-500" colSpan={4}>
                  {loading ? 'Loading…' : 'No PayPal accounts yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

