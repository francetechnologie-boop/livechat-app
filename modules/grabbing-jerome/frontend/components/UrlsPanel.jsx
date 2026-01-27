import React from 'react';

export default function UrlsPanel({ activeDomain, embedded = false }) {
  const [urls, setUrls] = React.useState([]);
  const [urlsTotal, setUrlsTotal] = React.useState(0);
  const [urlsSummary, setUrlsSummary] = React.useState(null);
  const [urlsUrlOnly, setUrlsUrlOnly] = React.useState(false);
  const [urlsLimit, setUrlsLimit] = React.useState(50);
  const [urlsOffset, setUrlsOffset] = React.useState(0);
  const [urlsQ, setUrlsQ] = React.useState('');
  const [urlsType, setUrlsType] = React.useState('');
  const [urlsBusy, setUrlsBusy] = React.useState(false);
  const [addUrl, setAddUrl] = React.useState('');
  const [includeSubdomains, setIncludeSubdomains] = React.useState(false);
  const [addMsg, setAddMsg] = React.useState('');
  const [urlsSortBy, setUrlsSortBy] = React.useState('explored');
  const [urlsSortDir, setUrlsSortDir] = React.useState('desc');
  const [refreshTick, setRefreshTick] = React.useState(0);
  const triggerRefresh = () => setRefreshTick((t)=>t+1);
  const [sel, setSel] = React.useState({});
  const selectedIds = React.useMemo(() => Object.keys(sel).filter(k=>sel[k]).map(k=>Number(k)||0).filter(n=>n>0), [sel]);
  const [reclassMsg, setReclassMsg] = React.useState('');
  const [reclassBusy, setReclassBusy] = React.useState(false);

  const toggleSort = (k) => {
    setUrlsOffset(0);
    setUrlsSortBy(prev => {
      if (prev === k) {
        setUrlsSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      } else {
        setUrlsSortDir('asc');
        return k;
      }
    });
  };

  const sortArrow = (k) => (urlsSortBy === k ? (urlsSortDir === 'asc' ? ' ▲' : ' ▼') : '');

  React.useEffect(() => {
    (async () => {
      if (!activeDomain) { setUrls([]); setUrlsTotal(0); return; }
      setUrlsBusy(true);
      try {
        const params = new URLSearchParams();
        params.set('domain', activeDomain);
        params.set('limit', String(urlsLimit));
        params.set('offset', String(urlsOffset));
        if (urlsQ) params.set('q', urlsQ);
        if (urlsUrlOnly) params.set('url_only','1');
        if (urlsType) params.set('page_type', urlsType);
        if (includeSubdomains) params.set('include_subdomains','1');
        if (urlsSortBy) params.set('sort_by', urlsSortBy);
        if (urlsSortDir) params.set('sort_dir', urlsSortDir);
        params.set('include','summary');
        const r = await fetch(`/api/grabbing-jerome/domains/urls?${params.toString()}`, { credentials:'include' });
        const j = await r.json();
        if (r.ok && j?.ok) { setUrls(j.items||[]); setUrlsTotal(Number(j.total||0)); setUrlsSummary(j.summary||null); }
        else { setUrls([]); setUrlsTotal(0); setUrlsSummary(null); }
      } catch {}
      finally { setUrlsBusy(false); }
    })();
  }, [activeDomain, urlsLimit, urlsOffset, urlsQ, urlsType, urlsUrlOnly, urlsSortBy, urlsSortDir, refreshTick]);

  // Listen for global refresh events (seed/crawl completed)
  React.useEffect(() => {
    const onRefresh = (e) => { try { triggerRefresh(); } catch {} };
    window.addEventListener('gj:urls:refresh', onRefresh);
    return () => window.removeEventListener('gj:urls:refresh', onRefresh);
  }, []);

  const Body = () => (
    <div className="space-y-3">
        {!activeDomain && <div className="text-xs text-gray-500">Select a domain first.</div>}
        {activeDomain && (
          <>
            <div className="flex items-center gap-2">
              <div className="text-sm">Domain:</div>
              <div className="text-sm font-mono">{activeDomain}</div>
              <div className="ml-4 text-sm">Filter</div>
              <input value={urlsQ} onChange={(e)=>{ setUrlsOffset(0); setUrlsQ(e.target.value); }} placeholder="text"
                     className="border rounded px-2 py-1 text-sm w-48" />
              <div className="ml-4 text-sm">Type</div>
              <select value={urlsType} onChange={(e)=>{ setUrlsOffset(0); setUrlsType(e.target.value); }} className="border rounded px-2 py-1 text-sm">
                <option value="">(any)</option>
                <option value="product">product</option>
                <option value="category">category</option>
                <option value="article">article</option>
                <option value="page">page</option>
              </select>
              <label className="ml-2 text-xs inline-flex items-center gap-1"><input type="checkbox" checked={urlsUrlOnly} onChange={(e)=>{ setUrlsOffset(0); setUrlsUrlOnly(!!e.target.checked); }} /> URL only</label>
              <div className="ml-2 text-sm">Limit</div>
              <input type="number" min={1} max={200} value={urlsLimit} onChange={(e)=>{ setUrlsOffset(0); setUrlsLimit(Number(e.target.value||0)); }} className="border rounded px-2 py-1 text-sm w-24" />
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50 disabled:opacity-60" disabled={!urls.length} onClick={()=>{
                const next = {}; for (const u of urls) next[u.id] = true; setSel(next);
              }}>Select page</button>
              <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50 disabled:opacity-60" disabled={!selectedIds.length} onClick={()=>setSel({})}>Clear selection</button>
              <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-blue-50 disabled:opacity-60" disabled={!selectedIds.length || !activeDomain || reclassBusy}
                title="Fetch each selected URL and re-derive its page type/title"
                onClick={async ()=>{
                  if (!activeDomain || !selectedIds.length) return;
                  if (!confirm(`Reclassify ${selectedIds.length} URL(s) for ${activeDomain}?`)) return;
                  setReclassBusy(true); setReclassMsg('');
                  try {
                    const body = { domain: activeDomain, ids: selectedIds };
                    const r = await fetch('/api/grabbing-jerome/domains/urls/reclassify', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                    const j = await r.json();
                    if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'reclass_failed')); }
                    else { setReclassMsg(`Reclassified ${j.updated||0}/${j.requested||selectedIds.length}`); setTimeout(()=>setReclassMsg(''), 2000); }
                    setSel({}); triggerRefresh();
                  } catch (e) { alert(String(e?.message||e)); }
                  finally { setReclassBusy(false); }
                }}>Reclassify selected</button>
              <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-red-50 disabled:opacity-60" disabled={!selectedIds.length || !activeDomain}
                onClick={async ()=>{
                  if (!activeDomain || !selectedIds.length) return;
                  if (!confirm(`Delete ${selectedIds.length} URL(s) for ${activeDomain}?`)) return;
                  try {
                    const r = await fetch('/api/grabbing-jerome/domains/urls', { method:'DELETE', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: activeDomain, ids: selectedIds, include_subdomains: includeSubdomains ? '1' : '0' }) });
                    const j = await r.json();
                    if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'delete_failed')); return; }
                    setSel({}); triggerRefresh();
                  } catch (e) { alert(String(e?.message||e)); }
                }}>Delete selected</button>
            </div>
            {reclassMsg && <div className="text-xs text-blue-700">{reclassMsg}</div>}
            <div className="flex items-center gap-2">
              <div className="text-sm">Add URL</div>
              <input value={addUrl} onChange={(e)=>setAddUrl(e.target.value)} placeholder={`https://${activeDomain||'domain'}/path`}
                     className="border rounded px-2 py-1 text-sm flex-1" />
              <label className="text-xs inline-flex items-center gap-1"><input type="checkbox" checked={includeSubdomains} onChange={(e)=>setIncludeSubdomains(!!e.target.checked)} /> include subdomains</label>
              <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60" disabled={!addUrl}
                onClick={async ()=>{
                  if (!activeDomain) return;
                  setAddMsg('');
                  try {
                    const body = { domain: activeDomain, url: addUrl, include_subdomains: includeSubdomains?'1':'0' };
                    const r = await fetch('/api/grabbing-jerome/domains/urls', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                    const j = await r.json();
                    if (!r.ok || j?.ok===false) { setAddMsg(j?.message||j?.error||'add_failed'); return; }
                    setAddMsg('Added'); setAddUrl('');
                    try { setUrlsOffset(0); triggerRefresh(); } catch {}
                    try { window.dispatchEvent(new CustomEvent('gj:urls:refresh')); } catch {}
                  } catch (e) { setAddMsg(String(e?.message||e)); }
                }}>Add</button>
              {addMsg && <div className="text-xs text-blue-700">{addMsg}</div>}
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xs">Sort</div>
              {['explored','discovered_at','page_type','type','title','url'].map(k => (
                <button key={k} className={"px-2 py-1 rounded border text-xs bg-white "+(urlsSortBy===k? 'font-semibold':'')} onClick={()=>toggleSort(k)}>{k}{sortArrow(k)}</button>
              ))}
            </div>
            {urlsBusy && <div className="text-xs text-gray-500">Loading…</div>}
            {!urlsBusy && urls.length===0 && <div className="text-xs text-gray-500">No URLs found</div>}
            {!urlsBusy && urls.length>0 && (
              <div className="border rounded divide-y max-h-96 overflow-auto">
                {urls.map(u => (
                  <div key={u.id} className="p-2 text-xs flex items-center gap-2">
                    <input type="checkbox" checked={!!sel[u.id]} onChange={(e)=>{ const on=e.target.checked; setSel(prev=>{ const n={...prev}; if (on) n[u.id]=true; else delete n[u.id]; return n; }); }} />
                    <div className="w-16 text-gray-500">{u.page_type||''}</div>
                    <div className="w-24 text-gray-500">{u.type||''}</div>
                    <div className="flex-1 truncate font-mono" title={u.url}>
                      <a href={u.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {u.url}
                      </a>
                    </div>
                    <div className="w-40 text-gray-400">{u.discovered_at || ''}</div>
                    <div className="w-36 text-right">
                      <button className="px-2 py-1 border rounded bg-white hover:bg-gray-50"
                        title="Extract now and send to Presta; shows live progress"
                        onClick={async ()=>{
                          try {
                            if (!activeDomain) return;
                            const w = window.open('', 'gj_progress', 'width=900,height=600');
                            if (!w) { alert('Popup blocked'); return; }
                            const write = (html)=>{ try { const el=w.document.getElementById('content'); el.innerHTML += html; el.scrollTop = el.scrollHeight; } catch {} };
                            const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Run – Progress</title><style>body{font:12px system-ui, sans-serif;padding:10px} .muted{color:#666} .ok{color:#166534} .err{color:#991b1b} pre{white-space:pre-wrap;word-break:break-word}</style></head><body><h3 style=\"margin:0\">Extract + Send – Progress</h3><div id=\"content\" style=\"border:1px solid #ddd; padding:8px; height:460px; overflow:auto\"></div><div class=\"muted\">Polling admin endpoints every 1.5s…</div></body></html>`;
                            w.document.open(); w.document.write(shell); w.document.close();
                            // 1) Persist a run
                            write(`<div>Creating run for <span class=\"font-mono\">${(u.url||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>…</div>`);
                            const body = { url: u.url, domain: activeDomain, page_type: u.page_type || 'product', persist: true, save: true };
                            const r1 = await fetch('/api/grabbing-jerome/extraction/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                            const j1 = await r1.json();
                            if (!r1.ok || j1?.ok===false || !j1?.run_id) { write(`<div class=\"err\">Extraction failed: ${String(j1?.message||j1?.error||r1.status)}</div>`); return; }
                            const runId = Number(j1.run_id||0) || 0;
                            write(`<div class=\"ok\">Run created: ${runId}</div>`);
                            // Start polling logs/errors
                            let stop = false; let lastErrIds = new Set(); let lastLogSet = new Set();
                            const renderErrors = (items=[]) => { for (const it of items) { const key=String(it.id||''); if (lastErrIds.has(key)) continue; lastErrIds.add(key); write(`<div><span class=\"muted\">[DB]</span> ${String(it.table_name||'').replace(/^.*\\./,'')} · <span class=\"muted\">${String(it.op||'')}</span> · ${String(it.error||'')}</div>`); } };
                            const renderLogs = (lines=[]) => { for (const ln of (lines||[])) { if (lastLogSet.has(ln)) continue; lastLogSet.add(ln); write(`<pre>${ln.replace(/[&<>]/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[s]))}</pre>`); } };
                            const poll = async () => {
                              if (stop) return;
                              try { const qs = new URLSearchParams(); qs.set('run_id', String(runId)); qs.set('limit','200'); const e1 = await fetch(`/api/grabbing-jerome/admin/runs/errors?${qs.toString()}`, { credentials:'include' }); const j = await e1.json(); if (e1.ok && j?.ok) renderErrors(j.items||[]); } catch {}
                              try { const qs2 = new URLSearchParams(); qs2.set('run_id', String(runId)); qs2.set('lines','800'); const e2 = await fetch(`/api/grabbing-jerome/admin/runs/logs?${qs2.toString()}`, { credentials:'include' }); const j2 = await e2.json(); if (e2.ok && j2?.ok) renderLogs(j2.items||[]); } catch {}
                              setTimeout(poll, 1500);
                            };
                            poll();
                            w.onbeforeunload = () => { stop = true; };
                            // 2) Send to Presta (use domain profile/mapping on server)
                            write('<div>Posting to /transfer/prestashop…</div>');
                            try {
                              const resp = await fetch('/api/grabbing-jerome/transfer/prestashop', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ run_id: runId, write: true }) });
                              const j = await resp.json();
                              if (!resp.ok || j?.ok===false) write(`<div class=\"err\">Failed: ${String(j?.message||j?.error||resp.status)}</div>`);
                              else write(`<div class=\"ok\">OK – product_id=${j?.product_id||''}</div>`);
                            } catch (e) { write(`<div class=\"err\">Error: ${String(e?.message||e)}</div>`); }
                          } catch (e) { alert(String(e?.message||e)); }
                        }}>Extract + Send</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-600">Total: {urlsTotal}</div>
              <div className="flex items-center gap-2">
                <button className="px-2 py-1 rounded border text-xs" disabled={urlsOffset===0} onClick={()=>setUrlsOffset(Math.max(0, urlsOffset-urlsLimit))}>Prev</button>
                <button className="px-2 py-1 rounded border text-xs" disabled={(urlsOffset+urlsLimit)>=urlsTotal} onClick={()=>setUrlsOffset(urlsOffset+urlsLimit)}>Next</button>
              </div>
            </div>
            {urlsSummary && (
              <div className="text-[11px] text-gray-500">Summary: {Object.keys(urlsSummary.by_page_type||{}).map(k=>`${k}:${urlsSummary.by_page_type[k]}`).join(', ')}</div>
            )}
          </>
        )}
    </div>
  );

  if (embedded) {
    return (
      <div className="mt-3">
        <div className="text-sm font-semibold">List discovered URLs</div>
        <Body />
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__header flex items-center justify-between">
        <span>List discovered URLs</span>
        <div className="text-xs text-gray-500">Domain-scoped URLs with filters</div>
      </div>
      <div className="panel__body">
        <Body />
      </div>
    </div>
  );
}
