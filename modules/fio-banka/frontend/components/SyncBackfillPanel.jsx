import { useEffect, useMemo, useState } from 'react';

async function readJsonOrText(res) {
  const text = await res.text().catch(() => '');
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
}

export default function SyncBackfillPanel({ headers, orgId }) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [result, setResult] = useState(null);

  const [accountId, setAccountId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [overlapDays, setOverlapDays] = useState('2');
  const [chunkDays, setChunkDays] = useState('30');

  const effectiveHeaders = useMemo(() => {
    const h = { ...(headers || {}) };
    const cleaned = String(orgId || '').trim();
    if (cleaned) h['X-Org-Id'] = cleaned;
    return h;
  }, [headers, orgId]);

  const loadAccounts = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fio-banka/accounts', { headers: effectiveHeaders, credentials: 'include' });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      setAccounts(Array.isArray(json.items) ? json.items : []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const sync = async (mode) => {
    setSyncing(true);
    setError('');
    setResult(null);
    try {
      const body = {
        org_id: String(orgId || '').trim() || null,
        account_id: accountId ? Number(accountId) : null,
        incremental: mode === 'incremental',
        start_date: mode === 'backfill' ? (startDate || null) : (startDate || null),
        end_date: endDate || null,
        overlap_days: Number(overlapDays || 2),
        chunk_days: Number(chunkDays || 30),
      };
      if (mode === 'incremental') {
        delete body.start_date;
        delete body.end_date;
      }
      const res = await fetch('/api/fio-banka/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...effectiveHeaders },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      setResult(json);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { loadAccounts(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-4">
      <div className="rounded border bg-gray-50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Account
            <select className="mt-1 w-72 rounded border bg-white px-2 py-1 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Start (backfill)
            <input className="mt-1 w-40 rounded border bg-white px-2 py-1 text-sm" value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="YYYY-MM-DD" />
          </label>
          <label className="text-sm">
            End (backfill)
            <input className="mt-1 w-40 rounded border bg-white px-2 py-1 text-sm" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="YYYY-MM-DD" />
          </label>
          <label className="text-sm">
            Overlap days
            <input className="mt-1 w-24 rounded border bg-white px-2 py-1 text-sm" value={overlapDays} onChange={(e) => setOverlapDays(e.target.value)} />
          </label>
          <label className="text-sm">
            Chunk days
            <input className="mt-1 w-24 rounded border bg-white px-2 py-1 text-sm" value={chunkDays} onChange={(e) => setChunkDays(e.target.value)} />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white" onClick={() => sync('incremental')} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync (incremental)'}
          </button>
          <button className="rounded bg-gray-800 px-3 py-2 text-sm text-white" onClick={() => sync('backfill')} disabled={syncing || !startDate || !endDate}>
            {syncing ? 'Backfilling…' : 'Backfill (range)'}
          </button>
          <button className="rounded bg-white px-3 py-2 text-sm text-gray-800 ring-1 ring-gray-200" onClick={loadAccounts} disabled={loading || syncing}>
            {loading ? 'Loading…' : 'Refresh accounts'}
          </button>
        </div>

        <div className="mt-2 text-xs text-gray-600">
          Incremental sync uses the latest stored booking date per account with an overlap. Backfill uses your explicit start/end.
        </div>

        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      {result?.ok ? (
        <div className="rounded border bg-white p-4">
          <div className="text-sm font-semibold text-gray-900">Result</div>
          <div className="mt-1 text-xs text-gray-700">
            Total fetched: <span className="font-medium">{result.total_fetched}</span> · Total upserted:{' '}
            <span className="font-medium">{result.total_upserted}</span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-100 text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Fetched</th>
                  <th className="px-3 py-2">Upserted</th>
                  <th className="px-3 py-2">Start</th>
                  <th className="px-3 py-2">End</th>
                  <th className="px-3 py-2">Windows</th>
                </tr>
              </thead>
              <tbody>
                {(result.results || []).map((r) => (
                  <tr key={r.account_id} className="border-t">
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2">{r.fetched}</td>
                    <td className="px-3 py-2">{r.upserted}</td>
                    <td className="px-3 py-2">{r.start_date}</td>
                    <td className="px-3 py-2">{r.end_date}</td>
                    <td className="px-3 py-2">{r.windows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
