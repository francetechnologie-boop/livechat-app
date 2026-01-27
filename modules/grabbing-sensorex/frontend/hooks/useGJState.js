import React, { useEffect, useState } from 'react';

export default function useGJState() {
  // Domains and perf
  const [domains, setDomains] = useState([]);
  const [domainQ, setDomainQ] = useState('');
  // Domain list page size (UI wants only 10,20,50,100)
  const [domainLimit, setDomainLimit] = useState(() => {
    try {
      const raw = localStorage.getItem('gs_domain_limit');
      const n = Number(raw||0) || 50;
      return [10,20,50,100].includes(n) ? n : 50;
    } catch { return 50; }
  });
  const [activeDomain, setActiveDomain] = useState(() => {
    try { return localStorage.getItem('gs_active_domain') || ''; } catch { return ''; }
  });
  const [domMsg, setDomMsg] = useState('');
  const [domSrc, setDomSrc] = useState('');
  const [perfMode, setPerfMode] = useState(() => {
    try { const v = localStorage.getItem('gs_perf'); return v === null ? true : (v === '1' || v === 'true'); } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem('gs_perf', perfMode ? '1' : '0'); } catch {} }, [perfMode]);
  useEffect(() => {
    try {
      if (activeDomain) localStorage.setItem('gs_active_domain', activeDomain);
      else localStorage.removeItem('gs_active_domain');
    } catch {}
  }, [activeDomain]);

  const refreshDomains = async () => {
    const tryFetch = async (path) => {
      const r = await fetch(path, { credentials:'include' });
      const ctype = r.headers?.get?.('content-type') || '';
      if (!ctype.includes('application/json')) return { ok:false, status: r.status, nonJson: true };
      const j = await r.json();
      if (!r.ok || j?.ok===false) return { ok:false, status: r.status, message: j?.message || j?.error };
      const items = Array.isArray(j.items) ? j.items : [];
      return { ok:true, items };
    };
    try {
      setDomMsg('');
      try { localStorage.setItem('gs_domain_limit', String(domainLimit||50)); } catch {}
      const effLimit = [10,20,50,100].includes(Number(domainLimit)) ? Number(domainLimit) : 50;
      const qs = `?q=${encodeURIComponent(domainQ||'')}&limit=${effLimit}&full=0`;
      let res = await tryFetch(`/api/grabbing-sensorex/domains${qs}`);
      let src = 'primary';
      if (!res.ok) {
        // Try alias path mounted by the same module (helps when proxy rules differ)
        const res2 = await tryFetch(`/api/grabbings/sensorex/domains${qs}`);
        if (res2.ok) { res = res2; src = 'alias'; }
      }
      if (!res.ok) {
        // Try ultra-light test path (domains only) added server-side
        const res3t = await tryFetch(`/api/grabbing-sensorex/domains/list-lite_TEST`);
        if (res3t.ok) { res = { ok:true, items: res3t.items }; src = 'list-lite-test'; }
      }
      if (!res.ok) {
        // Older ultra-light fallback (if present)
        const res3 = await tryFetch(`/api/grabbing-sensorex/domains/list-lite`);
        if (res3.ok) { res = { ok:true, items: res3.items }; src = 'list-lite'; }
      }
      if (res.ok) {
        setDomains(res.items);
        setDomSrc(src);
        try { localStorage.setItem('gs_domains_cache', JSON.stringify(res.items)); } catch {}
        return;
      }
      // Failure; keep UX usable with cache/activeDomain only.
      if (activeDomain) { setDomains([{ domain: activeDomain }]); }
      else {
        try { const raw = localStorage.getItem('gs_domains_cache'); if (raw) { const items = JSON.parse(raw); if (Array.isArray(items) && items.length) setDomains(items); else setDomains([]); } else setDomains([]); } catch { setDomains([]); }
      }
      setDomSrc(activeDomain ? 'active-only' : 'cache');
      setDomMsg(res.nonJson ? `non_json_${res.status||0}` : (res.message || `Failed to load domains (${res.status||0})`));
    } catch (e) {
      setDomains([]);
      setDomMsg(String(e?.message||e)); setDomSrc(activeDomain ? 'active-only' : 'cache');
      try { const raw = localStorage.getItem('gs_domains_cache'); if (raw) { const items = JSON.parse(raw); if (Array.isArray(items) && items.length) setDomains(items); else if (activeDomain) setDomains([{ domain: activeDomain }]); } else if (activeDomain) setDomains([{ domain: activeDomain }]); } catch { if (activeDomain) setDomains([{ domain: activeDomain }]); }
    }
  };
  // Initial load on mount (immediate), then on search changes (debounced)
  useEffect(() => { refreshDomains(); /* immediate */ }, []);
  useEffect(() => { const t = setTimeout(()=>{ refreshDomains(); }, 250); return ()=>{ try{clearTimeout(t);}catch{} }; }, [domainQ, domainLimit]);
  useEffect(() => { if (!activeDomain && Array.isArray(domains) && domains.length) setActiveDomain(domains[0].domain); }, [domains]);

  // Step open/collapse
  const [stepOpen, setStepOpen] = useState(() => {
    try { const raw = localStorage.getItem('gs_step_open'); if (raw) return JSON.parse(raw); } catch {}
    return { 1: true, 2: true, 3: true, 4: true };
  });
  useEffect(() => { try { localStorage.setItem('gs_step_open', JSON.stringify(stepOpen)); } catch {} }, [stepOpen]);

  // Extraction config state (Step 2)
  const [exType, setExType] = useState(() => {
    try {
      const ad = (localStorage.getItem('gs_active_domain') || '').toLowerCase();
      const saved = ad ? localStorage.getItem(`gs_map_type:${ad}`) : null;
      return (saved && saved.trim()) ? saved : 'product';
    } catch { return 'product'; }
  });
  const [exBusy, setExBusy] = useState(false);
  const [exMsg, setExMsg] = useState('');
  const [exText, setExText] = useState('');
  const [exCopyMsg, setExCopyMsg] = useState('');
  const [exVersions, setExVersions] = useState([]);
  const [exSelVer, setExSelVer] = useState(0);
  const [exVerAuto, setExVerAuto] = useState(true);

  useEffect(() => {
    if (!activeDomain || !exType) return;
    (async () => {
      try {
        const r = await fetch(`/api/grabbing-sensorex/extraction/tools?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(exType)}&limit=50`, { credentials:'include' });
        const j = await r.json();
        if (r.ok && j?.ok) setExVersions(Array.isArray(j.items)? j.items: []);
      } catch {}
    })();
  }, [activeDomain, exType]);
  useEffect(() => {
    if (!Array.isArray(exVersions) || exVersions.length === 0) return;
    if (!exVerAuto) return;
    const maxVer = exVersions.reduce((m, v) => Math.max(m, Number(v?.version || 0)), 0);
    if (maxVer > 0 && exSelVer !== maxVer) setExSelVer(maxVer);
  }, [exVersions, exVerAuto]);

  // Clipboard helper
  async function copyToClipboard(val, setMsg) {
    try {
      await (navigator.clipboard ? navigator.clipboard.writeText(String(val||'')) : Promise.reject('no_clipboard'));
      if (setMsg) { setMsg('Copied'); setTimeout(()=>setMsg(''), 1200); }
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = String(val||'');
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (setMsg) { setMsg('Copied'); setTimeout(()=>setMsg(''), 1200); }
      } catch {}
    }
  }

  // Step 4 – Test + Discovered
  const [testUrl, setTestUrl] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testCopyMsg, setTestCopyMsg] = useState('');
  const [mapSelVer, setMapSelVer] = useState('');
  const [discQ, setDiscQ] = useState('');
  const [discIn, setDiscIn] = useState('');
  const [discNot, setDiscNot] = useState('');
  const [discType, setDiscType] = useState('');
  const [discLimit, setDiscLimit] = useState(20);
  const [discOffset, setDiscOffset] = useState(0);
  const [discNoRuns, setDiscNoRuns] = useState(false);
  const [discSortBy, setDiscSortBy] = useState('');
  const [discSortDir, setDiscSortDir] = useState('asc');
  const [discBusy, setDiscBusy] = useState(false);
  const [discItems, setDiscItems] = useState([]);
  const [discTotal, setDiscTotal] = useState(0);
  const [rowExtVer, setRowExtVer] = useState({});
  const [rowMapVer, setRowMapVer] = useState({});
  const [rowBusy, setRowBusy] = useState({});
  const [exVerDict, setExVerDict] = useState({});

  const ensureExVersionsFor = async (type) => {
    const key = String(type||'').toLowerCase();
    if (!key || !activeDomain) return [];
    if (exVerDict[key]) return exVerDict[key];
    try {
      const r = await fetch(`/api/grabbing-sensorex/extraction/tools?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(key)}&limit=50`, { credentials:'include' });
      const j = await r.json();
      const arr = (r.ok && j?.ok && Array.isArray(j.items)) ? j.items : [];
      setExVerDict(prev => ({ ...prev, [key]: arr }));
      return arr;
    } catch { return []; }
  };
  const refreshExVersionsFor = async (type) => {
    const key = String(type||'').toLowerCase();
    if (!key || !activeDomain) return [];
    try {
      const r = await fetch(`/api/grabbing-sensorex/extraction/tools?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(key)}&limit=50`, { credentials:'include' });
      const j = await r.json();
      const arr = (r.ok && j?.ok && Array.isArray(j.items)) ? j.items : [];
      setExVerDict(prev => ({ ...prev, [key]: arr }));
      if (String(exType||'').toLowerCase() === key) setExVersions(arr);
      return arr;
    } catch { return []; }
  };

  const loadDiscovered = React.useCallback(async () => {
    if (!activeDomain) { setDiscItems([]); setDiscTotal(0); return; }
    if (!loadDiscovered._abortRef) loadDiscovered._abortRef = { current: null };
    try { if (loadDiscovered._abortRef.current) loadDiscovered._abortRef.current.abort(); } catch {}
    const ac = new AbortController();
    loadDiscovered._abortRef.current = ac;
    setDiscBusy(true);
    try {
      const p = new URLSearchParams();
      p.set('domain', activeDomain);
      p.set('limit', String(discLimit));
      p.set('offset', String(discOffset));
      p.set('include_runs','1');
      if (discQ) p.set('q', discQ);
      if (discType) p.set('page_type', discType);
      if (discIn) p.set('q_in', discIn);
      if (discNot) p.set('q_not', discNot);
      if (discNoRuns) p.set('not_in_runs','1');
      if (discSortBy) p.set('sort_by', discSortBy);
      if (discSortDir) p.set('sort_dir', discSortDir);
      const r = await fetch(`/api/grabbing-sensorex/domains/urls?${p.toString()}`, { credentials:'include', signal: ac.signal });
      const j = await r.json();
      if (r.ok && j?.ok) { setDiscItems(Array.isArray(j.items)? j.items: []); setDiscTotal(Number(j.total||0)); }
      else { setDiscItems([]); setDiscTotal(0); }
    } catch (e) {
      if (String(e?.name||'') !== 'AbortError') { setDiscItems([]); setDiscTotal(0); }
    }
    finally { setDiscBusy(false); }
  }, [activeDomain, discLimit, discOffset, discQ, discIn, discNot, discType, discNoRuns, discSortBy, discSortDir]);
  useEffect(() => { loadDiscovered().catch(()=>{}); }, [loadDiscovered]);

  // Reset discovered pagination whenever domain or filters change
  useEffect(() => {
    try { setDiscOffset(0); } catch {}
  }, [activeDomain, discQ, discIn, discNot, discType, discNoRuns, discSortBy, discSortDir]);

  // Prefetch extraction version lists for types in the discovered set
  useEffect(() => {
    (async () => {
      try {
        const types = Array.from(new Set((discItems||[]).map(it => String(it.page_type||'').toLowerCase()).filter(Boolean)));
        for (const t of types) { await ensureExVersionsFor(t); }
      } catch {}
    })();
  }, [discItems]);

  // Page type (used by Runs + Mapping panels)
  const [mapType, setMapType] = useState(() => {
    try {
      const ad = (localStorage.getItem('gs_active_domain') || '').toLowerCase();
      const saved = ad ? localStorage.getItem(`gs_map_type:${ad}`) : null;
      return (saved && saved.trim()) ? saved : 'product';
    } catch { return 'product'; }
  });

  // Runs
  const [runs, setRuns] = useState([]);
  const [runsBusy, setRunsBusy] = useState(false);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLimit, setRunsLimit] = useState(20);
  const [runsOffset, setRunsOffset] = useState(0);
  const [runsPidFilter, setRunsPidFilter] = useState('');
  const [runsPidFrom, setRunsPidFrom] = useState('');
  const [runsPidTo, setRunsPidTo] = useState('');
  const [runsHasPidFilter, setRunsHasPidFilter] = useState(''); // '', 'true', 'false'
  const [runsSortBy, setRunsSortBy] = useState('created_at');
  const [runsSortDir, setRunsSortDir] = useState('desc');
  const [selectedRuns, setSelectedRuns] = useState({});
  const [runPid, setRunPid] = useState({});
  const [autoRuns, setAutoRuns] = useState(false);
  const [runsRefreshMs, setRunsRefreshMs] = useState(8000);

  const reloadRuns = React.useCallback(async () => {
    if (!activeDomain) { setRuns([]); setRunsTotal(0); setSelectedRuns({}); return; }
    if (!reloadRuns._abortRef) reloadRuns._abortRef = { current: null };
    try { if (reloadRuns._abortRef.current) reloadRuns._abortRef.current.abort(); } catch {}
    const ac = new AbortController();
    reloadRuns._abortRef.current = ac;
    setRunsBusy(true);
    try {
      const params = new URLSearchParams();
      params.set('domain', activeDomain);
      params.set('limit', String(runsLimit));
      params.set('offset', String(runsOffset));
      params.set('include', 'full');
      if (mapType) params.set('page_type', String(mapType));
      if (String(runsPidFilter||'').trim() !== '') {
        const pid = Number(runsPidFilter);
        if (pid > 0) params.set('product_id', String(pid));
      }
      // Range only when exact product_id not set
      if (!params.has('product_id')) {
        const pf = Number(String(runsPidFrom||'').trim()) || 0;
        const pt = Number(String(runsPidTo||'').trim()) || 0;
        if (pf > 0) params.set('product_id_from', String(pf));
        if (pt > 0) params.set('product_id_to', String(pt));
      }
      // Only apply has_product_id when no specific product_id filter is set
      if (!params.has('product_id')) {
        const v = String(runsHasPidFilter||'').trim().toLowerCase();
        if (['true','false'].includes(v)) params.set('has_product_id', v);
      }
      if (runsSortBy) params.set('sort_by', String(runsSortBy));
      if (runsSortDir) params.set('sort_dir', String(runsSortDir));
      const r = await fetch(`/api/grabbing-sensorex/extraction/history?${params.toString()}`, { credentials:'include', signal: ac.signal });
      const j = await r.json();
      if (r.ok && j?.ok) { setRuns(j.items||[]); setRunsTotal(Number(j.count||0)); setSelectedRuns({}); }
      else { setRuns([]); setRunsTotal(0); setSelectedRuns({}); }
    } catch (e) {
      if (String(e?.name||'') !== 'AbortError') { setRuns([]); setRunsTotal(0); setSelectedRuns({}); }
    }
    finally { setRunsBusy(false); }
  }, [activeDomain, runsLimit, runsOffset, runsPidFilter, runsPidFrom, runsPidTo, runsHasPidFilter, runsSortBy, runsSortDir, mapType]);
  useEffect(() => { reloadRuns().catch(()=>{}); }, [activeDomain, runsLimit, runsOffset, runsPidFilter, runsPidFrom, runsPidTo, runsHasPidFilter, runsSortBy, runsSortDir, mapType]);
  useEffect(() => {
    if (!autoRuns || !activeDomain) return;
    const ms = Math.max(2000, Number(runsRefreshMs||0) || 8000);
    const id = setInterval(() => { reloadRuns().catch(()=>{}); }, ms);
    return () => { try { clearInterval(id); } catch {} };
  }, [autoRuns, activeDomain, runsRefreshMs, reloadRuns]);

  // Mapping versions
  const [mapVers, setMapVers] = useState({});
  const [mapVersList, setMapVersList] = useState({});
  useEffect(() => {
    (async () => {
      try {
        if (!activeDomain) { setMapVers({}); return; }
        const types = new Set();
        for (const r of (runs||[])) { const t = String(r.page_type||'').toLowerCase(); if (t) types.add(t); }
        for (const it of (discItems||[])) { const t = String(it.page_type||'').toLowerCase(); if (t) types.add(t); }
        if (types.size === 0) return;
        const next = {};
        for (const t of Array.from(types)) {
          try {
            const resp = await fetch(`/api/grabbing-sensorex/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(t)}`, { credentials:'include' });
            const j = await resp.json();
            next[t] = j?.mapping_version || (j?.unified?.version || '');
          } catch {}
        }
        setMapVers(next);
      } catch {}
    })();
  }, [activeDomain, runs, discItems]);

  async function ensureMapVersionsFor(type) {
    const key = String(type||'').toLowerCase();
    const dkey = String(activeDomain||'').toLowerCase();
    const cacheKey = dkey ? `${dkey}|${key}` : key;
    if (!key || !activeDomain) return [];
    if (Array.isArray(mapVersList[cacheKey]) && mapVersList[cacheKey].length) return mapVersList[cacheKey];
    try {
      const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', key); p.set('limit','200'); p.set('offset','0');
      // Prefer mapping_tools as the authoritative source (avoid HTML 404s)
      let arr = [];
      try {
        const r2 = await fetch(`/api/grabbing-sensorex/mapping/tools?${p.toString()}`, { credentials:'include' });
        const ct2 = r2.headers?.get?.('content-type') || '';
        if (ct2.includes('application/json')) {
          const j2 = await r2.json();
          arr = (r2.ok && j2?.ok && Array.isArray(j2.items)) ? j2.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
        }
      } catch {}
      if (!arr.length) {
        try {
          const r2b = await fetch(`/api/grabbing-sensorex/mapping/tools/versions-lite?${p.toString()}`, { credentials:'include' });
          const ct2b = r2b.headers?.get?.('content-type') || '';
          if (ct2b.includes('application/json')) {
            const j2b = await r2b.json();
            arr = (r2b.ok && j2b?.ok && Array.isArray(j2b.items)) ? j2b.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
          }
        } catch {}
      }
      if (!arr.length) {
        try {
          const r = await fetch(`/api/grabbing-sensorex/transfert/versions?${p.toString()}`, { credentials:'include' });
          const ct = r.headers?.get?.('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await r.json();
            arr = (r.ok && j?.ok && Array.isArray(j.items)) ? j.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
          }
        } catch {}
      }
      try { arr.sort((a,b)=>b-a); } catch {}
      setMapVersList(prev => ({ ...prev, [cacheKey]: arr }));
      return arr;
    } catch { return []; }
  }

  // (moved below declarations of schemaMapVersion/mapToolVersion)
  async function refreshMapVersionsFor(type) {
    const key = String(type||'').toLowerCase();
    const dkey = String(activeDomain||'').toLowerCase();
    const cacheKey = dkey ? `${dkey}|${key}` : key;
    if (!key || !activeDomain) return [];
    try {
      const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', key); p.set('limit','200'); p.set('offset','0');
      let arr = [];
      try {
        const r2 = await fetch(`/api/grabbing-sensorex/mapping/tools?${p.toString()}`, { credentials:'include' });
        const ct2 = r2.headers?.get?.('content-type') || '';
        if (ct2.includes('application/json')) {
          const j2 = await r2.json();
          arr = (r2.ok && j2?.ok && Array.isArray(j2.items)) ? j2.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
        }
      } catch {}
      if (!arr.length) {
        try {
          const r2b = await fetch(`/api/grabbing-sensorex/mapping/tools/versions-lite?${p.toString()}`, { credentials:'include' });
          const ct2b = r2b.headers?.get?.('content-type') || '';
          if (ct2b.includes('application/json')) {
            const j2b = await r2b.json();
            arr = (r2b.ok && j2b?.ok && Array.isArray(j2b.items)) ? j2b.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
          }
        } catch {}
      }
      if (!arr.length) {
        try {
          const r = await fetch(`/api/grabbing-sensorex/transfert/versions?${p.toString()}`, { credentials:'include' });
          const ct = r.headers?.get?.('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await r.json();
            arr = (r.ok && j?.ok && Array.isArray(j.items)) ? j.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
          }
        } catch {}
      }
      try { arr.sort((a,b)=>b-a); } catch {}
      setMapVersList(prev => ({ ...prev, [cacheKey]: arr }));
      return arr;
    } catch { return []; }
  }

  // Mapping + settings (Step 3)
  const [profiles, setProfiles] = useState([]);
  const [profilesBusy, setProfilesBusy] = useState(false);
  const [mysqlProfileId, setMysqlProfileId] = useState(0);
  const [transfMsg, setTransfMsg] = useState('');
  const [defaultPrefix, setDefaultPrefix] = useState('ps_');
  // mapType state moved earlier (above Runs)
  const [mapText, setMapText] = useState('');
  const [mapMsg, setMapMsg] = useState('');
  const [mapCopyMsg, setMapCopyMsg] = useState('');
  const [schema, setSchema] = useState(null);
  const [schemaMsg, setSchemaMsg] = useState('');
  const [schemaPrefix, setSchemaPrefix] = useState('ps_');
  const [schemaTables, setSchemaTables] = useState([]);
  const [tableSrc, setTableSrc] = useState('');
  const [mapToolId, setMapToolId] = useState(null);
  const [mapToolVersion, setMapToolVersion] = useState(null);
  const [schemaVisible, setSchemaVisible] = useState({});
  const [openSchema, setOpenSchema] = useState({});
  const shopSaveTimer = React.useRef(null);
  const [shopSaveStatus, setShopSaveStatus] = useState('idle');
  const [imageSet, setImageSet] = useState({ download:true, img_root:'', bin_console:'php bin/console', php_bin:'php', generate_thumbs:true, overwrite_existing:true, console_timeout_ms:60000, cover_strategy:'first', sync_images:true });
  const [imgSaveStatus, setImgSaveStatus] = useState('idle');
  const deferredMapText = React.useDeferredValue(mapText);
  const [schemaMapVersion, setSchemaMapVersion] = useState(null);
  // Force minimal combination creation (opt-in)
  const [forceMinComb, setForceMinComb] = useState(() => {
    try { return (localStorage.getItem('gs_force_min_comb') === '1'); } catch { return false; }
  });

  useEffect(() => {
    try {
      if (!activeDomain) return;
      const k = `gs_map_type:${String(activeDomain).toLowerCase()}`;
      if (mapType) localStorage.setItem(k, String(mapType));
    } catch {}
  }, [activeDomain, mapType]);

  useEffect(() => {
    try {
      if (!activeDomain) return;
      const k = `gs_map_type:${String(activeDomain).toLowerCase()}`;
      const saved = localStorage.getItem(k);
      if (saved && typeof saved === 'string' && saved.trim()) {
        if (saved !== mapType) setMapType(saved);
        try { if (saved !== exType) setExType(saved); } catch {}
      }
    } catch {}
  }, [activeDomain]);

  useEffect(() => {
    try { if (mapType && mapType !== exType) setExType(mapType); } catch {}
  }, [mapType]);

  // Reset schema/mapping view when domain or page type changes to avoid stale tables from previous type
  useEffect(() => {
    try {
      setSchema(null);
      setSchemaTables([]);
      setSchemaMsg('');
      setOpenSchema({});
      setSchemaVisible({});
      setMapText('');
      setMapMsg('');
      setSchemaMapVersion(null);
      // Do not reset image settings or MySQL profile here; they are global per domain
    } catch {}
  }, [activeDomain, mapType]);

  // Default Map v selection for Step 4 from applied or latest version
  useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType) return;
        if (mapSelVer && String(mapSelVer).trim() !== '') return; // respect user selection
        // Prefer the explicitly applied schemaMapVersion from Step 3
        if (schemaMapVersion != null && Number(schemaMapVersion) > 0) {
          setMapSelVer(String(schemaMapVersion));
          return;
        }
        // Else prefer the latest mapping tool version for the domain/type
        if (mapToolVersion != null && Number(mapToolVersion) > 0) {
          setMapSelVer(String(mapToolVersion));
          return;
        }
        // Else fetch versions list and pick newest
        const list = await ensureMapVersionsFor(mapType);
        if (Array.isArray(list) && list.length) setMapSelVer(String(list[0]));
      } catch {}
    })();
  }, [activeDomain, mapType, schemaMapVersion, mapToolVersion]);
  useEffect(() => { try { localStorage.setItem('gs_force_min_comb', forceMinComb ? '1' : '0'); } catch {} }, [forceMinComb]);

  // Hydrate Image Import Settings from mapping_tools.image_setting (latest)
  useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType) return;
        const q = `domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(mapType)}&version=latest`;
        let item = null;
        try {
          const r = await fetch(`/api/grabbing-sensorex/mapping/tools/get?${q}`, { credentials:'include' });
          const ctype = r.headers?.get?.('content-type') || '';
          if (ctype.includes('application/json')) {
            const j = await r.json();
            if (r.ok && j?.ok && j?.item) item = j.item;
          }
        } catch {}
        if (!item) {
          try {
            const r2 = await fetch(`/api/grabbing-sensorex/mapping/tools/last?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(mapType)}`, { credentials:'include' });
            const ctype2 = r2.headers?.get?.('content-type') || '';
            if (ctype2.includes('application/json')) {
              const j2 = await r2.json();
              if (r2.ok && j2?.ok && j2?.item) item = j2.item;
            }
          } catch {}
        }
        if (item && item.image_setting && typeof item.image_setting === 'object') {
          setImageSet(prev => ({ ...prev, ...item.image_setting }));
        }
      } catch {}
    })();
  }, [activeDomain, mapType]);

  // Apply a specific saved mapping version to the editor and update table list/schema
  const applyMappingVersion = async (version) => {
    try {
      if (!activeDomain || !mapType) return;
      const ver = Number(version || 0) || 0;
      if (!ver) return;
      const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', mapType); p.set('version', String(ver));
      // Prefer unified version/get API (it prefers mapping tools table internally)
      let cfg = null;
      try {
        const r = await fetch(`/api/grabbing-sensorex/transfert/version/get?${p.toString()}`, { credentials:'include' });
        const j = await r.json();
        if (r.ok && j?.ok && j?.item) {
          cfg = (j.item.config && typeof j.item.config==='object') ? j.item.config : (j.item.tables || j.item) || null;
        }
      } catch {}
      if (!cfg) {
        // Fallback to mapping.tools direct get
        try {
          const r2 = await fetch(`/api/grabbing-sensorex/mapping/tools/get?${p.toString()}`, { credentials:'include' });
          const j2 = await r2.json();
          if (r2.ok && j2?.ok && j2?.item && j2.item.config && typeof j2.item.config==='object') cfg = j2.item.config;
        } catch {}
      }
      if (!cfg || typeof cfg !== 'object') return;
      // Normalize: if cfg looks like a raw tables map (no cfg.tables), wrap it
      let normalized = cfg;
      try {
        const hasTablesProp = !!(cfg && typeof cfg==='object' && cfg.tables && typeof cfg.tables==='object');
        if (!hasTablesProp) {
          // Heuristic: consider it a tables map if keys resemble Presta tables
          const keys = Object.keys(cfg||{});
          const looksLikeTables = keys.some(k => /(^product$|^category$|_lang$|_shop$|_group$|stock_available|attachment)/i.test(String(k)));
          if (looksLikeTables) normalized = { tables: cfg };
        }
      } catch {}
      try { setMapText(JSON.stringify(normalized, null, 2)); } catch {}
      // Derive tables and prefix from selected config
      const px = (normalized && normalized.prefix) ? String(normalized.prefix) : (defaultPrefix || schemaPrefix || 'ps_');
      const tableKeys = [];
      try { if (normalized.tables && typeof normalized.tables==='object') { for (const k of Object.keys(normalized.tables)) tableKeys.push(String(k)); } } catch {}
      if (!tableKeys.length) {
        const mt = String(mapType||'').toLowerCase();
        if (mt === 'category') tableKeys.push('category','category_lang','category_shop','category_group');
        else if (mt === 'article' || mt === 'page') tableKeys.push('category','category_lang','category_shop','category_group');
        else tableKeys.push('product','product_shop','product_lang','stock_available');
      }
      // Try to load live schema for those tables (if profile is set), else synthesize
      const sp = new URLSearchParams();
      if (activeDomain) sp.set('domain', activeDomain);
      if (mysqlProfileId) sp.set('profile_id', String(mysqlProfileId));
      if (px) sp.set('prefix', px);
      if (tableKeys.length) sp.set('tables', tableKeys.join(','));
      let updated = false;
      if (mysqlProfileId) {
        try {
          const r = await fetch(`/api/grabbing-sensorex/transfer/prestashop/schema?${sp.toString()}`, { credentials:'include' });
          const j = await r.json();
          if (r.ok && j?.ok) {
            const baseSchema = { ...(j.schema||{}) };
            for (const t of tableKeys) { if (!baseSchema[t]) baseSchema[t] = { exists:false, columns: [] }; }
            setSchema(baseSchema);
            const order = Array.isArray(j.order) ? j.order : Object.keys(baseSchema||{});
            const orderSet = new Set(order); for (const t of tableKeys) if (!orderSet.has(t)) order.push(t);
            setSchemaTables(prev => (Array.isArray(prev) && prev.length ? prev : order));
            setSchemaPrefix(j.prefix || px || 'ps_');
            setSchemaMsg('');
            setSchemaMapVersion(ver);
            updated = true;
          }
        } catch {}
      }
      if (!updated) {
        try {
          const synth = {};
          for (const tbl of tableKeys) {
            const t = String(tbl);
            const fields = (normalized && normalized.tables && normalized.tables[t] && normalized.tables[t].fields && typeof normalized.tables[t].fields==='object') ? normalized.tables[t].fields : {};
            const cols = new Set();
            for (const k of Object.keys(fields)) cols.add(String(k));
            if (/(_shop)$/i.test(t)) cols.add('id_shop');
            if (/(_lang)$/i.test(t)) cols.add('id_lang');
            const mt2 = String(mapType||'').toLowerCase();
            if (mt2 === 'product' && !/(_lang)$/i.test(t) && !/(_image|_attachment)$/i.test(t)) cols.add('id_product');
            if (t === 'category' || t === 'category_lang' || t === 'category_shop' || t === 'category_group') cols.add('id_category');
            if (t === 'category_group') cols.add('id_group');
            if (t === 'cms' || t === 'cms_lang' || t === 'cms_shop') cols.add('id_cms');
            synth[t] = { columns: Array.from(cols).map(c => ({ column_name: c, data_type: 'text' })) };
          }
          setSchema(synth);
          setSchemaTables(prev => (Array.isArray(prev) && prev.length ? prev : [...tableKeys]));
          setSchemaPrefix(px || 'ps_');
          setSchemaMsg(mysqlProfileId ? 'Schema unavailable; showing mapping-derived columns.' : 'Select a MySQL profile to load live schema; showing mapping-derived columns.');
          setSchemaMapVersion(ver);
        } catch {}
      }
    } catch {}
  };

  const loadPrestaSchema = async () => {
    try {
      setSchemaMsg('');
      // Prefer latest saved mapping for domain+type; fallback to current editor JSON
      let mapping = null;
      let mappingVersion = null;
      try {
        if (activeDomain) {
          const r0 = await fetch(`/api/grabbing-sensorex/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(mapType||'product')}`, { credentials:'include' });
          const j0 = await r0.json();
          if (r0.ok && j0?.ok) {
            mapping = (j0.unified && j0.unified.config) ? j0.unified.config : (j0.mapping || null);
            mappingVersion = (j0.unified && j0.unified.version) ? Number(j0.unified.version) : (j0.mapping_version ? Number(j0.mapping_version) : null);
          }
        }
      } catch {}
      // Merge server mapping with current editor JSON so Add Table works immediately
      let mappingEditor = null;
      try { mappingEditor = mapText ? JSON.parse(mapText) : null; } catch { mappingEditor = null; }
      // Allow pasting full wrapper { config: { ... } } by unwrapping to config
      try {
        if (mappingEditor && typeof mappingEditor==='object' && mappingEditor.config && !mappingEditor.tables && !mappingEditor.defaults) {
          const inner = mappingEditor.config;
          if (inner && typeof inner === 'object') mappingEditor = inner;
        }
      } catch {}
      if (!mapping) mapping = mappingEditor;
      const px = (mapping && mapping.prefix) ? String(mapping.prefix) : (defaultPrefix || schemaPrefix || 'ps_');
      const tableKeys = [];
      // Tables from server mapping
      try { if (mapping && mapping.tables && typeof mapping.tables === 'object') { for (const k of Object.keys(mapping.tables)) tableKeys.push(String(k)); } } catch {}
      // Only use editor tables when no server mapping is available
      try {
        if ((!mapping || !mapping.tables || Object.keys(mapping.tables||{}).length===0) && mappingEditor && mappingEditor.tables && typeof mappingEditor.tables === 'object') {
          for (const k of Object.keys(mappingEditor.tables)) if (!tableKeys.includes(String(k))) tableKeys.push(String(k));
        }
      } catch {}
      // If mapping declares no tables, fall back by page type
      if (!tableKeys.length) {
        const mt = String(mapType||'').toLowerCase();
        if (mt === 'category') tableKeys.push('category','category_lang','category_shop','category_group');
        else if (mt === 'article' || mt === 'page') tableKeys.push('category','category_lang','category_shop','category_group');
        else tableKeys.push('product','product_shop','product_lang','stock_available');
      }
      // Heuristics: include companion tables for product
      try {
        const mt = String(mapType||'').toLowerCase();
        const has = (t) => tableKeys.includes(t);
        if (mt === 'product') {
          if (has('image') && !has('image_shop')) tableKeys.push('image_shop');
        }
      } catch {}

      const sp = new URLSearchParams();
      if (activeDomain) sp.set('domain', activeDomain);
      if (mysqlProfileId) sp.set('profile_id', String(mysqlProfileId));
      if (px) sp.set('prefix', px);
      if (tableKeys.length) sp.set('tables', tableKeys.join(','));
      let ok = false;
      if (mysqlProfileId) {
        try {
          const r = await fetch(`/api/grabbing-sensorex/transfer/prestashop/schema?${sp.toString()}`, { credentials:'include' });
          const j = await r.json();
          if (r.ok && j?.ok) {
            // Ensure requested mapping tables are present even if server omits them
            const baseSchema = { ...(j.schema||{}) };
            for (const t of tableKeys) {
              if (!baseSchema[t]) baseSchema[t] = { exists: false, columns: [] };
            }
            // Heuristics: if attachment tables have no columns, synthesize a minimal set for UI
            const ensureCols = (obj, t, cols) => {
              if (!obj[t]) obj[t] = { exists: false, columns: [] };
              if (!Array.isArray(obj[t].columns) || obj[t].columns.length===0) {
                obj[t].columns = cols.map(c => ({ column_name: c, data_type: 'text' }));
              }
            };
            if (baseSchema['attachment'] && (!baseSchema['attachment'].columns || baseSchema['attachment'].columns.length===0)) ensureCols(baseSchema, 'attachment', ['id_attachment','file','file_name','file_size','mime','date_add']);
            if (baseSchema['attachment_lang'] && (!baseSchema['attachment_lang'].columns || baseSchema['attachment_lang'].columns.length===0)) ensureCols(baseSchema, 'attachment_lang', ['id_attachment','id_lang','name','description']);
            if (baseSchema['product_attachment'] && (!baseSchema['product_attachment'].columns || baseSchema['product_attachment'].columns.length===0)) ensureCols(baseSchema, 'product_attachment', ['id_product','id_attachment']);
            setSchema(baseSchema);
            const order = Array.isArray(j.order) ? j.order : Object.keys(baseSchema||{});
            // Preserve mapping table order priority
            const orderSet = new Set(order);
            for (const t of tableKeys) if (!orderSet.has(t)) order.push(t);
            setSchemaTables(prev => (Array.isArray(prev) && prev.length ? prev : order));
            setSchemaPrefix(j.prefix || px || 'ps_');
            setSchemaMsg('');
            if (Number(mappingVersion||0) > 0) setSchemaMapVersion(Number(mappingVersion));
            ok = true;
          }
        } catch {}
      }
      if (!ok) {
        // Fallback: synthesize a minimal schema from mapping when DB schema is unavailable
        try {
          const synth = {};
          for (const tbl of tableKeys) {
            const t = String(tbl);
            const fields = (mapping && mapping.tables && mapping.tables[t] && mapping.tables[t].fields && typeof mapping.tables[t].fields==='object') ? mapping.tables[t].fields : {};
            const cols = new Set();
            for (const k of Object.keys(fields)) cols.add(String(k));
            // do not include legacy defaults columns
            // Ensure id_shop/id_lang appear when relevant
            if (/(_shop)$/i.test(t)) { cols.add('id_shop'); }
            if (/(_lang)$/i.test(t)) { cols.add('id_lang'); }
            // Heuristics by page type / table name
            const mt = String(mapType||'').toLowerCase();
            if (mt === 'product' && !/(_lang)$/i.test(t) && !/(_image|_attachment)$/i.test(t)) cols.add('id_product');
            if (t === 'category' || t === 'category_lang' || t === 'category_shop' || t === 'category_group') cols.add('id_category');
            if (t === 'category_group') cols.add('id_group');
            if (t === 'cms' || t === 'cms_lang' || t === 'cms_shop') cols.add('id_cms');
            if (t === 'image' && cols.size===0) ['id_image','id_product','position','cover','url'].forEach(x=>cols.add(x));
            if (t === 'image_shop' && cols.size===0) ['id_image','id_shop','cover','position'].forEach(x=>cols.add(x));
            // Heuristics for common tables when DB schema isn't available
            if (t === 'product_attachment') { cols.add('id_product'); cols.add('id_attachment'); }
            if (t === 'attachment') { cols.add('id_attachment'); cols.add('file'); cols.add('file_name'); cols.add('file_size'); cols.add('mime'); cols.add('date_add'); }
            if (t === 'attachment_lang') { cols.add('id_attachment'); cols.add('id_lang'); cols.add('name'); cols.add('description'); }
            synth[t] = { columns: Array.from(cols).map(c => ({ column_name: c, data_type: 'text' })) };
          }
          setSchema(synth);
          setSchemaTables([...tableKeys]);
          setSchemaPrefix(px || 'ps_');
          setSchemaMsg(mysqlProfileId ? 'Schema unavailable; showing mapping-derived columns.' : 'Select a MySQL profile to load live schema; showing mapping-derived columns.');
          if (Number(mappingVersion||0) > 0) setSchemaMapVersion(Number(mappingVersion));
        } catch (e) {
          setSchema({});
          setSchemaTables([]);
          setSchemaMsg('No mapping tables found.');
        }
      }
    } catch (e) { setSchemaMsg(String(e?.message||e)); }
  };

  // Auto-hydrate mapping/schema on Step 3 open when editor/schema are empty
  useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType) return;
        if (!stepOpen || !stepOpen[3]) return;
        let hasTables = false;
        try {
          const obj = mapText ? JSON.parse(mapText) : {};
          hasTables = !!(obj && obj.tables && Object.keys(obj.tables||{}).length);
        } catch { hasTables = false; }
        const hasSchema = Array.isArray(schemaTables) && schemaTables.length > 0;
        if (!hasTables && !hasSchema) {
          await loadPrestaSchema();
        }
      } catch {}
    })();
  }, [activeDomain, mapType, stepOpen?.[3]]);

  async function detectPlannedTablesFromLastRun() {
    setMapMsg('');
    try {
      const params = new URLSearchParams();
      params.set('domain', activeDomain);
      params.set('page_type', mapType || 'product');
      params.set('limit', '1');
      params.set('include', 'full');
      const r1 = await fetch(`/api/grabbing-sensorex/extraction/history?${params.toString()}`, { credentials:'include' });
      const j1 = await r1.json();
      const runId = (r1.ok && j1?.items && j1.items[0]?.id) ? Number(j1.items[0].id||0) : 0;
      if (!runId) { setMapMsg('No runs yet. Use Step 4 to create one.'); return; }
      const body = { run_id: runId, profile_id: mysqlProfileId };
      const r2 = await fetch('/api/grabbing-sensorex/transfer/prestashop/preview-tables', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j2 = await r2.json();
      if (!r2.ok || j2?.ok===false) { setMapMsg(String(j2?.message||j2?.error||'preview_failed')); return; }
      const plan = j2.plan || {};
      const names = new Set();
      try { if (plan.product && plan.product.table) names.add(plan.product.table); } catch {}
      try { for (const it of (plan.product_shop||[])) if (it.table) names.add(it.table); } catch {}
      setSchemaTables(Array.from(names));
    } catch (e) { setMapMsg(String(e?.message||e)); }
  }

  // Mapping history
  const [mapHistItems, setMapHistItems] = useState([]);
  const [mapHistBusy, setMapHistBusy] = useState(false);
  const [mapHistMsg, setMapHistMsg] = useState('');
  const [autoSave, setAutoSave] = useState(() => { try { const v = localStorage.getItem('gs_auto_save'); return v==='1'||v==='true'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('gs_auto_save', autoSave ? '1' : '0'); } catch {} }, [autoSave]);
  const loadMappingHistory = React.useCallback(async () => {
    if (!activeDomain || !mapType) { setMapHistItems([]); return; }
    setMapHistBusy(true); setMapHistMsg('');
    try {
      const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', mapType); p.set('limit','200'); p.set('offset','0');
      // Authoritative: mapping_tools
      let done = false;
      try {
        const r2 = await fetch(`/api/grabbing-sensorex/mapping/tools?${p.toString()}`, { credentials:'include' });
        const ct2 = r2.headers?.get?.('content-type') || '';
        if (ct2.includes('application/json')) {
          const j2 = await r2.json();
          if (r2.ok && j2?.ok) { setMapHistItems(Array.isArray(j2.items)? j2.items: []); done = true; }
        }
      } catch {}
      if (!done) {
        // Fallback: versions-lite under urls.routes.js (robust JSON in this env)
        try {
          const rv = await fetch(`/api/grabbing-sensorex/mapping/tools/versions-lite?${p.toString()}`, { credentials:'include' });
          const ctv = rv.headers?.get?.('content-type') || '';
          if (ctv.includes('application/json')) {
            const jv = await rv.json();
            if (rv.ok && jv?.ok && Array.isArray(jv.items)) {
              const items = jv.items.map(it => ({
                domain: activeDomain,
                page_type: mapType,
                version: Number(it.version||0)||0,
                name: '',
                created_at: null,
              }));
              setMapHistItems(items);
              done = true;
            }
          }
        } catch {}
      }
      if (!done) {
        // Last resort: legacy transfert/versions
        const r = await fetch(`/api/grabbing-sensorex/transfert/versions?${p.toString()}`, { credentials:'include' });
        const ct = r.headers?.get?.('content-type') || '';
        if (!ct.includes('application/json')) { setMapHistItems([]); setMapHistMsg(`non_json_${r.status||0}`); }
        else {
          const j = await r.json();
          if (!r.ok || j?.ok===false) { setMapHistItems([]); setMapHistMsg(String(j?.message||j?.error||'versions_failed')); }
          else setMapHistItems(Array.isArray(j.items)? j.items: []);
        }
      }
    } catch (e) { setMapHistMsg(String(e?.message||e)); setMapHistItems([]); }
    finally { setMapHistBusy(false); }
  }, [activeDomain, mapType]);
  useEffect(() => { loadMappingHistory().catch(()=>{}); }, [loadMappingHistory]);

  // Load available MySQL profiles (try db-mysql module first, then local fallback route)
  useEffect(() => {
    let stopped = false;
    (async () => {
      setProfilesBusy(true);
      try {
        // Prefer db-mysql module route (admin-gated)
        let ok = false;
        try {
          const r = await fetch('/api/db-mysql/profiles?limit=200', { credentials: 'include' });
          const j = await r.json();
          if (r.ok && j?.ok) { if (!stopped) setProfiles(Array.isArray(j.items) ? j.items : []); ok = true; }
        } catch {}
        if (!ok) {
          try {
            const r2 = await fetch('/api/grabbing-sensorex/mysql/profiles?limit=200', { credentials: 'include' });
            const j2 = await r2.json();
            if (r2.ok && j2?.ok) { if (!stopped) setProfiles(Array.isArray(j2.items) ? j2.items : []); ok = true; }
          } catch {}
        }
        if (!ok && !stopped) setProfiles([]);
      } finally {
        if (!stopped) setProfilesBusy(false);
      }
    })();
    return () => { stopped = true; };
  }, []);

  // If no profile selected, prefer default profile if present
  useEffect(() => {
    try {
      if ((mysqlProfileId || 0) > 0) return;
      const arr = Array.isArray(profiles) ? profiles : [];
      if (!arr.length) return;
      const def = arr.find(p => p && (p.is_default === true || p.is_default === 1));
      if (def && def.id) setMysqlProfileId(Number(def.id));
      else if (arr[0] && arr[0].id) setMysqlProfileId(Number(arr[0].id));
    } catch {}
  }, [profiles]);

  // Load saved global settings for current domain to pre-select profile/prefix
  useEffect(() => {
    (async () => {
      if (!activeDomain) return;
      // Prefer consolidated settings endpoint (mapping_tools latest)
      let pid = null; let px = null;
      try {
        const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', 'product');
        const r0 = await fetch(`/api/grabbing-sensorex/settings/global?${p.toString()}`, { credentials:'include' });
        const j0 = await r0.json();
        if (r0.ok && j0?.ok && j0.item) {
          if (j0.item.profile_id != null) pid = Number(j0.item.profile_id);
          if (j0.item.prefix) px = String(j0.item.prefix);
        }
      } catch {}
      try { if (pid != null && !Number.isNaN(pid)) setMysqlProfileId(pid); } catch {}
      try { if (px) setDefaultPrefix(px); } catch {}
    })();
  }, [activeDomain]);

  // Resolve latest mapping tool id/version for current domain/type (used for table_settings association)
  useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType) { setMapToolId(null); setMapToolVersion(null); return; }
        const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', mapType); p.set('version', 'latest');
        const r = await fetch(`/api/grabbing-sensorex/mapping/tools/get?${p.toString()}`, { credentials:'include' });
        const ctype = r.headers?.get?.('content-type') || '';
        if (!ctype.includes('application/json')) { setMapToolId(null); setMapToolVersion(null); return; }
        const j = await r.json();
        if (r.ok && j?.ok && j?.item) {
          setMapToolId(j.item.id != null ? Number(j.item.id) : null);
          setMapToolVersion(j.item.version != null ? Number(j.item.version) : null);
        } else { setMapToolId(null); setMapToolVersion(null); }
      } catch { setMapToolId(null); setMapToolVersion(null); }
    })();
  }, [activeDomain, mapType]);

  // Load Smart Settings (table-settings) for current domain + page type (and active mapping tool) and hydrate UI state
  useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType) return;
        const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', mapType);
        // Prefer the applied schemaMapVersion; else latest mapping tool id/version if available
        if (schemaMapVersion != null && Number(schemaMapVersion)>0) p.set('mapping_version', String(schemaMapVersion));
        else if (mapToolId != null) p.set('mapping_tool_id', String(mapToolId));
        else if (mapToolVersion != null) p.set('mapping_version', String(mapToolVersion));
        const r = await fetch(`/api/grabbing-sensorex/table-settings?${p.toString()}`, { credentials:'include' });
        const j = await r.json();
        if (!r.ok || j?.ok===false) return;
        const items = Array.isArray(j.items) ? j.items : [];
        try {
          const src = String(j?.src||'').toLowerCase();
          setTableSrc(src);
          const names = items.map(x=>x.table_name).filter(Boolean);
          if (src === 'table_settings' && names.length) {
            setSchemaTables(names);
          } else if (!Array.isArray(schemaTables) || schemaTables.length === 0) {
            // Only seed from fallback when we have no list yet
            if (names.length) setSchemaTables(names);
          }
        } catch {}

        // Merge columns from table_settings.columns into the working schema
        // Always merge: if live schema is present, we only fill missing/empty columns
        try {
          if (Array.isArray(items) && items.length) {
            const next = { ...(schema || {}) };
            for (const row of items) {
              const tname = String(row?.table_name||'').trim();
              const cols = Array.isArray(row?.columns) ? row.columns : [];
              if (!tname || !cols.length) continue;
              const existing = (next[tname] && Array.isArray(next[tname].columns)) ? next[tname].columns : [];
              if (!existing.length) {
                next[tname] = { columns: cols.map(c=>({ column_name: String(c), data_type: 'text' })) };
              } else {
                // merge any missing column names from table_settings into existing list
                const have = new Set(existing.map(c => String(c.column_name||'')));
                for (const c of cols) {
                  const name = String(c||'');
                  if (name && !have.has(name)) existing.push({ column_name: name, data_type: 'text' });
                }
                next[tname] = { columns: existing };
              }
            }
            setSchema(next);
          }
        } catch {}
        // Merge persisted per-table mapping back into mapText so editors reflect saved state after reload (fields only; ignore defaults)
        try {
          let obj = {};
          try { obj = mapText ? JSON.parse(mapText) : {}; } catch { obj = {}; }
          obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
          for (const row of items) {
            const tname = String(row.table_name||'').trim(); if (!tname) continue;
            obj.tables[tname] = obj.tables[tname] && typeof obj.tables[tname]==='object' ? obj.tables[tname] : {};
            if (row.mapping && typeof row.mapping==='object') {
              const mf = row.mapping.fields && typeof row.mapping.fields==='object' ? row.mapping.fields : {};
              const baseFields = { ...(obj.tables[tname].fields||{}) };
              for (const [k,v] of Object.entries(mf)) baseFields[k] = v;
              obj.tables[tname].fields = baseFields;
            }
            // settings: copy as-is (id_shops, id_langs, options, etc.)
            if (row.settings && typeof row.settings==='object') {
              const prev = (obj.tables[tname].settings && typeof obj.tables[tname].settings==='object') ? obj.tables[tname].settings : {};
              obj.tables[tname].settings = { ...prev, ...row.settings };
            }
          }
          const next = JSON.stringify(obj, null, 2);
          if (next !== mapText) setMapText(next);
        } catch {}
        // Do not hydrate Image Import Settings from table_settings; mapping_tools is authoritative
        // Do not hydrate id_shops from table-settings here; mapping_tools is authoritative and handled in PrestaMappingPanel

        // Fallbacks for mapping fields: if table_settings rows exist but some tables have no mapping,
        // hydrate missing tables from latest mapping.tools config (per-table, non-destructive).
        // Also keep legacy all-or-nothing fallback if no fields exist at all.
        try {
          const objNow = (() => { try { return mapText ? JSON.parse(mapText) : {}; } catch { return {}; } })();
          const tablesNow = objNow && objNow.tables && typeof objNow.tables==='object' ? objNow.tables : {};
          const missingTables = (()=>{
            try {
              const names = Array.isArray(schemaTables) && schemaTables.length ? schemaTables : (items.map(x=>x.table_name).filter(Boolean));
              const out = [];
              for (const name of names) {
                const fields = (tablesNow?.[name]?.fields) || {};
                if (!fields || Object.keys(fields).length === 0) out.push(name);
              }
              return out;
            } catch { return []; }
          })();

          const needGlobalFallback = (() => {
            try { return Object.values(tablesNow).every(v => !v || !v.fields || Object.keys(v.fields||{}).length===0); }
            catch { return false; }
          })();

          if (missingTables.length || needGlobalFallback) {
            const tr = await fetch(`/api/grabbing-sensorex/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(mapType)}`, { credentials:'include' });
            const tj = await tr.json();
            const mappingFromTools = (tr.ok && tj?.ok) ? ((tj.unified && tj.unified.config) || tj.mapping || null) : null;
            if (mappingFromTools && typeof mappingFromTools==='object') {
              const obj = objNow;
              obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
              const mt = mappingFromTools.tables && typeof mappingFromTools.tables==='object' ? mappingFromTools.tables : {};

              if (needGlobalFallback) {
                for (const [tbl, conf] of Object.entries(mt)) {
                  if (!conf || typeof conf!=='object') continue;
                  obj.tables[tbl] = obj.tables[tbl] && typeof obj.tables[tbl]==='object' ? obj.tables[tbl] : {};
                  if (conf.fields && typeof conf.fields==='object') obj.tables[tbl].fields = { ...(obj.tables[tbl].fields||{}), ...conf.fields };
                }
              } else if (missingTables.length) {
                for (const tbl of missingTables) {
                  const conf = mt[tbl];
                  if (!conf || typeof conf!=='object') continue;
                  obj.tables[tbl] = obj.tables[tbl] && typeof obj.tables[tbl]==='object' ? obj.tables[tbl] : {};
                  if (!obj.tables[tbl].fields || Object.keys(obj.tables[tbl].fields||{}).length===0) {
                    if (conf.fields && typeof conf.fields==='object') obj.tables[tbl].fields = { ...conf.fields };
                  }
                }
              }
              // Carry over image.setting_image and product_shop.settings if present
              try {
                if (mt.image && mt.image.setting_image && typeof mt.image.setting_image==='object') {
                  setImageSet(prev => ({ ...prev, ...mt.image.setting_image }));
                }
              } catch {}
              try {
                if (mt.product_shop && mt.product_shop.settings && typeof mt.product_shop.settings==='object' && Array.isArray(mt.product_shop.settings.id_shops)) {
                  const shops = mt.product_shop.settings.id_shops.map(n=>Number(n)||0).filter(n=>n>0);
                  obj.tables.product_shop = obj.tables.product_shop && typeof obj.tables.product_shop==='object' ? obj.tables.product_shop : {};
                  obj.tables.product_shop.settings = obj.tables.product_shop.settings && typeof obj.tables.product_shop.settings==='object' ? obj.tables.product_shop.settings : {};
                  if (!Array.isArray(obj.tables.product_shop.settings.id_shops) || !obj.tables.product_shop.settings.id_shops.length)
                    obj.tables.product_shop.settings.id_shops = shops;
                }
              } catch {}
              const merged = JSON.stringify(obj, null, 2);
              if (merged !== mapText) setMapText(merged);
            }
          }
        } catch {}
      } catch {}
    })();
  }, [activeDomain, mapType, schemaMapVersion, mapToolId, mapToolVersion, mysqlProfileId]);

  return {
    // Domain/select
    domains, domainQ, setDomainQ, domainLimit, setDomainLimit, activeDomain, setActiveDomain, refreshDomains, perfMode, setPerfMode, domMsg, domSrc,
    // Steps
    stepOpen, setStepOpen,
    // Extraction config
    exType, setExType, exBusy, setExBusy, exMsg, setExMsg, exText, setExText, exVersions, setExVersions, exSelVer, setExSelVer, exCopyMsg, setExCopyMsg, exVerAuto, setExVerAuto,
    copyToClipboard,
    // Test + Discovered
    testUrl, setTestUrl, testBusy, setTestBusy, testMsg, setTestMsg, testResult, setTestResult, testCopyMsg, setTestCopyMsg,
    mapSelVer, setMapSelVer,
    discQ, setDiscQ, discType, setDiscType, discLimit, setDiscLimit, discOffset, setDiscOffset, discNoRuns, setDiscNoRuns, discBusy, discItems, discTotal,
    discSortBy, setDiscSortBy, discSortDir, setDiscSortDir,
    rowExtVer, setRowExtVer, rowMapVer, setRowMapVer, rowBusy, setRowBusy, exVerDict,
    ensureExVersionsFor, refreshExVersionsFor, loadDiscovered,
    // Runs
    runs, setRuns, runsBusy, runsTotal, runsLimit, setRunsLimit, runsOffset, setRunsOffset, runsPidFilter, setRunsPidFilter, runsPidFrom, setRunsPidFrom, runsPidTo, setRunsPidTo, runsHasPidFilter, setRunsHasPidFilter, runsSortBy, setRunsSortBy, runsSortDir, setRunsSortDir, reloadRuns, selectedRuns, setSelectedRuns, runPid, setRunPid, autoRuns, setAutoRuns, runsRefreshMs, setRunsRefreshMs,
    // Mapping
    profiles, setProfiles, profilesBusy, setProfilesBusy, mysqlProfileId, setMysqlProfileId, transfMsg, setTransfMsg, defaultPrefix, setDefaultPrefix,
    mapType, setMapType, mapVers, mapVersList, ensureMapVersionsFor, refreshMapVersionsFor,
    mapText, setMapText, mapMsg, setMapMsg, mapCopyMsg, setMapCopyMsg, schema, setSchema, schemaMsg, setSchemaMsg, schemaPrefix, setSchemaPrefix, schemaTables, setSchemaTables, tableSrc, schemaVisible, setSchemaVisible, openSchema, setOpenSchema, shopSaveTimer, shopSaveStatus, setShopSaveStatus, imageSet, setImageSet, imgSaveStatus, setImgSaveStatus, detectPlannedTablesFromLastRun, loadPrestaSchema, deferredMapText, schemaMapVersion, mapToolId, mapToolVersion,
    loadMappingHistory, mapHistItems, mapHistBusy, mapHistMsg, autoSave, setAutoSave,
    applyMappingVersion,
    forceMinComb, setForceMinComb,
    // Discovered include/exclude helpers
    discIn, setDiscIn, discNot, setDiscNot,
  };
}


