import React from 'react';

export default function RunErrorsPanel({ ctx }) {
  const { activeDomain, mapType } = ctx || {};
  const [filters, setFilters] = React.useState({ run_id: '', table_name: '', id_shop: '', id_lang: '', domain: '', page_type: '' });
  const [busy, setBusy] = React.useState(false);
  const [items, setItems] = React.useState([]);
  const [limit, setLimit] = React.useState(100);
  const [offset, setOffset] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [summary, setSummary] = React.useState({ per_table: [], per_op: [], latest: [] });

  React.useEffect(() => {
    // default domain + page_type from context for convenience
    setFilters(prev => ({ ...prev, domain: activeDomain || '', page_type: (mapType||'product') }));
  }, [activeDomain, mapType]);

  const loadErrors = React.useCallback(async (opts={}) => {
    setBusy(true);
    try {
      const q = new URLSearchParams();
      const f = { ...filters, ...opts };
      if (String(f.run_id||'').trim()) q.set('run_id', String(f.run_id).trim());
      if (String(f.table_name||'').trim()) q.set('table_name', String(f.table_name).trim());
      if (String(f.id_shop||'').trim()) q.set('id_shop', String(f.id_shop).trim());
      if (String(f.id_lang||'').trim()) q.set('id_lang', String(f.id_lang).trim());
      if (String(f.domain||'').trim()) q.set('domain', String(f.domain).trim());
      if (String(f.page_type||'').trim()) q.set('page_type', String(f.page_type).trim());
      q.set('limit', String(limit));
      q.set('offset', String(offset));
      const r = await fetch(`/api/grabbing-jerome/admin/runs/errors?${q.toString()}`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||r.status));
      setItems(Array.isArray(j.items) ? j.items : []);
      setTotal(Number(j.count||0)||0);
    } catch (e) {
      alert('Load errors failed: '+String(e?.message||e));
    } finally { setBusy(false); }
  }, [filters, limit, offset]);

  const loadSummary = React.useCallback(async () => {
    const runId = Number(String(filters.run_id||'').trim())||0;
    if (!runId) { setSummary({ per_table: [], per_op: [], latest: [] }); return; }
    try {
      const r = await fetch(`/api/grabbing-jerome/admin/runs/summary?run_id=${runId}`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||r.status));
      setSummary({ per_table: j.per_table||[], per_op: j.per_op||[], latest: j.latest||[] });
    } catch (e) { alert('Load summary failed: '+String(e?.message||e)); }
  }, [filters.run_id]);

  return (
    <div className="panel">
      <div className="panel__header flex items-center justify-between">
        <span>Run Errors</span>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div>Browse recent send_to_presta errors (filters optional)</div>
          <button className="px-2 py-1 text-xs border rounded" disabled={busy} onClick={()=>loadErrors()}>Refresh</button>
        </div>
      </div>
      <div className="panel__body space-y-2">
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="inline-flex flex-col">Run ID
            <input className="border rounded px-2 py-1 w-28" value={filters.run_id} onChange={e=>setFilters(prev=>({ ...prev, run_id: e.target.value }))} />
          </label>
          <label className="inline-flex flex-col">Table
            <input className="border rounded px-2 py-1 w-48" placeholder="ps_product_shop" value={filters.table_name} onChange={e=>setFilters(prev=>({ ...prev, table_name: e.target.value }))} />
          </label>
          <label className="inline-flex flex-col">Shop
            <input className="border rounded px-2 py-1 w-20" value={filters.id_shop} onChange={e=>setFilters(prev=>({ ...prev, id_shop: e.target.value }))} />
          </label>
          <label className="inline-flex flex-col">Lang
            <input className="border rounded px-2 py-1 w-20" value={filters.id_lang} onChange={e=>setFilters(prev=>({ ...prev, id_lang: e.target.value }))} />
          </label>
          <label className="inline-flex flex-col">Domain
            <input className="border rounded px-2 py-1 w-56" placeholder="animo-concept.com" value={filters.domain} onChange={e=>setFilters(prev=>({ ...prev, domain: e.target.value }))} />
          </label>
          <label className="inline-flex flex-col">Type
            <input className="border rounded px-2 py-1 w-28" placeholder="product" value={filters.page_type} onChange={e=>setFilters(prev=>({ ...prev, page_type: e.target.value }))} />
          </label>
          <label className="inline-flex flex-col">Limit
            <select className="border rounded px-2 py-1 w-20" value={limit} onChange={e=>setLimit(Number(e.target.value||100))}>
              {[50,100,200,500].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="inline-flex gap-2">
            <button className="px-2 py-1 border rounded bg-white" onClick={()=>{ setOffset(0); loadErrors({ offset: 0 }); }}>Apply</button>
            <button className="px-2 py-1 border rounded bg-white" onClick={()=>{ setFilters({ run_id:'', table_name:'', id_shop:'', id_lang:'', domain: activeDomain||'', page_type: (mapType||'product') }); setOffset(0); setItems([]); }}>Clear</button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button className="px-2 py-1 border rounded bg-white" disabled={offset<=0||busy} onClick={()=>{ const n=Math.max(0, offset-limit); setOffset(n); loadErrors({ offset: n }); }}>Prev</button>
          <button className="px-2 py-1 border rounded bg-white" disabled={offset+items.length>=total||busy} onClick={()=>{ const n=offset+limit; setOffset(n); loadErrors({ offset: n }); }}>Next</button>
          <span className="text-gray-500">{items.length} / {total}</span>
        </div>

        <div className="max-h-72 overflow-auto border rounded">
          <table className="min-w-full text-[11px]">
            <thead className="bg-gray-50 border-b sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left">Time</th>
                <th className="px-2 py-1 text-left">Run</th>
                <th className="px-2 py-1 text-left">Table</th>
                <th className="px-2 py-1 text-left">Op</th>
                <th className="px-2 py-1 text-left">Shop</th>
                <th className="px-2 py-1 text-left">Lang</th>
                <th className="px-2 py-1 text-left">Error</th>
                <th className="px-2 py-1 text-left">Payload</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className="border-b">
                  <td className="px-2 py-1 whitespace-nowrap">{String(it.created_at||'').replace('T',' ').replace('Z','')}</td>
                  <td className="px-2 py-1">{it.run_id}</td>
                  <td className="px-2 py-1 font-mono">{it.table_name}</td>
                  <td className="px-2 py-1">{it.op}</td>
                  <td className="px-2 py-1">{it.id_shop ?? ''}</td>
                  <td className="px-2 py-1">{it.id_lang ?? ''}</td>
                  <td className="px-2 py-1 text-red-700 truncate max-w-[20rem]" title={it.error||''}>{it.error||''}</td>
                  <td className="px-2 py-1">
                    <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>{
                      const w=window.open('','_blank'); if(!w){alert('Popup blocked'); return;}
                      const html = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Error payload #${it.id}</title><style>body{font:12px system-ui;padding:10px} pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:4px;padding:8px}</style></head><body><h3 style=\"margin:0\">Error payload #${it.id}</h3><pre id=\"code\"></pre><script>const data=${JSON.stringify(JSON.stringify(it.payload||{}, null, 2))};document.getElementById('code').textContent=data;</script></body></html>`;
                      w.document.open(); w.document.write(html); w.document.close();
                    }}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold">Summary</div>
            <button className="px-2 py-1 text-xs border rounded" onClick={loadSummary}>Refresh summary</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border rounded">
              <div className="bg-gray-50 text-xs px-2 py-1 border-b">Errors by table</div>
              <table className="min-w-full text-[11px]">
                <thead><tr><th className="px-2 py-1 text-left">Table</th><th className="px-2 py-1 text-left">Errors</th></tr></thead>
                <tbody>
                  {(summary.per_table||[]).map((r,i)=>(<tr key={i} className="border-b"><td className="px-2 py-1 font-mono">{r.table_name}</td><td className="px-2 py-1">{r.errors}</td></tr>))}
                </tbody>
              </table>
            </div>
            <div className="border rounded">
              <div className="bg-gray-50 text-xs px-2 py-1 border-b">Errors by operation</div>
              <table className="min-w-full text-[11px]">
                <thead><tr><th className="px-2 py-1 text-left">Operation</th><th className="px-2 py-1 text-left">Errors</th></tr></thead>
                <tbody>
                  {(summary.per_op||[]).map((r,i)=>(<tr key={i} className="border-b"><td className="px-2 py-1">{r.op}</td><td className="px-2 py-1">{r.errors}</td></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

