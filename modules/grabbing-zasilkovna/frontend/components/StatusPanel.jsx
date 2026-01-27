import React, { useEffect, useMemo, useState } from 'react';

export default function StatusPanel({ configs = [], selected = '', setSelected }) {
  const [packetId, setPacketId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState(null);
  const [showDebug, setShowDebug] = useState(false);

  const [latestBusy, setLatestBusy] = useState(false);
  const [latestRows, setLatestRows] = useState([]);

  const [batchBusy, setBatchBusy] = useState(false);
  const [batchMsg, setBatchMsg] = useState('');
  const [batchRes, setBatchRes] = useState(null);
  const [batchLimit, setBatchLimit] = useState(50);
  const [batchConcurrency, setBatchConcurrency] = useState(3);
  const [batchOnlyMissing, setBatchOnlyMissing] = useState(true);
  const [batchOrgId, setBatchOrgId] = useState('');

  const effectivePacketId = useMemo(() => packetId.trim(), [packetId]);

  const loadLatest = async (opts = {}) => {
    setLatestBusy(true);
    try {
      const rawLimit = opts.limit ?? 25;
      const limitValue = Math.max(1, Math.min(200, Number(rawLimit) || 25));
      const params = new URLSearchParams();
      params.set('limit', String(limitValue));
      const pid = (opts.packetId ?? effectivePacketId).trim();
      if (pid) params.set('packet_id', pid);
      const r = await fetch(`/api/grabbing-zasilkovna/status/latest?${params.toString()}`, { credentials: 'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setLatestRows(Array.isArray(j.rows) ? j.rows : []);
    } catch {}
    finally { setLatestBusy(false); }
  };

  useEffect(() => { loadLatest(); }, []);

  const onFetch = async () => {
    if (!selected) { setMsg('Select a config first'); return; }
    if (!effectivePacketId) { setMsg('Enter packet_id'); return; }
    setBusy(true); setMsg(''); setResult(null);
    try {
      const body = { id: selected, packet_id: effectivePacketId };
      const r = await fetch('/api/grabbing-zasilkovna/status/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'status_failed');
      setResult(j);
      setShowDebug(false);
      await loadLatest({ packetId: effectivePacketId, limit: 50 });
    } catch (e) { setMsg(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const runBatchOnce = async () => {
    if (!selected) { setBatchMsg('Select a config first'); return null; }
    setBatchBusy(true); setBatchMsg(''); setBatchRes(null);
    try {
      const body = {
        id: selected,
        limit: Number(batchLimit) || 50,
        concurrency: Number(batchConcurrency) || 3,
        only_missing: !!batchOnlyMissing,
      };
      if (batchOrgId.trim()) body.org_id = batchOrgId.trim();
      const r = await fetch('/api/grabbing-zasilkovna/status/fetch-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'batch_failed');
      setBatchRes(j);
      await loadLatest({ packetId: '', limit: 50 });
      return j;
    } catch (e) {
      setBatchMsg(String(e?.message || e));
      return null;
    } finally {
      setBatchBusy(false);
    }
  };

  const runBatchAll = async () => {
    if (!selected) { setBatchMsg('Select a config first'); return; }
    setBatchBusy(true); setBatchMsg(''); setBatchRes(null);
    try {
      let loops = 0;
      let aggStored = 0, aggFailed = 0, aggTotal = 0;
      let last = null;
      while (loops < 25) {
        loops++;
        const body = {
          id: selected,
          limit: Number(batchLimit) || 50,
          concurrency: Number(batchConcurrency) || 3,
          only_missing: !!batchOnlyMissing,
        };
        if (batchOrgId.trim()) body.org_id = batchOrgId.trim();
        const r = await fetch('/api/grabbing-zasilkovna/status/fetch-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'batch_failed');
        last = j;
        aggStored += Number(j.stored || 0);
        aggFailed += Number(j.failed || 0);
        aggTotal += Number(j.total || 0);
        setBatchRes({ ...j, loops, agg: { total: aggTotal, stored: aggStored, failed: aggFailed } });
        await loadLatest({ packetId: '', limit: 50 });
        if (j.has_more === false || Number(j.total || 0) === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (last && last.has_more) setBatchMsg('Stopped after 25 batches (safety limit). Increase limit or run again.');
    } catch (e) {
      setBatchMsg(String(e?.message || e));
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel__header">Step 4 — Fetch Packet Status</div>
      <div className="panel__body space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs block mb-1">Config</label>
            <select className="w-full border rounded px-2 py-1 text-sm" value={selected} onChange={(e)=>setSelected?.(e.target.value)}>
              {(configs || []).map(c => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs block mb-1">packet_id</label>
            <input className="w-full border rounded px-2 py-1 text-sm font-mono" placeholder="e.g. 3823595552" value={packetId} onChange={(e)=>setPacketId(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button onClick={onFetch} disabled={busy || !selected} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60">
              {busy ? 'Fetching…' : 'Fetch Status'}
            </button>
          </div>
        </div>

        {msg && <div className="text-sm text-red-600">{msg}</div>}

        {result?.ok && (
          <div className="rounded border bg-white p-3 text-[12px] space-y-1">
            <div className="font-semibold">Result</div>
            <div>packet_id: <span className="font-mono">{result.packet_id}</span></div>
            <div>status_text: <span className="font-mono">{result.status?.status_text || '-'}</span></div>
            <div>status_code: <span className="font-mono">{result.status?.status_code || '-'}</span></div>
            <div>code_text: <span className="font-mono">{result.status?.code_text || '-'}</span></div>
            <div>date_time: <span className="font-mono">{result.status?.date_time || '-'}</span></div>
            <div>stored_id: <span className="font-mono">{String(result.stored?.id || '-') }</span></div>
            {(result.debug?.attempts?.length > 0) && (
              <div className="pt-2">
                <button type="button" onClick={()=>setShowDebug(s=>!s)} className="px-2 py-1 border rounded text-[11px]">
                  {showDebug ? 'Hide API debug' : 'Show API debug'}
                </button>
                {showDebug && (
                  <pre className="mt-2 text-[11px] whitespace-pre-wrap break-words bg-gray-50 border rounded p-2 max-h-64 overflow-auto">{JSON.stringify(result.debug, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        )}

        <div className="border-t my-2" />

        <div className="rounded border border-gray-200 bg-white p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bulk status check (from mod_grabbing_zasilkovna)</div>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs block mb-1">Limit</label>
              <input className="w-full border rounded px-2 py-1 text-sm" type="number" min={1} max={500} value={batchLimit} onChange={(e)=>setBatchLimit(e.target.value)} />
            </div>
            <div>
              <label className="text-xs block mb-1">Concurrency</label>
              <input className="w-full border rounded px-2 py-1 text-sm" type="number" min={1} max={10} value={batchConcurrency} onChange={(e)=>setBatchConcurrency(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={batchOnlyMissing} onChange={(e)=>setBatchOnlyMissing(!!e.target.checked)} /> Only missing (skip already stored)
              </label>
            </div>
            <div>
              <label className="text-xs block mb-1">org_id (optional)</label>
              <input className="w-full border rounded px-2 py-1 text-sm" placeholder="e.g. company-1" value={batchOrgId} onChange={(e)=>setBatchOrgId(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={runBatchOnce} disabled={batchBusy || !selected} className="px-3 py-1.5 rounded border text-sm disabled:opacity-60">
              {batchBusy ? 'Running…' : 'Fetch Next Batch'}
            </button>
            <button onClick={runBatchAll} disabled={batchBusy || !selected} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60">
              {batchBusy ? 'Running…' : 'Fetch All (loop)'}
            </button>
          </div>
          {batchMsg && <div className="text-sm text-red-600">{batchMsg}</div>}
          {batchRes && (
            <div className="text-xs text-gray-700">
              Batch: total={batchRes.total} stored={batchRes.stored} failed={batchRes.failed} skipped={batchRes.skipped}
              {typeof batchRes.todo_total === 'number' ? ` todo_total=${batchRes.todo_total}` : ''}
              {batchRes.has_more === true ? ' has_more=true' : (batchRes.has_more === false ? ' has_more=false' : '')}
              {batchRes.agg ? ` | agg total=${batchRes.agg.total} stored=${batchRes.agg.stored} failed=${batchRes.agg.failed}` : ''}
            </div>
          )}
        </div>

        <div className="rounded border border-gray-200 bg-white p-3 text-[11px] space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Stored snapshots</div>
            <button
              type="button"
              onClick={()=>loadLatest({ packetId: effectivePacketId, limit: 50 })}
              disabled={latestBusy}
              className="text-indigo-600 hover:text-indigo-700 text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {latestBusy ? 'Refreshing...' : 'Refresh list'}
            </button>
          </div>
          <div className="max-h-64 overflow-auto">
            {latestRows.length === 0 ? (
              <div className="text-gray-500">{latestBusy ? 'Loading...' : 'No stored status rows yet.'}</div>
            ) : (
              <table className="w-full text-[11px] border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="px-2 py-1 border-b border-gray-200">created_at</th>
                    <th className="px-2 py-1 border-b border-gray-200">packet_id</th>
                    <th className="px-2 py-1 border-b border-gray-200">status_text</th>
                    <th className="px-2 py-1 border-b border-gray-200">status_code</th>
                    <th className="px-2 py-1 border-b border-gray-200">code_text</th>
                    <th className="px-2 py-1 border-b border-gray-200">status_at</th>
                  </tr>
                </thead>
                <tbody>
                  {latestRows.map((row) => (
                    <tr key={row.id} className="odd:bg-gray-50">
                      <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{String(row.created_at || '-')}</td>
                      <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{String(row.packet_id || '-')}</td>
                      <td className="px-2 py-1 border-b border-gray-100 break-words">{String(row.status_text || '-')}</td>
                      <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{String(row.status_code || '-')}</td>
                      <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{String(row.code_text || '-')}</td>
                      <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{String(row.status_at || '-')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="text-gray-500">Stored in `mod_grabbing_zasilkovna_status` (and view `mod_grabbing_zasilkovna_staus`).</div>
        </div>
      </div>
    </div>
  );
}
