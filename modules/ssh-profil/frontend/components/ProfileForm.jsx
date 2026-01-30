import React from 'react';

export default function ProfileForm({ busy, orgId, value, onChange, onSave, onReset }) {
  const v = value || {};
  const set = (patch) => onChange?.({ ...v, ...patch });
  const showOrg = orgId != null && orgId !== '';
  const editing = !!v.id;
  const hasPassword = !!v.has_password;

  return (
    <div>
      <div className="text-sm font-semibold mb-1">Create / Update</div>
      <div className="space-y-2 text-sm">
        {showOrg ? (
          <div className="text-[11px] text-gray-500">Scope: org_id={String(orgId)}</div>
        ) : null}
        <input className="border rounded px-2 py-1 w-full" placeholder="Profile name" value={v.name || ''} onChange={(e) => set({ name: e.target.value })} />
        <input className="border rounded px-2 py-1 w-full" placeholder="SSH host" value={v.host || ''} onChange={(e) => set({ host: e.target.value })} />
        <div className="flex items-center gap-2">
          <input className="border rounded px-2 py-1 w-full" placeholder="SSH user" value={v.username || ''} onChange={(e) => set({ username: e.target.value })} />
          <input className="border rounded px-2 py-1 w-28" type="number" placeholder="Port" value={v.port ?? 22} onChange={(e) => set({ port: e.target.value })} />
        </div>
        <input className="border rounded px-2 py-1 w-full" placeholder="SSH key path (optional, on server)" value={v.key_path || ''} onChange={(e) => set({ key_path: e.target.value })} />
        <input
          className="border rounded px-2 py-1 w-full"
          type="password"
          placeholder={hasPassword && editing ? 'Password (leave blank to keep)' : 'SSH password (optional)'}
          value={v.password || ''}
          onChange={(e) => set({ password: e.target.value, clear_password: false })}
        />
        {editing && hasPassword ? (
          <label className="text-xs inline-flex items-center gap-1">
            <input type="checkbox" checked={!!v.clear_password} onChange={(e) => set({ clear_password: !!e.target.checked, password: '' })} />
            clear stored password
          </label>
        ) : null}
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 border rounded" disabled={busy} onClick={onSave}>Save</button>
          <button className="px-3 py-1.5 border rounded" disabled={busy} onClick={onReset}>Reset</button>
        </div>
        <div className="text-[11px] text-gray-500">
          Tip: Provide either a key path (on the server running LiveChat) or a password for testing.
        </div>
      </div>
    </div>
  );
}
