import React, { useCallback, useEffect, useState } from 'react';

export default function Config({ onRefresh }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ id: '', name: 'Zásilkovna', target: 'https://client.packeta.com/en/packets/list', options: { packeta: { email: '', password: '', signInUrl: 'https://client.packeta.com/en/sign/in', listUrl: 'https://client.packeta.com/en/packets/list', tableCsv: true } }, enabled: true });
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showApiPw, setShowApiPw] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/grabbing-zasilkovna/configs', { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      const list = Array.isArray(j.items)? j.items: [];
      setItems(list);
      onRefresh?.(list);
    } catch (e) { setError(String(e?.message||e)); }
    finally { setLoading(false); }
  }, [onRefresh]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { ...form };
      if (typeof body.options !== 'object') body.options = {};
      const r = await fetch('/api/grabbing-zasilkovna/config', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||'save_failed');
      setForm({ ...form, id: j.item.id });
      load();
    } catch (e) { setError(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const onNew = () => {
    setForm({ id: '', name: 'Zásilkovna', target: 'https://client.packeta.com/en/packets/list', options: { packeta: { email: '', password: '', signInUrl: 'https://client.packeta.com/en/sign/in', listUrl: 'https://client.packeta.com/en/packets/list', tableCsv: true } }, enabled: true });
  };

  const remove = async (id) => {
    if (!id) return;
    const ok = window.confirm(`Delete config ${id}?`);
    if (!ok) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/grabbing-zasilkovna/config/${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include' });
      const j = await r.json().catch(()=>({ ok:false }));
      if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||'delete_failed');
      onNew();
      load();
    } catch (e) { setError(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const mask = (s='') => s ? '****' : '';

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Zásilkovna Config</h2>
        <button onClick={load} className="px-3 py-1.5 rounded border text-sm">Refresh</button>
      </div>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="panel">
          <div className="panel__header flex items-center justify-between">
            <span>Create / Update</span>
            <div className="flex gap-2">
              <button onClick={onNew} className="px-3 py-1.5 rounded border text-sm">New</button>
              <button onClick={()=>remove(form.id)} disabled={!form.id || busy} className="px-3 py-1.5 rounded border text-sm disabled:opacity-60">Delete</button>
            </div>
          </div>
          <div className="panel__body space-y-3">
            <div>
              <label className="text-xs block mb-1">ID</label>
              <input className="w-full border rounded px-2 py-1 text-sm" value={form.id} onChange={(e)=>setForm(prev=>({...prev, id: e.target.value}))} placeholder="auto if blank" />
            </div>
            <div>
              <label className="text-xs block mb-1">Name</label>
              <input className="w-full border rounded px-2 py-1 text-sm" value={form.name} onChange={(e)=>setForm(prev=>({...prev, name: e.target.value}))} />
            </div>
            <div>
              <label className="text-xs block mb-1">Target URL</label>
              <input className="w-full border rounded px-2 py-1 text-sm" value={form.target} onChange={(e)=>setForm(prev=>({...prev, target: e.target.value}))} />
            </div>
            <div className="space-y-2">
              <div className="text-xs text-gray-600">Packeta Credentials (stored in DB; password masked in UI)</div>
              <input className="w-full border rounded px-2 py-1 text-sm" placeholder="email" value={form.options?.packeta?.email||''} onChange={(e)=>setForm(prev=>({ ...prev, options: { ...(prev.options||{}), packeta: { ...(prev.options?.packeta||{}), email: e.target.value } } }))} />
              <div className="flex items-center gap-2">
                <input className="w-full border rounded px-2 py-1 text-sm" type={showPw ? 'text' : 'password'} placeholder="password" value={form.options?.packeta?.password||''} onChange={(e)=>setForm(prev=>({ ...prev, options: { ...(prev.options||{}), packeta: { ...(prev.options?.packeta||{}), password: e.target.value } } }))} />
                <label className="inline-flex items-center gap-1 text-xs text-gray-600">
                  <input type="checkbox" checked={showPw} onChange={(e)=>setShowPw(!!e.target.checked)} /> Show
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded px-2 py-1 text-sm" placeholder="signInUrl" value={form.options?.packeta?.signInUrl||''} onChange={(e)=>setForm(prev=>({ ...prev, options: { ...(prev.options||{}), packeta: { ...(prev.options?.packeta||{}), signInUrl: e.target.value } } }))} />
                <input className="border rounded px-2 py-1 text-sm" placeholder="listUrl" value={form.options?.packeta?.listUrl||''} onChange={(e)=>setForm(prev=>({ ...prev, options: { ...(prev.options||{}), packeta: { ...(prev.options?.packeta||{}), listUrl: e.target.value } } }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded px-2 py-1 text-sm" placeholder="API key" value={form.options?.packeta?.apiKey||''} onChange={(e)=>setForm(prev=>({ ...prev, options: { ...(prev.options||{}), packeta: { ...(prev.options?.packeta||{}), apiKey: e.target.value } } }))} />
                <div className="flex items-center gap-2">
                  <input className="w-full border rounded px-2 py-1 text-sm" type={showApiPw ? 'text' : 'password'} placeholder="API password" value={form.options?.packeta?.apiPassword||''} onChange={(e)=>setForm(prev=>({ ...prev, options: { ...(prev.options||{}), packeta: { ...(prev.options?.packeta||{}), apiPassword: e.target.value } } }))} />
                  <label className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" checked={showApiPw} onChange={(e)=>setShowApiPw(!!e.target.checked)} /> Show
                  </label>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.options?.packeta?.tableCsv} onChange={(e)=>setForm(prev=>({ ...prev, options: { ...(prev.options||{}), packeta: { ...(prev.options?.packeta||{}), tableCsv: !!e.target.checked } } }))} /> Table CSV
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.enabled} onChange={(e)=>setForm(prev=>({...prev, enabled: !!e.target.checked}))} /> Enabled
            </label>
            <div className="flex gap-2">
              <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60">{busy?'Saving…':'Save'}</button>
              <button onClick={onNew} type="button" className="px-3 py-1.5 rounded border text-sm">Clear</button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">Existing Configs</div>
          <div className="panel__body">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-left">Enabled</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(items||[]).map(it => (
                  <tr key={it.id} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs">{it.id}</td>
                    <td className="px-3 py-2">{it.name}</td>
                    <td className="px-3 py-2 truncate max-w-[20rem]" title={it.target||''}>{it.target||'-'}</td>
                    <td className="px-3 py-2">{String(!!it.enabled)}</td>
                    <td className="px-3 py-2 space-x-2">
                      <button onClick={()=>setForm({ id: it.id, name: it.name, target: it.target||'', options: it.options||{}, enabled: !!it.enabled })} className="px-2 py-1 border rounded text-xs">Edit</button>
                      <button onClick={()=>remove(it.id)} className="px-2 py-1 border rounded text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
