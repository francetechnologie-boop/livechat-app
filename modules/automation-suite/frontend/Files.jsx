import React, { useEffect, useState } from "react";

export default function Files() {
  const [items, setItems] = useState([]);
  const [dir, setDir] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [edit, setEdit] = useState(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [cats, setCats] = useState([]);
  const [catFilter, setCatFilter] = useState("");
  // Selection + bulk edit state for app files
  const [selIds, setSelIds] = useState(new Set());
  const [bulkTitle, setBulkTitle] = useState("");
  const [bulkCats, setBulkCats] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [urlText, setUrlText] = useState("");
  const [fetchBusy, setFetchBusy] = useState(false);
  // PrestaShop section state
  const [prestaBase, setPrestaBase] = useState("");
  const [prestaKey, setPrestaKey] = useState("");
  const [prestaSaving, setPrestaSaving] = useState(false);
  const [prestaTesting, setPrestaTesting] = useState(false);
  const [prestaMsg, setPrestaMsg] = useState("");
  const [prestaUrl, setPrestaUrl] = useState("");
  const [dlDir, setDlDir] = useState("");
  const [dlItems, setDlItems] = useState([]);
  const [dlLoading, setDlLoading] = useState(false);
  // Remote listing from Presta module
  const [remoteItems, setRemoteItems] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteErr, setRemoteErr] = useState("");
  // Public download token for GET endpoints
  const [downloadToken, setDownloadToken] = useState("");
  const [downloadTokenSet, setDownloadTokenSet] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [latestBase, setLatestBase] = useState("");
  const [fileBase, setFileBase] = useState("");
  const [baseSaving, setBaseSaving] = useState(false);
  const listDir = "config";
  const [testFilename, setTestFilename] = useState("Test_for_liivechat_app .json");

  const loadCats = async () => {
    try { const r = await fetch('/api/automation-suite/file-categories', { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok) setCats(Array.isArray(j.items)? j.items: []); } catch {}
  };
  const load = async () => {
    setLoading(true); setError("");
    try {
      const qp = new URLSearchParams();
      if (includeArchived) qp.set('include_archived','1');
      if (catFilter) qp.set('category_id', catFilter);
      const r = await fetch(`/api/automation-suite/app-files${qp.toString()?`?${qp.toString()}`:''}`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(String(j?.message || j?.error || r.status));
      setItems(Array.isArray(j?.items) ? j.items : []);
      setDir(String(j?.dir || ''));
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadCats(); }, []);
  useEffect(() => { load(); }, [includeArchived, catFilter]);

  // Load Presta config + local downloads
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/company-chat/prestashop/config', { credentials:'include' });
        const j = await r.json();
        if (r.ok && j?.ok !== false) {
          setPrestaBase(String(j.base || ''));
          if (typeof j.api_key === 'string' && j.api_key !== '__set__') setPrestaKey(j.api_key);
        }
      } catch {}
      try {
        const r2 = await fetch('/api/prestashop/files/status', { credentials:'include' });
        const s = await r2.json();
        if (r2.ok && s?.ok) setDlDir(String(s.dir || ''));
      } catch {}
      try {
        const rTok = await fetch('/api/prestashop/files/token', { credentials:'include' });
        const jTok = await rTok.json();
        if (rTok.ok && jTok?.ok) {
          setDownloadTokenSet(!!jTok.set);
          // If backend returns token (admin route), use it and persist locally
          if (typeof jTok.token === 'string' && jTok.token) {
            setDownloadToken(jTok.token);
            try { localStorage.setItem('presta_dl_token', jTok.token); } catch {}
          } else {
            // Fallback to localStorage if available
            try { if (jTok.set && !downloadToken) { const t = localStorage.getItem('presta_dl_token'); if (t) setDownloadToken(t); } } catch {}
          }
          // Directory parameter is fixed to 'config' (UI removed)
        }
      } catch {}
      try {
        const rBase = await fetch('/api/prestashop/files/public-base', { credentials:'include' });
        const jBase = await rBase.json();
        if (rBase.ok && jBase?.ok) { setLatestBase(String(jBase.latest_base||'')); setFileBase(String(jBase.file_base||'')); }
      } catch {}
      await reloadLocalDownloads();
    })();
  }, []);

  const onPick = (e) => {
    setSel(Array.from(e.target.files || []));
  };
  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { try { resolve(String(reader.result).split(',').pop()); } catch (e) { reject(e); } };
    reader.onerror = () => reject(reader.error || new Error('read_error'));
    reader.readAsDataURL(file);
  });
  const onUpload = async () => {
    if (!sel.length) return;
    setBusy(true); setMsg("");
    try {
      const items = [];
      for (const f of sel) { const b64 = await toBase64(f); items.push({ filename: f.name, content_b64: b64 }); }
      const r = await fetch('/api/app-files', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ items }) });
      const j = await r.json();
      if (!r.ok) throw new Error(String(j?.message || j?.error || r.status));
      setMsg(`Uploaded ${Array.isArray(j?.items)? j.items.length : 0} file(s).`);
      setDir(String(j?.dir || dir));
      setSel([]);
      await load();
    } catch (e) { setMsg(`Failed: ${String(e?.message || e)}`); }
    finally { setBusy(false); }
  };

  const onFetchFromUrl = async () => {
    const url = String(urlText || "").trim();
    if (!url) return;
    setFetchBusy(true); setMsg("");
    try {
      const r = await fetch('/api/automation-suite/app-files/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      setMsg('Fetched file successfully.');
      setUrlText("");
      await load();
    } catch (e) { setMsg(`Failed: ${String(e?.message || e)}`); }
    finally { setFetchBusy(false); }
  };

  const savePrestaConfig = async () => {
    setPrestaSaving(true); setPrestaMsg("");
    try {
      const r = await fetch('/api/company-chat/prestashop/config', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ base: prestaBase, api_key: prestaKey }) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      setPrestaMsg('Configuration enregistrée.');
    } catch (e) { setPrestaMsg(`Erreur: ${String(e?.message || e)}`); }
    finally { setPrestaSaving(false); }
  };

  const testPrestaConfig = async () => {
    setPrestaTesting(true); setPrestaMsg("");
    try {
      const r = await fetch('/api/company-chat/prestashop/test', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ base: prestaBase, api_key: prestaKey }) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      setPrestaMsg(`Test OK (${j.via || 'root'} in ${j.ms}ms)`);
    } catch (e) { setPrestaMsg(`Test échoué: ${String(e?.message || e)}`); }
    finally { setPrestaTesting(false); }
  };

  const reloadLocalDownloads = async () => {
    setDlLoading(true);
    try {
      const r = await fetch('/api/prestashop/files', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) { setDlDir(String(j.dir || dlDir)); setDlItems(Array.isArray(j.items)? j.items: []); }
    } catch {}
    finally { setDlLoading(false); }
  };

  const onFetchPrestaUrl = async () => {
    const u = String(prestaUrl || '').trim(); if (!u) return;
    setPrestaMsg('');
    try {
      const r = await fetch('/api/prestashop/files/fetch', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ url: u }) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      setPrestaMsg(`Téléchargé: ${(j.results||[]).map(x=>x.name).join(', ')}`);
      setPrestaUrl('');
      await reloadLocalDownloads();
    } catch (e) { setPrestaMsg(`Erreur: ${String(e?.message || e)}`); }
  };

  const saveDownloadToken = async () => {
    const t = String(downloadToken || '').trim();
    if (!t) return alert('Please enter a token value.');
    setTokenSaving(true);
    try {
      const r = await fetch('/api/prestashop/files/token', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ token: t }) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      setDownloadTokenSet(true);
      try { localStorage.setItem('presta_dl_token', t); } catch {}
    } catch (e) { alert(String(e?.message || e)); }
    finally { setTokenSaving(false); }
  };

  const saveDownloadBases = async () => {
    setBaseSaving(true);
    try {
      const r = await fetch('/api/prestashop/files/public-base', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ latest_base: latestBase, file_base: fileBase }) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
    } catch (e) { alert(String(e?.message || e)); }
    finally { setBaseSaving(false); }
  };

  const onTestJson = async (id) => {
    if (!id) return;
    try {
      setMsg("");
      const r = await fetch(`/api/automation-suite/app-files/${encodeURIComponent(id)}/validate-json?max_bytes=2000000`, { credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      if (j.valid) {
        const meta = j.type === 'array' ? `array length=${j.length}` : (j.type === 'object' ? `object keys=${j.keys}` : j.type);
        setMsg(`JSON OK (${meta})`);
      } else {
        if (j.error === 'too_large') setMsg(`File too large to validate (${j.size} bytes > limit ${j.limit})`);
        else {
          const loc = (j.line && j.column) ? ` at ${j.line}:${j.column}` : '';
          setMsg(`Invalid JSON${loc}: ${String(j.error || 'parse_error')}`);
        }
      }
    } catch (e) {
      setMsg(`JSON test failed: ${String(e?.message || e)}`);
    }
  };

  const testLatestBaseUrl = () => {
    try {
      const origin = (typeof window !== 'undefined' && window.location.origin) ? window.location.origin : '';
      const base = (latestBase && latestBase.trim()) || origin;
      const tok = (downloadToken || '').trim();
      const clean = (s) => String(s || '').replace(/\/$/, '');
      // Support either a pure base (https://.../api) or a full URL already containing query params
      let url = '';
      try {
        let candidate = base;
        // If not absolute, try to make it absolute using origin
        try { new URL(candidate); } catch { candidate = `${clean(origin)}/${String(candidate||'').replace(/^\//,'')}`; }
        const u = new URL(candidate);
        const p = u.searchParams;
        // Ensure/override expected params
        p.set('action', 'download_list');
        p.set('dir', (listDir || 'config'));
        if (tok) p.set('token', tok);
        u.search = p.toString();
        url = u.toString();
      } catch {
        const params = new URLSearchParams();
        params.set('action', 'download_list');
        params.set('dir', listDir || 'config');
        if (tok) params.set('token', tok);
        url = `${clean(base)}?${params.toString()}`;
      }
      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    } catch {}
  };

  const buildRemoteFileUrl = (name) => {
    try {
      const tok = (downloadToken || '').trim();
      const base = (fileBase && fileBase.trim()) || (latestBase && latestBase.trim()) || '';
      if (!base) return '';
      let url = '';
      try {
        const u = new URL(base);
        const p = u.searchParams;
        // Ensure expected parameters for Presta module
        const currentAction = (p.get('action') || '').toLowerCase();
        if (!currentAction) p.set('action', 'download_file');
        // Prefer "download_file" if action is not specified
        if (currentAction && currentAction !== 'download_file' && currentAction !== 'download') {
          // leave custom action as-is
        }
        if (!p.get('dir')) p.set('dir', 'config');
        // Use fn parameter (not file) and replace placeholder if present
        const existingFn = p.get('fn') || '';
        if (existingFn && /\{FILENAME\}/i.test(existingFn)) {
          p.set('fn', name);
        } else {
          p.set('fn', name);
        }
        // Remove legacy/file param if exists
        if (p.has('file')) p.delete('file');
        if (tok) p.set('token', tok);
        u.search = p.toString();
        url = u.toString();
      } catch {
        return '';
      }
      return url;
    } catch { return ''; }
  };

  const loadRemoteList = async () => {
    setRemoteLoading(true); setRemoteErr("");
    try {
      const body = { base: latestBase, dir: 'config', token: downloadToken };
      const r = await fetch('/api/prestashop/files/list-remote', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      const arr = Array.isArray(j.items) ? j.items : [];
      setRemoteItems(arr.map(it => ({ name: it.name, size: it.size, mtime: it.mtime, url: it.url })));
    } catch (e) { setRemoteErr(String(e?.message || e)); }
    finally { setRemoteLoading(false); }
  };

  const testSpecificFileUrl = () => {
    const nm = String(testFilename || '').trim();
    if (!nm) return;
    const url = buildRemoteFileUrl(nm);
    if (!url) { alert('Missing Base URL (Download specific file) or token'); return; }
    try { if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
  };

  useEffect(() => {
    if (latestBase && downloadToken) {
      loadRemoteList();
    }
  }, [latestBase, downloadToken]);

  const uploadFromRemote = async (item) => {
    // Always construct a canonical download URL from base + name to avoid legacy 'file=' param
    const url = buildRemoteFileUrl(item?.name || '') || item?.url;
    if (!url) return alert('Remote URL not available');
    try {
      setMsg('Uploading from remote...');
      const r = await fetch('/api/app-files/fetch', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ url }) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      setMsg(`Uploaded: ${(j?.item?.name || '') || 'file'}`);
      await load(); // refresh app-files list
      // After successful upload, delete remote file to clear the list
      try {
        const del = await fetch('/api/prestashop/files/delete-remote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ base: fileBase || latestBase, dir: 'config', token: downloadToken, filename: item?.name || '' }),
        });
        // Remove item locally if deletion accepted
        if (del.ok) {
          setRemoteItems(prev => (prev || []).filter(x => x.name !== item?.name));
        }
      } catch {}
    } catch (e) { alert(String(e?.message || e)); }
  };

  const beginEdit = (it) => {
    const sel = new Set((Array.isArray(it.categories)? it.categories: []).map(c=> String(c.id)));
    setEdit({ id: it.id, title: it.title || '', description: it.description || '', archived: !!it.archived, category_ids: Array.from(sel) });
  };
  const onToggleSelect = (id, checked) => {
    setSelIds(prev => {
      const s = new Set(Array.from(prev));
      if (checked) s.add(id); else s.delete(id);
      return s;
    });
  };
  const onToggleSelectAll = (checked) => {
    if (checked) {
      const s = new Set((items||[]).map(f => f.id).filter(Boolean));
      setSelIds(s);
    } else setSelIds(new Set());
  };
  const onDeleteOne = async (id) => {
    if (!id) return; if (!confirm('Delete this file from app folder?')) return;
    try {
      const r = await fetch(`/api/app-files/${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      setItems(prev => prev.filter(x => x.id !== id));
      setSelIds(prev => { const s=new Set(Array.from(prev)); s.delete(id); return s; });
    } catch (e) { alert(String(e?.message || e)); }
  };
  const onDeleteSelected = async () => {
    if (!selIds.size) return; if (!confirm(`Delete ${selIds.size} selected file(s)?`)) return;
    setBulkBusy(true);
    try {
      for (const id of selIds) {
        try { await fetch(`/api/app-files/${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include' }); } catch {}
      }
      // Refresh list
      await load();
      setSelIds(new Set());
    } catch (e) { alert(String(e?.message || e)); }
    finally { setBulkBusy(false); }
  };
  const onApplyBulk = async () => {
    if (!selIds.size) return alert('Select at least one file.');
    const body = {};
    if (String(bulkTitle || '').length) body.title = bulkTitle;
    if (Array.isArray(bulkCats)) body.category_ids = bulkCats;
    if (!Object.keys(body).length) return alert('Nothing to apply.');
    setBulkBusy(true);
    try {
      for (const id of selIds) {
        try {
          await fetch(`/api/app-files/${encodeURIComponent(id)}`, { method:'PATCH', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
        } catch {}
      }
      await load();
    } catch (e) { alert(String(e?.message || e)); }
    finally { setBulkBusy(false); }
  };
  const cancelEdit = () => setEdit(null);
  const saveEdit = async () => {
    if (!edit || !edit.id) return;
    setSaveBusy(true);
    try {
      const body = { title: (edit.title||'') || null, description: (edit.description||'') || null, archived: !!edit.archived, category_ids: Array.isArray(edit.category_ids)? edit.category_ids: [] };
      const r = await fetch(`/api/app-files/${encodeURIComponent(edit.id)}`, { method:'PATCH', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || r.status);
      setItems(prev => prev.map(x => (x.id === edit.id ? { ...x, title: body.title || '', description: body.description || '', archived: body.archived, categories: j?.item?.categories || x.categories } : x)));
      setEdit(null);
    } catch (e) { alert(String(e?.message || e)); }
    finally { setSaveBusy(false); }
  };

  const formatBytes = (b) => {
    const n = Number(b || 0); if (!isFinite(n)) return ''; if (n < 1024) return `${n} B`; const u=['KB','MB','GB','TB']; let v=n; let i=-1; do { v/=1024; i++; } while (v>=1024 && i<u.length-1); return `${v.toFixed(1)} ${u[i]}`;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-4 border-b bg-white flex items-center justify-between">
        <div>
          <div className="font-semibold">Files</div>
          <div className="text-xs text-gray-500">Upload and manage files stored in the app folder.</div>
          {dir ? (
            <div className="mt-1 text-[11px] text-gray-600">Folder: <code className="font-mono">{dir}</code></div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <input type="file" multiple onChange={onPick} />
          <button onClick={onUpload} disabled={busy || !sel.length} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-50">{busy? 'Uploading…':'Upload'}</button>
          <div className="hidden md:flex items-center gap-2">
            <input
              type="text"
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
              placeholder="Import from URL (http/https)"
              className="w-64 border rounded px-2 py-1 text-sm"
            />
            <button onClick={onFetchFromUrl} disabled={fetchBusy || !urlText.trim()} className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:opacity-50">{fetchBusy? 'Fetching.':'Fetch'}</button>
          </div>
          <button onClick={load} className="px-3 py-1.5 rounded border text-sm">Refresh</button>
          <label className="ml-2 inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={includeArchived} onChange={(e)=>setIncludeArchived(e.target.checked)} /> Show archived</label>
        </div>
      </div>
      {/* PrestaShop section */}
      {false && (<div className="border-b bg-white">
        {/* D'abord la liste des fichiers téléchargés */}
        <div className="px-4 pt-4 pb-2">
          <div className="text-sm font-medium mb-2">Fichiers téléchargés</div>
          {!!dlDir && (<div className="mb-2 text-[11px] text-gray-600">Dossier de destination: <code className="font-mono">{dlDir}</code></div>)}
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Nom</th>
                  <th className="text-left px-3 py-2">Taille</th>
                  <th className="text-left px-3 py-2">Modifié</th>
                  <th className="text-left px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(dlItems || []).map((f) => (
                  <tr key={f.name} className="border-b">
                    <td className="px-3 py-2 text-xs font-mono">{f.name}</td>
                    <td className="px-3 py-2 text-xs">{formatBytes(f.size)}</td>
                    <td className="px-3 py-2 text-xs">{new Date(f.mtime).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs">
                      <a className="text-indigo-700 underline" href={`/api/prestashop/files/local/${encodeURIComponent(f.name)}/download`} target="_blank" rel="noopener noreferrer">Télécharger</a>
                    </td>
                  </tr>
                ))}
                {(!dlItems || !dlItems.length) && !dlLoading && (
                  <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={4}>Aucun fichier téléchargé.</td></tr>
                )}
                {dlLoading && (
                  <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={4}>Chargement…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        {/* Ensuite la configuration et le téléchargement depuis Presta */}
        <div className="p-4 border-t">
          <div className="font-semibold">Obtenir les fichiers de PrestaShop</div>
          <div className="text-xs text-gray-500">Configurer la base et la clé API, puis télécharger un fichier (URL Presta protégée).</div>
          {/* Presta base/key and manual URL download removed */}
        </div>
      </div>
      )}{!!msg && <div className="px-4 py-2 text-xs text-gray-600">{msg}</div>}
      {edit && (
        <div className="px-4 py-3 border-b bg-white">
          <div className="text-sm font-medium mb-2">Edit file</div>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Title</label>
              <input value={edit.title} onChange={(e)=>setEdit({...edit, title:e.target.value})} className="w-full border rounded px-2 py-1" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Archived</label>
              <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={!!edit.archived} onChange={(e)=>setEdit({...edit, archived:e.target.checked})} /> Archived</label>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Categories</label>
              <div className="flex flex-wrap gap-3 text-xs">
                {(cats||[]).map(c => (
                  <label key={c.id} className="inline-flex items-center gap-1">
                    <input type="checkbox" checked={Array.isArray(edit.category_ids) && edit.category_ids.includes(c.id)} onChange={(e)=>{
                      const set = new Set(Array.isArray(edit.category_ids)? edit.category_ids: []);
                      if (e.target.checked) set.add(c.id); else set.delete(c.id);
                      setEdit({...edit, category_ids: Array.from(set)});
                    }} /> {c.name}
                  </label>
                ))}
                {(!cats || !cats.length) && <span className="text-gray-500">No categories yet.</span>}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <textarea rows={2} value={edit.description} onChange={(e)=>setEdit({...edit, description:e.target.value})} className="w-full border rounded px-2 py-1" />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={saveEdit} disabled={saveBusy} className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:opacity-50">{saveBusy? 'Saving…':'Save'}</button>
            <button onClick={cancelEdit} className="px-3 py-1.5 rounded border text-sm">Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="px-4 py-2 text-sm text-red-600">{String(error)}</div>}
      {/* Section 2: List files in app folder */}
      <div className="border-b bg-white">
        <div className="p-4">
          <div className="font-semibold">Files in app folder</div>
          {dir ? (
            <div className="mt-1 text-[11px] text-gray-600">Folder: <code className="font-mono">{dir}</code></div>
          ) : null}
          <div className="mt-3">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title (apply to selected)</label>
                <input value={bulkTitle} onChange={(e)=>setBulkTitle(e.target.value)} className="border rounded px-2 py-1 text-sm" placeholder="New title" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Categories</label>
                <div className="flex flex-wrap gap-2 max-w-[480px]">
                  {(cats||[]).map(c => (
                    <label key={c.id} className="inline-flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={Array.isArray(bulkCats) && bulkCats.includes(c.id)} onChange={(e)=>{
                        const set = new Set(Array.isArray(bulkCats)? bulkCats: []);
                        if (e.target.checked) set.add(c.id); else set.delete(c.id);
                        setBulkCats(Array.from(set));
                      }} /> {c.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={onApplyBulk} disabled={bulkBusy || !selIds.size} className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:opacity-50">{bulkBusy? 'Applying...':'Apply to selected'}</button>
                <button onClick={onDeleteSelected} disabled={bulkBusy || !selIds.size} className="px-3 py-1.5 rounded border text-sm disabled:opacity-50">Delete selected</button>
              </div>
            </div>
            <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b sticky top-0">
            <tr>
              <th className="text-left px-3 py-2"><input type="checkbox" onChange={(e)=>onToggleSelectAll(e.target.checked)} checked={!!items.length && selIds.size === (items||[]).filter(f=>f.id).length} /></th>
              <th className="text-left px-3 py-2">Title</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Size</th>
              <th className="text-left px-3 py-2">Modified</th>
              <th className="text-left px-3 py-2">Download</th>
              <th className="text-left px-3 py-2">Categories</th>
              <th className="text-left px-3 py-2">Archived</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map((f) => (
              <tr key={f.id || f.name} className="border-b">
                <td className="px-3 py-2 text-xs"><input type="checkbox" checked={selIds.has(f.id)} onChange={(e)=>onToggleSelect(f.id, e.target.checked)} /></td>
                <td className="px-3 py-2 text-xs">{f.title || ''}</td>
                <td className="px-3 py-2 text-xs font-mono">{f.name}</td>
                <td className="px-3 py-2 text-xs">{formatBytes(f.size)}</td>
                <td className="px-3 py-2 text-xs">{new Date(f.mtime).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs">
                  {f.id ? (
                    <a className="text-indigo-700 underline" href={`/api/app-files/${encodeURIComponent(f.id)}/download`} target="_blank" rel="noopener noreferrer">Download</a>
                  ) : (
                    <span className="text-gray-400">N/A</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {(Array.isArray(f.categories)? f.categories: []).map(c => (
                      <span key={c.id} className="px-1 py-0.5 text-[11px] rounded bg-gray-100 border text-gray-700">{c.name}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">{f.archived ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2 text-xs flex items-center gap-2">
                  <button className="px-2 py-0.5 rounded border" onClick={() => beginEdit(f)}>Edit</button>
                  {f.id && (
                    <>
                      <button className="px-2 py-0.5 rounded border" onClick={() => onTestJson(f.id)}>Test JSON</button>
                      <button className="px-2 py-0.5 rounded border text-red-600" onClick={() => onDeleteOne(f.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(!items || !items.length) && !loading && (
              <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={7}>No files yet.</td></tr>
            )}
            {loading && (
              <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={7}>Loading…</td></tr>
            )}
          </tbody>
        </table>
          </div>
        </div>
      </div>

      {/* Section 3: Fichiers téléchargés (Remote Presta list) */}
      <div className="border-b bg-white">
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Fichiers téléchargés (depuis Base URL)</div>
            <div className="flex items-center gap-2">
              <button onClick={loadRemoteList} className="px-3 py-1.5 rounded border text-sm">Rafraîchir</button>
            </div>
          </div>
          {remoteErr && (<div className="mt-2 text-xs text-red-600">{remoteErr}</div>)}
          <div className="mt-2 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Nom</th>
                  <th className="text-left px-3 py-2">Taille</th>
                  <th className="text-left px-3 py-2">Modifié</th>
                  <th className="text-left px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(remoteItems || []).map((f) => (
                  <tr key={f.name} className="border-b">
                    <td className="px-3 py-2 text-xs font-mono">{f.name}</td>
                    <td className="px-3 py-2 text-xs">{f.size != null ? formatBytes(f.size) : '-'}</td>
                    <td className="px-3 py-2 text-xs">{f.mtime ? new Date(f.mtime).toLocaleString() : '-'}</td>
                    <td className="px-3 py-2 text-xs flex items-center gap-2">
                      {f.url && (
                        <a className="text-indigo-700 underline" href={f.url} target="_blank" rel="noopener noreferrer">Ouvrir</a>
                      )}
                      <button className="px-2 py-0.5 rounded border" onClick={() => uploadFromRemote(f)}>Upload</button>
                    </td>
                  </tr>
                ))}
                {(!remoteItems || !remoteItems.length) && !remoteLoading && (
                  <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={4}>Aucun fichier.</td></tr>
                )}
                {remoteLoading && (
                  <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={4}>Chargement…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Section 4: API PrestaShop settings */}
      <div className="border-b bg-white">
        <div className="p-4">
          <div className="font-semibold">API PrestaShop settings</div>
          <div className="text-xs text-gray-500">Configurer la base et la clé API, puis télécharger un fichier (URL Presta protégée).</div>
          {/* Public GET download endpoints + token */}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">PRESTA_LIVECHAT_API_TOKEN</label>
              <div className="flex items-center gap-2">
                <input value={downloadToken} onChange={(e)=>setDownloadToken(e.target.value)} placeholder="Enter or rotate token" className="w-full border rounded px-2 py-1 font-mono" />
                <button onClick={saveDownloadToken} disabled={tokenSaving || !downloadToken.trim()} className="px-3 py-1.5 rounded border text-sm">{tokenSaving ? 'Saving…' : (downloadTokenSet ? 'Update' : 'Save')}</button>
              </div>
              <div className="mt-1 text-[11px] text-gray-600">{downloadTokenSet ? 'Token is set.' : 'No token set yet.'} You can pass it via query (?token=) or Authorization: Bearer.</div>
            </div>
            <div className="md:col-span-1"></div>
            <div className="md:col-span-3 grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Base URL (get file list)</label>
                  <input value={latestBase} onChange={(e)=>setLatestBase(e.target.value)} placeholder="https://your-domain" className="w-full border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Base URL (Download specific file)</label>
                  <input value={fileBase} onChange={(e)=>setFileBase(e.target.value)} placeholder="https://your-domain" className="w-full border rounded px-2 py-1" />
                </div>
                <div className="flex items-end gap-2">
                  <button onClick={saveDownloadBases} disabled={baseSaving} className="px-3 py-1.5 rounded border text-sm">{baseSaving ? 'Saving…' : 'Save Bases'}</button>
                  <button onClick={testLatestBaseUrl} className="px-3 py-1.5 rounded border text-sm">Test List</button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3 mt-2">
                <div className="md:col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Test filename</label>
                  <input value={testFilename} onChange={(e)=>setTestFilename(e.target.value)} placeholder="Test_for_liivechat_app.json" className="w-full border rounded px-2 py-1 font-mono" />
                </div>
                <div className="flex items-end">
                  <button onClick={testSpecificFileUrl} className="px-3 py-1.5 rounded border text-sm">Test File</button>
                </div>
              </div>
              {/* Directory (dir parameter) removed from UI; fixed to 'config' */}
              {/* GET URL previews removed */}
            </div>
          </div>
          <div className="hidden">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Base URL PrestaShop</label>
              <input value={prestaBase} onChange={(e)=>setPrestaBase(e.target.value)} placeholder="https://shop.example.com" className="w-full border rounded px-2 py-1" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key (ws_key)</label>
              <input value={prestaKey} onChange={(e)=>setPrestaKey(e.target.value)} className="w-full border rounded px-2 py-1 font-mono" />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={savePrestaConfig} disabled={prestaSaving} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-50">{prestaSaving? 'Enregistrement.':'Enregistrer'}</button>
              <button onClick={testPrestaConfig} disabled={prestaTesting} className="px-3 py-1.5 rounded border text-sm">{prestaTesting? 'Test…':'Tester'}</button>
            </div>
          </div>
          <div className="hidden">
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">URL de fichier à télécharger (relative ou absolue)</label>
              <input value={prestaUrl} onChange={(e)=>setPrestaUrl(e.target.value)} placeholder="ex: /api/images/products/1/large_default" className="w-full border rounded px-2 py-1" />
            </div>
            <div className="flex items-end">
              <button onClick={onFetchPrestaUrl} className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm">Télécharger</button>
            </div>
          </div>
          {false && !!prestaMsg && (<div className="mt-2 text-xs text-gray-700">{prestaMsg}</div>)}
        </div>
      </div>
    </div>
    </div>
  );
}
