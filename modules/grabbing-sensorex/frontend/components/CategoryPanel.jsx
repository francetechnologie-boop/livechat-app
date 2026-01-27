import React from 'react';

export default function CategoryPanel({ ctx }) {
  const { runs, selectedRuns, reloadRuns, mysqlProfileId, setMysqlProfileId, profiles, profilesBusy } = ctx || {};
  const [busy, setBusy] = React.useState(false);
  const [log, setLog] = React.useState([]);
  const append = (m) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${m}`]);
  const [prefix, setPrefix] = React.useState('ps_');
  const [idLang, setIdLang] = React.useState('');
  const [filterPid, setFilterPid] = React.useState('');
  const [tableRows, setTableRows] = React.useState([]);
  const prof = React.useMemo(() => {
    try { return (Array.isArray(profiles)? profiles: []).find(p => Number(p.id) === Number(mysqlProfileId)) || null; } catch { return null; }
  }, [profiles, mysqlProfileId]);

  const loadExtractList = React.useCallback(async () => {
    try {
      setBusy(true);
      append('Refreshing extract table…');
      const p = new URLSearchParams();
      if (String(filterPid||'').trim()!=='') p.set('product_id', String(Number(filterPid)||0));
      p.set('limit','500');
      const r = await fetch(`/api/grabbing-sensorex/category/extract?${p.toString()}`, { credentials:'include' });
      const ct = r.headers?.get?.('content-type')||'';
      if (!ct.includes('application/json')) { setTableRows([]); append(`list_failed non_json_${r.status}`); return; }
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setTableRows([]); append(`list_failed ${String(j?.message||j?.error||r.status)}`); return; }
      setTableRows(Array.isArray(j.items)? j.items : []);
      append(`Loaded ${j?.count||0} row(s)`);
    } catch (e) { setTableRows([]); append(`list_error ${String(e?.message||e)}`); }
    finally { setBusy(false); }
  }, [filterPid]);

  const selectedList = React.useMemo(() => {
    const ids = Object.keys(selectedRuns||{}).map(n=>Number(n)||0).filter(n=>n>0);
    const map = new Map(); for (const r of (runs||[])) map.set(Number(r.id)||0, r);
    return ids.map(id => ({ id, product_id: map.get(id)?.product_id ?? null }));
  }, [runs, selectedRuns]);

  return (
    <div className="panel order-5">
      <div className="panel__header flex items-center justify-between">
        <span>Step 5: Category</span>
      </div>
      <div className="panel__body space-y-3">
        <div className="text-xs text-gray-600">Extracts the product category from the run result and stores it to mod_grabbing_sensorex_category_extract.</div>
        <div className="text-xs text-gray-700">
          {mysqlProfileId ? (
            <span>Using MySQL profile: <span className="font-mono">#{mysqlProfileId}</span>{prof?.name? ` – ${prof.name}`:''}{prof?.host? ` @ ${prof.host}`:''}{prof?.database? `/${prof.database}`:''}</span>
          ) : (
            <span className="text-red-600">No MySQL profile selected.</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs">MySQL profile
            <select
              className="ml-1 border rounded px-2 py-0.5 text-xs min-w-[12rem]"
              value={String(mysqlProfileId || '')}
              onChange={(e)=>{ const v = Number(e.target.value||0)||0; try { if (typeof setMysqlProfileId==='function') setMysqlProfileId(v); } catch {} }}
            >
              <option value="">(select)</option>
              {(Array.isArray(profiles)? profiles: []).map(p => (
                <option key={p.id} value={String(p.id)}>{p.name ? `${p.name}` : `#${p.id}`}</option>
              ))}
            </select>
            {profilesBusy ? <span className="ml-1 text-[11px] text-gray-500">loading…</span> : null}
          </label>
          <label className="text-xs">Presta prefix
            <input className="ml-1 border rounded px-2 py-0.5 text-xs w-24" value={prefix} onChange={(e)=>setPrefix(e.target.value)} placeholder="ps_" />
          </label>
          <label className="text-xs">id_lang (optional)
            <input className="ml-1 border rounded px-2 py-0.5 text-xs w-20" value={idLang} onChange={(e)=>setIdLang(e.target.value)} placeholder="" />
          </label>
          <button className="px-2 py-1 rounded border text-xs disabled:opacity-60"
            disabled={busy || !mysqlProfileId}
            title={!mysqlProfileId ? 'Select MySQL profile in Step 3' : 'Map category names to Presta id_category'}
            onClick={async ()=>{
              try {
                setBusy(true);
                append(`Mapping to Presta id_category… (profile #${mysqlProfileId || '-'}${prof?.name? ` ${prof.name}`:''})`);
                const body = { profile_id: mysqlProfileId, prefix: prefix||'ps_' };
                if (String(idLang||'').trim()!=='') body.id_lang = Number(idLang)||0;
                const resp = await fetch('/api/grabbing-sensorex/category/map-presta', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const j = await resp.json().catch(()=>null);
                if (!resp.ok || (j && j.ok===false)) { append(`Failed: ${String((j && (j.message||j.error)) || resp.status)}`); return; }
                append(`Mapped: ${j?.updated||0} updated, ${j?.unmatched||0} unmatched.`);
                await loadExtractList();
              } catch (e) { append(`Error: ${String(e?.message||e)}`); }
              finally { setBusy(false); }
            }}
          >Map to Presta IDs</button>
          <button className="px-2 py-1 rounded border text-xs disabled:opacity-60"
            disabled={busy || !mysqlProfileId}
            title={!mysqlProfileId ? 'Select MySQL profile in Step 3' : 'Upsert ps_category_product and set default category'}
            onClick={async ()=>{
              try {
                setBusy(true);
                append(`Applying to Presta (category_product + default)… (profile #${mysqlProfileId || '-'}${prof?.name? ` ${prof.name}`:''})`);
                const body = { profile_id: mysqlProfileId, prefix: prefix||'ps_', domain: ctx?.activeDomain||'', page_type: ctx?.mapType||'product' };
                if (String(filterPid||'').trim()!=='') body.product_ids = [Number(filterPid)||0];
                const resp = await fetch('/api/grabbing-sensorex/category/apply-presta', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const j = await resp.json().catch(()=>null);
                if (!resp.ok || (j && j.ok===false)) { append(`Apply failed: ${String((j && (j.message||j.error)) || resp.status)}`); return; }
                append(`Applied: linked=${j?.linked||0}, defaultsSet=${j?.defaultsSet||0}, missing=${j?.missing||0}, products=${j?.products||0}`);
                await loadExtractList();
              } catch (e) { append(`Apply error: ${String(e?.message||e)}`); }
              finally { setBusy(false); }
            }}
          >Apply to Presta</button>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 rounded border text-xs disabled:opacity-60"
            disabled={busy}
            title="Clear and refill the category extract table from history"
            onClick={async ()=>{
              try {
                setBusy(true); setLog([]);
                append('Rebuilding category table (clear + refill)…');
            const body = { domain: ctx?.activeDomain || '', page_type: ctx?.mapType || 'product' };
            if (mysqlProfileId) body.profile_id = mysqlProfileId;
            if (prefix) body.prefix = prefix;
            if (String(idLang||'').trim()!=='') body.id_lang = Number(idLang)||0;
            const resp = await fetch('/api/grabbing-sensorex/category/rebuild', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
            const j = await resp.json().catch(()=>null);
            if (!resp.ok || (j && j.ok===false)) { append(`Failed: ${String((j && (j.message||j.error)) || resp.status)}`); return; }
            append(`Done. Total runs scanned: ${j?.total||0}, rows inserted: ${j?.inserted||0}, mapped: ${j?.updated||0}, unmatched: ${j?.unmatched||0}`);
              } catch (e) { append(`Error: ${String(e?.message||e)}`); }
              finally { setBusy(false); try { if (typeof reloadRuns==='function') await reloadRuns(); } catch {} }
            }}
          >Rebuild (clear + refill)</button>

          <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={busy || !selectedList.length}
            onClick={async ()=>{
              try {
                setBusy(true);
                const conc = 3; let active=0, i=0; const arr = selectedList.slice();
                await new Promise((resolve)=>{
                  const pump = ()=>{
                    while (active<conc && i<arr.length) {
                      const it = arr[i++]; active++;
                      (async ()=>{
                        try {
                          append(`Run ${it.id}: extracting…`);
                          const body = { run_id: it.id }; if (it.product_id != null) body.product_id = it.product_id;
                          const resp = await fetch('/api/grabbing-sensorex/category/extract', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                          const j = await resp.json().catch(()=>null);
                          if (!resp.ok || (j && j.ok===false)) append(`Run ${it.id}: failed – ${(j && (j.message||j.error)) || resp.status}`);
                          else append(`Run ${it.id}: OK – category "${j?.category||''}" (product_id=${j?.product_id||''})`);
                        } catch (e) { append(`Run ${it.id}: error – ${String(e?.message||e)}`); }
                        finally { active--; if (i<arr.length) pump(); else if (active===0) resolve(); }
                      })();
                    }
                  };
                  pump();
                });
              } finally {
                setBusy(false);
                try { if (typeof reloadRuns==='function') await reloadRuns(); } catch {}
              }
            }}>Get category for selected</button>
          <span className="text-xs text-gray-500">Selected: {selectedList.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs">Filter by product_id
            <input className="ml-1 border rounded px-2 py-0.5 text-xs w-28" value={filterPid} onChange={(e)=>setFilterPid(e.target.value)} placeholder="e.g. 4607" />
          </label>
          <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={busy} onClick={loadExtractList}>List extract table</button>
        </div>
        {tableRows.length>0 && (
          <div className="border rounded p-2 bg-white">
            <div className="text-xs font-semibold mb-1">Extract table ({tableRows.length})</div>
            <div className="max-h-64 overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left">product_id</th>
                    <th className="px-2 py-1 text-left">category</th>
                    <th className="px-2 py-1 text-left">id_category</th>
                    <th className="px-2 py-1 text-left">id_categories</th>
                    <th className="px-2 py-1 text-left">created_at</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="px-2 py-1">{row.product_id}</td>
                      <td className="px-2 py-1">{row.category}</td>
                      <td className="px-2 py-1">{row.id_category == null ? '' : String(row.id_category)}</td>
                      <td className="px-2 py-1 font-mono">{Array.isArray(row.id_categories) ? row.id_categories.join(',') : ''}</td>
                      <td className="px-2 py-1">{row.created_at ? new Date(row.created_at).toLocaleString() : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="border rounded p-2 bg-gray-50 text-[11px] h-48 overflow-auto whitespace-pre-wrap">{log.join('\n') || 'No activity yet.'}</div>
      </div>
    </div>
  );
}
