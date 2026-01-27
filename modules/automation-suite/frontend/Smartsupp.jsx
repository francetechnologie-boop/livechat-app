import React, { useMemo, useState } from "react";

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-600">{label}</div>
      <div>{children}</div>
      {hint ? <div className="text-[11px] text-gray-500">{hint}</div> : null}
    </div>
  );
}

export default function Smartsupp() {
  const [token, setToken] = useState("");
  // Removed "Fetch latest" and local listing; keep only range download
  const [filesReload, setFilesReload] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [fetchStatus, setFetchStatus] = useState({ ok: null, name: '', url: '', size: 0, error: '' });

  // Saved token state (DB settings)
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedValue, setSavedValue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const haveBackendToken = useMemo(() => {
    return !!(savedValue && String(savedValue).trim());
  }, [savedValue]);

  const loadSaved = async () => {
    setSavedLoading(true); setSavedMsg("");
    try {
      const r = await fetch('/api/admin/smartsupp/token', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setSavedValue(j.value || null);
      else setSavedValue(null);
    } catch { setSavedValue(null); }
    finally { setSavedLoading(false); }
  };
  React.useEffect(()=>{ loadSaved(); }, []);

  // Removed: fetchLatest/list UI and helpers

  return (
    <div className="h-full w-full p-4 space-y-3 overflow-auto">
      <div className="text-sm text-gray-600">Download conversations from Smartsupp REST API using an access token.</div>
      <div className="border rounded bg-white p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs">Saved token (server): {savedLoading ? '…' : haveBackendToken ? <span className="text-green-700">configured</span> : <span className="text-gray-500">not set</span>}</div>
          <button className="text-xs px-2 py-1 rounded border" onClick={loadSaved} disabled={savedLoading}>Refresh</button>
          <div className="grow" />
          <input type="password" className="border rounded px-2 py-1 text-sm min-w-[220px]" placeholder="New token" value={token} onChange={(e)=>setToken(e.target.value)} />
          <button className="text-xs px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-60" disabled={saving || !token.trim()} onClick={async()=>{
            setSaving(true); setSavedMsg('');
            try {
              const r = await fetch('/api/admin/smartsupp/token', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ token: token.trim() }) });
              const j = await r.json();
              if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
              setSavedValue(j.value || null); setSavedMsg('Saved.');
            } catch (e) { setSavedMsg(String(e?.message||e)); }
            finally { setSaving(false); }
          }}>Save token</button>
          <button className="text-xs px-3 py-1 rounded border disabled:opacity-60" disabled={saving || !haveBackendToken} onClick={async()=>{
            setSaving(true); setSavedMsg('');
            try {
              const r = await fetch('/api/admin/smartsupp/token/disable', { method:'POST', credentials:'include' });
              const j = await r.json();
              if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
              setSavedValue(null); setSavedMsg('Disabled.');
            } catch (e) { setSavedMsg(String(e?.message||e)); }
            finally { setSaving(false); }
          }}>Disable</button>
        </div>
        {savedMsg && <div className="text-[12px] mt-1 text-gray-600">{savedMsg}</div>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Access token" hint={!haveBackendToken ? 'You can save the token in server settings; this field overrides if filled.' : 'Using saved server token unless overridden here.'}>
          <input type="password" className="w-full border rounded px-2 py-1 text-sm" value={token} onChange={(e)=>setToken(e.target.value)} placeholder="Bearer token" />
        </Field>
        {/* (Fetch latest removed) */}
      </div>

      {/* Download by date range */}
      <div className="border rounded bg-white p-3 space-y-2">
        <div className="text-sm font-medium">Download range</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Field label="From (YYYY-MM-DD)" hint="Inclusive">
            <input disabled={fetching} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" title="YYYY-MM-DD" className="w-full border rounded px-2 py-1 text-sm" id="sm_from" />
          </Field>
          <Field label="To (YYYY-MM-DD)" hint="Inclusive">
            <input disabled={fetching} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" title="YYYY-MM-DD" className="w-full border rounded px-2 py-1 text-sm" id="sm_to" />
          </Field>
          <Field label="Page size" hint="Per request (default 10000)">
            <input disabled={fetching} type="number" min={1} max={10000} className="w-full border rounded px-2 py-1 text-sm" id="sm_size" defaultValue={10000} />
          </Field>
          <div className="flex items-center gap-2">
            {(() => {
              const fmt = (d) => {
                try { const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); const da=String(d.getUTCDate()).padStart(2,'0'); return `${y}-${m}-${da}`; } catch { return ''; }
              };
              const readDate = (id, end=false) => {
                const el = document.getElementById(id);
                if (!el) return '';
                const vad = el.valueAsDate;
                if (vad instanceof Date && !isNaN(vad)) {
                  // valueAsDate is local time; convert to UTC midnight for date‑only
                  const y = vad.getFullYear(); const m = vad.getMonth(); const da = vad.getDate();
                  const utc = new Date(Date.UTC(y, m, da, end?23:0, end?59:0, end?59:0, end?999:0));
                  return fmt(utc);
                }
                const v = (el.value || '').trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
                const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(v);
                if (m) {
                  const dd = parseInt(m[1],10), MM = parseInt(m[2],10), yyyy=parseInt(m[3],10);
                  if (yyyy>1900 && MM>=1 && MM<=12 && dd>=1 && dd<=31) {
                    return `${yyyy}-${String(MM).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
                  }
                }
                // Fallback: try Date parse
                try { const d=new Date(v); if (!isNaN(d.getTime())) return fmt(d); } catch {}
                return '';
              };
              const launch = async () => {
                const from = readDate('sm_from', false);
                const to = readDate('sm_to', true);
                const sz = Number(document.getElementById('sm_size')?.value || 10000) || 10000;
                if (!from || !to) { alert('Please select From and To dates (YYYY-MM-DD)'); return; }
                try {
                  setFetchStatus({ ok:null, name:'', url:'', size:0, error:'' });
                  setFetching(true);
                  const body = { from, to, size: Math.max(1, Math.min(sz, 10000)) };
                  if (token && token.trim()) body.token = token.trim();
                  const r = await fetch('/api/smartsupp/range/fetch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                  const j = await r.json().catch(()=>({}));
                  if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
                  setFetchStatus({ ok:true, name: j.file?.name || '', url: j.file?.url || '', size: j.file?.size||0, error:'' });
                  setFilesReload((n)=>n+1);
                } catch (e) {
                  setFetchStatus({ ok:false, name:'', url:'', size:0, error: String(e?.message||e) });
                } finally {
                  setFetching(false);
                }
              };
              return (
                <>
                  <button className="text-xs px-3 py-1 rounded border disabled:opacity-60" onClick={launch} disabled={fetching}>{fetching?'Running…':'Fetch & Store JSON'}</button>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {(fetchStatus.ok === null && fetching) && (
        <div className="text-[12px] text-gray-600">Running… This can take a while depending on range.</div>
      )}
      {(fetchStatus.ok === true) && (
        <div className="text-[12px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 inline-flex items-center gap-2">
          <span>Saved:</span>
          <a className="underline" href={fetchStatus.url} target="_blank" rel="noreferrer">{fetchStatus.name || 'file'}</a>
          <span>({(fetchStatus.size||0).toLocaleString()} bytes)</span>
        </div>
      )}
      {(fetchStatus.ok === false) && (
        <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{fetchStatus.error || 'Fetch failed'}</div>
      )}

      {/* Stored files list */}
      <div className="border rounded bg-white p-3 space-y-2">
        <div className="text-sm font-medium">Stored files</div>
        <FilesList reloadToken={filesReload} />
      </div>

      {/* Download files from a stored JSON */}
      <DownloadAssets />

      {/* Latest fetch and inline preview removed */}
    </div>
  );
}

function FilesList({ reloadToken }) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fmt = (d) => { try { return new Date(d).toLocaleString(); } catch { return ''; } };
  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const r = await fetch(`/api/smartsupp/files?${params.toString()}`, { credentials:'include' });
      const j = await r.json();
      setItems(r.ok && j?.ok ? (Array.isArray(j.items) ? j.items : []) : []);
    } catch { setItems([]); }
    finally { setLoading(false); }
  };
  React.useEffect(()=>{ load(); }, [reloadToken]);
  const allSelected = useMemo(() => {
    const ids = (items||[]).map(x=>x.name);
    return ids.length && ids.every(id => !!sel[id]);
  }, [items, sel]);
  const toggleAll = (checked) => {
    const map = {}; (items||[]).forEach(x => map[x.name] = !!checked);
    setSel(map);
  };
  const massDelete = async () => {
    const names = Object.entries(sel).filter(([,v])=>!!v).map(([k])=>k);
    if (!names.length) return;
    if (!confirm(`Delete ${names.length} file(s)?`)) return;
    try {
      const r = await fetch('/api/smartsupp/files/delete', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ names }) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      await load(); setSel({});
    } catch (e) { alert(String(e?.message||e)); }
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div>
          <div className="text-xs text-gray-600">From (YYYY-MM-DD)</div>
          <input className="border rounded px-2 py-1 text-sm w-full" placeholder="YYYY-MM-DD" value={from} onChange={(e)=>setFrom(e.target.value)} />
        </div>
        <div>
          <div className="text-xs text-gray-600">To (YYYY-MM-DD)</div>
          <input className="border rounded px-2 py-1 text-sm w-full" placeholder="YYYY-MM-DD" value={to} onChange={(e)=>setTo(e.target.value)} />
        </div>
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
                    <button className="px-2 py-0.5 border rounded text-red-700" onClick={async()=>{ if (!confirm('Delete this file?')) return; try { const r = await fetch('/api/smartsupp/files/delete', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ names: [it.name] }) }); const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`http_${r.status}`); await load(); } catch (e) { alert(String(e?.message||e)); } }}>Delete</button>
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

// Download assets (images/files) referenced by a stored Smartsupp JSON
function DownloadAssets() {
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selected, setSelected] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const loadFiles = async () => {
    setLoadingFiles(true);
    try {
      const r = await fetch('/api/smartsupp/files', { credentials:'include' });
      const j = await r.json();
      setFiles(r.ok && j?.ok ? (Array.isArray(j.items)? j.items: []) : []);
    } catch { setFiles([]); }
    finally { setLoadingFiles(false); }
  };
  React.useEffect(()=>{ loadFiles(); }, []);

  const start = async () => {
    if (!selected) { alert('Pick a JSON file first'); return; }
    setRunning(true); setResult(null);
    try {
      const r = await fetch('/api/smartsupp/assets/fetch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ name: selected, only_new:true }) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setResult(j);
    } catch (e) { setResult({ ok:false, error:String(e?.message||e) }); }
    finally { setRunning(false); }
  };

  return (
    <div className="border rounded bg-white p-3 space-y-2">
      <div className="text-sm font-medium">Download files (images) from a stored JSON</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
        <div>
          <div className="text-xs text-gray-600 mb-1">JSON file</div>
          <select className="border rounded px-2 py-1 text-sm w-full" value={selected} onChange={(e)=>setSelected(e.target.value)} disabled={loadingFiles || running}>
            <option value="">Select…</option>
            {(files||[]).map(f => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs px-3 py-1 rounded border disabled:opacity-60" onClick={loadFiles} disabled={loadingFiles || running}>{loadingFiles?'Refreshing…':'Refresh list'}</button>
          <button className="text-xs px-3 py-1 rounded border disabled:opacity-60" onClick={start} disabled={!selected || running}>{running?'Running…':'Start'}</button>
        </div>
      </div>
      {result && result.ok && (
        <div className="text-[12px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
          Downloaded {result.downloaded} file(s), skipped {result.skipped}, errors {result.errors}. Total URLs scanned {result.total_urls}.
        </div>
      )}
      {result && result.ok===false && (
        <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{result.error || 'Failed'}</div>
      )}
      {result && Array.isArray(result.items) && result.items.length > 0 && (
        <div className="border rounded overflow-auto">
          <table className="min-w-full text-[12px]">
            <thead className="bg-gray-50"><tr>
              <th className="text-left px-2 py-1">URL</th>
              <th className="text-left px-2 py-1">File</th>
              <th className="text-left px-2 py-1">Size</th>
              <th className="text-left px-2 py-1">Error</th>
            </tr></thead>
            <tbody>
              {result.items.slice(0,200).map((it,idx)=> (
                <tr key={idx} className="border-t">
                  <td className="px-2 py-1 break-all"><a className="underline" href={it.url} target="_blank" rel="noreferrer">{it.url}</a></td>
                  <td className="px-2 py-1 break-all">{it.file ? <a className="underline" href={it.file} target="_blank" rel="noreferrer">{it.file}</a> : '-'}</td>
                  <td className="px-2 py-1">{it.size ? it.size.toLocaleString() : ''}</td>
                  <td className="px-2 py-1 text-red-700">{it.error || ''}</td>
                </tr>
              ))}
              {result.items.length > 200 && (
                <tr><td className="px-2 py-1 text-gray-500" colSpan={4}>Showing first 200 results…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
