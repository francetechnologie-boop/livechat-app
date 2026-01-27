import React from 'react';

export default function ItemsPanel({ orgId }) {
  const [items, setItems] = React.useState([]);
  const [q, setQ] = React.useState('');
  const [form, setForm] = React.useState({ code:'', reference:'', name:'', unit:'pcs', procurement_type:'', supplier_id:'', supplier_name:'' });
  const [selected, setSelected] = React.useState(null);
  const [vendors, setVendors] = React.useState([]);
  const [createBom, setCreateBom] = React.useState({ name: '', quantity: '1' });
  const [createBomStatus, setCreateBomStatus] = React.useState('');
  const [vform, setVform] = React.useState({ supplier_name:'', supplier_id:'', supplier_item_code:'', price:'', currency:'', moq:'', lead_time_days:'', preferred:false, priority:'', notes:'' });
  const [suppliers, setSuppliers] = React.useState([]);
  const [supplierId, setSupplierId] = React.useState('');
  const [procurement, setProcurement] = React.useState('');
  const [hasImage, setHasImage] = React.useState(''); // '', '1', '0'
  const [sort, setSort] = React.useState('name');
  const [dir, setDir] = React.useState('asc');
  // Column filters
  const [fSku, setFSku] = React.useState('');
  const [fName, setFName] = React.useState('');
  const [fDescShort, setFDescShort] = React.useState('');
  const [fDesc, setFDesc] = React.useState('');
  const [fUnit, setFUnit] = React.useState('');
  const [fSupplier, setFSupplier] = React.useState('');
  const headers = orgId ? { 'x-org-id': orgId } : {};

  async function load() {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (supplierId) qs.set('supplier_id', supplierId);
    if (procurement) qs.set('procurement_type', procurement);
    if (hasImage) qs.set('has_picture', hasImage);
    if (fSku) qs.set('sku', fSku);
    if (fName) qs.set('name', fName);
    if (fDescShort) qs.set('description_short', fDescShort);
    if (fDesc) qs.set('description', fDesc);
    if (fUnit) qs.set('unit', fUnit);
    if (fSupplier) qs.set('supplier', fSupplier);
    if (sort) qs.set('sort', sort);
    if (dir) qs.set('dir', dir);
    const res = await fetch(`/api/bom/items?${qs}`, { headers });
    const j = await res.json(); if (j.ok) setItems(j.items || []);
  }
  React.useEffect(()=>{ load(); }, [q, supplierId, procurement, hasImage, sort, dir, orgId, fSku, fName, fDescShort, fDesc, fUnit, fSupplier]);

  React.useEffect(()=>{ (async ()=>{
    try {
      const res = await fetch(`/api/bom/suppliers?limit=2000`, { headers });
      const j = await res.json(); if (j.ok) setSuppliers(j.items || []);
    } catch {}
  })(); }, [orgId]);

  function toggleSort(col) {
    if (sort === col) setDir(prev => prev === 'asc' ? 'desc' : 'asc'); else { setSort(col); setDir('asc'); }
  }

  async function loadVendors(item) {
    if (!item) { setVendors([]); return; }
    const res = await fetch(`/api/bom/items/${item.id}/vendors`, { headers });
    const j = await res.json(); if (j.ok) setVendors(j.items || []);
  }

  async function createBomWithSelectedItem(e) {
    e.preventDefault();
    if (!selected) return;
    setCreateBomStatus('');
    try {
      const body = { name: String(createBom.name || '').trim() };
      if (!body.name) { setCreateBomStatus('Please enter a BOM name.'); return; }
      if (orgId) body.org_id = orgId;
      const res = await fetch('/api/bom/boms', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!j.ok || !j.id) { setCreateBomStatus(j?.error || 'Failed to create BOM'); return; }
      const bomId = j.id;
      const link = { item_id: Number(selected.id), quantity: Number(createBom.quantity || '1') || 1 };
      if (orgId) link.org_id = orgId;
      const res2 = await fetch(`/api/bom/boms/${bomId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(link) });
      const j2 = await res2.json();
      if (!j2.ok) { setCreateBomStatus(j2?.error || 'Failed to add item to BOM'); return; }
      setCreateBom({ name: '', quantity: '1' });
      setCreateBomStatus('BOM created and item added.');
    } catch (err) {
      setCreateBomStatus('Unexpected error creating BOM.');
    }
  }

  async function createItem(e) {
    e.preventDefault();
    const payload = { ...form, supplier_id: form.supplier_id ? Number(form.supplier_id) : null };
    if (orgId) payload.org_id = orgId;
    const res = await fetch('/api/bom/items', { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(payload) });
    const j = await res.json(); if (j.ok) { setForm({ code:'', reference:'', name:'', unit:'pcs', procurement_type:'', supplier_id:'', supplier_name:'' }); load(); }
  }

  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-3">Items</h2>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input className="border rounded px-2 py-1 flex-1" placeholder="Search items..." value={q} onChange={(e)=>setQ(e.target.value)} />
        <select className="border rounded px-2 py-1" value={supplierId} onChange={(e)=>setSupplierId(e.target.value)}>
          <option value="">All suppliers</option>
          {suppliers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
        <select className="border rounded px-2 py-1" value={procurement} onChange={(e)=>setProcurement(e.target.value)}>
          <option value="">All procurement</option>
          <option value="Acheté sur commande">Acheté sur commande</option>
          <option value="Sur stock">Sur stock</option>
          <option value="fabriqué">fabriqué</option>
          <option value="sous-ensemble">sous-ensemble</option>
          <option value="indefini">indefini</option>
        </select>
        <select className="border rounded px-2 py-1" value={hasImage} onChange={(e)=>setHasImage(e.target.value)}>
          <option value="">All images</option>
          <option value="1">With image</option>
          <option value="0">Without image</option>
        </select>
        <select className="border rounded px-2 py-1" value={sort} onChange={(e)=>setSort(e.target.value)}>
          <option value="name">Sort: Name</option>
          <option value="sku">Sort: SKU</option>
          <option value="code">Sort: Code</option>
          <option value="unit">Sort: Unit</option>
          <option value="supplier">Sort: Supplier</option>
          <option value="created_at">Sort: Created</option>
          <option value="updated_at">Sort: Updated</option>
        </select>
        <select className="border rounded px-2 py-1" value={dir} onChange={(e)=>setDir(e.target.value)}>
          <option value="asc">Asc</option>
          <option value="desc">Desc</option>
        </select>
        <button onClick={load} className="border rounded px-3 py-1">Refresh</button>
      </div>
      <form onSubmit={createItem} className="flex gap-2 mb-3 flex-wrap items-center">
        <input className="border rounded px-2 py-1" placeholder="Item Code" value={form.code} onChange={(e)=>setForm(prev=>({ ...prev, code:e.target.value }))} />
        <input className="border rounded px-2 py-1" placeholder="Reference" value={form.reference} onChange={(e)=>setForm(prev=>({ ...prev, reference:e.target.value }))} />
        <input className="border rounded px-2 py-1" placeholder="Name" value={form.name} onChange={(e)=>setForm(prev=>({ ...prev, name:e.target.value }))} />
        <input className="border rounded px-2 py-1 w-24" placeholder="Unit" value={form.unit} onChange={(e)=>setForm(prev=>({ ...prev, unit:e.target.value }))} />
        <input className="border rounded px-2 py-1 w-48" placeholder="Procurement type" value={form.procurement_type} onChange={(e)=>setForm(prev=>({ ...prev, procurement_type:e.target.value }))} />
        <input className="border rounded px-2 py-1 w-28" placeholder="Supplier ID" value={form.supplier_id} onChange={(e)=>setForm(prev=>({ ...prev, supplier_id:e.target.value }))} />
        <input className="border rounded px-2 py-1 w-48" placeholder="Supplier name (auto-create)" value={form.supplier_name} onChange={(e)=>setForm(prev=>({ ...prev, supplier_name:e.target.value }))} />
        <button className="border rounded px-3 py-1" type="submit">Add</button>
      </form>
      <div className="max-h-64 overflow-auto border rounded">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left p-2">Img</th>
              <th className="text-left p-2 cursor-pointer" onClick={()=>toggleSort('sku')}>SKU</th>
              <th className="text-left p-2 cursor-pointer" onClick={()=>toggleSort('name')}>Name</th>
              <th className="text-left p-2">Desc. short</th>
              <th className="text-left p-2">Description</th>
              <th className="text-left p-2 cursor-pointer" onClick={()=>toggleSort('unit')}>Unit</th>
              <th className="text-left p-2">Proc.</th>
              <th className="text-left p-2 cursor-pointer" onClick={()=>toggleSort('supplier')}>Supplier</th>
              <th className="text-right p-2">Actions</th>
            </tr>
            <tr className="bg-white">
              <th className="p-2">
                <select className="border rounded px-1 py-0.5 text-xs" value={hasImage} onChange={(e)=>setHasImage(e.target.value)}>
                  <option value="">All</option>
                  <option value="1">With</option>
                  <option value="0">Without</option>
                </select>
              </th>
              <th className="p-2"><input className="border rounded px-1 py-0.5 text-xs w-full" placeholder="SKU contains" value={fSku} onChange={(e)=>setFSku(e.target.value)} /></th>
              <th className="p-2"><input className="border rounded px-1 py-0.5 text-xs w-full" placeholder="Name contains" value={fName} onChange={(e)=>setFName(e.target.value)} /></th>
              <th className="p-2"><input className="border rounded px-1 py-0.5 text-xs w-full" placeholder="Short desc contains" value={fDescShort} onChange={(e)=>setFDescShort(e.target.value)} /></th>
              <th className="p-2"><input className="border rounded px-1 py-0.5 text-xs w-full" placeholder="Description contains" value={fDesc} onChange={(e)=>setFDesc(e.target.value)} /></th>
              <th className="p-2"><input className="border rounded px-1 py-0.5 text-xs w-full" placeholder="Unit contains" value={fUnit} onChange={(e)=>setFUnit(e.target.value)} /></th>
              <th className="p-2">
                <select className="border rounded px-1 py-0.5 text-xs w-full" value={procurement} onChange={(e)=>setProcurement(e.target.value)}>
                  <option value="">All</option>
                  <option value="Acheté sur commande">Acheté sur commande</option>
                  <option value="Sur stock">Sur stock</option>
                  <option value="fabriqué">fabriqué</option>
                  <option value="sous-ensemble">sous-ensemble</option>
                  <option value="indefini">indefini</option>
                </select>
              </th>
              <th className="p-2"><input className="border rounded px-1 py-0.5 text-xs w-full" placeholder="Supplier contains" value={fSupplier} onChange={(e)=>setFSupplier(e.target.value)} /></th>
              <th className="p-2 text-right">
                <button className="border rounded px-2 py-0.5 text-xs" onClick={()=>{ setFSku(''); setFName(''); setFDescShort(''); setFDesc(''); setFUnit(''); setFSupplier(''); setHasImage(''); }}>Clear</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className={`border-t ${selected?.id === it.id ? 'bg-yellow-50' : ''}`}>
                <td className="p-2">
                  <a href={`/api/bom/items/${it.id}/picture`} target="_blank" rel="noreferrer">
                    <img src={`/api/bom/items/${it.id}/picture`} alt=""
                         style={{ width: 84, height: 84, objectFit: 'contain' }}
                         onError={(e)=>{ e.currentTarget.style.display='none'; }} />
                  </a>
                </td>
                <td className="p-2">{it.code || it.sku}</td>
                <td className="p-2">{it.name}</td>
                <td className="p-2 max-w-[240px] truncate" title={it.description_short || ''}>{(it.description_short || '').slice(0, 120)}</td>
                <td className="p-2 max-w-[360px] truncate" title={it.description || ''}>{(it.description || '').slice(0, 180)}</td>
                <td className="p-2">{it.unit || it.uom}</td>
                <td className="p-2">{it.procurement_type || ''}</td>
                <td className="p-2">{it.supplier_name || it.supplier_id || ''}</td>
                <td className="p-2 text-right space-x-2">
                  <button className="border rounded px-2 py-0.5 text-xs" onClick={()=>{ setSelected(it); loadVendors(it); }}>Vendors</button>
                  <button className="border rounded px-2 py-0.5 text-xs" title="Create a BOM including this item" onClick={()=>{ setSelected(it); setCreateBomStatus(''); }}>Create BOM</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="mt-4 border rounded p-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="font-medium">Selected item: {selected.name}</div>
            <button className="ml-auto border rounded px-2 py-0.5 text-xs" onClick={()=>{ setSelected(null); setVendors([]); setCreateBom({ name:'', quantity:'1' }); setCreateBomStatus(''); }}>Close</button>
          </div>

          <div className="mb-4">
            <div className="font-medium mb-2">Create BOM including this item</div>
            <form onSubmit={createBomWithSelectedItem} className="flex flex-wrap items-center gap-2">
              <input className="border rounded px-2 py-1" placeholder="New BOM name" value={createBom.name} onChange={(e)=>setCreateBom(prev=>({ ...prev, name: e.target.value }))} />
              <input className="border rounded px-2 py-1 w-24" placeholder="Qty" value={createBom.quantity} onChange={(e)=>setCreateBom(prev=>({ ...prev, quantity: e.target.value }))} />
              <button className="border rounded px-3 py-1" type="submit">Create BOM</button>
              {createBomStatus && (<span className="text-sm ml-2">{createBomStatus}</span>)}
            </form>
          </div>

          <div className="flex items-center gap-2 mb-2">
            <div className="font-medium">Vendors</div>
          </div>
          <form onSubmit={async (e)=>{ e.preventDefault(); const body={ ...vform }; if (body.supplier_id) body.supplier_id = Number(body.supplier_id); if (orgId) body.org_id = orgId; const res = await fetch(`/api/bom/items/${selected.id}/vendors`, { method:'POST', headers:{ 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) }); const j = await res.json(); if (j.ok) { setVform({ supplier_name:'', supplier_id:'', supplier_item_code:'', price:'', currency:'', moq:'', lead_time_days:'', preferred:false, priority:'', notes:'' }); loadVendors(selected); } }} className="flex flex-wrap items-center gap-2 mb-3">
            <input className="border rounded px-2 py-1" placeholder="Supplier name" value={vform.supplier_name} onChange={(e)=>setVform(p=>({ ...p, supplier_name:e.target.value }))} />
            <input className="border rounded px-2 py-1 w-28" placeholder="Supplier ID" value={vform.supplier_id} onChange={(e)=>setVform(p=>({ ...p, supplier_id:e.target.value }))} />
            <input className="border rounded px-2 py-1" placeholder="Supplier item code" value={vform.supplier_item_code} onChange={(e)=>setVform(p=>({ ...p, supplier_item_code:e.target.value }))} />
            <input className="border rounded px-2 py-1 w-24" placeholder="Price" value={vform.price} onChange={(e)=>setVform(p=>({ ...p, price:e.target.value }))} />
            <input className="border rounded px-2 py-1 w-20" placeholder="Curr." value={vform.currency} onChange={(e)=>setVform(p=>({ ...p, currency:e.target.value }))} />
            <input className="border rounded px-2 py-1 w-20" placeholder="MOQ" value={vform.moq} onChange={(e)=>setVform(p=>({ ...p, moq:e.target.value }))} />
            <input className="border rounded px-2 py-1 w-28" placeholder="Lead days" value={vform.lead_time_days} onChange={(e)=>setVform(p=>({ ...p, lead_time_days:e.target.value }))} />
            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={vform.preferred} onChange={(e)=>setVform(p=>({ ...p, preferred:e.target.checked }))} /> preferred</label>
            <input className="border rounded px-2 py-1 w-24" placeholder="Priority" value={vform.priority} onChange={(e)=>setVform(p=>({ ...p, priority:e.target.value }))} />
            <input className="border rounded px-2 py-1 w-64" placeholder="Notes" value={vform.notes} onChange={(e)=>setVform(p=>({ ...p, notes:e.target.value }))} />
            <button className="border rounded px-3 py-1" type="submit">Add/Update Vendor</button>
          </form>
          <div className="max-h-48 overflow-auto border rounded">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50"><th className="text-left p-2">Vendor</th><th className="text-left p-2">Code</th><th className="text-left p-2">Catalog</th><th className="text-left p-2">Price</th><th className="text-left p-2">MOQ</th><th className="text-left p-2">Lead</th><th className="text-left p-2">Preferred</th><th className="text-right p-2">Actions</th></tr></thead>
            <tbody>
              {vendors.map(v => (
                <tr key={v.supplier_id} className="border-t">
                  <td className="p-2">{v.supplier_name}</td>
                  <td className="p-2">{v.supplier_item_code || ''}</td>
                  <td className="p-2">{v.catalog_price != null ? v.catalog_price : ''}</td>
                  <td className="p-2">{v.price != null ? `${v.price} ${v.currency || ''}` : ''}</td>
                  <td className="p-2">{v.moq || ''}</td>
                  <td className="p-2">{v.lead_time_days || ''}</td>
                  <td className="p-2">{v.preferred ? 'Yes' : ''}</td>
                  <td className="p-2 text-right">
                      <button className="border rounded px-2 py-0.5 text-xs" onClick={async ()=>{ await fetch(`/api/bom/items/${selected.id}/vendors/${v.supplier_id}`, { method:'DELETE', headers }); loadVendors(selected); }}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
