import React, { useEffect, useState } from 'react';

export default function useGJState() {
  // Domains and perf
  const [domains, setDomains] = useState([]);
  const [domainQ, setDomainQ] = useState('');
  const [activeDomain, setActiveDomain] = useState(() => {
    try { return localStorage.getItem('gj_active_domain') || ''; } catch { return ''; }
  });
  const [domMsg, setDomMsg] = useState('');
  const [perfMode, setPerfMode] = useState(() => {
    try { const v = localStorage.getItem('gj_perf'); return v === null ? true : (v === '1' || v === 'true'); } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem('gj_perf', perfMode ? '1' : '0'); } catch {} }, [perfMode]);
  useEffect(() => {
    try {
      if (activeDomain) localStorage.setItem('gj_active_domain', activeDomain);
      else localStorage.removeItem('gj_active_domain');
    } catch {}
  }, [activeDomain]);

  const refreshDomains = async () => {
    try {
      setDomMsg('');
      const url = `/api/grabbing-jerome/domains?q=${encodeURIComponent(domainQ||'')}&limit=200`;
      const r = await fetch(url, { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) { setDomains(Array.isArray(j.items)? j.items: []); return; }
      setDomains([]);
      setDomMsg(String(j?.message || j?.error || `Failed to load domains (${r.status})`));
    } catch (e) { setDomains([]); setDomMsg(String(e?.message||e)); }
  };
  useEffect(() => { const t = setTimeout(()=>{ refreshDomains(); }, 250); return ()=>{ try{clearTimeout(t);}catch{} }; }, [domainQ]);
  useEffect(() => { if (!activeDomain && Array.isArray(domains) && domains.length) setActiveDomain(domains[0].domain); }, [domains]);

  // Step open/collapse
  const [stepOpen, setStepOpen] = useState(() => {
    try { const raw = localStorage.getItem('gj_step_open'); if (raw) return JSON.parse(raw); } catch {}
    return { 1: true, 2: true, 3: true, 4: true };
  });
  useEffect(() => { try { localStorage.setItem('gj_step_open', JSON.stringify(stepOpen)); } catch {} }, [stepOpen]);

  // Extraction config state (Step 2)
  const [exType, setExType] = useState('product');
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
        const r = await fetch(`/api/grabbing-jerome/extraction/tools?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(exType)}&limit=50`, { credentials:'include' });
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
      const r = await fetch(`/api/grabbing-jerome/extraction/tools?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(key)}&limit=50`, { credentials:'include' });
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
      const r = await fetch(`/api/grabbing-jerome/extraction/tools?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(key)}&limit=50`, { credentials:'include' });
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
      if (discNoRuns) p.set('not_in_runs','1');
      if (discSortBy) p.set('sort_by', discSortBy);
      if (discSortDir) p.set('sort_dir', discSortDir);
      const r = await fetch(`/api/grabbing-jerome/domains/urls?${p.toString()}`, { credentials:'include', signal: ac.signal });
      const j = await r.json();
      if (r.ok && j?.ok) { setDiscItems(Array.isArray(j.items)? j.items: []); setDiscTotal(Number(j.total||0)); }
      else { setDiscItems([]); setDiscTotal(0); }
    } catch (e) {
      if (String(e?.name||'') !== 'AbortError') { setDiscItems([]); setDiscTotal(0); }
    }
    finally { setDiscBusy(false); }
  }, [activeDomain, discLimit, discOffset, discQ, discType, discNoRuns, discSortBy, discSortDir]);
  useEffect(() => { loadDiscovered().catch(()=>{}); }, [loadDiscovered]);

  // Reset discovered pagination whenever domain or filters change
  useEffect(() => {
    try { setDiscOffset(0); } catch {}
  }, [activeDomain, discQ, discType, discNoRuns, discSortBy, discSortDir]);

  // Prefetch extraction version lists for types in the discovered set
  useEffect(() => {
    (async () => {
      try {
        const types = Array.from(new Set((discItems||[]).map(it => String(it.page_type||'').toLowerCase()).filter(Boolean)));
        for (const t of types) { await ensureExVersionsFor(t); }
      } catch {}
    })();
  }, [discItems]);

  // Runs
  const [runs, setRuns] = useState([]);
  const [runsBusy, setRunsBusy] = useState(false);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLimit, setRunsLimit] = useState(20);
  const [runsOffset, setRunsOffset] = useState(0);
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
      const r = await fetch(`/api/grabbing-jerome/extraction/history?${params.toString()}`, { credentials:'include', signal: ac.signal });
      const j = await r.json();
      if (r.ok && j?.ok) { setRuns(j.items||[]); setRunsTotal(Number(j.count||0)); setSelectedRuns({}); }
      else { setRuns([]); setRunsTotal(0); setSelectedRuns({}); }
    } catch (e) {
      if (String(e?.name||'') !== 'AbortError') { setRuns([]); setRunsTotal(0); setSelectedRuns({}); }
    }
    finally { setRunsBusy(false); }
  }, [activeDomain, runsLimit, runsOffset]);
  useEffect(() => { reloadRuns().catch(()=>{}); }, [activeDomain, runsLimit, runsOffset]);
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
            const resp = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(t)}`, { credentials:'include' });
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
      const r = await fetch(`/api/grabbing-jerome/transfert/versions?${p.toString()}`, { credentials:'include' });
      const j = await r.json();
      let arr = (r.ok && j?.ok && Array.isArray(j.items)) ? j.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
      if (!arr.length) {
        try {
          const r2 = await fetch(`/api/grabbing-jerome/mapping/tools?${p.toString()}`, { credentials:'include' });
          const j2 = await r2.json();
          arr = (r2.ok && j2?.ok && Array.isArray(j2.items)) ? j2.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
        } catch {}
      }
      try { arr.sort((a,b)=>b-a); } catch {}
      setMapVersList(prev => ({ ...prev, [cacheKey]: arr }));
      return arr;
    } catch { return []; }
  }
  async function refreshMapVersionsFor(type) {
    const key = String(type||'').toLowerCase();
    const dkey = String(activeDomain||'').toLowerCase();
    const cacheKey = dkey ? `${dkey}|${key}` : key;
    if (!key || !activeDomain) return [];
    try {
      const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', key); p.set('limit','200'); p.set('offset','0');
      const r = await fetch(`/api/grabbing-jerome/transfert/versions?${p.toString()}`, { credentials:'include' });
      const j = await r.json();
      let arr = (r.ok && j?.ok && Array.isArray(j.items)) ? j.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
      if (!arr.length) {
        try {
          const r2 = await fetch(`/api/grabbing-jerome/mapping/tools?${p.toString()}`, { credentials:'include' });
          const j2 = await r2.json();
          arr = (r2.ok && j2?.ok && Array.isArray(j2.items)) ? j2.items.map(x=>Number(x.version||0)).filter(n=>n>0) : [];
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
  const [mapType, setMapType] = useState('product');
  const [mapText, setMapText] = useState('');
  const [mapMsg, setMapMsg] = useState('');
  const [mapCopyMsg, setMapCopyMsg] = useState('');
  const [schema, setSchema] = useState(null);
  const [schemaMsg, setSchemaMsg] = useState('');
  const [schemaPrefix, setSchemaPrefix] = useState('ps_');
  const [schemaTables, setSchemaTables] = useState([]);
  const [schemaVisible, setSchemaVisible] = useState({});
  const [openSchema, setOpenSchema] = useState({});
  const shopSaveTimer = React.useRef(null);
  const [shopSaveStatus, setShopSaveStatus] = useState('idle');
  const [imageSet, setImageSet] = useState({ download:true, img_root:'', bin_console:'php bin/console', php_bin:'php', generate_thumbs:true, overwrite_existing:true, console_timeout_ms:60000, cover_strategy:'first', sync_images:true });
  const [imgSaveStatus, setImgSaveStatus] = useState('idle');
  const deferredMapText = React.useDeferredValue(mapText);
  const [schemaMapVersion, setSchemaMapVersion] = useState(null);

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
        const r = await fetch(`/api/grabbing-jerome/transfert/version/get?${p.toString()}`, { credentials:'include' });
        const j = await r.json();
        if (r.ok && j?.ok && j?.item) {
          cfg = (j.item.config && typeof j.item.config==='object') ? j.item.config : (j.item.tables || j.item) || null;
        }
      } catch {}
      if (!cfg) {
        // Fallback to mapping.tools direct get
        try {
          const r2 = await fetch(`/api/grabbing-jerome/mapping/tools/get?${p.toString()}`, { credentials:'include' });
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
          const r = await fetch(`/api/grabbing-jerome/transfer/prestashop/schema?${sp.toString()}`, { credentials:'include' });
          const j = await r.json();
          if (r.ok && j?.ok) {
            const baseSchema = { ...(j.schema||{}) };
            for (const t of tableKeys) { if (!baseSchema[t]) baseSchema[t] = { exists:false, columns: [] }; }
            setSchema(baseSchema);
            const order = Array.isArray(j.order) ? j.order : Object.keys(baseSchema||{});
            const orderSet = new Set(order); for (const t of tableKeys) if (!orderSet.has(t)) order.push(t);
            setSchemaTables(order);
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
            const defs = (normalized && normalized.defaults && normalized.defaults[t] && typeof normalized.defaults[t]==='object') ? normalized.defaults[t] : {};
            const cols = new Set();
            for (const k of Object.keys(fields)) cols.add(String(k));
            for (const k of Object.keys(defs)) cols.add(String(k));
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
          setSchemaTables([...tableKeys]);
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
          const r0 = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(mapType||'product')}`, { credentials:'include' });
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
          const r = await fetch(`/api/grabbing-jerome/transfer/prestashop/schema?${sp.toString()}`, { credentials:'include' });
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
            setSchemaTables(order);
            setSchemaPrefix(j.prefix || px || 'ps_');
            setSchemaMsg('');
            setSchemaMapVersion(mappingVersion);
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
            const defs = (mapping && mapping.defaults && mapping.defaults[t] && typeof mapping.defaults[t]==='object') ? mapping.defaults[t] : {};
            const cols = new Set();
            for (const k of Object.keys(fields)) cols.add(String(k));
            for (const k of Object.keys(defs)) cols.add(String(k));
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
          setSchemaMapVersion(mappingVersion);
        } catch (e) {
          setSchema({});
          setSchemaTables([]);
          setSchemaMsg('No mapping tables found.');
        }
      }
    } catch (e) { setSchemaMsg(String(e?.message||e)); }
  };

  async function detectPlannedTablesFromLastRun() {
    setMapMsg('');
    try {
      const params = new URLSearchParams();
      params.set('domain', activeDomain);
      params.set('page_type', mapType || 'product');
      params.set('limit', '1');
      params.set('include', 'full');
      const r1 = await fetch(`/api/grabbing-jerome/extraction/history?${params.toString()}`, { credentials:'include' });
      const j1 = await r1.json();
      const runId = (r1.ok && j1?.items && j1.items[0]?.id) ? Number(j1.items[0].id||0) : 0;
      if (!runId) { setMapMsg('No runs yet. Use Step 4 to create one.'); return; }
      const body = { run_id: runId, profile_id: mysqlProfileId };
      const r2 = await fetch('/api/grabbing-jerome/transfer/prestashop/preview-tables', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
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
  const [autoSave, setAutoSave] = useState(() => { try { const v = localStorage.getItem('gj_auto_save'); return v==='1'||v==='true'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('gj_auto_save', autoSave ? '1' : '0'); } catch {} }, [autoSave]);
  const loadMappingHistory = React.useCallback(async () => {
    if (!activeDomain || !mapType) { setMapHistItems([]); return; }
    setMapHistBusy(true); setMapHistMsg('');
    try {
      const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', mapType); p.set('limit','200'); p.set('offset','0');
      const r = await fetch(`/api/grabbing-jerome/transfert/versions?${p.toString()}`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setMapHistItems([]); setMapHistMsg(String(j?.message||j?.error||'versions_failed')); }
      else setMapHistItems(Array.isArray(j.items)? j.items: []);
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
            const r2 = await fetch('/api/grabbing-jerome/mysql/profiles?limit=200', { credentials: 'include' });
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

  // Load saved transfer config for current domain to pre-select profile/prefix
  useEffect(() => {
    (async () => {
      if (!activeDomain) return;
      try {
        const r = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert`, { credentials:'include' });
        const j = await r.json();
        if (r.ok && j?.ok) {
          const ct = j.config_transfert || {};
          const pid = (ct.db_mysql_profile_id != null) ? Number(ct.db_mysql_profile_id) : null;
          const px = (ct.db_mysql_prefix != null) ? String(ct.db_mysql_prefix) : null;
          if (pid != null && !Number.isNaN(pid)) setMysqlProfileId(pid);
          if (px != null && px !== '') setDefaultPrefix(px);
        }
      } catch {}
    })();
  }, [activeDomain]);

  // Load Smart Settings for current domain + page type and hydrate UI state
  useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType) return;
        const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('page_type', mapType);
        const r = await fetch(`/api/grabbing-jerome/table-settings?${p.toString()}`, { credentials:'include' });
        const j = await r.json();
        if (!r.ok || j?.ok===false) return;
        const items = Array.isArray(j.items) ? j.items : [];
        // Merge persisted per-table mapping (fields/defaults) back into mapText so editors reflect saved state after reload
        try {
          let obj = {};
          try { obj = mapText ? JSON.parse(mapText) : {}; } catch { obj = {}; }
          obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
          obj.defaults = obj.defaults && typeof obj.defaults==='object' ? obj.defaults : {};
          for (const row of items) {
            const tname = String(row.table_name||'').trim(); if (!tname) continue;
            obj.tables[tname] = obj.tables[tname] && typeof obj.tables[tname]==='object' ? obj.tables[tname] : {};
            // mapping: fields/defaults
            if (row.mapping && typeof row.mapping==='object') {
              const mf = row.mapping.fields && typeof row.mapping.fields==='object' ? row.mapping.fields : {};
              const md = row.mapping.defaults && typeof row.mapping.defaults==='object' ? row.mapping.defaults : {};
              obj.tables[tname].fields = { ...(obj.tables[tname].fields||{}), ...mf };
              obj.defaults[tname] = { ...(obj.defaults[tname]||{}), ...md };
            }
          }
          const next = JSON.stringify(obj, null, 2);
          if (next !== mapText) setMapText(next);
        } catch {}
        // Hydrate Image Import Settings
        try {
          const row = items.find(it => String(it.table_name||'').toLowerCase()==='image');
          const s = row && row.setting_image && typeof row.setting_image==='object' ? row.setting_image : null;
          if (s) {
            setImageSet(prev => ({
              download: s.download !== undefined ? !!s.download : (prev.download ?? true),
              img_root: s.img_root != null ? String(s.img_root) : (prev.img_root || ''),
              bin_console: s.bin_console != null ? String(s.bin_console) : (prev.bin_console || 'php bin/console'),
              php_bin: s.php_bin != null ? String(s.php_bin) : (prev.php_bin || 'php'),
              generate_thumbs: s.generate_thumbs !== undefined ? !!s.generate_thumbs : (prev.generate_thumbs ?? true),
              overwrite_existing: s.overwrite_existing !== undefined ? !!s.overwrite_existing : (prev.overwrite_existing ?? true),
              console_timeout_ms: s.console_timeout_ms != null ? Number(s.console_timeout_ms) : (prev.console_timeout_ms ?? 60000),
              cover_strategy: s.cover_strategy != null ? String(s.cover_strategy) : (prev.cover_strategy || 'first'),
              sync_images: s.sync_images !== undefined ? !!s.sync_images : (prev.sync_images ?? true),
            }));
          }
        } catch {}
        // Hydrate Shop destinations (id_shops) into mapText so CSV reflects persisted values
        try {
          const row = items.find(it => String(it.table_name||'').toLowerCase()==='product_shop');
          const s = row && row.settings && typeof row.settings==='object' ? row.settings : null;
          if (s && Array.isArray(s.id_shops)) {
            const shops = s.id_shops.map(n=>Number(n)||0).filter(n=>n>0);
            try {
              const obj = mapText ? JSON.parse(mapText) : {};
              obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
              obj.tables.product_shop = obj.tables.product_shop && typeof obj.tables.product_shop==='object' ? obj.tables.product_shop : {};
              obj.tables.product_shop.settings = obj.tables.product_shop.settings && typeof obj.tables.product_shop.settings==='object' ? obj.tables.product_shop.settings : {};
              obj.tables.product_shop.settings.id_shops = shops;
              const updated = JSON.stringify(obj, null, 2);
              if (updated !== mapText) setMapText(updated);
            } catch {}
          }
        } catch {}

        // Fallback: if no mapping fields/defaults were present in table-settings (new project or only mapping.tools used),
        // read latest mapping from transfert endpoint and hydrate mapText so editors show saved defaults/paths.
        try {
          const hasAnyFields = (() => {
            try {
              const obj = mapText ? JSON.parse(mapText) : {};
              const t = obj && obj.tables && typeof obj.tables==='object' ? obj.tables : {};
              return Object.values(t).some(v => v && typeof v==='object' && v.fields && Object.keys(v.fields||{}).length>0);
            } catch { return false; }
          })();
          if (!hasAnyFields) {
            const tr = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(mapType)}`, { credentials:'include' });
            const tj = await tr.json();
            const mappingFromTools = (tr.ok && tj?.ok) ? ((tj.unified && tj.unified.config) || tj.mapping || null) : null;
            if (mappingFromTools && typeof mappingFromTools==='object') {
              const obj = mapText ? JSON.parse(mapText) : {};
              obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
              obj.defaults = obj.defaults && typeof obj.defaults==='object' ? obj.defaults : {};
              const mt = mappingFromTools.tables && typeof mappingFromTools.tables==='object' ? mappingFromTools.tables : {};
              const md = mappingFromTools.defaults && typeof mappingFromTools.defaults==='object' ? mappingFromTools.defaults : {};
              for (const [tbl, conf] of Object.entries(mt)) {
                if (!conf || typeof conf!=='object') continue;
                obj.tables[tbl] = obj.tables[tbl] && typeof obj.tables[tbl]==='object' ? obj.tables[tbl] : {};
                if (conf.fields && typeof conf.fields==='object') obj.tables[tbl].fields = { ...(obj.tables[tbl].fields||{}), ...conf.fields };
                if (md && md[tbl] && typeof md[tbl]==='object') obj.defaults[tbl] = { ...(obj.defaults[tbl]||{}), ...md[tbl] };
              }
              // carry over image.setting_image and product_shop.settings if present
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
  }, [activeDomain, mapType]);

  return {
    // Domain/select
    domains, domainQ, setDomainQ, activeDomain, setActiveDomain, refreshDomains, perfMode, setPerfMode, domMsg,
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
    runs, setRuns, runsBusy, runsTotal, runsLimit, setRunsLimit, runsOffset, setRunsOffset, reloadRuns, selectedRuns, setSelectedRuns, runPid, setRunPid, autoRuns, setAutoRuns, runsRefreshMs, setRunsRefreshMs,
    // Mapping
    profiles, setProfiles, profilesBusy, setProfilesBusy, mysqlProfileId, setMysqlProfileId, transfMsg, setTransfMsg, defaultPrefix, setDefaultPrefix,
    mapType, setMapType, mapVers, mapVersList, ensureMapVersionsFor, refreshMapVersionsFor,
    mapText, setMapText, mapMsg, setMapMsg, mapCopyMsg, setMapCopyMsg, schema, setSchema, schemaMsg, setSchemaMsg, schemaPrefix, setSchemaPrefix, schemaTables, setSchemaTables, schemaVisible, setSchemaVisible, openSchema, setOpenSchema, shopSaveTimer, shopSaveStatus, setShopSaveStatus, imageSet, setImageSet, imgSaveStatus, setImgSaveStatus, detectPlannedTablesFromLastRun, loadPrestaSchema, deferredMapText, schemaMapVersion,
    loadMappingHistory, mapHistItems, mapHistBusy, mapHistMsg, autoSave, setAutoSave,
    applyMappingVersion,
  };
}
