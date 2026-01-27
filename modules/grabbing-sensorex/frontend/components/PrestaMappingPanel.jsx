import React from 'react';
import GlobalSettingsCard from './GlobalSettingsCard.jsx';
import ImageImportSettings from './ImageImportSettings.jsx';
import MappingVersions from './MappingVersions.jsx';
import MappingHeaderToolbar from './MappingHeaderToolbar.jsx';
import SchemaTablesEditor from './SchemaTablesEditor.jsx';

export default function PrestaMappingPanel({ ctx }) {
  const {
    activeDomain,
    mapType,
    mapVersList,
    ensureMapVersionsFor,
    stepOpen,
    mapText,
    setMapText,
    setMapMsg,
    schemaMapVersion,
    schemaPrefix,
    shopSaveStatus, setShopSaveStatus,
    imageSet, setImageSet,
    imgSaveStatus, setImgSaveStatus,
    applyMappingVersion,
  } = ctx || {};

  // Auto-apply latest mapping version when Step 3 opens or when domain/type changes
  const autoAppliedRef = React.useRef('');
  React.useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType || !stepOpen?.[3]) return;
        // Only pause when DB is explicitly unhealthy; allow when dbOk is undefined
        if (ctx?.dbOk === false) return;
        const key = String(mapType||'').toLowerCase();
        const dk = String(activeDomain||'').toLowerCase();
        const mkey = dk ? `${dk}|${key}` : key;
        const list = Array.isArray(mapVersList?.[mkey]) ? mapVersList[mkey] : [];
        if (!list.length) return;
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
  }, [activeDomain, mapType, mapVersList, stepOpen?.[3], applyMappingVersion, ctx?.dbOk]);

  // Auto-load versions list for Mapping Versions panel when Step 3 opens or domain/type changes
  React.useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType || !stepOpen?.[3]) return;
        // Only pause when DB is explicitly unhealthy; allow when dbOk is undefined
        if (ctx?.dbOk === false) return;
        if (typeof ensureMapVersionsFor === 'function') await ensureMapVersionsFor(mapType);
      } catch {}
    })();
  }, [activeDomain, mapType, stepOpen?.[3], ensureMapVersionsFor, ctx?.dbOk]);

  // Shop CSV draft used by GlobalSettingsCard
  const [shopCsvDraft, setShopCsvDraft] = React.useState('');
  React.useEffect(() => {
    try {
      const obj = mapText ? JSON.parse(mapText) : {};
      const s = obj?.tables?.product_shop?.settings?.id_shops;
      const csv = Array.isArray(s) ? s.join(',') : '';
      setShopCsvDraft((prev) => (prev && prev.length ? prev : csv));
    } catch { setShopCsvDraft((prev)=>prev||''); }
  }, [mapText, activeDomain, mapType]);


  // Minimal version selector state for header
  const [verSel, setVerSel] = React.useState('');
  const [verOptions, setVerOptions] = React.useState([]);
  const [headerMapVersion, setHeaderMapVersion] = React.useState(0);
  const [headerMapId, setHeaderMapId] = React.useState(null);
  const [headerPrefix, setHeaderPrefix] = React.useState('ps_');

  // Detect active ps_lang ids from DB (needs profile + prefix)
  const [activeLangsGlobal, setActiveLangsGlobal] = React.useState([]);
  React.useEffect(() => {
    (async () => {
      try {
        if (!activeDomain) { setActiveLangsGlobal([]); return; }
        // Prefer selected profile; if not set yet, global settings effect above may fill it
        const { mysqlProfileId } = ctx || {};
        if (!mysqlProfileId) { setActiveLangsGlobal([]); return; }
        const p = new URLSearchParams();
        p.set('domain', activeDomain);
        p.set('profile_id', String(mysqlProfileId));
        if (schemaPrefix || headerPrefix) p.set('prefix', String(schemaPrefix || headerPrefix));
        const r = await fetch(`/api/grabbing-sensorex/transfer/prestashop/langs?${p.toString()}`, { credentials:'include' });
        const ct = r.headers?.get?.('content-type')||'';
        if (!ct.includes('application/json')) { setActiveLangsGlobal([]); return; }
        const j = await r.json();
        const ids = Array.isArray(j?.ids) ? j.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
        setActiveLangsGlobal(ids);
      } catch { setActiveLangsGlobal([]); }
    })();
  }, [activeDomain, schemaPrefix, headerPrefix, ctx?.mysqlProfileId]);

  // Load header info and versions list from backend (robust to proxies)
  React.useEffect(() => {
    (async () => {
      try {
        if (!activeDomain || !mapType) { setVerOptions([]); setHeaderMapVersion(0); return; }
        // Only pause when DB is explicitly unhealthy; allow when dbOk is undefined
        if (ctx?.dbOk === false) { setVerOptions([]); return; }
        const q = `domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(mapType)}`;
        // Global settings for version/prefix
        try {
          const rg = await fetch(`/api/grabbing-sensorex/settings/global?${q}`, { credentials:'include' });
          const ctype = rg.headers?.get?.('content-type') || '';
          if (ctype.includes('application/json')) {
            const j = await rg.json();
            if (rg.ok && j?.ok) {
              if (j?.item?.version) setHeaderMapVersion(Number(j.item.version)||0);
              if (j?.item?.prefix) setHeaderPrefix(String(j.item.prefix||'ps_'));
            }
          }
        } catch {}
        // Versions list
        try {
          const rv = await fetch(`/api/grabbing-sensorex/mapping/tools/versions-lite?${q}`, { credentials:'include' });
          const ctype = rv.headers?.get?.('content-type') || '';
          if (ctype.includes('application/json')) {
            const j = await rv.json();
            if (rv.ok && j?.ok && Array.isArray(j.items)) {
              const arr = j.items.map(x=>Number(x.version||0)).filter(n=>n>0).sort((a,b)=>b-a);
              setVerOptions(arr);
              if (!verSel && arr.length && !headerMapVersion) setHeaderMapVersion(arr[0]);
            }
          }
        } catch {}
        // Mapping tool (latest) → id/version
        try {
          const rg2 = await fetch(`/api/grabbing-sensorex/mapping/tools/get?${q}&version=latest`, { credentials:'include' });
          const c2 = rg2.headers?.get?.('content-type') || '';
          if (c2.includes('application/json')) {
            const j2 = await rg2.json();
            if (rg2.ok && j2?.ok && j2?.item) {
              if (j2.item.id != null) setHeaderMapId(String(j2.item.id));
              if ((!headerMapVersion) && j2.item.version != null) setHeaderMapVersion(Number(j2.item.version)||0);
            }
          }
        } catch {}
      } catch {}
    })();
  }, [activeDomain, mapType, mapVersList, ctx?.dbOk]);
  const onVersionChange = async (e) => {
    const v = String(e?.target?.value||'').trim();
    setVerSel(v);
    try { if (!v) { if (typeof applyMappingVersion==='function') await applyMappingVersion('latest'); } else { if (typeof applyMappingVersion==='function') await applyMappingVersion(Number(v)); } } catch {}
  };

  const latestMapLabel = React.useMemo(() => (headerMapVersion ? `Latest v${headerMapVersion}` : ''), [headerMapVersion]);

  return (
    <div className="panel order-3">
      {/* expose ctx for nested components that don't receive all props directly */}
      <script dangerouslySetInnerHTML={{__html:`window.GS_CTX = window.GS_CTX || {}; try { window.GS_CTX.imageSet = ${JSON.stringify(ctx?.imageSet||{})}; } catch {}`}} />
      <MappingHeaderToolbar
        ctx={ctx}
        activeDomain={activeDomain}
        mapType={mapType}
        mapText={mapText}
        setMapText={setMapText}
        setMapMsg={setMapMsg}
        shopCsvDraft={shopCsvDraft}
        ensureMapVersionsFor={ensureMapVersionsFor}
        refreshMapVersionsFor={ctx?.refreshMapVersionsFor}
        schemaMapVersion={schemaMapVersion || headerMapVersion}
        schemaPrefix={schemaPrefix || headerPrefix}
        latestMapLabel={latestMapLabel}
        verSel={verSel}
        setVerSel={setVerSel}
        verOptions={verOptions}
        onVersionChange={onVersionChange}
      />

      

      <div className="panel__body space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div id="gs-global-card" className="p-2 border rounded">
            <div className="text-sm font-semibold mb-1">Global settings</div>
            <GlobalSettingsCard
              ctx={ctx}
              shopCsvDraft={shopCsvDraft}
              setShopCsvDraft={setShopCsvDraft}
              shopSaveStatus={shopSaveStatus}
              setShopSaveStatus={setShopSaveStatus}
              activeLangsGlobal={activeLangsGlobal}
              mapType={mapType}
              headerMapVersion={schemaMapVersion || headerMapVersion}
            />
          </div>

          <div id="gs-image-card" className="p-2 border rounded">
            <div className="text-sm font-semibold mb-1">Image Import Settings</div>
            <ImageImportSettings
              ctx={ctx}
              imageSet={imageSet}
              setImageSet={setImageSet}
              imgSaveStatus={imgSaveStatus}
              setImgSaveStatus={setImgSaveStatus}
              mapType={mapType}
            />
          </div>
        </div>

        <div id="gs-schema" className="mt-3">
          <SchemaTablesEditor
            ctx={{ ...ctx, activeLangsGlobal }}
            header={{
              activeDomain,
              mapType,
              latestMapLabel,
              schemaMapVersion: (schemaMapVersion || headerMapVersion),
              schemaPrefix: (schemaPrefix || headerPrefix),
              mapTool: { id: headerMapId, domain: activeDomain, page_type: mapType, version: (schemaMapVersion || headerMapVersion) }
            }}
          />
        </div>

        <div id="gs-versions" className="mt-3">
          <MappingVersions ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
