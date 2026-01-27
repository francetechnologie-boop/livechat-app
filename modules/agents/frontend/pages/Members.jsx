import React, { useEffect, useState } from 'react';

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <div className="text-gray-700 mb-1">{label}</div>
      {children}
    </label>
  );
}

export default function Members() {
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ agent_id: '', role_id: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [ru, rr, rm] = await Promise.all([
        fetch('/api/agents/users', { credentials: 'include' }),
        fetch('/api/agents/roles', { credentials: 'include' }),
        fetch('/api/agents/members', { credentials: 'include' }),
      ]);
      const ju = await ru.json(); const jr = await rr.json(); const jm = await rm.json();
      if (!ju.ok || !jr.ok || !jm.ok) throw new Error('load_failed');
      setUsers(Array.isArray(ju.items) ? ju.items : []);
      setRoles(Array.isArray(jr.items) ? jr.items : []);
      setItems(Array.isArray(jm.items) ? jm.items : []);
    } catch (e) { setError('Unable to load memberships'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Agents', 'Members (RBAC)'] })); } catch {} }, []);

  const onAdd = async (e) => {
    e?.preventDefault?.(); setSaving(true); setError('');
    try {
      const r = await fetch('/api/agents/members', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(form) });
      const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error||'save_failed');
      setForm({ agent_id:'', role_id:'' });
      load();
    } catch (e) { setError(e?.message||'save_failed'); } finally { setSaving(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="panel">
        <div className="panel__header">Members (RBAC)</div>
        <div className="panel__body space-y-4">
          {error && <div className="text-xs text-red-600">{error}</div>}
          <form onSubmit={onAdd} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="User">
              <select className="input w-full" value={form.agent_id} onChange={(e)=>setForm(v=>({ ...v, agent_id: e.target.value }))} required>
                <option value="">Select…</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </Field>
            <Field label="Role">
              <select className="input w-full" value={form.role_id} onChange={(e)=>setForm(v=>({ ...v, role_id: e.target.value }))} required>
                <option value="">Select…</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.role}</option>)}
              </select>
            </Field>
            <div className="flex items-end"><button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : 'Add'}</button></div>
          </form>

          <div className="overflow-auto">
            <table className="table-auto text-sm min-w-[700px]">
              <thead>
                <tr className="text-left">
                  <th className="px-2 py-1">User</th>
                  <th className="px-2 py-1">Role</th>
                </tr>
              </thead>
              <tbody>
                {items.map(m => (
                  <tr key={m.id} className="border-t">
                    <td className="px-2 py-1">{m.agent_name || m.agent_email}</td>
                    <td className="px-2 py-1">{m.role_name}</td>
                  </tr>
                ))}
                {!items.length && !loading && (
                  <tr><td className="px-2 py-2 text-gray-500" colSpan={2}>No memberships.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
