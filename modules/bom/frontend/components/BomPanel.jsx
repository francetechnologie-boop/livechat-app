import React from 'react';

export default function BomPanel({ orgId }) {
  const [boms, setBoms] = React.useState([]);
  const [items, setItems] = React.useState([]);
  const [selected, setSelected] = React.useState('');
  const [form, setForm] = React.useState({ name:'', description:'' });
  const [link, setLink] = React.useState({ item_id:'', quantity:'1' });
  const headers = orgId ? { 'x-org-id': orgId } : {};

  async function loadBoms() {
    const res = await fetch('/api/bom/boms?limit=5000', { headers });
    const j = await res.json(); if (j.ok) setBoms(j.items || []);
  }
  async function loadBomItems(id) {
    if (!id) { setItems([]); return; }
    const res = await fetch(`/api/bom/boms/${id}/items`, { headers });
    const j = await res.json(); if (j.ok) setItems(j.items || []);
  }
  React.useEffect(()=>{ loadBoms(); }, [orgId]);
  React.useEffect(()=>{ loadBomItems(selected); }, [selected, orgId]);

  async function createBom(e) {
    e.preventDefault();
    const body = { ...form }; if (orgId) body.org_id = orgId;
    const res = await fetch('/api/bom/boms', { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
    const j = await res.json(); if (j.ok) { setForm({ name:'', description:'' }); loadBoms(); }
  }
  async function addItemToBom(e) {
    e.preventDefault(); if (!selected) return;
    const body = { item_id: Number(link.item_id), quantity: Number(link.quantity) }; if (orgId) body.org_id = orgId;
    const res = await fetch(`/api/bom/boms/${selected}/items`, { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
    const j = await res.json(); if (j.ok) { setLink({ item_id:'', quantity:'1' }); loadBomItems(selected); }
  }

  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-3">Bill of Material</h2>
      <div className="flex items-center gap-2 mb-3">
        <label className="text-sm">Select BOM</label>
        <select className="border rounded px-2 py-1" value={selected} onChange={(e)=>setSelected(e.target.value)}>
          <option value="">—</option>
          {boms.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
        </select>
        <button onClick={loadBoms} className="border rounded px-3 py-1 ml-auto">Refresh</button>
      </div>

      <form onSubmit={createBom} className="flex gap-2 mb-3 flex-wrap items-center">
        <input className="border rounded px-2 py-1" placeholder="New BOM name" value={form.name} onChange={(e)=>setForm(prev=>({ ...prev, name:e.target.value }))} />
        <input className="border rounded px-2 py-1 w-64" placeholder="Description" value={form.description} onChange={(e)=>setForm(prev=>({ ...prev, description:e.target.value }))} />
        <button className="border rounded px-3 py-1" type="submit">Create</button>
      </form>

      {selected && (
        <>
          <form onSubmit={addItemToBom} className="flex gap-2 mb-3 items-center">
            <input className="border rounded px-2 py-1" placeholder="Item ID" value={link.item_id} onChange={(e)=>setLink(prev=>({ ...prev, item_id:e.target.value }))} />
            <input className="border rounded px-2 py-1 w-24" placeholder="Qty" value={link.quantity} onChange={(e)=>setLink(prev=>({ ...prev, quantity:e.target.value }))} />
            <button className="border rounded px-3 py-1" type="submit">Add Item</button>
          </form>
          <div className="max-h-64 overflow-auto border rounded">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50"><th className="text-left p-2">Item</th><th className="text-left p-2">SKU</th><th className="text-left p-2">Qty</th></tr></thead>
              <tbody>
                {items.map(it => (
                  <tr key={`${it.bom_id}-${it.item_id}`} className="border-t">
                    <td className="p-2">{it.name}</td>
                    <td className="p-2">{it.sku}</td>
                    <td className="p-2">{it.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
