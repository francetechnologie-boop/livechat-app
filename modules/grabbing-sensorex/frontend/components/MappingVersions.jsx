import React from 'react';

export default function MappingVersions({ ctx, state }) {
  const {
    activeDomain, mapType, mapText, setMapText,
    loadMappingHistory, ensureMapVersionsFor, applyMappingVersion,
    loadPrestaSchema, setMapMsg,
  } = ctx || {};
  const {
    verCollapsed, setVerCollapsed,
    mapHistBusy, mapHistItems,
    verSelMap, setVerSelMap,
    verQ, setVerQ,
  } = state || {};

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold">Mapping Versions</div>
        <div className="flex items-center gap-2 text-xs">
          <button className="px-2 py-1 border rounded" disabled={mapHistBusy || !activeDomain} onClick={async ()=>{ if (typeof loadMappingHistory==='function') await loadMappingHistory(); if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType); }}>Refresh</button>
          <button className="px-2 py-1 border rounded" disabled={!activeDomain || !mapType || mapHistBusy || Object.keys(verSelMap||{}).filter(k=>verSelMap[k]).length===0}
            title="Delete selected versions"
            onClick={async ()=>{
              try {
                const sel = Object.keys(verSelMap||{}).filter(k=>verSelMap[k]).map(k=>Number(k)||0).filter(n=>n>0);
                if (!sel.length) return;
                if (!window.confirm(`Delete ${sel.length} version(s)?`)) return;
                for (const v of sel) {
                  try { await fetch('/api/grabbing-sensorex/mapping/tools', { method:'DELETE', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: activeDomain, page_type: mapType, version: v }) }); } catch {}
                }
                setVerSelMap({});
                if (typeof loadMappingHistory==='function') await loadMappingHistory();
                if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType);
              } catch (e) { alert(String(e?.message||e)); }
            }}>Delete selected</button>
          <button className="px-2 py-1 border rounded" disabled={!activeDomain || !mapType}
            title="Paste a full mapping JSON and apply it (no version bump)"
            onClick={()=>{
              try {
                const w = window.open('', '_blank'); if (!w) { alert('Popup blocked'); return; }
                const safe = (s)=>String(s||'').replace(/[<>]/g, c=>({"<":"&lt;",">":"&gt;"}[c]));
                const cur = (function(){ try { return JSON.stringify(JSON.parse(mapText||'{}'), null, 2); } catch { return mapText||''; } })();
                const shell = `<!doctype html><html><head><meta charset="utf-8"><title>Edit Mapping JSON</title><style>body{font:12px system-ui,sans-serif;padding:10px}.hdr{display:flex;justify-content:space-between;align-items:center;margin:0 0 8px 0}.btn{font-size:12px;padding:2px 6px;border:1px solid #e5e5e5;border-radius:4px;background:#fff}textarea{width:100%;height:70vh;border:1px solid #e5e5e5;border-radius:4px;padding:8px;font:12px/1.4 ui-monospace,monospace}.muted{color:#666}</style></head><body><div class="hdr"><h3 style="margin:0">Edit Mapping JSON</h3><span class="muted">${safe(activeDomain||'')} · ${safe(String(mapType||''))}</span></div><textarea id="buf">${safe(cur)}</textarea><div style="margin-top:8px;display:flex;gap:8px"><button id="apply" class="btn">Apply (no version bump)</button><button id="close" class="btn">Close</button></div><script>document.getElementById('close').onclick=function(){window.close()};document.getElementById('apply').onclick=function(){try{const txt=document.getElementById('buf').value;window.opener.postMessage({type:'gs:paste-mapping',payload:txt},'*');window.close()}catch(e){alert(String(e&&e.message||e))}}</script></body></html>`;
                w.document.open(); w.document.write(shell); w.document.close();
                const onMsg = async (e) => {
                  try {
                    if (!e || !e.data || e.data.type !== 'gs:paste-mapping') return;
                    window.removeEventListener('message', onMsg);
                    let obj = {}; try { obj = JSON.parse(String(e.data.payload||'{}')); } catch (err) { alert('Invalid JSON: '+String(err&&err.message||err)); return; }
                    setMapText(JSON.stringify(obj, null, 2));
                    try {
                      const r = await fetch(`/api/grabbing-sensorex/domains/${encodeURIComponent(activeDomain)}/transfert`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ page_type: mapType, mapping: obj, version_bump: false }) });
                      const j = await r.json(); if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'save_failed')); return; }
                      try { if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType); } catch {}
                      try { if (typeof loadPrestaSchema==='function') await loadPrestaSchema(); } catch {}
                    } catch (err2) { alert(String(err2&&err2.message||err2)); }
                  } catch {}
                };
                window.addEventListener('message', onMsg);
              } catch (e) { alert(String(e?.message||e)); }
            }}>Paste JSON…</button>
          <button className="px-2 py-1 border rounded" disabled={!activeDomain || !mapType || mapHistBusy}
            title="Create a new mapping version from the latest saved config (mapping_tools)"
            onClick={async ()=>{
              try {
                const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', String(mapType));
                // Load latest mapping config from mapping_tools
                const rl = await fetch(`/api/grabbing-sensorex/mapping/tools/latest?${p.toString()}`, { credentials:'include' });
                const ctl = rl.headers?.get?.('content-type') || '';
                if (!ctl.includes('application/json')) { alert(`non_json_${rl.status||0}`); return; }
                const jl = await rl.json(); if (!rl.ok || jl?.ok===false || !jl?.item) { alert(String(jl?.message||jl?.error||'no_latest_version')); return; }
                const cfg = jl.item.config || {};
                // Create next version by posting to mapping_tools without version
                const body = { domain: activeDomain, page_type: String(mapType), name: 'snapshot', config: cfg };
                const rp = await fetch('/api/grabbing-sensorex/mapping/tools', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const ctp = rp.headers?.get?.('content-type') || '';
                if (!ctp.includes('application/json')) { alert(`non_json_${rp.status||0}`); return; }
                const jp = await rp.json(); if (!rp.ok || jp?.ok===false) { alert(String(jp?.message||jp?.error||'snapshot_failed')); return; }
                if (typeof loadMappingHistory==='function') await loadMappingHistory();
                if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType);
                alert(`Snapshot created: v${Number(jp?.item?.version||0)||0}`);
              } catch (e) { alert(String(e?.message||e)); }
            }}>Make snapshot now</button>
          <input className="ml-2 border rounded px-2 py-1" placeholder="Search versions…" value={verQ} onChange={(e)=>setVerQ(e.target.value)} />
          {ctx.mapHistMsg && <span className="text-red-600">{ctx.mapHistMsg}</span>}
        </div>
      </div>
      {activeDomain && mapType && !mapHistBusy && (!mapHistItems || mapHistItems.length===0) && (
        <div className="mb-2 p-2 border rounded bg-yellow-50 text-yellow-900 text-xs flex items-center justify-between">
          <div>No mapping versions yet for this page type.</div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 border rounded bg-white" onClick={async ()=>{
              if (!activeDomain) return;
              try {
                let obj = {}; try { obj = ctx.mapText ? JSON.parse(ctx.mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                const r = await fetch(`/api/grabbing-sensorex/domains/${encodeURIComponent(activeDomain)}/transfert`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ page_type: mapType, mapping: obj, version_bump: false }) });
                const j = await r.json(); if (!r.ok || j?.ok===false) { setMapMsg(String(j?.message||j?.error||'map_save_failed')); return; }
                setMapMsg('Saved mapping (v1)');
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}>Save as v1</button>
            <button className="px-2 py-1 border rounded bg-white" onClick={async ()=>{
              if (!activeDomain) return;
              try {
                const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', String(mapType));
                const rl = await fetch(`/api/grabbing-sensorex/mapping/tools/latest?${p.toString()}`, { credentials:'include' });
                const ctl = rl.headers?.get?.('content-type') || '';
                if (!ctl.includes('application/json')) { setMapMsg(`non_json_${rl.status||0}`); return; }
                const jl = await rl.json(); if (!rl.ok || jl?.ok===false || !jl?.item) { setMapMsg(String(jl?.message||jl?.error||'no_latest_version')); return; }
                const cfg = jl.item.config || {};
                const body = { domain: activeDomain, page_type: String(mapType), name: 'snapshot', config: cfg };
                const rp = await fetch('/api/grabbing-sensorex/mapping/tools', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const ctp = rp.headers?.get?.('content-type') || '';
                if (!ctp.includes('application/json')) { setMapMsg(`non_json_${rp.status||0}`); return; }
                const jp = await rp.json(); if (!rp.ok || jp?.ok===false) { setMapMsg(String(jp?.message||jp?.error||'snapshot_failed')); return; }
                if (typeof loadMappingHistory==='function') await loadMappingHistory();
                if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType);
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}>Snapshot now</button>
          </div>
        </div>
      )}
      <div className="max-h-56 overflow-auto border rounded">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 border-b sticky top-0">
            <tr>
              <th className="px-2 py-1 text-left"><input type="checkbox" onChange={(e)=>{
                const on = !!e.target.checked;
                let items = Array.isArray(mapHistItems)? mapHistItems: [];
                const norm = (s='') => String(s||'').toLowerCase().replace(/^www\./,'');
                const d = norm(activeDomain);
                const t = String(mapType||'').toLowerCase();
                items = items.filter(v => norm(v.domain) === d && String(v.page_type||'').toLowerCase() === t);
                const q = String(verQ||'').trim().toLowerCase();
                if (q) items = items.filter(v => {
                  const ver = String(v.version||'');
                  const name = String(v.name||'');
                  const created = String(v.created_at||'');
                  return [ver,name,created].some(s => s.toLowerCase().includes(q));
                });
                const next = {}; for (const it of items) next[String(it.version)] = on; setVerSelMap(next);
              }} /></th>
              <th className="px-2 py-1 text-left">Version</th>
              <th className="px-2 py-1 text-left">Name</th>
              <th className="px-2 py-1 text-left">Created</th>
              <th className="px-2 py-1 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {(function(){
              let items = Array.isArray(mapHistItems)? mapHistItems: [];
              const norm = (s='') => String(s||'').toLowerCase().replace(/^www\./,'');
              const d = norm(activeDomain);
              const t = String(mapType||'').toLowerCase();
              items = items.filter(v => norm(v.domain) === d && String(v.page_type||'').toLowerCase() === t);
              const q = String(verQ||'').trim().toLowerCase();
              if (q) items = items.filter(v => {
                const ver = String(v.version||'');
                const name = String(v.name||'');
                const created = String(v.created_at||'');
                return [ver,name,created].some(s => s.toLowerCase().includes(q));
              });
              return items;
            })().map(v => (
              <tr key={v.version} className="border-b">
                <td className="px-2 py-1"><input type="checkbox" checked={!!verSelMap[String(v.version)]} onChange={(e)=>{ const on = !!e.target.checked; setVerSelMap(prev => ({ ...prev, [String(v.version)]: on })); }} /></td>
                <td className="px-2 py-1">v{v.version}</td>
                <td className="px-2 py-1">{String(v.name || '')}</td>
                <td className="px-2 py-1">{String(v.created_at||'').replace('T',' ').replace('Z','')}</td>
                <td className="px-2 py-1 space-x-2">
                  <button className="px-2 py-1 border rounded" onClick={async ()=>{
                    try {
                      const p = new URLSearchParams(); p.set('domain', String(activeDomain)); p.set('page_type', String(mapType)); p.set('version', String(v.version));
                      const r = await fetch(`/api/grabbing-sensorex/transfert/version/get?${p.toString()}`, { credentials:'include' });
                      const j = await r.json(); if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'load_failed')); return; }
                      const item = j.item || {};
                      const json = JSON.stringify({ config: item.config||{}, tables: item.tables||{} }, null, 2);
                      const w = window.open('', '_blank'); if (!w) { alert('Popup blocked'); return; }
                      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Mapping v${v.version} – ${String(activeDomain)} (${String(mapType)})</title><style>body{font:12px system-ui, sans-serif;padding:10px} pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:4px;padding:8px}</style></head><body><h3 style="margin:0">Mapping v${v.version} – ${String(activeDomain)} (${String(mapType)})</h3><pre id="code"></pre><script>const data=${JSON.stringify(json)};document.getElementById('code').textContent=data;</script></body></html>`;
                      w.document.open(); w.document.write(html); w.document.close();
                    } catch (e) { alert(String(e?.message||e)); }
                  }}>View</button>
                  <button className="px-2 py-1 border rounded" onClick={async ()=>{
                    if (!window.confirm(`Restore mapping to v${v.version}?`)) return;
                    try {
                      const body = { domain: String(activeDomain), page_type: String(mapType), version: v.version };
                      const r = await fetch('/api/grabbing-sensorex/transfert/version/restore', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                      const j = await r.json(); if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'restore_failed')); return; }
                      if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(String(mapType));
                      alert(`Restored. Current version is v${j?.restored_to ?? '?'}`);
                    } catch (e) { alert(String(e?.message||e)); }
                  }}>Restore</button>
                  <button className="ml-1 px-2 py-1 border rounded" title="Load this version into the editor and update the table list" onClick={async ()=>{
                    try { if (typeof applyMappingVersion === 'function') await applyMappingVersion(v.version); } catch (e) { alert(String(e?.message||e)); }
                  }}>Apply</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
