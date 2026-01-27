import { useEffect, useMemo, useState } from 'react';

async function readJsonOrText(res) {
  const text = await res.text().catch(() => '');
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
}

function fmtAmount(item) {
  const cur = String(item?.currency || '').trim();
  const amt = item?.amount;
  if (!cur) return '';
  if (amt === null || amt === undefined || amt === '') return `${cur}`;
  const n = Number(amt);
  const s = Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(amt);
  return `${s} ${cur}`;
}

function joinAmounts(list) {
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) return '—';
  return arr.map(fmtAmount).join(' · ');
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
      const j = await fetchApi('/api/stripe-api/balances');
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
      await fetchApi('/api/stripe-api/balances/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
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
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Available</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pending</th>
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
                <td className="px-4 py-2 text-sm text-gray-800 font-mono">{it.account_id || '—'}</td>
                <td className="px-4 py-2 text-sm text-gray-800">{it.mode || '—'}</td>
                <td className="px-4 py-2 text-sm text-gray-800">{it.balance ? joinAmounts(it.balance.available) : '—'}</td>
                <td className="px-4 py-2 text-sm text-gray-800">{it.balance ? joinAmounts(it.balance.pending) : '—'}</td>
                <td className="px-4 py-2 text-xs text-gray-600">{it.last_balance_at ? String(it.last_balance_at) : '—'}</td>
              </tr>
            )) : (
              <tr>
                <td className="px-4 py-6 text-sm text-gray-500" colSpan={6}>
                  {loading ? 'Loading…' : 'No Stripe keys yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

