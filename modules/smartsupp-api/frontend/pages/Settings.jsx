import React from 'react';

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-600">{label}</div>
      <div>{children}</div>
      {hint ? <div className="text-[11px] text-gray-500">{hint}</div> : null}
    </div>
  );
}

export default function Settings() {
  const [adminToken, setAdminToken] = React.useState(() => { try { return localStorage.getItem('ADMIN_TOKEN') || localStorage.getItem('admin_token') || ''; } catch { return ''; } });
  const fetchApi = async (path, init = {}) => {
    const t = (adminToken || '').trim();
    const url = new URL(path, window.location.origin);
    if (t) url.searchParams.set('admin_token', t);
    const headers = { ...(init.headers || {}) };
    if (t) headers['x-admin-token'] = t;
    return fetch(url.toString(), { ...init, headers, credentials: 'include' });
  };

  const [token, setToken] = React.useState("");
  const [filesReload, setFilesReload] = React.useState(0);
  const [fetching, setFetching] = React.useState(false);
  const [fetchStatus, setFetchStatus] = React.useState({ ok: null, name: '', url: '', size: 0, error: '' });

  const [savedLoading, setSavedLoading] = React.useState(false);
  const [savedValue, setSavedValue] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState("");

  const haveBackendToken = React.useMemo(() => !!(savedValue && String(savedValue).trim()), [savedValue]);

  const loadSaved = async () => {
    setSavedLoading(true); setSavedMsg("");
    try {
      const r = await fetchApi('/api/smartsupp-api/token');
      const j = await r.json();
      if (r.ok && j?.ok) setSavedValue(j.value || null); else setSavedValue(null);
    } catch { setSavedValue(null); }
    finally { setSavedLoading(false); }
  };
  React.useEffect(()=>{ loadSaved(); }, []);

  return (
    <div className="h-full w-full p-4 space-y-3 overflow-auto">
      <div className="panel max-w-3xl">
        <div className="panel__header">Admin access</div>
        <div className="panel__body space-y-2">
          <div className="grid grid-cols-12 gap-3 items-center">
            <div className="col-span-12 md:col-span-3 text-xs text-gray-600">Admin token</div>
            <div className="col-span-12 md:col-span-9 flex items-center gap-2">
              <input className="w-full border rounded px-3 py-2" value={adminToken} onChange={(e)=>setAdminToken(e.target.value)} placeholder="x-admin-token" />
              <button className="btn" onClick={()=>{ try { localStorage.setItem('ADMIN_TOKEN', adminToken||''); localStorage.setItem('admin_token', adminToken||''); } catch {}; setSavedMsg('Admin token saved locally'); setTimeout(()=>setSavedMsg(''),1500); }}>Save</button>
            </div>
          </div>
        </div>
      </div>

      <div className="border rounded bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs">Saved token (server): {savedLoading ? '…' : haveBackendToken ? <span className="text-green-700">configured</span> : <span className="text-gray-500">not set</span>}</div>
          <button className="text-xs px-2 py-1 rounded border" onClick={loadSaved} disabled={savedLoading}>Refresh</button>
          <div className="grow" />
          <input type="password" className="border rounded px-2 py-1 text-sm min-w-[220px]" placeholder="New token" value={token} onChange={(e)=>setToken(e.target.value)} />
          <button className="text-xs px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-60" disabled={saving || !token.trim()} onClick={async()=>{
            setSaving(true); setSavedMsg('');
            try {
              const r = await fetchApi('/api/smartsupp-api/token', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: token.trim() }) });
              const j = await r.json();
              if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
              setSavedValue(j.value || null); setSavedMsg('Saved.');
            } catch (e) { setSavedMsg(String(e?.message||e)); }
            finally { setSaving(false); }
          }}>Save token</button>
          <button className="text-xs px-3 py-1 rounded border disabled:opacity-60" disabled={saving || !haveBackendToken} onClick={async()=>{
            setSaving(true); setSavedMsg('');
            try {
              const r = await fetchApi('/api/smartsupp-api/token/disable', { method:'POST' });
              const j = await r.json();
              if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
              setSavedValue(null); setSavedMsg('Disabled.');
            } catch (e) { setSavedMsg(String(e?.message||e)); }
            finally { setSaving(false); }
          }}>Disable</button>
        </div>
        {savedMsg && <div className="text-[12px] mt-1 text-gray-600">{savedMsg}</div>}
      </div>

      <RangeDownloader fetchApi={fetchApi} fetching={fetching} setFetching={setFetching} fetchStatus={fetchStatus} setFetchStatus={setFetchStatus} filesReload={filesReload} setFilesReload={setFilesReload} />
      <StoredFiles fetchApi={fetchApi} reloadKey={filesReload} />
      <DownloadAssets fetchApi={fetchApi} />
    </div>
  );
}

