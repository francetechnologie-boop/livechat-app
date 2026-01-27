import React, { useEffect, useMemo, useState } from 'react';

function Field({ label, children, hint }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-600">{label}</div>
      <div>{children}</div>
      {hint ? <div className="text-[11px] text-gray-500">{hint}</div> : null}
    </div>
  );
}

export default function McpDesigner() {
  useEffect(() => { try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Automation Suite', 'MCP Designer'] })); } catch {} }, []);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selId, setSelId] = useState('');
  const [tools, setTools] = useState([]);
  // Runtime tools (queried via MCP2 message endpoint /api/mcp2/transport/:name/message)
  const [runtimeTools, setRuntimeTools] = useState([]);
  const [showRuntime, setShowRuntime] = useState(false);
  const [runtimeMsg, setRuntimeMsg] = useState('');
  const [showAllowedOnly, setShowAllowedOnly] = useState(false);
  // Selection state for bulk edits on custom tools
  const [selectedNames, setSelectedNames] = useState({});
  // Quick open/import by name
  const [findName, setFindName] = useState('');
  const [toolFilter, setToolFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name:'', description:'', grp:'', kind:'function', input_schema:'', code:'', enabled:true });
  const [editing, setEditing] = useState(''); // tool name
  const [toast, setToast] = useState({ msg: '', kind: 'ok', at: 0 });
  const pushToast = (msg, kind = 'ok') => { setToast({ msg, kind, at: Date.now() }); setTimeout(() => setToast(t => (t.msg === msg ? { ...t, msg: '' } : t)), 2400); };

  const loadServers = async () => {
    setLoading(true);
    try { const r = await fetch('/api/mcp/designer/servers', { credentials:'include' }); const j = await r.json(); setServers((r.ok && j?.ok) ? (Array.isArray(j.items)? j.items: []) : []); }
    catch { setServers([]); }
    finally { setLoading(false); }
  };
  const loadTools = async (id) => {
    if (!id) { setTools([]); return; }
    setBusy(true);
    try { const r = await fetch(`/api/mcp/designer/servers/${encodeURIComponent(id)}/tools`, { credentials:'include' }); const j = await r.json(); setTools((r.ok && j?.ok) ? (Array.isArray(j.items)? j.items: []) : []); }
    catch { setTools([]); }
    finally { setBusy(false); }
  };
  const selectedServer = useMemo(() => {
    try { return (servers || []).find(s => s && s.id === selId) || null; } catch { return null; }
  }, [servers, selId]);
  const selectedAllowed = useMemo(() => {
    try {
      const sv = selectedServer; if (!sv) return new Set();
      let opts = sv.options || {}; if (typeof opts === 'string') try { opts = JSON.parse(opts); } catch { opts = {}; }
      const arr = Array.isArray(opts.allowed_tools) ? opts.allowed_tools : [];
      return new Set(arr.map(String));
    } catch { return new Set(); }
  }, [selectedServer]);
  const [serverToken, setServerToken] = useState('');
  const loadServerToken = async () => {
    try { setServerToken(''); if (!selId) return; const r = await fetch(`/api/mcp-servers/${encodeURIComponent(selId)}/token`, { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok) setServerToken(j.token || ''); } catch { setServerToken(''); }
  };
  const loadRuntime = async () => {
    setRuntimeMsg(''); setRuntimeTools([]);
    try {
      const sv = selectedServer; if (!sv) return;
      const name = encodeURIComponent(sv.name || ''); if (!name) { setRuntimeMsg('Missing server name'); return; }
      const qp = serverToken ? `?token=${encodeURIComponent(serverToken)}` : '';
      const url = `/api/mcp2/transport/${name}/message${qp}`;
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ id:'tools_list', method:'tools/list', params:{} }) });
      const j = await r.json().catch(()=>({}));
      const list = (j?.result?.tools && Array.isArray(j.result.tools)) ? j.result.tools : [];
      setRuntimeTools(list);
      if (!list.length) setRuntimeMsg(j?.error?.message || 'No runtime tools (check allowlist or token)');
    } catch (e) { setRuntimeMsg(String(e?.message || e)); }
  };
  const openByName = async () => {
    try {
      const target = String(findName || '').trim(); if (!target) return;
      if (showRuntime) {
        if (!Array.isArray(runtimeTools) || !runtimeTools.length) await loadRuntime();
        const t = (runtimeTools || []).find(x => String(x?.name||'') === target) || (runtimeTools || []).find(x => String(x?.name||'').toLowerCase() === target.toLowerCase());
        if (t) { importRuntime(t); return; }
        pushToast('Runtime tool not found by that name', 'err');
      } else {
        const t = (tools || []).find(x => String(x?.name||'') === target) || (tools || []).find(x => String(x?.name||'').toLowerCase() === target.toLowerCase());
        if (t) { beginEdit(t); return; }
        pushToast('Custom tool not found by that name', 'err');
      }
    } catch (e) { pushToast(String(e?.message||e), 'err'); }
  };
  useEffect(()=>{ loadServers(); }, []);
  useEffect(()=>{ loadTools(selId); setEditing(''); setForm({ name:'', description:'', grp:'', kind:'function', input_schema:'', code:'', enabled:true }); setMsg(''); loadServerToken(); if (showRuntime) loadRuntime(); }, [selId]);
  useEffect(()=>{ if (showRuntime) loadRuntime(); }, [showRuntime, serverToken]);

  const beginNew = () => { setEditing(''); setForm({ name:'', description:'', grp:'', kind:'function', input_schema:'', code:'', enabled:true }); };
  const beginEdit = (t) => {
    setEditing(t.name);
    setForm({
      name: t.name || '',
      description: t.description || '',
      grp: t.grp || '',
      kind: t.kind || 'function',
      input_schema: t.input_schema ? JSON.stringify(t.input_schema, null, 2) : '',
      code: t.code ? JSON.stringify(t.code, null, 2) : '',
      enabled: !!t.enabled,
    });
  };
  const importRuntime = (rt) => {
    const grp = (()=>{ try { const n = String(rt?.name||''); const i = n.indexOf('.'); return i>0 ? n.slice(0,i) : ''; } catch { return ''; }})();
    setEditing('');
    setForm({
      name: rt?.name || '',
      description: rt?.description || '',
      grp,
      kind: 'function',
      input_schema: (()=>{ try { const sch = rt?.inputSchema || rt?.input_schema || null; return sch ? JSON.stringify(sch, null, 2) : ''; } catch { return ''; } })(),
      code: '',
      enabled: true,
    });
    pushToast('Runtime tool loaded into form (create to save)', 'ok');
  };
  const saveTool = async () => {
    if (!selId) { setMsg('Select a server first'); return; }
    if (!form.name.trim()) { setMsg('Name required'); return; }
    setBusy(true); setMsg('');
    try {
      // Remember previous tool state for allowlist sync
      const prev = (tools || []).find(t => t && t.name === editing);
      const prevName = prev?.name || '';
      const prevEnabled = !!prev?.enabled;

      if (editing && editing === form.name) {
        const r = await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools/${encodeURIComponent(editing)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(form) });
        const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||'save_failed');
        const ok = await syncAllowedAfterSave(prevName, prevEnabled, form.name, !!form.enabled);
        pushToast(ok ? 'Allowlist synced' : 'Allowlist sync failed', ok ? 'ok' : 'err');
      } else if (editing && editing !== form.name) {
        // Rename: create new then delete old
        let r = await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(form) });
        let j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||'save_failed');
        await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools/${encodeURIComponent(editing)}`, { method:'DELETE', credentials:'include' });
        const ok = await syncAllowedAfterSave(prevName, prevEnabled, form.name, !!form.enabled);
        pushToast(ok ? 'Allowlist synced' : 'Allowlist sync failed', ok ? 'ok' : 'err');
      } else {
        const r = await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(form) });
        const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||'create_failed');
        const ok = await syncAllowedAfterSave('', false, form.name, !!form.enabled);
        pushToast(ok ? 'Allowlist synced' : 'Allowlist sync failed', ok ? 'ok' : 'err');
      }
      await loadTools(selId); setEditing(form.name);
      setMsg('Saved');
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };
  const deleteTool = async (name) => {
    if (!selId || !name) return; if (!confirm('Delete this tool?')) return;
    setBusy(true); setMsg('');
    try { const r = await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools/${encodeURIComponent(name)}`, { method:'DELETE', credentials:'include' }); const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||'delete_failed'); const ok = await syncAllowedRemove(name); pushToast(ok ? 'Allowlist synced' : 'Allowlist sync failed', ok ? 'ok' : 'err'); await loadTools(selId); if (editing===name) beginNew(); }
    catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  // ---- Allowlist sync helpers: update MCP Server options.allowed_tools
  async function patchServerOptions(updater) {
    try {
      const r1 = await fetch(`/api/mcp-servers/${encodeURIComponent(selId)}`, { credentials:'include' });
      const j1 = await r1.json();
      if (!r1.ok || j1?.ok === false) return false;
      let opts = j1.item?.options || {};
      try { if (typeof opts === 'string') opts = JSON.parse(opts); } catch { opts = {}; }
      const next = updater({ ...(opts || {}) }) || {};
      const r2 = await fetch(`/api/mcp-servers/${encodeURIComponent(selId)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ options: next }) });
      const j2 = await r2.json();
      return !!(r2.ok && j2?.ok);
    } catch { return false; }
  }
  async function syncAllowedAfterSave(prevName, prevEnabled, newName, newEnabled) {
    return await patchServerOptions((opts) => {
      const set = new Set(Array.isArray(opts.allowed_tools) ? opts.allowed_tools.map(String) : []);
      if (prevName && prevName !== newName) set.delete(prevName);
      if (prevEnabled && !newEnabled && prevName) set.delete(prevName);
      if ((!prevEnabled && newEnabled) || (!prevName && newEnabled)) set.add(newName);
      return { ...opts, allowed_tools: Array.from(set) };
    });
  }
  async function syncAllowedRemove(name) {
    return await patchServerOptions((opts) => {
      const arr = Array.isArray(opts.allowed_tools) ? opts.allowed_tools.map(String) : [];
      const next = arr.filter((n) => n !== name);
      return { ...opts, allowed_tools: next };
    });
  }

  const filtered = useMemo(()=>{
    const f = toolFilter.trim().toLowerCase();
    const arr = Array.isArray(tools) ? tools : [];
    if (!f) return arr;
    return arr.filter(t => (t?.name||'').toLowerCase().includes(f) || (t?.grp||'').toLowerCase().includes(f));
  }, [tools, toolFilter]);

  return (
    <>
    <div className="h-full w-full grid grid-cols-[260px_1fr]">
      <aside className="border-r bg-white p-3">
        <div className="text-xs text-gray-500 mb-1">MCP Servers</div>
        <div className="space-y-1 overflow-auto max-h-[calc(100vh-120px)]">
          {loading && <div className="text-xs text-gray-500">Loading…</div>}
          {servers.map(s => (
            <button key={s.id} className={`w-full text-left px-3 py-2 rounded ${selId===s.id?'bg-blue-50 border border-blue-200':'hover:bg-gray-50'}`} onClick={()=>setSelId(s.id)}>
              <div className="text-sm font-medium">{s.name}</div>
              <div className="text-[11px] text-gray-500">{s.server_type || s.kind || 'custom'}</div>
            </button>
          ))}
          {!servers.length && !loading && <div className="text-xs text-gray-500">No servers.</div>}
        </div>
      </aside>
      <main className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Tools</div>
          <div className="flex items-center gap-2">
            <input className="border rounded px-2 py-1 text-sm" placeholder="Filter tools" value={toolFilter} onChange={(e)=>setToolFilter(e.target.value)} />
            <input className="border rounded px-2 py-1 text-sm" placeholder="Find by name" value={findName} onChange={(e)=>setFindName(e.target.value)} />
            <button className="text-xs px-2 py-1 rounded border" onClick={openByName}>Open</button>
            <button className="text-xs px-2 py-1 rounded border" onClick={beginNew}>New</button>
          </div>
        </div>
        {!selId && <div className="text-sm text-gray-500">Select a server on the left.</div>}
        {!!selId && (
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded bg-white">
              <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                <div className="flex items-center gap-3 text-xs">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={showRuntime} onChange={(e)=>setShowRuntime(!!e.target.checked)} /> Show runtime tools</label>
                  {showRuntime && <label className="inline-flex items-center gap-2"><input type="checkbox" checked={showAllowedOnly} onChange={(e)=>setShowAllowedOnly(!!e.target.checked)} /> Allowed only</label>}
                  {showRuntime && <button className="px-2 py-0.5 rounded border" onClick={loadRuntime}>Reload</button>}
                  {!!runtimeMsg && showRuntime && <span className="text-[11px] text-gray-600">{runtimeMsg}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <input className="border rounded px-2 py-1 text-sm" placeholder="Filter tools" value={toolFilter} onChange={(e)=>setToolFilter(e.target.value)} />
                  {showRuntime && <button className="text-xs px-2 py-1 rounded border" onClick={async ()=>{
                    try {
                      const sv = selectedServer; if (!sv) return;
                      const visible = (runtimeTools||[]).filter(t=>{ const f=toolFilter.trim().toLowerCase(); if(!f) return true; const n=String(t?.name||'').toLowerCase(); const d=String(t?.description||'').toLowerCase(); return n.includes(f)||d.includes(f); });
                      let ok=0, fail=0;
                      for (const rt of visible) {
                        const body = {
                          name: rt?.name || '',
                          description: rt?.description || '',
                          grp: (()=>{ try { const n = String(rt?.name||''); const i = n.indexOf('.'); return i>0 ? n.slice(0,i) : ''; } catch { return ''; } })(),
                          kind: 'function',
                          input_schema: (()=>{ try { const sch = rt?.inputSchema || rt?.input_schema || null; return sch ? JSON.stringify(sch) : ''; } catch { return ''; } })(),
                          code: '',
                          enabled: true,
                        };
                        if (!body.name) { fail++; continue; }
                        const r = await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                        if (r.ok) ok++; else fail++;
                      }
                      pushToast(`Imported ${ok} tool(s)${fail?`, ${fail} failed`:''}`, ok? 'ok':'err');
                      await loadTools(selId);
                    } catch (e) { pushToast(String(e?.message||e), 'err'); }
                  }}>Import all visible</button>}
                  <button className="text-xs px-2 py-1 rounded border" onClick={beginNew}>New</button>
                </div>
              </div>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    {!showRuntime && (<th className="text-left px-3 py-2"><input type="checkbox" onChange={(e)=>{
                      const on = !!e.target.checked; const next={};
                      if (on) { (filtered||[]).forEach(t=>{ if(t?.name) next[t.name]=true; }); }
                      setSelectedNames(next);
                    }} /></th>)}
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Group</th>
                    <th className="text-left px-3 py-2">Kind</th>
                    <th className="text-left px-3 py-2">Enabled</th>
                    <th className="text-left px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(showRuntime ? (runtimeTools||[]) : filtered).filter(t => {
                    const f = toolFilter.trim().toLowerCase(); if (!f) return true;
                    const n = String(t?.name||'').toLowerCase();
                    const d = String(t?.description||'').toLowerCase();
                    return n.includes(f) || d.includes(f);
                  }).filter(t => {
                    if (!showRuntime || !showAllowedOnly) return true;
                    return selectedAllowed.has(String(t?.name||''));
                  }).sort((a,b)=>String(a?.name||'').localeCompare(String(b?.name||''))).map(t => {
                    const grp = t.grp || (()=>{ try { const n = String(t?.name||''); const i=n.indexOf('.'); return i>0?n.slice(0,i):''; } catch { return ''; }})();
                    const kind = t.kind || 'function';
                    const enabled = (t.enabled !== undefined) ? !!t.enabled : true;
                    const isSel = !!selectedNames[t.name];
                    return (
                      <tr key={t.name} className="border-b">
                        {!showRuntime && (
                          <td className="px-3 py-2"><input type="checkbox" checked={isSel} onChange={(e)=>{
                            const on = !!e.target.checked; setSelectedNames(prev=>{ const next={...prev}; if(on) next[t.name]=true; else delete next[t.name]; return next; });
                          }} /></td>
                        )}
                        <td className="px-3 py-2 font-mono">{t.name}</td>
                        <td className="px-3 py-2 text-xs">{grp || '-'}</td>
                        <td className="px-3 py-2 text-xs">{kind}</td>
                        <td className="px-3 py-2 text-xs">{enabled ? 'yes' : 'no'}</td>
                        <td className="px-3 py-2 text-xs">
                          {!showRuntime && (
                            <>
                              <button className="px-2 py-0.5 rounded border mr-2" onClick={()=>beginEdit(t)}>Edit</button>
                              <button className="px-2 py-0.5 rounded border text-red-700" onClick={()=>deleteTool(t.name)}>Delete</button>
                            </>
                          )}
                          {showRuntime && (
                            <button className="px-2 py-0.5 rounded border" onClick={()=>importRuntime(t)}>Import as custom</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(!showRuntime && !filtered.length) && (
                    <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={5}>No tools.</td></tr>
                  )}
                  {(showRuntime && (!runtimeTools || !runtimeTools.length)) && (
                    <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={5}>No runtime tools (try Reload or check allowlist/token).</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="space-y-2">
              {!showRuntime && (
                <div className="p-3 border rounded bg-white">
                  <div className="font-medium mb-2">Bulk edit</div>
                  <div className="text-[12px] text-gray-600 mb-2">Selected: {Object.keys(selectedNames).length}</div>
                  <div className="flex flex-wrap gap-2 mb-2">
                    <button className="text-xs px-2 py-1 rounded border" onClick={()=>{
                      const next={}; (filtered||[]).forEach(t=>{ if(t?.name) next[t.name]=true; }); setSelectedNames(next);
                    }}>Select visible</button>
                    <button className="text-xs px-2 py-1 rounded border" onClick={()=>setSelectedNames({})}>Clear selection</button>
                    <button className="text-xs px-2 py-1 rounded border" onClick={async ()=>{
                      const names = Object.keys(selectedNames); if(!names.length||!selId) return;
                      for (const n of names) {
                        await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools/${encodeURIComponent(n)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ enabled: true }) });
                      }
                      pushToast('Enabled selected'); await loadTools(selId);
                    }}>Enable</button>
                    <button className="text-xs px-2 py-1 rounded border" onClick={async ()=>{
                      const names = Object.keys(selectedNames); if(!names.length||!selId) return;
                      for (const n of names) {
                        await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools/${encodeURIComponent(n)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ enabled: false }) });
                      }
                      pushToast('Disabled selected'); await loadTools(selId);
                    }}>Disable</button>
                    <button className="text-xs px-2 py-1 rounded border text-red-700" onClick={async ()=>{
                      const names = Object.keys(selectedNames); if(!names.length||!selId) return;
                      if (!confirm(`Delete ${names.length} tool(s)?`)) return;
                      for (const n of names) {
                        await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools/${encodeURIComponent(n)}`, { method:'DELETE', credentials:'include' });
                      }
                      pushToast('Deleted selected'); setSelectedNames({}); await loadTools(selId);
                    }}>Delete</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div>
                      <div className="text-[11px] text-gray-600 mb-1">Set group</div>
                      <input id="bulk_group" className="w-full border rounded px-2 py-1" placeholder="group" />
                    </div>
                    <div>
                      <button className="text-xs px-2 py-1 rounded border" onClick={async ()=>{
                        const el = document.getElementById('bulk_group'); const v = el ? el.value.trim() : '';
                        const names = Object.keys(selectedNames); if(!names.length||!selId||!v) return;
                        for (const n of names) {
                          await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools/${encodeURIComponent(n)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ grp: v }) });
                        }
                        pushToast('Group set'); await loadTools(selId);
                      }}>Apply</button>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-600 mb-1">Set kind</div>
                      <select id="bulk_kind" className="w-full border rounded px-2 py-1">
                        <option value="function">function</option>
                        <option value="proxy">proxy</option>
                        <option value="sql">sql</option>
                      </select>
                    </div>
                    <div>
                      <button className="text-xs px-2 py-1 rounded border" onClick={async ()=>{
                        const el = document.getElementById('bulk_kind'); const v = el ? el.value : '';
                        const names = Object.keys(selectedNames); if(!names.length||!selId||!v) return;
                        for (const n of names) {
                          await fetch(`/api/mcp/designer/servers/${encodeURIComponent(selId)}/tools/${encodeURIComponent(n)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ kind: v }) });
                        }
                        pushToast('Kind set'); await loadTools(selId);
                      }}>Apply</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="p-3 border rounded bg-white">
                <div className="flex items-center justify-between mb-2"><div className="font-medium">{editing ? 'Edit tool' : 'Create tool'}</div><button className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" onClick={saveTool} disabled={busy}>{busy?'Saving…':'Save'}</button></div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name"><input className="w-full border rounded px-2 py-1" value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})} placeholder="products.list" /></Field>
                  <Field label="Group"><input className="w-full border rounded px-2 py-1" value={form.grp} onChange={(e)=>setForm({...form, grp:e.target.value})} placeholder="products" /></Field>
                </div>
                <Field label="Description"><input className="w-full border rounded px-2 py-1" value={form.description} onChange={(e)=>setForm({...form, description:e.target.value})} placeholder="What this tool does" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kind">
                    <select className="w-full border rounded px-2 py-1" value={form.kind} onChange={(e)=>setForm({...form, kind:e.target.value})}>
                      <option value="function">function</option>
                      <option value="http">http</option>
                      <option value="sql">sql</option>
                      <option value="proxy">proxy</option>
                    </select>
                  </Field>
                  <Field label="Enabled">
                    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.enabled} onChange={(e)=>setForm({...form, enabled: !!e.target.checked})} /> <span>Enabled</span></label>
                  </Field>
                </div>
                <Field label="Input Schema (JSON)"><textarea className="w-full border rounded px-2 py-1 font-mono text-xs" rows={8} value={form.input_schema} onChange={(e)=>setForm({...form, input_schema:e.target.value})} placeholder='{"type":"object","properties":{}}' /></Field>
                <Field label="Code/config (JSON)"><textarea className="w-full border rounded px-2 py-1 font-mono text-xs" rows={8} value={form.code} onChange={(e)=>setForm({...form, code:e.target.value})} placeholder='{"sql":"SELECT ..."}' /></Field>
                {!!msg && <div className="text-[11px] text-gray-600 mt-1">{msg}</div>}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
    {!!toast.msg && (
      <div className={`fixed bottom-4 right-4 z-50 px-3 py-2 rounded shadow text-sm ${toast.kind==='ok' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'}`}>
        {toast.msg}
      </div>
    )}
    </>
  );
}
