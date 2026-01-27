import { useEffect, useMemo, useState } from 'react';

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

function formatMoney(amount, currency) {
  try {
    const a = Number(amount || 0);
    const c = String(currency || '').toUpperCase() || 'USD';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(a);
  } catch {
    return `${amount} ${currency || ''}`.trim();
  }
}

function formatTs(created) {
  try {
    if (!created) return '';
    const ms = Number(created) * 1000;
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

function pickStatus(it) {
  if (it?.dispute_id) return { label: 'Disputed', tone: 'bg-orange-100 text-orange-800 border-orange-200' };
  if (it?.refunded) return { label: 'Refunded', tone: 'bg-gray-100 text-gray-800 border-gray-200' };
  if (it?.captured === false) return { label: 'Uncaptured', tone: 'bg-gray-100 text-gray-800 border-gray-200' };
  const st = String(it?.status || '').toLowerCase();
  if (st === 'succeeded') return { label: 'Succeeded', tone: 'bg-green-100 text-green-800 border-green-200' };
  if (st === 'failed') return { label: 'Failed', tone: 'bg-red-100 text-red-800 border-red-200' };
  if (st) return { label: st, tone: 'bg-gray-100 text-gray-800 border-gray-200' };
  return { label: '—', tone: 'bg-gray-100 text-gray-800 border-gray-200' };
}

function paymentMethodLabel(it) {
  const brand = it?.payment_method_brand ? String(it.payment_method_brand).toUpperCase() : '';
  const last4 = it?.payment_method_last4 ? String(it.payment_method_last4) : '';
  if (brand && last4) return `${brand} •••• ${last4}`;
  const type = it?.payment_method_type ? String(it.payment_method_type) : '';
  return type || '—';
}

function clientLabel(it) {
  const name = it?.client_name ? String(it.client_name) : '';
  const email = it?.customer_email ? String(it.customer_email) : '';
  if (name && email) return `${name} (${email})`;
  return name || email || '—';
}

function sortIndicator(field, currentField, direction) {
  if (field !== currentField) return null;
  return direction === 'asc' ? '↑' : '↓';
}

function DetailsModal({ open, item, onClose }) {
  if (!open || !item) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <button className="absolute inset-0 bg-black/30" onClick={onClose} aria-label="Close" />
      <div className="relative h-full w-full max-w-xl bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-900">Transaction details</div>
          <button onClick={onClose} className="rounded bg-gray-100 px-2 py-1 text-sm text-gray-800">Close</button>
        </div>
        <div className="p-4 space-y-4">
          <div className="rounded border border-gray-200 p-3">
            <div className="text-xs text-gray-500">Description</div>
            <div className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">
              {item.description_display || item.description || '—'}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Payment ID</div>
              <div className="mt-1 text-sm font-mono text-gray-900 break-all">{item.payment_intent_id || '—'}</div>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Charge ID</div>
              <div className="mt-1 text-sm font-mono text-gray-900 break-all">{item.id || '—'}</div>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Amount</div>
              <div className="mt-1 text-sm text-gray-900">{formatMoney(item.amount, item.currency)}</div>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Status</div>
              <div className="mt-1 text-sm text-gray-900">{pickStatus(item).label}</div>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Client</div>
              <div className="mt-1 text-sm text-gray-900 break-all">{clientLabel(item)}</div>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Payment method</div>
              <div className="mt-1 text-sm text-gray-900">{paymentMethodLabel(item)}</div>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Date</div>
              <div className="mt-1 text-sm text-gray-900">{formatTs(item.created)}</div>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Refund date</div>
              <div className="mt-1 text-sm text-gray-900">{item.refund_created ? formatTs(item.refund_created) : '—'}</div>
            </div>
          </div>

          <div className="rounded border border-gray-200 p-3 space-y-2">
            <div className="text-xs text-gray-500">Stripe account</div>
            <div className="text-sm text-gray-900">
              {item.key_name ? item.key_name : '—'}{item.key_account_id ? <span className="text-gray-500"> • {item.key_account_id}</span> : null}
            </div>
            {item.statement_descriptor ? (
              <div className="text-sm text-gray-700">Statement: {item.statement_descriptor}</div>
            ) : null}
            {item.receipt_url ? (
              <a className="text-sm text-blue-700 underline break-all" href={item.receipt_url} target="_blank" rel="noreferrer">
                Receipt URL
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TransactionsPanel({ headers = {} }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [keys, setKeys] = useState([]);
  const [keyId, setKeyId] = useState('');
  const [limit, setLimit] = useState(25);
  const [status, setStatus] = useState('all');
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ total: 0, succeeded: 0, refunded: 0, disputed: 0, failed: 0, uncaptured: 0 });
  const [windowInfo, setWindowInfo] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ account: '', reference: '', order: '', cart: '' });
  const [sortField, setSortField] = useState('created');
  const [sortDir, setSortDir] = useState('desc');
  const [dateFilter, setDateFilter] = useState({ year: '', month: '' });
  const [totalSelected, setTotalSelected] = useState(0);
  const handleFilterChange = (field, value) => setFilters((prev) => ({ ...prev, [field]: value }));
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDir('desc');
  };
  const dateRange = useMemo(() => {
    const year = dateFilter.year ? Number(dateFilter.year) : null;
    if (!year) return { createdAfter: null, createdBefore: null };
    const month = dateFilter.month ? Number(dateFilter.month) : null;
    const start = new Date(year, month ? month - 1 : 0, 1, 0, 0, 0, 0);
    const end = month
      ? new Date(year, month, 0, 23, 59, 59, 999)
      : new Date(year + 1, 0, 0, 23, 59, 59, 999);
    return { createdAfter: start.toISOString(), createdBefore: end.toISOString() };
  }, [dateFilter]);
  const handleDateFilterChange = (field, value) => setDateFilter((prev) => ({ ...prev, [field]: value }));
  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    const out = [];
    for (let y = 2023; y <= now; y++) out.push(String(y));
    return out.reverse();
  }, []);
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
    const list = Array.isArray(j.items) ? j.items : [];
    setKeys(list);
    setKeyId('');
  };

  const loadTransactions = async () => {
    setLoading(true);
    setMessage('');
    setMessageIsError(false);
    try {
      const includeAll = dateRange.createdAfter || dateRange.createdBefore;
      const effectiveLimit = includeAll ? 20000 : limit;
      const qs = new URLSearchParams();
      qs.set('limit', String(effectiveLimit || 25));
      if (keyId) qs.set('key_id', String(keyId));
      if (status && status !== 'all') qs.set('status', status);
      if (dateRange.createdAfter) qs.set('created_after', dateRange.createdAfter);
      if (dateRange.createdBefore) qs.set('created_before', dateRange.createdBefore);
      const j = await fetchJson(`/api/stripe-api/transactions?${qs.toString()}`);
      setItems(Array.isArray(j.items) ? j.items : []);
      setStats(j.stats && typeof j.stats === 'object' ? j.stats : { total: 0, succeeded: 0, refunded: 0, disputed: 0, failed: 0, uncaptured: 0 });
      setTotalSelected(Number(j?.stats?.total || 0));
      setWindowInfo(j.window && typeof j.window === 'object' ? j.window : null);
    } catch (e) {
      setItems([]);
      setTotalSelected(0);
      setMessage(String(e?.message || e));
      setMessageIsError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys().catch((e) => { setMessage(String(e?.message || e)); setMessageIsError(true); });
  }, [fetchJson]);

  useEffect(() => {
    loadTransactions().catch(() => {});
  }, [keyId, limit, status, dateRange.createdAfter, dateRange.createdBefore]);

  const normalizedItems = useMemo(() => {
    const filtered = (items || []).filter((it) => {
      const matchesValue = (value, term) => {
        if (!term) return true;
        const text = String(value || '').toLowerCase();
        return text.includes(term);
      };
      const termAccount = (filters.account || '').trim().toLowerCase();
      const termReference = (filters.reference || '').trim().toLowerCase();
      const termOrder = (filters.order || '').trim().toLowerCase();
      const termCart = (filters.cart || '').trim().toLowerCase();
      return (
        matchesValue(it.key_name || it.account_name || '', termAccount) &&
        matchesValue(it.meta_reference || it.reference || '', termReference) &&
        matchesValue(it.meta_order || it.order || '', termOrder) &&
        matchesValue(it.meta_cart || it.cart || '', termCart)
      );
    });
    const sorted = filtered.slice().sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const cmp = (x, y) => {
        if (x == null && y == null) return 0;
        if (x == null) return -1;
        if (y == null) return 1;
        if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y);
        if (typeof x === 'number' && typeof y === 'number') return x - y;
        const xa = String(x);
        const ya = String(y);
        return xa.localeCompare(ya);
      };
      let result = 0;
      if (sortField === 'amount') result = cmp(a.amount, b.amount);
      else if (sortField === 'date') result = cmp(a.created, b.created);
      else if (sortField === 'account') result = cmp(a.key_name, b.key_name);
      else if (sortField === 'reference') result = cmp(a.meta_reference, b.meta_reference);
      else if (sortField === 'order') result = cmp(a.meta_order, b.meta_order);
      else if (sortField === 'cart') result = cmp(a.meta_cart, b.meta_cart);
      else if (sortField === 'status') result = cmp(a.status, b.status);
      else result = cmp(a.created, b.created);
      return result * dir;
    });
    return sorted;
  }, [items, filters, sortField, sortDir]);

  return (
    <div className="space-y-4">
      <DetailsModal open={!!selected} item={selected} onClose={() => setSelected(null)} />
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-gray-700">
              Stripe account
              <select className="mt-1 block w-72 rounded border border-gray-200 px-2 py-1 text-sm" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
                <option value="">All accounts</option>
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
                className="mt-1 block w-24 rounded border border-gray-200 px-2 py-1 text-sm"
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value || 25))}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadKeys} className="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-800">Reload keys</button>
            <button onClick={loadTransactions} className="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-800">{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>
        {windowInfo?.created_gte_date ? (
          <div className="text-xs text-gray-500">
            Sync window: transactions from {windowInfo.created_gte_date} and newer.
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {[
            { k: 'all', label: 'All', value: stats.total },
            { k: 'succeeded', label: 'Succeeded', value: stats.succeeded },
            { k: 'refunded', label: 'Refunded', value: stats.refunded },
            { k: 'disputed', label: 'Disputed', value: stats.disputed },
            { k: 'failed', label: 'Failed', value: stats.failed },
            { k: 'uncaptured', label: 'Uncaptured', value: stats.uncaptured },
          ].map((s) => (
            <button
              key={s.k}
              onClick={() => setStatus(s.k)}
              className={`rounded border px-3 py-2 text-left text-sm ${status === s.k ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
            >
              <div className="text-xs text-gray-500">{s.label}</div>
              <div className="font-semibold text-gray-900">{Number(s.value || 0).toLocaleString()}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <div className="flex flex-col items-start">
            <span className="text-[11px] uppercase tracking-wide text-gray-400">Year</span>
            <select
              className="mt-1 w-24 rounded border border-gray-200 px-2 py-1 text-sm"
              value={dateFilter.year}
              onChange={(e) => handleDateFilterChange('year', e.target.value)}
            >
              <option value="">Latest</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col items-start">
            <span className="text-[11px] uppercase tracking-wide text-gray-400">Month</span>
            <select
              className="mt-1 w-32 rounded border border-gray-200 px-2 py-1 text-sm"
              value={dateFilter.month}
              onChange={(e) => handleDateFilterChange('month', e.target.value)}
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          {(dateFilter.year || dateFilter.month) ? (
            <button
              className="text-xs text-blue-600 underline"
              onClick={() => setDateFilter({ year: '', month: '' })}
            >
              Clear date filter
            </button>
          ) : null}
          <div className="ml-auto text-[11px]">
            Transactions are read from the database table <span className="font-mono">mod_stripe_api_transactions</span>. Use “Sync &amp; Backfill” to import new rows.
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          Selected: {totalSelected.toLocaleString()} • Showing {normalizedItems.length.toLocaleString()}
        </div>
      </div>

      {message ? <div className={`text-sm ${messageIsError ? 'text-red-700' : 'text-gray-700'}`}>{message}</div> : null}

      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <div className="max-h-[560px] overflow-y-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
            <tr className="bg-gray-50 sticky top-0 z-10">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  <button type="button" className="flex items-center gap-1" onClick={() => handleSort('amount')}>
                    Amount {sortIndicator('amount', sortField, sortDir)}
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  <button type="button" className="flex items-center gap-1" onClick={() => handleSort('status')}>
                    Status {sortIndicator('status', sortField, sortDir)}
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Payment method</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  <button type="button" className="flex items-center gap-1" onClick={() => handleSort('account')}>
                    Account {sortIndicator('account', sortField, sortDir)}
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  <button type="button" className="flex items-center gap-1" onClick={() => handleSort('reference')}>
                    Reference {sortIndicator('reference', sortField, sortDir)}
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  <button type="button" className="flex items-center gap-1" onClick={() => handleSort('order')}>
                    Order {sortIndicator('order', sortField, sortDir)}
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  <button type="button" className="flex items-center gap-1" onClick={() => handleSort('cart')}>
                    Cart {sortIndicator('cart', sortField, sortDir)}
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  <button type="button" className="flex items-center gap-1" onClick={() => handleSort('date')}>
                    Date {sortIndicator('date', sortField, sortDir)}
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Refund date</th>
              </tr>
            <tr className="bg-white sticky top-[44px] z-10">
                <th />
                <th />
                <th />
                <th />
                <th>
                  <input
                    className="mt-1 block w-full rounded border border-gray-200 px-2 py-1 text-xs"
                    placeholder="Filter account"
                    value={filters.account}
                    onChange={(e) => handleFilterChange('account', e.target.value)}
                  />
                </th>
                <th>
                  <input
                    className="mt-1 block w-full rounded border border-gray-200 px-2 py-1 text-xs"
                    placeholder="Reference"
                    value={filters.reference}
                    onChange={(e) => handleFilterChange('reference', e.target.value)}
                  />
                </th>
                <th>
                  <input
                    className="mt-1 block w-full rounded border border-gray-200 px-2 py-1 text-xs"
                    placeholder="Order"
                    value={filters.order}
                    onChange={(e) => handleFilterChange('order', e.target.value)}
                  />
                </th>
                <th>
                  <input
                    className="mt-1 block w-full rounded border border-gray-200 px-2 py-1 text-xs"
                    placeholder="Cart"
                    value={filters.cart}
                    onChange={(e) => handleFilterChange('cart', e.target.value)}
                  />
                </th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {normalizedItems.length ? (
                normalizedItems.map((it) => (
                  <tr key={it.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelected(it)}>
                    <td className="px-3 py-2 text-sm text-gray-900">{formatMoney(it.amount, it.currency)}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">
                      {(() => {
                        const s = pickStatus(it);
                        return <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${s.tone}`}>{s.label}</span>;
                      })()}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-800">{paymentMethodLabel(it)}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">
                      <div className="font-mono text-xs text-gray-700">{it.payment_intent_id || it.id}</div>
                      <div className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{it.description_display || it.description || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-800">
                      {it.key_name || '—'}
                      {it.key_account_id ? <div className="text-xs text-gray-500">{it.key_account_id}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-800">{it.meta_reference || '—'}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">{it.meta_order || '—'}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">{it.meta_cart || '—'}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">{clientLabel(it)}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">{formatTs(it.created)}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">{it.refund_created ? formatTs(it.refund_created) : '—'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-6 text-sm text-gray-500" colSpan={11}>
                    {loading ? 'Loading…' : 'No data. Add keys in the Configuration tab, then click Sync.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
