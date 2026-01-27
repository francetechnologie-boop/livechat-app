import React from 'react';

function SchemaTableEditor({ tableKey, schema, prefix='ps_', mapText, setMapText, setMapMsg = ()=>{}, domain, pageType, mysqlProfileId=0, autoSave=false, ensureMapVersionsFor, refreshMapVersionsFor }) {
  const cols = Array.isArray(schema?.columns) ? schema.columns : [];
  const [rows, setRows] = React.useState([]);
  const rowByName = React.useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(r.name, r);
    return m;
  }, [rows]);
  const saveDebounce = React.useRef(null);
  const [saveStatus, setSaveStatus] = React.useState('idle'); // idle|saving|saved|error
  const [rowSaveStatus, setRowSaveStatus] = React.useState({}); // per-column status
  const lastEditedKeyRef = React.useRef(null);
  const [bumpOnSave, setBumpOnSave] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [lastSnippet, setLastSnippet] = React.useState('');
  const [shopsCsv, setShopsCsv] = React.useState('');
  const [langsCsv, setLangsCsv] = React.useState('');
  const [activeLangIds, setActiveLangIds] = React.useState([]);
  const [groupsCsv, setGroupsCsv] = React.useState('');
  const [activeGroupIds, setActiveGroupIds] = React.useState([]);
  const [effectiveShops, setEffectiveShops] = React.useState('');
  // Performance: compute preview on demand only
  const [previewEnabled, setPreviewEnabled] = React.useState(false);
  // Suggestions helper (from latest run → extraction paths)
  const [sugg, setSugg] = React.useState({ loaded: false, busy: false, items: [], err: '' });
  const [openSugg, setOpenSugg] = React.useState({}); // { [col]: true }
  const [showAll, setShowAll] = React.useState({}); // { [col]: true }
  // Last run preview data
  const [lastRun, setLastRun] = React.useState({ id: 0, url: '', when: '', result: null });
  const [showPreviewPath, setShowPreviewPath] = React.useState(false);
  // Helper state for supplier_reference mapping picker
  const [attrOpen, setAttrOpen] = React.useState(false);
  const [attrOptions, setAttrOptions] = React.useState([]);
  const [attrBusy, setAttrBusy] = React.useState(false);
  // Inject a local CSS helper to hide scrollbars where desired
  React.useEffect(() => {
    try {
      const id = 'gs-no-scrollbar-style';
      if (!document.getElementById(id)) {
        const s = document.createElement('style');
        s.id = id;
        s.textContent = `.no-scrollbar{ -ms-overflow-style: none; scrollbar-width: none; } .no-scrollbar::-webkit-scrollbar{ display: none; }`;
        document.head.appendChild(s);
      }
    } catch {}
  }, []);
  // Paging + filter to reduce DOM size and improve scrolling
  const [filterQ, setFilterQ] = React.useState('');
  // No internal scroll/virtualization: render all rows
  const filteredCols = React.useMemo(() => {
    const q = String(filterQ||'').toLowerCase().trim();
    if (!q) return cols;
    return cols.filter(c => String(c.column_name||'').toLowerCase().includes(q));
  }, [cols, filterQ]);
  // All rows are rendered; rely on browser/page scroll
  React.useEffect(() => {
    try {
      const obj = mapText ? JSON.parse(mapText) : {};
      const fields = obj?.tables?.[tableKey]?.fields || {};
      const settings = obj?.tables?.[tableKey]?.settings || {};
      // no defaults support; constants belong in fields via '=value'
      const r = cols.map(c => {
        const name = String(c.column_name);
        const spec = fields[name];
        let pathStr = '';
        let removeStr = '';
        let doTrim = false;
        let rowSlug = false;
        const dataType = String(c.data_type || '');
        const columnType = String(c.column_type || '');
        const typeLabel = columnType || dataType;
        // Try to extract length/precision/enum set from column_type
        let lengthOrSet = '';
        try {
          const m = columnType.match(/^[^(]+\((.*)\)/);
          if (m && m[1]) lengthOrSet = m[1];
        } catch {}
        const hasDef = false;
        if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
          const paths = Array.isArray(spec.paths)? spec.paths: (spec.path? [spec.path]: []);
          pathStr = paths.join(' | ');
          const tr = Array.isArray(spec.transforms)? spec.transforms: [];
          for (const t of tr) { if (t?.op==='replace' && String(t?.replace||'')==='') { removeStr = String(t?.find||''); } if (t?.op==='trim') doTrim = true; }
          if (Array.isArray(spec.transforms)) {
            try { if (spec.transforms.some(x=>String(x?.op||'').toLowerCase()==='slugify')) rowSlug = true; } catch {}
          }
        } else if (Array.isArray(spec)) {
          pathStr = spec.join(' | ');
        } else if (typeof spec === 'string') {
          // Show constants directly in Path(s), including empty constant
          const s = String(spec);
          if (s === '' || s === '=') {
            // Treat bare empty string or '=' as explicit empty constant for display
            pathStr = '=""';
          } else if (s === '""' || s === "''") {
            // Legacy empty constant markers
            pathStr = '=""';
          } else if (/^=/.test(s)) {
            // Constant like '=1' → show as-is in Path(s)
            pathStr = s;
          } else {
            // Normal path string
            pathStr = s;
          }
        }
        return {
          name,
          type: dataType,
          typeFull: typeLabel,
          typeLenSet: lengthOrSet,
          path: pathStr,
          t_remove: removeStr,
          t_trim: doTrim,
          t_slugify: rowSlug
        };
      });
      setRows(r);
      try {
        const s = Array.isArray(settings.id_shops) ? settings.id_shops : [];
        const hasShopCol = Array.isArray(cols) && cols.some(c=>String(c.column_name||'').toLowerCase()==='id_shop');
        if (s.length) {
          setShopsCsv(s.join(','));
        } else if (hasShopCol) {
          // Prefill from global Shop destinations when table has id_shop and no per-table scope yet
          try {
            const obj2 = mapText ? JSON.parse(mapText) : {};
            const gl = obj2?.tables?.product_shop?.settings?.id_shops;
            if (Array.isArray(gl) && gl.length) setShopsCsv(gl.join(','));
          } catch { /* ignore */ }
        }
      } catch { setShopsCsv(''); }
      try {
        const l = Array.isArray(settings.id_langs) ? settings.id_langs : [];
        if (l.length) setLangsCsv(l.join(','));
      } catch { setLangsCsv(''); }
      // Groups: load per-table setting if present
      try {
        const g = Array.isArray(settings.id_groups) ? settings.id_groups : [];
        if (g.length) setGroupsCsv(g.join(',')); else setGroupsCsv('');
      } catch { setGroupsCsv(''); }
      // compute effective shops from top setting when table has id_shop and table override not set
      try {
        const hasShopCol = Array.isArray(cols) && cols.some(c=>String(c.column_name||'').toLowerCase()==='id_shop');
        if (hasShopCol) {
          if (!shopsCsv) {
            const obj2 = mapText ? JSON.parse(mapText) : {};
            const gl = obj2?.tables?.product_shop?.settings?.id_shops;
            if (Array.isArray(gl) && gl.length) setEffectiveShops(gl.join(',')); else setEffectiveShops('');
          } else {
            setEffectiveShops(shopsCsv);
          }
        } else { setEffectiveShops(''); }
      } catch { setEffectiveShops(''); }
    } catch { setRows([]); }
  }, [schema, mapText, tableKey]);

  // Reflect manual shop CSV edits into the applied preview
  React.useEffect(() => {
    if (String(shopsCsv||'').trim()) setEffectiveShops(shopsCsv);
  }, [shopsCsv]);

  // Remove per-table auto-load of langs to prevent jank on expand.
  // We rely on global display or explicit validation instead.

  // Load active ps_group ids when table has id_group or name ends with _group
  React.useEffect(() => {
    (async () => {
      try {
        const hasGroupCol = Array.isArray(cols) && cols.some(c=>String(c.column_name||'').toLowerCase()==='id_group');
        const looksGroupTbl = /_group$/i.test(String(tableKey||''));
        if (!(hasGroupCol || looksGroupTbl)) { setActiveGroupIds([]); return; }
        if (!domain || !mysqlProfileId) { setActiveGroupIds([]); return; }
        const p = new URLSearchParams(); p.set('domain', domain); p.set('profile_id', String(mysqlProfileId)); if (prefix) p.set('prefix', String(prefix));
        const r = await fetch(`/api/grabbing-sensorex/transfer/prestashop/groups?${p.toString()}`, { credentials:'include' });
        const ct = r.headers?.get?.('content-type')||''; if (!ct.includes('application/json')) { setActiveGroupIds([]); return; }
        const j = await r.json();
        const ids = Array.isArray(j?.ids) ? j.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
        setActiveGroupIds(ids);
      } catch { setActiveGroupIds([]); }
    })();
  }, [domain, mysqlProfileId, prefix, tableKey, cols]);

  // Auto-save removed: only manual Save applies changes

  async function ensureSuggestionsLoaded() {
    if (sugg.loaded || sugg.busy) return;
    if (!domain) return;
    setSugg(prev => ({ ...prev, busy: true, err: '' }));
    try {
      // Load latest run id for this domain/pageType
      const p = new URLSearchParams();
      p.set('domain', domain); p.set('page_type', pageType||'product'); p.set('limit','1'); p.set('include','full');
      const r1 = await fetch(`/api/grabbing-sensorex/extraction/history?${p.toString()}`, { credentials:'include' });
      const j1 = await r1.json();
      const items = Array.isArray(j1?.items) ? j1.items : [];
      const runId = Number(items[0]?.id || 0) || 0;
      if (!runId) throw new Error('no_run');
      // Keep last run meta + full result for previews
      try {
        const it = items[0] || {};
        const when = it.created_at || it.updated_at || '';
        const url = it.url || '';
        const res = (it.result && (typeof it.result==='object' ? it.result : JSON.parse(it.result))) || {};
        setLastRun({ id: runId, url, when, result: res });
      } catch {}
      const r2 = await fetch(`/api/grabbing-sensorex/extraction/paths?id=${encodeURIComponent(String(runId))}&max=800`, { credentials:'include' });
      const j2 = await r2.json();
      const aggregated = Array.isArray(j2?.aggregated) ? j2.aggregated : [];
      setSugg({ loaded: true, busy: false, items: aggregated, err: '' });
    } catch (e) {
      setSugg({ loaded: false, busy: false, items: [], err: String(e?.message||e) });
    }
  }

  // Load suggestions lazily when preview is enabled
  React.useEffect(() => {
    if (!previewEnabled) return;
    (async () => { try { await ensureSuggestionsLoaded(); } catch {} })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewEnabled, domain, pageType]);

  function deriveSuggestionsFor(colName) {
    const list = Array.isArray(sugg.items) ? sugg.items : [];
    if (!list.length) return [];
    const key = String(colName||'').toLowerCase();
    const syn = {
      name: ['name','title'],
      description: ['description_html','meta.description','description','content'],
      description_short: ['meta.description','description','short'],
      meta_title: ['meta.title','json_ld.mapped.name','json_ld.raw.name','title'],
      meta_description: ['meta.description','json_ld.mapped.description','description'],
      link_rewrite: ['slug','link_rewrite','name'],
      price: ['price','offers.price','amount'],
      ean13: ['ean13','ean','gtin13'],
      mpn: ['mpn'],
      upc: ['upc'],
      isbn: ['isbn'],
      reference: ['reference','sku'],
      quantity: ['quantity','stock.quantity','qty']
    };
    const likes = syn[key] || [key];
    const weight = (p) => {
      const path = String(p||'');
      let w = 0;
      for (const s of likes) if (path.toLowerCase().includes(String(s).toLowerCase())) w += 3;
      if (path.toLowerCase().includes(key)) w += 2;
      if (/^product\./i.test(path)) w += 1;
      if (/^meta\./i.test(path) && (key.includes('meta') || likes.includes('meta'))) w += 1;
      return w;
    };
    const scored = list.map(it => ({ path: it.path, count: Number(it.count||0), w: weight(it.path) }))
      .filter(x => x.w>0)
      .sort((a,b) => (b.w - a.w) || (b.count - a.count));
    const uniq = [];
    const seen = new Set();
    for (const s of scored) { if (!seen.has(s.path)) { uniq.push(s); seen.add(s.path); } if (uniq.length>=10) break; }
    return uniq;
  }

  const applyAndSave = async (bumpVersion = false) => {
    try {
      setSaveStatus('saving');
      const objOld = mapText ? JSON.parse(mapText) : {};
      const obj = JSON.parse(JSON.stringify(objOld));
      obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
      obj.tables[tableKey] = obj.tables[tableKey] && typeof obj.tables[tableKey]==='object' ? obj.tables[tableKey] : {};
      const t = obj.tables[tableKey];
      t.fields = t.fields && typeof t.fields==='object' ? t.fields : {};
      t.settings = t.settings && typeof t.settings==='object' ? t.settings : {};
      // Drop any legacy defaults container if present
      try { if (obj && Object.prototype.hasOwnProperty.call(obj,'defaults')) delete obj.defaults; } catch {}
      const parseCsvNums = (s) => String(s||'').split(/[\s,]+/).map(x=>Number(x||0)||0).filter(n=>n>0);
      const shops = parseCsvNums(shopsCsv);
      const langs = parseCsvNums(langsCsv);
      const groups = parseCsvNums(groupsCsv);
      // Preserve existing id_shops when the input is left empty.
      // Only overwrite when the user provided a non-empty CSV, or explicitly clears to "".
      try {
        const prev = (objOld?.tables && objOld.tables[tableKey] && objOld.tables[tableKey].settings && Array.isArray(objOld.tables[tableKey].settings.id_shops))
          ? objOld.tables[tableKey].settings.id_shops : (Array.isArray(t.settings.id_shops) ? t.settings.id_shops : undefined);
        const trimmed = String(shopsCsv||'').trim();
        if (trimmed === '') {
          // Keep previous setting (do not delete implicitly)
          if (prev !== undefined) t.settings.id_shops = prev; else { try { delete t.settings.id_shops; } catch {} }
        } else {
          if (shops.length) t.settings.id_shops = shops; else { try { delete t.settings.id_shops; } catch {} }
        }
      } catch { /* fallback to previous behavior */ if (shops.length) t.settings.id_shops = shops; else { try { delete t.settings.id_shops; } catch {} } }
      if (langs.length) {
        t.settings.id_langs = langs;
      } else {
        // Auto-fill id_langs from active ps_lang when table contains id_lang
        try {
          const hasLangCol = Array.isArray(cols) && cols.some(c=>String(c.column_name||'').toLowerCase()==='id_lang');
          if (hasLangCol && mysqlProfileId) {
            const p = new URLSearchParams(); if (domain) p.set('domain', domain); p.set('profile_id', String(mysqlProfileId));
            const rL = await fetch(`/api/grabbing-sensorex/transfer/prestashop/langs?${p.toString()}`, { credentials:'include' });
            const jL = await rL.json();
            const ids = (rL.ok && jL?.ok && Array.isArray(jL?.ids)) ? jL.ids.filter(n=>Number(n)>0) : [];
            if (ids.length) t.settings.id_langs = ids;
            else { try { delete t.settings.id_langs; } catch {} }
          } else { try { delete t.settings.id_langs; } catch {} }
        } catch { try { delete t.settings.id_langs; } catch {} }
      }
      // Groups: only apply when provided explicitly
      try {
        const prev = (objOld?.tables && objOld.tables[tableKey] && objOld.tables[tableKey].settings && Array.isArray(objOld.tables[tableKey].settings.id_groups))
          ? objOld.tables[tableKey].settings.id_groups : (Array.isArray(t.settings.id_groups) ? t.settings.id_groups : undefined);
        const trimmed = String(groupsCsv||'').trim();
        if (trimmed === '') {
          if (prev !== undefined) t.settings.id_groups = prev; else { try { delete t.settings.id_groups; } catch {} }
        } else {
          if (groups.length) t.settings.id_groups = groups; else { try { delete t.settings.id_groups; } catch {} }
        }
      } catch { if (groups.length) t.settings.id_groups = groups; else { try { delete t.settings.id_groups; } catch {} } }
      const isGroupTable = /_group$/i.test(String(tableKey||''));
      const isCategoryProduct = String(tableKey||'').toLowerCase() === 'category_product';
      for (const r of rows) {
        const key = r.name;
        let path = String(r.path||'').trim();
        // Treat UI path '=' or '=""' as empty constant. For group tables, drop the field entirely.
        if (path === '=' || path === '=""' || path === "''") {
          if (isGroupTable) { delete t.fields[key]; } else { t.fields[key] = '=""'; }
          continue;
        }
        // Guard: for join tables like category_product, if id_product/id_category is set to '=0' or empty, drop the field
        if (isCategoryProduct && (key === 'id_product' || key === 'id_category')) {
          const isZeroConst = /^=\s*0\s*$/.test(path);
          if (!path || isZeroConst) { delete t.fields[key]; continue; }
        }
        if (path) {
          const alts = path.includes('|') ? path.split('|').map(s=>s.trim()).filter(Boolean) : path;
          // embed transforms when provided
          const needsFx = (r.t_remove && r.t_remove.length) || r.t_trim || r.t_slugify;
          if (needsFx) {
            const spec = {};
            if (Array.isArray(alts)) spec.paths = alts; else spec.path = alts;
            const tx = [];
            if (r.t_remove && r.t_remove.length) tx.push({ op:'replace', find: r.t_remove, replace: '' });
            if (r.t_trim) tx.push({ op:'trim' });
            if (r.t_slugify) tx.push({ op:'slugify' });
            if (tx.length) spec.transforms = tx;
            t.fields[key] = spec;
          } else {
            t.fields[key] = alts;
          }
        } else {
          delete t.fields[key];
        }
      }
      // Prune mapping keys only when schema is available (avoid deleting valid fields when schema not loaded)
      try {
        if (Array.isArray(cols) && cols.length) {
          const valid = new Set(cols.map(c => String(c.column_name)));
          for (const k of Object.keys(t.fields||{})) { if (!valid.has(String(k))) delete t.fields[k]; }
        }
      } catch {}
      // Ensure no legacy defaults remain in JSON
      try { if (obj && Object.prototype.hasOwnProperty.call(obj,'defaults')) delete obj.defaults; } catch {}
      const updated = JSON.stringify(obj, null, 2);
      setMapText(updated);
      // Build minimal diff snippet for this table (fields only)
      try {
        const tOld = (objOld?.tables && objOld.tables[tableKey]) || {};
        const oldFields = (tOld?.fields && typeof tOld.fields==='object') ? tOld.fields : {};
        const newFields = (obj?.tables && obj.tables[tableKey] && typeof obj.tables[tableKey].fields==='object') ? obj.tables[tableKey].fields : {};
        const diffObj = (a={}, b={}) => {
          const out = {};
          const keys = new Set([...Object.keys(a||{}), ...Object.keys(b||{})]);
          for (const k of keys) {
            const av = a[k]; const bv = b[k];
            const sa = JSON.stringify(av); const sb = JSON.stringify(bv);
            if (sa !== sb) out[k] = (bv === undefined) ? null : bv;
          }
          return out;
        };
        const df = diffObj(oldFields, newFields);
        if (Object.keys(df).length) {
          const snippet = { tables: { [tableKey]: {} } };
          snippet.tables[tableKey].fields = df;
          setLastSnippet(JSON.stringify(snippet, null, 2));
        } else {
          setLastSnippet('');
        }
      } catch {}
      // Persist to table_settings (per-table row) and mapping_tools latest (no bump)
      if (domain) {
        try {
          // 1) Persist this table to table_settings (authoritative for Step 3 rebuild)
          try {
            const payload = { domain, page_type: pageType||'product', tables: {} };
            const colsArr = Array.isArray(cols) ? cols.map(c=>String(c?.column_name||'')).filter(Boolean) : [];
            payload.tables[tableKey] = { settings: t.settings || {}, mapping: { fields: t.fields || {} }, columns: colsArr };
            await fetch('/api/grabbing-sensorex/table-settings/batch', {
              method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload)
            });
          } catch (_) {}
          // 2) Persist full config to mapping_tools latest (no bump)
          const body = { domain, page_type: pageType||'product', config: obj };
          // Resolve latest version and upsert
          let ver = 0; try { const p = new URLSearchParams(); p.set('domain', domain); p.set('page_type', pageType||'product'); const rl = await fetch(`/api/grabbing-sensorex/mapping/tools/latest?${p.toString()}`, { credentials:'include' }); const jl = await rl.json(); if (rl.ok && jl?.ok && jl.item) ver = Number(jl.item.version||0)||0; } catch {}
          // Bump version: omit body.version so backend inserts next version; else update latest
          if (!bumpVersion && ver>0) body.version = ver;
          // Include connection profile and keep image settings if available in parent context through window.GS_CTX
          try { if (mysqlProfileId) body.db_mysql_profile_id = Number(mysqlProfileId)||0; } catch {}
          try { if (window?.GS_CTX?.imageSet && typeof window.GS_CTX.imageSet==='object') body.image_setting = window.GS_CTX.imageSet; } catch {}
          const r = await fetch('/api/grabbing-sensorex/mapping/tools', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
          if (!r.ok) throw new Error(String(r.status));
          setSaveStatus('saved'); setTimeout(()=>setSaveStatus('idle'), 900);
          try { setToast('Saved to server'); setTimeout(()=>setToast(''), 1500); } catch {}
          if (lastEditedKeyRef.current) setRowSaveStatus(prev => ({ ...prev, [lastEditedKeyRef.current]: 'idle' }));
          if (bumpVersion) {
            try { setToast('Mapping version bumped'); setTimeout(()=>setToast(''), 1500); } catch {}
            // Refresh versions list so the header selector updates
            try {
              if (typeof refreshMapVersionsFor === 'function') await refreshMapVersionsFor(pageType||'product');
              else if (typeof ensureMapVersionsFor === 'function') await ensureMapVersionsFor(pageType||'product');
            } catch {}
          }
        } catch (e) { setSaveStatus('error'); setMapMsg(String(e?.message||e)); }
      }
    } catch (e) { setSaveStatus('error'); setMapMsg(String(e?.message||e)); }
  };

  // --- Preview helpers (resolve mapping against last run result) ---
  const pickPath = React.useCallback((obj, pathStr) => {
    try {
      if (!pathStr) return undefined;
      const parts = String(pathStr).replace(/^\$\.?/, '').split('.');
      let cur = obj;
      for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
      return cur;
    } catch { return undefined; }
  }, []);
  // Resolve a single path and report which path produced the value (for meta.* fallbacks)
  const resolveOnePath = React.useCallback((pathStr) => {
    const s = String(pathStr || '').trim();
    const res = lastRun?.result || {};
    if (!s) return { value: undefined, used: '' };
    if (s.startsWith('$.')) return { value: pickPath(res, s.slice(2)), used: s };
    if (s.startsWith('product.')) return { value: pickPath(res.product || res, s.slice('product.'.length)), used: s };
    if (s.startsWith('item.')) return { value: pickPath(res.item || res, s.slice('item.'.length)), used: s };
    if (s.startsWith('meta.')) {
      const v = pickPath(res.meta || {}, s.slice('meta.'.length));
      if (v !== undefined && v !== null && v !== '') return { value: v, used: s };
      if (s === 'meta.title') return { value: res.title, used: res.title ? 'title' : s };
      if (s === 'meta.description') return { value: res.description, used: res.description ? 'description' : s };
      return { value: undefined, used: s };
    }
    return { value: pickPath(res, s), used: s };
  }, [lastRun, pickPath]);
  const sanitizeStr = (v) => { try { if (v === undefined || v === null) return ''; let s = String(v); s = s.trim(); const lc = s.toLowerCase(); if (lc === 'undefined' || lc === 'null' || lc === 'nan') return ''; return s; } catch { return ''; } };
  const applyPreviewTransforms = (row, val) => {
    try {
      let out = val;
      if (row?.t_remove) out = String(out==null?'':out).split(String(row.t_remove)).join('');
      if (row?.t_trim) out = String(out==null?'':out).trim();
      if (row?.t_slugify) {
        try { const s = String(out==null?'':out); out = s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); } catch {}
      }
      return out;
    } catch { return val; }
  };
  const resolvePreviewInfo = (row) => {
    try {
      if (!lastRun?.id) return { value: '', used: '' };
      const spec = String(row?.path||''); if (!spec) return { value: '', used: '' };
      const parts = spec.split('|').map(s=>s.trim()).filter(Boolean);
      let v, used = '';
      for (const p of parts) { const r = resolveOnePath(p); if (r.value !== undefined && r.value !== null && r.value !== '') { v = r.value; used = r.used || p; break; } }
      const out = applyPreviewTransforms(row, v);
      const val = typeof out === 'string' ? sanitizeStr(out) : (out ?? '');
      return { value: val, used };
    } catch { return { value: '', used: '' }; }
  };

  // Load best-guess mapping from the latest run suggestions into all rows (fields only)
  const loadFromLastRun = async () => {
    try {
      await ensureSuggestionsLoaded();
      setRows(prev => prev.map(r => {
        const list = deriveSuggestionsFor(r.name) || [];
        if (list.length > 0) return { ...r, path: list[0].path };
        return r;
      }));
      try { setMapMsg(`Loaded suggestions from last run for ${tableKey}`); } catch {}
      // Manual apply only (no auto-save)
    } catch (e) {
      try { setMapMsg(`Load from last run failed: ${String(e?.message||e)}`); } catch {}
    }
  };

  const applyRow = async (name) => {
    try { lastEditedKeyRef.current = name; await applyAndSave(!!bumpOnSave); } catch {}
  };

  return (
    <div className="border rounded relative">
      {toast && (
        <div className="absolute right-2 top-2 bg-green-600 text-white text-[11px] px-2 py-1 rounded shadow">{toast}</div>
      )}
      <div className="bg-gray-50 px-2 py-1 text-xs font-semibold">{prefix}{tableKey}</div>
      <div className="p-2">
        <div className="flex items-center gap-4 mb-2 text-[11px]">
          <div className="text-gray-600">
            {effectiveShops ? (<span>Applied shops: <span className="font-mono">{effectiveShops}</span></span>) : null}
            {effectiveShops ? <span className="mx-2">·</span> : null}
            <span>Applied langs: all active ps_lang</span>
            {(() => { const hasGroup = (Array.isArray(schema?.columns) && schema.columns.some(c=>String(c.column_name||'').toLowerCase()==='id_group')) || /_group$/i.test(String(tableKey||'')); return hasGroup && activeGroupIds.length; })() ? (
              <>
                <span className="mx-2">·</span>
                <span>ps_group (applies to all *_group tables): <span className="font-mono">{activeGroupIds.join(',')}</span></span>
              </>
            ) : null}
          </div>
          {lastRun?.id ? (
            <div className="text-gray-500">
              Last run: <span className="font-mono">#{lastRun.id}</span>{lastRun.url ? (<>
                {' '}·{' '}
                <a href={lastRun.url} className="underline decoration-dotted" target="_blank" rel="noreferrer">{String(lastRun.url).slice(0,64)}</a>
              </>) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] text-gray-500">Map JSON paths to table columns. Use Save to persist changes.</div>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 rounded border text-[11px]" onClick={loadFromLastRun}>Load from last run</button>
          <label className="text-[11px] inline-flex items-center gap-1">
            <input type="checkbox" checked={bumpOnSave} onChange={(e)=>setBumpOnSave(!!e.target.checked)} /> bump version on Save
          </label>
          <button className="px-2 py-1 rounded border text-[11px]" onClick={()=>applyAndSave(!!bumpOnSave)}>Save table</button>
        </div>
      </div>
      {/* Per-table settings quick inputs removed: shops/langs derive from mapping config */}
      <div className="border rounded">
            <div className="flex items-center justify-between px-2 py-1 bg-gray-50 border-b">
              <div className="flex items-center gap-2">
                <input className="border rounded px-2 py-1 text-[11px]" placeholder="Filter columns..." value={filterQ} onChange={(e)=>setFilterQ(e.target.value)} />
                <div className="text-[11px] text-gray-500">{filteredCols.length} cols</div>
              </div>
            </div>
            <table className="min-w-full text-[11px]">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left">Column</th>
                <th className="px-2 py-1 text-left">Path(s)</th>
                <th className="px-2 py-1 text-left">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] inline-flex items-center gap-1">
                      <input type="checkbox" checked={!!previewEnabled} onChange={(e)=>setPreviewEnabled(!!e.target.checked)} /> Preview (last run)
                    </label>
                    <label className="text-[10px] inline-flex items-center gap-1">
                      <input type="checkbox" checked={!!showPreviewPath} onChange={(e)=>setShowPreviewPath(!!e.target.checked)} /> path
                    </label>
                  </div>
                </th>
                <th className="px-2 py-1 text-left">Transform</th>
                <th className="px-2 py-1 text-left">Suggest</th>
                <th className="px-2 py-1 text-left">Apply</th>
              </tr>
            </thead>
            <tbody>
              {filteredCols.map((c) => {
                const name = String(c.column_name);
                const row = rowByName.get(name) || { name, path: '' };
                const status = rowSaveStatus[name] || 'idle';
                const prevInfo = previewEnabled ? resolvePreviewInfo(row) : null;
                return (
                  <tr key={name} className="border-b" >
                    <td className="px-2 py-1">
                      <div className="font-mono text-[11px]">{name}</div>
                      <div className="text-[10px] text-gray-500">
                        {row.typeFull ? row.typeFull : (row.type || '')}
                        {row.typeLenSet ? <span className="ml-1 text-gray-400">[{row.typeLenSet}]</span> : null}
                      </div>
                    </td>
                    <td className="px-2 py-1 w-[50%]"><input className="w-full border rounded px-1 py-0.5 font-mono" value={row.path} onChange={e=>{
                      const v = e.target.value; setRows(prev => prev.map(r => r.name===name ? ({ ...r, path: v }) : r)); lastEditedKeyRef.current = name; setRowSaveStatus(prev => ({ ...prev, [name]: 'saving' }));
                    }} /></td>
                    {/* Default column removed: constants belong in Path(s) using =value or ="" */}
                    <td className="px-2 py-1 max-w-[22rem]">
                      {previewEnabled ? (
                        <>
                          <div className="truncate font-mono" title={String(prevInfo?.value||'')}>
                            {String(prevInfo?.value||'').slice(0,120) || <span className="text-gray-400">(empty)</span>}
                          </div>
                          {showPreviewPath && (
                            <div className="text-[10px] text-gray-500 truncate" title={prevInfo?.used||''}>
                              {prevInfo?.used ? `path: ${prevInfo.used}` : 'path: —'}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-gray-400">(preview off)</div>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-2">
                        <input className="w-40 border rounded px-1 py-0.5 text-[11px]" placeholder="remove substring" value={row.t_remove||''} onChange={e=>{ const v=e.target.value; setRows(prev=>prev.map(r=>r.name===name?({...r,t_remove:v}):r)); }} />
                        <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={!!row.t_trim} onChange={e=>{ const v=!!e.target.checked; setRows(prev=>prev.map(r=>r.name===name?({...r,t_trim:v}):r)); }} /> trim</label>
                        {(String(name).toLowerCase()==='link_rewrite') && (
                          <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={!!row.t_slugify} onChange={e=>{ const v=!!e.target.checked; setRows(prev=>prev.map(r=>r.name===name?({...r,t_slugify:v}):r)); }} /> slugify</label>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <button className="px-2 py-0.5 border rounded bg-white text-[11px]" onClick={()=>{ setOpenSugg(prev => ({ ...prev, [name]: !prev[name] })); if (!sugg.loaded && !sugg.busy) ensureSuggestionsLoaded(); }}>Suggest</button>
                      {openSugg[name] && (
                        <div className="mt-1 max-h-28 overflow-auto no-scrollbar border rounded p-1 bg-gray-50">
                          {sugg.busy && (
                            <div className="text-[11px] text-gray-500 px-1 py-0.5">Loading suggestions…</div>
                          )}
                          {!sugg.busy && sugg.err && (
                            <div className="text-[11px] text-red-600 px-1 py-0.5">{sugg.err || 'Failed to load suggestions'}<button className="ml-2 px-1 py-0.5 border rounded bg-white" onClick={ensureSuggestionsLoaded}>Retry</button></div>
                          )}
                          {!sugg.busy && !sugg.err && (
                            <>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-gray-500">{showAll[name]? 'All paths' : 'Top suggestions'}</span>
                                <button className="px-1 py-0.5 border rounded bg-white text-[10px]" onClick={()=>setShowAll(prev=>({...prev,[name]:!prev[name]}))}>{showAll[name]?'Show top':'Show all'}</button>
                              </div>
                              {((showAll[name]? (sugg.items||[]) : (deriveSuggestionsFor(name)||[]))).map(it => {
                                const s = showAll[name]? { path: it.path, count: it.count||0, w: it.count||0 } : it;
                                return (
                                <div key={s.path} className="flex items-center gap-2">
                                  <button className="px-1 py-0.5 border rounded bg-white" onClick={()=>{
                                    setRows(prev => prev.map(r => r.name===name ? ({ ...r, path: s.path }) : r)); lastEditedKeyRef.current = name; setRowSaveStatus(prev => ({ ...prev, [name]: 'saving' })); setMapMsg(`${name} → ${s.path}`);
                                  }}>Use</button>
                                  <span className="font-mono">{s.path}</span>
                                  <span className="text-gray-400">seen {s.count}</span>
                                </div>
                              );})}
                              {(!deriveSuggestionsFor(name) || deriveSuggestionsFor(name).length===0) && (
                                <div className="text-[11px] text-gray-500 px-1 py-0.5">No suggestions available. Create a run in Step 4 (Test Extraction), then click Suggest again.</div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-[11px]"><button className="px-2 py-0.5 border rounded bg-white" onClick={()=>applyRow(name)}>Apply</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Last change preview */}
        <div className="mt-2">
          <div className="text-[11px] font-semibold">Last change snippet</div>
          <pre className="max-h-40 overflow-auto border rounded bg-gray-50 p-2 text-[11px] whitespace-pre-wrap break-words">{lastSnippet || '(no changes detected)'}</pre>
          {lastSnippet && (
            <div className="mt-1">
              <button className="px-2 py-0.5 border rounded bg-white text-[11px]" onClick={async()=>{ try { await (navigator.clipboard?.writeText(lastSnippet)); } catch {} }}>Copy snippet</button>
            </div>
          )}
        </div>

        {/* Attribute helper for supplier_reference */}
        {tableKey==='product' && (
          <div className="mt-2">
            <button className="text-xs px-2 py-0.5 border rounded bg-white" onClick={async()=>{
              setAttrOpen(v=>!v);
              if (!attrOpen && attrOptions.length===0 && !attrBusy) {
                try {
                  setAttrBusy(true);
                  const params = new URLSearchParams();
                  if (domain) params.set('domain', domain);
                  params.set('page_type', pageType||'product');
                  params.set('limit','1');
                  params.set('include','full');
                  const r = await fetch(`/api/grabbing-sensorex/extraction/history?${params.toString()}`, { credentials:'include' });
                  const j = await r.json();
                  const items = Array.isArray(j?.items)? j.items: [];
                  const res = (items[0]?.result && (typeof items[0].result==='object'? items[0].result: JSON.parse(items[0].result))) || {};
                  const attrs = (res.product && Array.isArray(res.product.attributes)) ? res.product.attributes : (Array.isArray(res.attributes)? res.attributes: []);
                  const opts = attrs.map((a,i)=>({ idx:i, name: String(a?.name||''), value: String(a?.value||''), path: `attributes.${i}.value` })).filter(o=>o.name);
                  setAttrOptions(opts);
                } catch {}
                finally { setAttrBusy(false); }
              }
            }}>{attrOpen? 'Hide' : 'Pick from attributes'}</button>
            {attrOpen && (
              <div className="mt-2">
                {attrBusy && <div className="text-xs text-gray-500">Loading…</div>}
                {!attrBusy && attrOptions.length===0 && <div className="text-xs text-gray-500">No attributes found on the latest run.</div>}
                {!attrBusy && attrOptions.length>0 && (
                  <div className="text-xs space-y-1">
                    {attrOptions.map(opt => (
                      <div key={opt.idx} className="flex items-center gap-2">
                        <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>{
                          const i = rows.findIndex(r=>String(r.name).toLowerCase()==='supplier_reference');
                          if (i>=0) {
                            const copy = rows.slice();
                            copy[i] = { ...copy[i], path: opt.path };
                            setRows(copy);
                            lastEditedKeyRef.current = 'supplier_reference';
                            setRowSaveStatus(prev=>({ ...prev, supplier_reference: 'saving' }));
                            setMapMsg(`supplier_reference mapped to ${opt.name} (${opt.path})`);
                          } else {
                            setMapMsg('Column supplier_reference not present in schema');
                          }
                        }}>Use</button>
                        <span className="font-mono">{opt.name}</span>
                        <span className="text-gray-500">→ {opt.path}</span>
                        <span className="text-gray-400">{opt.value.slice(0,60)}</span>
                      </div>
                    ))}
                    <div className="text-[10px] text-gray-500 mt-1">Note: Importer extracts the trailing token (e.g., “1020”) automatically.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default React.memo(SchemaTableEditor);
