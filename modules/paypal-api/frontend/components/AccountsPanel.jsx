import { useEffect, useMemo, useState } from 'react';

export default function AccountsPanel({ headers = {} }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [form, setForm] = useState({ name: '', mode: 'live', client_id: '', client_secret: '', is_default: true });

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
      const j = await fetchJson('/api/paypal-api/accounts');
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setItems([]);
      setMessage(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, [fetchJson]);

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    setMessage('');
    try {
      const j = await fetchJson('/api/paypal-api/accounts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: form.mode, client_id: form.client_id, client_secret: form.client_secret }),
      });
      setTestResult({ ok: true, mode: j.mode, app_id: j.app_id, scope: j.scope, expires_in: j.expires_in });
    } catch (e) {
      setTestResult({ ok: false, error: String(e?.message || e) });
    } finally {
      setTesting(false);
    }
  };

  const onCreate = async (e) => {
    e?.preventDefault?.();
    setCreating(true);
    setMessage('');
    setTestResult(null);
    try {
      const body = {
        name: form.name,
        mode: form.mode,
        client_id: form.client_id,
        client_secret: form.client_secret,
        is_default: !!form.is_default,
      };
      await fetchJson('/api/paypal-api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setForm({ name: '', mode: 'live', client_id: '', client_secret: '', is_default: true });
      await load();
      setMessage('Account saved. Use "Test" to validate credentials.');
    } catch (e2) {
      setMessage(String(e2?.message || e2));
    } finally {
      setCreating(false);
    }
  };

  const onMakeDefault = async (id) => {
    setMessage('');
    try {
      await fetchJson(`/api/paypal-api/accounts/${encodeURIComponent(id)}/default`, { method: 'POST' });
      await load();
      setMessage('Default updated.');
    } catch (e) {
      setMessage(String(e?.message || e));
    }
  };

  const onDelete = async (id) => {
    if (!confirm('Delete this PayPal account?')) return;
    setMessage('');
    try {
      await fetchJson(`/api/paypal-api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
      setMessage('Deleted.');
    } catch (e) {
      setMessage(String(e?.message || e));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-3">
        {message ? <div className="text-sm text-gray-700">{message}</div> : null}
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Client ID</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Secret</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {items.length ? (
                items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-4 py-2 text-sm text-gray-900">
                      {it.is_default ? <span className="mr-2 text-yellow-600">★</span> : null}
                      {it.name}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-800">{it.mode || '—'}</td>
                    <td className="px-4 py-2 text-sm text-gray-800 font-mono">{it.client_id_last6 ? `••••••${it.client_id_last6}` : '—'}</td>
                    <td className="px-4 py-2 text-sm text-gray-800">{it.has_secret ? `••••${it.secret_last4 || ''}` : '—'}</td>
                    <td className="px-4 py-2 text-sm text-right space-x-2">
                      {!it.is_default ? (
                        <button onClick={() => onMakeDefault(it.id)} className="rounded bg-gray-100 px-2 py-1 text-xs">Set default</button>
                      ) : null}
                      <button onClick={() => onDelete(it.id)} className="rounded bg-red-600 text-white px-2 py-1 text-xs">Delete</button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-6 text-sm text-gray-500" colSpan={5}>
                    {loading ? 'Loading…' : 'No accounts yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3">
        <form onSubmit={onCreate} className="rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="text-sm font-medium text-gray-900">Add PayPal Account</div>

          <label className="block text-sm text-gray-700">
            Name
            <input
              className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="My PayPal account"
              required
            />
          </label>

          <label className="block text-sm text-gray-700">
            Mode
            <select
              className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              value={form.mode}
              onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
            >
              <option value="live">live</option>
              <option value="sandbox">sandbox</option>
            </select>
          </label>

          <label className="block text-sm text-gray-700">
            Client ID
            <input
              className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              value={form.client_id}
              onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
              placeholder="AcF…"
              required
            />
          </label>

          <label className="block text-sm text-gray-700">
            Client secret
            <input
              className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              type="password"
              value={form.client_secret}
              onChange={(e) => setForm((f) => ({ ...f, client_secret: e.target.value }))}
              placeholder="••••••••"
              required
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={!!form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} />
            Set as default
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onTest}
              disabled={testing || !String(form.client_id || '').trim() || !String(form.client_secret || '').trim()}
              className="rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-800"
            >
              {testing ? 'Testing…' : 'Test'}
            </button>
            <button
              disabled={creating}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              {creating ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>

        {testResult ? (
          <div className={`rounded border p-3 text-sm ${testResult.ok ? 'border-green-200 text-green-700 bg-green-50' : 'border-red-200 text-red-700 bg-red-50'}`}>
            {testResult.ok ? (
              <div>
                <div>PayPal OK • mode: {testResult.mode || '—'}</div>
                {testResult.app_id ? <div className="mt-1 text-xs font-mono">app_id: {testResult.app_id}</div> : null}
                {testResult.expires_in ? <div className="mt-1 text-xs">expires_in: {testResult.expires_in}s</div> : null}
              </div>
            ) : (
              <div>{testResult.error}</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
