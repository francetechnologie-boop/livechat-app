import React from 'react';

export default function UpsertSummaryPanel({ ctx }) {
  const { runs = [], runPid, setRunPid, activeDomain } = ctx || {};
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [items, setItems] = React.useState([]);
  const [table, setTable] = React.useState('');
  const [limit, setLimit] = React.useState(1000);
  const latestRunId = React.useMemo(() => {
    try { return runs && runs.length ? (runs[0].id || runs[0].run_id || 0) : 0; } catch { return 0; }
  }, [runs]);
  const [runId, setRunId] = React.useState(() => latestRunId || runPid || 0);
  React.useEffect(() => { if (!runId && latestRunId) setRunId(latestRunId); }, [latestRunId]);

  const refresh = async () => {
    try {
      setBusy(true); setMsg(''); setItems([]);
      if (!runId) { setMsg('Select a run'); setBusy(false); return; }
      const p = new URLSearchParams(); p.set('run_id', String(runId));
      if (table && table.trim()) p.set('table', table.trim());
      if (limit) p.set('limit', String(limit));
      const r = await fetch(`/api/grabbing-sensorex/upsert-summary?${p.toString()}`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setMsg(String(j?.message||j?.error||r.status)); setItems([]); }
      else { setItems(Array.isArray(j.items)? j.items: []); setMsg(`Loaded ${Array.isArray(j.items)? j.items.length: 0} rows`); }
    } catch (e) { setMsg(String(e?.message||e)); setItems([]); }
    finally { setBusy(false); }
  };

  const runOptions = React.useMemo(() => {
    try { return (runs||[]).map(r => ({ id: r.id || r.run_id, label: `${r.id || r.run_id} – ${r.domain || ''} – ${r.page_type || ''}` })); } catch { return []; }
  }, [runs]);

  return (
    <div className="panel order-4">
      <div className="panel__header flex items-center justify-between">
        <span>Upsert Summary</span>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div>Inspect per-field writes for a run</div>
        </div>
      </div>
      <div className="panel__body space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <label className="inline-flex items-center gap-1">
            Run
            <select className="border rounded px-2 py-1" value={runId||0} onChange={(e)=>setRunId(Number(e.target.value||0))}>
              <option value={0}>– choose –</option>
              {runOptions.map(o => (<option key={o.id} value={o.id}>{o.label}</option>))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1">
            Table
            <input className="border rounded px-2 py-1 w-64" placeholder="ps_product_lang" value={table} onChange={(e)=>setTable(e.target.value)} />
          </label>
          <label className="inline-flex items-center gap-1">
            Limit
            <input className="border rounded px-2 py-1 w-20" value={limit} onChange={(e)=>setLimit(Number(e.target.value||1000))} />
          </label>
          <button className="px-2 py-1 border rounded bg-white disabled:opacity-60" disabled={busy || !runId} onClick={refresh}>{busy? 'Loading…' : 'Load'}</button>
          {msg ? <span className="text-xs text-gray-600">{msg}</span> : null}
        </div>
        <div className="overflow-auto border rounded" style={{ maxHeight: 360 }}>
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1">table</th>
                <th className="text-left px-2 py-1">product</th>
                <th className="text-left px-2 py-1">shop</th>
                <th className="text-left px-2 py-1">lang</th>
                <th className="text-left px-2 py-1">field</th>
                <th className="text-left px-2 py-1">value</th>
                <th className="text-left px-2 py-1">time</th>
              </tr>
            </thead>
            <tbody>
              {(items||[]).map((r,i) => (
                <tr key={i} className={i%2? 'bg-white':'bg-gray-50'}>
                  <td className="px-2 py-1 font-mono">{r.table_name}</td>
                  <td className="px-2 py-1">{r.product_id ?? ''}</td>
                  <td className="px-2 py-1">{r.id_shop ?? ''}</td>
                  <td className="px-2 py-1">{r.id_lang ?? ''}</td>
                  <td className="px-2 py-1">{r.field}</td>
                  <td className="px-2 py-1 break-all">{String(r.value ?? '')}</td>
                  <td className="px-2 py-1">{r.created_at}</td>
                </tr>
              ))}
              {!items?.length && (
                <tr><td className="px-2 py-2 text-gray-500" colSpan={7}>No rows</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

