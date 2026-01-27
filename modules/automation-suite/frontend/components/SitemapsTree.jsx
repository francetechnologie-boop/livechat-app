import React, { useEffect, useMemo, useState } from "react";

export default function SitemapsTree({ domain, sitemapUrl, initialSelected = [], onSave }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [root, setRoot] = useState(null);
  const [sel, setSel] = useState(() => (initialSelected || []).reduce((acc,u)=>{ acc[u]=true; return acc; }, {}));

  const startUrl = useMemo(() => {
    const u = (sitemapUrl && sitemapUrl.trim()) ? sitemapUrl.trim() : (domain ? `https://${domain}/sitemap_index.xml` : "");
    return u;
  }, [domain, sitemapUrl]);

  useEffect(() => {
    setSel((initialSelected || []).reduce((acc,u)=>{ acc[u]=true; return acc; }, {}));
  }, [initialSelected]);

  const load = async () => {
    if (!startUrl) return;
    setLoading(true); setMsg("");
    try {
      const url = `/api/grabbings/jerome/sitemap/tree?url=${encodeURIComponent(startUrl)}&max_sitemaps=5000`;
      const r = await fetch(url, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setMsg(j?.message||j?.error||'load_failed'); setRoot(null); }
      else setRoot(j.root || null);
    } catch (e) { setMsg(String(e?.message||e)); setRoot(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [startUrl]);

  const toggle = (u, checked) => {
    setSel(prev => { const n = { ...prev }; if (checked) n[u] = true; else delete n[u]; return n; });
  };

  const renderNode = (node, depth = 0) => {
    if (!node) return null;
    const pad = { paddingLeft: `${Math.min(24, depth*12)}px` };
    const u = node.url;
    const isIndex = node.type === 'index';
    const lastmod = node.lastmod || '';
    return (
      <div key={u} className="border-b last:border-0">
        <div className="flex items-center gap-2 px-2 py-1 text-[11px]" style={pad}>
          <input type="checkbox" checked={!!sel[u]} onChange={(e)=> toggle(u, e.target.checked)} />
          <span className={`px-1 rounded border ${isIndex? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>{isIndex? 'INDEX' : 'URLSET'}</span>
          <a className="text-blue-600 underline truncate" href={u} target="_blank" rel="noreferrer" title={u}>{u}</a>
          {!!lastmod && <span className="text-gray-500 ml-auto whitespace-nowrap">{lastmod}</span>}
        </div>
        {Array.isArray(node.children) && node.children.length > 0 && (
          <div>
            {node.children.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const selectedList = useMemo(() => Object.keys(sel||{}).filter(Boolean), [sel]);

  return (
    <div className="border rounded bg-white">
      <div className="flex items-center gap-2 p-2 border-b text-[11px]">
        <div className="font-medium">Sitemaps Tree</div>
        <div className="text-gray-600">{startUrl || ''}</div>
        <div className="ml-auto flex items-center gap-2">
          <button className="px-2 py-0.5 border rounded" onClick={load} disabled={loading}>{loading? 'Loading…' : 'Reload'}</button>
          <button className="px-2 py-0.5 border rounded" onClick={()=> setSel({})}>Clear</button>
          <button className="px-2 py-0.5 border rounded" onClick={()=> {
            // select all visible nodes
            const collect = (n, acc=[]) => { if (!n) return acc; acc.push(n.url); (n.children||[]).forEach(c=>collect(c,acc)); return acc; };
            const all = collect(root, []);
            setSel(all.reduce((acc,u)=>{ acc[u]=true; return acc; }, {}));
          }}>Select all</button>
          <button className="px-2 py-0.5 rounded bg-indigo-600 text-white" disabled={!selectedList.length || loading} onClick={()=> onSave && onSave(selectedList)}>Save selection</button>
        </div>
      </div>
      {!!msg && <div className="px-2 py-1 text-[11px] text-red-600">{msg}</div>}
      <div className="max-h-72 overflow-auto">
        {!root && !loading && <div className="p-2 text-[11px] text-gray-600">No data.</div>}
        {!!root && renderNode(root, 0)}
      </div>
    </div>
  );
}

