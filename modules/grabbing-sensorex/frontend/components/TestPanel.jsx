import React from 'react';

// Module-level flag to avoid referencing the component identifier before it's initialized
let SAVE_TO_RUNS = true;

export default function TestPanel({ ctx }) {
  const {
    activeDomain,
    stepOpen, setStepOpen,
    exType, setExType,
    exVersions,
    exSelVer, setExSelVer, setExVerAuto,
    mapSelVer, setMapSelVer,
    mapVersList, mapVers,
    ensureMapVersionsFor,
    testUrl, setTestUrl,
    testBusy, setTestBusy,
    testMsg, setTestMsg,
    testResult, setTestResult,
    testCopyMsg, setTestCopyMsg,
    exText,
    copyToClipboard,
    // Discovered
    discQ, setDiscQ,
    discType, setDiscType,
    discLimit, setDiscLimit,
    discOffset, setDiscOffset,
    discBusy, discItems, discTotal,
    loadDiscovered,
    ensureExVersionsFor, refreshExVersionsFor,
    refreshMapVersionsFor,
    rowExtVer, setRowExtVer,
    rowMapVer, setRowMapVer,
    rowBusy, setRowBusy,
    exVerDict,
    reloadRuns,
    mysqlProfileId, profiles,
    mapText,
    // Sorting for discovered
    discSortBy, setDiscSortBy,
    discSortDir, setDiscSortDir,
  } = ctx || {};
  // Local selection for discovered URLs
  const [discSel, setDiscSel] = React.useState({});
  const [discConc, setDiscConc] = React.useState(3);
  // Resolve effective page type for a discovered row: row.page_type > filter > global
  const resolveType = React.useCallback((row) => {
    try {
      const a = String(row?.page_type || '').toLowerCase();
      const bRaw = String(discType || '').toLowerCase();
      const b = (bRaw === '(any)' || bRaw === 'any') ? '' : bRaw;
      const c = String(exType || '').toLowerCase();
      return a || b || c || 'product';
    } catch { return 'product'; }
  }, [discType, exType]);
  return (
    <>
      {testMsg && <div className="text-xs text-blue-700">{testMsg}</div>}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="text-sm">Domain:</div>
          <div className="text-sm font-mono">{activeDomain || '-'}</div>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <div>Type:</div>
          <div className="font-mono">{String(exType||'').toLowerCase()||'-'}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm">Ext v</div>
          <select value={exSelVer} onChange={(e)=>{ setExSelVer(Number(e.target.value||0)); if (typeof setExVerAuto==='function') setExVerAuto(false); }} className="border rounded px-2 py-1 text-sm">
            <option value={0}>[editor]</option>
            {(exVersions||[]).map(v => (
              <option key={v.id} value={v.version}>{v.version} {v.name?`- ${v.name}`:''}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm">Map v</div>
          <select value={mapSelVer} onChange={(e)=>setMapSelVer(String(e.target.value||''))} className="border rounded px-2 py-1 text-sm" onFocus={async ()=>{ if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(exType); }}>
            {(function(){
              const t = String(exType||'').toLowerCase();
              const dk = String(activeDomain||'').toLowerCase();
              const mkey = dk ? `${dk}|${t}` : t;
              const list = (mapVersList||{})[mkey] || [];
              const items = list.length ? list : ((mapVers||{})[t] ? [Number((mapVers||{})[t])] : []);
              return items.map(v => <option key={v} value={String(v)}>{`v${v}`}{v===Number((mapVers||{})[t])? ' (latest)':''}</option>);
            })()}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-sm">URL</div>
        <input value={testUrl} onChange={(e)=>setTestUrl(e.target.value)} placeholder={`https://${activeDomain||'domain'}/path`} className="border rounded px-2 py-1 text-sm flex-1" />
        <label className="text-xs inline-flex items-center gap-1" title="Save this test into Runs so you can inspect it later.">
          <input type="checkbox" checked={!!SAVE_TO_RUNS} onChange={(e)=>{ SAVE_TO_RUNS = !!e.target.checked; }} /> Save to Runs
        </label>
        <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60" disabled={testBusy || !testUrl || !activeDomain} onClick={async ()=>{
          setTestBusy(true); setTestMsg(''); setTestResult('');
          try {
            // Always use editor config in strict mode; never fall back
            let cfg = {};
            try { cfg = exText ? JSON.parse(exText) : {}; }
            catch (e) { window.alert('Invalid JSON in editor: '+(e?.message||e)); setTestBusy(false); return; }
            if (!cfg || typeof cfg !== 'object') { window.alert('Editor config is empty or invalid.'); setTestBusy(false); return; }
            const body = { url: String(testUrl||'').trim(), domain: activeDomain, page_type: exType, config: cfg, strict: true, save: !!SAVE_TO_RUNS };
            const qs = new URLSearchParams({ url: body.url, domain: body.domain, page_type: String(body.page_type||'') });
            const r = await fetch(`/api/grabbing-sensorex/extraction/test?${qs.toString()}`, { method:'POST', headers: {'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
            let j = null;
            try { j = await r.json(); }
            catch (e) { window.alert('Non-JSON response from server'); setTestBusy(false); return; }
            if (!r.ok || j?.ok === false) {
              window.alert(String(j?.message || j?.error || r.status || 'test_failed'));
              setTestMsg(String(j?.message || j?.error || 'test_failed'));
              setTestBusy(false);
              return;
            }
            if ((j?.config_source||'') !== 'provided') {
              window.alert(`Editor config was not used (source=${j?.config_source||''}). Test aborted.`);
              setTestMsg('Editor config not used; aborting.');
              setTestBusy(false);
              return;
            }
            setTestResult(JSON.stringify(j.result || j, null, 2));
            setTestMsg('OK — using provided');
            try { if (typeof reloadRuns==='function') await reloadRuns(); } catch {}
          } catch (e) { window.alert(String(e?.message||e)); setTestMsg(String(e?.message||e)); }
          finally { setTestBusy(false); }
        }}>Test</button>
      </div>
      <div className="flex items-center justify-between mt-1">
        <div className="text-sm font-semibold">Test Result</div>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 rounded border text-xs" onClick={async ()=>{ await copyToClipboard(testResult, setTestCopyMsg); }}>Copy JSON</button>
          {testCopyMsg && <span className="text-xs text-gray-500">{testCopyMsg}</span>}
        </div>
      </div>
      <pre className="w-full max-h-96 overflow-auto border rounded p-2 bg-gray-50 text-xs whitespace-pre-wrap scroll-smooth">{testResult}</pre>

      {/* Discovered URLs quick-run */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-semibold">Discovered URLs</div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Filter and run extraction → send to Presta</span>
            <button className="px-2 py-1 border rounded bg-white text-xs" onClick={async ()=>{ try { setDiscOffset(0); await loadDiscovered(); } catch {} }}>Reload</button>
          </div>
        </div>
        <div className="flex items-center gap-2 mb-2 text-xs">
          <input className="border rounded px-2 py-1 w-64" placeholder="Filter (title or URL)…" value={discQ} onChange={(e)=>{ setDiscOffset(0); setDiscQ(e.target.value); }} />
          <input className="border rounded px-2 py-1 w-56" placeholder="Include in URL (comma-separated)" value={ctx?.discIn||''} onChange={(e)=>{ try { setDiscOffset(0); ctx?.setDiscIn?.(e.target.value); } catch {} }} />
          <input className="border rounded px-2 py-1 w-56" placeholder="Exclude in URL (comma-separated)" value={ctx?.discNot||''} onChange={(e)=>{ try { setDiscOffset(0); ctx?.setDiscNot?.(e.target.value); } catch {} }} />
          <label className="inline-flex items-center gap-1">Type
            <select className="border rounded px-2 py-1" value={discType} onChange={(e)=>{ setDiscOffset(0); setDiscType(e.target.value); }}>
              <option value="">(any)</option>
              <option value="product">product</option>
              <option value="category">category</option>
              <option value="article">article</option>
              <option value="page">page</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1">Limit
            <select className="border rounded px-2 py-1" value={discLimit} onChange={(e)=>{ setDiscOffset(0); setDiscLimit(Number(e.target.value||20)); }}>
              {[20,50,100,500,1000,2000].map(n=> <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="px-2 py-1 border rounded" onClick={()=>loadDiscovered()}>Load</button>
          <label className="inline-flex items-center gap-1" title="Show only URLs that have no run yet for this domain.">
            <input type="checkbox" checked={!!(ctx?.discNoRuns)} onChange={(e)=>{ try { ctx?.setDiscNoRuns?.(!!e.target.checked); setDiscOffset(0); } catch {} }} /> Not in runs
          </label>
          <label className="inline-flex items-center gap-1">
            Concurrency
            <input className="w-12 border rounded px-1 py-0.5" type="number" min={1} max={10} value={discConc} onChange={(e)=>setDiscConc(Math.max(1, Math.min(10, Number(e.target.value||3))))} />
          </label>
          <button
            className="ml-2 px-2 py-1 border rounded disabled:opacity-60"
            title={!mysqlProfileId? 'Select a MySQL profile in Step 3' : ''}
            disabled={!Object.keys(discSel||{}).length || discBusy || !mysqlProfileId}
            onClick={async ()=>{
              const selIds = Object.keys(discSel||{}).map(n=>Number(n)||0).filter(n=>n>0);
              if (!selIds.length) return;
              if (!mysqlProfileId) { alert('Select a MySQL profile first (Step 3)'); return; }
              const w = window.open('', 'gs_mass_run_urls', 'width=960,height=640');
              if (!w) { alert('Popup blocked. Please allow popups.'); return; }
              const write = (html)=>{ try { const el=w.document.getElementById('content'); el.innerHTML += html; el.scrollTop = el.scrollHeight; } catch {} };
              const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Run selected → Presta</title><style>body{font:12px system-ui, sans-serif;padding:10px} .muted{color:#666} .ok{color:#166534} .err{color:#991b1b} pre{white-space:pre-wrap;word-break:break-word}</style></head><body><h3 style=\"margin:0\">Run selected → Presta</h3><div class=\"muted\">${selIds.length} URL(s), ${discConc} parallel</div><div id=\"content\" style=\"border:1px solid #ddd; padding:8px; height:500px; overflow:auto\"></div></body></html>`;
              w.document.open(); w.document.write(shell); w.document.close();
              write('<div>Starting…</div>');
              // Build lookup from current items
              const byId = {}; try { for (const it of (discItems||[])) byId[Number(it.id||0)||0] = it; } catch {}
              try {
                const lim = Math.max(1, Math.min(10, Number(discConc||3)));
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
                await runConcurrent(selIds, lim, async (id) => {
                  const it = byId[id];
                  const url = it?.url || '';
                  const t = resolveType(it); const pt = t;
                  if (!url) { write(`<div class=\"err\">Row ${id}: missing URL</div>`); return; }
                  write(`<div class=\"muted\">${url} → extract…</div>`);
                  try {
                    // Decide extraction mode: specific version if selected, else strict with editor config
                    const selExt = ((rowExtVer||{})[id] != null ? Number((rowExtVer||{})[id]) : 0) || Number(exSelVer||0) || 0;
                    let body;
                    if (selExt > 0) {
                      body = { url, domain: activeDomain, page_type: t, version: selExt, strict: false, save: true };
                    } else {
                      let cfg = {};
                      try { cfg = exText ? JSON.parse(exText) : {}; } catch (e) { write(`<div class=\"err\">${url}: invalid editor JSON – ${String(e?.message||e)}</div>`); return; }
                      if (!cfg || typeof cfg !== 'object') { write(`<div class=\"err\">${url}: editor config is empty or invalid</div>`); return; }
                      body = { url, domain: activeDomain, page_type: t, config: cfg, strict: true, save: true };
                    }
                    const r1 = await fetch('/api/grabbing-sensorex/extraction/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                    const j1 = await r1.json();
                    if (!r1.ok || j1?.ok===false) { write(`<div class=\"err\">${url}: extract failed – ${String(j1?.message||j1?.error||r1.status)}</div>`); return; }
                    if (selExt === 0 && (j1?.config_source||'') !== 'provided') { write(`<div class=\"err\">${url}: editor config not used (source=${String(j1?.config_source||'')})</div>`); return; }
                    const runId = Number(j1?.run_id||0) || 0;
                    if (!runId) { write(`<div class=\"err\">${url}: extract did not return run_id</div>`); return; }
                    write(`<div class=\"muted\">${url} → Presta…</div>`);
                    // Resolve mapping for this row/type: if a specific version is selected, load it; otherwise let the server resolve latest for the row type
                    let mapping = undefined;
                    try {
                      const selMap = ((rowMapVer||{})[id] != null ? String((rowMapVer||{})[id]) : '') || mapSelVer || '';
                      if (selMap && Number(selMap)>0) {
                        const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', t); p.set('version', String(selMap));
                        const tr = await fetch(`/api/grabbing-sensorex/transfert/version/get?${p.toString()}`, { credentials:'include' });
                        const tj = await tr.json(); mapping = (tr.ok && tj?.ok) ? (tj.item||undefined) : undefined;
                      }
                    } catch { mapping = undefined; }
                    const body2 = { run_id: runId, profile_id: mysqlProfileId, mapping, write: true, mode: 'insert', always_insert: true, force_page_type: t };
                    if (((rowMapVer||{})[id] || mapSelVer) && Number(((rowMapVer||{})[id]||mapSelVer))>0) body2.mapping_version = Number(((rowMapVer||{})[id]||mapSelVer));
                    const endpoint = (t === 'article' || t === 'category') ? '/api/grabbing-sensorex/transfer/category' : (t === 'product' ? '/api/grabbing-sensorex/transfer/product' : '/api/grabbing-sensorex/transfer/prestashop');
                    const r2 = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body2) });
                    const j2 = await r2.json();
                    if (!r2.ok || j2?.ok===false) write(`<div class=\"err\">${url}: transfer failed – ${String(j2?.message||j2?.error||r2.status)}</div>`);
                    else {
                      const idMsg = (t==='article' || t==='category') ? `category_id=${j2?.category_id ?? ''}` : `product_id=${j2?.product_id ?? ''}`;
                      write(`<div class=\"ok\">${url}: OK (${idMsg})</div>`);
                    }
                  } catch (e) {
                    write(`<div class=\"err\">${url}: error – ${String(e?.message||e)}</div>`);
                  }
                });
              } finally {
                try { if (typeof reloadRuns==='function') await reloadRuns(); } catch {}
                write('<div class=\"muted\">Done.</div>');
              }
            }}
          >Run selected → Presta</button>
        </div>
        <div className="max-h-72 overflow-auto border rounded scroll-smooth">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left"><input type="checkbox" checked={(discItems||[]).length>0 && (discItems||[]).every(x=>discSel?.[x.id])} onChange={(e)=>{ const on=e.target.checked; const next={}; if (on) { for (const it of (discItems||[])) next[it.id]=true; } setDiscSel(next); }} /></th>
                <th className="px-2 py-1 text-left">Title</th>
                <th className="px-2 py-1 text-left">
                  <button className="underline-offset-2 hover:underline" onClick={() => {
                    try {
                      if (discSortBy !== 'url') { setDiscSortBy('url'); setDiscSortDir('asc'); }
                      else { setDiscSortDir(prev => (prev === 'asc' ? 'desc' : 'asc')); }
                    } catch {}
                  }} title="Sort by URL">
                    URL{discSortBy === 'url' ? (discSortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
                <th className="px-2 py-1 text-left">Type</th>
                <th className="px-2 py-1 text-left">Prod</th>
                <th className="px-2 py-1 text-left">Ext v</th>
                <th className="px-2 py-1 text-left">Map v</th>
                <th className="px-2 py-1 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {(discItems||[]).map(it => {
                const t = resolveType(it); const pt = t;
                const vList = (exVerDict||{})[t] || [];
                const vMax = Array.isArray(vList) && vList.length ? vList.reduce((m, v) => Math.max(m, Number(v?.version||0)), 0) : 0;
                const curExt = (rowExtVer&&rowExtVer[it.id]!=null) ? Number(rowExtVer[it.id]) : (vMax || 0);
                const curMap = (rowMapVer||{})[it.id] || '';
                // Compute effective mapping version label for this row/type
                const dkMap = String(activeDomain||'').toLowerCase();
                const mkey = dkMap ? `${dkMap}|${t}` : t;
                const mlist = (mapVersList||{})[mkey] || [];
                const mMax = Array.isArray(mlist) && mlist.length ? mlist.reduce((m, v) => Math.max(m, Number(v||0)), 0) : (Number((mapVers||{})[t]||0) || 0);
                let mapVerLabel = '';
                if (curMap && Number(curMap)>0) mapVerLabel = `v${curMap} (row)`;
                else if (Number(mapSelVer)>0) mapVerLabel = `v${mapSelVer} (panel)`;
                else mapVerLabel = mMax>0 ? `latest v${mMax}` : 'latest';
                return (
                  <tr key={it.id} className="border-b">
                    <td className="px-2 py-1"><input type="checkbox" checked={!!discSel[it.id]} onChange={(e)=>{ const on=e.target.checked; setDiscSel(prev=>{ const n={...prev}; if (on) n[it.id]=true; else delete n[it.id]; return n; }); }} /></td>
                    <td className="px-2 py-1">
                      <div className="truncate max-w-xs" title={it.title||''}>{(it.title||'').slice(0,120) || '—'}</div>
                    </td>
                    <td className="px-2 py-1">
                      <a className="text-indigo-600 hover:underline font-mono" href={it.url} target="_blank" rel="noreferrer">{String(it.url||'').slice(0,96)}</a>
                    </td>
                    <td className="px-2 py-1">{it.product_id != null ? String(it.product_id) : ''}</td>
                    <td className="px-2 py-1">
                      <select className="border rounded px-1 py-0.5" value={String(it.page_type||'')} onChange={async (e)=>{
                        const nt = e.target.value;
                        let list = [];
                        try { if (typeof ensureExVersionsFor==='function') list = await ensureExVersionsFor(nt); } catch {}
                        try {
                          const maxVer = Array.isArray(list) && list.length ? list.reduce((m, v) => Math.max(m, Number(v?.version||0)), 0) : 0;
                          setRowExtVer(prev => ({ ...prev, [it.id]: maxVer }));
                        } catch {}
                      }}>
                        <option value="product">product</option>
                        <option value="category">category</option>
                        <option value="article">article</option>
                        <option value="page">page</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <select className="border rounded px-1 py-0.5" value={curExt}
                        onChange={(e)=>setRowExtVer(prev => ({ ...prev, [it.id]: Number(e.target.value||0) }))}
                        onFocus={async ()=>{ if (typeof refreshExVersionsFor==='function') await refreshExVersionsFor(t); }}>
                        <option value={0}>[editor]</option>
                        {(Array.isArray(vList)?vList:[]).map(v => (
                          <option key={v.id} value={v.version}>{v.version} {v.name?`- ${v.name}`:''}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-2">
                        <select className="border rounded px-1 py-0.5" value={curMap} onChange={(e)=>setRowMapVer(prev => ({ ...prev, [it.id]: String(e.target.value||'') }))}
                          onFocus={async ()=>{ if (typeof refreshMapVersionsFor==='function') await refreshMapVersionsFor(t); }}>
                          {(function(){
                            const dk = String(activeDomain||'').toLowerCase();
                            const mkey = dk ? `${dk}|${t}` : t;
                            const list = (mapVersList||{})[mkey] || [];
                            const items = list.length ? list : (((mapVers||{})[t]) ? [Number((mapVers||{})[t])] : []);
                            return items.map(v => <option key={v} value={String(v)}>{`v${v}`}{v===Number((mapVers||{})[t])? ' (latest)':''}</option>);
                          })()}
                        </select>
                        <span className="text-[10px] text-gray-500">{mapVerLabel}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <button className="px-2 py-1 border rounded text-xs disabled:opacity-60" disabled={!!(rowBusy||{})[it.id] || !mysqlProfileId}
                        title={!mysqlProfileId? 'Select a MySQL profile in Step 3' : ''}
                        onClick={async ()=>{
                          if (!mysqlProfileId) { alert('Select a MySQL profile first (Step 3)'); return; }
                          setRowBusy(prev => ({ ...prev, [it.id]: true }));
                          const w = window.open('', `gs_row_${it.id}`, 'width=900,height=600');
                          if (!w) { alert('Popup blocked. Please allow popups.'); setRowBusy(prev => ({ ...prev, [it.id]: false })); return; }
                          const write = (html)=>{ try { const el=w.document.getElementById('content'); el.innerHTML += html; el.scrollTop = el.scrollHeight; } catch {} };
                          const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Run – Progress</title><style>body{font:12px system-ui, sans-serif;padding:10px} .muted{color:#666} .ok{color:#166534} .err{color:#991b1b} pre{white-space:pre-wrap;word-break:break-word}</style></head><body><h3 id=\"hdr\" style=\"margin:0\">Run – Progress</h3><div id=\"content\" style=\"border:1px solid #ddd; padding:8px; height:500px; overflow:auto\"></div><div class=\"muted\">Polling admin endpoints every 1.5s…</div></body></html>`;
                          w.document.open(); w.document.write(shell); w.document.close();
                          try {
                            // Decide extraction mode: specific version if selected, else strict with editor config
                            // Choose extraction version type-safely: if row type differs from global exType
                            // and no row-specific selection exists, prefer editor (0) to avoid config_not_found.
                            const rowType = String(it.page_type || t).toLowerCase();
                            let selExt = 0;
                            if ((rowExtVer||{})[it.id] != null) selExt = Number((rowExtVer||{})[it.id]) || 0;
                            else if (rowType === String(exType||'').toLowerCase()) selExt = Number(exSelVer||0) || 0;
                            let body;
                            if (selExt > 0) {
                              body = { url: it.url, domain: activeDomain, page_type: (it.page_type || t), version: selExt, strict: false, save: true };
                            } else {
                              let cfg = {};
                              try { cfg = exText ? JSON.parse(exText) : {}; } catch (e) { write(`<div class=\\"err\\">Invalid editor JSON – ${String(e?.message||e)}</div>`); setRowBusy(prev => ({ ...prev, [it.id]: false })); return; }
                              if (!cfg || typeof cfg !== 'object') { write('<div class=\\"err\\">Editor config is empty or invalid.</div>'); setRowBusy(prev => ({ ...prev, [it.id]: false })); return; }
                              body = { url: it.url, domain: activeDomain, page_type: (it.page_type || t), config: cfg, strict: true, save: true };
                            }
                            write(`<div>Creating run for <span class=\\"font-mono\\">${(it.url||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>…</div>`);
                            const qs0 = new URLSearchParams({ url: String(body.url||''), domain: String(body.domain||''), page_type: String(body.page_type||'') });
                            const r1 = await fetch(`/api/grabbing-sensorex/extraction/test?${qs0.toString()}`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                            const j1 = await r1.json();
                            if (!r1.ok || j1?.ok===false) { write(`<div class=\\"err\\">Extraction failed – ${String(j1?.message||j1?.error||r1.status)}</div>`); setRowBusy(prev => ({ ...prev, [it.id]: false })); return; }
                            if (selExt === 0 && (j1?.config_source||'') !== 'provided') { write(`<div class=\\"err\\">Editor config not used (source=${String(j1?.config_source||'')})</div>`); setRowBusy(prev => ({ ...prev, [it.id]: false })); return; }
                            const runId = Number(j1?.run_id||0) || 0;
                            if (!runId) { write(`<div class=\\"err\\">Saved run_id not returned${j1?.save_error? (': '+String(j1.save_error)) : ''}</div>`); setRowBusy(prev => ({ ...prev, [it.id]: false })); return; }
                            try { w.document.title = `Run ${runId} – Progress`; const h=w.document.getElementById('hdr'); if (h) h.textContent = `Run ${runId} – Progress`; } catch {}
                            write(`<div class=\\"ok\\">Run created: ${runId}</div>`);

                            // Show context: Ext v, Map v, Profile used, and quick JSON peeks
                            try {
                              const escapeHtml = (s) => String(s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
                              const extUsedVer = Number(j1?.used_version || (selExt>0? selExt: 0)) || 0;
                              const extLabel = extUsedVer > 0 ? `v${extUsedVer}` : '[editor]';
                              const selMap = ((rowMapVer||{})[it.id] != null ? String((rowMapVer||{})[it.id]) : '') || mapSelVer || '';
                              let mapUsedVer = 0;
                              try { if (selMap && Number(selMap)>0) mapUsedVer = Number(selMap); else if (mapping && typeof mapping==='object' && Number(mapping.version)>0) mapUsedVer = Number(mapping.version)||0; } catch {}
                              const mapLabel = mapUsedVer > 0 ? `v${mapUsedVer}` : '[editor]';
                              const prof = (Array.isArray(profiles)? profiles: []).find(p => Number(p.id)===Number(mysqlProfileId));
                              const profLabel = prof ? `${escapeHtml(String(prof.name||''))} (#${Number(prof.id)||mysqlProfileId})` : `#${Number(mysqlProfileId)||''}`;
                              write(`<div class=\\"muted\\">Ext v: ${escapeHtml(extLabel)} · Map v: ${escapeHtml(mapLabel)} · Profile: ${profLabel}</div>`);
                              // Inline JSON previews (no event handlers required)
                              try {
                                // Extraction JSON (only when provided in strict mode)
                                const exJson = (body && body.config && typeof body.config==='object') ? JSON.stringify(body.config, null, 2) : null;
                                if (exJson) write(`<details style=\\"margin:6px 0\\"><summary>See Extraction JSON</summary><pre>${escapeHtml(exJson)}</pre></details>`);
                              } catch {}
                              try {
                                // Mapping JSON (from selected version or editor)
                                const mjsonObj = (mapping && typeof mapping==='object') ? (mapping.config || mapping.tables || mapping) : null;
                                const mjson = mjsonObj ? JSON.stringify(mjsonObj, null, 2) : null;
                                if (mjson) write(`<details style=\\"margin:6px 0\\"><summary>See Mapping JSON</summary><pre>${escapeHtml(mjson)}</pre></details>`);
                              } catch {}
                            } catch {}

                            // Start polling logs/errors/summary
                            let stop = false; let lastErrIds = new Set(); let lastLogSet = new Set(); let lastSumKeys = new Set(); let lastSumId = 0;
                            const renderErrors = (items=[]) => { for (const it of items) { const key=String(it.id||''); if (lastErrIds.has(key)) continue; lastErrIds.add(key); write(`<div><span class=\\"muted\\">[DB]</span> ${String(it.table_name||'').replace(/^.*\\./,'')} · <span class=\\"muted\\">${String(it.op||'')}</span> · ${String(it.error||'')}</div>`); } };
                            const renderLogs = (lines=[]) => { for (const ln of (lines||[])) { if (lastLogSet.has(ln)) continue; lastLogSet.add(ln); write(`<pre>${ln.replace(/[&<>]/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[s]))}</pre>`); } };
                            const renderSummary = (items=[]) => {
                              for (const it2 of (items||[])) {
                                try { if (it2 && typeof it2.id === 'number' && it2.id > lastSumId) lastSumId = it2.id; } catch {}
                                const key = [String(it2.table_name||''), String(it2.field||''), String(it2.id_shop||''), String(it2.id_lang||''), String(it2.value||''), String(it2.created_at||'')].join('|');
                                if (lastSumKeys.has(key)) continue; lastSumKeys.add(key);
                                const tbl = String(it2.table_name||'').replace(/^.*\\./,'');
                                const shop = it2.id_shop!=null? ` shop=${it2.id_shop}`: '';
                                const lang = it2.id_lang!=null? ` lang=${it2.id_lang}`: '';
                                const val = (it2.value==null? 'NULL' : String(it2.value||'').replace(/[&<>]/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[s])));
                                write(`<div><span class=\\"muted\\">[SET]</span> ${tbl} · <span class=\\"muted\\">${String(it2.field||'')}</span>${shop}${lang} = <span class=\\"muted\\">${val}</span></div>`);
                              }
                            };
                            // Aggregated per-table OK counters
                            const renderOkAgg = (items=[]) => {
                              for (const it of (items||[])) {
                                const tbl = String(it.table_name||'').replace(/^.*\\./,'');
                                const op = String(it.op||'');
                                const shop = it.id_shop!=null? ` shop=${it.id_shop}`: '';
                                const lang = it.id_lang!=null? ` lang=${it.id_lang}`: '';
                                const cnt = Number(it.count||0)||0;
                                write(`<div><span class=\\"ok\\">[OK]</span> ${tbl} · <span class=\\"muted\\">${op||'upsert'}</span>${shop}${lang} · <span class=\\"muted\\">${cnt}</span></div>`);
                              }
                            };
                            // Start lightweight progress feed as soon as the window opens
                            write('<div class=\"muted\">Progress feed starting…</div>');

                            // Lightweight progress feed (poll summaries while window is open)
                            let okPollTick = 0;
                            (async () => {
                              try {
                                while (!stop) {
                                  try {
                                    const ps = new URLSearchParams();
                                    ps.set('run_id', String(runId));
                                    if (lastSumId > 0) ps.set('after_id', String(lastSumId));
                                    const rS = await fetch(`/api/grabbing-sensorex/upsert-summary?${ps.toString()}`, { credentials:'include' });
                                    if (rS.ok) {
                                      const jS = await rS.json().catch(()=>null);
                                      if (jS && jS.ok && Array.isArray(jS.items)) renderSummary(jS.items);
                                    }
                                  } catch {}
                                  try {
                                    okPollTick = (okPollTick + 1) % 4;
                                    if (okPollTick === 0) {
                                      const rOk = await fetch(`/api/grabbing-sensorex/success-summary?run_id=${encodeURIComponent(String(runId))}`, { credentials:'include' });
                                      if (rOk.ok) {
                                        const jOk = await rOk.json().catch(()=>null);
                                        if (jOk && jOk.ok && Array.isArray(jOk.items)) renderOkAgg(jOk.items);
                                      }
                                    }
                                  } catch {}
                                  await new Promise(rs => setTimeout(rs, 800));
                                }
                              } catch {}
                            })();                            w.onbeforeunload = () => { stop = true; };

                            // Transfer
                            const epFor = (pt === 'article' || pt === 'category') ? '/transfer/category' : (pt === 'product' ? '/transfer/product' : '/transfer/prestashop');
                            write(`<div>Posting to ${epFor}…</div>`);
                            try {
                              const pt = resolveType(it);
                              let mapping = null;
                              const selMap = ((rowMapVer||{})[it.id] != null ? String((rowMapVer||{})[it.id]) : '') || mapSelVer || '';
                              if (selMap && Number(selMap)>0) {
                                const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', pt); p.set('version', String(selMap));
                                const tr = await fetch(`/api/grabbing-sensorex/transfert/version/get?${p.toString()}`, { credentials:'include' });
                                const tj = await tr.json(); mapping = (tr.ok && tj?.ok) ? (tj.item||{}) : null;
                                // If the selected version doesn't exist for this page type, fallback to latest for pt
                                if (!mapping) {
                                  const lp = new URLSearchParams(); lp.set('domain', activeDomain); lp.set('page_type', pt);
                                  const rl = await fetch(`/api/grabbing-sensorex/mapping/tools/latest?${lp.toString()}`, { credentials:'include' });
                                  const jl = await rl.json();
                                  mapping = (rl.ok && jl?.ok) ? (jl.item||{}) : null;
                                  if (mapping && mapping.version != null) rowMapVer[it.id] = String(mapping.version);
                                }
                              } else {
                                // When no explicit version is selected, prefer latest mapping for this page type; if missing, allow editor map as last resort
                                try {
                                  const lp = new URLSearchParams(); lp.set('domain', activeDomain); lp.set('page_type', pt);
                                  const rl = await fetch(`/api/grabbing-sensorex/mapping/tools/latest?${lp.toString()}`, { credentials:'include' });
                                  const jl = await rl.json();
                                  mapping = (rl.ok && jl?.ok) ? (jl.item||{}) : null;
                                } catch {}
                                if (!mapping) { try { mapping = mapText ? JSON.parse(mapText) : {}; } catch { mapping = {}; } }
                              }
                              // Respect mapping.profile_id when present; only pass explicit profile_id if none in mapping
                              const body2 = { run_id: runId, mapping, write: true, mode: 'insert', always_insert: true, force_page_type: pt, debug: true };
                              // Do not override profile; backend requires mapping.profile_id strictly
                              try {
                                const ver = (mapping && typeof mapping.version !== 'undefined') ? Number(mapping.version) : (selMap && Number(selMap)>0 ? Number(selMap) : undefined);
                                if (ver) body2.mapping_version = ver;
                              } catch {}
                              const endpoint2 = (pt === 'article' || pt === 'category')
                                ? '/api/grabbing-sensorex/transfer/category'
                                : (pt === 'product'
                                  ? '/api/grabbing-sensorex/transfer/product'
                                  : '/api/grabbing-sensorex/transfer/prestashop');
                              const q2 = new URLSearchParams({ run_id: String(runId) });
                              const resp = await fetch(`${endpoint2}?${q2.toString()}`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body2) });
                              let j2=null, body='';
                              try {
                                const ct = resp.headers.get('content-type')||'';
                                if (ct.includes('application/json')) j2 = await resp.json(); else body = await resp.text();
                              } catch { try { body = await resp.text(); } catch {} }
                              if (!resp.ok || (j2 && j2.ok===false)) {
                                const msg = (j2 && (j2.message||j2.error)) ? String(j2.message||j2.error) : (body ? `non_json_${resp.status}` : String(resp.status));
                                write(`<div class=\\"err\\">Failed: ${msg}</div>`);
                                try {
                                  if (j2 && j2.error === 'missing_profile') {
                                    const parts = [];
                                    if (j2.mapping_profile_id != null) parts.push(`mapping_profile_id=${j2.mapping_profile_id}`);
                                    if (j2.mapping_profile_name) parts.push(`mapping_profile_name=\"${String(j2.mapping_profile_name).replace(/\"/g,'&quot;')}\"`);
                                    if (j2.mapping_version != null) parts.push(`mapping_version=${j2.mapping_version}`);
                                    if (j2.domain_profile_id != null) parts.push(`domain_profile_id=${j2.domain_profile_id}`);
                                    if (j2.domain_profile_name) parts.push(`domain_profile_name=\"${String(j2.domain_profile_name).replace(/\"/g,'&quot;')}\"`);
                                    if (parts.length) write(`<div class=\\"muted\\">${parts.join(' · ')}</div>`);
                                  }
                                } catch {}
                              } else if (j2) {
                                // Show the most relevant identifier based on the effective type
                              if (pt === 'article' || pt === 'category') {
                                  write(`<div>category_id=${j2?.category_id||''}</div>`);
                                } else {
                                  write(`<div>product_id=${j2?.product_id||''}</div>`);
                                }
                                try {
                                  const d = j2.details || {};
                                  const ran = d.ran || {};
                                  const parts = [];
                                  if (d.prefix) parts.push(`prefix=${d.prefix}`);
                                  if (d.unified_dynamic!=null) parts.push(`unified_dynamic=${d.unified_dynamic}`);
                                  if (Array.isArray(d.shops) && d.shops.length) parts.push(`shops=[${d.shops.join(', ')}]`);
                                  if (Array.isArray(d.langs) && d.langs.length) parts.push(`langs=[${d.langs.join(', ')}]`);
                                  if (d.mapping_version!=null) parts.push(`map_v=${d.mapping_version}`);
                                  if (d.preinserted) parts.push('preinserted=1');
                                  const ranParts = [];
                                  if (ran.images) ranParts.push('images');
                                  if (ran.documents) ranParts.push('documents');
                                  if (ran.attributes) ranParts.push('attributes');
                                  if (ran.features) ranParts.push('features');
                                  if (ran.generic) ranParts.push('generic');
                                  if (ranParts.length) parts.push(`ran=${ranParts.join('+')}`);
                                  if (parts.length) write(`<div class=\\"muted\\">${parts.join(' · ')}</div>`);
                                  try {
                                    const prof = d.profile || {};
                                    if (prof && (prof.id != null || prof.name)) {
                                      const pName = (prof.name ? String(prof.name) : '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                                      const pId = (prof.id != null) ? `#${prof.id}` : '';
                                      const pSrc = prof.source ? `, ${String(prof.source)}` : '';
                                      write(`<div class=\\"muted\\">Resolved profile: ${pName? (pName+' '): ''}${pId}${pSrc}</div>`);
                                    }
                                  } catch {}
                                } catch {}
                                write('<div class=\\"ok\\">OK</div>');
                                try { if (typeof reloadRuns==='function') await reloadRuns(); } catch {}
                              } else {
                                write(`<div class=\\"ok\\">Completed (status ${resp.status})</div>`);
                              }
                            } catch (e) { write(`<div class=\\"err\\">Error: ${String(e?.message||e)}</div>`); }
                          } catch (e) { write(`<div class=\\"err\\">${String(e?.message||e)}</div>`); }
                          finally { setRowBusy(prev => ({ ...prev, [it.id]: false })); }
                        }}>{
                          (pt==='article' || pt==='category')
                            ? 'Run (category) → Presta'
                            : (pt==='product'
                                ? 'Run (product) → Presta'
                                : (pt==='page'
                                    ? 'Run (page) → Presta'
                                    : 'Run → Presta'))
                        }</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-gray-600">
          <div className="text-gray-500">Showing {discOffset+1}-{Math.min(discOffset + (discItems?.length||0), discTotal)} of {discTotal}</div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 border rounded disabled:opacity-60" disabled={discOffset<=0 || discBusy} onClick={()=> setDiscOffset(v=>Math.max(0, v - discLimit))}>Prev</button>
            <button className="px-2 py-1 border rounded disabled:opacity-60" disabled={discOffset + (discItems?.length||0) >= discTotal || discBusy} onClick={()=> setDiscOffset(v=> v + discLimit)}>Next</button>
          </div>
        </div>
      </div>
    </>
  );
}
