import React from 'react';

export default function SupplierPanel({ orgId }) {
  const [items, setItems] = React.useState([]);
  const [q, setQ] = React.useState('');
  const [form, setForm] = React.useState({ name: '', contact: '' });
  const [selected, setSelected] = React.useState(null);
  const [contacts, setContacts] = React.useState([]);
  const [cform, setCform] = React.useState({ name: '', email: '', phone: '', role: '', is_primary: false });
  const [edit, setEdit] = React.useState({
    name: '', contact: '', street_address: '', city: '', country: '', zip: '', phone: '', email: '', tax_rate: '', currency: '', vendor_code: ''
  });
  const headers = orgId ? { 'x-org-id': orgId } : {};

  async function load() {
    const qs = new URLSearchParams(); if (q) qs.set('q', q);
    const res = await fetch(`/api/bom/suppliers?${qs}`, { headers });
    const j = await res.json(); if (j.ok) setItems(j.items || []);
  }
  React.useEffect(()=>{ load(); }, [q, orgId]);

  async function loadContacts(id) {
    if (!id) { setContacts([]); return; }
    const res = await fetch(`/api/bom/suppliers/${id}/contacts`, { headers });
    const j = await res.json(); if (j.ok) setContacts(j.items || []);
  }
  React.useEffect(()=>{ loadContacts(selected?.id || 0); }, [selected?.id, orgId]);

  function pick(it) {
    setSelected(it);
    setEdit({
      name: it.name || '',
      contact: it.contact || '',
      street_address: it.street_address || '',
      city: it.city || '',
      country: it.country || '',
      zip: it.zip || '',
      phone: it.phone || '',
      email: it.email || '',
      tax_rate: it.tax_rate != null ? String(it.tax_rate) : '',
      currency: it.currency || '',
      vendor_code: it.vendor_code || ''
    });
  }

  async function saveDetails() {
    if (!selected) return;
    const payload = { ...edit };
    if (payload.tax_rate === '') delete payload.tax_rate; else payload.tax_rate = Number(payload.tax_rate);
    const res = await fetch(`/api/bom/suppliers/${selected.id}`,
      { method:'PUT', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(payload) });
    const j = await res.json();
    if (j.ok) {
      await load();
      // refresh selection from updated list
      const updated = (items || []).find(x => x.id === selected.id);
      if (updated) pick(updated);
    }
  }

  async function createSupplier(e) {
    e.preventDefault();
    const body = { ...form }; if (orgId) body.org_id = orgId;
    const res = await fetch('/api/bom/suppliers', { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
    const j = await res.json(); if (j.ok) { setForm({ name:'', contact:'' }); load(); }
  }

  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-3">Suppliers</h2>
      <div className="flex gap-2 mb-3">
        <input className="border rounded px-2 py-1 flex-1" placeholder="Search suppliers..." value={q} onChange={(e)=>setQ(e.target.value)} />
        <button onClick={load} className="border rounded px-3 py-1">Refresh</button>
      </div>
      <form onSubmit={createSupplier} className="flex gap-2 mb-3">
        <input className="border rounded px-2 py-1" placeholder="Name" value={form.name} onChange={(e)=>setForm(prev=>({ ...prev, name:e.target.value }))} />
        <input className="border rounded px-2 py-1" placeholder="Contact" value={form.contact} onChange={(e)=>setForm(prev=>({ ...prev, contact:e.target.value }))} />
        <button className="border rounded px-3 py-1" type="submit">Add</button>
      </form>
      <div className="max-h-64 overflow-auto border rounded">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50"><th className="text-left p-2">Name</th><th className="text-left p-2">City</th><th className="text-left p-2">Country</th><th className="text-left p-2">Email</th><th className="text-right p-2">Actions</th></tr></thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className={`border-t ${selected?.id === it.id ? 'bg-yellow-50' : ''}`}>
                <td className="p-2">{it.name}</td>
                <td className="p-2">{it.city || ''}</td>
                <td className="p-2">{it.country || ''}</td>
                <td className="p-2">{it.email || ''}</td>
                <td className="p-2 text-right">
                  <button className="border rounded px-2 py-0.5 text-xs mr-1" onClick={()=>pick(it)}>Edit</button>
                  <button className="border rounded px-2 py-0.5 text-xs" onClick={()=>{ pick(it); }}>Contacts</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="mt-4 border rounded p-3 space-y-4">
          <div className="flex items-center gap-2">
            <div className="font-medium">Supplier Details: {selected.name}</div>
            <button className="ml-auto border rounded px-2 py-0.5 text-xs" onClick={()=>{ setSelected(null); setContacts([]); }}>Close</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="text-sm">Name<input className="border rounded px-2 py-1 w-full" value={edit.name} onChange={(e)=>setEdit(p=>({ ...p, name:e.target.value }))} /></label>
            <label className="text-sm">Contact<input className="border rounded px-2 py-1 w-full" value={edit.contact} onChange={(e)=>setEdit(p=>({ ...p, contact:e.target.value }))} /></label>
            <label className="text-sm">Street<input className="border rounded px-2 py-1 w-full" value={edit.street_address} onChange={(e)=>setEdit(p=>({ ...p, street_address:e.target.value }))} /></label>
            <label className="text-sm">City<input className="border rounded px-2 py-1 w-full" value={edit.city} onChange={(e)=>setEdit(p=>({ ...p, city:e.target.value }))} /></label>
            <label className="text-sm">Country<input className="border rounded px-2 py-1 w-full" value={edit.country} onChange={(e)=>setEdit(p=>({ ...p, country:e.target.value }))} /></label>
            <label className="text-sm">ZIP<input className="border rounded px-2 py-1 w-full" value={edit.zip} onChange={(e)=>setEdit(p=>({ ...p, zip:e.target.value }))} /></label>
            <label className="text-sm">Phone<input className="border rounded px-2 py-1 w-full" value={edit.phone} onChange={(e)=>setEdit(p=>({ ...p, phone:e.target.value }))} /></label>
            <label className="text-sm">Email<input className="border rounded px-2 py-1 w-full" value={edit.email} onChange={(e)=>setEdit(p=>({ ...p, email:e.target.value }))} /></label>
            <label className="text-sm">Tax Rate (%)<input className="border rounded px-2 py-1 w-full" value={edit.tax_rate} onChange={(e)=>setEdit(p=>({ ...p, tax_rate:e.target.value }))} /></label>
            <label className="text-sm">Currency<input className="border rounded px-2 py-1 w-full" value={edit.currency} onChange={(e)=>setEdit(p=>({ ...p, currency:e.target.value }))} /></label>
            <label className="text-sm">Vendor Code<input className="border rounded px-2 py-1 w-full" value={edit.vendor_code} onChange={(e)=>setEdit(p=>({ ...p, vendor_code:e.target.value }))} /></label>
          </div>
          <div>
            <button className="border rounded px-3 py-1" onClick={saveDetails}>Save</button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <div className="font-medium">Contacts</div>
          </div>
          <form onSubmit={async (e)=>{ e.preventDefault(); const body = { ...cform }; if (orgId) body.org_id = orgId; const res = await fetch(`/api/bom/suppliers/${selected.id}/contacts`, { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) }); const j = await res.json(); if (j.ok) { setCform({ name:'', email:'', phone:'', role:'', is_primary:false }); loadContacts(selected.id); } }} className="flex flex-wrap items-center gap-2 mb-3">
            <input className="border rounded px-2 py-1" placeholder="Name" value={cform.name} onChange={(e)=>setCform(p=>({ ...p, name:e.target.value }))} />
            <input className="border rounded px-2 py-1" placeholder="Email" value={cform.email} onChange={(e)=>setCform(p=>({ ...p, email:e.target.value }))} />
            <input className="border rounded px-2 py-1" placeholder="Phone" value={cform.phone} onChange={(e)=>setCform(p=>({ ...p, phone:e.target.value }))} />
            <input className="border rounded px-2 py-1 w-28" placeholder="Role" value={cform.role} onChange={(e)=>setCform(p=>({ ...p, role:e.target.value }))} />
            <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={cform.is_primary} onChange={(e)=>setCform(p=>({ ...p, is_primary:e.target.checked }))} /> primary</label>
            <button className="border rounded px-3 py-1" type="submit">Add Contact</button>
          </form>
          <div className="max-h-48 overflow-auto border rounded">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50"><th className="text-left p-2">Name</th><th className="text-left p-2">Email</th><th className="text-left p-2">Phone</th><th className="text-left p-2">Role</th></tr></thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id} className="border-t">
                    <td className="p-2">{c.name || ''}{c.is_primary ? <span className="ml-2 text-xs text-green-700">(primary)</span> : null}</td>
                    <td className="p-2">{c.email || ''}</td>
                    <td className="p-2">{c.phone || ''}</td>
                    <td className="p-2">{c.role || ''}</td>
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
