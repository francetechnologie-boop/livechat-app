import { useEffect, useMemo, useState } from 'react';

function fmtDate(value) {
  try {
    if (!value) return '—';
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  } catch {
    return String(value || '—');
  }
}

export default function TransactionsPanel({ headers = {} }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [stats, setStats] = useState(null);

  const [filters, setFilters] = useState({ account_id: '', status: '', limit: 50, created_after: '', created_before: '' });

  const fetchJson = useMemo(() => {
    return async (url, opts = {}) => {
      const r = await fetch(url, { credentials: 'include', ...opts, headers: { ...(opts.headers || {}), ...(headers || {}) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      return j;
    };
  }, [headers]);

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      const qs = new URLSearchParams();
      if (String(filters.account_id || '').trim()) qs.set('account_id', String(filters.account_id).trim());
      if (String(filters.status || '').trim()) qs.set('status', String(filters.status).trim());
      if (String(filters.created_after || '').trim()) qs.set('created_after', String(filters.created_after).trim());
      if (String(filters.created_before || '').trim()) qs.set('created_before', String(filters.created_before).trim());
      qs.set('limit', String(filters.limit || 50));

      const j = await fetchJson(`/api/paypal-api/transactions?${qs.toString()}`);
      setItems(Array.isArray(j.items) ? j.items : []);
      setAccounts(Array.isArray(j.accounts) ? j.accounts : []);
      setStats(j.stats || null);
    } catch (e) {
      setItems([]);
      setAccounts([]);
      setStats(null);
      setMessage(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, [fetchJson]);

  const accountName = useMemo(() => {
    const byId = new Map((accounts || []).map((a) => [String(a.id), a]));
    return (id) => byId.get(String(id))?.name || `#${id}`;
  }, [accounts]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-4">
        <label className="block text-sm text-gray-700">
          Account
          <select
            className="mt-1 w-56 rounded border border-gray-200 px-3 py-2 text-sm"
            value={filters.account_id}
            onChange={(e) => setFilters((f) => ({ ...f, account_id: e.target.value }))}
          >
            <option value="">All</option>
            {(accounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.is_default ? '★ ' : ''}{a.name} {a.mode ? `(${a.mode})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-gray-700">
          Status
          <input
            className="mt-1 w-40 rounded border border-gray-200 px-3 py-2 text-sm"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            placeholder="COMPLETED"
          />
        </label>

        <label className="block text-sm text-gray-700">
          Created after
          <input
            className="mt-1 w-48 rounded border border-gray-200 px-3 py-2 text-sm"
            value={filters.created_after}
            onChange={(e) => setFilters((f) => ({ ...f, created_after: e.target.value }))}
            placeholder="2026-01-01"
          />
        </label>

        <label className="block text-sm text-gray-700">
          Created before
          <input
            className="mt-1 w-48 rounded border border-gray-200 px-3 py-2 text-sm"
            value={filters.created_before}
            onChange={(e) => setFilters((f) => ({ ...f, created_before: e.target.value }))}
            placeholder="2026-01-31"
          />
        </label>

        <label className="block text-sm text-gray-700">
          Limit
          <input
            className="mt-1 w-20 rounded border border-gray-200 px-3 py-2 text-sm"
            value={filters.limit}
            onChange={(e) => setFilters((f) => ({ ...f, limit: Number(e.target.value || 50) }))}
            type="number"
            min="1"
            max="200"
          />
        </label>

        <button
          onClick={() => load().catch(() => {})}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white"
        >
          Refresh
        </button>
      </div>

      {message ? <div className="text-sm text-gray-700">{message}</div> : null}
      {stats ? (
        <div className="text-xs text-gray-600">
          total: {stats.total ?? 0} • with_status: {stats.with_status ?? 0} • with_amount: {stats.with_amount ?? 0}
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Currency</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Cart</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Payer</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Transaction ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {items.length ? (
              items.map((it) => (
                <tr key={it.id}>
                  <td className="px-4 py-2 text-sm text-gray-800 whitespace-nowrap">{fmtDate(it.created_time)}</td>
                  <td className="px-4 py-2 text-sm text-gray-800">{it.account_id != null ? accountName(it.account_id) : '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-800">{it.status || '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-900 font-mono">{it.amount != null ? String(it.amount) : '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-800">{it.currency || '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-900 font-mono">{it.id_cart != null ? String(it.id_cart) : '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-800">{it.payer_email || it.payer_id || '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-800 font-mono">{it.paypal_transaction_id || '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-6 text-sm text-gray-500" colSpan={8}>
                  {loading ? 'Loading…' : 'No transactions yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
