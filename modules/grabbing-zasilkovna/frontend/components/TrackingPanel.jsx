import React, { useEffect, useMemo, useState } from 'react';

export default function TrackingPanel({ configs = [], selected = '', setSelected }) {
  const [trackBusy, setTrackBusy] = useState(false);
  const [trackMsg, setTrackMsg] = useState('');
  const [trackRes, setTrackRes] = useState(null);
  const [trackOnlyMissing, setTrackOnlyMissing] = useState(true);
  const [trackLimit, setTrackLimit] = useState(200);
  const [trackingPreview, setTrackingPreview] = useState([]);
  const [trackingPreviewBusy, setTrackingPreviewBusy] = useState(false);
  const [packetTestId, setPacketTestId] = useState('');
  const [packetTestBusy, setPacketTestBusy] = useState(false);
  const [packetTestMsg, setPacketTestMsg] = useState('');
  const [packetTestRes, setPacketTestRes] = useState(null);
  const [showPacketDebug, setShowPacketDebug] = useState(false);

  const missingExternalCount = useMemo(
    () => trackingPreview.filter((row) => !row.tracking_external_url).length,
    [trackingPreview]
  );
  const firstMissingExternal = useMemo(
    () => trackingPreview.find((row) => !row.tracking_external_url),
    [trackingPreview]
  );

  const loadTrackingPreview = async (opts = {}) => {
    setTrackingPreviewBusy(true);
    try {
      const rawLimit = opts.limit ?? 10;
      const limitValue = Math.max(1, Math.min(200, Number(rawLimit) || 10));
      const onlyMissing = opts.onlyMissing ?? trackOnlyMissing;
      const params = new URLSearchParams();
      params.set('limit', String(limitValue));
      params.set('only_missing', onlyMissing ? '1' : '0');
      const r = await fetch(`/api/grabbing-zasilkovna/tracking/latest?${params.toString()}`, { credentials: 'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setTrackingPreview(Array.isArray(j.rows) ? j.rows : []);
    } catch {}
    finally { setTrackingPreviewBusy(false); }
  };

  useEffect(() => { loadTrackingPreview(); }, []);

  const onUpdateTracking = async () => {
    if (!selected) { setTrackMsg('Select a config first'); return; }
    setTrackBusy(true); setTrackMsg(''); setTrackRes(null);
    try {
      const body = { id: selected, only_missing: !!trackOnlyMissing, limit: Number(trackLimit) || 200 };
      const r = await fetch('/api/grabbing-zasilkovna/tracking/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'tracking_failed');
      setTrackRes(j);
      await loadTrackingPreview({ limit: trackLimit, onlyMissing: trackOnlyMissing });
    } catch (e) { setTrackMsg(String(e?.message || e)); }
    finally { setTrackBusy(false); }
  };

  const onTestTracking = async () => {
    if (!selected) { setPacketTestMsg('Select a config first'); return; }
    if (!packetTestId.trim()) { setPacketTestMsg('Enter a packet_id'); return; }
    setPacketTestBusy(true); setPacketTestMsg(''); setPacketTestRes(null);
    try {
      const body = { id: selected, packet_id: packetTestId.trim() };
      const r = await fetch('/api/grabbing-zasilkovna/tracking/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'test_failed');
      setPacketTestRes(j);
      setShowPacketDebug(false);
    } catch (e) { setPacketTestMsg(String(e?.message || e)); }
    finally { setPacketTestBusy(false); }
  };

  return (
    <div className="panel">
      <div className="panel__header">Step 3 — Populate Tracking Links</div>
      <div className="panel__body space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs block mb-1">Config</label>
            <select className="w-full border rounded px-2 py-1 text-sm" value={selected} onChange={(e)=>setSelected?.(e.target.value)}>
              {(configs || []).map(c => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs block mb-1">Limit</label>
            <input className="w-full border rounded px-2 py-1 text-sm" type="number" min={1} value={trackLimit} onChange={(e)=>setTrackLimit(e.target.value)} />
          </div>
          <div className="flex items-end gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={trackOnlyMissing} onChange={(e)=>setTrackOnlyMissing(!!e.target.checked)} /> Only missing links
            </label>
            <button onClick={onUpdateTracking} disabled={trackBusy || !selected} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60">
              {trackBusy ? 'Updating…' : 'Update Tracking'}
            </button>
          </div>
        </div>
        {trackMsg && <div className="text-sm text-red-600">{trackMsg}</div>}
        {trackRes && (
          <div className="text-xs">Updated: packeta={trackRes.updated_packeta} external={trackRes.updated_external} skipped={trackRes.skipped} failed={trackRes.failed} (total={trackRes.total})</div>
        )}

        <div className="border-t my-2" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-xs block mb-1">Test packet_id</label>
            <input className="w-full border rounded px-2 py-1 text-sm" placeholder="e.g. 6A04282738354" value={packetTestId} onChange={(e)=>setPacketTestId(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button onClick={onTestTracking} disabled={packetTestBusy || !selected} className="px-3 py-1.5 rounded border text-sm disabled:opacity-60">
              {packetTestBusy ? 'Testing…' : 'Test Packet'}
            </button>
          </div>
          <div className="text-xs text-gray-500 flex items-end">
            Returns Packeta tracking URL and an external URL from the API (if API password is set in the selected config).
          </div>
        </div>
        {packetTestMsg && <div className="text-sm text-red-600">{packetTestMsg}</div>}
        {packetTestRes && (
          <div className="text-xs space-y-2">
            <div>packet_id: <span className="font-mono">{packetTestRes.packet_id}</span></div>
            <div>packeta URL: {packetTestRes.url_packeta ? <a className="text-indigo-600 hover:underline" href={packetTestRes.url_packeta} target="_blank" rel="noreferrer">{packetTestRes.url_packeta}</a> : <em>n/a</em>}</div>
            <div>external URL: {packetTestRes.url_external ? <a className="text-indigo-600 hover:underline" href={packetTestRes.url_external} target="_blank" rel="noreferrer">{packetTestRes.url_external}</a> : <em>n/a</em>}</div>
            {(packetTestRes.debug?.attempts?.length > 0) && (
              <div className="mt-2">
                <button type="button" onClick={()=>setShowPacketDebug(s=>!s)} className="px-2 py-1 border rounded text-[11px]">
                  {showPacketDebug ? 'Hide API debug' : 'Show API debug'}
                </button>
                {showPacketDebug && (
                  <div className="mt-2 border rounded bg-gray-50 max-h-64 overflow-auto p-2 space-y-2">
                    {packetTestRes.debug.attempts.map((a, idx)=> (
                      <div key={idx} className="border-b last:border-b-0 pb-2">
                        <div><span className="font-medium">{a.kind?.toUpperCase()}</span> → <span className="font-mono break-all">{a.url}</span></div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                          <div>
                            <div className="text-[11px] text-gray-600">Request ({a.request?.contentType || '?'})</div>
                            <pre className="text-[11px] whitespace-pre-wrap break-words bg-white border rounded p-2">{typeof a.request?.body === 'object' ? JSON.stringify(a.request.body, null, 2) : String(a.request?.body || '')}</pre>
                          </div>
                          <div>
                            <div className="text-[11px] text-gray-600">Response (status {String(a.response?.status)} {a.response?.ok ? 'ok' : 'fail'})</div>
                            <pre className="text-[11px] whitespace-pre-wrap break-words bg-white border rounded p-2">{String(a.response?.body || '')}</pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="rounded border border-gray-200 bg-white p-3 text-[11px] space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Live tracking preview</div>
            <button
              type="button"
              onClick={()=>loadTrackingPreview({ limit: trackLimit, onlyMissing: trackOnlyMissing })}
              disabled={trackingPreviewBusy}
              className="text-indigo-600 hover:text-indigo-700 text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {trackingPreviewBusy ? 'Refreshing...' : 'Refresh records'}
            </button>
          </div>
          <div className="max-h-64 overflow-auto">
            {trackingPreview.length === 0 ? (
              <div className="text-gray-500">{trackingPreviewBusy ? 'Loading latest rows...' : 'No recent rows matched the preview filter.'}</div>
            ) : (
              <table className="w-full text-[11px] border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="px-2 py-1 border-b border-gray-200">Name</th>
                    <th className="px-2 py-1 border-b border-gray-200">Submission</th>
                    <th className="px-2 py-1 border-b border-gray-200">Order</th>
                    <th className="px-2 py-1 border-b border-gray-200">Packet</th>
                    <th className="px-2 py-1 border-b border-gray-200">Courier TN</th>
                    <th className="px-2 py-1 border-b border-gray-200 text-center">Packeta</th>
                    <th className="px-2 py-1 border-b border-gray-200 text-center">External</th>
                  </tr>
                </thead>
                <tbody>
                  {trackingPreview.map((row, idx) => (
                    <tr key={`${row.order_raw || 'row'}-${row.packet_id || idx}-${idx}`} className="odd:bg-gray-50">
                      <td className="px-2 py-1 border-b border-gray-100 font-semibold text-[11px] break-words">{row.name || '-'}</td>
                      <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{row.submission_number || '-'}</td>
                      <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{row.order_raw || '-'}</td>
                      <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{row.packet_id || '-'}</td>
                      <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{row.courier_tracking_number || '-'}</td>
                      <td className="px-2 py-1 border-b border-gray-100 text-[11px]">
                        {row.tracking_packeta_url ? (
                          <a href={row.tracking_packeta_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700 block break-all" title={row.tracking_packeta_url}>
                            {row.tracking_packeta_url}
                          </a>
                        ) : (
                          <span className="text-red-600 font-semibold">Missing</span>
                        )}
                      </td>
                      <td className="px-2 py-1 border-b border-gray-100 text-[11px]">
                        {row.tracking_external_url ? (
                          <a href={row.tracking_external_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700 block break-all" title={row.tracking_external_url}>
                            {row.tracking_external_url}
                          </a>
                        ) : (
                          <span className="text-red-600 font-semibold">Missing</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {missingExternalCount > 0 && (
            <div className="text-[11px] text-red-600 font-semibold">
              Missing external tracking URL for {missingExternalCount} record{missingExternalCount === 1 ? '' : 's'}. {firstMissingExternal ? `First missing row = ${firstMissingExternal.order_raw || firstMissingExternal.packet_id || 'unknown'}.` : ''}
            </div>
          )}
        </div>
        <div className="text-xs text-gray-500">Packeta URL is built as https://tracking.packeta.com/cs/?id=PACKET_ID. External link is fetched via Zasilkovna SOAP packetInfo().</div>
      </div>
    </div>
  );
}
