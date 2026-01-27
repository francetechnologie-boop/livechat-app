import React from 'react';

export default function ExtractionConfigPanel(props) {
  // Accept a ctx prop to minimize prop plumbing from Main.jsx; fallback to explicit props for compatibility
  const ctx = props?.ctx;
  const activeDomain = ctx ? (ctx.activeDomain || '') : (props.activeDomain || '');
  const exType = ctx ? (ctx.exType) : props.exType;
  const setExType = ctx ? (ctx.setExType || (()=>{})) : (props.setExType || (()=>{}));
  const exBusy = ctx ? !!ctx.exBusy : !!props.exBusy;
  const setExBusy = ctx ? (ctx.setExBusy || (()=>{})) : (props.setExBusy || (()=>{}));
  const exMsg = ctx ? (ctx.exMsg || '') : (props.exMsg || '');
  const setExMsg = ctx ? (ctx.setExMsg || (()=>{})) : (props.setExMsg || (()=>{}));
  const exText = ctx ? (ctx.exText || '') : (props.exText || '');
  const setExText = ctx ? (ctx.setExText || (()=>{})) : (props.setExText || (()=>{}));
  const exVersions = ctx ? (ctx.exVersions || []) : (props.exVersions || []);
  const setExVersions = ctx ? (ctx.setExVersions || (()=>{})) : (props.setExVersions || (()=>{}));
  const exSelVer = ctx ? (ctx.exSelVer || 0) : (props.exSelVer || 0);
  const setExSelVer = ctx ? (ctx.setExSelVer || (()=>{})) : (props.setExSelVer || (()=>{}));
  const exCopyMsg = ctx ? (ctx.exCopyMsg || '') : (props.exCopyMsg || '');
  const setExCopyMsg = ctx ? (ctx.setExCopyMsg || (()=>{})) : (props.setExCopyMsg || (()=>{}));
  const open = ctx ? !!(ctx.stepOpen?.[2]) : (props.open ?? true);
  const onToggle = ctx
    ? (() => { if (ctx.setStepOpen) ctx.setStepOpen(prev => ({ ...(prev||{}), 2: !prev?.[2] })); })
    : (props.onToggle || (()=>{}));
  const copyToClipboard = ctx ? (ctx.copyToClipboard || (async ()=>{})) : (props.copyToClipboard || (async ()=>{}));
  return (
    <div className="panel order-2">
      <div className="panel__header flex items-center justify-between">
        <span>Step 2: Extraction Configuration</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">Domain: <span className="font-mono">{activeDomain || '-'}</span></span>
          <span className="text-xs text-gray-600">Type: <span className="font-mono">{String(exType||'').toLowerCase()||'-'}</span></span>
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={async ()=>{
            if (!activeDomain) { setExMsg('Select a domain'); return; }
            setExBusy(true); setExMsg('');
            try {
              const r = await fetch(`/api/grabbing-jerome/extraction/tools?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(exType)}&limit=50`, { credentials:'include' });
              const j = await r.json();
              if (r.ok && j?.ok) { setExVersions(Array.isArray(j.items)? j.items: []); }
              else setExMsg(j?.message||j?.error||'list_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>Refresh</button>
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={async ()=>{
            if (!activeDomain) { setExMsg('Select a domain'); return; }
            setExBusy(true); setExMsg(''); setExSelVer(0);
            try {
              const r = await fetch(`/api/grabbing-jerome/extraction/tools/latest?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(exType)}`, { credentials:'include' });
              const j = await r.json();
              if (r.ok && j?.ok) { setExSelVer(Number(j.item?.version||0)); setExText(JSON.stringify(j.item?.config||{}, null, 2)); }
              else setExMsg(j?.message||j?.error||'latest_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>Load Latest</button>
          <button className="px-2 py-1 text-xs border rounded" onClick={onToggle} aria-expanded={!!open}>{open ? 'Collapse' : 'Expand'}</button>
        </div>
      </div>
      <div className="panel__body space-y-2" style={{ display: open ? undefined : 'none', contentVisibility: 'auto', contain: 'content' }}>
        {exMsg && <div className="text-xs text-blue-700">{exMsg}</div>}
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Editor</div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded border text-xs" onClick={async ()=>{ await copyToClipboard(exText, setExCopyMsg); }}>Copy JSON</button>
            {exCopyMsg && <span className="text-xs text-gray-500">{exCopyMsg}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div>Versions:</div>
          <select value={exSelVer} onChange={(e)=>setExSelVer(Number(e.target.value||0))} className="border rounded px-2 py-1 text-xs">
            <option value={0}>[new version]</option>
            {(exVersions||[]).map(v => (
              <option key={v.id} value={v.version}>{v.version} {v.name?`- ${v.name}`:''}</option>
            ))}
          </select>
          <button className="px-2 py-1 rounded border text-xs" disabled={!exSelVer || exBusy} onClick={async ()=>{
            if (!activeDomain || !exSelVer) return;
            setExBusy(true); setExMsg('');
            try {
              const r = await fetch(`/api/grabbing-jerome/extraction/tools/get?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(exType)}&version=${encodeURIComponent(String(exSelVer))}`, { credentials:'include' });
              const j = await r.json();
              if (r.ok && j?.ok) { setExText(JSON.stringify(j.item?.config||{}, null, 2)); }
              else setExMsg(j?.message||j?.error||'load_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>Load</button>
          <button className="px-2 py-1 rounded border text-xs" disabled={!exSelVer || exBusy} onClick={async ()=>{
            if (!activeDomain || !exSelVer) return; setExBusy(true); setExMsg('');
            try {
              const r = await fetch('/api/grabbing-jerome/extraction/tools', { method:'DELETE', headers: {'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: activeDomain, page_type: exType, version: exSelVer }) });
              const j = await r.json();
              if (r.ok && j?.ok) { setExMsg(`Deleted v${exSelVer}`); setExSelVer(0); }
              else setExMsg(j?.message||j?.error||'delete_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>Delete</button>
        </div>
        <textarea value={exText} onChange={(e)=>setExText(e.target.value)} className="w-full h-56 border rounded p-2 font-mono text-xs" placeholder={'{\n  "mappings": { }\n}'} />
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60" disabled={exBusy || !activeDomain} onClick={async ()=>{
            setExBusy(true); setExMsg('');
            try {
              let cfg = {};
              try { cfg = exText ? JSON.parse(exText) : {}; } catch (e) { setExMsg('Invalid JSON: '+(e?.message||e)); setExBusy(false); return; }
              // Always create a new version on save
              const body = { domain: activeDomain, page_type: exType, config: cfg };
              const r = await fetch('/api/grabbing-jerome/extraction/tools', { method:'POST', headers: {'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
              const j = await r.json();
              if (r.ok && j?.ok) { setExMsg(`Saved v${j.item?.version||exSelVer||''}`); setExSelVer(Number(j.item?.version||exSelVer||0)); }
              else setExMsg(j?.message||j?.error||'save_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>{'Save new version'}</button>
        </div>
      </div>
    </div>
  );
}
