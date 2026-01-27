import React from 'react';

export default function ProductMarginPanel({ orgId }) {
  const [profileId, setProfileId] = React.useState('');
  const [profiles, setProfiles] = React.useState([]);
  const [q, setQ] = React.useState('');
  const [limit, setLimit] = React.useState(5000);
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [sortKey, setSortKey] = React.useState('');
  const [sortDir, setSortDir] = React.useState('asc');
  const [filters, setFilters] = React.useState({
    id_product: '',
    reference1: '',
    id_product_attribute: '',
    shop_default: '',
    name: '',
    reference: '',
    bom_name: '',
    final_price: '',
    active: '',
    bom_cost_total: '',
    margin: ''
  });
  const headers = orgId ? { 'x-org-id': orgId } : {};

  React.useEffect(() => { (async ()=>{
    try { const res = await fetch('/api/bom/presta/profile', { headers }); const j = await res.json(); if (j.ok) setProfileId(j.profile_id ? String(j.profile_id) : ''); } catch {}
  })(); }, [orgId]);

  React.useEffect(() => { (async ()=>{
    try { const res = await fetch('/api/bom/presta/profiles', { headers }); const j = await res.json(); if (j.ok) setProfiles(j.items || []); } catch {}
  })(); }, [orgId]);

  // Autoload once when profile is known (or none) to meet request
  const didAutoRef = React.useRef(false);
  React.useEffect(() => {
    if (didAutoRef.current) return;
    // Wait until profiles load attempt and profileId fetched; then auto-load
    const t = setTimeout(() => {
      didAutoRef.current = true;
      load();
    }, 250);
    return () => clearTimeout(t);
  }, [profileId]);

  async function saveProfile() {
    const pid = Number(profileId || 0) || 0;
    if (!pid) { alert('Enter a valid profile id'); return; }
    const res = await fetch('/api/bom/presta/profile', { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify({ profile_id: pid }) });
    const j = await res.json(); if (!j.ok) alert(j.message || j.error || 'Save failed');
  }

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (profileId) qs.set('profile_id', profileId);
      if (q) qs.set('q', q);
      if (limit) qs.set('limit', String(limit));
      const res = await fetch(`/api/bom/presta/margins?${qs}`, { headers });
      const j = await res.json();
      if (j.ok) setItems(j.items || []);
      else alert(j.message || j.error || 'Load failed');
    } catch (e) { alert(String(e)); }
    finally { setLoading(false); }
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  function onFilterChange(key, val) {
    setFilters(prev => ({ ...prev, [key]: val }));
  }

  function matchNumeric(val, exprRaw) {
    const expr = String(exprRaw || '').trim();
    if (!expr) return true;
    const n = Number(val);
    if (!isFinite(n)) return false;
    const ops = [['>=', (a,b)=>a>=b], ['<=',(a,b)=>a<=b], ['>',(a,b)=>a>b], ['<',(a,b)=>a<b], ['=',(a,b)=>a===b]];
    for (const [op, fn] of ops) {
      if (expr.startsWith(op)) {
        const v = Number(expr.slice(op.length).trim());
        if (!isFinite(v)) return false;
        return fn(n, v);
      }
    }
    // support simple range a..b
    if (expr.includes('..')) {
      const [a,b] = expr.split('..');
      const na = Number(a.trim());
      const nb = Number(b.trim());
      if (isFinite(na) && isFinite(nb)) return n >= na && n <= nb;
    }
    // default: substring match on stringified number
    return String(val ?? '').toLowerCase().includes(expr.toLowerCase());
  }

  function matchText(val, needle) {
    const f = String(needle || '').trim().toLowerCase();
    if (!f) return true;
    return String(val ?? '').toLowerCase().includes(f);
  }

  const filtered = React.useMemo(() => {
    return (items || []).filter(r => (
      matchText(r.id_product, filters.id_product) &&
      matchText(r.reference1, filters.reference1) &&
      matchText(r.id_product_attribute, filters.id_product_attribute) &&
      matchNumeric(r.shop_default, filters.shop_default) &&
      matchText(r.name, filters.name) &&
      matchText(r.reference, filters.reference) &&
      matchText(r.bom_name, filters.bom_name) &&
      matchNumeric(r.final_price, filters.final_price) &&
      matchText(r.active == null ? '' : (r.active ? '1' : '0'), filters.active) &&
      matchNumeric(r.bom_cost_total, filters.bom_cost_total) &&
      matchNumeric(r.margin, filters.margin)
    ));
  }, [items, filters]);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    if (!sortKey) return arr;
    const numericCols = new Set(['id_product','id_product_attribute','shop_default','final_price','bom_cost_total','margin']);
    arr.sort((a,b) => {
      const va = a?.[sortKey];
      const vb = b?.[sortKey];
      if (numericCols.has(sortKey)) {
        const na = Number(va);
        const nb = Number(vb);
        const cmp = (isFinite(na)?na:Infinity) - (isFinite(nb)?nb:Infinity);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const sa = String(va ?? '').toLowerCase();
      const sb = String(vb ?? '').toLowerCase();
      const cmp = sa.localeCompare(sb);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-3">Product Margin (Presta view + BOM)</h2>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <label className="text-sm">MySQL Profile</label>
        <select className="border rounded px-2 py-1" value={profileId} onChange={(e)=>setProfileId(e.target.value)}>
          <option value="">Select profile…</option>
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.name} — {p.database}@{p.host}:{p.port}{p.is_default ? ' (default)' : ''}</option>
          ))}
        </select>
        <button onClick={saveProfile} className="border rounded px-3 py-1">Save Profile</button>
        <input className="border rounded px-2 py-1 flex-1" placeholder="Search (BOM, name, reference)" value={q} onChange={(e)=>setQ(e.target.value)} />
        <input className="border rounded px-2 py-1 w-20" type="number" min="1" max="5000" value={limit} onChange={(e)=>{
          const v = Math.max(1, Math.min(5000, Number(e.target.value||5000)));
          setLimit(v);
        }} />
        <button onClick={load} className="border rounded px-3 py-1" disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
      </div>
      <div className="mb-2 text-sm text-gray-600">Filtered: {filtered.length} / {items.length}</div>
      <div className="overflow-auto" style={{ maxHeight: 420 }}>
        <table className="min-w-full text-sm">
          <thead className="bg-white" style={{ position:'sticky', top:0, zIndex: 10 }}>
            <tr className="bg-gray-50">
              <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('id_product')}>id_product {sortKey==='id_product' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
              <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('reference1')}>ref1 {sortKey==='reference1' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
              <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('id_product_attribute')}>attr {sortKey==='id_product_attribute' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
              <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('shop_default')}>shop (name) {sortKey==='shop_default' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
              <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('name')}>name {sortKey==='name' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
              <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('reference')}>reference {sortKey==='reference' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
              <th className="p-1 text-left cursor-pointer" onClick={()=>toggleSort('bom_name')}>BOM {sortKey==='bom_name' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
              <th className="p-1 text-right cursor-pointer" onClick={()=>toggleSort('final_price')}>final_price {sortKey==='final_price' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
              <th className="p-1 text-left">active</th>
              <th className="p-1 text-right cursor-pointer" onClick={()=>toggleSort('bom_cost_total')}>bom_cost_total {sortKey==='bom_cost_total' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
              <th className="p-1 text-right cursor-pointer" onClick={()=>toggleSort('margin')}>margin {sortKey==='margin' ? (sortDir==='asc'?'▲':'▼') : ''}</th>
            </tr>
            <tr className="bg-gray-100">
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.id_product} onChange={(e)=>onFilterChange('id_product', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.reference1} onChange={(e)=>onFilterChange('reference1', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.id_product_attribute} onChange={(e)=>onFilterChange('id_product_attribute', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder=">=1" value={filters.shop_default} onChange={(e)=>onFilterChange('shop_default', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.name} onChange={(e)=>onFilterChange('name', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.reference} onChange={(e)=>onFilterChange('reference', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="filter" value={filters.bom_name} onChange={(e)=>onFilterChange('bom_name', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full text-right" placeholder=">=0 or 10..100" value={filters.final_price} onChange={(e)=>onFilterChange('final_price', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full" placeholder="1/0" value={filters.active} onChange={(e)=>onFilterChange('active', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full text-right" placeholder=">=0 or 10..100" value={filters.bom_cost_total} onChange={(e)=>onFilterChange('bom_cost_total', e.target.value)} /></th>
              <th className="p-1"><input className="border rounded px-1 py-0.5 w-full text-right" placeholder=">=0 or 10..100" value={filters.margin} onChange={(e)=>onFilterChange('margin', e.target.value)} /></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i} className={i % 2 ? 'bg-white' : 'bg-gray-50/40'}>
                <td className="p-1">{r.id_product}</td>
                <td className="p-1">{r.reference1 || ''}</td>
                <td className="p-1">{r.id_product_attribute || ''}</td>
                <td className="p-1">{r.shop_default != null ? `${r.shop_default}${r.shop_name ? ` (${r.shop_name})` : ''}` : ''}</td>
                <td className="p-1">{r.name}</td>
                <td className="p-1">{r.reference}</td>
                <td className="p-1">{r.bom_name || ''}</td>
                <td className="p-1 text-right">{r.final_price != null ? r.final_price.toFixed(2) : ''}</td>
                <td className="p-1">{r.active == null ? '' : (r.active ? '1' : '0')}</td>
                <td className="p-1 text-right">{r.bom_cost_total != null ? r.bom_cost_total.toFixed(2) : ''}</td>
                <td className="p-1 text-right">{r.margin != null ? r.margin.toFixed(2) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
