import { useEffect, useMemo, useState } from 'react';

async function readJsonOrText(res) {
  const text = await res.text().catch(() => '');
  try { return { json: JSON.parse(text), text }; } catch { return { json: null, text }; }
}

function normalizeCurrency(value) {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return '';
  if (s === 'CZK' || s === 'EUR' || s === 'USD') return s;
  return '';
}

function normalizeOwner(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s === 'Ivana' || s === 'Olivier') return s;
  return s;
}

function rateToText(value) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return s;
}

function normalizeAccountType(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'long_term' || s === 'long-term' || s === 'long term' || s === 'long') return 'long_term';
  if (s === 'short_term' || s === 'short-term' || s === 'short term' || s === 'short') return 'short_term';
  return '';
}

function typeLabel(value) {
  const t = normalizeAccountType(value);
  if (t === 'long_term') return 'Long term';
  if (t === 'short_term') return 'Short term';
  return '';
}

export default function ConfigurationPanel({ headers, orgId }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [testById, setTestById] = useState(() => ({}));
  const [testingId, setTestingId] = useState(null);

  const [label, setLabel] = useState('');
  const [owner, setOwner] = useState('');
  const [currency, setCurrency] = useState('CZK');
  const [expectedInterestRate, setExpectedInterestRate] = useState('');
  const [accountType, setAccountType] = useState('');
  const [notes, setNotes] = useState('');
  const [token, setToken] = useState('');
  const [testResult, setTestResult] = useState(null);

  const [editing, setEditing] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editOwner, setEditOwner] = useState('');
  const [editCurrency, setEditCurrency] = useState('');
  const [editExpectedInterestRate, setEditExpectedInterestRate] = useState('');
  const [editAccountType, setEditAccountType] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editToken, setEditToken] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const effectiveHeaders = useMemo(() => {
    const h = { ...(headers || {}) };
    const cleaned = String(orgId || '').trim();
    if (cleaned) h['X-Org-Id'] = cleaned;
    return h;
  }, [headers, orgId]);

  const openEdit = (it) => {
    setError('');
    setEditing(it);
    setEditLabel(String(it?.label || ''));
    setEditOwner(normalizeOwner(it?.owner));
    setEditCurrency(normalizeCurrency(it?.currency));
    setEditExpectedInterestRate(rateToText(it?.expected_interest_rate));
    setEditAccountType(normalizeAccountType(it?.account_type));
    setEditNotes(String(it?.notes || ''));
    setEditToken('');
  };

  const closeEdit = () => {
    setEditing(null);
    setEditLabel('');
    setEditOwner('');
    setEditCurrency('');
    setEditExpectedInterestRate('');
    setEditAccountType('');
    setEditNotes('');
    setEditToken('');
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fio-banka/accounts', { headers: effectiveHeaders, credentials: 'include' });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      const data = json;
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const createAccount = async () => {
    setSaving(true);
    setError('');
    try {
      const body = {
        org_id: String(orgId || '').trim() || null,
        label,
        owner: String(owner || '').trim() || null,
        account_type: accountType || null,
        notes: notes || null,
        currency: String(currency || '').trim() || null,
        expected_interest_rate: expectedInterestRate !== '' ? expectedInterestRate : null,
        token,
      };
      const res = await fetch('/api/fio-banka/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...effectiveHeaders },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      setLabel('');
      setOwner('');
      setCurrency('CZK');
      setExpectedInterestRate('');
      setAccountType('');
      setNotes('');
      setToken('');
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this account config?')) return;
    setError('');
    try {
      const res = await fetch(`/api/fio-banka/accounts/${id}`, { method: 'DELETE', headers: effectiveHeaders, credentials: 'include' });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const testStored = async (id) => {
    if (!id) return;
    setTestingId(id);
    setError('');
    try {
      const res = await fetch(`/api/fio-banka/accounts/${id}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...effectiveHeaders },
        body: JSON.stringify({ org_id: String(orgId || '').trim() || null }),
        credentials: 'include',
      });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      setTestById((prev) => ({
        ...(prev || {}),
        [id]: { ok: true, when: Date.now(), info: json.info || null, tx_count: json.tx_count ?? null },
      }));
    } catch (e) {
      const msg = String(e?.message || e);
      setTestById((prev) => ({
        ...(prev || {}),
        [id]: { ok: false, when: Date.now(), message: msg },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const testToken = async () => {
    setTestResult(null);
    setError('');
    try {
      const res = await fetch('/api/fio-banka/accounts/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...effectiveHeaders },
        body: JSON.stringify({ token }),
        credentials: 'include',
      });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      setTestResult(json);
    } catch (e) {
      setError(String(e?.message || e));
    }
  };

  const saveEdit = async () => {
    if (!editing?.id) return;
    setEditSaving(true);
    setError('');
    try {
      const payload = {};
      const nextLabel = String(editLabel || '').trim();
      const nextOwner = String(editOwner || '').trim();
      const nextCurrency = String(editCurrency || '').trim().toUpperCase();
      const nextRateRaw = String(editExpectedInterestRate || '').trim();
      const nextType = String(editAccountType || '').trim();
      const nextNotes = String(editNotes || '').trim();
      const nextToken = String(editToken || '').trim();

      const prevLabel = String(editing?.label || '').trim();
      const prevOwner = String(editing?.owner || '').trim();
      const prevCurrency = String(editing?.currency || '').trim().toUpperCase();
      const prevRate = editing?.expected_interest_rate;
      const prevType = String(editing?.account_type || '').trim();
      const prevNotes = String(editing?.notes || '').trim();

      if (!nextLabel) throw new Error('Label is required.');
      if (nextLabel !== prevLabel) payload.label = nextLabel;

      // Owner: allow clearing by selecting "(none)"
      if (nextOwner !== prevOwner) payload.owner = nextOwner || '';

      // Type: allow clearing by selecting "(none)"
      if (nextType !== prevType) payload.account_type = nextType || '';

      // Notes: allow clearing
      if (nextNotes !== prevNotes) payload.notes = nextNotes || '';

      // Currency: allow clearing by selecting "(none)"
      if (nextCurrency !== prevCurrency) payload.currency = nextCurrency || '';

      // Rate: send only if changed (blank clears)
      const nextRateNorm = nextRateRaw ? Number(nextRateRaw.replace(',', '.')) : null;
      const prevRateNorm = (prevRate === null || prevRate === undefined || prevRate === '') ? null : Number(prevRate);
      const nextRateComparable = nextRateNorm === null ? null : (Number.isFinite(nextRateNorm) ? nextRateNorm : NaN);
      const prevRateComparable = prevRateNorm === null ? null : (Number.isFinite(prevRateNorm) ? prevRateNorm : NaN);
      const rateChanged = (nextRateComparable === null && prevRateComparable !== null)
        || (nextRateComparable !== null && prevRateComparable === null)
        || (Number.isFinite(nextRateComparable) && Number.isFinite(prevRateComparable) && nextRateComparable !== prevRateComparable);
      if (rateChanged) payload.expected_interest_rate = nextRateRaw || '';

      if (nextToken) payload.token = nextToken;

      if (!Object.keys(payload).length) {
        closeEdit();
        return;
      }

      const res = await fetch(`/api/fio-banka/accounts/${editing.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...effectiveHeaders },
        body: JSON.stringify({ org_id: String(orgId || '').trim() || null, ...payload }),
        credentials: 'include',
      });
      const { json, text } = await readJsonOrText(res);
      if (!res.ok || !json?.ok) throw new Error(json?.message || json?.error || text || `HTTP ${res.status}`);
      closeEdit();
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-4">
      <div className="rounded border bg-gray-50 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Add Fio account</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-sm">
            Label
            <input className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ivana 2101082497 CZK" />
          </label>
          <label className="text-sm">
            Owner
            <select className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">(optional)</option>
              <option value="Ivana">Ivana</option>
              <option value="Olivier">Olivier</option>
            </select>
          </label>
          <label className="text-sm">
            Currency
            <select className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="CZK">CZK</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label className="text-sm">
            Expected interest rate (%)
            <input className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={expectedInterestRate} onChange={(e) => setExpectedInterestRate(e.target.value)} placeholder="e.g. 4.5" />
          </label>
          <label className="text-sm">
            Type
            <select className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
              <option value="">(optional)</option>
              <option value="long_term">Long term</option>
              <option value="short_term">Short term</option>
            </select>
          </label>
          <label className="text-sm md:col-span-3">
            Notes
            <textarea className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="optional" />
          </label>
          <label className="text-sm md:col-span-3">
            Fio token (stored in DB)
            <input className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={token} onChange={(e) => setToken(e.target.value)} placeholder="****" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="rounded bg-gray-800 px-3 py-2 text-sm text-white" onClick={testToken} disabled={!token || saving}>
            Test token
          </button>
          <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white" onClick={createAccount} disabled={!label || !token || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="rounded bg-white px-3 py-2 text-sm text-gray-800 ring-1 ring-gray-200" onClick={load} disabled={loading || saving}>
            {loading ? 'Loading…' : 'Refresh list'}
          </button>
        </div>
        {testResult?.ok ? (
          <div className="mt-3 rounded border bg-white p-3 text-xs text-gray-700">
            <div className="font-medium text-gray-900">Token OK</div>
            <div className="mt-1">Account: {testResult.info?.accountId || '—'} · Currency: {testResult.info?.currency || '—'} · tx_count (7d): {testResult.tx_count}</div>
          </div>
        ) : null}
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="rounded border">
        <div className="border-b bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700">Configured accounts</div>
        <div className="divide-y">
      {items.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-gray-900">{it.label}</div>
                <div className="text-xs text-gray-600">
                  Token: {it.token?.has_token ? `…${it.token.last4}` : '—'}
                  {it.owner ? <> · Owner: {it.owner}</> : null}
                  {it.account_type ? <> · Type: {typeLabel(it.account_type) || it.account_type}</> : null}
                  {it.currency ? <> · Currency: {it.currency}</> : null}
                  {it.expected_interest_rate != null ? <> · Interest: {it.expected_interest_rate}%</> : null}
                  {it.fio_account_id ? <> · AccountId: {it.fio_account_id}</> : null}
                  {it.last_sync_at ? <> · Last sync: {String(it.last_sync_at)}</> : null}
                </div>
                {it.notes ? (
                  <div className="mt-1 text-xs text-gray-600 whitespace-pre-wrap break-words">{it.notes}</div>
                ) : null}
                {testById?.[it.id] ? (
                  <div className={`mt-1 text-xs ${testById[it.id].ok ? 'text-green-700' : 'text-red-600'}`}>
                    {testById[it.id].ok ? (
                      <>Test OK · tx_count(7d): {testById[it.id].tx_count ?? '—'} · API currency: {testById[it.id].info?.currency || '—'}</>
                    ) : (
                      <>Test failed: {testById[it.id].message || 'error'}</>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-900" onClick={() => testStored(it.id)} disabled={testingId === it.id}>
                  {testingId === it.id ? 'Testing…' : 'Test'}
                </button>
                <button className="rounded bg-gray-800 px-3 py-1.5 text-sm text-white" onClick={() => openEdit(it)}>Edit</button>
                <button className="rounded bg-red-600 px-3 py-1.5 text-sm text-white" onClick={() => del(it.id)}>Delete</button>
              </div>
            </div>
          ))}
          {!items.length ? <div className="px-4 py-6 text-sm text-gray-500">No accounts configured.</div> : null}
        </div>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeEdit} role="presentation">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow" onClick={(e) => e.stopPropagation()} role="presentation">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-semibold text-gray-900">Edit Fio account</div>
              <button className="text-sm text-gray-600" onClick={closeEdit} type="button">Close</button>
            </div>
            <div className="space-y-3 px-4 py-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="text-sm md:col-span-2">
                  Label
                  <input className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                </label>
                <label className="text-sm">
                  Owner
                  <select className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={editOwner} onChange={(e) => setEditOwner(e.target.value)}>
                    <option value="">(none)</option>
                    <option value="Ivana">Ivana</option>
                    <option value="Olivier">Olivier</option>
                  </select>
                </label>
                <label className="text-sm">
                  Currency
                  <select className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={editCurrency} onChange={(e) => setEditCurrency(e.target.value)}>
                    <option value="">(none)</option>
                    <option value="CZK">CZK</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                  </select>
                </label>
                <label className="text-sm">
                  Expected interest rate (%)
                  <input className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={editExpectedInterestRate} onChange={(e) => setEditExpectedInterestRate(e.target.value)} placeholder="blank = clear" />
                </label>
                <label className="text-sm">
                  Type
                  <select className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={editAccountType} onChange={(e) => setEditAccountType(e.target.value)}>
                    <option value="">(none)</option>
                    <option value="long_term">Long term</option>
                    <option value="short_term">Short term</option>
                  </select>
                </label>
                <label className="text-sm md:col-span-3">
                  Notes
                  <textarea className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} placeholder="blank = clear" />
                </label>
                <label className="text-sm md:col-span-3">
                  New token (optional)
                  <input className="mt-1 w-full rounded border bg-white px-2 py-1 text-sm" value={editToken} onChange={(e) => setEditToken(e.target.value)} placeholder="leave blank to keep existing token" />
                </label>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button className="rounded bg-white px-3 py-2 text-sm text-gray-800 ring-1 ring-gray-200" onClick={closeEdit} type="button" disabled={editSaving}>Cancel</button>
                <button className="rounded bg-blue-600 px-3 py-2 text-sm text-white" onClick={saveEdit} type="button" disabled={editSaving}>
                  {editSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
