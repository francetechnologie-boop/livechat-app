import React, { useEffect, useState } from 'react';

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <div className="text-gray-700 mb-1">{label}</div>
      {children}
    </label>
  );
}

export default function Roles() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ role: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/agents/roles', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error||'load_failed');
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) { setError('Unable to load roles'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Agents', 'Roles & Permissions'] })); } catch {} }, []);

  const onCreate = async (e) => {
    e?.preventDefault?.(); setSaving(true); setError('');
    try {
      const r = await fetch('/api/agents/roles', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error||'save_failed');
      setForm({ role:'', description:'' }); load();
    } catch (e) { setError(e?.message||'save_failed'); } finally { setSaving(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="panel">
        <div className="panel__header">Roles &amp; Permissions</div>
        <div className="panel__body space-y-4">
          {error && <div className="text-xs text-red-600">{error}</div>}
          <form onSubmit={onCreate} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Role"><input className="input w-full" value={form.role} onChange={(e)=>setForm(v=>({ ...v, role: e.target.value }))} required /></Field>
            <Field label="Description"><input className="input w-full" value={form.description} onChange={(e)=>setForm(v=>({ ...v, description: e.target.value }))} /></Field>
            <div className="flex items-end"><button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : 'Create'}</button></div>
          </form>
          <div className="overflow-auto">
            <table className="table-auto text-sm min-w-[600px]">
              <thead>
                <tr className="text-left">
                  <th className="px-2 py-1">ID</th>
                  <th className="px-2 py-1">Role</th>
                  <th className="px-2 py-1">Description</th>
                </tr>
              </thead>
              <tbody>
                {items.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1">{r.id}</td>
                    <td className="px-2 py-1">{r.role}</td>
                    <td className="px-2 py-1">{r.description||''}</td>
                  </tr>
                ))}
                {!items.length && !loading && (
                  <tr><td className="px-2 py-2 text-gray-500" colSpan={3}>No roles.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
