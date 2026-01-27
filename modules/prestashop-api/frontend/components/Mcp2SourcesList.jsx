import { useEffect, useState } from 'react';

export default function Mcp2SourcesList({ endpoint = '/api/prestashop-api/mcp2/sources', title = 'Discovered MCP2 Sources', onUse = null, useLabel = 'Use' }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true); setMsg('');
    try {
      const r = await fetch(endpoint, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'load_failed');
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) { setMsg(String(e?.message || e)); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [endpoint]);

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-sm font-medium text-gray-900 mb-2">{title}</div>
      {msg && <div className="text-xs text-red-600 mb-2">{msg}</div>}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Module</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">HTTP</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stream/SSE</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td className="px-3 py-2 text-sm text-gray-500" colSpan={5}>Loading…</td></tr>
            ) : items.length ? items.map((it) => (
              <tr key={it.id}>
                <td className="px-3 py-2 text-sm text-gray-900">{it.name || it.id}</td>
                <td className="px-3 py-2 text-sm text-gray-900">{
                  (()=>{ try { const o = typeof it.options === 'string' ? JSON.parse(it.options) : (it.options||{}); return o.origin_module || o.module || (it.type_code || '—'); } catch { return it.type_code || '—'; } })()
                }</td>
                <td className="px-3 py-2 text-xs text-blue-700 break-all">
                  {it.http_base ? <a className="underline" href={it.http_base} target="_blank" rel="noreferrer">{it.http_base}</a> : '—'}
                </td>
                <td className="px-3 py-2 text-xs break-all">
                  <div>{it.stream_url ? <a className="underline text-blue-700" href={it.stream_url} target="_blank" rel="noreferrer">stream</a> : '—'}</div>
                  <div>{it.sse_url ? <a className="underline text-blue-700" href={it.sse_url} target="_blank" rel="noreferrer">sse</a> : '—'}</div>
                </td>
                <td className="px-3 py-2 text-right text-xs space-x-2">
                  {onUse && (
                    <button onClick={() => onUse(it)} className="rounded bg-blue-600 text-white px-2 py-1">{useLabel}</button>
                  )}
                  <a className="rounded bg-gray-100 px-2 py-1" href="#/modules/mcp2" title="Open MCP2">Open MCP2</a>
                </td>
              </tr>
            )) : (
              <tr><td className="px-3 py-2 text-sm text-gray-500" colSpan={5}>No sources found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
