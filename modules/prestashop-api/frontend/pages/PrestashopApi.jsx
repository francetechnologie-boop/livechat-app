import { useEffect, useState } from 'react';
import Mcp2Sources from '../components/Mcp2SourcesList.jsx';

export default function PrestashopApi() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [form, setForm] = useState({ name: '', base_url: '', api_key: '' });
  const [edit, setEdit] = useState(null); // { id, name, base_url, api_key: '' }

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/prestashop-api/connections', { credentials: 'include' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || j.error || 'load_failed');
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) { setMessage(String(e?.message || e)); }
    setLoading(false);
  };

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['PrestaShop API', 'Connections'] })); } catch {}
    load();
  }, []);

  const onCreate = async (e) => {
    e?.preventDefault?.();
    setCreating(true);
    setMessage('');
    setTestResult(null);
    try {
      const r = await fetch('/api/prestashop-api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(form) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || j.error || 'create_failed');
      setForm({ base_url: '', api_key: '' });
      await load();
      setMessage('Connection created.');
    } catch (e) { setMessage(String(e?.message || e)); }
    setCreating(false);
  };

  const onEdit = (it) => { setEdit({ id: it.id, name: it.name || '', base_url: it.base_url, api_key: '' }); };

  const onSaveEdit = async () => {
    if (!edit) return;
    setMessage(''); setTestResult(null);
    try {
      const body = { name: edit.name, base_url: edit.base_url };
      if (edit.api_key && edit.api_key.trim()) body.api_key = edit.api_key.trim();
      const r = await fetch(`/api/prestashop-api/connections/${encodeURIComponent(edit.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || j.error || 'update_failed');
      setEdit(null);
      await load();
      setMessage('Connection updated.');
    } catch (e) { setMessage(String(e?.message || e)); }
  };

  const onDelete = async (id) => {
    if (!confirm('Delete this connection?')) return;
    setMessage(''); setTestResult(null);
    try {
      const r = await fetch(`/api/prestashop-api/connections/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json().catch(()=>({ ok: r.ok }));
      if (!j.ok) throw new Error(j.message || j.error || 'delete_failed');
      await load();
      setMessage('Deleted.');
    } catch (e) { setMessage(String(e?.message || e)); }
  };

  const onMakeDefault = async (id) => {
    setMessage(''); setTestResult(null);
    try {
      const r = await fetch(`/api/prestashop-api/connections/${encodeURIComponent(id)}/default`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || j.error || 'default_failed');
      await load();
      setMessage('Default updated.');
    } catch (e) { setMessage(String(e?.message || e)); }
  };

  const onTest = async (id) => {
    setTestingId(id); setTestResult(null); setMessage('');
    try {
      const r = await fetch(`/api/prestashop-api/connections/${encodeURIComponent(id)}/test`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      setTestResult({ ok: !!j.ok, status: j.status || r.status, url: j.url || (j.detail && j.detail.url), desc: j.desc, error: j.error, detail: j.detail, isJson: j.isJson, sample: j.sample });
    } catch (e) { setTestResult({ ok: false, error: String(e?.message || e) }); }
    setTestingId(null);
  };

  return (
    <div className="h-full overflow-y-auto bg-white">
      <header className="border-b px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-900">PrestaShop API • Connections</h1>
        <p className="text-sm text-gray-500">Manage API endpoints stored in mod_prestashop_api_settings.</p>
      </header>
      <main className="p-6">
        {message && <div className="mb-4 text-sm text-gray-700">{message}</div>}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Base URL</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">API Key</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Updated</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr><td className="px-4 py-3 text-sm text-gray-500" colSpan={5}>Loading…</td></tr>
                  ) : (
                    items.length ? items.map(it => (
                      <tr key={it.id} className="align-top">
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {edit && edit.id === it.id ? (
                            <input className="w-full rounded border border-gray-200 px-2 py-1 text-sm" value={edit.name} onChange={e=>setEdit({ ...edit, name: e.target.value })} />
                          ) : (it.name || '—')}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {edit && edit.id === it.id ? (
                            <input className="w-full rounded border border-gray-200 px-2 py-1 text-sm" value={edit.base_url} onChange={e=>setEdit({ ...edit, base_url: e.target.value })} />
                          ) : it.base_url}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">{it.has_api_key ? 'Set' : '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{it.updated_at ? new Date(it.updated_at).toLocaleString() : ''}</td>
                        <td className="px-4 py-3 text-sm text-right space-x-2">
                          {edit && edit.id === it.id ? (
                            <>
                              <button onClick={onSaveEdit} className="rounded bg-blue-600 text-white px-2 py-1 text-xs">Save</button>
                              <button onClick={()=>setEdit(null)} className="rounded bg-gray-200 px-2 py-1 text-xs">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={()=>onEdit(it)} className="rounded bg-gray-100 px-2 py-1 text-xs">Edit</button>
                              <button onClick={()=>onTest(it.id)} className="rounded bg-gray-700 text-white px-2 py-1 text-xs">{testingId===it.id?'Testing…':'Test'}</button>
                              <button onClick={()=>onDelete(it.id)} className="rounded bg-red-600 text-white px-2 py-1 text-xs">Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    )) : (
                      <tr><td className="px-4 py-3 text-sm text-gray-500" colSpan={4}>No connections yet.</td></tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
            {testResult && (
              <div className={`mt-3 text-sm ${testResult.ok ? 'text-green-700' : 'text-red-700'}`}>
                {testResult.ok ? 'Connection OK' : 'Connection Failed'}
                {testResult.status ? ` (HTTP ${testResult.status})` : ''}
                {testResult.desc ? ` • ${testResult.desc}` : ''}
                {testResult.url ? <div className="text-xs text-gray-500">{testResult.url}</div> : null}
                {testResult.sample ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs bg-gray-50 p-2 border border-gray-200 rounded">{testResult.sample}</pre> : null}
                {testResult.error && !testResult.ok ? <div className="text-xs">{String(testResult.error)}</div> : null}
              </div>
            )}
          </div>
          <div>
            <form onSubmit={onCreate} className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="text-sm font-medium text-gray-900">Add New Connection</div>
              <label className="block text-sm text-gray-700">
                Name
                <input className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm" placeholder="My Shop" value={form.name} onChange={e=>setForm({ ...form, name: e.target.value })} required />
              </label>
              <label className="block text-sm text-gray-700">
                Base URL
                <input className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm" placeholder="https://shop.example.com/api" value={form.base_url} onChange={e=>setForm({ ...form, base_url: e.target.value })} required />
              </label>
              <label className="block text-sm text-gray-700">
                API Key
                <input className="mt-1 w-full rounded border border-gray-200 px-3 py-2 text-sm" type="password" value={form.api_key} onChange={e=>setForm({ ...form, api_key: e.target.value })} required />
              </label>
              <div>
                <button disabled={creating} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-blue-700">{creating?'Creating…':'Create'}</button>
              </div>
            </form>
          </div>
        </div>
        <div className="mt-8">
          <Mcp2Sources
            title="Discovered MCP2 Sources (PrestaShop)"
            useLabel="Open in Connections"
            onUse={(it) => {
              // Prefer http_base; fallback to stream_url or sse_url
              const url = it?.http_base || it?.stream_url || it?.sse_url || '';
              setForm((f) => ({ ...f, name: it?.name || f.name, base_url: url }));
              try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
            }}
          />
        </div>
      </main>
    </div>
  );
}
