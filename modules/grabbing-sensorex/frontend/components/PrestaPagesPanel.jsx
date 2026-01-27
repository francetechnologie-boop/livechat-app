import React from 'react';

export default function PrestaPagesPanel() {
  const [profiles, setProfiles] = React.useState([]);
  const [profileId, setProfileId] = React.useState('');
  const [prefix, setPrefix] = React.useState('ps_');
  const [type, setType] = React.useState('product');
  const [shops, setShops] = React.useState([]);
  const [shopId, setShopId] = React.useState('');
  const [langs, setLangs] = React.useState([]);
  const [langId, setLangId] = React.useState('');
  const [limit, setLimit] = React.useState(3000);
  const [items, setItems] = React.useState([]);
  const [baseUrl, setBaseUrl] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [sortKey, setSortKey] = React.useState('id');
  const [sortDir, setSortDir] = React.useState('asc');
  const [filters, setFilters] = React.useState({ id: '', name: '', reference: '', category: '', link: '' });
  const [activeOnly, setActiveOnly] = React.useState(true);

  React.useEffect(() => { (async ()=>{
    try {
      const r = await fetch('/api/grabbing-sensorex/mysql/profiles?limit=200');
      const j = await r.json(); if (j.ok) setProfiles(j.items||[]);
    } catch {}
  })(); }, []);

  React.useEffect(() => { (async ()=>{
    if (!profileId) { setShops([]); setLangs([]); return; }
    try {
      const ps = await fetch(`/api/grabbing-sensorex/mysql/shops?profile_id=${encodeURIComponent(profileId)}&prefix=${encodeURIComponent(prefix)}`);
      const js = await ps.json(); if (js.ok) setShops(js.items||[]);
    } catch {}
    try {
      const pl = await fetch(`/api/grabbing-sensorex/mysql/langs?profile_id=${encodeURIComponent(profileId)}&prefix=${encodeURIComponent(prefix)}`);
      const jl = await pl.json(); if (jl.ok) setLangs(jl.items||[]);
    } catch {}
  })(); }, [profileId, prefix]);

  async function loadPages() {
    if (!profileId || !shopId || !langId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ profile_id: profileId, type, id_shop: shopId, id_lang: langId, limit: String(limit), prefix });
      if (type === 'product' && activeOnly) qs.set('active_only', '1');
      const r = await fetch(`/api/grabbing-sensorex/mysql/pages?${qs.toString()}`);
      const j = await r.json();
      if (j.ok) { setItems(j.items||[]); setBaseUrl(j.base_url || ''); }
      else alert(j.message || j.error || 'Load failed');
    } catch (e) { alert(String(e)); }
    finally { setLoading(false); }
  }

  function matchText(val, needle) {
    const s = String(needle || '').trim().toLowerCase();
    if (!s) return true;
    return String(val ?? '').toLowerCase().includes(s);
  }
  function matchNumeric(val, exprRaw) {
    const expr = String(exprRaw || '').trim(); if (!expr) return true;
    const n = Number(val); if (!isFinite(n)) return false;
    const ops = [['>=',(a,b)=>a>=b], ['<=',(a,b)=>a<=b], ['>',(a,b)=>a>b], ['<',(a,b)=>a<b], ['=',(a,b)=>a===b]];
    for (const [op,fn] of ops) if (expr.startsWith(op)) { const v = Number(expr.slice(op.length).trim()); if (!isFinite(v)) return false; return fn(n,v); }
    if (expr.includes('..')) { const [a,b] = expr.split('..'); const na = Number(a.trim()), nb = Number(b.trim()); if (isFinite(na)&&isFinite(nb)) return n>=na && n<=nb; }
    return String(val ?? '').toLowerCase().includes(expr.toLowerCase());
  }

  const rows = React.useMemo(() => {
    return (items||[]).map(it => ({
      id: type==='category' ? (it.id_category ?? null) : (it.id_product ?? null),
      name: it.name || '',
      reference: it.reference || '',
      category: it.category || '',
      link: it.link || '',
      active: type==='product' ? (it.active ?? null) : null
    }));
  }, [items, type]);

  const filtered = React.useMemo(() => rows.filter(r => (
    matchNumeric(r.id, filters.id) &&
    matchText(r.name, filters.name) &&
    matchText(r.reference, filters.reference) &&
    matchText(r.category, filters.category) &&
    matchText(r.link, filters.link)
  )), [rows, filters]);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    const numeric = new Set(['id','active']);
    if (!sortKey) return arr;
    arr.sort((a,b)=>{
      const va=a?.[sortKey], vb=b?.[sortKey];
      if (numeric.has(sortKey)) {
        const na=Number(va), nb=Number(vb);
        const cmp=(isFinite(na)?na:Infinity)-(isFinite(nb)?nb:Infinity);
        return sortDir==='asc'?cmp:-cmp;
      }
      const sa=String(va??'').toLowerCase();
      const sb=String(vb??'').toLowerCase();
      const cmp=sa.localeCompare(sb);
      return sortDir==='asc'?cmp:-cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key){ if (sortKey===key) setSortDir(d=>d==='asc'?'desc':'asc'); else { setSortKey(key); setSortDir('asc'); } }
  const onFilter=(k,v)=> setFilters(prev=>({ ...prev, [k]: v }));

  return (
    <div className="panel">
      <div className="panel__header flex items-center justify-between">
        <span>Presta Pages</span>
        <div className="text-xs text-gray-500">List product/category pages from selected MySQL profile</div>
      </div>
      <div className="panel__body space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">Profile</label>
          <select className="border rounded px-2 py-1" value={profileId} onChange={(e)=>setProfileId(e.target.value)}>
            <option value="">Select…</option>
            {profiles.map(p => (<option key={p.id} value={p.id}>{p.name} — {p.database}@{p.host}:{p.port}</option>))}
          </select>
          <label className="text-sm">Prefix</label>
          <input className="border rounded px-2 py-1 w-20" value={prefix} onChange={(e)=>setPrefix(e.target.value)} />
          <label className="text-sm">Type</label>
          <select className="border rounded px-2 py-1" value={type} onChange={(e)=>setType(e.target.value)}>
            <option value="product">Product</option>
            <option value="category">Category</option>
          </select>
          {type === 'product' && (
            <label className="text-sm inline-flex items-center gap-1">
              <input type="checkbox" checked={activeOnly} onChange={(e)=>setActiveOnly(!!e.target.checked)} /> Active only
            </label>
          )}
          <label className="text-sm">Shop</label>
          <select className="border rounded px-2 py-1" value={shopId} onChange={(e)=>setShopId(e.target.value)}>
            <option value="">Select…</option>
            {shops.map(s => (<option key={s.id_shop} value={s.id_shop}>{s.id_shop} — {s.base_url || s.domain || s.domain_ssl}</option>))}
          </select>
          <label className="text-sm">Lang</label>
          <select className="border rounded px-2 py-1" value={langId} onChange={(e)=>setLangId(e.target.value)}>
            <option value="">Select…</option>
            {langs.map(l => (<option key={l.id_lang} value={l.id_lang}>{l.id_lang} — {l.iso_code || l.name || 'lang'}</option>))}
          </select>
          <label className="text-sm">Limit</label>
          <input className="border rounded px-2 py-1 w-20" type="number" min="1" max="2000" value={limit} onChange={(e)=>setLimit(Math.max(1, Math.min(2000, Number(e.target.value||200))))} />
          <button className="px-3 py-1 border rounded" onClick={loadPages} disabled={loading || !profileId || !shopId || !langId}>{loading ? 'Loading…' : 'Load'}</button>
        </div>
        {baseUrl && (
          <div className="text-xs text-gray-600">Base URL: {baseUrl}</div>
        )}
        <div className="max-h-96 overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('id')}>{type==='category' ? 'id_category' : 'id_product'} {sortKey==='id' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
                <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('name')}>name {sortKey==='name' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
                <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('reference')}>reference {sortKey==='reference' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
                <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('category')}>category {sortKey==='category' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
                <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('link')}>page link {sortKey==='link' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
                {type==='product' && !activeOnly && (
                  <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('active')}>active {sortKey==='active' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
                )}
              </tr>
              <tr className="bg-gray-100">
                <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder=">=0 or 10..100" value={filters.id} onChange={e=>onFilter('id', e.target.value)} /></th>
                <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.name} onChange={e=>onFilter('name', e.target.value)} /></th>
                <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.reference} onChange={e=>onFilter('reference', e.target.value)} /></th>
                <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.category} onChange={e=>onFilter('category', e.target.value)} /></th>
                <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.link} onChange={e=>onFilter('link', e.target.value)} /></th>
                {type==='product' && !activeOnly && (
                  <th className="p-1" />
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, idx) => (
                <tr key={idx} className={idx%2? 'bg-white' : 'bg-gray-50/40'}>
                  <td className="p-1">{r.id}</td>
                  <td className="p-1">{r.name}</td>
                  <td className="p-1">{r.reference || ''}</td>
                  <td className="p-1">{r.category || ''}</td>
                  <td className="p-1"><a className="text-blue-700 underline" href={r.link} target="_blank" rel="noreferrer">{r.link}</a></td>
                  {type==='product' && !activeOnly && (
                    <td className="p-1">{r.active == null ? '' : (Number(r.active) === 1 ? '1' : '0')}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
