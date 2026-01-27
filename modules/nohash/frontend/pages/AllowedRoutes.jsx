import React from 'react';

export default function AllowedRoutes() {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/nohash/list', { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };

  const rebuild = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/nohash/rebuild', { method:'POST', credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };

  React.useEffect(() => { load(); }, []);

  const modules = items.filter(x => x.kind === 'module');
  const pages = items.filter(x => x.kind === 'page');
  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div className="p-4 border-b bg-white font-semibold">Allowed Routes</div>
      <div className="p-4 space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={load} className="px-3 py-1.5 rounded border text-sm">Refresh</button>
          <button onClick={rebuild} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm">Rebuild (admin)</button>
          {loading && <span className="text-xs text-gray-500">Loading…</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
        <div>
          <div className="font-medium mb-2">Modules</div>
          {!modules.length && <div className="text-sm text-gray-500">No modules detected.</div>}
          <ul className="list-disc pl-5 space-y-1">
            {modules.map(it => (
              <li key={it.hash}>
                <a className="text-indigo-600 hover:underline" href={`#/${String(it.hash||'').replace(/^#?/, '')}`}>#/{String(it.hash||'').replace(/^#?/, '')}</a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="font-medium mb-2">Pages</div>
          {!pages.length && <div className="text-sm text-gray-500">No pages detected.</div>}
          <ul className="list-disc pl-5 space-y-1">
            {pages.map(it => (
              <li key={it.hash}>
                <a className="text-indigo-600 hover:underline" href={`#/${String(it.hash||'').replace(/^#?/, '')}`}>#/{String(it.hash||'').replace(/^#?/, '')}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
