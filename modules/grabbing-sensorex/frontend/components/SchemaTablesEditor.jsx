import React from 'react';
// Defer SchemaTableEditor evaluation to render time to avoid ESM TDZ during chunk splits
const SchemaTableEditorComp = React.lazy(() => import('./SchemaTableEditor.jsx'));

export default function SchemaTablesEditor({ ctx, header }) {
  const {
    schema, setSchema, schemaTables, setSchemaTables, schemaPrefix,
    openSchema, setOpenSchema,
    mapText, setMapText, setMapMsg,
    activeLangsGlobal,
    activeDomain, mapType, mysqlProfileId,
    tableSrc,
  } = ctx || {};

  const [newTableName, setNewTableName] = React.useState('');
  const [removeTableName, setRemoveTableName] = React.useState('');
  const [syncMsg, setSyncMsg] = React.useState('');
  const [syncBusy, setSyncBusy] = React.useState(false);
  const [syncIdsMsg, setSyncIdsMsg] = React.useState('');
  const [syncIdsBusy, setSyncIdsBusy] = React.useState(false);
  // Build a compact header context line consistent with Step 3 header
  const hdr = header || {};
  const hdrDomain = hdr.activeDomain ?? activeDomain;
  const hdrType = hdr.mapType ?? mapType;
  const hdrLatest = hdr.latestMapLabel || '';
  const hdrMapVer = (hdr.schemaMapVersion != null ? Number(hdr.schemaMapVersion)||0 : null);
  const hdrPrefix = hdr.schemaPrefix || schemaPrefix || 'ps_';
  const mapTool = hdr.mapTool || {};

  return (
    <>
      <div className="text-sm font-semibold mb-1">Mapping Tables</div>
      <div className="text-[10px] text-gray-500 mb-1 select-text">
        Domain: <span className="font-mono">{hdrDomain || '-'}</span>
        {' '}• Type: <span className="font-mono">{String(hdrType||'').toLowerCase()||'-'}</span>
        {hdrLatest ? (<><span> • </span><span>{hdrLatest}</span></>) : null}
        <span> • </span>
        <span>{hdrMapVer ? (`Mapping v${hdrMapVer}`) : 'Mapping v-'}</span>
        <span> • Prefix {hdrPrefix || 'ps_'}</span>
        {mapTool && (mapTool.id || mapTool.version) ? (
          <>
            <span> • </span>
            <span>Mapping tool: id=<span className="font-mono">{mapTool.id || '-'}</span>, domain=<span className="font-mono">{(mapTool.domain||hdrDomain)||'-'}</span>, page_type=<span className="font-mono">{(mapTool.page_type||hdrType)||'-'}</span>, version=<span className="font-mono">{mapTool.version != null ? `v${mapTool.version}` : '-'}</span></span>
          </>
        ) : null}
        <span> • Tables: <span className="font-mono">{Array.isArray(schemaTables)? schemaTables.length : 0}</span></span>
      </div>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <button
          className="px-2 py-1 border rounded bg-white disabled:opacity-60"
          disabled={syncBusy || !activeDomain}
          title="Read live Presta schema and store column names into table settings"
          onClick={async ()=>{
            try {
              if (!activeDomain) { setMapMsg && setMapMsg('Select a domain first'); return; }
              setSyncBusy(true); setSyncMsg('');
              const body = {
                domain: hdrDomain || activeDomain,
                page_type: hdrType || mapType || 'product',
                prefix: hdrPrefix || schemaPrefix || 'ps_',
              };
              if (mysqlProfileId) body.profile_id = Number(mysqlProfileId);
              if (mapTool && mapTool.id) body.mapping_tool_id = Number(mapTool.id);
              if (hdrMapVer) body.mapping_version = Number(hdrMapVer);
              const r = await fetch('/api/grabbing-sensorex/table-settings/sync-columns', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
              const ctype = r.headers?.get?.('content-type') || '';
              let j=null; if (ctype.includes('application/json')) { try { j = await r.json(); } catch {} }
              if (!r.ok || (j && j.ok===false)) { setSyncMsg(String((j && (j.message||j.error)) || `sync_failed (${r.status})`)); return; }
              setSyncMsg(j && typeof j.updated==='number' ? `Synced columns for ${j.updated} table(s)` : 'Synced');
            } catch (e) { setSyncMsg(String(e?.message||e)); }
            finally { setSyncBusy(false); }
          }}
        >Sync columns from schema</button>
        {syncBusy ? <span className="text-gray-500">Syncing…</span> : null}
        {(!syncBusy && syncMsg) ? <span className="text-gray-600">{syncMsg}</span> : null}

        <button
          className="px-2 py-1 border rounded bg-white disabled:opacity-60"
          title="Seed ps_product_lang fields (name, link_rewrite with slugify, description join)"
          disabled={!activeDomain}
          onClick={async ()=>{
            try {
              const t = 'product_lang';
              const obj = (()=>{ try { return mapText ? JSON.parse(mapText) : {}; } catch { return {}; } })();
              obj.tables = obj.tables && typeof obj.tables==='object' ? obj.tables : {};
              obj.tables[t] = obj.tables[t] && typeof obj.tables[t]==='object' ? obj.tables[t] : {};
              const fields = obj.tables[t].fields && typeof obj.tables[t].fields==='object' ? obj.tables[t].fields : {};
              // Safe defaults
              fields.name = fields.name || [ 'product.name', 'title' ];
              if (!fields.link_rewrite || typeof fields.link_rewrite !== 'object') {
                fields.link_rewrite = {
                  paths: ['product.slug', 'product.name'],
                  transforms: [ { op:'trim' }, { op:'slugify' }, { op:'truncate', len:128 } ]
                };
              }
              if (!fields.description || typeof fields.description !== 'object') {
                fields.description = {
                  paths: ['sections.product_information','product.description_html'],
                  join: 'html',
                  transforms: [ { op:'truncate', len:60000 } ]
                };
              }
              if (!fields.description_short || typeof fields.description_short !== 'object') {
                fields.description_short = {
                  paths: ['product.description_html'],
                  transforms: [ { op:'strip_html' }, { op:'truncate', len:800 } ]
                };
              }
              obj.tables[t].fields = fields;
              // Settings: prefer detected active langs; fallback to [1]
              const langs = Array.isArray(activeLangsGlobal) && activeLangsGlobal.length ? activeLangsGlobal : [1];
              const settings = obj.tables[t].settings && typeof obj.tables[t].settings==='object' ? obj.tables[t].settings : {};
              if (!Array.isArray(settings.id_langs) || !settings.id_langs.length) settings.id_langs = langs;
              obj.tables[t].settings = settings;
              setMapText(JSON.stringify(obj, null, 2));
              setMapMsg && setMapMsg('Seeded product_lang fields');
              // Persist into table_settings via batch
              try {
                const payload = { domain: (hdrDomain || activeDomain), page_type: (hdrType || mapType || 'product'), tables: {} };
                payload.tables[t] = { settings, mapping: { fields } };
                if (mapTool && mapTool.id) payload.mapping_tool_id = Number(mapTool.id);
                if (hdrMapVer) payload.mapping_version = Number(hdrMapVer);
                await fetch('/api/grabbing-sensorex/table-settings/batch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
              } catch {}
            } catch (e) { setMapMsg(String(e?.message||e)); }
          }}
        >Seed product_lang fields</button>

        <button
          className="px-2 py-1 border rounded bg-white disabled:opacity-60"
          disabled={syncIdsBusy || !activeDomain}
          title="Apply id_shops/id_langs into table settings for tables that have those columns"
          onClick={async ()=>{
            try {
              if (!activeDomain) { setMapMsg && setMapMsg('Select a domain first'); return; }
              setSyncIdsBusy(true); setSyncIdsMsg('');
              // Load shops from current mapText (product_shop.settings.id_shops)
              let shops = [];
              try {
                const obj = mapText ? JSON.parse(mapText) : {};
                const arr = obj?.tables?.product_shop?.settings?.id_shops;
                if (Array.isArray(arr)) shops = arr.map(n=>Number(n)||0).filter(n=>n>0);
              } catch {}
              // Load langs via endpoint if profile is selected
              let langs = [];
              try {
                if (mysqlProfileId) {
                  const p = new URLSearchParams();
                  if (hdrDomain || activeDomain) p.set('domain', (hdrDomain || activeDomain));
                  p.set('profile_id', String(mysqlProfileId));
                  if (hdrPrefix || schemaPrefix) p.set('prefix', (hdrPrefix || schemaPrefix));
                  const r0 = await fetch(`/api/grabbing-sensorex/transfer/prestashop/langs?${p.toString()}`, { credentials:'include' });
                  const c0 = r0.headers?.get?.('content-type') || '';
                  if (c0.includes('application/json')) {
                    const j0 = await r0.json();
                    const ids = Array.isArray(j0?.ids) ? j0.ids : [];
                    langs = ids.map(n=>Number(n)||0).filter(n=>n>0);
                  }
                }
              } catch {}

              // Build batch payload per table when column exists
              const tablesList = Array.isArray(schemaTables) && schemaTables.length
                ? schemaTables
                : (schema ? Object.keys(schema) : []);
              const payload = { domain: (hdrDomain || activeDomain), page_type: (hdrType || mapType || 'product'), tables: {} };
              if (mapTool && mapTool.id) payload.mapping_tool_id = Number(mapTool.id);
              if (hdrMapVer) payload.mapping_version = Number(hdrMapVer);
              let touched = 0;
              const nextObj = (()=>{ try { return mapText ? JSON.parse(mapText) : {}; } catch { return {}; }})();
              nextObj.tables = nextObj.tables && typeof nextObj.tables==='object' ? nextObj.tables : {};
              for (const tbl of tablesList) {
                const cols = Array.isArray(schema?.[tbl]?.columns) ? schema[tbl].columns : [];
                const hasShop = cols.some(c=>String(c?.column_name||'').toLowerCase()==='id_shop');
                const hasLang = cols.some(c=>String(c?.column_name||'').toLowerCase()==='id_lang');
                const settings = {};
                if (hasShop && shops.length) settings.id_shops = shops.slice();
                if (hasLang && langs.length) settings.id_langs = langs.slice();
                if (Object.keys(settings).length) {
                  payload.tables[tbl] = { settings };
                  // Mirror into local mapText
                  nextObj.tables[tbl] = nextObj.tables[tbl] && typeof nextObj.tables[tbl]==='object' ? nextObj.tables[tbl] : {};
                  nextObj.tables[tbl].settings = nextObj.tables[tbl].settings && typeof nextObj.tables[tbl].settings==='object' ? nextObj.tables[tbl].settings : {};
                  Object.assign(nextObj.tables[tbl].settings, settings);
                  touched++;
                }
              }
              if (!touched) { setSyncIdsMsg('No eligible tables or no ids to apply'); return; }
              // Persist via batch endpoint
              const rb = await fetch('/api/grabbing-sensorex/table-settings/batch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
              const cb = rb.headers?.get?.('content-type') || '';
              let jb=null; if (cb.includes('application/json')) { try { jb = await rb.json(); } catch {} }
              if (!rb.ok || (jb && jb.ok===false)) { setSyncIdsMsg(String((jb && (jb.message||jb.error)) || `sync_failed (${rb.status})`)); return; }
              try { const updated = JSON.stringify(nextObj, null, 2); if (updated !== mapText) setMapText(updated); } catch {}
              setSyncIdsMsg(`Synced id_shops/id_langs for ${touched} table(s)`);
            } catch (e) { setSyncIdsMsg(String(e?.message||e)); }
            finally { setSyncIdsBusy(false); }
          }}
        >Sync id_shops and id_langs</button>
        {syncIdsBusy ? <span className="text-gray-500">Syncing…</span> : null}
        {(!syncIdsBusy && syncIdsMsg) ? <span className="text-gray-600">{syncIdsMsg}</span> : null}

        <button
          className="px-2 py-1 border rounded bg-white"
          title="Collapse all tables"
          onClick={()=>{ try { if (typeof setOpenSchema === 'function') setOpenSchema({}); } catch {} }}
        >Collapse all</button>
      </div>

      <div className="space-y-2">
        {(() => {
          try {
            const arr = Array.isArray(schemaTables) && schemaTables.length
              ? schemaTables
              : (schema ? Object.keys(schema) : ['product','product_shop','product_lang','stock_available']);
            // Sort case-insensitively by table name for a stable UI order
            return arr
              .slice()
              .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
          } catch { return ['product','product_shop','product_lang','stock_available']; }
        })().map(tbl => (
          <div key={tbl} className="border rounded">
            <div className="flex items-center justify-between px-2 py-1 bg-gray-50 border-b">
              <div className="text-xs font-semibold">{(schemaPrefix||'ps_')+tbl}</div>
              <div className="flex items-center gap-2">
                <button
                  className="text-xs px-2 py-0.5 border rounded bg-white"
                  onClick={()=>{
                    try { setOpenSchema && setOpenSchema(prev => ({ ...(prev||{}), [tbl]: !((prev||{})[tbl]) })); } catch {}
                  }}
                >{openSchema && openSchema[tbl] ? 'Collapse' : 'Expand'}</button>
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
                    for (const c of cols) {
                      const name = String(c.column_name||'');
                      if (!name || (name in fields)) continue;
                      // Do not seed blank fields for group tables; leave unmapped
                      const isGroupTable = /_group$/i.test(String(tbl||''));
                      if (isGroupTable) continue;
                      fields[name] = '';
                      changed = true;
                    }
                    if (changed) { const updated = JSON.stringify(obj, null, 2); setMapText(updated); setMapMsg(`Updated fields for ${tbl}`); } else { setMapMsg(`No changes for ${tbl}`); }
                  } catch (e) { setMapMsg(String(e?.message||e)); }
                }}>Update fields</button>
              </div>
            </div>
            {openSchema && openSchema[tbl] ? (
              <div className="p-2">
                <SchemaTableEditorComp
                  autoSave={false}
                  tableKey={tbl}
                  prefix={schemaPrefix||'ps_'}
                  schema={schema?.[tbl]}
                  mapText={mapText}
                  setMapText={setMapText}
                  setMapMsg={setMapMsg}
                  domain={activeDomain}
                  pageType={mapType}
                  mysqlProfileId={mysqlProfileId||0}
                  ensureMapVersionsFor={ctx?.ensureMapVersionsFor}
                  refreshMapVersionsFor={ctx?.refreshMapVersionsFor}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>

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
              const entry = obj.tables[t] = { fields: {}, settings: {} };
              // Seed fields from current schema if available
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
              const updated = JSON.stringify(obj, null, 2);
              setMapText(updated);
              setMapMsg(`Added table ${t}`);
              // Reflect in local lists immediately
              try {
                if (typeof setSchemaTables === 'function') {
                  setSchemaTables((prev)=>{
                    const base = Array.isArray(prev)? prev.slice(): [];
                    if (!base.some(x=>String(x).toLowerCase()===t)) base.push(t);
                    return base;
                  });
                }
              } catch {}
              try {
                if (typeof setSchema === 'function') {
                  const cols = Array.isArray(schema?.[t]?.columns) ? schema[t].columns : [];
                  setSchema((prev)=>({ ...(prev||{}), [t]: { columns: cols } }));
                }
              } catch {}
              // Persist into table_settings via batch
              try {
                const payload = { domain: (hdrDomain || activeDomain), page_type: (hdrType || mapType || 'product'), tables: {} };
                const cols = Array.isArray(schema?.[t]?.columns) ? schema[t].columns : [];
                const columnsArr = cols.map(c=>String(c?.column_name||'')).filter(Boolean);
                payload.tables[t] = { settings: entry.settings || {}, mapping: { fields: entry.fields||{} }, columns: columnsArr };
                if (mapTool && mapTool.id) payload.mapping_tool_id = Number(mapTool.id);
                if (hdrMapVer) payload.mapping_version = Number(hdrMapVer);
                await fetch('/api/grabbing-sensorex/table-settings/batch', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
              } catch {}
            } catch (e) { setMapMsg(String(e?.message||e)); }
          }}>Add Table</button>
          {/* Remove Table */}
          <select className="border rounded px-2 py-1 text-xs" value={removeTableName} onChange={e=>setRemoveTableName(String(e.target.value||''))}>
            <option value="">Select table to remove</option>
            {(() => {
              try {
                const arr = Array.isArray(schemaTables) && schemaTables.length ? schemaTables : Object.keys(schema||{});
                return arr.slice().sort((a,b)=>String(a).localeCompare(String(b))).map(n => (<option key={n} value={n}>{n}</option>));
              } catch { return null; }
            })()}
          </select>
          <button className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-50" onClick={async ()=>{
            try {
              const t = String(removeTableName||'').trim().toLowerCase();
              if (!t) { setMapMsg('Select a table to remove'); return; }
              if (!confirm(`Remove table ${t} from settings?`)) return;
              const body = { domain: (hdrDomain || activeDomain), page_type: (hdrType || mapType || 'product'), table_name: t };
              if (mapTool && mapTool.id) body.mapping_tool_id = Number(mapTool.id);
              if (hdrMapVer) body.mapping_version = Number(hdrMapVer);
              const r = await fetch('/api/grabbing-sensorex/table-settings/remove', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
              const ct = r.headers?.get?.('content-type')||''; let j=null; if (ct.includes('application/json')) { try { j = await r.json(); } catch {} }
              if (!r.ok || (j && j.ok===false)) { setMapMsg(String((j && (j.message||j.error)) || `remove_failed (${r.status})`)); return; }
              // Update local state: list, schema, and mapping JSON
              try { if (typeof setSchemaTables==='function' && Array.isArray(schemaTables)) setSchemaTables(schemaTables.filter(x=>String(x).toLowerCase()!==t)); } catch {}
              try { if (schema && schema[t]) delete schema[t]; } catch {}
              try { let obj = {}; try { obj = mapText ? JSON.parse(mapText) : {}; } catch {}; if (obj?.tables && typeof obj.tables==='object' && obj.tables[t]) { delete obj.tables[t]; setMapText(JSON.stringify(obj, null, 2)); } } catch {}
              setRemoveTableName('');
              setMapMsg(`Removed table ${t}`);
            } catch (e) { setMapMsg(String(e?.message||e)); }
          }}>Remove Table</button>
        </div>
      </div>
      {/* Defer editor component to avoid top-level evaluation ordering issues */}
      <React.Suspense fallback={null}>
        {/* No-op render to warm chunk for editor at mount */}
      </React.Suspense>
    </>
  );
}
