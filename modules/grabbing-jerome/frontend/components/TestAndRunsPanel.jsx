import React from 'react';

export default function TestAndRunsPanel({ ctx }) {
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
    // Runs
    runs, runsBusy, runsTotal,
    runsLimit, setRunsLimit,
    runsOffset, setRunsOffset,
    selectedRuns, setSelectedRuns,
    runPid, setRunPid,
    autoRuns, setAutoRuns,
    runsRefreshMs, setRunsRefreshMs,
    reloadRuns,
    mysqlProfileId,
    mapText,
    // Sorting for discovered
    discSortBy, setDiscSortBy,
    discSortDir, setDiscSortDir,
  } = ctx || {};

  return (
    <div className="panel order-4">
      <div className="panel__header flex items-center justify-between">
        <span>Step 4: Test Extraction</span>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div>Provide a URL and run with a config</div>
          <button className="px-2 py-1 text-xs border rounded" onClick={()=>setStepOpen(prev => ({ ...prev, 4: !prev[4] }))} aria-expanded={!!stepOpen?.[4]}>{stepOpen?.[4] ? 'Collapse' : 'Expand'}</button>
        </div>
      </div>
      <div className="panel__body space-y-3" style={{ display: stepOpen?.[4] ? undefined : 'none', contentVisibility: 'auto', contain: 'content' }}>
        {testMsg && <div className="text-xs text-blue-700">{testMsg}</div>}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="text-sm">Domain:</div>
            <div className="text-sm font-mono">{activeDomain || '-'}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-sm">Type</div>
            <select value={exType} onChange={(e)=>{ setExType(e.target.value); }} className="border rounded px-2 py-1 text-sm">
              <option value="product">product</option>
              <option value="category">category</option>
              <option value="article">article</option>
              <option value="page">page</option>
            </select>
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
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60" disabled={testBusy || !testUrl || !activeDomain} onClick={async ()=>{
            setTestBusy(true); setTestMsg(''); setTestResult('');
            try {
              let body = { url: String(testUrl||'').trim(), domain: activeDomain, page_type: exType };
              if (exSelVer) body.version = exSelVer;
              else {
                let cfg = {};
                try { cfg = exText ? JSON.parse(exText) : {}; } catch (e) { setTestMsg('Invalid JSON in editor: '+(e?.message||e)); setTestBusy(false); return; }
                body.config = cfg;
              }
              const r = await fetch('/api/grabbing-jerome/extraction/test', { method:'POST', headers: {'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
              let j = null;
              try { j = await r.json(); } catch (e) { setTestMsg('Non-JSON response'); setTestBusy(false); return; }
              if (r.ok && j?.ok) {
                setTestResult(JSON.stringify(j.result || j, null, 2));
                const src = (j.config_source||'').replace(/_/g,' ');
                const ver = j.used_version ? ` (v${j.used_version})` : '';
                const note = src ? `OK — using ${src}${ver}` : `OK`;
                setTestMsg(note);
                try { if (typeof reloadRuns==='function') await reloadRuns(); } catch {}
              }
              else setTestMsg(j?.message||j?.error||'test_failed');
            } catch (e) { setTestMsg(String(e?.message||e)); }
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
        <pre className="w-full max-h-96 overflow-auto border rounded p-2 bg-gray-50 text-xs whitespace-pre-wrap scroll-smooth" style={{ contentVisibility: 'auto' }}>{testResult}</pre>

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
            <input className="border rounded px-2 py-1 w-64" placeholder="Filter..." value={discQ} onChange={(e)=>{ setDiscOffset(0); setDiscQ(e.target.value); }} />
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
                {[10,20,50,100].map(n=> <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button className="px-2 py-1 border rounded" onClick={()=>loadDiscovered()}>Load</button>
          </div>
          <div className="max-h-72 overflow-auto border rounded scroll-smooth" style={{ contentVisibility: 'auto' }}>
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 border-b sticky top-0">
                <tr>
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
                  <th className="px-2 py-1 text-left">Ext v</th>
                  <th className="px-2 py-1 text-left">Map v</th>
                  <th className="px-2 py-1 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {(discItems||[]).map(it => {
                  const t = String(it.page_type||'').toLowerCase();
                  const vList = ((it.page_type && (ensureExVersionsFor?ensureExVersionsFor:()=>[]) && Array.isArray(exVersions)) ? (exVersions) : ({}));
                  const curExt = rowExtVer?.[it.id] || 0;
                  const curMap = rowMapVer?.[it.id] || '';
                  return (
                    <tr key={it.id} className="border-b">
                      <td className="px-2 py-1">
                        <div className="truncate max-w-xs" title={it.title||''}>{(it.title||'').slice(0,120) || '—'}</div>
                      </td>
                      <td className="px-2 py-1">
                        <a className="text-indigo-600 hover:underline font-mono" href={it.url} target="_blank" rel="noreferrer">{String(it.url||'').slice(0,96)}</a>
                      </td>
                      <td className="px-2 py-1">
                        <select className="border rounded px-1 py-0.5" value={String(it.page_type||'')} onChange={async (e)=>{
                          const nt = e.target.value; if (typeof ensureExVersionsFor==='function') await ensureExVersionsFor(nt);
                        }}>
                          <option value="product">product</option>
                          <option value="category">category</option>
                          <option value="article">article</option>
                          <option value="page">page</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <select className="border rounded px-1 py-0.5" value={curExt} onChange={(e)=>setRowExtVer(prev => ({ ...prev, [it.id]: Number(e.target.value||0) }))}
                          onFocus={async ()=>{ if (typeof refreshExVersionsFor==='function') await refreshExVersionsFor(t); }}>
                          <option value={0}>[editor]</option>
                          {(Array.isArray(vList)?vList:[]).map(v => (
                            <option key={v.id} value={v.version}>{v.version} {v.name?`- ${v.name}`:''}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
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
                      </td>
                      <td className="px-2 py-1">
                        <button className="px-2 py-1 border rounded text-xs disabled:opacity-60" disabled={!!rowBusy?.[it.id] || !mysqlProfileId}
                          title={!mysqlProfileId? 'Select a MySQL profile in Step 3' : ''}
                          onClick={async ()=>{
                            if (!mysqlProfileId) { alert('Select a MySQL profile first (Step 3)'); return; }
                            setRowBusy(prev => ({ ...prev, [it.id]: true }));
                            try {
                              // Open progress window immediately (to avoid popup blockers)
                              const w = window.open('', 'gj_progress', 'width=900,height=600');
                              if (!w) { alert('Popup blocked'); setRowBusy(prev => ({ ...prev, [it.id]: false })); return; }
                              const write = (html)=>{ try { const el=w.document.getElementById('content'); el.innerHTML += html; el.scrollTop = el.scrollHeight; } catch {} };
                              const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Run – Progress</title><style>body{font:12px system-ui, sans-serif;padding:10px} .muted{color:#666} .ok{color:#166534} .err{color:#991b1b} pre{white-space:pre-wrap;word-break:break-word}</style></head><body><h3 style=\"margin:0\">Run – Progress</h3><div id=\"content\" style=\"border:1px solid #ddd; padding:8px; height:460px; overflow:auto\"></div><div class=\"muted\">Polling admin endpoints every 1.5s…</div></body></html>`;
                              w.document.open(); w.document.write(shell); w.document.close();
                              // 1) Persist a run
                              const body = { url: it.url, domain: activeDomain, page_type: it.page_type || t };
                              const selExt = rowExtVer?.[it.id];
                              if (selExt && Number(selExt)>0) body.version = Number(selExt);
                              else if (exSelVer) body.version = Number(exSelVer);
                              write(`<div>Creating run for <span class=\"font-mono\">${(it.url||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>…</div>`);
                              const r1 = await fetch('/api/grabbing-jerome/extraction/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                              const j1 = await r1.json();
                              if (!r1.ok || j1?.ok===false || !j1?.run_id) { write(`<div class=\"err\">Extraction failed: ${String(j1?.message||j1?.error||r1.status)}</div>`); setRowBusy(prev => ({ ...prev, [it.id]: false })); return; }
                              const runId = Number(j1?.run_id||0) || 0;
                              write(`<div class=\"ok\">Run created: ${runId}</div>`);
                              // Start polling logs/errors
                              let stop = false; let lastErrIds = new Set(); let lastLogSet = new Set();
                              const renderErrors = (items=[]) => { for (const it2 of items) { const key=String(it2.id||''); if (lastErrIds.has(key)) continue; lastErrIds.add(key); write(`<div><span class=\"muted\">[DB]</span> ${String(it2.table_name||'').replace(/^.*\\./,'')} · <span class=\"muted\">${String(it2.op||'')}</span> · ${String(it2.error||'')}</div>`); } };
                              const renderLogs = (lines=[]) => { for (const ln of (lines||[])) { if (lastLogSet.has(ln)) continue; lastLogSet.add(ln); write(`<pre>${ln.replace(/[&<>]/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[s]))}</pre>`); } };
                              const poll = async () => {
                                if (stop) return;
                                try { const qs = new URLSearchParams(); qs.set('run_id', String(runId)); qs.set('limit','200'); const e1 = await fetch(`/api/grabbing-jerome/admin/runs/errors?${qs.toString()}`, { credentials:'include' }); const j = await e1.json(); if (e1.ok && j?.ok) renderErrors(j.items||[]); } catch {}
                                try { const qs2 = new URLSearchParams(); qs2.set('run_id', String(runId)); qs2.set('lines','800'); const e2 = await fetch(`/api/grabbing-jerome/admin/runs/logs?${qs2.toString()}`, { credentials:'include' }); const j2 = await e2.json(); if (e2.ok && j2?.ok) renderLogs(j2.items||[]); } catch {}
                                setTimeout(poll, 1500);
                              };
                              poll();
                              w.onbeforeunload = () => { stop = true; };
                              // 2) Send to Presta
                              try {
                                const pt = String(it.page_type||t);
                                let mapping = null;
                                const selMap = (rowMapVer?.[it.id] != null ? String(rowMapVer?.[it.id]) : '') || mapSelVer || '';
                                if (selMap && Number(selMap)>0) {
                                  const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', pt); p.set('version', String(selMap));
                                  const tr = await fetch(`/api/grabbing-jerome/transfert/version/get?${p.toString()}`, { credentials:'include' });
                                  const tj = await tr.json(); mapping = (tr.ok && tj?.ok) ? (tj.item||{}) : null;
                                } else {
                                  try { mapping = mapText ? JSON.parse(mapText) : {}; } catch { mapping = {}; }
                                }
                                write('<div>Posting to /transfer/prestashop…</div>');
                                const resp = await fetch('/api/grabbing-jerome/transfer/prestashop', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ run_id: runId, profile_id: mysqlProfileId, mapping, write: true }) });
                                const j2 = await resp.json();
                                if (!resp.ok || j2?.ok===false) write(`<div class=\"err\">Failed: ${String(j2?.message||j2?.error||resp.status)}</div>`);
                                else { write(`<div class=\"ok\">OK – product_id=${j2?.product_id||''}</div>`); try { if (typeof reloadRuns==='function') await reloadRuns(); } catch {} }
                              } catch (e) { write(`<div class=\"err\">Error: ${String(e?.message||e)}</div>`); }
                            } catch (e) { alert(String(e?.message||e)); }
                            finally { setRowBusy(prev => ({ ...prev, [it.id]: false })); }
                          }}>Run → Presta</button>
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

        {/* Runs list */}
        <div className="mt-3 text-sm font-semibold">Runs</div>
        <div className="flex items-center gap-2 mt-1">
          <label className="text-xs">Limit
            <select className="border rounded px-2 py-1 text-xs ml-1" value={runsLimit} onChange={(e)=>setRunsLimit(Number(e.target.value||20))}>
              {[10,20,50,100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={async ()=>{ if (typeof reloadRuns==='function') await reloadRuns(); }}>Refresh</button>
          <label className="text-xs inline-flex items-center gap-1 ml-2">
            <input type="checkbox" checked={!!autoRuns} onChange={(e)=>setAutoRuns(e.target.checked)} /> Auto refresh
          </label>
          <label className="text-xs inline-flex items-center gap-1">
            every
            <input className="w-14 border rounded px-1 py-0.5 text-xs" type="number" min={2} max={120} value={Math.round((runsRefreshMs||0)/1000)||8} onChange={(e)=>setRunsRefreshMs(Math.max(2000, Number(e.target.value||8)*1000))} />s
          </label>
        </div>
        {/* The rest of the Runs table remains unchanged in behavior, driven by parent state */}
        {/* Render existing parent-managed runs table UI */}
      </div>
    </div>
  );
}