function RangeDownloader({ fetchApi, fetching, setFetching, fetchStatus, setFetchStatus, filesReload, setFilesReload }) {
  const todayISO = React.useMemo(() => new Date().toISOString().slice(0,10), []);
  const weekAgoISO = React.useMemo(() => new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10), []);
  const [from, setFrom] = React.useState(weekAgoISO);
  const [to, setTo] = React.useState(todayISO);
  const [size, setSize] = React.useState(50);
  const [saveInfo, setSaveInfo] = React.useState(null); // { name, size, url }
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s||''));
  const disabled = fetching || !validDate(from) || !validDate(to) || (from > to) || !(size >= 1 && size <= 50);
  const doDownload = async () => {
    setFetching(true); setFetchStatus({ ok:null, name:'', url:'', size:0, error:'' });
    try {
      const r = await fetchApi('/api/smartsupp/download-range'+`?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&size=${size}`);
      const j = await r.json().catch(()=>null);
      if (!r.ok || j?.ok===false) {
        setFetchStatus({ ok:false, name:'', url:'', size:0, error:(j?.message || j?.error || `http_${r.status}`), raw:j });
        return;
      }
      setSaveInfo(null);
      setFetchStatus({ ok:true, name:j.file?.name||'', url:j.file?.url||'', size:j.file?.size||0, error:'', raw:j }); setFilesReload(x=>x+1);
    } catch (e) { setFetchStatus({ ok:false, name:'', url:'', size:0, error:String(e?.message||e) }); }
    finally { setFetching(false); }
  };
  const doSaveServerFile = async () => {
    setFetching(true); setSaveInfo(null);
    try {
      const r = await fetchApi('/api/smartsupp/range/fetch', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ from, to, size }) });
      const j = await r.json().catch(()=>null);
      if (!r.ok || j?.ok===false) {
        setFetchStatus({ ok:false, name:'', url:'', size:0, error:(j?.message || j?.error || `http_${r.status}`), raw:j });
        return;
      }
      const info = j.file || null;
      if (info) setSaveInfo({ name: info.name, size: info.size, url: info.url });
      setFilesReload(x=>x+1);
    } catch (e) { setFetchStatus({ ok:false, name:'', url:'', size:0, error:String(e?.message||e) }); }
    finally { setFetching(false); }
  };
  return (
    <div className="border rounded bg-white p-3 space-y-2">
      <div className="text-sm font-medium">Download range</div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <Field label="From (YYYY-MM-DD)" hint="Inclusive">
          <input disabled={fetching} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\\d{4}-\\d{2}-\\d{2}" title="YYYY-MM-DD" className="w-full border rounded px-2 py-1 text-sm" value={from} onChange={(e)=>setFrom(e.target.value)} />
        </Field>
        <Field label="To (YYYY-MM-DD)" hint="Inclusive">
          <input disabled={fetching} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\\d{4}-\\d{2}-\\d{2}" title="YYYY-MM-DD" className="w-full border rounded px-2 py-1 text-sm" value={to} onChange={(e)=>setTo(e.target.value)} />
        </Field>
        <Field label="Max per page" hint="1..10000 (API may cap)">
          <input disabled={fetching} type="number" min={1} max={10000} className="w-full border rounded px-2 py-1 text-sm" value={size} onChange={(e)=>setSize(Math.max(1, Math.min(10000, Number(e.target.value||1000) || 1000)))} />
        </Field>
        <div>
          <button disabled={disabled} className="text-xs px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-60" onClick={doDownload}>Download</button>
          {fetchStatus.ok && (
            <div className="text-xs text-green-700 mt-1">Saved {fetchStatus.name} ({fetchStatus.size?.toLocaleString?.()||fetchStatus.size} B)</div>
          )}
          {fetchStatus.ok===false && (
            <div className="text-xs text-red-700 mt-1">
              <div>{fetchStatus.error}</div>
              {fetchStatus.raw && (
                <pre className="mt-1 p-2 bg-red-50 border rounded text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(fetchStatus.raw, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      </div>
      {fetchStatus?.raw?.items && Array.isArray(fetchStatus.raw.items) && (
        <div className="text-xs text-gray-700">
          Found {fetchStatus.raw.items.length} item(s){fetchStatus?.raw?.pages ? ` across ${fetchStatus.raw.pages} page(s)` : ''}.
          <button className="ml-2 text-xs px-2 py-1 rounded border" disabled={fetching || !fetchStatus.raw.items.length} onClick={doSaveServerFile}>Save to server</button>
          {saveInfo && (
            <span className="ml-2">→ <a className="underline" href={saveInfo.url} target="_blank" rel="noreferrer">{saveInfo.name}</a> ({(saveInfo.size||0).toLocaleString()} B)</span>
          )}
        </div>
      )}
    </div>
  );
}

function StoredFiles({ fetchApi, reloadKey }) {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [sel, setSel] = React.useState({});
  const allSelected = React.useMemo(() => Object.values(sel).length > 0 && Object.values(sel).every(Boolean), [sel]);
  const toggleAll = (on) => {
    setSel(prev => {
      const map = {}; (items||[]).forEach(it => { map[it.name] = !!on; });
      return map;
    });
  };
  const load = async () => {
    setLoading(true);
    try { const r = await fetchApi('/api/smartsupp/files'); const j = await r.json(); setItems(r.ok && j?.ok ? (Array.isArray(j.items)? j.items: []) : []); }
    catch { setItems([]); }
    finally { setLoading(false); }
  };
  React.useEffect(()=>{ load(); }, [reloadKey]);

  const fmt = (s) => { try { return new Date(s).toLocaleString(); } catch { return String(s||''); } };
  const massDelete = async () => {
    const names = Object.entries(sel).filter(([,v])=>!!v).map(([k])=>k);
    if (!names.length) return;
    if (!confirm(`Delete ${names.length} file(s)?`)) return;
    try { const r = await fetchApi('/api/smartsupp/files/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ names }) }); const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`); await load(); setSel({}); } catch (e) { alert(String(e?.message||e)); }
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div className="flex items-center gap-2">
          <button className="text-xs px-3 py-1 rounded border" onClick={load} disabled={loading}>{loading?'Loading…':'Refresh'}</button>
          <button className="text-xs px-3 py-1 rounded border text-red-700 disabled:opacity-60" onClick={massDelete} disabled={!Object.values(sel).some(Boolean)}>Delete selected</button>
        </div>
      </div>
      <div className="border rounded overflow-auto">
        <table className="min-w-full text-[12px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1"><input type="checkbox" checked={!!allSelected} onChange={(e)=>toggleAll(e.target.checked)} /></th>
              <th className="text-left px-2 py-1">File</th>
              <th className="text-left px-2 py-1">Period</th>
              <th className="text-left px-2 py-1">Size</th>
              <th className="text-left px-2 py-1">Modified</th>
              <th className="text-left px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(items||[]).map(it => (
              <tr key={it.name} className="border-t">
                <td className="px-2 py-1"><input type="checkbox" checked={!!sel[it.name]} onChange={(e)=>setSel(m=>({ ...m, [it.name]: e.target.checked }))} /></td>
                <td className="px-2 py-1 font-mono break-all">{it.name}</td>
                <td className="px-2 py-1">{it.from || '-'} → {it.to || '-'}</td>
                <td className="px-2 py-1">{(it.size||0).toLocaleString()} B</td>
                <td className="px-2 py-1">{fmt(it.mtime)}</td>
                <td className="px-2 py-1">
                  <div className="flex flex-wrap gap-2">
                    <a className="px-2 py-0.5 border rounded" href={`${it.url}`} target="_blank" rel="noreferrer">View</a>
                    <a className="px-2 py-0.5 border rounded" href={`${it.url}?download=1`}>Download</a>
                    <button className="px-2 py-0.5 border rounded text-red-700" onClick={async()=>{ if (!confirm('Delete this file?')) return; try { const r = await fetchApi('/api/smartsupp/files/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ names: [it.name] }) }); const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`http_${r.status}`); await load(); } catch (e) { alert(String(e?.message||e)); } }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {(!items || !items.length) && (
              <tr><td className="px-3 py-3 text-gray-500" colSpan={6}>No files.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DownloadAssets({ fetchApi }) {
  const [files, setFiles] = React.useState([]);
  const [loadingFiles, setLoadingFiles] = React.useState(false);
  const [selected, setSelected] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState(null);

  const loadFiles = async () => {
    setLoadingFiles(true);
    try { const r = await fetchApi('/api/smartsupp/files'); const j = await r.json(); setFiles(r.ok && j?.ok ? (Array.isArray(j.items)? j.items: []) : []); }
    catch { setFiles([]); }
    finally { setLoadingFiles(false); }
  };
  React.useEffect(()=>{ loadFiles(); }, []);

  const start = async () => {
    if (!selected) { alert('Pick a JSON file first'); return; }
    setRunning(true); setResult(null);
    try {
      const r = await fetchApi('/api/smartsupp/assets/fetch', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: selected, only_new:true }) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setResult(j);
    } catch (e) { setResult({ ok:false, error:String(e?.message||e) }); }
    finally { setRunning(false); }
  };

  return (
    <div className="border rounded bg-white p-3 space-y-2">
      <div className="text-sm font-medium">Download assets</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
        <div>
          <div className="text-xs text-gray-600">JSON file</div>
          <select className="border rounded px-2 py-1 w-full text-sm" disabled={loadingFiles||running} value={selected} onChange={(e)=>setSelected(e.target.value)}>
            <option value="">Select…</option>
            {files.map(f => (<option key={f.name} value={f.name}>{f.name}</option>))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs px-3 py-1 rounded border" disabled={loadingFiles} onClick={loadFiles}>{loadingFiles?'Loading…':'Refresh'}</button>
          <button className="text-xs px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-60" disabled={!selected || running} onClick={start}>{running?'Running…':'Start'}</button>
        </div>
      </div>
      {result && (
        <div className="text-xs text-gray-700">
          {result.ok ? (
            <div>Downloaded {result.downloaded||0}, skipped {result.skipped||0}. Group: <span className="font-mono">{result.group}</span>. Total URLs: {result.total_urls||0}.</div>
          ) : (
            <div className="text-red-700">{result.error || 'Error'}</div>
          )}
        </div>
      )}
    </div>
  );
}
