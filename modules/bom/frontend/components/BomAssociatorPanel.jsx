import React from 'react';

export default function BomAssociatorPanel({ orgId }) {
  const headers = orgId ? { 'x-org-id': orgId } : {};
  const [profiles, setProfiles] = React.useState([]);
  const [profileId, setProfileId] = React.useState('');
  const [shops, setShops] = React.useState([]);
  const [shopId, setShopId] = React.useState('');
  const [langs, setLangs] = React.useState([]);
  const [langId, setLangId] = React.useState('');
  const [filters, setFilters] = React.useState({ id_product: '', reference: '', supplier_reference: '' });
  const [limit, setLimit] = React.useState(200);
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState([]);

  React.useEffect(() => { (async () => {
    try { const res = await fetch('/api/bom/presta/profiles', { headers }); const j = await res.json(); if (j.ok) setProfiles(j.items || []); } catch {}
  })(); }, [orgId]);

  React.useEffect(() => { (async () => {
    if (!profileId) { setShops([]); setShopId(''); setLangs([]); setLangId(''); return; }
    try { const res = await fetch(`/api/bom/presta/shops?profile_id=${encodeURIComponent(profileId)}`, { headers }); const j = await res.json(); if (j.ok) setShops(j.items || []); else setShops([]); } catch { setShops([]); }
    setShopId(''); setLangs([]); setLangId('');
  })(); }, [profileId, orgId]);

  React.useEffect(() => { (async () => {
    if (!profileId || !shopId) { setLangs([]); setLangId(''); return; }
    try { const res = await fetch(`/api/bom/presta/langs?profile_id=${encodeURIComponent(profileId)}&id_shop=${encodeURIComponent(shopId)}`, { headers }); const j = await res.json(); if (j.ok) setLangs(j.items || []); else setLangs([]); } catch { setLangs([]); }
    setLangId('');
  })(); }, [profileId, shopId, orgId]);

  function onFilterChange(k, v) { setFilters(prev => ({ ...prev, [k]: v })); }

  async function search() {
    if (!profileId) { alert('Select a MySQL profile'); return; }
    if (!shopId || !langId) { alert('Select a shop and language'); return; }
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('profile_id', profileId);
      qs.set('id_shop', shopId);
      qs.set('id_lang', langId);
      if (filters.id_product) qs.set('id_product', filters.id_product);
      if (filters.reference) qs.set('reference', filters.reference);
      if (filters.supplier_reference) qs.set('supplier_reference', filters.supplier_reference);
      if (limit) qs.set('limit', String(limit));
      const res = await fetch(`/api/bom/presta/associator/search?${qs.toString()}`, { headers });
      const j = await res.json();
      if (j.ok) setItems(j.items || []); else alert(j.message || j.error || 'Search failed');
    } catch (e) { alert(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">MySQL Profile</label>
          <select className="border rounded px-2 py-1 min-w-[220px]" value={profileId} onChange={e=>setProfileId(e.target.value)}>
            <option value="">Select profile…</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.name || `${p.host}:${p.port}${p.is_default ? ' (default)' : ''}`}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Shop (ps_shop)</label>
          <select className="border rounded px-2 py-1 min-w-[160px]" value={shopId} onChange={e=>setShopId(e.target.value)} disabled={!profiles.length || !profileId}>
            <option value="">Select shop…</option>
            {shops.map(s => (<option key={s.id_shop} value={s.id_shop}>{s.id_shop} – {s.name}</option>))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Language (ps_lang)</label>
          <select className="border rounded px-2 py-1 min-w-[160px]" value={langId} onChange={e=>setLangId(e.target.value)} disabled={!shopId}>
            <option value="">Select language…</option>
            {langs.map(l => (<option key={l.id_lang} value={l.id_lang}>{l.id_lang} – {l.name} ({l.iso_code})</option>))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Limit</label>
          <input type="number" className="border rounded px-2 py-1 w-24" min={1} max={1000} value={limit} onChange={e=>setLimit(Number(e.target.value||0)||0)} />
        </div>
        <div className="ml-auto">
          <button className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50" disabled={loading} onClick={search}>{loading ? 'Searching…' : 'Search'}</button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Filter: id_product</label>
          <input className="border rounded px-2 py-1" placeholder="e.g. 1 or 1,2,3" value={filters.id_product} onChange={e=>onFilterChange('id_product', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Filter: reference</label>
          <input className="border rounded px-2 py-1" placeholder="contains…" value={filters.reference} onChange={e=>onFilterChange('reference', e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Filter: supplier reference</label>
          <input className="border rounded px-2 py-1" placeholder="contains…" value={filters.supplier_reference} onChange={e=>onFilterChange('supplier_reference', e.target.value)} />
        </div>
      </div>

      <div className="text-sm text-gray-600 mb-2">Results: {items.length}</div>
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-2 py-1 border-b">id_product</th>
              <th className="text-left px-2 py-1 border-b">name</th>
              <th className="text-left px-2 py-1 border-b">reference</th>
              <th className="text-left px-2 py-1 border-b">supplier_reference</th>
              <th className="text-left px-2 py-1 border-b">matched_bom_name</th>
              <th className="text-left px-2 py-1 border-b">matched_bom_id</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={`${r.id_product}:${i}`} className={i % 2 ? 'bg-white' : 'bg-gray-50/50'}>
                <td className="px-2 py-1 border-b">{r.id_product}</td>
                <td className="px-2 py-1 border-b">{r.name}</td>
                <td className="px-2 py-1 border-b">{r.reference}</td>
                <td className="px-2 py-1 border-b">{r.supplier_reference}</td>
                <td className="px-2 py-1 border-b">{r.matched_bom_name || ''}</td>
                <td className="px-2 py-1 border-b">{r.matched_bom_id || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

