import React from 'react';

export default function MappingHeaderToolbar(props) {
  const {
    ctx,
    unsaved,
    latestMapLabel,
    activeDomain,
    mapType,
    mapText,
    setMapText,
    setMapMsg,
    shopCsvDraft,
    ensureMapVersionsFor,
    refreshMapVersionsFor,
    schemaMapVersion,
    schemaPrefix,
    verSel,
    setVerSel,
    verOptions,
    onVersionChange,
  } = props || {};

  return (
    <div className="panel__header flex items-center justify-between">
      <span>Step 3: Presta Mapping & Settings</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600">Domain: <span className="font-mono">{activeDomain || '-'}</span></span>
        <span className="text-xs text-gray-600">Type: <span className="font-mono">{String(mapType||'').toLowerCase()||'-'}</span></span>
        <span className="ml-2 text-[11px] text-gray-500">{latestMapLabel}</span>
        <span className="ml-2 text-[11px] text-gray-600">{schemaMapVersion ? (`Mapping v${schemaMapVersion}`) : 'Mapping v-'} • Prefix {(schemaPrefix||'ps_')} • Profile {(ctx?.mysqlProfileId ? `#${ctx.mysqlProfileId}` : '(unset)')}</span>
        <button
          className="px-2 py-0.5 border rounded bg-white text-xs"
          title="Save current mapping, then view JSON saved in mapping_tools.config"
          onClick={async ()=>{
            try {
              // 1) Persist current editor state to server (update latest version when present)
              if (activeDomain && mapType) {
                try {
                  const cfg = (()=>{ try { return mapText ? JSON.parse(mapText) : {}; } catch { return {}; } })();
                  const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', mapType);
                  let ver = 0; try { const rl = await fetch(`/api/grabbing-sensorex/mapping/tools/latest?${p.toString()}`, { credentials:'include' }); const jl = await rl.json(); if (rl.ok && jl?.ok && jl.item) ver = Number(jl.item.version||0)||0; } catch {}
                  const body = { domain: activeDomain, page_type: mapType, config: cfg };
                  if (ver>0) body.version = ver; // update latest instead of bump
                  // Also carry selected profile and image settings so globals are persisted consistently
                  try { if (ctx?.mysqlProfileId) body.db_mysql_profile_id = Number(ctx.mysqlProfileId)||0; } catch {}
                  try { if (ctx?.imageSet && typeof ctx.imageSet==='object') body.image_setting = ctx.imageSet; } catch {}
                  await fetch('/api/grabbing-sensorex/mapping/tools', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                  // Refresh versions list cache so header reacts
                  try {
                    if (typeof refreshMapVersionsFor === 'function') await refreshMapVersionsFor(mapType);
                    else if (typeof ensureMapVersionsFor === 'function') await ensureMapVersionsFor(mapType);
                  } catch {}
                } catch {}
              }
              // 2) Fetch the saved JSON and display it
              const p2 = new URLSearchParams();
              if (activeDomain) p2.set('domain', activeDomain);
              if (mapType) p2.set('page_type', mapType);
              // Fetch the exact version applied in the header (if any); otherwise fall back to latest
              let wantedVersion = null;
              try {
                const v = Number(schemaMapVersion||0)||0;
                wantedVersion = v>0 ? v : null;
                if (v>0) p2.set('version', String(v)); else p2.set('version','latest');
              } catch { p2.set('version','latest'); }
              // Request raw DB payload without any normalization/merging
              p2.set('raw','1');
              let text = '';
              let resolvedVersion = wantedVersion;
              try {
                const r = await fetch(`/api/grabbing-sensorex/mapping/tools/get?${p2.toString()}`, { credentials:'include' });
                const c = r.headers?.get?.('content-type')||'';
                if (c.includes('application/json')) {
                  const j = await r.json().catch(()=>({}));
                  if (r.ok && j && j.item && j.item.config) {
                    text = JSON.stringify(j.item.config, null, 2);
                    try { if (j.item.version != null) resolvedVersion = Number(j.item.version)||resolvedVersion; } catch {}
                  }
                }
              } catch {}
              if (!text) {
                // Fallback to local editor state
                try { text = JSON.stringify(JSON.parse(mapText||'{}'), null, 2); } catch { text = mapText||''; }
              }
              const w = window.open('', '_blank');
              if (!w) { alert('Popup blocked'); return; }
              const safe = (s)=>String(s||'').replace(/[<>]/g, (ch)=>({"<":"&lt;",">":"&gt;"}[ch]));
              const verLabel = (resolvedVersion!=null && !Number.isNaN(resolvedVersion)) ? ` v${resolvedVersion}` : '';
              const domLabel = activeDomain ? ` – ${safe(activeDomain)}` : '';
              const typeLabel = mapType ? ` – ${safe(String(mapType))}` : '';
              const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Mapping JSON${verLabel}${domLabel}${typeLabel}</title><style>body{font:12px system-ui,sans-serif;padding:10px}.btn{font-size:12px;padding:2px 6px;border:1px solid #e5e5e5;border-radius:4px;background:#fff} textarea{width:100%;height:70vh;border:1px solid #e5e5e5;border-radius:4px;padding:8px;font:12px/1.4 ui-monospace,monospace}</style></head><body><div style=\"display:flex;justify-content:space-between;align-items:center;margin:0 0 8px 0\"><h3 style=\"margin:0\">Mapping JSON${verLabel}${domLabel}${typeLabel}</h3><button id=\"copy\" class=\"btn\">Copy</button></div><textarea readonly>${safe(text)}</textarea><script>document.getElementById('copy').onclick=function(){try{var t=document.querySelector('textarea').value;navigator.clipboard?navigator.clipboard.writeText(t):document.execCommand('copy');}catch(e){}}</script></body></html>`;
              w.document.open(); w.document.write(shell); w.document.close();
            } catch (e) { setMapMsg && setMapMsg(String(e?.message||e)); }
          }}
        >See JSON</button>
        {/* Rebuild JSON removed as requested */}
        {unsaved ? (<span className="ml-1 px-2 py-0.5 text-[10px] rounded bg-amber-100 text-amber-800">Unsaved changes</span>) : null}

        {/* Save buttons removed per request */}

        {/* Versions selector */}
        <label className="text-xs inline-flex items-center gap-1">
          Version
          <select className="border rounded px-2 py-1 text-xs" value={verSel} onChange={onVersionChange}>
            <option value="">Latest</option>
            {(verOptions||[]).map(v => (<option key={v} value={String(v)}>v{v}</option>))}
          </select>
          <button className="px-2 py-1 border rounded" title="Refresh version list" onClick={async ()=>{ try { if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType); } catch {} }}>Refresh</button>
          <span className="ml-2 text-[11px] text-gray-500">{schemaMapVersion ? `Applied v${schemaMapVersion}` : '(no version applied)'}</span>
        </label>
      </div>
    </div>
  );
}
