import React from 'react';

export default function RunsPanel({ ctx }) {
  const {
    activeDomain,
    mapType,
    mapVers,
    runs, runsBusy, runsTotal,
    runsLimit, setRunsLimit,
    runsOffset, setRunsOffset,
    runsPidFilter, setRunsPidFilter,
    runsPidFrom, setRunsPidFrom,
    runsPidTo, setRunsPidTo,
    runsHasPidFilter, setRunsHasPidFilter,
    runsSortBy, setRunsSortBy,
    runsSortDir, setRunsSortDir,
    reloadRuns,
    selectedRuns, setSelectedRuns,
    runPid, setRunPid,
    autoRuns, setAutoRuns,
    runsRefreshMs, setRunsRefreshMs,
    mysqlProfileId,
    defaultPrefix,
    forceMinComb,
    mapText, setRuns,
    exVerDict, ensureExVersionsFor,
  } = ctx || {};
  const [resendConc, setResendConc] = React.useState(3);
  const [latestPerProduct, setLatestPerProduct] = React.useState(false);
  const [runsUrlFilter, setRunsUrlFilter] = React.useState('');
  const [existsOnly, setExistsOnly] = React.useState(false);
  const [existsSet, setExistsSet] = React.useState(null); // Set of product_ids that exist in current profile

  // Prefetch latest extraction versions for page types in runs
  React.useEffect(() => {
    (async () => {
      try {
        const types = Array.from(new Set((runs||[]).map(r => String(r.page_type||'').toLowerCase()).filter(Boolean)));
        for (const t of types) { if (typeof ensureExVersionsFor==='function') await ensureExVersionsFor(t); }
      } catch {}
    })();
  }, [runs, ensureExVersionsFor]);

  // Compute display list with optional URL filter and latest-per-product dedupe
  const displayRuns = React.useMemo(() => {
    const list = Array.isArray(runs) ? runs.slice() : [];
    // URL contains filter (case-insensitive)
    const urlNeedle = String(runsUrlFilter || '').trim().toLowerCase();
    let filtered = list;
    if (urlNeedle) filtered = list.filter(r => String(r?.url||'').toLowerCase().includes(urlNeedle));
    // When an exact Product ID is set, always keep only the latest for that product
    const pidExact = Number(String(runsPidFilter||'').trim()) || 0;
    const wantLatest = !!latestPerProduct || pidExact > 0;
    if (!wantLatest && !existsOnly) return filtered;
    // Sort newest first by updated_at (fallback created_at)
    filtered.sort((a, b) => {
      const at = new Date(b?.updated_at || b?.created_at || 0).getTime();
      const bt = new Date(a?.updated_at || a?.created_at || 0).getTime();
      return at - bt;
    });
    let base = filtered;
    if (wantLatest) {
      const seen = new Set(); const out = [];
      for (const r of filtered) {
        const pid = Number(r?.product_id || 0) || 0;
        if (pid > 0) { if (seen.has(pid)) continue; seen.add(pid); out.push(r); }
        else out.push(r);
      }
      base = out;
    }
    if (existsOnly && existsSet && existsSet.size && mysqlProfileId) {
      base = base.filter(r => { const pid = Number(r?.product_id||0)||0; return pid>0 && existsSet.has(pid); });
    }
    return base;
  }, [runs, runsUrlFilter, latestPerProduct, runsPidFilter, existsOnly, existsSet, mysqlProfileId]);

  // Resolve product existence in selected profile for current display (pre-filtered list)
  React.useEffect(() => {
    (async () => {
      try {
        if (!existsOnly || !mysqlProfileId) { setExistsSet(null); return; }
        const basePrefix = (defaultPrefix && String(defaultPrefix).trim()) ? defaultPrefix : 'ps_';
        // Use unique product_ids from deduped latest list
        const ids = Array.from(new Set((Array.isArray(runs)? runs: []).map(r => Number(r?.product_id||0)||0).filter(n=>n>0)));
        if (!ids.length) { setExistsSet(new Set()); return; }
        const body = { profile_id: Number(mysqlProfileId)||0, prefix: String(basePrefix||'ps_'), ids: ids.slice(0, 2000) };
        const resp = await fetch('/api/grabbing-sensorex/mysql/products/existence', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
        const j = await resp.json().catch(()=>null);
        if (!resp.ok || (j && j.ok===false)) { setExistsSet(new Set()); return; }
        const set = new Set(Array.isArray(j?.exists)? j.exists.map(n=>Number(n)||0) : []);
        setExistsSet(set);
      } catch { setExistsSet(new Set()); }
    })();
  }, [existsOnly, mysqlProfileId, defaultPrefix, runs]);

  // Auto-enable "Latest per product" when an exact Product ID is typed
  React.useEffect(() => {
    const pid = Number(String(runsPidFilter||'').trim()) || 0;
    if (pid > 0 && !latestPerProduct) setLatestPerProduct(true);
  }, [runsPidFilter]);

  return (
    <>
      <div className="mt-3 text-sm font-semibold">Runs</div>
      <div className="text-xs text-gray-600 mb-1">Domain: <span className="font-mono">{activeDomain || '-'}</span></div>
      <div className="flex items-center gap-2 mt-1">
        <label className="text-xs">Limit
          <select className="border rounded px-2 py-1 text-xs ml-1" value={runsLimit} onChange={(e)=>setRunsLimit(Number(e.target.value||20))}>
            {[10,20,50,100,500,1000,2000].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="text-xs text-gray-600">Type <span className="font-mono">{mapType || 'product'}</span></div>
        <label className="text-xs">Product ID
          <input className="ml-1 border rounded px-2 py-0.5 text-xs w-24" type="number" min={1} value={runsPidFilter} onChange={(e)=>setRunsPidFilter(e.target.value)} placeholder="" />
        </label>
        <label className="text-xs">Range
          <input className="ml-1 border rounded px-2 py-0.5 text-xs w-24" type="number" min={1} value={runsPidFrom} onChange={(e)=>setRunsPidFrom(e.target.value)} placeholder="from" />
          <span className="mx-1">→</span>
          <input className="border rounded px-2 py-0.5 text-xs w-24" type="number" min={1} value={runsPidTo} onChange={(e)=>setRunsPidTo(e.target.value)} placeholder="to" />
        </label>
        <label className="text-xs">Has Product
          <select className="border rounded px-2 py-1 text-xs ml-1" value={String(runsHasPidFilter||'')} onChange={(e)=>setRunsHasPidFilter(e.target.value)} title="Filter by presence of product_id when Product ID is not set">
            <option value="">any</option>
            <option value="true">yes</option>
            <option value="false">no</option>
          </select>
        </label>
        <label className="text-xs">URL
          <input className="ml-1 border rounded px-2 py-0.5 text-xs w-64" type="text" value={runsUrlFilter} onChange={(e)=>setRunsUrlFilter(e.target.value)} placeholder="contains…" />
        </label>
        <label className="text-xs inline-flex items-center gap-1" title="Show only the latest run per product_id">
          <input type="checkbox" checked={!!latestPerProduct} onChange={(e)=>setLatestPerProduct(!!e.target.checked)} /> Latest per product
        </label>
        <label className="text-xs inline-flex items-center gap-1" title="Show only runs whose product exists in the selected MySQL profile">
          <input type="checkbox" checked={!!existsOnly} onChange={(e)=>setExistsOnly(!!e.target.checked)} disabled={!mysqlProfileId} /> Exists in profile
        </label>
        {/* Inline badge with counts close to the filters */}
        <span className="ml-2 px-2 py-0.5 text-[11px] rounded border bg-gray-50 text-gray-700">
          Rows: <span className="font-mono">{Array.isArray(displayRuns) ? displayRuns.length : 0}</span>
          {' · '}Sel: <span className="font-mono">{Object.keys(selectedRuns||{}).length}</span>
        </span>
        <label className="text-xs">Sort
          <select className="border rounded px-2 py-1 text-xs ml-1" value={runsSortBy} onChange={(e)=>setRunsSortBy(e.target.value)}>
            {['created_at','product_id','id','version'].map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <select className="border rounded px-2 py-1 text-xs ml-1" value={runsSortDir} onChange={(e)=>setRunsSortDir(e.target.value)}>
            {['desc','asc'].map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={async ()=>{ if (typeof reloadRuns==='function') await reloadRuns(); }}>Refresh</button>
        {/* Counts: rows (visible/total) and selected */}
        <div className="text-xs text-gray-600">
          Rows: <span className="font-mono">{Array.isArray(displayRuns) ? displayRuns.length : 0}</span>
          {' · '}Selected: <span className="font-mono">{Object.keys(selectedRuns||{}).length}</span>
        </div>
        <label className="text-xs inline-flex items-center gap-1">
          Concurrency
          <input className="w-12 border rounded px-1 py-0.5 text-xs" type="number" min={1} max={10} value={resendConc} onChange={(e)=>setResendConc(Math.max(1, Math.min(10, Number(e.target.value||3))))} />
        </label>
        <button
          className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
          title={!mysqlProfileId? 'Select a MySQL profile in Step 3' : ''}
          disabled={!Object.keys(selectedRuns||{}).length || runsBusy || !mysqlProfileId}
          onClick={async ()=>{
            const ids = Object.keys(selectedRuns||{}).map(n=>Number(n)||0).filter(n=>n>0);
            if (!ids.length) return;
            if (!mysqlProfileId) { alert('Select a MySQL profile first (Step 3)'); return; }

            const w = window.open('', 'gs_mass_resend', 'width=900,height=600');
            if (!w) { alert('Popup blocked. Please allow popups.'); return; }
            const write = (html)=>{ try { const el=w.document.getElementById('content'); el.innerHTML += html; el.scrollTop = el.scrollHeight; } catch (e) {} };
            const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Mass Resend</title><style>body{font:12px system-ui, sans-serif;padding:10px} .muted{color:#666} .ok{color:#166534} .err{color:#991b1b} pre{white-space:pre-wrap;word-break:break-word}</style></head><body><h3 style=\"margin:0\">Mass Resend (update)</h3><div class=\"muted\">${ids.length} run(s), ${resendConc} parallel</div><div id=\"content\" style=\"border:1px solid #ddd; padding:8px; height:460px; overflow:auto\"></div></body></html>`;
            w.document.open(); w.document.write(shell); w.document.close();
            write(`<div>Starting…</div>`);

            try {
              const lim = Math.max(1, Math.min(10, Number(resendConc||3)));
              const runConcurrent = async (arr, limit, worker) => new Promise((resolve) => {
                let i = 0, active = 0; const n = arr.length;
                const pump = () => {
                  while (active < limit && i < n) {
                    const item = arr[i++]; active++;
                    Promise.resolve(worker(item)).catch(()=>{})
                      .finally(() => { active--; if (i < n) pump(); else if (active===0) resolve(); });
                  }
                };
                pump();
              });
              await runConcurrent(ids, lim, async (id) => {
                try {
                  const row = (runs||[]).find(r => Number(r.id||0) === Number(id));
                  const t = row ? String(row.page_type||'').toLowerCase() : '';
                  // Ensure latest extraction version list is loaded for this type
                  try { if (t && typeof ensureExVersionsFor==='function' && (!exVerDict || !exVerDict[t] || !exVerDict[t].length)) await ensureExVersionsFor(t); } catch {}
                  const list = t && exVerDict ? exVerDict[t] : null;
                  const latest = Array.isArray(list) && list.length ? list.reduce((m,it)=>Math.max(m, Number(it?.version||0)||0), 0) : 0;
                  let useRunId = id;
                  if (row && latest > 0) {
                    // Re-extract with latest version and save a fresh run
                    write(`<div class=\"muted\">Run ${id}: re-extracting with v${latest}…</div>`);
                    const body = { url: row.url, domain: activeDomain, page_type: t || row.page_type || 'product', version: latest, save: true, update_run_id: id };
                    try {
                      const r2 = await fetch('/api/grabbing-sensorex/extraction/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                      const j2 = await r2.json().catch(()=>null);
                      if (r2.ok && j2?.ok && j2?.run_id) { useRunId = Number(j2.run_id)||useRunId; write(`<div class=\"muted\">Run ${id}: updated run ${useRunId}</div>`); }
                      else { write(`<div class=\"err\">Run ${id}: re-extract failed – ${String((j2 && (j2.message||j2.error)) || r2.status)}</div>`); }
                    } catch (e) { write(`<div class=\"err\">Run ${id}: re-extract error – ${String(e?.message||e)}</div>`); }
                  }
                  const mt = String(row?.page_type || mapType || '').toLowerCase();
                  const mapVer = (mapVers && typeof mapVers==='object') ? Number(mapVers[mt]||0) || 0 : 0;
                  write(`<div class=\"muted\">Run ${id}: sending (run ${useRunId}) · ext v${latest||'?'} · map v${mapVer||'?'}…</div>`);
                  const resp = await fetch('/api/grabbing-sensorex/transfer/prestashop', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ run_id: useRunId, profile_id: mysqlProfileId, write: true, mode: 'upsert', force_min_combination: !!forceMinComb, mapping_version: mapVer>0? mapVer: undefined }) });
                  let j=null, body='';
                  try { const ct = resp.headers.get('content-type')||''; if (ct.includes('application/json')) j = await resp.json(); else body = await resp.text(); }
                  catch { try { body = await resp.text(); } catch {} }
                  if (!resp.ok || (j && j.ok===false)) write(`<div class=\"err\">Run ${id}: failed – ${String((j && (j.message||j.error)) || (body? 'non_json_'+resp.status : resp.status))}</div>`);
                  else if (j) write(`<div class=\"ok\">Run ${id}: OK (product_id=${j?.product_id ?? ''}) · ext v${latest||'?'} · map v${mapVer||'?'} </div>`);
                  else write(`<div class=\"ok\">Run ${id}: Completed (status ${resp.status})</div>`);
                } catch (e) {
                  write(`<div class=\"err\">Run ${id}: error – ${String(e?.message||e)}</div>`);
                }
              });
            } finally {
              try { if (typeof reloadRuns==='function') await reloadRuns(); } catch (e) {}
              write('<div class=\"muted\">Done.</div>');
            }
          }}
        >Resend selected</button>
        <label className="text-xs inline-flex items-center gap-1 ml-2">
          <input type="checkbox" checked={!!autoRuns} onChange={(e)=>setAutoRuns(e.target.checked)} /> Auto refresh
        </label>
        <label className="text-xs inline-flex items-center gap-1">
          every
          <input className="w-14 border rounded px-1 py-0.5 text-xs" type="number" min={2} max={120} value={Math.round((runsRefreshMs||0)/1000)||8} onChange={(e)=>setRunsRefreshMs(Math.max(2000, Number(e.target.value||8)*1000))} />s
        </label>
        <button className="px-3 py-1.5 rounded border bg-white hover:bg-red-50 text-sm disabled:opacity-60" disabled={!Object.keys(selectedRuns||{}).length || runsBusy}
          onClick={async ()=>{
            const ids = Object.keys(selectedRuns||{}).map(n=>Number(n)||0).filter(n=>n>0);
            if (!ids.length) return;
            if (!window.confirm(`Delete ${ids.length} selected run(s)?`)) return;
            try {
              const resp = await fetch('/api/grabbing-sensorex/extraction/history/delete', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ ids }) });
              const j = await resp.json();
              if (!resp.ok || j?.ok===false) { alert(String(j?.message||j?.error||'delete_failed')); return; }
            } catch (e) { alert(String(e?.message||e)); return; }
            if (typeof reloadRuns==='function') await reloadRuns();
          }}>Delete selected</button>
      </div>

      <div className="max-h-80 overflow-auto border rounded scroll-smooth">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 border-b sticky top-0">
            <tr>
              <th className="px-2 py-1 text-left"><input type="checkbox" checked={(displayRuns||[]).length>0 && (displayRuns||[]).every(x=>selectedRuns?.[x.id])} onChange={(e)=>{
                const on = e.target.checked; const next={}; if (on) { for (const it of (displayRuns||[])) next[it.id]=true; }
                if (typeof setSelectedRuns==='function') setSelectedRuns(next);
              }} /></th>
              <th className="px-2 py-1 text-left">ID</th>
              <th className="px-2 py-1 text-left">URL</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Ext v</th>
              <th className="px-2 py-1 text-left">Map v</th>
              <th className="px-2 py-1 text-left">Product ID</th>
              <th className="px-2 py-1 text-left">Updated</th>
              <th className="px-2 py-1 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {(displayRuns||[]).map(r => (
              <tr key={r.id} className="border-b">
                <td className="px-2 py-1"><input type="checkbox" checked={!!(selectedRuns||{})[r.id]} onChange={(e)=>{
                  const on = e.target.checked; if (typeof setSelectedRuns!=='function') return; setSelectedRuns(prev => { const n={...prev}; if (on) n[r.id]=true; else delete n[r.id]; return n; });
                }} /></td>
                <td className="px-2 py-1">{r.id}</td>
                <td className="px-2 py-1 truncate max-w-[24rem]" title={r.url||''}><a className="text-indigo-600 hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.url||''}</a></td>
                <td className="px-2 py-1">{r.page_type||''}</td>
                <td className="px-2 py-1">{(function(){
                  const t = String(r.page_type||'').toLowerCase();
                  const list = (exVerDict && exVerDict[t]) ? exVerDict[t] : [];
                  const latest = Array.isArray(list) && list.length ? list.reduce((m, it)=>Math.max(m, Number(it?.version||0)||0), 0) : 0;
                  return latest ? `v${latest}` : '';
                })()}</td>
                <td className="px-2 py-1">{(function(){ const v = (mapVers||{})[String(r.page_type||'').toLowerCase()]; return v ? `v${v}` : ''; })()}</td>
                <td className="px-2 py-1">{r.product_id != null ? String(r.product_id) : ''}</td>
                <td className="px-2 py-1 whitespace-nowrap">{(r.updated_at || r.created_at || '').toString().replace('T',' ').slice(0,19)}</td>
                <td className="px-2 py-1 space-x-2">
                  {/* Get category (Step 5) */}
                  <button className="px-2 py-1 rounded border text-xs disabled:opacity-60"
                    disabled={runsBusy}
                    title="Extract category from this run and store it"
                    onClick={async ()=>{
                      try {
                        const body = { run_id: r.id };
                        if (r.product_id != null) body.product_id = r.product_id;
                        const resp = await fetch('/api/grabbing-sensorex/category/extract', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                        const j = await resp.json().catch(()=>null);
                        if (!resp.ok || (j && j.ok===false)) { alert(String((j && (j.message||j.error)) || `extract_failed (${resp.status})`)); return; }
                        alert(`Saved category: ${j?.category || ''} (product_id=${j?.product_id || ''})`);
                      } catch (e) { alert(String(e?.message||e)); }
                    }}
                  >Get category</button>
                  {/* See upsert (preview only; no writes) */}
                  <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={!mysqlProfileId || runsBusy}
                    title={!mysqlProfileId? 'Select a MySQL profile in Step 3' : 'Preview the upsert plan (no write)'}
                    onClick={async ()=>{
                      if (!mysqlProfileId) { alert('Select a MySQL profile first (Step 3)'); return; }
                      try {
                        const pt = r.page_type || mapType;
                        // Load mapping: prefer editor mapText; fallback to saved mapping
                        let mappingObj = null;
                        try { mappingObj = mapText ? JSON.parse(mapText) : null; } catch { mappingObj = null; }
                        if (!mappingObj) {
                          try {
                            const tr = await fetch(`/api/grabbing-sensorex/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(pt)}`, { credentials:'include' });
                            const tj = await tr.json();
                            mappingObj = (tr.ok && tj?.ok) ? ((tj.unified && tj.unified.config) || tj.mapping || {}) : {};
                          } catch { mappingObj = {}; }
                        }
                        let w = window.open('', '_blank');
                        if (!w) { alert('Popup blocked'); return; }
                        const safe = (s)=>String(s||'').replace(/[<>]/g, c=>({"<":"&lt;",">":"&gt;"}[c]));
                        const write = (html)=>{ try { w.document.getElementById('content').innerHTML = html; } catch (e) {} };
                        const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>See Upsert (Preview)</title><style>
                          body{font:12px system-ui, sans-serif;padding:10px}
                          .hdr{margin:0 0 8px 0}
                          .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
                          .sec{margin-bottom:12px}
                          .title{font-weight:600;margin:4px 0}
                          .titleBar{display:flex;justify-content:space-between;align-items:center;gap:8px}
                          .copy{font-size:12px;padding:2px 6px;border:1px solid #e5e5e5;border-radius:4px;background:#fff}
                          textarea, pre{width:100%;min-height:260px}
                          pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:4px;padding:8px}
                          textarea{border:1px solid #e5e5e5;border-radius:4px;padding:8px;background:#fff}
                        </style><script>
                          function copy(id){
                            try{var el=document.getElementById(id);var text=el?(el.tagName==='TEXTAREA'?el.value:el.textContent):'';
                              if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).catch(fallback);}else{fallback();}
                              function fallback(){try{var ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}catch(e){}}
                              var btn=document.getElementById('btn_'+id);if(btn){var old=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=old;},1200);} }catch(e){}
                          }
                        </script></head><body><h3 class=\"hdr\">See Upsert (Preview) – Run ${r.id} – ${pt}</h3><div id=\"content\">Starting…</div></body></html>`;
                        w.document.open(); w.document.write(shell); w.document.close();

                        // Preview upsert (no write)
                        let upResText = '';
                        let sqlBlocksHtml = '';
                        let reqParams = {};
                        try {
                          reqParams = { run_id: r.id, profile_id: mysqlProfileId };
                          if (r.product_id != null && Number(r.product_id) > 0) reqParams.product_id = Number(r.product_id);
                          if (mappingObj && typeof mappingObj==='object') reqParams.mapping = mappingObj;
                          const resp = await fetch('/api/grabbing-sensorex/transfer/prestashop/preview-tables', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(reqParams) });
                          let j=null, body='';
                          try { const ct = resp.headers.get('content-type')||''; if (ct.includes('application/json')) j = await resp.json(); else body = await resp.text(); }
                          catch { try { body = await resp.text(); } catch {} }
                          upResText = j ? JSON.stringify(j, null, 2) : JSON.stringify({ error: `non_json_${resp.status}`, body: body ? String(body).slice(0, 400) : undefined }, null, 2);
                          try {
                            // Build pseudo-SQL per table (preview from plan)
                            const plan = j && j.plan ? j.plan : {};
                            const esc = (s)=>String(s).replace(/`/g,'``');
                            const escVal = (v)=>{
                              if (v === null || v === undefined) return 'NULL';
                              if (typeof v === 'number') return String(v);
                              if (typeof v === 'boolean') return v ? '1' : '0';
                              return '\''+String(v).replace(/\\/g,'\\\\').replace(/'/g,"\\'")+'\'';
                            };
                            const mkInsertUpsert = (table, row, keyCols=[]) => {
                              const cols = Object.keys(row||{});
                              if (!cols.length) return '';
                              const vals = cols.map(c => escVal(row[c]));
                              const set = cols.filter(c => !keyCols.includes(c)).map(c => '\\`'+esc(c)+'\\`=VALUES(\\`'+esc(c)+'\\`)');
                              return 'INSERT INTO \\`'+esc(table)+'\\` ('+cols.map(c=>'\\`'+esc(c)+'\\`').join(',')+') VALUES ('+vals.join(',')+')'+(set.length? ' ON DUPLICATE KEY UPDATE '+set.join(', '): '')+';';
                            };
                            const blocks = [];
                            if (plan.product && plan.product.table) {
                              const T = String(plan.product.table);
                              const ins = mkInsertUpsert(T, plan.product.insert||{}, ['id_product']);
                              const upd = plan.product.update || {};
                              const updSet = Object.keys(upd).map(c=>'\\`'+esc(c)+'\\`='+escVal(upd[c]));
                              const updSql = updSet.length ? 'UPDATE \\`'+esc(T)+'\\` SET '+updSet.join(', ')+' WHERE \\`id_product\\`='+escVal(plan.product.product_id||0)+';' : '';
                              blocks.push({ name: T, sql: [ins, updSql].filter(Boolean).join('\\n') });
                            }
                            const handleArr = (label, arr, keyCols) => {
                              if (!Array.isArray(arr) || !arr.length) return;
                              const sql = arr.map(it => mkInsertUpsert(String(it.table||label), it.columns||{}, keyCols)).filter(Boolean).join('\\n');
                              if (sql) blocks.push({ name: label, sql });
                            };
                            handleArr('product_shop', plan.product_shop, ['id_product','id_shop']);
                            handleArr('product_lang', plan.product_lang, ['id_product','id_lang','id_shop']);
                            handleArr('stock_available', plan.stock_available, ['id_product','id_product_attribute','id_shop','id_shop_group']);
                            // Extended previews
                            handleArr('image', plan.image, ['id_product','position']);
                            handleArr('image_shop', plan.image_shop, ['id_image','id_shop']);
                            handleArr('image_lang', plan.image_lang, ['id_image','id_lang']);
                            handleArr('attachment', plan.attachment, ['file']);
                            handleArr('attachment_lang', plan.attachment_lang, ['id_attachment','id_lang']);
                            handleArr('attachment_shop', plan.attachment_shop, ['id_attachment','id_shop']);
                            handleArr('product_attachment', plan.product_attachment, ['id_product','id_attachment']);
                            handleArr('attribute_group_lang', plan.attribute_group_lang, ['id_attribute_group','id_lang']);
                            handleArr('attribute_lang', plan.attribute_lang, ['id_attribute','id_lang']);
                            handleArr('product_attribute', plan.product_attribute, ['id_product','id_product_attribute']);
                            handleArr('product_attribute_shop', plan.product_attribute_shop, ['id_product','id_product_attribute','id_shop']);
                            handleArr('product_attribute_combination', plan.product_attribute_combination, ['id_attribute','id_product_attribute']);
                            if (plan.extra && typeof plan.extra==='object') {
                              const keys = Object.keys(plan.extra).sort((a,b)=>a.localeCompare(b));
                              for (const k of keys) handleArr(k, plan.extra[k], []);
                            }
                            sqlBlocksHtml = blocks.map((b, idx) => {
                              const id = 'sql_'+idx;
                              const enc = String(b.sql||'').replace(/[<>]/g, c=>({"<":"&lt;", ">":"&gt;"}[c]));
                              return '<details><summary><strong>'+b.name+'</strong></summary><div class=\\\\"titleBar\\\\"><div class=\\\\"title\\\\">'+b.name+' queries</div><button id=\\\\"btn_'+id+'\\\\" class=\\\\"copy\\\\" onclick=\\\\"copy(\''+id+'\')\\\\">Copy SQL</button></div><pre id=\\\\"'+id+'\\\\">'+enc+'</pre></details>';
                            }).join('\\n');
                          } catch (e) {}
                        } catch (e) {
                          upResText = JSON.stringify({ ok:false, error: String(e?.message||e) }, null, 2);
                        }

                        const html = `
                          <div class=\"sec\">
                            <div class=\"title\">Request</div>
                            <div class=\"grid\">
                              <div>
                                <details><summary><div class=\"titleBar\"><div class=\"title\">Mapping config</div><button id=\"btn_upmap\" class=\"copy\" onclick=\"copy('upmap')\">Copy JSON</button></div></summary>
                                  <textarea id=\"upmap\" readonly>${safe(JSON.stringify(mappingObj, null, 2))}</textarea>
                                </details>
                              </div>
                              <div>
                                <details><summary><div class=\"titleBar\"><div class=\"title\">Parameters</div><button id=\"btn_upreq\" class=\"copy\" onclick=\"copy('upreq')\">Copy JSON</button></div></summary>
                                  <pre id=\"upreq\">${safe(JSON.stringify(reqParams, null, 2))}</pre>
                                </details>
                              </div>
                            </div>
                          </div>
                          <div class=\"sec\">
                            <div class=\"title\">Preview</div>
                            <div class=\"grid\">
                              <div style=\"grid-column:1 / span 2\"> 
                                <details><summary><div class=\"titleBar\"><div class=\"title\">Result</div><button id=\"btn_upres\" class=\"copy\" onclick=\"copy('upres')\">Copy JSON</button></div></summary>
                                  <pre id=\"upres\">${safe(upResText)}</pre>
                                </details>
                              </div>
                            </div>
                          </div>
                          <div class=\"sec\">\n                            <div class=\"title\">Queries (preview)</div>\n                            <div>${sqlBlocksHtml || '<div class=\\"text-xs\\">No queries generated.</div>'}</div>\n                          </div>
                        `;
                        write(html);
                      } catch (e) { alert(String(e?.message||e)); }
                    }}>See upsert</button>

                  {/* See JSON popup */}
                  <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={runsBusy} title="See extraction and mapping JSON" onClick={async ()=>{
                    try {
                      const pt = r.page_type || mapType;
                      // Re-extract with latest version if available, then load that run
                      let viewRunId = r.id;
                      try {
                        const t = String(pt||'').toLowerCase();
                        try { if (t && typeof ensureExVersionsFor==='function' && (!exVerDict || !exVerDict[t] || !exVerDict[t].length)) await ensureExVersionsFor(t); } catch {}
                        const list = exVerDict && exVerDict[t] ? exVerDict[t] : [];
                        const latest = Array.isArray(list) && list.length ? list.reduce((m,it)=>Math.max(m, Number(it?.version||0)||0), 0) : 0;
                        if (latest > 0) {
                          const body = { url: r.url, domain: activeDomain, page_type: t, version: latest, save: true, update_run_id: r.id };
                      const rr2 = await fetch('/api/grabbing-sensorex/extraction/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                          const jj2 = await rr2.json().catch(()=>null);
                          if (rr2.ok && jj2?.ok && jj2?.run_id) viewRunId = Number(jj2.run_id)||viewRunId;
                        }
                      } catch {}
                      const rResp = await fetch(`/api/grabbing-sensorex/extraction/history/${encodeURIComponent(viewRunId)}?include=full`, { credentials:'include' });
                      let rJson=null, rBody='';
                      try { const ct = rResp.headers.get('content-type')||''; if (ct.includes('application/json')) rJson = await rResp.json(); else rBody = await rResp.text(); }
                      catch { try { rBody = await rResp.text(); } catch {} }
                      if (!rResp.ok || (rJson && rJson.ok===false)) { alert(String((rJson && (rJson.message||rJson.error)) || (rBody? 'non_json_'+rResp.status : 'load_failed'))); return; }
                      if (!rJson) { alert(`non_json_${rResp.status}`); return; }
                      const it = rJson.item || rJson;
                      const extractCfg = JSON.stringify(it.config || {}, null, 2);
                      const extractRes = JSON.stringify(it.result || {}, null, 2);
                      const extractVer = Number(it.version || 0) || 0;
                      const tr = await fetch(`/api/grabbing-sensorex/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(pt)}`, { credentials:'include' });
                      let tj=null, tb='';
                      try { const ct = tr.headers.get('content-type')||''; if (ct.includes('application/json')) tj = await tr.json(); else tb = await tr.text(); }
                      catch { try { tb = await tr.text(); } catch {} }
                      let mapBase = (tr.ok && tj && tj.ok) ? (tj.mapping || {}) : {};
                      mapBase = mapBase && typeof mapBase==='object' ? mapBase : {};
                      mapBase.tables = mapBase.tables && typeof mapBase.tables==='object' ? mapBase.tables : {};
                      // drop top-level defaults; use fields only
                      const mv = Number(tj?.mapping_version || (tj?.unified?.version || 0)) || 0;
                      const ts = await fetch(`/api/grabbing-sensorex/table-settings?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(pt)}`, { credentials:'include' });
                      let tsj=null, tsb='';
                      try { const ct = ts.headers.get('content-type')||''; if (ct.includes('application/json')) tsj = await ts.json(); else tsb = await ts.text(); }
                      catch { try { tsb = await ts.text(); } catch {} }
                      if (ts.ok && tsj && tsj.ok && Array.isArray(tsj.items)) {
                        for (const row of tsj.items) {
                          const t = String(row.table_name||'').trim(); if (!t) continue;
                          mapBase.tables[t] = mapBase.tables[t] && typeof mapBase.tables[t]==='object' ? mapBase.tables[t] : {};
                          if (row.mapping && typeof row.mapping==='object') {
                            const mf = row.mapping.fields && typeof row.mapping.fields==='object' ? row.mapping.fields : {};
                            mapBase.tables[t].fields = { ...(mapBase.tables[t].fields||{}), ...mf };
                          }
                          if (row.settings && typeof row.settings==='object') {
                            mapBase.tables[t].settings = { ...(mapBase.tables[t].settings||{}), ...row.settings };
                          }
                        }
                      }
                      const mappingJson = JSON.stringify(mapBase||{}, null, 2);

                      // Mapping preview/result (requires profile)
                      let mappingPrev = '';
                      try {
                        if (mysqlProfileId) {
                          const body = { run_id: r.id, profile_id: mysqlProfileId };
                          const pr = await fetch('/api/grabbing-sensorex/transfer/prestashop/preview-tables', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                          let pj=null, pb='';
                          try { const ct = pr.headers.get('content-type')||''; if (ct.includes('application/json')) pj = await pr.json(); else pb = await pr.text(); }
                          catch { try { pb = await pr.text(); } catch {} }
                          if (pr.ok && pj) mappingPrev = JSON.stringify(pj, null, 2);
                          else mappingPrev = JSON.stringify({ error: pj?.error||pj?.message||(`non_json_${pr.status}`), body: pb ? String(pb).slice(0, 400) : undefined }, null, 2);
                        } else {
                          mappingPrev = JSON.stringify({ message: 'Select a MySQL profile in Step 3 to preview mapping result.' }, null, 2);
                        }
                      } catch (e) {
                        mappingPrev = JSON.stringify({ error: String(e?.message||e) }, null, 2);
                      }

                      let w = window.open('', '_blank');
                      if (!w) { alert('Popup blocked'); return; }
                      const write = (html)=>{ try { w.document.getElementById('content').innerHTML = html; } catch (e) {} };
                      const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>See JSON</title><style>
                        body{font:12px system-ui, sans-serif;padding:10px}
                        .hdr{margin:0 0 8px 0}
                        .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
                        .sec{margin-bottom:12px}
                        .title{font-weight:600;margin:4px 0}
                        .titleBar{display:flex;justify-content:space-between;align-items:center;gap:8px}
                        .copy{font-size:12px;padding:2px 6px;border:1px solid #e5e5e5;border-radius:4px;background:#fff}
                        textarea, pre{width:100%;min-height:260px}
                        pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:4px;padding:8px}
                        textarea{border:1px solid #e5e5e5;border-radius:4px;padding:8px;background:#fff}
                      </style><script>
                        function copy(id){
                          try{
                            var el=document.getElementById(id);
                            var text=el? (el.tagName==='TEXTAREA'? el.value: el.textContent): '';
                            if(navigator.clipboard && navigator.clipboard.writeText){
                              navigator.clipboard.writeText(text).catch(fallback);
                            } else { fallback(); }
                            function fallback(){ try{ var ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);}catch(e){} }
                            var btn=document.getElementById('btn_'+id); if(btn){ var old=btn.textContent; btn.textContent='Copied'; setTimeout(function(){ btn.textContent=old; },1200); }
                          }catch(e){}
                        }
                      </script></head><body><h3 class=\"hdr\">Run ${viewRunId} – ${pt} ${extractVer?`(ext v${extractVer})`:''} · mapping v${mv||'?'} </h3><div id=\"content\">Loading…</div></body></html>`;
                      w.document.open(); w.document.write(shell); w.document.close();
                      const safe = (s)=>s.replace(/[<>]/g, c=>({"<":"&lt;",">":"&gt;"}[c]));
                      const html = `
                        <div class=\"sec\">
                          <div class=\"title\">Extraction</div>
                          <div class=\"grid\">
                            <div>
                              <div class=\"titleBar\"><div class=\"title\">Extraction config ${extractVer?`(v${extractVer})`:''}</div><button id=\"btn_cfg\" class=\"copy\" onclick=\"copy('cfg')\">Copy JSON</button></div>
                              <textarea id=\"cfg\" readonly>${safe(extractCfg)}</textarea>
                            </div>
                            <div>
                              <div class=\"titleBar\"><div class=\"title\">Extraction result</div><button id=\"btn_res\" class=\"copy\" onclick=\"copy('res')\">Copy JSON</button></div>
                              <pre id=\"res\">${safe(extractRes)}</pre>
                            </div>
                          </div>
                        </div>
                        <div class=\"sec\">
                          <div class=\"title\">Mapping</div>
                          <div class=\"grid\">
                            <div>
                              <div class=\"titleBar\"><div class=\"title\">Mapping config ${mv?`(v${mv})`:''}</div><button id=\"btn_mapcfg\" class=\"copy\" onclick=\"copy('mapcfg')\">Copy JSON</button></div>
                              <textarea id=\"mapcfg\" readonly>${safe(mappingJson)}</textarea>
                            </div>
                            <div>
                              <div class=\"titleBar\"><div class=\"title\">Mapping result</div><button id=\"btn_mapprev\" class=\"copy\" onclick=\"copy('mapprev')\">Copy JSON</button></div>
                              <pre id=\"mapprev\">${safe(mappingPrev)}</pre>
                            </div>
                          </div>
                        </div>
                      `;
                      write(html);
                    } catch (e) { alert(String(e?.message||e)); }
                  }}>See JSON</button>

                  {/* Resend/update if we already know product_id */}
                  {r.product_id ? (
                    <span className="inline-flex items-center gap-1">
                    <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={!mysqlProfileId || runsBusy} onClick={async ()=>{
                      if (!mysqlProfileId) { alert('Select a MySQL profile first (Step 3)'); return; }
                      let w = window.open('', '_blank');
                      if (!w) { alert('Popup blocked'); return; }
                      const write = (html)=>{ try { w.document.getElementById('content').innerHTML += html; } catch (e) {} };
                      const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Resend (update)</title><style>body{font:12px system-ui, sans-serif;padding:10px} .muted{color:#666} .ok{color:#166534} .err{color:#991b1b}</style></head><body><h3 style=\"margin:0\">Resend (update) – Run ${r.id}</h3><div class=\"muted\">product_id=${r.product_id}</div><div id=\"content\"></div></body></html>`;
                      w.document.open(); w.document.write(shell); w.document.close();
                      write('<div>Starting…</div>');
                      try {
                        // Resolve latest extraction and mapping versions
                        const t = String(r.page_type||mapType||'').toLowerCase();
                        try { if (t && typeof ensureExVersionsFor==='function' && (!exVerDict || !exVerDict[t] || !exVerDict[t].length)) await ensureExVersionsFor(t); } catch {}
                        const list = t && exVerDict ? exVerDict[t] : [];
                        const latest = Array.isArray(list) && list.length ? list.reduce((m,it)=>Math.max(m, Number(it?.version||0)||0), 0) : 0;
                        const mapVer = (mapVers && typeof mapVers==='object') ? Number(mapVers[t]||0) || 0 : 0;
                        if (latest > 0) {
                          write(`<div class=\"muted\">Re-extracting with ext v${latest}…</div>`);
                          const body = { url: r.url, domain: activeDomain, page_type: t||'product', version: latest, save: true, update_run_id: r.id };
                          const er = await fetch('/api/grabbing-sensorex/extraction/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                          let ej=null; try { ej = await er.json(); } catch {}
                          if (!er.ok || ej?.ok===false) write(`<div class=\"err\">Re-extract failed: ${String(ej?.message||ej?.error||er.status)}</div>`);
                          else write(`<div class=\"muted\">Run updated with ext v${latest}</div>`);
                        }
                        write(`<div>Posting to /transfer/prestashop… (ext v${latest||'?'} · map v${mapVer||'?'} )</div>`);
                        const resp = await fetch('/api/grabbing-sensorex/transfer/prestashop', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ run_id: r.id, product_id: r.product_id, profile_id: mysqlProfileId, write: true, force_min_combination: !!forceMinComb, mapping_version: mapVer>0? mapVer: undefined }) });
                        let j={}; try { j = await resp.json(); } catch (e) {}
                        if (!resp.ok || j?.ok===false) { write(`<div class=\"err\">Failed: ${String(j?.message||j?.error||resp.status)}</div>`); return; }
                        write(`<div class=\"ok\">OK – updated: ${j?.updated? 'yes':'no'} · ext v${j?.used_version ?? latest ?? '?'} · map v${j?.mapping_version ?? mapVer ?? '?'}</div>`);
                        write(`<div class=\"muted\">product_id=${j?.product_id || r.product_id}</div>`);
                        try {
                          const ri = j?.details?.images?.remote;
                          if (ri && ri.used) {
                            write(`<div class=\"muted\">Image server: ${ri.protocol || '?'} (profile #${ri.ftp_profile_id ?? ''})</div>`);
                            if (ri.remote_dir) write(`<div class=\"muted\">Folder: ${ri.remote_dir}</div>`);
                            if (ri.error) {
                              write(`<div class=\"err\">Remote upload failed: ${String(ri.error)}</div>`);
                            }
                            write(`<div class=\"muted\">Files sent: ${ri.files_sent ?? 0}</div>`);
                          }
                        } catch {}
                        if (typeof reloadRuns==='function') await reloadRuns();
                      } catch (e) { write(`<div class=\"err\">Error: ${String(e?.message||e)}</div>`); }
                    }}>Resend (update)</button>
                    </span>
                  ) : null}

                  {/* Progress view removed */}

                  {/* Force update by manual product id if unknown */}
                  {!r.product_id ? (
                    <span className="inline-flex items-center gap-1">
                      <input className="border rounded px-2 py-1 w-24 text-xs" placeholder="Product ID" value={(runPid||{})[r.id]||''} onChange={(e)=>setRunPid(prev=>({ ...prev, [r.id]: e.target.value }))} />
                      <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={!mysqlProfileId || runsBusy || !((runPid||{})[r.id]||'').trim()} onClick={async ()=>{
                        const pid = Number(((runPid||{})[r.id]||'').trim());
                        if (!Number.isFinite(pid) || pid<=0) { alert('Enter a valid product id'); return; }
                        try {
                          let obj = {};
                          try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { alert('Invalid mapping JSON: '+(e?.message||e)); return; }
                          const resp = await fetch('/api/grabbing-sensorex/transfer/prestashop', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ run_id: r.id, product_id: pid, profile_id: mysqlProfileId, mapping: obj, write: true, force_min_combination: !!forceMinComb }) });
                          let j=null, body='';
                          try { const ct=resp.headers.get('content-type')||''; if (ct.includes('application/json')) j = await resp.json(); else body = await resp.text(); }
                          catch { try { body = await resp.text(); } catch {} }
                          if (!resp.ok || (j && j.ok===false)) { alert(String((j && (j.message||j.error)) || (body? 'non_json_'+resp.status : 'update_failed'))); return; }
                          // Source of truth is DB; refresh from server instead of locally mutating
                          if (typeof reloadRuns==='function') await reloadRuns();
                          alert(`Updated product_id=${pid}. ${j?.updated?'[updated]':''}`);
                        } catch (e) { alert(String(e?.message||e)); }
                      }}>Update by ID</button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-2 mt-2">
        <button className="px-3 py-1 rounded border text-xs disabled:opacity-60" disabled={runsOffset<=0 || runsBusy} onClick={async ()=>{
          const newOffset = Math.max(0, (runsOffset||0) - (runsLimit||20));
          if (typeof setRunsOffset==='function') setRunsOffset(newOffset);
          if (!activeDomain) return;
          try {
            const params = new URLSearchParams();
            params.set('domain', activeDomain);
            params.set('limit', String(runsLimit||20));
            params.set('offset', String(newOffset));
            params.set('include', 'full');
            if (String(runsPidFilter||'').trim()!=='') { const pid=Number(runsPidFilter)||0; if (pid>0) params.set('product_id', String(pid)); }
            if (runsSortBy) params.set('sort_by', String(runsSortBy));
            if (runsSortDir) params.set('sort_dir', String(runsSortDir));
            const r = await fetch(`/api/grabbing-sensorex/extraction/history?${params.toString()}`, { credentials:'include' });
            const j = await r.json();
            if (r.ok && j?.ok && typeof setRuns==='function') { setRuns(j.items||[]); }
          } catch (e) {}
        }}>Prev</button>
        <button className="px-3 py-1 rounded border text-xs disabled:opacity-60" disabled={(runsOffset||0) + (runs?.length||0) >= (runsTotal||0) || runsBusy} onClick={async ()=>{
          const newOffset = (runsOffset||0) + (runsLimit||20);
          if (typeof setRunsOffset==='function') setRunsOffset(newOffset);
          if (!activeDomain) return;
          try {
            const params = new URLSearchParams();
            params.set('domain', activeDomain);
            params.set('limit', String(runsLimit||20));
            params.set('offset', String(newOffset));
            params.set('include', 'full');
            if (String(runsPidFilter||'').trim()!=='') { const pid=Number(runsPidFilter)||0; if (pid>0) params.set('product_id', String(pid)); }
            if (runsSortBy) params.set('sort_by', String(runsSortBy));
            if (runsSortDir) params.set('sort_dir', String(runsSortDir));
            const r = await fetch(`/api/grabbing-sensorex/extraction/history?${params.toString()}`, { credentials:'include' });
            const j = await r.json();
            if (r.ok && j?.ok && typeof setRuns==='function') { setRuns(j.items||[]); }
          } catch (e) {}
        }}>Next</button>
      </div>
    </>
  );
}


