import React from 'react';
import SchemaTableEditorComp from './SchemaTableEditor.jsx';

export default function PrestaMappingPanel({ ctx }) {
  const {
    activeDomain,
    mapType, setMapType,
    mapVersList, mapVers,
    autoSave, setAutoSave,
    stepOpen, setStepOpen,
    mysqlProfileId, setMysqlProfileId,
    profiles, profilesBusy,
    defaultPrefix, setDefaultPrefix,
    transfMsg, setTransfMsg,
    loadMappingHistory, ensureMapVersionsFor,
    mapHistItems, mapHistBusy, mapHistMsg,
    mapText, setMapText,
    copyToClipboard,
    mapCopyMsg, setMapCopyMsg,
    schema, schemaMsg,
    schemaPrefix,
    schemaTables,
    openSchema, setOpenSchema,
    shopSaveTimer, shopSaveStatus, setShopSaveStatus,
    imageSet, setImageSet,
    imgSaveStatus, setImgSaveStatus,
    loadPrestaSchema,
    deferredMapText,
    mapMsg, setMapMsg,
    schemaMapVersion,
    applyMappingVersion,
  } = ctx || {};
  const [newTableName, setNewTableName] = React.useState('');
  const [toast, setToast] = React.useState('');
  const showToast = React.useCallback((msg) => { try { setToast(String(msg||'Mapping updated!!')); setTimeout(()=>setToast(''), 1500); } catch {} }, []);
  const [activeLangsGlobal, setActiveLangsGlobal] = React.useState([]);
  // Quick search over mapping versions table
  const [verQ, setVerQ] = React.useState('');

  // Auto-apply latest mapping version when panel opens or domain/type changes
  // Unconditionally applies the latest saved version for the current domain/type
  const autoAppliedRef = React.useRef('');
  React.useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType || !stepOpen?.[3]) return;
        // compute latest available version from version list for this domain/type
        const key = String(mapType||'').toLowerCase();
        const dk = String(activeDomain||'').toLowerCase();
        const mkey = dk ? `${dk}|${key}` : key;
        const list = (mapVersList?.[mkey] || []).slice();
        if (!Array.isArray(list) || list.length === 0) return;
        const latest = list.reduce((m,v)=>Math.max(m, Number(v||0)||0), 0);
        if (!latest) return;
        const apKey = `${dk}|${key}|${latest}`;
        if (autoAppliedRef.current === apKey) return;
        if (typeof applyMappingVersion === 'function') {
          await applyMappingVersion(latest);
          autoAppliedRef.current = apKey;
        }
      } catch {}
    })();
  }, [activeDomain, mapType, mapVersList, stepOpen?.[3]]);

  // Auto-refresh schema (tables/columns) when mapping tables change in editor
  // Uses deferredMapText to avoid firing on every keystroke
  const mapTablesSigRef = React.useRef('');
  React.useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !stepOpen?.[3]) return;
        let sig = '';
        try {
          const obj = deferredMapText ? JSON.parse(deferredMapText) : null;
          const keys = (obj && obj.tables && typeof obj.tables==='object') ? Object.keys(obj.tables).sort() : [];
          const px = (obj && obj.prefix) ? String(obj.prefix) : (schemaPrefix || 'ps_');
          if (keys.length) sig = `${px}|${keys.join(',')}`;
        } catch {}
        if (sig && sig !== mapTablesSigRef.current) {
          mapTablesSigRef.current = sig;
          try { loadPrestaSchema && await loadPrestaSchema(); } catch {}
        }
      } catch {}
    })();
  }, [deferredMapText, activeDomain, schemaPrefix, stepOpen?.[3]]);

  // Ensure default flags exist in mapping JSON so the advanced editor shows them on load
  React.useEffect(() => {
    try {
      if (!mapText) return;
      const obj = JSON.parse(mapText);
      if (!obj || typeof obj !== 'object') return;
      let changed = false;
      obj.flags = obj.flags && typeof obj.flags === 'object' ? obj.flags : (changed = true, {});
      if (typeof obj.flags.unified_dynamic !== 'boolean') { obj.flags.unified_dynamic = true; changed = true; }
      if (typeof obj.flags.strict_mapping_only !== 'boolean') { obj.flags.strict_mapping_only = true; changed = true; }
      if (changed) setMapText(JSON.stringify(obj, null, 2));
    } catch {}
  }, [mapText, activeDomain, mapType]);

  React.useEffect(() => {
    if (!activeDomain || !stepOpen?.[3]) return;
    try { loadPrestaSchema && loadPrestaSchema(); } catch {}
  }, [activeDomain, mysqlProfileId, mapType, stepOpen?.[3]]);

  // Auto-load Mapping JSON when panel opens or domain/type changes
  React.useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !stepOpen?.[3]) return;
        const key = `${String(activeDomain).toLowerCase()}|${String(mapType||'').toLowerCase()}`;
        // Avoid thrashing: only auto-load when domain/type changes
        if (!window.__gjLastLoadedMapKey) window.__gjLastLoadedMapKey = '';
        if (window.__gjLastLoadedMapKey === key) return;
        setMapMsg('');
        const r = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(mapType)}`, { credentials:'include' });
        const j = await r.json();
        if (r.ok && j?.ok) {
          let obj = j.mapping || {};
          try {
            // Normalize: promote defaults into fields and drop top-level defaults; add id_langs when available
            const tables = (obj && typeof obj.tables==='object') ? obj.tables : {};
            const defaults = (obj && typeof obj.defaults==='object') ? obj.defaults : {};
            let changed = false;
            // Fetch active langs for *_lang tables
            let langs = [];
            try {
              const p = new URLSearchParams(); if (activeDomain) p.set('domain', activeDomain); if (mysqlProfileId) p.set('profile_id', String(mysqlProfileId));
              const rL = await fetch(`/api/grabbing-jerome/transfer/prestashop/langs?${p.toString()}`, { credentials:'include' });
              const jL = await rL.json(); if (rL.ok && jL?.ok) langs = (jL.ids||[]).filter(n=>Number(n)>0);
            } catch {}
            for (const [tName, entryRaw] of Object.entries(tables||{})) {
              const entry = (entryRaw && typeof entryRaw==='object') ? entryRaw : {};
              const fields = (entry.fields && typeof entry.fields==='object') ? entry.fields : {};
              const defs = (defaults && typeof defaults[tName]==='object') ? defaults[tName] : {};
              for (const [col, defVal] of Object.entries(defs||{})) {
                const val = String(defVal);
                const cval = (val === '') ? '' : ('='+val);
                if (fields[col] !== cval) { fields[col] = cval; changed = true; }
              }
              entry.fields = fields;
              try {
                const hasLangCol = Array.isArray(schema?.[tName]?.columns) && schema[tName].columns.some(c=>String(c.column_name||'').toLowerCase()==='id_lang');
                if (hasLangCol && langs.length) {
                  entry.settings = entry.settings && typeof entry.settings==='object' ? entry.settings : {};
                  entry.settings.id_langs = langs;
                  changed = true;
                }
              } catch {}
              tables[tName] = entry;
            }
            if (Object.keys(defaults||{}).length) { obj.defaults = {}; changed = true; }
            if (changed) obj = { ...obj, tables };
          } catch {}
          setMapText(JSON.stringify(obj || {}, null, 2));
          window.__gjLastLoadedMapKey = key;
        }
      } catch (e) { /* ignore auto-load errors to not block UI */ }
    })();
  }, [activeDomain, mapType, mysqlProfileId, stepOpen?.[3]]);

  // Ensure mapping versions list is hydrated for the current type (filtered by Page type)
  React.useEffect(() => {
    if (!activeDomain || !mapType || !stepOpen?.[3]) return;
    try { if (typeof ensureMapVersionsFor === 'function') ensureMapVersionsFor(mapType); } catch {}
  }, [activeDomain, mapType, stepOpen?.[3]]);

  // Selected mapping version ('' = latest). Auto-applies on change.
  const [verSel, setVerSel] = React.useState('');
  React.useEffect(() => { setVerSel(''); }, [activeDomain, mapType]);
  const verOptions = React.useMemo(() => {
    try {
      const key = String(mapType||'').toLowerCase();
      const dk = String(activeDomain||'').toLowerCase();
      const mkey = dk ? `${dk}|${key}` : key;
      const list = (mapVersList?.[mkey] || []).slice().sort((a,b)=>b-a);
      return list;
    } catch { return []; }
  }, [mapVersList, activeDomain, mapType]);

  // Load active ps_lang ids globally for display (applies to all *_lang tables)
  React.useEffect(() => {
    (async () => {
      try {
        if (!stepOpen?.[3]) return;
        if (!mysqlProfileId) { setActiveLangsGlobal([]); return; }
        const p = new URLSearchParams(); if (activeDomain) p.set('domain', activeDomain); p.set('profile_id', String(mysqlProfileId)); if (schemaPrefix) p.set('prefix', schemaPrefix);
        const r0 = await fetch(`/api/grabbing-jerome/transfer/prestashop/langs?${p.toString()}`, { credentials:'include' });
        const j0 = await r0.json(); if (!r0.ok || j0?.ok===false) throw new Error(String(j0?.message||j0?.error||r0.status));
        const ids = Array.isArray(j0?.ids) ? j0.ids.filter(n=>Number(n)>0) : [];
        setActiveLangsGlobal(ids);
      } catch { setActiveLangsGlobal([]); }
    })();
  }, [activeDomain, mysqlProfileId, schemaPrefix, stepOpen?.[3]]);

  return (
    <div className="panel order-3">
      <div className="panel__header flex items-center justify-between">
        <span>Step 3: Presta Mapping & Settings</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">Domain: <span className="font-mono">{activeDomain || '-'}</span></span>
          <span className="text-xs text-gray-600">Type: <span className="font-mono">{String(mapType||'').toLowerCase()||'-'}</span></span>
          <span className="ml-2 text-[11px] text-gray-500">
              {(function(){
                try {
                  const key = String(mapType||'').toLowerCase();
                  const dk = String(activeDomain||'').toLowerCase();
                  const mkey = dk ? `${dk}|${key}` : key;
                  const list = mapVersList?.[mkey] || [];
                  const fromList = list.length ? Math.max.apply(null, list) : 0;
                  const fromDirect = Number(mapVers?.[key]||0) || 0;
                  const v = Math.max(fromList||0, fromDirect||0);
                  return v>0 ? `Latest v${v}` : '(no versions)';
                } catch { return ''; }
              })()}
            </span>
          <label className="text-xs inline-flex items-center gap-1">
            Version
            <select
              className="border rounded px-2 py-1 text-xs"
              value={verSel}
              onChange={async (e)=>{
                const val = e.target.value;
                setVerSel(val);
                try {
                  if (!activeDomain || !mapType) return;
                  let vnum = 0;
                  if (val === '') {
                    vnum = Array.isArray(verOptions) && verOptions.length ? Math.max.apply(null, verOptions) : 0;
                  } else {
                    vnum = Number(val)||0;
                  }
                  if (vnum>0 && typeof applyMappingVersion==='function') {
                    await applyMappingVersion(vnum);
                  }
                } catch {}
              }}
            >
              <option value="">Latest</option>
              {verOptions.map(v => (
                <option key={v} value={String(v)}>v{v}</option>
              ))}
            </select>
            <button className="px-2 py-1 border rounded"
              title="Refresh version list"
              onClick={async ()=>{ try { if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType); } catch {} }}>
              Refresh
            </button>
            <span className="ml-2 text-[11px] text-gray-500">
              {schemaMapVersion ? `Applied v${schemaMapVersion}` : '(no version applied)'}
            </span>
          </label>
          <label className="text-xs inline-flex items-center gap-1" title="When off, changes are not sent automatically; use Save buttons.">
            <input type="checkbox" checked={!!autoSave} onChange={(e)=>setAutoSave(!!e.target.checked)} /> Auto-save
          </label>
          <div className="text-xs text-gray-500">Select profile and configure mapping + per-table settings. Use Step 4 → Runs to send.</div>
          <button className="px-2 py-1 text-xs border rounded" onClick={()=>setStepOpen(prev => ({ ...prev, 3: !prev[3] }))} aria-expanded={!!stepOpen?.[3]}>{stepOpen?.[3] ? 'Collapse' : 'Expand'}</button>
        </div>
      </div>
      <div className="panel__body space-y-3 relative" style={{ display: stepOpen?.[3] ? undefined : 'none', contentVisibility: 'auto', contain: 'content' }}>
        {toast && (
          <div className="absolute right-2 top-2 bg-green-600 text-white text-xs px-2 py-1 rounded shadow" style={{ zIndex: 10 }}>
            {toast}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="text-sm">Profile</div>
          <select className="border rounded px-2 py-1 text-sm" value={mysqlProfileId||0} onChange={(e)=>setMysqlProfileId(Number(e.target.value||0))} disabled={profilesBusy}>
            <option value={0}>— Select profile —</option>
            {(profiles||[]).map(p => (
              <option key={p.id} value={p.id}>{p.name || (`#${p.id} ${p.host||''}`)}</option>
            ))}
          </select>
          <label className="text-sm inline-flex items-center gap-2">
            Default prefix
            <input className="border rounded px-2 py-1 w-28" placeholder="ps_" value={defaultPrefix} onChange={(e)=>setDefaultPrefix(e.target.value)} />
          </label>
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60" disabled={!activeDomain || !mysqlProfileId} onClick={async ()=>{
            if (!activeDomain || !mysqlProfileId) return;
            setTransfMsg('');
            try {
              const payload = { db_mysql_profile_id: mysqlProfileId };
              if (defaultPrefix && defaultPrefix.trim()) payload.db_mysql_prefix = defaultPrefix.trim();
              const r = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
              const j = await r.json();
              if (!r.ok || j?.ok===false) { setTransfMsg(String(j?.message||j?.error||'save_failed')); }
              else {
                setTransfMsg('Saved profile for domain');
                // Immediately refresh schema/tables so they appear below without manual reload
                try { if (typeof loadPrestaSchema === 'function') await loadPrestaSchema(); } catch {}
              }
            } catch (e) { setTransfMsg(String(e?.message||e)); }
          }}>Save for domain</button>
          {transfMsg ? <span className="text-xs text-gray-600">{transfMsg}</span> : null}
        </div>

        {/* Add/Update tables helpers (moved below; original hidden) */}
        <div className="mt-2 p-2 border rounded bg-gray-50" style={{ display: 'none' }}>
          <div className="text-sm font-semibold mb-1">Tables Management</div>
          <div className="flex items-center gap-2 mb-2">
            <input className="border rounded px-2 py-1 text-sm w-64" placeholder="table name (e.g., product_attribute_shop)" value={newTableName} onChange={e=>setNewTableName(e.target.value)} />
            <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50" onClick={async ()=>{
              try {
                const raw = String(newTableName||'').trim();
                if (!raw) { setMapMsg('Enter a table name'); return; }
                let t = raw.toLowerCase().trim();
                if (t.startsWith('ps_')) t = t.slice(3);
                if (!/^[a-z0-9_]+$/.test(t)) { setMapMsg('Use only lowercase letters, digits, and underscore'); return; }
                let obj = {};
                try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
                if (obj.tables[t]) { setMapMsg(`Table ${t} already exists in mapping`); return; }
                const entry = obj.tables[t] = { fields: {}, settings: {} };
                // Seed fields/settings from current schema, shops/langs if present
                try {
                  const cols = Array.isArray(schema?.[t]?.columns) ? schema[t].columns : [];
                  for (const c of cols) { const name = String(c?.column_name||''); if (name && !(name in entry.fields)) entry.fields[name] = ''; }
                  const hasLang = cols.some(c=>String(c?.column_name||'').toLowerCase()==='id_lang');
                  const hasShop = cols.some(c=>String(c?.column_name||'').toLowerCase()==='id_shop');
                  if (hasLang && Array.isArray(activeLangsGlobal) && activeLangsGlobal.length) {
                    entry.settings.id_langs = activeLangsGlobal.slice();
                  }
                  const shops = (function(){ try { const s = obj?.tables?.product_shop?.settings?.id_shops; return Array.isArray(s)? s.filter(n=>Number(n)>0) : []; } catch { return []; } })();
                  if (hasShop && shops.length) entry.settings.id_shops = shops.slice();
                } catch {}
                try { if (t==='image' && imageSet && typeof imageSet==='object') entry.setting_image = { ...(entry.setting_image||{}), ...imageSet }; } catch {}
                setMapText(JSON.stringify(obj, null, 2));
                setMapMsg(`Added table ${t} to mapping (seeded from schema)`);
                try { setOpenSchema(prev => ({ ...prev, [t]: true })); } catch {}
                try { await loadPrestaSchema?.(); } catch {}
                try { showToast('Mapping updated!!'); } catch {}
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}>Add Table</button>
            <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50" onClick={async ()=>{
              try {
                let obj = {};
                try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                const tables = Array.isArray(schemaTables)? schemaTables: Object.keys(schema||{});
                let changed = false;
                obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
                for (const tbl of tables) {
                  const cols = Array.isArray(schema?.[tbl]?.columns) ? schema[tbl].columns : [];
                  if (!cols.length) continue;
                  const entry = obj.tables[tbl] = (obj.tables[tbl] && typeof obj.tables[tbl]==='object') ? obj.tables[tbl] : {};
                  const fields = entry.fields = (entry.fields && typeof entry.fields==='object') ? entry.fields : {};
                  for (const c of cols) {
                    const name = String(c.column_name||'');
                    if (!name) continue;
                    if (!(name in fields)) { fields[name] = ''; changed = true; }
                  }
                }
                if (changed) {
                  const updated = JSON.stringify(obj, null, 2);
                  setMapText(updated);
                  setMapMsg('Updated fields for all tables from schema');
                } else {
                  setMapMsg('No changes: all fields already present');
                }
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}>Update fields from schema (all)</button>
            <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50" title="Apply current Shop destinations to all id_shop tables" onClick={async ()=>{
              try {
                let obj = {};
                try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                const top = obj?.tables?.product_shop?.settings?.id_shops;
                if (!Array.isArray(top) || !top.length) { setMapMsg('Set Shop destinations first'); return; }
                const tables = Array.isArray(schemaTables)? schemaTables: Object.keys(schema||{});
                const payload = { domain: activeDomain, page_type: mapType, tables: {} };
                let changed = false;
                obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
                for (const tbl of tables) {
                  const cols = Array.isArray(schema?.[tbl]?.columns) ? schema[tbl].columns : [];
                  const hasShop = cols.some(c=>String(c.column_name||'').toLowerCase()==='id_shop');
                  if (!hasShop) continue;
                  const entry = obj.tables[tbl] = (obj.tables[tbl] && typeof obj.tables[tbl]==='object') ? obj.tables[tbl] : {};
                  entry.settings = entry.settings && typeof entry.settings==='object' ? entry.settings : {};
                  entry.settings.id_shops = top.slice();
                  payload.tables[tbl] = { settings: { id_shops: top.slice() } };
                  changed = true;
                }
                if (changed) {
                  const updated = JSON.stringify(obj, null, 2);
                  setMapText(updated);
                  const r = await fetch('/api/grabbing-jerome/table-settings/batch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
                  const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||r.status));
                  setMapMsg('Applied Shop destinations to all id_shop tables');
                  showToast('Mapping updated!!');
                } else {
                  setMapMsg('No id_shop tables detected to apply');
                }
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}>Apply shops → all tables</button>
            <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50 disabled:opacity-60" disabled={!mysqlProfileId} title="Apply active ps_lang ids to all id_lang tables" onClick={async ()=>{
              try {
                if (!mysqlProfileId) { setMapMsg('Select a MySQL profile first'); return; }
                const p = new URLSearchParams(); if (activeDomain) p.set('domain', activeDomain); p.set('profile_id', String(mysqlProfileId)); if (schemaPrefix) p.set('prefix', schemaPrefix);
                const r0 = await fetch(`/api/grabbing-jerome/transfer/prestashop/langs?${p.toString()}`, { credentials:'include' });
                const j0 = await r0.json(); if (!r0.ok || j0?.ok===false) throw new Error(String(j0?.message||j0?.error||r0.status));
                const ids = Array.isArray(j0?.ids) ? j0.ids.filter(n=>Number(n)>0) : [];
                if (!ids.length) { setMapMsg('No active ps_lang ids found'); return; }
                let obj = {}; try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                const tables = Array.isArray(schemaTables)? schemaTables: Object.keys(schema||{});
                const payload = { domain: activeDomain, page_type: mapType, tables: {} };
                let changed = false;
                obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
                for (const tbl of tables) {
                  const cols = Array.isArray(schema?.[tbl]?.columns) ? schema[tbl].columns : [];
                  const hasLang = cols.some(c=>String(c.column_name||'').toLowerCase()==='id_lang');
                  if (!hasLang) continue;
                  const entry = obj.tables[tbl] = (obj.tables[tbl] && typeof obj.tables[tbl]==='object') ? obj.tables[tbl] : {};
                  entry.settings = entry.settings && typeof entry.settings==='object' ? entry.settings : {};
                  entry.settings.id_langs = ids.slice();
                  payload.tables[tbl] = { settings: { id_langs: ids.slice() } };
                  changed = true;
                }
                if (changed) {
                  const updated = JSON.stringify(obj, null, 2);
                  setMapText(updated);
                  const r = await fetch('/api/grabbing-jerome/table-settings/batch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
                  const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||r.status));
                  setMapMsg('Applied active ps_lang ids to all id_lang tables');
                  showToast('Mapping updated!!');
                } else {
                  setMapMsg('No id_lang tables detected to apply');
                }
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}>Apply langs → all tables</button>
          </div>
          <div className="text-[11px] text-gray-600">Tip: Use Add Table to declare any Presta table (without prefix). Then expand it below and map paths. Use Update to seed missing column keys from the live schema.</div>
        </div>

        {/* Mapping Versions (history) — moved below; original hidden */}
        <div className="mt-3" style={{ display: 'none' }}>
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold">Mapping Versions</div>
            <div className="flex items-center gap-2 text-xs">
              <button className="px-2 py-1 border rounded" disabled={mapHistBusy || !activeDomain} onClick={async ()=>{ if (typeof loadMappingHistory==='function') await loadMappingHistory(); if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType); }}>Refresh</button>
              <button className="px-2 py-1 border rounded" disabled={!activeDomain || !mapType || mapHistBusy}
                title="Create a new mapping version from the current configuration without changing it"
                onClick={async ()=>{
                  try {
                    const body = { domain: activeDomain, page_type: mapType };
                    const r = await fetch('/api/grabbing-jerome/transfert/version/snapshot', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                    const j = await r.json();
                    if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'snapshot_failed')); return; }
                    if (typeof loadMappingHistory==='function') await loadMappingHistory();
                    if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType);
                    alert(`Snapshot created: v${Number(j?.version||0)||0}`);
                  } catch (e) { alert(String(e?.message||e)); }
                }}>Make snapshot now</button>
              <input
                className="ml-2 border rounded px-2 py-1"
                placeholder="Search versions…"
                value={verQ}
                onChange={(e)=>setVerQ(e.target.value)}
              />
              {mapHistMsg && <span className="text-red-600">{mapHistMsg}</span>}
            </div>
          </div>
          {activeDomain && mapType && !mapHistBusy && (!mapHistItems || mapHistItems.length===0) && (
            <div className="mb-2 p-2 border rounded bg-yellow-50 text-yellow-900 text-xs flex items-center justify-between">
              <div>
                No mapping versions yet for this page type. Save Mapping to create v1 (or use Snapshot).
              </div>
              <div className="flex items-center gap-2">
                <button className="px-2 py-1 border rounded bg-white"
                  onClick={async ()=>{
                    if (!activeDomain) return;
                    try {
                      let obj = {};
                      try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                      const r = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ page_type: mapType, mapping: obj, version_bump: false }) });
                      const j = await r.json();
                      if (!r.ok || j?.ok===false) { setMapMsg(String(j?.message||j?.error||'map_save_failed')); return; }
                      setMapMsg('Saved mapping (v1)');
                      showToast('Mapping updated!!');
                      if (typeof loadMappingHistory==='function') await loadMappingHistory();
                      if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType);
                    } catch (e) { setMapMsg(String(e?.message||e)); }
                  }}>Create v1 now</button>
                <button className="px-2 py-1 border rounded bg-white"
                  onClick={async ()=>{
                    try {
                      const body = { domain: activeDomain, page_type: mapType };
                      const r = await fetch('/api/grabbing-jerome/transfert/version/snapshot', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                      const j = await r.json();
                      if (!r.ok || j?.ok===false) { setMapMsg(String(j?.message||j?.error||'snapshot_failed')); return; }
                      if (typeof loadMappingHistory==='function') await loadMappingHistory();
                      if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType);
                      showToast('Mapping updated!!');
                    } catch (e) { setMapMsg(String(e?.message||e)); }
                  }}>Make snapshot</button>
              </div>
            </div>
          )}
          <div className="max-h-56 overflow-auto border rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 border-b sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">Version</th>
                  <th className="px-2 py-1 text-left">Name</th>
                  <th className="px-2 py-1 text-left">Created</th>
                  <th className="px-2 py-1 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {(function(){
                  let items = Array.isArray(mapHistItems)? mapHistItems: [];
                  // Strictly limit to current domain + page type in UI
                  const norm = (s='') => String(s||'').toLowerCase().replace(/^www\./,'');
                  const d = norm(activeDomain);
                  const t = String(mapType||'').toLowerCase();
                  items = items.filter(v => norm(v.domain) === d && String(v.page_type||'').toLowerCase() === t);
                  const q = String(verQ||'').trim().toLowerCase();
                  if (q) items = items.filter(v => {
                    const ver = String(v.version||'');
                    const name = String(v.name||'');
                    const created = String(v.created_at||'');
                    return [ver,name,created].some(s => s.toLowerCase().includes(q));
                  });
                  return items;
                })().map(v => (
                  <tr key={v.version} className="border-b">
                    <td className="px-2 py-1">v{v.version}</td>
                    <td className="px-2 py-1">{String(v.name || '')}</td>
                    <td className="px-2 py-1">{String(v.created_at||'').replace('T',' ').replace('Z','')}</td>
                    <td className="px-2 py-1 space-x-2">
                      <button className="px-2 py-1 border rounded" onClick={async ()=>{
                        try {
                          const p = new URLSearchParams(); p.set('domain', String(activeDomain)); p.set('page_type', String(mapType)); p.set('version', String(v.version));
                          const r = await fetch(`/api/grabbing-jerome/transfert/version/get?${p.toString()}`, { credentials:'include' });
                          const j = await r.json();
                          if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'load_failed')); return; }
                          const item = j.item || {};
                          const json = JSON.stringify({ config: item.config||{}, tables: item.tables||{} }, null, 2);
                          const w = window.open('', '_blank'); if (!w) { alert('Popup blocked'); return; }
                          const html = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Mapping v${v.version} – ${String(activeDomain)} (${String(mapType)})</title><style>body{font:12px system-ui, sans-serif;padding:10px} pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:4px;padding:8px}</style></head><body><h3 style=\"margin:0\">Mapping v${v.version} – ${String(activeDomain)} (${String(mapType)})</h3><pre id=\"code\"></pre><script>const data=${JSON.stringify(json)};document.getElementById('code').textContent=data;</script></body></html>`;
                          w.document.open(); w.document.write(html); w.document.close();
                        } catch (e) { alert(String(e?.message||e)); }
                      }}>View</button>
                      <button className="px-2 py-1 border rounded" onClick={async ()=>{
                        if (!window.confirm(`Restore mapping to v${v.version}?`)) return;
                        try {
                          const body = { domain: String(activeDomain), page_type: String(mapType), version: v.version };
                          const r = await fetch('/api/grabbing-jerome/transfert/version/restore', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                          const j = await r.json();
                          if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'restore_failed')); return; }
                          if (typeof loadMappingHistory==='function') await loadMappingHistory();
                          if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(String(mapType));
                          alert(`Restored. Current version is v${j?.restored_to ?? '?'}`);
                        } catch (e) { alert(String(e?.message||e)); }
                      }}>Restore</button>
                      <button className="ml-1 px-2 py-1 border rounded" title="Load this version into the editor and update the table list" onClick={async ()=>{
                        try {
                          if (typeof ctx?.applyMappingVersion === 'function') await ctx.applyMappingVersion(v.version);
                          showToast(`Applied mapping v${v.version}`);
                        } catch (e) { alert(String(e?.message||e)); }
                      }}>Apply</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold">Table Setting for Mapping</div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span>{(schemaMapVersion ? `Mapping v${schemaMapVersion} • ` : '')}Prefix {(schemaPrefix||'ps_')}</span>
              <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>{
                try {
                  const w = window.open('', '_blank');
                  if (!w) { alert('Popup blocked'); return; }
                  const safe = (s)=>String(s||'').replace(/[<>]/g, c=>({"<":"&lt;",">":"&gt;"}[c]));
                  let json = '';
                  try { json = deferredMapText || mapText || ''; } catch { json = mapText || ''; }
                  try { json = JSON.stringify(JSON.parse(json||'{}'), null, 2); } catch {}
                  const shell = `<!doctype html><html><head><meta charset="utf-8"><title>Mapping JSON</title><style>
                    body{font:12px system-ui,sans-serif;padding:10px}
                    .hdr{display:flex;justify-content:space-between;align-items:center;margin:0 0 8px 0}
                    .copy{font-size:12px;padding:2px 6px;border:1px solid #e5e5e5;border-radius:4px;background:#fff}
                    textarea{width:100%;height:70vh;border:1px solid #e5e5e5;border-radius:4px;padding:8px;font:12px/1.4 ui-monospace,monospace}
                  </style><script>
                    function copy(){
                      try{var el=document.getElementById('buf');var t=el?el.value:'';
                        if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).catch(fb);} else { fb(); }
                        function fb(){try{var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}catch(e){}}
                        var b=document.getElementById('btn'); if(b){var o=b.textContent;b.textContent='Copied'; setTimeout(function(){b.textContent=o;},1200);} }catch(e){}
                    }
                  </script></head><body>
                    <div class="hdr"><h3 style="margin:0">Mapping JSON</h3><button id="btn" class="copy" onclick="copy()">Copy JSON</button></div>
                    <textarea id="buf" readonly>${safe(json)}</textarea>
                  </body></html>`;
                  w.document.open(); w.document.write(shell); w.document.close();
                } catch (e) { alert(String(e?.message||e)); }
              }}>See JSON</button>
              <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>{
                try {
                  const arr = (Array.isArray(schemaTables) && schemaTables.length) ? schemaTables : (schema ? Object.keys(schema) : []);
                  setOpenSchema(prev => { const next = { ...(prev||{}) }; for (const t of arr) next[t] = true; return next; });
                } catch {}
              }}>Expand all</button>
              <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>{
                try {
                  const arr = (Array.isArray(schemaTables) && schemaTables.length) ? schemaTables : (schema ? Object.keys(schema) : []);
                  setOpenSchema(prev => { const next = { ...(prev||{}) }; for (const t of arr) next[t] = false; return next; });
                } catch {}
              }}>Collapse all</button>
              {/* Update mapping removed: use per-table Apply/Save instead */}
            </div>
          </div>
          <div className="flex items-center gap-2 mb-2 text-xs">
            <button className="px-2 py-1 border rounded" onClick={async ()=>{ await loadPrestaSchema(); }}>Reload from mapping</button>
            <span className="text-gray-500">Loads tables declared in the latest saved mapping.</span>
          </div>
          {schemaMsg ? <div className="text-xs text-amber-700">{schemaMsg}</div> : <div className="text-xs text-gray-500">Schema auto‑loaded from mapping.</div>}
          <div className="flex items-center gap-2 mb-2 text-xs">
            <label className="flex items-center gap-2">Shop destinations (CSV)
              <input className="border rounded px-2 py-1" placeholder="1,2" value={(function(){
                try { const obj = mapText ? JSON.parse(mapText) : {}; const s = obj?.tables?.product_shop?.settings?.id_shops; return Array.isArray(s)? s.join(',') : '';} catch { return ''; }
              })()} onChange={(e)=>{
                try {
                  const obj = mapText ? JSON.parse(mapText) : {};
                  obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
                  obj.tables.product_shop = obj.tables.product_shop && typeof obj.tables.product_shop==='object' ? obj.tables.product_shop : {};
                  obj.tables.product_shop.settings = obj.tables.product_shop.settings && typeof obj.tables.product_shop.settings==='object' ? obj.tables.product_shop.settings : {};
                  const raw = e.target.value; const arr = raw.trim()===''? [] : raw.split(',').map(s=>Number(s.trim())).filter(n=>Number.isFinite(n)&&n>0);
                  obj.tables.product_shop.settings.id_shops = arr;
                  setMapText(JSON.stringify(obj, null, 2));
                  try { if (shopSaveTimer?.current) clearTimeout(shopSaveTimer.current); } catch {}
                  setShopSaveStatus('saving');
                  shopSaveTimer.current = setTimeout(async () => {
                    try {
                      if (!activeDomain) return;
                      const payload = { domain: activeDomain, page_type: mapType, tables: { product_shop: { settings: { id_shops: arr } } } };
                      const r = await fetch('/api/grabbing-jerome/table-settings/batch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
                      const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||r.status));
                      setShopSaveStatus('saved');
                      setTimeout(() => setShopSaveStatus('idle'), 1200);
                    } catch (err) { setShopSaveStatus('error'); setMapMsg('Save failed: '+String(err?.message||err)); }
                  }, 800);
                } catch {}
              }} />
            </label>
            {shopSaveStatus==='saving' && <span className="text-xs text-gray-500">Saving…</span>}
          {shopSaveStatus==='saved' && <span className="text-xs text-green-600">Saved</span>}
          <div className="text-xs text-gray-500">Used for all *_shop tables.</div>
          <div className="text-xs text-gray-600">Active ps_lang (applies to all *_lang tables): {activeLangsGlobal.length ? (<span className="font-mono">{activeLangsGlobal.join(',')}</span>) : 'auto-detected from DB'}</div>
        </div>

          <div className="mt-2 p-2 border rounded">
            <div className="text-sm font-semibold mb-1">Image Import Settings</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet.download} onChange={e=>setImageSet(prev=>({ ...prev, download: !!e.target.checked }))} /> Download images</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet.sync_images} onChange={e=>setImageSet(prev=>({ ...prev, sync_images: !!e.target.checked }))} /> Sync images (prune missing)</label>
              <label className="flex items-center gap-2">Cover strategy
                <select className="border rounded px-2 py-1" value={imageSet.cover_strategy||'first'} onChange={e=>setImageSet(prev=>({ ...prev, cover_strategy: e.target.value }))}>
                  <option value="first">first</option>
                </select>
              </label>
              <label className="flex items-center gap-2">Image root (img/p)
                <input className="border rounded px-2 py-1 flex-1" placeholder="/var/www/prestashop/img/p" value={imageSet.img_root||''} onChange={e=>setImageSet(prev=>({ ...prev, img_root: e.target.value }))} />
              </label>
              <label className="flex items-center gap-2">bin/console
                <input className="border rounded px-2 py-1 flex-1" placeholder="/var/www/prestashop/bin/console" value={imageSet.bin_console||''} onChange={e=>setImageSet(prev=>({ ...prev, bin_console: e.target.value }))} />
              </label>
              <label className="flex items-center gap-2">PHP binary
                <input className="border rounded px-2 py-1 w-28" placeholder="php" value={imageSet.php_bin||'php'} onChange={e=>setImageSet(prev=>({ ...prev, php_bin: e.target.value }))} />
              </label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet.generate_thumbs} onChange={e=>setImageSet(prev=>({ ...prev, generate_thumbs: !!e.target.checked }))} /> Regenerate thumbnails</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!imageSet.overwrite_existing} onChange={e=>setImageSet(prev=>({ ...prev, overwrite_existing: !!e.target.checked }))} /> Overwrite existing</label>
              <label className="flex items-center gap-2">Console timeout (ms)
                <input className="border rounded px-2 py-1 w-32" type="number" value={Number(imageSet.console_timeout_ms||60000)} onChange={e=>setImageSet(prev=>({ ...prev, console_timeout_ms: Number(e.target.value||60000) }))} />
              </label>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button className="px-2 py-1 rounded border text-xs" onClick={async ()=>{
                if (!activeDomain) { setMapMsg('Select a domain first'); return; }
                setImgSaveStatus('saving');
                try {
                  const payload = { domain: activeDomain, page_type: mapType, tables: { image: { setting_image: imageSet } } };
                  const r = await fetch('/api/grabbing-jerome/table-settings/batch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
                  const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||r.status));
                  setImgSaveStatus('saved'); setTimeout(()=>setImgSaveStatus('idle'), 1200);
                } catch (e) { setImgSaveStatus('error'); setMapMsg('Save failed: '+String(e?.message||e)); }
              }}>Save Image Settings</button>
              {imgSaveStatus==='saving' && <span className="text-xs text-gray-500">Saving…</span>}
              {imgSaveStatus==='saved' && <span className="text-xs text-green-600">Saved</span>}
              {imgSaveStatus==='error' && <span className="text-xs text-red-600">Save failed</span>}
            </div>
          </div>

        {schema && (
          <div className="space-y-2">
              {((schemaTables && schemaTables.length ? schemaTables : ['product','product_shop','product_lang','stock_available']).slice().sort((a,b)=>String(a).localeCompare(String(b)))).map(tbl => (
                <div key={tbl} className="border rounded">
                  <div className="flex items-center justify-between px-2 py-1 bg-gray-50 border-b">
                    <div className="text-xs font-semibold">{(schemaPrefix||'ps_')+tbl}</div>
                    <div className="flex items-center gap-2">
                      <button className="text-xs px-2 py-0.5 border rounded bg-white" title="Add missing columns from schema into mapping.tables[table].fields" onClick={async ()=>{
                        try {
                          let obj = {};
                          try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                          const cols = Array.isArray(schema?.[tbl]?.columns) ? schema[tbl].columns : [];
                          if (!cols.length) { setMapMsg('No schema for this table. Select a profile then Refresh.'); return; }
                          obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
                          const entry = obj.tables[tbl] = (obj.tables[tbl] && typeof obj.tables[tbl]==='object') ? obj.tables[tbl] : {};
                          const fields = entry.fields = (entry.fields && typeof entry.fields==='object') ? entry.fields : {};
                          let changed = false;
                          for (const c of cols) { const name = String(c.column_name||''); if (name && !(name in fields)) { fields[name] = ''; changed = true; } }
                          if (changed) { const updated = JSON.stringify(obj, null, 2); setMapText(updated); setMapMsg(`Updated fields for ${tbl}`); } else { setMapMsg(`No changes for ${tbl}`); }
                        } catch (e) { setMapMsg(String(e?.message||e)); }
                      }}>Update fields</button>
                      <button className="text-xs px-2 py-0.5 border rounded bg-white" onClick={()=>setOpenSchema({ ...openSchema, [tbl]: !openSchema[tbl] })}>{openSchema?.[tbl] ? 'Collapse' : 'Expand'}</button>
                    </div>
                  </div>
                  {openSchema?.[tbl] && (
                    <div className="p-2">
                      <SchemaTableEditorComp autoSave={autoSave} tableKey={tbl} prefix={schemaPrefix||'ps_'} schema={schema?.[tbl]} mapText={deferredMapText} setMapText={setMapText} setMapMsg={setMapMsg} domain={activeDomain} pageType={mapType} mysqlProfileId={mysqlProfileId||0} />
                    </div>
        )}
        {/* Tables Management (moved below) */}
        <div className="mt-3 p-2 border rounded bg-gray-50">
          <div className="text-sm font-semibold mb-1">Tables Management</div>
          <div className="flex items-center gap-2 mb-2">
            <input className="border rounded px-2 py-1 text-sm w-64" placeholder="table name (e.g., product_attribute_shop)" value={newTableName} onChange={e=>setNewTableName(e.target.value)} />
            <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50" onClick={async ()=>{
              try {
                const raw = String(newTableName||'').trim();
                if (!raw) { setMapMsg('Enter a table name'); return; }
                let t = raw.toLowerCase().trim();
                if (t.startsWith('ps_')) t = t.slice(3);
                if (!/^[a-z0-9_]+$/.test(t)) { setMapMsg('Use only lowercase letters, digits, and underscore'); return; }
                let obj = {};
                try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
                if (obj.tables[t]) { setMapMsg(`Table ${t} already exists in mapping`); return; }
                obj.tables[t] = { fields: {}, settings: {} };
                const updated = JSON.stringify(obj, null, 2);
                setMapText(updated);
                setMapMsg(`Added table ${t} to mapping`);
                try { setOpenSchema(prev => ({ ...prev, [t]: true })); } catch {}
                try { await loadPrestaSchema?.(); } catch {}
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}>Add Table</button>
            <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50" onClick={async ()=>{
              try {
                let obj = {};
                try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                const tables = Array.isArray(schemaTables)? schemaTables: Object.keys(schema||{});
                let changed = false;
                obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
                for (const tbl of tables) {
                  const cols = Array.isArray(schema?.[tbl]?.columns) ? schema[tbl].columns : [];
                  if (!cols.length) continue;
                  const entry = obj.tables[tbl] = (obj.tables[tbl] && typeof obj.tables[tbl]==='object') ? obj.tables[tbl] : {};
                  const fields = entry.fields = (entry.fields && typeof entry.fields==='object') ? entry.fields : {};
                  for (const c of cols) {
                    const name = String(c.column_name||'');
                    if (!name) continue;
                    if (!(name in fields)) { fields[name] = ''; changed = true; }
                  }
                }
                if (changed) {
                  const updated = JSON.stringify(obj, null, 2);
                  setMapText(updated);
                  setMapMsg('Updated fields for all tables from schema');
                } else {
                  setMapMsg('No changes: all fields already present');
                }
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}>Update fields from schema (all)</button>
            <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50" onClick={async ()=>{
              try {
                let obj = {};
                try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                const tables = Array.isArray(schemaTables)? schemaTables: Object.keys(schema||{});
                const payload = { domain: activeDomain, page_type: (mapType || 'product'), tables: {} };
                let changed = false;
                obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
                for (const tbl of tables) {
                  const cols = Array.isArray(schema?.[tbl]?.columns) ? schema[tbl].columns : [];
                  const hasLang = cols.some(c=>String(c.column_name||'').toLowerCase()==='id_lang');
                  if (!hasLang) continue;
                  const entry = obj.tables[tbl] = (obj.tables[tbl] && typeof obj.tables[tbl]==='object') ? obj.tables[tbl] : {};
                  entry.settings = entry.settings && typeof entry.settings==='object' ? entry.settings : {};
                  entry.settings.id_langs = (activeLangsGlobal||[]).map(n=>Number(n)||0).filter(n=>n>0);
                  payload.tables[tbl] = { settings: { id_langs: entry.settings.id_langs.slice() } };
                  changed = true;
                }
                if (changed) {
                  const updated = JSON.stringify(obj, null, 2);
                  setMapText(updated);
                  const r = await fetch('/api/grabbing-jerome/table-settings/batch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
                  const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||r.status));
                  setMapMsg('Applied active ps_lang ids to all id_lang tables');
                  showToast('Mapping updated!!');
                } else {
                  setMapMsg('No id_lang tables detected to apply');
                }
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}>Apply langs → all tables</button>
          </div>
          <div className="text-[11px] text-gray-600">Tip: Use Add Table to declare any Presta table (without prefix). Then expand it below and map paths. Use Update to seed missing column keys from the live schema.</div>
        </div>

        {/* Mapping Versions (moved below) */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold">Mapping Versions</div>
            <div className="flex items-center gap-2 text-xs">
              <button className="px-2 py-1 border rounded" disabled={mapHistBusy || !activeDomain} onClick={async ()=>{ if (typeof loadMappingHistory==='function') await loadMappingHistory(); if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType); }}>Refresh</button>
              <button className="px-2 py-1 border rounded" disabled={!activeDomain || !mapType || mapHistBusy} title="Create a new mapping version from the current configuration without changing it" onClick={async ()=>{
                try {
                  const body = { domain: activeDomain, page_type: mapType };
                  const r = await fetch('/api/grabbing-jerome/transfert/version/snapshot', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                  const j = await r.json();
                  if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'snapshot_failed')); return; }
                  if (typeof loadMappingHistory==='function') await loadMappingHistory();
                  if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType);
                  alert(`Snapshot created: v${Number(j?.version||0)||0}`);
                } catch (e) { alert(String(e?.message||e)); }
              }}>Make snapshot now</button>
              <input className="ml-2 border rounded px-2 py-1" placeholder="Search versions…" value={verQ} onChange={(e)=>setVerQ(e.target.value)} />
              {mapHistMsg && <span className="text-red-600">{mapHistMsg}</span>}
            </div>
          </div>
          {activeDomain && mapType && !mapHistBusy && (!mapHistItems || mapHistItems.length===0) && (
            <div className="mb-2 p-2 border rounded bg-yellow-50 text-yellow-900 text-xs flex items-center justify-between">
              <div>No mapping versions yet for this page type.</div>
              <div className="flex items-center gap-2">
                <button className="px-2 py-1 border rounded bg-white" onClick={async ()=>{
                  if (!activeDomain) return;
                  try {
                    let obj = {};
                    try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                    const r = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ page_type: mapType, mapping: obj, version_bump: false }) });
                    const j = await r.json();
                    if (!r.ok || j?.ok===false) { setMapMsg(String(j?.message||j?.error||'map_save_failed')); return; }
                    setMapMsg('Saved mapping (v1)');
                    showToast('Mapping updated!!');
                  } catch (e) { setMapMsg(String(e?.message||e)); }
                }}>Save as v1</button>
                <button className="px-2 py-1 border rounded bg-white" onClick={async ()=>{
                  if (!activeDomain) return;
                  try {
                    const r = await fetch(`/api/grabbing-jerome/transfert/version/snapshot`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: activeDomain, page_type: mapType }) });
                    const j = await r.json();
                    if (!r.ok || j?.ok===false) { alert(String(j?.message||j?.error||'snapshot_failed')); return; }
                    if (typeof loadMappingHistory==='function') await loadMappingHistory();
                    if (typeof ensureMapVersionsFor==='function') await ensureMapVersionsFor(mapType);
                    alert(`Snapshot created: v${Number(j?.version||0)||0}`);
                  } catch (e) { alert(String(e?.message||e)); }
                }}>Snapshot now</button>
              </div>
            </div>
          )}
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-2 py-1 text-left">Version</th>
                  <th className="px-2 py-1 text-left">Name</th>
                  <th className="px-2 py-1 text-left">Created</th>
                  <th className="px-2 py-1 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {(mapHistItems||[]).filter(v => String(v.version||'').includes(verQ||'')).map((v,idx) => (
                  <tr key={idx} className="border-b">
                    <td className="px-2 py-1 font-mono">v{v.version}</td>
                    <td className="px-2 py-1">{v.name||''}</td>
                    <td className="px-2 py-1">{v.created_at||''}</td>
                    <td className="px-2 py-1 space-x-2">
                      <button className="px-2 py-1 border rounded text-xs bg-white" onClick={async ()=>{
                        try {
                          const r = await fetch(`/api/grabbing-jerome/transfert/version/get?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(mapType)}&version=${encodeURIComponent(v.version)}`, { credentials:'include' });
                          const j = await r.json();
                          if (!r.ok || j?.ok===false || !j?.item) { alert(String(j?.message||j?.error||'get_failed')); return; }
                          const cfg = (j.item.config && typeof j.item.config==='object') ? j.item.config : (j.item.tables || j.item) || {};
                          setMapText(JSON.stringify(cfg, null, 2));
                        } catch (e) { alert(String(e?.message||e)); }
                      }}>View</button>
                      <button className="px-2 py-1 border rounded text-xs bg-white" onClick={async ()=>{
                        try {
                          if (!window.confirm(`Restore mapping to v${v.version}? Current editor content will be overwritten.`)) return;
                          if (typeof ctx?.applyMappingVersion === 'function') await ctx.applyMappingVersion(v.version);
                          showToast(`Applied mapping v${v.version}`);
                        } catch (e) { alert(String(e?.message||e)); }
                      }}>Restore</button>
                      <button className="px-2 py-1 border rounded text-xs bg-white" onClick={async ()=>{
                        try {
                          if (typeof ctx?.applyMappingVersion === 'function') await ctx.applyMappingVersion(v.version);
                          showToast(`Applied mapping v${v.version}`);
                        } catch (e) { alert(String(e?.message||e)); }
                      }}>Apply</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {mapMsg ? <div className="text-xs text-red-600">{mapMsg}</div> : null}
          <textarea className="w-full h-48 border rounded p-2 font-mono text-xs" value={deferredMapText} onChange={(e)=>setMapText(e.target.value)} />
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60" disabled={!activeDomain} onClick={async ()=>{
              try {
                let obj = {};
                try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                // Auto-sanitize mapping before save: defaults/empties override fields
                try {
                  const tables = (obj && typeof obj.tables==='object') ? obj.tables : {};
                  const defaults = (obj && typeof obj.defaults==='object') ? obj.defaults : {};
                  let changed = false;
                  // Fetch active ps_lang ids for id_langs settings when relevant
                  let activeLangIds = [];
                  try {
                    const params = new URLSearchParams();
                    if (activeDomain) params.set('domain', activeDomain);
                    if (mysqlProfileId) params.set('profile_id', String(mysqlProfileId));
                    const rL = await fetch(`/api/grabbing-jerome/transfer/prestashop/langs?${params.toString()}`, { credentials:'include' });
                    const jL = await rL.json();
                    if (rL.ok && jL?.ok) activeLangIds = (jL.ids||[]).filter(n=>Number(n)>0);
                  } catch {}
                  for (const [tName, tEntryRaw] of Object.entries(tables||{})) {
                    const tEntry = (tEntryRaw && typeof tEntryRaw==='object') ? tEntryRaw : {};
                    const fields = (tEntry.fields && typeof tEntry.fields==='object') ? tEntry.fields : {};
                    const defs = (defaults && typeof defaults[tName]==='object') ? defaults[tName] : {};
                    for (const col of Object.keys(fields)) {
                      if (Object.prototype.hasOwnProperty.call(defs, col)) {
                        if (String(defs[col]) === '') {
                          if (fields[col] !== '') { fields[col] = ''; changed = true; }
                        } else {
                          const cval = '=' + String(defs[col]);
                          if (fields[col] !== cval) { fields[col] = cval; changed = true; }
                        }
                      }
                    }
                    tEntry.fields = fields;
                    // If table has id_lang column, include explicit id_langs for clarity
                    try {
                      const hasLangCol = Array.isArray(schema?.[tName]?.columns) && schema[tName].columns.some(c=>String(c.column_name||'').toLowerCase()==='id_lang');
                      if (hasLangCol && activeLangIds.length) {
                        tEntry.settings = tEntry.settings && typeof tEntry.settings==='object' ? tEntry.settings : {};
                        const cur = Array.isArray(tEntry.settings.id_langs)? tEntry.settings.id_langs: [];
                        const same = cur.length===activeLangIds.length && cur.every((v,i)=>Number(v)===Number(activeLangIds[i]));
                        if (!same) { tEntry.settings.id_langs = activeLangIds; changed = true; }
                      }
                    } catch {}
                    tables[tName] = tEntry;
                  }
                  if (obj && obj.defaults && Object.keys(obj.defaults||{}).length) { obj.defaults = {}; changed = true; }
                  if (changed) { obj = { ...obj, tables }; setMapText(JSON.stringify(obj, null, 2)); }
                } catch {}
                const r = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ page_type: mapType, mapping: obj, version_bump: false }) });
                const j = await r.json();
                if (r.ok && j?.ok) { setMapMsg('Saved mapping'); showToast('Mapping updated!!'); } else setMapMsg(String(j?.message||j?.error||'map_save_failed'));
              } catch (e) { setMapMsg(String(e?.message||e)); }
            }}></button>
            <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" title="Remove field paths when an empty/default exists for the same column across all tables" onClick={()=>{
              try {
                if (!mapText) return;
                const obj = JSON.parse(mapText);
                const tables = (obj && typeof obj.tables==='object') ? obj.tables : {};
                const defaults = (obj && typeof obj.defaults==='object') ? obj.defaults : {};
                let changed = false;
                for (const [tName, tEntryRaw] of Object.entries(tables||{})) {
                  const tEntry = (tEntryRaw && typeof tEntryRaw==='object') ? tEntryRaw : {};
                  const fields = (tEntry.fields && typeof tEntry.fields==='object') ? tEntry.fields : {};
                  const defs = (defaults && typeof defaults[tName]==='object') ? defaults[tName] : {};
                  for (const col of Object.keys(fields)) {
                    if (Object.prototype.hasOwnProperty.call(defs, col)) {
                      if (String(defs[col]) === '') {
                        if (fields[col] !== '') { fields[col] = ''; changed = true; }
                      } else {
                        const cval = '=' + String(defs[col]);
                        if (fields[col] !== cval) { fields[col] = cval; changed = true; }
                      }
                    }
                  }
                  tEntry.fields = fields;
                  tables[tName] = tEntry;
                }
                if (changed) { setMapText(JSON.stringify({ ...obj, tables }, null, 2)); setMapMsg('Sanitized mapping (defaults → constants; empties honored)'); showToast('Mapping updated!!'); }
                else { setMapMsg('Sanitize: no changes needed'); }
              } catch (e) { setMapMsg('Sanitize failed: '+String(e?.message||e)); }
            }}></button>
            <button className="ml-2 px-2 py-1 border rounded bg-white"
              title="Save current mapping content as a NEW version (version bump)"
              onClick={async ()=>{
                if (!activeDomain) return;
                try {
                  let obj = {};
                  try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { setMapMsg('Invalid JSON: '+(e?.message||e)); return; }
                  // Auto-sanitize mapping before version bump
                  try {
                    const tables = (obj && typeof obj.tables==='object') ? obj.tables : {};
                    const defaults = (obj && typeof obj.defaults==='object') ? obj.defaults : {};
                    let changed = false;
                    // Fetch active ps_lang ids
                    let activeLangIds = [];
                    try {
                      const params = new URLSearchParams();
                      if (activeDomain) params.set('domain', activeDomain);
                      if (mysqlProfileId) params.set('profile_id', String(mysqlProfileId));
                      const rL = await fetch(`/api/grabbing-jerome/transfer/prestashop/langs?${params.toString()}`, { credentials:'include' });
                      const jL = await rL.json();
                      if (rL.ok && jL?.ok) activeLangIds = (jL.ids||[]).filter(n=>Number(n)>0);
                    } catch {}
                  for (const [tName, tEntryRaw] of Object.entries(tables||{})) {
                    const tEntry = (tEntryRaw && typeof tEntryRaw==='object') ? tEntryRaw : {};
                    const fields = (tEntry.fields && typeof tEntry.fields==='object') ? tEntry.fields : {};
                    const defs = (defaults && typeof defaults[tName]==='object') ? defaults[tName] : {};
                    // Promote all defaults into fields constants
                    for (const [col, defVal] of Object.entries(defs||{})) {
                      const val = String(defVal);
                      const cval = (val === '') ? '' : ('=' + val);
                      if (fields[col] !== cval) { fields[col] = cval; changed = true; }
                    }
                    tEntry.fields = fields;
                    // Add id_langs for tables with id_lang
                    try {
                      const hasLangCol = Array.isArray(schema?.[tName]?.columns) && schema[tName].columns.some(c=>String(c.column_name||'').toLowerCase()==='id_lang');
                      if (hasLangCol && activeLangIds.length) {
                        tEntry.settings = tEntry.settings && typeof tEntry.settings==='object' ? tEntry.settings : {};
                        const cur = Array.isArray(tEntry.settings.id_langs)? tEntry.settings.id_langs: [];
                        const same = cur.length===activeLangIds.length && cur.every((v,i)=>Number(v)===Number(activeLangIds[i]));
                        if (!same) { tEntry.settings.id_langs = activeLangIds; changed = true; }
                      }
                    } catch {}
                    tables[tName] = tEntry;
                  }
                  if (obj && obj.defaults && Object.keys(obj.defaults||{}).length) { obj.defaults = {}; changed = true; }
                  if (changed) { obj = { ...obj, tables }; setMapText(JSON.stringify(obj, null, 2)); }
                  } catch {}
                  const r = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert`, {
                    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
                    body: JSON.stringify({ page_type: mapType, mapping: obj, version_bump: true })
                  });
                  const j = await r.json();
                  if (r.ok && j?.ok) {
                    try { if (typeof loadMappingHistory==='function') await loadMappingHistory(); } catch {}
                    let latest = null;
                    try {
                      if (typeof ensureMapVersionsFor === 'function') {
                        const arr = await ensureMapVersionsFor(mapType);
                        if (Array.isArray(arr) && arr.length) latest = Math.max.apply(null, arr);
                      }
                    } catch {}
                    const msg = latest ? `Saved mapping as new version v${latest}` : 'Saved mapping as new version';
                    setMapMsg(msg);
                    showToast('Mapping updated!!');
                  } else {
                    setMapMsg(String(j?.message||j?.error||'map_save_failed'));
                  }
                } catch (e) { setMapMsg(String(e?.message||e)); }
              }}></button>
            
            {/* Removed Load/Validate actions per requirements */}
          </div>
        </div>
      </div>
    </div>
  );
}
