import { useEffect, useMemo, useState } from 'react';

async function readJsonOrText(res) {
  const text = await res.text().catch(() => '');
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
}

function toQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    q.set(k, s);
  }
  const str = q.toString();
  return str ? `?${str}` : '';
}

function normalizeText(value) {
  return String(value || '').toLowerCase().trim();
}

function parseNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function compareNullable(a, b, dir) {
  const d = dir === 'asc' ? 1 : -1;
  const av = a ?? null;
  const bv = b ?? null;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  if (av === bv) return 0;
  return av > bv ? d : -d;
}

export default function TransactionsPanel({ headers, orgId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);

  const [accountId, setAccountId] = useState('');

  const [sortKey, setSortKey] = useState('booking_date');
  const [sortDir, setSortDir] = useState('desc');
  const [fUid, setFUid] = useState('');
  const [fVs, setFVs] = useState('');
  const [fCounterparty, setFCounterparty] = useState('');
  const [fMessage, setFMessage] = useState('');
  const [fDateText, setFDateText] = useState('');
  const [fDateFrom, setFDateFrom] = useState('');
  const [fDateTo, setFDateTo] = useState('');
  const [fAmountMin, setFAmountMin] = useState('');
  const [fAmountMax, setFAmountMax] = useState('');

  const effectiveHeaders = useMemo(() => {
    const h = { ...(headers || {}) };
    const cleaned = String(orgId || '').trim();
    if (cleaned) h['X-Org-Id'] = cleaned;
    return h;
  }, [headers, orgId]);

  const filteredSorted = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    const uid = normalizeText(fUid);
    const vs = normalizeText(fVs);
    const cp = normalizeText(fCounterparty);
    const msg = normalizeText(fMessage);
    const dateText = normalizeText(fDateText);
    const dateFrom = String(fDateFrom || '').trim();
    const dateTo = String(fDateTo || '').trim();
    const amtMin = parseNum(fAmountMin);
    const amtMax = parseNum(fAmountMax);
    const filtered = list.filter((it) => {
      if (uid && !normalizeText(it?.fio_tx_uid).includes(uid) && !normalizeText(it?.fio_id_pohybu).includes(uid)) return false;
      if (vs && !normalizeText(it?.vs).includes(vs)) return false;
      if (dateText && !normalizeText(it?.booking_date).includes(dateText)) return false;
      if (dateFrom && String(it?.booking_date || '') < dateFrom) return false;
      if (dateTo && String(it?.booking_date || '') > dateTo) return false;
      if (amtMin !== null) {
        const n = parseNum(it?.amount);
        if (n === null || n < amtMin) return false;
      }
      if (amtMax !== null) {
        const n = parseNum(it?.amount);
        if (n === null || n > amtMax) return false;
      }
      if (cp) {
        const bag = `${normalizeText(it?.counterparty_name)} ${normalizeText(it?.counterparty_account)} ${normalizeText(it?.counterparty_bank_code)}`;
        if (!bag.includes(cp)) return false;
      }
      if (msg) {
        const bag = `${normalizeText(it?.message)} ${normalizeText(it?.comment)} ${normalizeText(it?.tx_type)}`;
        if (!bag.includes(msg)) return false;
      }
      return true;
    });

    const dir = sortDir === 'asc' ? 'asc' : 'desc';
    const key = String(sortKey || 'booking_date');
    const sorted = [...filtered].sort((a, b) => {
      if (key === 'amount') return compareNullable(Number(a?.amount ?? null), Number(b?.amount ?? null), dir);
      if (key === 'currency') return compareNullable(String(a?.currency || ''), String(b?.currency || ''), dir);
      if (key === 'tx_type') return compareNullable(String(a?.tx_type || ''), String(b?.tx_type || ''), dir);
      if (key === 'vs') return compareNullable(String(a?.vs || ''), String(b?.vs || ''), dir);
      if (key === 'fio_tx_uid') return compareNullable(String(a?.fio_tx_uid || ''), String(b?.fio_tx_uid || ''), dir);
      // booking_date default
      return compareNullable(String(a?.booking_date || ''), String(b?.booking_date || ''), dir);
    });
    return sorted;
  }, [items, fUid, fVs, fCounterparty, fMessage, fDateText, fDateFrom, fDateTo, fAmountMin, fAmountMax, sortKey, sortDir]);

  const toggleSort = (key) => {
    setSortKey((prev) => {
      const k = String(key || '');
      if (!k) return prev;
      return k;
    });
    setSortDir((prev) => {
      if (sortKey === key) return prev === 'asc' ? 'desc' : 'asc';
      return 'desc';
    });
  };

  const sortIndicator = (key) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const load = async ({ accountIdOverride = null, dateFromOverride = null, dateToOverride = null } = {}) => {
    setLoading(true);
    setError('');
    try {
      const hardLimit = 500;
      const accountIdEff = accountIdOverride !== null ? accountIdOverride : accountId;
      const dateAfterEff = dateFromOverride !== null ? dateFromOverride : fDateFrom;
      const dateBeforeEff = dateToOverride !== null ? dateToOverride : fDateTo;
      const dateAfter = String(dateAfterEff || '').trim() || undefined;
      const dateBefore = String(dateBeforeEff || '').trim() || undefined;
      const q = toQuery({
        account_id: accountIdEff || undefined,
        limit: String(hardLimit),
        date_after: dateAfter,
        date_before: dateBefore,
      });
      const res = await fetch(`/api/fio-banka/transactions${q}`, { headers: effectiveHeaders, credentials: 'include' });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      setAccounts(Array.isArray(json.accounts) ? json.accounts : []);
      setItems(Array.isArray(json.items) ? json.items : []);
      setStats(json.stats || null);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const setLastNDays = async (days) => {
    const n = Math.max(0, Number(days || 0));
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const fromDate = new Date(now.getTime());
    // "Last N days" inclusive of today => subtract N-1 days.
    fromDate.setDate(fromDate.getDate() - Math.max(0, n - 1));
    const from = fromDate.toISOString().slice(0, 10);
    setFDateText('');
    setFDateFrom(from);
    setFDateTo(to);
    await load({ dateFromOverride: from, dateToOverride: to });
  };

  const clearDateFilters = async () => {
    setFDateText('');
    setFDateFrom('');
    setFDateTo('');
    await load({ dateFromOverride: '', dateToOverride: '' });
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [accountId]);

  return (
    <div className="space-y-4">
      <div className="rounded border bg-gray-50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Account
            <select className="mt-1 w-72 rounded border bg-white px-2 py-1 text-sm" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {[
                    a.label,
                    a.owner ? `(${a.owner})` : null,
                    a.currency || null,
                    a.account_type ? (a.account_type === 'long_term' ? 'LT' : a.account_type === 'short_term' ? 'ST' : a.account_type) : null,
                  ].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {stats ? (
          <div className="mt-3 text-xs text-gray-700">
            Total: <span className="font-medium">{stats.total}</span>
            {stats.min_date ? <> · Min: <span className="font-medium">{stats.min_date}</span></> : null}
            {stats.max_date ? <> · Max: <span className="font-medium">{stats.max_date}</span></> : null}
          </div>
        ) : null}
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="max-h-[70vh] overflow-auto rounded border">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-gray-100 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('fio_tx_uid')}>UID{sortIndicator('fio_tx_uid')}</th>
              <th className="px-3 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('booking_date')}>Date{sortIndicator('booking_date')}</th>
              <th className="px-3 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('amount')}>Amount{sortIndicator('amount')}</th>
              <th className="px-3 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('currency')}>Currency{sortIndicator('currency')}</th>
              <th className="px-3 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('tx_type')}>Type{sortIndicator('tx_type')}</th>
              <th className="px-3 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('vs')}>VS{sortIndicator('vs')}</th>
              <th className="px-3 py-2">Counterparty</th>
              <th className="px-3 py-2">Message</th>
            </tr>
            <tr className="bg-white text-[11px] normal-case text-gray-600">
              <th className="px-3 py-2">
                <input className="w-40 rounded border bg-white px-2 py-1 text-xs" value={fUid} onChange={(e) => setFUid(e.target.value)} placeholder="filter uid…" />
              </th>
              <th className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input className="w-24 rounded border bg-white px-2 py-1 text-xs" value={fDateText} onChange={(e) => setFDateText(e.target.value)} placeholder="date…" />
                  <input className="w-28 rounded border bg-white px-2 py-1 text-xs" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} placeholder="from (YYYY-MM-DD)" />
                  <input className="w-28 rounded border bg-white px-2 py-1 text-xs" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} placeholder="to (YYYY-MM-DD)" />
                  <button className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-900" type="button" onClick={() => setLastNDays(10)}>Last 10d</button>
                  <button className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-900" type="button" onClick={clearDateFilters}>Clear</button>
                </div>
              </th>
              <th className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input className="w-24 rounded border bg-white px-2 py-1 text-xs" value={fAmountMin} onChange={(e) => setFAmountMin(e.target.value)} placeholder="min" />
                  <input className="w-24 rounded border bg-white px-2 py-1 text-xs" value={fAmountMax} onChange={(e) => setFAmountMax(e.target.value)} placeholder="max" />
                </div>
              </th>
              <th className="px-3 py-2" />
              <th className="px-3 py-2" />
              <th className="px-3 py-2">
                <input className="w-28 rounded border bg-white px-2 py-1 text-xs" value={fVs} onChange={(e) => setFVs(e.target.value)} placeholder="filter vs…" />
              </th>
              <th className="px-3 py-2">
                <input className="w-56 rounded border bg-white px-2 py-1 text-xs" value={fCounterparty} onChange={(e) => setFCounterparty(e.target.value)} placeholder="filter counterparty…" />
              </th>
              <th className="px-3 py-2">
                <input className="w-64 rounded border bg-white px-2 py-1 text-xs" value={fMessage} onChange={(e) => setFMessage(e.target.value)} placeholder="filter message/type…" />
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-700" title={it.fio_tx_uid || ''}>{it.fio_tx_uid || it.fio_id_pohybu || ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{it.booking_date || ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{it.amount ?? ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{it.currency ?? ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{it.tx_type ?? ''}</td>
                <td className="px-3 py-2 whitespace-nowrap">{it.vs ?? ''}</td>
                <td className="px-3 py-2">
                  <div className="text-gray-900">{it.counterparty_name || ''}</div>
                  <div className="text-xs text-gray-500">{[it.counterparty_account, it.counterparty_bank_code].filter(Boolean).join('/')}</div>
                </td>
                <td className="px-3 py-2 max-w-[520px] truncate" title={it.message || ''}>{it.message ?? ''}</td>
              </tr>
            ))}
            {!filteredSorted.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-500">No transactions.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
