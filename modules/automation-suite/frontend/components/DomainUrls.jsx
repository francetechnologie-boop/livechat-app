import React, { useEffect, useMemo, useState } from "react";

export default function DomainUrls({ activeDomain, onChangeDomain, overrideConfigText } = {}) {
  const [domains, setDomains] = useState([]);
  const [domain, setDomain] = useState("");
  const [urls, setUrls] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(200);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [sitemapInput, setSitemapInput] = useState("");
  const [lastFetchUrl, setLastFetchUrl] = useState("");
  const [lastResp, setLastResp] = useState(null);
  // Filters and selection
  const [filterType, setFilterType] = useState("all"); // all | product | category | page | other
  const [search, setSearch] = useState("");
  // explored filter: all | explored | unexplored
  const [exploredFilter, setExploredFilter] = useState('all');
  const [selSet, setSelSet] = useState({}); // key by id or url
  // Sorting (default: Explored desc)
  const [sortBy, setSortBy] = useState('explored'); // url | type | title | http | explored
  const [sortDir, setSortDir] = useState('desc'); // asc | desc
  // Global details toggle
  const [showAllDetails, setShowAllDetails] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Stored versions overlay map: { lower(url): number }
  const [verMap, setVerMap] = useState({});
  // Stored explored_at overlay map: { lower(url): string(ISO) }
  const [verTimeMap, setVerTimeMap] = useState({});
  // Autoload toggle + interval
  const [auto, setAuto] = useState(false);
  const [autoMs, setAutoMs] = useState(15000);
  // Explore modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [modalErr, setModalErr] = useState('');
  const [modalSource, setModalSource] = useState('live');
  const [modalAt, setModalAt] = useState(null); // stored explored_at when available

  const docName = (d) => {
    try {
      const u = new URL(String(d?.url || ''));
      const p = u.pathname || '';
      const base = p.split('/').filter(Boolean).pop() || '';
      return base || (d?.text || '');
    } catch {
      try { return String(d?.url || '').split('/').pop() || (d?.text || ''); } catch { return d?.text || ''; }
    }
  };

  const toggleSort = (key) => {
    setSortBy((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  };
  // Details by row
  const [openDetails, setOpenDetails] = useState({}); // key -> boolean
  const [detailMap, setDetailMap] = useState({}); // key -> { loading, error, meta, product, version }

  // Selected sitemaps from DB for current domain
  const selectedSitemaps = useMemo(() => {
    const it = (domains || []).find(d => d && d.domain === domain) || {};
    const sel = Array.isArray(it.selected_sitemaps) ? it.selected_sitemaps : [];
    // fallback to known sitemaps if no explicit selection
    const known = Array.isArray(it.sitemaps) ? it.sitemaps : [];
    const merged = sel.length ? sel : known;
    return Array.from(new Set((merged||[]).filter(Boolean)));
  }, [domains, domain]);

  const canPrev = offset > 0;
  const canNext = offset + limit < total;
  const rangeLabel = total > 0 ? `${offset+1}-${Math.min(offset+limit,total)} / ${total}` : `0-0 / 0`;

  const loadDomains = async () => {
    try {
      const r = await fetch('/api/grabbings/jerome/domains', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setDomains(Array.isArray(j.items)? j.items: []);
    } catch {}
  };
  useEffect(()=>{ loadDomains(); },[]);
  // Sync controlled value when provided
  useEffect(() => {
    if (typeof activeDomain === 'string') {
      setDomain(activeDomain || '');
    }
  }, [activeDomain]);

  const loadUrls = async (d, off=0) => {
    if (!d) return;
    setBusy(true); setMsg("");
    try {
      const u = `/api/grabbings/jerome/domains/urls?domain=${encodeURIComponent(d)}&limit=${limit}&offset=${off}`;
      setLastFetchUrl(u);
      const r = await fetch(u, { credentials:'include' });
      const j = await r.json();
      setLastResp({ ok: !!j?.ok, total: Number(j?.total||0), status: r.status });
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'list_failed');
      else { setUrls(Array.isArray(j.items)? j.items: []); setTotal(Number(j.total||0)); setOffset(off); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const resetSelected = async () => {
    if (!domain) { setMsg('Select a domain'); return; }
    // Build URL list from current rows; selection key may be id or url
    const chosen = (urls || []).filter(row => !!selSet[(row.id ?? row.url)]).map(row => row.url).filter(Boolean);
    const urls = Array.from(new Set(chosen));
    if (!urls.length) { setMsg('No URL selected'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/grabbings/jerome/domains/urls/reset-explored', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include',
        body: JSON.stringify({ domain, urls })
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'reset_failed');
      else { setMsg(`Reset ${urls.length} URL(s): deleted ${j.deleted_snapshots||0} snapshots, cleared ${j.affected_rows||0} rows`); setSelSet({}); await loadUrls(domain, offset); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const deleteSelected = async () => {
    if (!domain) { setMsg('Select a domain'); return; }
    const chosen = (urls || []).filter(row => !!selSet[(row.id ?? row.url)]).map(row => row.url).filter(Boolean);
    const list = Array.from(new Set(chosen));
    if (!list.length) { setMsg('No URL selected'); return; }
    if (!window.confirm(`Delete ${list.length} URL(s) from domain list and snapshots?`)) return;
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/grabbings/jerome/domains/urls/reset-explored', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include',
        body: JSON.stringify({ domain, urls: list, delete_urls: true })
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'delete_failed');
      else { setMsg(`Deleted ${list.length} URL(s): removed ${j.affected_rows||0} rows, snapshots ${j.deleted_snapshots||0}`); setSelSet({}); await loadUrls(domain, Math.max(0, offset - limit)); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const clearDataSelected = async () => {
    if (!domain) { setMsg('Select a domain'); return; }
    const chosen = (urls || []).filter(row => !!selSet[(row.id ?? row.url)]).map(row => row.url).filter(Boolean);
    const list = Array.from(new Set(chosen));
    if (!list.length) { setMsg('No URL selected'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/grabbings/jerome/domains/urls/clear-fields', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include',
        body: JSON.stringify({ domain, urls: list, reset_discovered_at: true })
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'clear_failed');
      else { setMsg(`Cleared ${j.affected_rows||0} row(s)`); setSelSet({}); await loadUrls(domain, offset); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  // Autoload URLs periodically when enabled
  useEffect(() => {
    if (!auto || !domain) return;
    const ms = Math.max(3000, Math.min(120000, Number(autoMs||15000)));
    const id = setInterval(() => { loadUrls(domain, offset); }, ms);
    return () => clearInterval(id);
  }, [auto, autoMs, domain, offset, limit]);

  // After loading URLs, fetch stored versions in batch to ensure parity with snapshots
  useEffect(() => {
    const doFetch = async () => {
      try {
        if (!domain) return;
        const list = (urls||[]).map(u=>u.url).filter(Boolean);
        if (!list.length) { setVerMap({}); return; }
        const r = await fetch('/api/grabbings/jerome/domains/urls/versions', {
          method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
          body: JSON.stringify({ domain, urls: list })
        });
        const j = await r.json();
        if (r.ok && j?.ok) {
          const map = {};
          const tmap = {};
          for (const it of (Array.isArray(j.items)? j.items: [])) {
            const k = String(it.url||'').toLowerCase().trim();
            const v = (it.config_version != null) ? Number(it.config_version) : null;
            if (k && v != null && !Number.isNaN(v)) map[k] = v;
            if (k && it.explored_at) tmap[k] = it.explored_at;
          }
          setVerMap(map);
          setVerTimeMap(tmap);
        }
      } catch {}
    };
    doFetch();
  // stringify URLs to trigger when list changes
  }, [domain, JSON.stringify((urls||[]).map(u=>u.url))]);

  // removed: recent explores list (no longer shown)

  useEffect(()=>{ if (domain) { loadUrls(domain, 0); } }, [domain, limit]);

  // Auto-extract on first load when no URLs and we have known sitemaps
  useEffect(()=>{
    let timer;
    if (domain && !busy && total === 0 && (selectedSitemaps||[]).length) {
      // debounce a bit to avoid double triggers on fast state changes
      timer = setTimeout(()=>{ extractDomainSitemaps().catch(()=>{}); }, 300);
    }
    return ()=> { if (timer) clearTimeout(timer); };
  }, [domain, total, busy, selectedSitemaps]);

  const exploreOne = async (url) => {
    setMsg(""); setBusy(true);
    try {
      const r = await fetch('/api/grabbings/jerome/page/explore', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ url }) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'explore_failed');
      else {
        setMsg('Explored.');
        try {
          const ver = j?.meta?.config_used?.version;
          if (ver != null) {
            const key = (urls||[]).find(u=>u.url===url)?.id ?? url;
            setDetailMap(prev=>({ ...prev, [key]: { ...(prev[key]||{}), version: Number(ver) } }));
          }
        } catch {}
        await loadUrls(domain, offset);
      }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  // Prepare a URL for Presta transfer (insert/upsert into grabbing_jerome_domains_url_ready_transfert)
  const prepareOne = async (url) => {
    if (!domain || !url) return;
    setMsg(""); setBusy(true);
    try {
      const r = await fetch('/api/grabbings/jerome/domains/url/prepare-presta', {
        method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
        body: JSON.stringify({ domain, url })
      });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'prepare_failed');
      else setMsg('Prepared for Presta transfer.');
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  // (removed) Upload images action is no longer available from this view

  const exploreSelected = async () => {
    const items = (urls || []).filter(u => {
      const key = u.id ?? u.url;
      return !!selSet[key];
    });
    if (!items.length) {
      setMsg('Select at least one URL');
      return;
    }
    setBusy(true); setMsg('');
    try {
      let ok = 0, fail = 0;
      for (const it of items) {
        try {
          const r = await fetch('/api/grabbings/jerome/page/explore', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ url: it.url }) });
          const j = await r.json();
          if (!r.ok || j?.ok===false) fail++; else ok++;
        } catch { fail++; }
      }
      setMsg(`Explored ${ok} URL(s), ${fail} failed.`);
      await loadUrls(domain, offset);
    } catch (e) {
      setMsg(String(e?.message||e));
    } finally {
      setBusy(false);
    }
  };

  // Open details in modal only (no inline toggle)
  const seeDetails = async (row) => {
    const key = row.id ?? row.url;
    if (!domain || !row?.url) return;
    // Always use stored snapshot/live (DB config). Ignore any editor overrides here.
    if (detailMap[key] && !detailMap[key].error && !detailMap[key].loading) {
      const det = detailMap[key] || {};
      try {
        setModalErr('');
        setModalData({ ok:true, url: row.url, page_type: det.page_type||'', meta: det.meta||{}, product: det.product||{}, links_sample: Array.isArray(det.links_sample)? det.links_sample: [], preview:false });
        setModalSource('live');
        setModalAt(null);
        setModalOpen(true);
      } catch {}
      return;
    }
    setDetailMap(prev=>({ ...prev, [key]: { loading:true } }));
    try {
      // Always use stored snapshot or live canonical (uses saved DB config on server)
      // Prefer stored snapshot
      const us = `/api/grabbings/jerome/domains/url/stored?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(row.url)}`;
      let gotStored = false;
      try {
        const rs = await fetch(us, { credentials:'include' });
        const js = await rs.json();
        if (rs.ok && js?.ok && js?.item?.result_json) {
          const data = js.item.result_json;
          const det = {
            loading: false,
            error: '',
            page_type: data.page_type || '',
            title: (data?.meta?.title || ''),
            meta: data.meta || {},
            product: data.product || {},
            links_sample: Array.isArray(data.links_sample) ? data.links_sample : [],
            version: (data?.meta?.config_used?.version ?? null)
          };
          setDetailMap(prev=>({ ...prev, [key]: det }));
          setModalErr('');
          setModalData({ ...data, preview: false });
          setModalSource('stored');
          setModalAt(js?.item?.explored_at || null);
          setModalOpen(true);
          gotStored = true;
        }
      } catch {}
      if (gotStored) return;
      // Fallback to canonical details
      const uc = `/api/grabbings/jerome/domains/url?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(row.url)}`;
      const rc = await fetch(uc, { credentials:'include' });
      const jc = await rc.json();
      if (!rc.ok || jc?.ok===false) setDetailMap(prev=>({ ...prev, [key]: { loading:false, error: jc?.message||jc?.error||'not_found' } }));
      else {
        const det = { loading:false, error:'', page_type: jc.page_type || '', title: jc.title || '', meta:jc.meta||{}, product:jc.product||{}, links_sample: Array.isArray(jc.links_sample)? jc.links_sample: [], version: (jc?.meta?.config_used?.version ?? null) };
        setDetailMap(prev=>({ ...prev, [key]: det }));
        try {
          setModalErr('');
          setModalData({ ok:true, url: row.url, page_type: det.page_type, meta: det.meta, product: det.product, links_sample: det.links_sample, preview:false });
          setModalSource('live');
          setModalAt(null);
          setModalOpen(true);
        } catch {}
      }
    } catch (e) {
      setDetailMap(prev=>({ ...prev, [key]: { loading:false, error: String(e?.message||e) } }));
    }
  };

  const copyJson = async (row) => {
    if (!domain || !row?.url) return;
    setMsg("");
    try {
      const u = `/api/grabbings/jerome/domains/url?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(row.url)}`;
      const r = await fetch(u, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || j?.ok === false) { setMsg(j?.message || j?.error || 'fetch_failed'); return; }
      const txt = JSON.stringify(j, null, 2);
      let copied = false;
      try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(txt); copied = true; } } catch {}
      if (!copied) {
        try {
          const ta = document.createElement('textarea');
          ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.focus(); ta.select();
          copied = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch {}
      }
      setMsg(copied ? 'JSON copied to clipboard.' : 'Copy failed (clipboard unavailable).');
    } catch (e) { setMsg(String(e?.message || e)); }
  };

  const extractDomainSitemaps = async () => {
    if (!domain) return;
    setBusy(true); setMsg('');
    try {
      let sitemaps = [];
      if (sitemapInput.trim()) sitemaps = [sitemapInput.trim()];
      else if (selectedSitemaps.length) sitemaps = selectedSitemaps;
      const body = sitemaps.length ? { domain, sitemaps } : { domain };
      const r = await fetch('/api/grabbings/jerome/discover/domains/extract', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'extract_failed');
      else { setMsg(`Extracted ${j.total_urls||0} URL(s). Inserted ${j.inserted||0}.`); await loadUrls(domain, 0); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mb-3 border rounded p-3 bg-white">
      <div className="flex items-center justify-between">
        <div className="font-medium">Domain URLs</div>
        <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=> setCollapsed(v=>!v)}>
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      <div className={collapsed ? 'hidden' : ''}>
      <div className="mt-2 grid grid-cols-1 md:grid-cols-6 gap-2 items-end text-[11px]">
        <div className="md:col-span-3">
          <label className="block mb-1">Domain</label>
          <select className="w-full border rounded px-2 py-1" value={typeof activeDomain === 'string' ? (activeDomain || '') : domain} onChange={(e)=> (onChangeDomain? onChangeDomain(e.target.value): setDomain(e.target.value))}>
            <option value="">-- select domain --</option>
            {domains.map(d => (<option key={d.domain} value={d.domain}>{d.domain}</option>))}
          </select>
        </div>
        <div className="md:col-span-3 flex items-center gap-2">
          <label>Page size</label>
          <input type="number" className="border rounded px-1 py-0.5 w-20" value={limit} onChange={(e)=> setLimit(Math.max(10, Math.min(1000, Number(e.target.value||200))))} />
          <button className="px-2 py-1 border rounded" disabled={!canPrev || busy} onClick={()=> loadUrls(domain, Math.max(0, offset - limit))}>Prev</button>
          <button className="px-2 py-1 border rounded" disabled={!canNext || busy} onClick={()=> loadUrls(domain, offset + limit)}>Next</button>
          <div className="text-gray-500">{rangeLabel}</div>
          <button className="px-2 py-1 border rounded" disabled={!domain || busy} onClick={()=> loadUrls(domain, offset)}>Refresh URLs</button>
          <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={auto} onChange={(e)=> setAuto(e.target.checked)} /> Autoload</label>
          <input type="number" className="border rounded px-1 py-0.5 w-24" title="Interval (ms)" value={autoMs} onChange={(e)=> setAutoMs(Number(e.target.value||15000))} />
          <input className="border rounded px-2 py-1 w-64" placeholder="Sitemap URL (optional)" value={sitemapInput} onChange={(e)=> setSitemapInput(e.target.value)} />
          <button className="px-2 py-1 border rounded" disabled={!domain || busy} title="Populate URLs from selected sitemaps for this domain" onClick={extractDomainSitemaps}>Extract from sitemaps</button>
        </div>
      </div>
      {/* Filters */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <label className="flex items-center gap-1">
          Type
          <select className="border rounded px-1 py-0.5" value={filterType} onChange={(e)=> setFilterType(e.target.value)}>
            <option value="all">All</option>
            <option value="product">Product</option>
            <option value="category">Category</option>
            <option value="page">Page</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          Search
          <input className="border rounded px-2 py-0.5 w-64" placeholder="Filter by URL/title" value={search} onChange={(e)=> setSearch(e.target.value)} />
        </label>
        <label className="flex items-center gap-1">
          Explored
          <select className="border rounded px-1 py-0.5" value={exploredFilter} onChange={(e)=> setExploredFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="explored">Explored only</option>
            <option value="unexplored">Unexplored only</option>
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-gray-500">Using saved config</span>
          <span>Selected: {Object.keys(selSet||{}).length}</span>
          <button className="px-2 py-1 border rounded" disabled={busy} onClick={()=> setSelSet({})}>Clear selection</button>
          <button className="px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" disabled={busy || !Object.keys(selSet||{}).length} onClick={exploreSelected}>Explore selected</button>
          <button className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60" disabled={busy || !Object.keys(selSet||{}).length} title="Clear explored + snapshots for selected URLs" onClick={resetSelected}>Reset selected</button>
          <button className="px-2 py-1 rounded bg-red-700 text-white hover:bg-red-800 disabled:opacity-60" disabled={busy || !Object.keys(selSet||{}).length} title="Delete selected URLs + snapshots" onClick={deleteSelected}>Delete selected</button>
          <button className="px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60" disabled={busy || !Object.keys(selSet||{}).length} title="Clear Type, Title, Page Type, Meta, Product, Explored (and reset discovered_at)" onClick={clearDataSelected}>Clear data</button>
        </div>
      </div>
      {!!lastFetchUrl && (
        <div className="text-[11px] text-gray-600 mt-1">
          <span className="font-medium">Debug:</span> GET {lastFetchUrl} → {lastResp? `status ${lastResp.status}, ok ${String(lastResp.ok)}, total ${lastResp.total}` : 'pending'}
        </div>
      )}
      {!!msg && <div className="text-[11px] text-red-600 mt-1">{msg}</div>}
      {!!(selectedSitemaps||[]).length && (
        <div className="mt-2 text-[11px] text-gray-700">
          <div className="font-medium">Selected sitemaps ({selectedSitemaps.length})</div>
          <div className="max-h-24 overflow-auto border rounded bg-gray-50 p-1">
            {selectedSitemaps.map((u,i)=>(<div key={i} className="break-all">{u}</div>))}
          </div>
        </div>
      )}
      <div className="mt-2 grid grid-cols-1 gap-3">
        <div>
          <div className="font-medium mb-1">URLs</div>
          <div className="max-h-96 overflow-auto border rounded bg-gray-50">
            <table className="min-w-full text-[11px]">
              <thead className="bg-gray-100 text-gray-700 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1 border-b">
                    <input
                      type="checkbox"
                      onChange={(e)=>{
                        const next = {};
                        const filtered = (urls||[]).filter(u => {
                          const t = String(u.page_type||'').toLowerCase();
                          const typeOk = filterType==='all' ? true : (filterType==='other' ? (t!=="product" && t!=="category" && t!=="page") : t.includes(filterType));
                          const searchOk = !search.trim() ? true : (String(u.url||'').toLowerCase().includes(search.toLowerCase()) || String(u.title||'').toLowerCase().includes(search.toLowerCase()));
                          const exploredOk = exploredFilter==='all' ? true : (exploredFilter==='explored' ? !!u.explored : !u.explored);
                          return typeOk && searchOk && exploredOk;
                        });
                        if (e.target.checked) filtered.forEach(u=> { next[u.id ?? u.url] = true; });
                        setSelSet(next);
                      }}
                    />
                  </th>
                  <th className="text-left px-2 py-1 border-b">
                    <button className="underline" onClick={()=>toggleSort('type')}>Type{sortBy==='type' ? (sortDir==='asc'?' ▲':' ▼') : ''}</button>
                  </th>
                  <th className="text-left px-2 py-1 border-b">
                    <button className="underline" onClick={()=>toggleSort('url')}>URL{sortBy==='url' ? (sortDir==='asc'?' ▲':' ▼') : ''}</button>
                  </th>
                  <th className="text-left px-2 py-1 border-b">
                    <button className="underline" onClick={()=>toggleSort('title')}>Title{sortBy==='title' ? (sortDir==='asc'?' ▲':' ▼') : ''}</button>
                  </th>
                  <th className="text-left px-2 py-1 border-b">
                    <button className="underline" onClick={()=>toggleSort('http')}>HTTP{sortBy==='http' ? (sortDir==='asc'?' ▲':' ▼') : ''}</button>
                  </th>
                  <th className="text-left px-2 py-1 border-b">
                    <button className="underline" onClick={()=>toggleSort('explored')}>Explored{sortBy==='explored' ? (sortDir==='asc'?' ▲':' ▼') : ''}</button>
                  </th>
                  <th className="text-left px-2 py-1 border-b">Config</th>
                  <th className="text-left px-2 py-1 border-b">Version</th>
                  <th className="text-left px-2 py-1 border-b">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(urls||[])
                  .filter(u => {
                    const t = String(u.page_type||'').toLowerCase();
                    const typeOk = filterType==='all' ? true : (filterType==='other' ? (t!=="product" && t!=="category" && t!=="page") : t.includes(filterType));
                    const searchOk = !search.trim() ? true : (String(u.url||'').toLowerCase().includes(search.toLowerCase()) || String(u.title||'').toLowerCase().includes(search.toLowerCase()));
                    const exploredOk = exploredFilter==='all' ? true : (exploredFilter==='explored' ? !!u.explored : !u.explored);
                    return typeOk && searchOk && exploredOk;
                  })
                  .sort((a, b) => {
                    const dir = sortDir === 'asc' ? 1 : -1;
                    const get = (row) => {
                      switch (sortBy) {
                        case 'type': return String(row.page_type||'').toLowerCase();
                        case 'title': return String(row.title||'').toLowerCase();
                        case 'http': return (typeof row.http_status === 'number' ? row.http_status : -1);
                        case 'explored': return row.explored ? new Date(row.explored).getTime() : 0;
                        case 'url':
                        default: return String(row.url||'').toLowerCase();
                      }
                    };
                    const va = get(a); const vb = get(b);
                    if (va < vb) return -1 * dir;
                    if (va > vb) return 1 * dir;
                    return 0;
                  })
                  .map((row) => {
                    const key = row.id ?? row.url;
                    const det = detailMap[key] || {};
                    const open = false; // disable inline expand; use modal only
                    const urlKeyLower = String(row.url||'').toLowerCase().trim();
                    const verStored = (()=>{ try { return verMap[urlKeyLower]; } catch { return null; } })();
                    const verList = (verStored != null ? verStored : (typeof row.config_version === 'number' ? row.config_version : null));
                    const verDetails = (typeof det?.version === 'number' ? det.version : null);
                    // Prefer the version from the stored/cached details when available, else fallback to list join
                    const verShow = (verDetails != null ? verDetails : verList);
                    const verTime = (()=>{ try { return verTimeMap[urlKeyLower] || null; } catch { return null; } })();
                    return (
                      <React.Fragment key={key}>
                        <tr className="border-b last:border-0">
                          <td className="px-2 py-1">
                            <input type="checkbox" checked={!!selSet[key]} onChange={(e)=> setSelSet(prev => { const n={...prev}; if (e.target.checked) n[key]=true; else delete n[key]; return n; })} />
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap text-gray-600">{row.page_type||''}</td>
                          <td className="px-2 py-1 max-w-[520px]"><a className="text-blue-600 underline break-all" href={row.url} target="_blank" rel="noreferrer">{row.url}</a></td>
                          <td className="px-2 py-1 text-gray-700 max-w-[320px] truncate" title={row.title||''}>{row.title || '-'}</td>
                          <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{typeof row.http_status === 'number' ? row.http_status : '-'}</td>
                          <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{row.explored? new Date(row.explored).toLocaleString(): ''}</td>
                          <td className="px-2 py-1 text-gray-600 whitespace-nowrap" title={row.type_reason||''}>{row.type_reason || '-'}</td>
                          <td className="px-2 py-1 text-gray-700 whitespace-nowrap">
                            {verShow != null ? `v${verShow}` : ''}
                            {verTime ? <span className="text-gray-500 ml-1">· {new Date(verTime).toLocaleString()}</span> : ''}
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap text-right space-x-1">
                            <span className="text-gray-600 mr-1 align-middle">
                              {verShow!=null? `v${verShow}`: ''}
                              {verTime ? ` · ${new Date(verTime).toLocaleString()}` : ''}
                            </span>
                            <button className="px-2 py-0.5 border rounded" disabled={busy} title={verShow!=null? `Run with v${verShow} (latest stored)`: 'Run with latest stored config'} onClick={()=> exploreOne(row.url)}>Explore</button>
                            <button className="px-2 py-0.5 border rounded" disabled={busy} title="Prepare transfer to Presta" onClick={()=> prepareOne(row.url)}>Prepare Presta</button>
                            <button className="px-2 py-0.5 border rounded" onClick={()=> seeDetails(row)}>See details</button>
                            <button className="px-2 py-0.5 border rounded" disabled={busy} onClick={()=> copyJson(row)}>Copy JSON</button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b last:border-0 bg-gray-50">
                            <td colSpan={8} className="px-2 py-2">
                              {det.loading && <div className="text-[11px] text-gray-600">Loading…</div>}
                              {!!det.error && <div className="text-[11px] text-red-600">{det.error}</div>}
                              {!det.loading && !det.error && (
                                <div className="text-[11px] text-gray-800 space-y-2">
                                  {/* Page info */}
                                  {(det.page_type || det?.meta?.type_reason || det?.meta?.config_used) && (
                                    <div className="flex items-center gap-3 text-[11px] text-gray-700">
                                      {!!det.page_type && <span className="inline-block px-2 py-0.5 rounded border bg-white">Type: {det.page_type}</span>}
                                      {!!det?.meta?.type_reason && <span className="inline-block px-2 py-0.5 rounded border bg-white" title="Reason for classification">Reason: {det.meta.type_reason}</span>}
                                      {!!det?.meta?.config_used && <span className="inline-block px-2 py-0.5 rounded border bg-white" title="Config used to classify">Cfg: v{det.meta.config_used.version ?? '-'} · force={String(det.meta.config_used.force||'')}, rules={Number(det.meta.config_used.path_rules||0)}</span>}
                                      {!!row?.explored && <span className="text-gray-500">Explored: {new Date(row.explored).toLocaleString()}</span>}
                                    </div>
                                  )}
                                  {/* Ordered content rendering takes precedence when present */}
                                  {Array.isArray(det.meta?.content) && det.meta.content.length > 0 && (
                                    <div className="space-y-2">
                                      {det.meta.content.map((blk) => (
                                        <div key={blk.order} className="text-[11px]">
                                          {blk.type === 'heading' && (
                                            <div className="font-medium">{blk.text}</div>
                                          )}
                                          {blk.type === 'paragraph' && (
                                            <div className="whitespace-pre-wrap break-words">{blk.text}</div>
                                          )}
                                          {blk.type === 'list' && Array.isArray(blk.items) && (
                                            <ul className="list-disc pl-5">
                                              {blk.items.map((it,i)=>(<li key={i}>{it}</li>))}
                                            </ul>
                                          )}
                                          {blk.type === 'image' && blk.src && (
                                            <a href={blk.src} target="_blank" rel="noreferrer">
                                              <img src={blk.src} alt="" className="w-16 h-16 object-cover rounded border" />
                                            </a>
                                          )}
                                          {blk.type === 'document' && blk.href && (
                                            <div className="truncate">
                                              <a className="text-blue-600 underline" href={blk.href} target="_blank" rel="noreferrer">{blk.label || blk.href}</a>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* Fallbacks when ordered content not present */}
                                  {/* Meta quick info */}
                                  {(det.meta?.title || det.meta?.description) && (
                                    <div className="border rounded bg-white p-2">
                                      {!!det.meta?.title && <div className="font-medium">{det.meta.title}</div>}
                                      {!!det.meta?.description && <div className="text-gray-700">{det.meta.description}</div>}
                                    </div>
                                  )}
                                  {/* Product quick info */}
                                  {(det.product?.name || det.product?.sku || det.product?.price) && (
                                    <div className="border rounded bg-white p-2 flex flex-wrap gap-4">
                                      {!!det.product?.name && <div><span className="text-gray-600">Name:</span> {det.product.name}</div>}
                                      {!!det.product?.sku && <div><span className="text-gray-600">SKU:</span> {det.product.sku}</div>}
                                      {(det.product?.price || det.product?.currency) && (
                                        <div><span className="text-gray-600">Price:</span> {det.product.price || '-'} {det.product.currency || ''}</div>
                                      )}
                                    </div>
                                  )}
                                  {Array.isArray(det.product?.images) && det.product.images.length > 0 && (
                                    <div>
                                      <div className="font-medium mb-1">Pictures</div>
                                      <div className="flex flex-wrap gap-2">
                                        {det.product.images.slice(0, 24).map((src, i) => (
                                          <a key={i} href={src} target="_blank" rel="noreferrer">
                                            <img src={src} alt="" className="w-16 h-16 object-cover rounded border" />
                                          </a>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Fallback to og:image if no product images shown */}
                                  {(!Array.isArray(det.product?.images) || det.product.images.length === 0) && !!det.meta?.og_image && (
                                    <div>
                                      <div className="font-medium mb-1">Picture</div>
                                      <a href={det.meta.og_image} target="_blank" rel="noreferrer">
                                        <img src={det.meta.og_image} alt="" className="w-16 h-16 object-cover rounded border" />
                                      </a>
                                    </div>
                                  )}
                                  {/* Locally downloaded images (if enabled per-domain) */}
                                  {Array.isArray(det.product?.images_local) && det.product.images_local.length > 0 && (
                                    <div>
                                      <div className="font-medium mb-1">Local Pictures</div>
                                      <div className="flex flex-wrap gap-2">
                                        {det.product.images_local.slice(0, 24).map((it, i) => (
                                          <a key={i} href={it.download_url || it.url} target="_blank" rel="noreferrer" title={it.file || ''}>
                                            <img src={it.download_url || it.url} alt="" className="w-16 h-16 object-cover rounded border" />
                                          </a>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {Array.isArray(det.product?.variants) && det.product.variants.length > 0 && (
                                    <div>
                                      <div className="font-medium mb-1">Variants ({det.product.variants.length})</div>
                                      <div className="max-h-48 overflow-auto border rounded bg-white">
                                        {det.product.variants.map((v, i) => (
                                          <div key={i} className="px-2 py-1 border-b last:border-0 flex items-center gap-2">
                                            {v.image && <img src={v.image} alt="" className="w-10 h-10 object-cover rounded border" />}
                                            <div className="flex-1">
                                              <div className="text-gray-800 truncate" title={v.title||''}>{v.title || '-'}</div>
                                              <div className="text-gray-600">{v.sku ? `SKU: ${v.sku}` : ''} {v.price ? `· ${v.price}${det.product.currency? ' '+det.product.currency: ''}` : ''}</div>
                                              {!!v.url && <a className="text-blue-600 underline" href={v.url} target="_blank" rel="noreferrer">Open</a>}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {Array.isArray(det.product?.documents) && det.product.documents.length > 0 && (
                                    <div>
                                      <div className="font-medium mb-1">Documents</div>
                                      <div className="space-y-1">
                                        {det.product.documents.map((d, i) => (
                                          <div key={i} className="truncate">
                                            <a className="text-blue-600 underline" href={d.url} target="_blank" rel="noreferrer">{d.text || d.url}</a>
                                            <span className="text-gray-500 ml-1">({docName(d)})</span>
                                            {!!d.download_url && (
                                              <a className="ml-2 text-[11px] text-gray-700 underline" href={d.download_url} target="_blank" rel="noreferrer">download</a>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Fallback to meta.documents when provided by explorer */}
                                  {(!Array.isArray(det.product?.documents) || !det.product.documents.length) && Array.isArray(det.meta?.documents) && det.meta.documents.length > 0 && (
                                    <div>
                                      <div className="font-medium mb-1">Documents</div>
                                      <div className="space-y-1">
                                        {det.meta.documents.map((d, i) => (
                                          <div key={i} className="truncate">
                                            <a className="text-blue-600 underline" href={d.url} target="_blank" rel="noreferrer">{d.text || d.url}</a>
                                            <span className="text-gray-500 ml-1">({docName(d)})</span>
                                            {!!d.download_url && (
                                              <a className="ml-2 text-[11px] text-gray-700 underline" href={d.download_url} target="_blank" rel="noreferrer">download</a>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Text sample */}
                                  {!!det.meta?.text_sample && (
                                    <div>
                                      <div className="font-medium mb-1">Text</div>
                                      <div className="max-h-40 overflow-auto border rounded bg-white p-2 whitespace-pre-wrap break-words">
                                        {det.meta.text_sample.slice(0, 4000)}
                                      </div>
                                    </div>
                                  )}
                                  {/* Product Sections */}
                                  {!!det.meta?.sections && (
                                    <div className="space-y-2">
                                      {!!det.meta.sections.product_information && (
                                        <div>
                                          <div className="font-medium mb-1">Product Information</div>
                                          <div className="max-h-40 overflow-auto border rounded bg-white p-2 whitespace-pre-wrap break-words">
                                            {det.meta.sections.product_information}
                                          </div>
                                        </div>
                                      )}
                                      {!!det.meta.sections.parameters_applications && (
                                        <div>
                                          <div className="font-medium mb-1">Parameters & Applications</div>
                                          <div className="max-h-40 overflow-auto border rounded bg-white p-2 whitespace-pre-wrap break-words">
                                            {det.meta.sections.parameters_applications}
                                          </div>
                                        </div>
                                      )}
                                      {!!det.meta.sections.technical_specifications && (
                                        <div>
                                          <div className="font-medium mb-1">Technical Specifications</div>
                                          <div className="max-h-40 overflow-auto border rounded bg-white p-2 whitespace-pre-wrap break-words">
                                            {det.meta.sections.technical_specifications}
                                          </div>
                                        </div>
                                      )}
                                      {Array.isArray(det.meta.sections.additional_information) && det.meta.sections.additional_information.length > 0 && (
                                        <div>
                                          <div className="font-medium mb-1">Additional Information</div>
                                          <div className="max-h-40 overflow-auto border rounded bg-white p-2">
                                            <table className="min-w-full text-[11px]">
                                              <tbody>
                                                {det.meta.sections.additional_information.map((r,i)=> (
                                                  <tr key={i} className="border-b last:border-0">
                                                    <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{r.name}</td>
                                                    <td className="px-2 py-1">{r.value}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {/* Headings */}
                                  {Array.isArray(det.meta?.headings) && det.meta.headings.length > 0 && (
                                    <div>
                                      <div className="font-medium mb-1">Headings</div>
                                      <div className="border rounded bg-white p-2 space-y-1">
                                        {det.meta.headings.map((h,i)=> (
                                          <div key={i}>
                                            <span className="text-gray-600">H{h.level}:</span> {(h.items||[]).join(' · ')}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Links sample */}
                                  {Array.isArray(det.links_sample) && det.links_sample.length > 0 && (
                                    <div>
                                      <div className="font-medium mb-1">Links (same domain) – {det.links_sample.length}</div>
                                      <div className="max-h-24 overflow-auto border rounded bg-white p-1">
                                        {det.links_sample.slice(0,50).map((u,i)=>(
                                          <div key={i} className="truncate"><a className="text-blue-600 underline" href={u} target="_blank" rel="noreferrer">{u}</a></div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {(!Array.isArray(det.product?.images) || !det.product.images.length) && (!Array.isArray(det.product?.variants) || !det.product.variants.length) && (!Array.isArray(det.product?.documents) || !det.product.documents.length) && (
                                    <div className="text-gray-600">No details available. Try Explore first.</div>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                {!(urls||[]).length && (
                  <tr>
                    <td colSpan={7} className="px-2 py-1 text-gray-500">No URLs for this domain.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {/* Details modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={()=> setModalOpen(false)} />
          <div className="relative bg-white border rounded shadow-lg max-w-5xl w-[95vw] max-h-[85vh] overflow-auto p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">
                Details
                {modalData?.meta?.config_used?.version!=null && (
                  <span className="ml-2 text-[11px] text-gray-600">
                    v{modalData.meta.config_used.version}
                    {modalSource==='preview' && ' · preview'}
                    {modalSource==='stored' && (modalAt ? ` · stored ${new Date(modalAt).toLocaleString()}` : ' · stored')}
                    {modalSource==='live' && ' · live'}
                  </span>
                )}
              </div>
              <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=> setModalOpen(false)}>Close</button>
            </div>
            {!!modalErr && <div className="text-[11px] text-red-600 mt-1">{modalErr}</div>}
            {!!modalData && (
              <div className="mt-2 text-[11px]">
                <div className="mb-1 text-gray-700">Type: {modalData.page_type||'-'} {modalData.meta && modalData.meta.title ? ('· '+modalData.meta.title) : ''}</div>
                <div className="mb-1 text-gray-700">Price: {(modalData.product && modalData.product.price) || '-'} {(modalData.product && modalData.product.currency) || ''} · SKU: {(modalData.product && modalData.product.sku) || '-'}</div>
                <div className="mb-1 text-gray-700">Variants: {Array.isArray(modalData.product && modalData.product.variants) ? modalData.product.variants.length : 0} · Docs: {Array.isArray(modalData.meta && modalData.meta.documents) ? modalData.meta.documents.length : 0}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  <div className="space-y-3">
                    {/* Pictures */}
                    <div>
                      <div className="font-medium mb-1">Pictures</div>
                      <div className="flex flex-wrap gap-2">
                        {Array.isArray(modalData?.product?.images) && modalData.product.images.slice(0, 24).map((src, i) => (
                          <a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" className="w-16 h-16 object-cover rounded border" /></a>
                        ))}
                        {(!Array.isArray(modalData?.product?.images) || modalData.product.images.length === 0) && modalData?.meta?.og_image && (
                          <a href={modalData.meta.og_image} target="_blank" rel="noreferrer"><img src={modalData.meta.og_image} alt="" className="w-16 h-16 object-cover rounded border" /></a>
                        )}
                        {Array.isArray(modalData?.product?.images_local) && modalData.product.images_local.slice(0, 12).map((it, i) => (
                          <a key={i} href={it.download_url || it.url} target="_blank" rel="noreferrer" title={it.file || ''}><img src={it.download_url || it.url} alt="" className="w-16 h-16 object-cover rounded border" /></a>
                        ))}
                      </div>
                    </div>
                    {/* Variants */}
                    {Array.isArray(modalData?.product?.variants) && modalData.product.variants.length > 0 && (
                      <div>
                        <div className="font-medium mb-1">Variants ({modalData.product.variants.length})</div>
                        <div className="max-h-40 overflow-auto border rounded bg-white">
                          {modalData.product.variants.slice(0, 50).map((v, i) => (
                            <div key={i} className="px-2 py-1 border-b last:border-0 flex items-center gap-2">
                              {v.image && <img src={v.image} alt="" className="w-8 h-8 object-cover rounded border" />}
                              <div className="flex-1 truncate" title={v.title||''}>{v.title || '-'}</div>
                              <div className="text-gray-600 whitespace-nowrap">{v.sku || ''} {v.price? (' · '+v.price): ''}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Meta details (align with Test Result) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="border rounded bg-white p-2">
                        <div className="font-medium mb-1">Meta</div>
                        <div className="text-gray-800">title</div>
                        <div className="text-gray-700 mb-1">{modalData?.meta?.title || '-'}</div>
                        <div className="text-gray-800">description</div>
                        <div className="text-gray-700 mb-1 max-h-24 overflow-auto whitespace-pre-wrap">{modalData?.meta?.description || '-'}</div>
                        <div className="text-gray-800">canonical</div>
                        <div className="mb-1 break-all"><a className="text-blue-600 underline" href={modalData?.meta?.canonical||''} target="_blank" rel="noreferrer">{modalData?.meta?.canonical || '-'}</a></div>
                        <div className="text-gray-800">og_title</div>
                        <div className="text-gray-700 mb-1">{modalData?.meta?.og_title || '-'}</div>
                        <div className="text-gray-800">og_image</div>
                        <div className="mb-1 break-all">
                          {modalData?.meta?.og_image ? (
                            <div className="flex items-center gap-2">
                              <a href={modalData.meta.og_image} target="_blank" rel="noreferrer" title={modalData.meta.og_image}>
                                <img src={modalData.meta.og_image}
                                     alt=""
                                     className="w-16 h-16 object-cover rounded border"
                                     onError={(e)=>{ try{ e.currentTarget.style.display='none'; } catch{} }} />
                              </a>
                              <a className="text-blue-600 underline break-all" href={modalData.meta.og_image} target="_blank" rel="noreferrer">{modalData.meta.og_image}</a>
                            </div>
                          ) : '-'}
                        </div>
                        <div className="text-gray-800">text_sample</div>
                        <div className="text-gray-700 max-h-24 overflow-auto whitespace-pre-wrap">{modalData?.meta?.text_sample || '-'}</div>
                        <div className="text-gray-800 mt-1">type_reason</div>
                        <div className="text-gray-700">{modalData?.meta?.type_reason || modalData?.type_reason || '-'}</div>
                      </div>
                      <div className="border rounded bg-white p-2">
                        <div className="font-medium mb-1">Product</div>
                        <div className="text-gray-800">name</div>
                        <div className="text-gray-700 mb-1">{modalData?.product?.name || '-'}</div>
                        <div className="text-gray-800">price</div>
                        <div className="text-gray-700 mb-1">{modalData?.product?.price || '-'} {modalData?.product?.currency || ''}</div>
                        <div className="text-gray-800">sku</div>
                        <div className="text-gray-700">{modalData?.product?.sku || '-'}</div>
                      </div>
                    </div>
                    {/* Product Information */}
                    {!!modalData?.meta?.sections?.product_information && (
                      <div className="border rounded bg-white p-2">
                        <div className="font-medium mb-1">Product Information</div>
                        <div className="text-gray-700 whitespace-pre-wrap">{modalData.meta.sections.product_information}</div>
                      </div>
                    )}
                    {/* Headings */}
                    {Array.isArray(modalData?.meta?.headings) && modalData.meta.headings.length>0 && (
                      <div className="border rounded bg-white p-2">
                        <div className="font-medium mb-1">Headings</div>
                        <div className="space-y-1">
                          {modalData.meta.headings.slice(0,50).map((h, i)=> (
                            <div key={i} className="text-gray-700">
                              <span className="text-gray-600">H{h.level||'-'}:</span> {(Array.isArray(h.items)? h.items.join(' · '): '')}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="font-medium mb-1">Full JSON</div>
                    <div className="max-h-64 overflow-auto border rounded bg-white p-2">
                      <pre className="text-[10px] whitespace-pre-wrap break-words">{JSON.stringify(modalData, null, 2)}</pre>
                    </div>
                    <div className="mt-2">
                      <button
                        className="px-2 py-0.5 border rounded"
                        onClick={async ()=>{
                          try {
                            const txt = JSON.stringify(modalData, null, 2);
                            if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(txt);
                          } catch (e) { setModalErr(String(e?.message||e)); }
                        }}
                      >Copy JSON</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
