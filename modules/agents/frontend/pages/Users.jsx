import React, { useEffect, useState } from 'react';

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <div className="text-gray-700 mb-1">{label}</div>
      {children}
    </label>
  );
}

export default function Users() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', role: 'agent', is_active: true, preferred_lang: 'en' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/agents/users', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error||'load_failed');
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setError('Unable to load users');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Agents', 'Users'] })); } catch {} }, []);

  const onCreate = async (e) => {
    e?.preventDefault?.();
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/agents/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error||'save_failed');
      setForm({ name: '', email: '', role: 'agent', is_active: true, preferred_lang: 'en' });
      load();
    } catch (e) { setError(e?.message||'save_failed'); } finally { setSaving(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="panel">
        <div className="panel__header">Users</div>
        <div className="panel__body space-y-4">
          {error && <div className="text-xs text-red-600">{error}</div>}
          <form onSubmit={onCreate} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Field label="Name"><input className="input w-full" value={form.name} onChange={(e)=>setForm(v=>({ ...v, name: e.target.value }))} required /></Field>
            <Field label="Email"><input type="email" className="input w-full" value={form.email} onChange={(e)=>setForm(v=>({ ...v, email: e.target.value }))} required /></Field>
            <Field label="Role">
              <select className="input w-full" value={form.role} onChange={(e)=>setForm(v=>({ ...v, role: e.target.value }))}>
                <option value="agent">agent</option>
                <option value="admin">admin</option>
              </select>
            </Field>
            <Field label="Language">
              <select className="input w-full" value={form.preferred_lang} onChange={(e)=>setForm(v=>({ ...v, preferred_lang: e.target.value }))}>
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
              </select>
            </Field>
            <div className="flex items-end"><button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : 'Create'}</button></div>
          </form>

          <div className="overflow-auto">
            <table className="table-auto text-sm min-w-[700px]">
              <thead>
                <tr className="text-left">
                  <th className="px-2 py-1">ID</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Email</th>
                  <th className="px-2 py-1">Role</th>
                  <th className="px-2 py-1">Active</th>
                </tr>
              </thead>
              <tbody>
                {items.map(u => (
                  <tr key={u.id} className="border-t">
                    <td className="px-2 py-1">{u.id}</td>
                    <td className="px-2 py-1">{u.name}</td>
                    <td className="px-2 py-1">{u.email}</td>
                    <td className="px-2 py-1">{u.role}</td>
                    <td className="px-2 py-1">{u.is_active ? 'yes' : 'no'}</td>
                  </tr>
                ))}
                {!items.length && !loading && (
                  <tr><td className="px-2 py-2 text-gray-500" colSpan={5}>No users.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
