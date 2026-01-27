import React from 'react';

export default function GlobalSettingsCard({ ctx, shopCsvDraft, setShopCsvDraft, shopSaveStatus, setShopSaveStatus, activeLangsGlobal, mapType, headerMapVersion }) {
  const {
    activeDomain,
    mapText, setMapText,
    setMapMsg,
    // optional profile state provided by parent ctx
    mysqlProfileId, setMysqlProfileId,
    profiles, profilesBusy,
    defaultPrefix, setDefaultPrefix,
    // optional schema context (for updating table_settings in batch)
    schema, schemaTables,
  } = ctx || {};
  // Local state hydrated from mapping_tools via settings/global
  const [localUnified, setLocalUnified] = React.useState(false);
  const [localStrict, setLocalStrict] = React.useState(false);
  const [localForce, setLocalForce] = React.useState(false);

  // Hydrate Behavior Flags, Shops CSV, and Prefix from backend mapping_tools (latest)
  const [activeGroups, setActiveGroups] = React.useState([]);
  React.useEffect(() => {
    (async () => {
      try {
        if (!activeDomain) return;
        // Only pause when DB is explicitly unhealthy; allow when dbOk is undefined
        if (ctx?.dbOk === false) return; // avoid spamming when DB is down
        const p = new URLSearchParams();
        p.set('domain', activeDomain);
        p.set('page_type', String(mapType || 'product'));
        const r = await fetch(`/api/grabbing-sensorex/settings/global?${p.toString()}`, { credentials: 'include' });
        const ctype = r.headers?.get?.('content-type') || '';
        if (!ctype.includes('application/json')) return;
        const j = await r.json();
        if (!r.ok || j?.ok === false) return;
        const it = j?.item || {};
        let setUni = false, setStr = false, setForce = false;
        if (typeof it.unified_dynamic === 'boolean') { setLocalUnified(!!it.unified_dynamic); setUni = true; }
        if (typeof it.strict_mapping_only === 'boolean') { setLocalStrict(!!it.strict_mapping_only); setStr = true; }
        if (typeof it.force_min_combination === 'boolean') { setLocalForce(!!it.force_min_combination); setForce = true; }
        // Fallback: resolve from mapping.tools latest when flags are missing
        if (!setUni || !setStr || !setForce) {
          try {
            const r2 = await fetch(`/api/grabbing-sensorex/mapping/tools/get?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(String(mapType||'product'))}&version=latest`, { credentials:'include' });
            const c2 = r2.headers?.get?.('content-type') || '';
            if (c2.includes('application/json')) {
              const j2 = await r2.json();
              if (r2.ok && j2?.ok && j2?.item) {
                const c = j2.item.config || {};
                const fl = (c && typeof c.flags==='object') ? c.flags : {};
                if (!setUni && typeof fl.unified_dynamic === 'boolean') setLocalUnified(!!fl.unified_dynamic);
                if (!setStr && typeof fl.strict_mapping_only === 'boolean') setLocalStrict(!!fl.strict_mapping_only);
                if (!setForce && typeof fl.force_min_combination === 'boolean') setLocalForce(!!fl.force_min_combination);
              }
            }
          } catch {}
        }
        if (Array.isArray(it.id_shops)) {
          try { setShopCsvDraft && setShopCsvDraft(it.id_shops.map(n=>Number(n||0)).filter(n=>n>0).join(',')); } catch {}
        }
        // Note: active groups for display are fetched from DB below (similar to langs)
        if (it.prefix && typeof it.prefix === 'string') {
          try { setDefaultPrefix && setDefaultPrefix(String(it.prefix)); } catch {}
        }
        if (it.profile_id && setMysqlProfileId) {
          try { setMysqlProfileId(Number(it.profile_id)||0); } catch {}
        }
      } catch {}
    })();
  }, [activeDomain, mapType, ctx?.dbOk]);

  // Fetch active ps_group from DB (display only; similar to Active ps_lang)
  React.useEffect(() => {
    (async () => {
      try {
        if (!activeDomain) { setActiveGroups([]); return; }
        const pid = ctx?.mysqlProfileId; if (!pid) { setActiveGroups([]); return; }
        const p = new URLSearchParams();
        p.set('domain', activeDomain);
        p.set('profile_id', String(pid));
        if (defaultPrefix) p.set('prefix', String(defaultPrefix));
        const r = await fetch(`/api/grabbing-sensorex/transfer/prestashop/groups?${p.toString()}`, { credentials:'include' });
        const ct = r.headers?.get?.('content-type')||''; if (!ct.includes('application/json')) { setActiveGroups([]); return; }
        const j = await r.json();
        const ids = Array.isArray(j?.ids) ? j.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
        setActiveGroups(ids);
      } catch { setActiveGroups([]); }
    })();
  }, [activeDomain, ctx?.mysqlProfileId, defaultPrefix]);
  const [flagsSavedMsg, setFlagsSavedMsg] = React.useState('');
  const [transfMsg, setTransfMsg] = React.useState('');
  const [connMsg, setConnMsg] = React.useState('');
  const [connBusy, setConnBusy] = React.useState(false);

  // Unified dynamic toggle — updates mapText locally; persisted with Save (per-section)
  const onUnifiedToggle = async (e) => {
    const val = !!e.target.checked;
    try {
      setLocalUnified(val);
      let obj = mapText ? JSON.parse(mapText) : {};
      if (!obj || typeof obj !== 'object') obj = {};
      obj.flags = obj.flags && typeof obj.flags==='object' ? obj.flags : {};
      obj.flags.unified_dynamic = val;
      const json = JSON.stringify(obj, null, 2);
      setMapText(json);
      setFlagsSavedMsg('Pending save');
    } catch (err) { try { setMapMsg && setMapMsg('Failed to update mapping: '+String(err?.message||err)); } catch {} }
  };

  // Strict mapping only toggle — updates mapText locally; persisted with Save (per-section)
  const onStrictToggle = async (e) => {
    const val = !!e.target.checked;
    try {
      setLocalStrict(val);
      let obj = mapText ? JSON.parse(mapText) : {};
      if (!obj || typeof obj !== 'object') obj = {};
      obj.flags = obj.flags && typeof obj.flags==='object' ? obj.flags : {};
      obj.flags.strict_mapping_only = val;
      const json = JSON.stringify(obj, null, 2);
      setMapText(json);
      setFlagsSavedMsg('Pending save');
    } catch (err) { try { setMapMsg && setMapMsg('Failed to update mapping: '+String(err?.message||err)); } catch {} }
  };


  // Force minimal combination toggle — updates mapText locally; persisted with Save (per-section)
  const onForceToggle = async (e) => {
    const val = !!e.target.checked;
    try {
      setLocalForce(val);
      let obj = mapText ? JSON.parse(mapText) : {};
      if (!obj || typeof obj !== 'object') obj = {};
      obj.flags = obj.flags && typeof obj.flags==='object' ? obj.flags : {};
      obj.flags.force_min_combination = val;
      const json = JSON.stringify(obj, null, 2);
      setMapText(json);
      setFlagsSavedMsg('Pending save');
    } catch (err) { try { setMapMsg && setMapMsg('Failed to update mapping: '+String(err?.message||err)); } catch {} }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {/* Subcard: Connection & Prefix */}
      <div className="p-2 border rounded">
        <div className="text-sm font-semibold mb-1">Connection & Prefix</div>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-sm">Profile</div>
          <select className="border rounded px-2 py-1 text-sm" value={mysqlProfileId||0} onChange={(e)=>setMysqlProfileId && setMysqlProfileId(Number(e.target.value||0))} disabled={profilesBusy}>
            <option value={0}>— Select profile —</option>
            {(profiles||[]).map(p => (
              <option key={p.id} value={p.id}>{p.name || (`#${p.id} ${p.host||''}`)}</option>
            ))}
          </select>
          <label className="text-sm inline-flex items-center gap-2">
            Default prefix
            <input className="border rounded px-2 py-1 w-28" placeholder="ps_" value={defaultPrefix||''} onChange={(e)=>setDefaultPrefix && setDefaultPrefix(e.target.value)} />
          </label>
        </div>
        {/* Test and Save row under profile/prefix as requested */}
        <div className="flex items-center gap-2 mb-2">
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60" disabled={!activeDomain || !mysqlProfileId || connBusy}
            onClick={async ()=>{
              if (!activeDomain || !mysqlProfileId) return;
              setConnBusy(true); setConnMsg('');
              try {
                const p = new URLSearchParams();
                p.set('domain', activeDomain);
                p.set('profile_id', String(mysqlProfileId));
                if (defaultPrefix && String(defaultPrefix).trim()) p.set('prefix', String(defaultPrefix).trim());
                const r = await fetch(`/api/grabbing-sensorex/transfer/prestashop/langs?${p.toString()}`, { credentials:'include' });
                let j=null; try { j = await r.json(); } catch {}
                if (!r.ok || (j && j.ok===false)) {
                  setConnMsg(String((j && (j.message||j.error)) || `failed (${r.status})`));
                } else {
                  const ids = Array.isArray(j?.ids)? j.ids.join(', '): '';
                  const prof = (j?.profile && (j.profile.host||j.profile.database)) ? `${j.profile.host||''}/${j.profile.database||''}` : `#${mysqlProfileId}`;
                  setConnMsg(`Connected to ${prof}; active langs: [${ids}]`);
                }
              } catch (e) { setConnMsg(String(e?.message||e)); }
              finally { setConnBusy(false); }
            }}>Test connection</button>
          <button className="px-3 py-1.5 rounded border bg-indigo-50 text-sm"
            onClick={async ()=>{
              try {
                if (!activeDomain) { setMapMsg && setMapMsg('Select a domain first'); return; }
                setConnBusy(true); setConnMsg('');
                const body = {
                  domain: activeDomain,
                  page_type: (mapType||'product'),
                  db_mysql_profile_id: (mysqlProfileId ? Number(mysqlProfileId) : null),
                  prefix: (defaultPrefix && String(defaultPrefix).trim()) || undefined,
                };
                // Target a specific mapping version when available so the profile_id
                // is persisted to the exact version the user is editing/using.
                if (headerMapVersion && Number(headerMapVersion) > 0) {
                  body.version = Number(headerMapVersion);
                }
                const r0 = await fetch('/api/grabbing-sensorex/settings/save-connection', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const j0 = await r0.json().catch(()=>null);
                if (!r0.ok || (j0 && j0.ok===false)) { setConnMsg(String((j0 && (j0.message||j0.error)) || `save_failed (${r0.status})`)); return; }
                setConnMsg('Saved');
              } catch (e) { setConnMsg(String(e?.message||e)); }
              finally { setConnBusy(false); }
            }}>Save</button>
          {transfMsg ? <span className="text-xs text-gray-600">{transfMsg}</span> : null}
          {connMsg ? <span className="text-xs text-gray-600">{connBusy? '… ':''}{connMsg}</span> : null}
        </div>
        
      </div>

      {/* Subcard: Behavior Flags */}
      <div className="p-2 border rounded">
        <div className="text-sm font-semibold mb-1">Behavior Flags</div>
        <div className="flex items-center gap-4 text-xs">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={!!localUnified} onChange={onUnifiedToggle} />
            Unified dynamic (mapping drives all tables)
          </label>
          <label className="inline-flex items-center gap-2" title="When enabled, ignore defaults and write only mapping fields/constants.">
            <input type="checkbox" checked={!!localStrict} onChange={onStrictToggle} />
            Strict mapping only (ignore defaults)
          </label>
          <label className="inline-flex items-center gap-2" title="Create a minimal combination if none exists so product_attribute(_shop) mappings can apply.">
            <input type="checkbox" checked={!!localForce} onChange={onForceToggle} />
            Force min combination (no variants)
          </label>
          {flagsSavedMsg && <span className="text-xs text-green-600">{flagsSavedMsg}</span>}
          <button className="ml-2 px-2 py-1 border rounded bg-white text-xs"
            onClick={async ()=>{
              try {
                if (!activeDomain) { setMapMsg && setMapMsg('Select a domain first'); return; }
                const body = { domain: activeDomain, page_type: (mapType||'product'), unified_dynamic: !!localUnified, strict_mapping_only: !!localStrict, force_min_combination: !!localForce };
                const r0 = await fetch('/api/grabbing-sensorex/settings/save-flags', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const j0 = await r0.json().catch(()=>null);
                if (!r0.ok || (j0 && j0.ok===false)) { setMapMsg && setMapMsg(String((j0 && (j0.message||j0.error)) || `save_failed (${r0.status})`)); return; }
                setFlagsSavedMsg('Saved'); setTimeout(()=>setFlagsSavedMsg(''), 1000);
              } catch (e) { setMapMsg && setMapMsg(String(e?.message||e)); }
            }}>Save</button>
        </div>
      </div>

      {/* Subcard: Shops */}
      <div className="p-2 border rounded">
        <div className="text-sm font-semibold mb-1">Shops</div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2">Shop destinations (CSV)
            <input className="border rounded px-2 py-1" placeholder="1,2" value={shopCsvDraft} onChange={(e)=>{ setShopCsvDraft(e.target.value); setShopSaveStatus && setShopSaveStatus('pending'); }} />
          </label>
          <div className="text-xs text-gray-500">Used for all *_shop tables.</div>
        </div>
        <div className="text-xs text-gray-600 mt-1">Active ps_lang (applies to all *_lang tables): {activeLangsGlobal?.length ? (<span className="font-mono">{activeLangsGlobal.join(',')}</span>) : 'auto-detected from DB'}</div>
        <div className="text-xs text-gray-600 mt-1">Active ps_group (applies to all *_group tables): {activeGroups.length ? (<span className="font-mono">{activeGroups.join(',')}</span>) : 'auto-detected from DB'}</div>
        <div className="mt-2 flex items-center gap-2">
          <button className="px-2 py-1 border rounded bg-white text-xs"
            onClick={async ()=>{
              try {
                if (!activeDomain) { setMapMsg && setMapMsg('Select a domain first'); return; }
                setShopSaveStatus && setShopSaveStatus('saving');
                // Parse shops CSV
                const shops = (String(shopCsvDraft||'').trim()==='' ? [] : String(shopCsvDraft).split(',').map(s=>Number(String(s).trim())).filter(n=>Number.isFinite(n)&&n>0));
                // Resolve langs (prefer provided; else fetch on-demand)
                let langs = Array.isArray(activeLangsGlobal) ? activeLangsGlobal.slice() : [];
                if (!langs.length && mysqlProfileId) {
                  try {
                    const p = new URLSearchParams(); p.set('domain', activeDomain); p.set('profile_id', String(mysqlProfileId)); if (defaultPrefix) p.set('prefix', String(defaultPrefix));
                    const rL = await fetch(`/api/grabbing-sensorex/transfer/prestashop/langs?${p.toString()}`, { credentials:'include' });
                    const cL = rL.headers?.get?.('content-type')||''; if (cL.includes('application/json')) { const jL = await rL.json(); langs = Array.isArray(jL?.ids) ? jL.ids.map(n=>Number(n)||0).filter(n=>n>0) : []; }
                  } catch {}
                }
                const body = { domain: activeDomain, page_type: (mapType||'product'), id_shops: shops, id_langs: (langs.length? langs: undefined) };
                try {
                  const v = Number(headerMapVersion||0)||0;
                  if (v>0) body.mapping_version = v;
                } catch {}
                const r0 = await fetch('/api/grabbing-sensorex/settings/save-shops', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const j0 = await r0.json().catch(()=>null);
                if (!r0.ok || (j0 && j0.ok===false)) { setMapMsg && setMapMsg(String((j0 && (j0.message||j0.error)) || `save_failed (${r0.status})`)); return; }
                setShopSaveStatus && setShopSaveStatus('saved'); setTimeout(()=>setShopSaveStatus && setShopSaveStatus(''), 1000);
              } catch (e) { setMapMsg && setMapMsg(String(e?.message||e)); }
            }}>Save</button>
          {shopSaveStatus==='saving' && <span className="text-xs text-gray-500">Saving…</span>}
          {shopSaveStatus==='saved' && <span className="text-xs text-green-600">Saved</span>}
          {shopSaveStatus==='pending' && <span className="text-xs text-amber-700">Pending</span>}
        </div>
      </div>
      {/* Removed the global Save subcard as requested */}
    </div>
  );
}
