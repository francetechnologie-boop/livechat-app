import { useEffect, useMemo, useState } from 'react';

export default function SyncPanel({ headers = {} }) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [result, setResult] = useState(null);

  const [form, setForm] = useState({
    account_id: '',
    incremental: true,
    start_date: '',
    end_date: '',
    page_size: 100,
    pages: 3,
    chunk_days: 30,
  });

  const fetchJson = useMemo(() => {
    return async (url, opts = {}) => {
      const r = await fetch(url, { credentials: 'include', ...opts, headers: { ...(opts.headers || {}), ...(headers || {}) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      return j;
    };
  }, [headers]);

  const loadAccounts = async () => {
    setLoading(true);
    setMessage('');
    try {
      const j = await fetchJson('/api/paypal-api/accounts');
      setAccounts(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setAccounts([]);
      setMessage(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts().catch(() => {});
  }, [fetchJson]);

  const onSync = async ({ overlap_days } = {}) => {
    setSyncing(true);
    setMessage('');
    setResult(null);
    try {
      const body = {
        account_id: form.account_id ? Number(form.account_id) : null,
        incremental: !!form.incremental,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        page_size: Number(form.page_size || 100),
        pages: Number(form.pages || 3),
        chunk_days: Number(form.chunk_days || 30),
        ...(overlap_days != null ? { overlap_days: Number(overlap_days) } : null),
      };
      const j = await fetchJson('/api/paypal-api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResult(j);
      setMessage(`Sync done. fetched=${j.total_fetched || 0} upserted=${j.total_upserted || 0}`);
    } catch (e) {
      setMessage(String(e?.message || e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-3">
        {message ? <div className="text-sm text-gray-700">{message}</div> : null}

        {result?.results?.length ? (
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Fetched</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Upserted</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Window</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {result.results.map((r) => (
                  <tr key={String(r.account_id)}>
                    <td className="px-4 py-2 text-sm text-gray-900">{r.name || `#${r.account_id}`}</td>
                    <td className="px-4 py-2 text-sm text-gray-800">{r.mode || '—'}</td>
                    <td className="px-4 py-2 text-sm text-gray-800 font-mono">{r.fetched ?? 0}</td>
                    <td className="px-4 py-2 text-sm text-gray-800 font-mono">{r.upserted ?? 0}</td>
                    <td className="px-4 py-2 text-xs text-gray-700 font-mono">
                      {r.start_date ? String(r.start_date).slice(0, 10) : '—'} → {r.end_date ? String(r.end_date).slice(0, 10) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-gray-500">{syncing ? 'Syncing…' : 'Run a sync to import transactions.'}</div>
        )}
      </div>

      <div className="space-y-3">
        <div className="rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="text-sm font-medium text-gray-900">Sync Transactions</div>

          <label className="block text-sm text-gray-700">
            Account
            <select
              className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              value={form.account_id}
              onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
              disabled={loading}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.is_default ? '★ ' : ''}{a.name} {a.mode ? `(${a.mode})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={!!form.incremental}
              onChange={(e) => setForm((f) => ({ ...f, incremental: e.target.checked }))}
            />
            Incremental (from last stored tx)
          </label>

          <label className="block text-sm text-gray-700">
            Start date (optional)
            <input
              className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              placeholder="2026-01-01"
            />
          </label>

          <label className="block text-sm text-gray-700">
            End date (optional)
            <input
              className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              placeholder="2026-01-31"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="block text-sm text-gray-700">
              Page size
              <input
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
                type="number"
                min="1"
                max="500"
                value={form.page_size}
                onChange={(e) => setForm((f) => ({ ...f, page_size: Number(e.target.value || 100) }))}
              />
            </label>
            <label className="block text-sm text-gray-700">
              Pages
              <input
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
                type="number"
                min="1"
                max="50"
                value={form.pages}
                onChange={(e) => setForm((f) => ({ ...f, pages: Number(e.target.value || 3) }))}
              />
            </label>
            <label className="block text-sm text-gray-700">
              Chunk days
              <input
                className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
                type="number"
                min="0"
                max="31"
                value={form.chunk_days}
                onChange={(e) => setForm((f) => ({ ...f, chunk_days: Number(e.target.value || 30) }))}
              />
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => loadAccounts().catch(() => {})}
              disabled={loading}
              className="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-800"
            >
              {loading ? 'Loading…' : 'Reload accounts'}
            </button>
            <button
              onClick={() => onSync()}
              disabled={syncing}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>

          <button
            onClick={() => onSync({ overlap_days: 1 })}
            disabled={syncing}
            className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
          >
            Sync from last tx (−1 day) → now
          </button>
        </div>

        <div className="text-xs text-gray-500">
          Uses PayPal Reporting API (`/v1/reporting/transactions`). If the API refuses large ranges, reduce `chunk_days` or narrow start/end.
        </div>
      </div>
    </div>
  );
}
