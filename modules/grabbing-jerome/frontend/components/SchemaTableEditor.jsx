import React from 'react';

function SchemaTableEditor({ tableKey, schema, prefix='ps_', mapText, setMapText, setMapMsg = ()=>{}, domain, pageType, mysqlProfileId=0, autoSave=true }) {
  const cols = Array.isArray(schema?.columns) ? schema.columns : [];
  const [rows, setRows] = React.useState([]);
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
  const [effectiveShops, setEffectiveShops] = React.useState('');
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
  React.useEffect(() => {
    try {
      const obj = mapText ? JSON.parse(mapText) : {};
      const fields = obj?.tables?.[tableKey]?.fields || {};
      const settings = obj?.tables?.[tableKey]?.settings || {};
      const defaults = (obj?.defaults && (obj.defaults[tableKey]||{})) || {};
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
        const hasDef = Object.prototype.hasOwnProperty.call(defaults || {}, name);
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
          // Display empty constant as empty input (no '=')
          pathStr = (spec === '') ? '' : spec;
        }
        return {
          name,
          type: dataType,
          typeFull: typeLabel,
          typeLenSet: lengthOrSet,
          path: pathStr,
          dflt: hasDef ? String(defaults[name] ?? '') : '',
          dfltEmpty: hasDef && String(defaults[name] ?? '') === '',
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

  // Load active langs when needed (fallback if no per-table id_langs)
  React.useEffect(() => {
    const hasLangCol = Array.isArray(schema?.columns) && schema.columns.some(c=>String(c.column_name||'').toLowerCase()==='id_lang');
    if (!hasLangCol) { setActiveLangIds([]); return; }
    if (String(langsCsv||'').trim()) { setActiveLangIds([]); return; }
    if (!domain || !mysqlProfileId) { setActiveLangIds([]); return; }
    (async () => {
      try {
        const p = new URLSearchParams(); if (domain) p.set('domain', domain); if (mysqlProfileId) p.set('profile_id', String(mysqlProfileId)); if (prefix) p.set('prefix', prefix);
        const r = await fetch(`/api/grabbing-jerome/transfer/prestashop/langs?${p.toString()}`, { credentials:'include' });
        const j = await r.json();
        const ids = Array.isArray(j?.ids) ? j.ids : [];
        setActiveLangIds(ids);
      } catch { setActiveLangIds([]); }
    })();
  }, [schema, langsCsv, domain, mysqlProfileId, prefix]);

  // Debounced auto-save when mapping rows change
  React.useEffect(() => {
    try { if (saveDebounce.current) clearTimeout(saveDebounce.current); } catch {}
    if (!domain) return;
    if (!autoSave) return;
    saveDebounce.current = setTimeout(() => { applyAndSave(); }, 1200);
    return () => { try { if (saveDebounce.current) clearTimeout(saveDebounce.current); } catch {} };
  }, [rows, domain, autoSave]);

  async function ensureSuggestionsLoaded() {
    if (sugg.loaded || sugg.busy) return;
    if (!domain) return;
    setSugg(prev => ({ ...prev, busy: true, err: '' }));
    try {
      // Load latest run id for this domain/pageType
      const p = new URLSearchParams();
      p.set('domain', domain); p.set('page_type', pageType||'product'); p.set('limit','1'); p.set('include','full');
      const r1 = await fetch(`/api/grabbing-jerome/extraction/history?${p.toString()}`, { credentials:'include' });
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
      const r2 = await fetch(`/api/grabbing-jerome/extraction/paths?id=${encodeURIComponent(String(runId))}&max=800`, { credentials:'include' });
      const j2 = await r2.json();
      const aggregated = Array.isArray(j2?.aggregated) ? j2.aggregated : [];
      setSugg({ loaded: true, busy: false, items: aggregated, err: '' });
    } catch (e) {
      setSugg({ loaded: false, busy: false, items: [], err: String(e?.message||e) });
    }
  }

  // Auto-load last run + suggestions so Preview column is populated without user action
  React.useEffect(() => {
    (async () => { try { await ensureSuggestionsLoaded(); } catch {} })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, pageType]);

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
      obj.defaults = obj.defaults && typeof obj.defaults==='object' ? obj.defaults : {};
      obj.defaults[tableKey] = obj.defaults[tableKey] && typeof obj.defaults[tableKey]==='object' ? obj.defaults[tableKey] : {};
      const defs = obj.defaults[tableKey];
      const parseCsvNums = (s) => String(s||'').split(/[\s,]+/).map(x=>Number(x||0)||0).filter(n=>n>0);
      const shops = parseCsvNums(shopsCsv);
      const langs = parseCsvNums(langsCsv);
      if (shops.length) t.settings.id_shops = shops; else { try { delete t.settings.id_shops; } catch {} }
      if (langs.length) {
        t.settings.id_langs = langs;
      } else {
        try {
          const hasLangCol = Array.isArray(cols) && cols.some(c=>String(c.column_name||'').toLowerCase()==='id_lang');
          if (hasLangCol && Array.isArray(activeLangsGlobal) && activeLangsGlobal.length) {
            t.settings.id_langs = activeLangsGlobal;
          } else {
            delete t.settings.id_langs;
          }
        } catch { try { delete t.settings.id_langs; } catch {} }
      }
      for (const r of rows) {
        const key = r.name;
        let path = String(r.path||'').trim();
        const dv = String(r.dflt||'').trim();

        // Treat UI path '=' or '=""' as explicit empty constant
        if (path === '=' || path === '=""') {
          t.fields[key] = '';
          try { delete defs[key]; } catch {}
          continue;
        }
        if (r.dfltEmpty) {
          // Empty enabled: persist constant empty and remove default
          t.fields[key] = '';
          try { delete defs[key]; } catch {}
          continue;
        }

        if (dv !== '') {
          // Default provided: promote to constant in fields (=literal) and drop default
          t.fields[key] = '=' + dv;
          try { delete defs[key]; } catch {}
          continue;
        }

        // No default and not empty => apply path(s) or clear fields
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
          try { delete t.fields[key]; } catch {}
        }
        try { delete defs[key]; } catch {}
      }
      // Do not promote other tables' defaults globally; keep mapping unchanged outside this table
      const updated = JSON.stringify(obj, null, 2);
      setMapText(updated);
      // Build minimal diff snippet for this table
      try {
        const tOld = (objOld?.tables && objOld.tables[tableKey]) || {};
        const oldFields = (tOld?.fields && typeof tOld.fields==='object') ? tOld.fields : {};
        const oldDefs = (objOld?.defaults && typeof objOld.defaults==='object' && typeof objOld.defaults[tableKey]==='object') ? objOld.defaults[tableKey] : {};
        const newFields = (obj?.tables && obj.tables[tableKey] && typeof obj.tables[tableKey].fields==='object') ? obj.tables[tableKey].fields : {};
        const newDefs = (obj?.defaults && typeof obj.defaults==='object' && typeof obj.defaults[tableKey]==='object') ? obj.defaults[tableKey] : {};
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
        const dd = diffObj(oldDefs, newDefs);
        if (Object.keys(df).length || Object.keys(dd).length) {
          const snippet = { tables: { [tableKey]: {} } };
          if (Object.keys(df).length) snippet.tables[tableKey].fields = df;
          if (Object.keys(dd).length) snippet.tables[tableKey].defaults = dd;
          setLastSnippet(JSON.stringify(snippet, null, 2));
        } else {
          setLastSnippet('');
        }
      } catch {}
      // Persist per-table settings/mapping for this domain/page type
      if (domain) {
        try {
          // Save only this table's settings/mapping via batch upsert (server merges, preserving other tables)
          // Drop defaults from payload and persist new-format mapping only
          const payload = { domain, page_type: pageType||'product', version_bump: !!bumpVersion, tables: { [tableKey]: { settings: (obj?.tables?.[tableKey]?.settings||{}), mapping: { fields: (obj?.tables?.[tableKey]?.fields||{}) } } } };
          const resp = await fetch(`/api/grabbing-jerome/table-settings/batch`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
          const j = await resp.json();
          if (!resp.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||resp.status));
          setSaveStatus('saved');
          setTimeout(()=>setSaveStatus('idle'), 900);
          if (lastEditedKeyRef.current) setRowSaveStatus(prev => ({ ...prev, [lastEditedKeyRef.current]: 'idle' }));
          if (bumpVersion) {
            try { setToast('Mapping version bumped'); setTimeout(()=>setToast(''), 1500); } catch {}
          }
        } catch (e) {
          setSaveStatus('error');
          setMapMsg(String(e?.message||e));
        }
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
      // Persist immediately when autoSave is off so user sees the effect in schema
      if (!autoSave && domain) {
        try { await applyAndSave(false); } catch {}
      }
    } catch (e) {
      try { setMapMsg(`Load from last run failed: ${String(e?.message||e)}`); } catch {}
    }
  };

  const applyRow = async (name) => {
    try { lastEditedKeyRef.current = name; await applyAndSave(true); } catch {}
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
            {Array.isArray(schema?.columns) && schema.columns.some(c=>String(c.column_name||'').toLowerCase()==='id_lang') ? (
              <span>Applied langs: all active ps_lang</span>
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
          <div className="text-[11px] text-gray-500">Map JSON paths to table columns and set per-column defaults. {autoSave ? 'Changes auto‑save.' : 'Auto‑save is off.'}</div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded border text-[11px]" onClick={loadFromLastRun}>Load from last run</button>
            {!autoSave && (
              <>
                <label className="text-[11px] inline-flex items-center gap-1">
                  <input type="checkbox" checked={bumpOnSave} onChange={(e)=>setBumpOnSave(!!e.target.checked)} /> bump version on Save
                </label>
                <button className="px-2 py-1 rounded border text-[11px]" onClick={()=>applyAndSave(!!bumpOnSave)}>Save table</button>
              </>
            )}
          </div>
        </div>
        <div className="border rounded">
            <table className="min-w-full text-[11px]">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left">Column</th>
                <th className="px-2 py-1 text-left">Path(s)</th>
                <th className="px-2 py-1 text-left">Default</th>
                <th className="px-2 py-1 text-left">
                  <div className="flex items-center gap-2">
                    <span>Preview (last run)</span>
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
              {cols.map(c => {
                const name = String(c.column_name);
                const row = rows.find(r => r.name === name) || { name, path: '', dflt: '' };
                const status = rowSaveStatus[name] || 'idle';
                const prevInfo = resolvePreviewInfo(row);
                return (
                  <tr key={name} className="border-b">
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
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-2">
                        <input className="w-40 border rounded px-1 py-0.5 font-mono" value={row.dflt} onChange={e=>{
                          const v = e.target.value; setRows(prev => prev.map(r => r.name===name ? ({ ...r, dflt: v, dfltEmpty: false }) : r)); lastEditedKeyRef.current = name; setRowSaveStatus(prev => ({ ...prev, [name]: 'saving' }));
                        }} />
                        <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={!!row.dfltEmpty} onChange={e=>{
                          const v = !!e.target.checked; setRows(prev => prev.map(r => r.name===name ? ({ ...r, dfltEmpty: v, dflt: v ? '' : r.dflt }) : r)); lastEditedKeyRef.current = name; setRowSaveStatus(prev => ({ ...prev, [name]: 'saving' }));
                        }} /> empty</label>
                      </div>
                    </td>
                    <td className="px-2 py-1 max-w-[22rem]">
                      <div className="truncate font-mono" title={String(prevInfo?.value||'')}>
                        {String(prevInfo?.value||'').slice(0,120) || <span className="text-gray-400">(empty)</span>}
                      </div>
                      {showPreviewPath && (
                        <div className="text-[10px] text-gray-500 truncate" title={prevInfo?.used||''}>
                          {prevInfo?.used ? `path: ${prevInfo.used}` : 'path: —'}
                        </div>
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
                        <div className="mt-1 max-h-28 overflow-auto border rounded p-1 bg-gray-50 scroll-smooth" style={{ contentVisibility: 'auto' }}>
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
                    <td className="px-2 py-1 text-[11px]">
                      {autoSave ? (
                        status==='saving' ? <span className="text-gray-500">saving…</span> : <span className="text-gray-400">auto</span>
                      ) : (
                        <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>applyRow(name)}>Apply</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Last change preview */}
        {!autoSave && (
          <div className="mt-2">
            <div className="text-[11px] font-semibold">Last change snippet</div>
            <pre className="max-h-40 overflow-auto border rounded bg-gray-50 p-2 text-[11px] whitespace-pre-wrap break-words">{lastSnippet || '(no changes detected)'}</pre>
            {lastSnippet && (
              <div className="mt-1">
                <button className="px-2 py-0.5 border rounded bg-white text-[11px]" onClick={async()=>{ try { await (navigator.clipboard?.writeText(lastSnippet)); } catch {} }}>Copy snippet</button>
              </div>
            )}
          </div>
        )}

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
                  const r = await fetch(`/api/grabbing-jerome/extraction/history?${params.toString()}`, { credentials:'include' });
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
