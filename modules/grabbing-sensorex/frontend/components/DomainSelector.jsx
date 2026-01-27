import React from 'react';

export default function DomainSelector(props) {
  // Support both legacy prop style and new ctx-based usage to keep Main.jsx minimal
  const ctx = props?.ctx;
  const domains = ctx ? (ctx.domains || []) : (props.domains || []);
  const domainQ = ctx ? (ctx.domainQ || '') : (props.domainQ || '');
  const setDomainQ = ctx ? (ctx.setDomainQ || (()=>{})) : (props.setDomainQ || (()=>{}));
  const domainLimit = ctx ? (ctx.domainLimit || 50) : (props.domainLimit || 50);
  const setDomainLimit = ctx ? (ctx.setDomainLimit || (()=>{})) : (props.setDomainLimit || (()=>{}));
  const activeDomain = ctx ? (ctx.activeDomain || '') : (props.activeDomain || '');
  const setActiveDomain = ctx ? (ctx.setActiveDomain || (()=>{})) : (props.setActiveDomain || (()=>{}));
  const refreshDomains = ctx ? (ctx.refreshDomains || (()=>{})) : (props.refreshDomains || (()=>{}));
  const perfMode = ctx ? !!ctx.perfMode : !!props.perfMode;
  const setPerfMode = ctx ? (ctx.setPerfMode || (()=>{})) : (props.setPerfMode || (()=>{}));
  // Page type selection (global)
  const exType = ctx ? (ctx.exType || 'product') : (props.exType || 'product');
  const setExType = ctx ? (ctx.setExType || (()=>{})) : (props.setExType || (()=>{}));
  // Use mapping type as the single source of truth for the Type selector
  const mapType = ctx ? (ctx.mapType ?? 'product') : (props.mapType ?? 'product');
  const setMapType = ctx ? (ctx.setMapType || (()=>{})) : (props.setMapType || (()=>{}));
  const [newDomain, setNewDomain] = React.useState('');
  const [msg, setMsg] = React.useState('');

  const onAdd = async () => {
    const d = String(newDomain||'').trim().replace(/^https?:\/\//i,'').replace(/^www\./,'');
    if (!d) { setMsg('Enter a domain'); return; }
    setMsg('');
    try {
      const r = await fetch('/api/grabbing-sensorex/domains', {
        method:'POST', headers: { 'Content-Type':'application/json' }, credentials:'include',
        body: JSON.stringify({ domain: d })
      });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setMsg(j?.message||j?.error||'add_failed'); return; }
      setNewDomain('');
      // Clear search so the newly added domain appears in the dropdown
      // even if the previous filter did not match it.
      try { setDomainQ(''); } catch {}
      await refreshDomains();
      setActiveDomain(j?.item?.domain || d);
    } catch (e) { setMsg(String(e?.message||e)); }
  };

  const onDelete = async () => {
    if (!activeDomain) { setMsg('Select a domain'); return; }
    setMsg('');
    try {
      const r = await fetch(`/api/grabbing-sensorex/domains/${encodeURIComponent(activeDomain)}`, { method:'DELETE', credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setMsg(j?.message||j?.error||'delete_failed'); return; }
      setActiveDomain('');
      await refreshDomains();
    } catch (e) { setMsg(String(e?.message||e)); }
  };

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between p-4 border-b bg-white gap-4 pointer-events-auto">
      <div className="flex items-center gap-3">
        <div className="font-semibold">Grabbing Sensorex</div>
        <div className="text-xs text-gray-500">Domain selector</div>
      </div>
      <div className="flex-1 flex items-center gap-2 justify-end">
        {msg && <div className="text-xs text-red-600 mr-2">{msg}</div>}
        <label className="text-xs inline-flex items-center gap-1 mr-2" title="Reduces visual effects (blur/shadow) for smoother scrolling on this page.">
          <input type="checkbox" checked={!!perfMode} onChange={(e)=>setPerfMode(!!e.target.checked)} /> Perf
        </label>
        {/* Page Type selector (global) */}
        <div className="flex items-center gap-1 mr-2">
          <div className="text-xs text-gray-600">Type</div>
          <select
            aria-label="Page type"
            value={mapType || exType || 'product'}
            onChange={(e)=>{ const v = e.target.value; try { setExType(v); } catch {}; try { setMapType(v); } catch {}; }}
            className="border rounded px-2 py-1 text-sm min-w-[9rem]"
          >
            <option value="product">product</option>
            <option value="category">category</option>
            <option value="article">article</option>
            <option value="page">page</option>
          </select>
        </div>
        <input value={domainQ} onChange={(e)=>setDomainQ(e.target.value)} placeholder="search domain" className="border rounded px-2 py-1 text-sm w-40" />
        <div className="flex items-center gap-1">
          <div className="text-xs text-gray-600">Limit</div>
          <select
            aria-label="Domains limit"
            value={String(domainLimit)}
            onChange={(e)=>{ const v = Number(e.target.value||50); setDomainLimit(v); try { refreshDomains(); } catch {} }}
            className="border rounded px-2 py-1 text-sm"
          >
            {[10,20,50,100].map(n => (<option key={n} value={String(n)}>{n}</option>))}
          </select>
        </div>
        <select value={activeDomain} onChange={(e)=>setActiveDomain(e.target.value)} className="border rounded px-2 py-1 text-sm min-w-[16rem]">
          <option value="">Select domain…</option>
          {(function(){
            const list = Array.isArray(domains)? domains: [];
            const hasActive = !!(activeDomain && list.some(x => String(x.domain||'').toLowerCase() === String(activeDomain||'').toLowerCase()));
            const opts = list.map(d => ({ key: d.domain, val: d.domain }));
            if (!hasActive && activeDomain) opts.unshift({ key: `__active_${activeDomain}`, val: activeDomain });
            return opts;
          })().map(o => (
            <option key={o.key} value={o.val}>{o.val}</option>
          ))}
        </select>
        {/* tiny status of domain source */}
        {ctx?.domSrc ? (
          <span title="Domains source" className="text-[11px] text-gray-500">src: {ctx.domSrc}</span>
        ) : null}
        <button onClick={onDelete} disabled={!activeDomain} className="px-3 py-1.5 rounded border text-sm disabled:opacity-60">Delete</button>
        <input value={newDomain} onChange={(e)=>setNewDomain(e.target.value)} placeholder="add domain" className="border rounded px-2 py-1 text-sm w-48" />
        <button onClick={onAdd} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm">Add</button>
        <button onClick={()=>{ refreshDomains(); }} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm">Refresh</button>
      </div>
    </div>
  );
}
