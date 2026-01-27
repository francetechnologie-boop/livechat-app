import { useEffect, useMemo, useState } from 'react';

function formatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

const MONTH_OPTIONS = [
  { value: '', label: 'All months' },
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

function buildLocalRangeIso({ year, month }) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2000) return { createdAfter: null, createdBefore: null };
  const m = month ? Number(month) : null;
  const start = new Date(y, m ? m - 1 : 0, 1, 0, 0, 0, 0);
  const end = m
    ? new Date(y, m, 0, 23, 59, 59, 999)
    : new Date(y + 1, 0, 0, 23, 59, 59, 999);
  return { createdAfter: start.toISOString(), createdBefore: end.toISOString() };
}

export default function SyncPanel({ headers = {} }) {
  const [limit, setLimit] = useState(100);
  const [pages, setPages] = useState(24);
  const [chunkMonths, setChunkMonths] = useState(1);
  const [keyId, setKeyId] = useState('');
  const [keys, setKeys] = useState([]);
  const [backfill, setBackfill] = useState({ year: '2025', month: '' });
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState(null);

  const fetchJson = useMemo(() => {
    return async (url, opts = {}) => {
      const r = await fetch(url, { credentials: 'include', ...opts, headers: { ...(opts.headers || {}), ...(headers || {}) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      return j;
    };
  }, [headers]);

  const loadKeys = async () => {
    const j = await fetchJson('/api/stripe-api/keys');
    setKeys(Array.isArray(j.items) ? j.items : []);
  };

  useEffect(() => {
    loadKeys().catch(() => {});
  }, [fetchJson]);

  const runSync = async ({
    limit: lim = limit,
    pages: pg = pages,
    chunkMonths: chunks = chunkMonths,
    overrideKey,
    createdAfter = null,
    createdBefore = null,
    incremental = true,
  } = {}) => {
    setRunning(true);
    setMessage('');
    try {
      const body = {
        limit: Math.min(100, Math.max(1, Number(lim || 50))),
        pages: Math.min(24, Math.max(1, Number(pg || 1))),
        chunk_months: Math.min(12, Math.max(0, Number(chunks || 0))),
        incremental: incremental !== false,
      };
      const resolvedKey = overrideKey !== undefined ? overrideKey : keyId;
      if (resolvedKey) body.key_id = Number(resolvedKey);
      if (createdAfter) body.created_after = createdAfter;
      if (createdBefore) body.created_before = createdBefore;
      const j = await fetchJson('/api/stripe-api/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResults({ ...j, params: body });
      setMessage(`Synced ${j.total_upserted || 0} transactions (fetched ${j.total_fetched || 0}).`);
    } catch (err) {
      setMessage(String(err?.message || err));
      setResults(null);
    } finally {
      setRunning(false);
    }
  };

  const onBackfillMonth = async () => {
    const range = buildLocalRangeIso({ year: backfill.year, month: backfill.month });
    if (!range.createdAfter || !range.createdBefore) {
      setMessage('Pick a year (and optionally a month) first.');
      setResults(null);
      return;
    }
    const chunks = backfill.month ? 0 : 1;
    await runSync({ limit: 100, pages: 24, chunkMonths: chunks, createdAfter: range.createdAfter, createdBefore: range.createdBefore, incremental: false });
  };

  const onBackfill2025 = async () => {
    const year = '2025';
    setRunning(true);
    setMessage('');
    setResults(null);
    try {
      let totalFetched = 0;
      let totalUpserted = 0;
      for (let m = 1; m <= 12; m++) {
        const range = buildLocalRangeIso({ year, month: String(m) });
        const j = await fetchJson('/api/stripe-api/transactions/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            limit: 100,
            pages: 24,
            chunk_months: 0,
            incremental: false,
            ...(keyId ? { key_id: Number(keyId) } : {}),
            created_after: range.createdAfter,
            created_before: range.createdBefore,
          }),
        });
        totalFetched += Number(j.total_fetched || 0);
        totalUpserted += Number(j.total_upserted || 0);
        setMessage(`Backfill 2025: month ${m}/12 done (upserted ${formatNumber(j.total_upserted)}).`);
      }
      setMessage(`Backfill 2025 done: upserted ${formatNumber(totalUpserted)} (fetched ${formatNumber(totalFetched)}).`);
    } catch (err) {
      setMessage(String(err?.message || err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="text-sm text-gray-700">
            Stripe account
            <select
              className="mt-1 block w-full rounded border border-gray-200 px-2 py-1 text-sm"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
            >
              <option value="">Default / all accounts</option>
              {keys.map((k) => (
                <option key={k.id} value={String(k.id)}>
                  {k.is_default ? '★ ' : ''}{k.name}{k.mode ? ` (${k.mode})` : ''}{k.account_id ? ` • ${k.account_id}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Limit
            <input
              className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value || 1))}
            />
          </label>
          <label className="text-sm text-gray-700">
            Pages
            <input
              className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              type="number"
              min={1}
              max={24}
              value={pages}
              onChange={(e) => setPages(Number(e.target.value || 1))}
            />
          </label>
          <label className="text-sm text-gray-700">
            Chunk months
            <input
              className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              type="number"
              min={0}
              max={12}
              value={chunkMonths}
              onChange={(e) => setChunkMonths(Number(e.target.value || 0))}
            />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="text-sm text-gray-700">
            Backfill year
            <input
              className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
              value={backfill.year}
              onChange={(e) => setBackfill((p) => ({ ...p, year: e.target.value }))}
              placeholder="2025"
            />
          </label>
          <label className="text-sm text-gray-700">
            Backfill month
            <select
              className="mt-1 block w-full rounded border border-gray-200 px-2 py-1 text-sm"
              value={backfill.month}
              onChange={(e) => setBackfill((p) => ({ ...p, month: e.target.value }))}
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={`bf-${m.value || 'all'}`} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2 text-xs text-gray-500 flex items-end">
            For big accounts, backfill month-by-month to avoid reverse-proxy timeouts.
          </div>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            disabled={running}
            onClick={() => runSync()}
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {running ? 'Running…' : 'Sync transactions'}
          </button>
          <button
            disabled={running}
            onClick={onBackfillMonth}
            className="rounded border border-blue-600 px-3 py-2 text-sm font-medium text-blue-700 disabled:opacity-60"
          >
            {running ? 'Backfilling…' : 'Backfill selected'}
          </button>
          <button
            disabled={running}
            onClick={onBackfill2025}
            className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 disabled:opacity-60"
          >
            {running ? 'Backfilling…' : 'Backfill 2025 (month-by-month)'}
          </button>
        </div>
        {message ? <div className={`text-sm ${results ? 'text-gray-700' : 'text-red-700'}`}>{message}</div> : null}
        {results ? (
          <div className="text-xs text-gray-500 space-y-1">
            <div>Total fetched: {formatNumber(results.total_fetched)}</div>
            <div>Total upserted: {formatNumber(results.total_upserted)}</div>
            {Array.isArray(results.results) ? (
              <div>
                Keys:
                <ul className="ml-4 list-disc text-xs text-gray-500">
                  {results.results.map((item) => (
                    <li key={`res-${item.key_id}`}>{item.name}: fetched {formatNumber(item.fetched)}, upserted {formatNumber(item.upserted)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
