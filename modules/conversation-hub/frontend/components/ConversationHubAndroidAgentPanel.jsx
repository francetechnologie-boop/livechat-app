import React, { useEffect, useMemo, useState } from 'react';

function SmallButton({ kind = 'secondary', disabled, onClick, children, title }) {
  const isPrimary = kind === 'primary';
  const isDanger = kind === 'danger';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={[
        'text-xs px-2 py-1 rounded border',
        isDanger
          ? 'bg-red-600 text-white border-red-700 hover:bg-red-700'
          : isPrimary
          ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
          : 'bg-white hover:bg-gray-50',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function fmtAgo(ts) {
  const t = ts ? Date.parse(ts) : 0;
  if (!t) return '';
  const diff = Date.now() - t;
  if (!Number.isFinite(diff) || diff < 0) return '';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function ConversationHubAndroidAgentPanel() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permitted, setPermitted] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [orgId, setOrgId] = useState('default');
  const [items, setItems] = useState([]);
  const [devices, setDevices] = useState([]);

  const [newEmail, setNewEmail] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newEnabled, setNewEnabled] = useState(true);

  const [selectedId, setSelectedId] = useState(null);
  const [password, setPassword] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');

  const selected = useMemo(() => {
    const id = selectedId != null ? Number(selectedId) : null;
    if (!id) return null;
    return (items || []).find((x) => Number(x?.id) === id) || null;
  }, [items, selectedId]);

  const load = async () => {
    setError('');
    setNotice('');
    setGeneratedPassword('');
    setLoading(true);
    try {
      const r = await fetch('/api/conversation-hub/android-users', { credentials: 'include' });
      if (r.status === 401 || r.status === 403) {
        setPermitted(false);
        setLoading(false);
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'load_failed');
      setPermitted(true);
      setOrgId(String(j?.org_id || 'default'));
      setItems(Array.isArray(j?.items) ? j.items : []);
      setDevices(Array.isArray(j?.devices) ? j.devices : []);
      // pick first enabled as default selection
      try {
        const firstEnabled = (Array.isArray(j?.items) ? j.items : []).find((x) => x && x.enabled);
        if (firstEnabled && firstEnabled.id != null) setSelectedId(Number(firstEnabled.id));
      } catch {}
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createUser = async () => {
    const em = String(newEmail || '').trim().toLowerCase();
    if (!em) return setError('Email required');
    setError('');
    setNotice('');
    setGeneratedPassword('');
    setSaving(true);
    try {
      const r = await fetch('/api/conversation-hub/android-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: em, label: String(newLabel || '').trim() || null, enabled: !!newEnabled }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'save_failed');
      setNotice('Saved Android user.');
      setNewEmail('');
      setNewLabel('');
      setNewEnabled(true);
      await load();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveUser = async (u) => {
    const id = Number(u?.id);
    if (!id) return;
    setError('');
    setNotice('');
    setGeneratedPassword('');
    setSaving(true);
    try {
      const r = await fetch('/api/conversation-hub/android-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id,
          email: String(u?.email || '').trim().toLowerCase(),
          label: String(u?.label || '').trim() || null,
          enabled: !!u?.enabled,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'save_failed');
      setNotice('Saved.');
      await load();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (u) => {
    const id = Number(u?.id);
    if (!id) return;
    if (!window.confirm(`Delete Android user "${u?.email || ''}"?`)) return;
    setError('');
    setNotice('');
    setGeneratedPassword('');
    setSaving(true);
    try {
      const r = await fetch(`/api/conversation-hub/android-users/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'delete_failed');
      setNotice('Deleted.');
      setSelectedId(null);
      await load();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const disconnectUser = async (u) => {
    const id = Number(u?.id);
    if (!id) return;
    if (!window.confirm(`Disconnect "${u?.email || ''}"? (clears last_seen/devices until the app sends a new heartbeat)`)) return;
    setError('');
    setNotice('');
    setGeneratedPassword('');
    setSaving(true);
    try {
      const r = await fetch(`/api/conversation-hub/android-users/${encodeURIComponent(String(id))}/disconnect`, {
        method: 'POST',
        credentials: 'include',
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'disconnect_failed');
      setNotice(`Disconnected (cleared devices: ${j?.deleted?.clients ?? 0}).`);
      await load();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const setPasswordForSelected = async ({ generate }) => {
    if (!selected) return setError('Select a user first');
    const id = Number(selected.id);
    if (!id) return setError('Select a user first');
    const pwd = String(password || '').trim();
    if (!generate && !pwd) return setError('Password required');
    if (!window.confirm('This will reset the password for that agent account. Continue?')) return;
    setError('');
    setNotice('');
    setGeneratedPassword('');
    setSaving(true);
    try {
      const r = await fetch('/api/conversation-hub/android-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, email: selected.email, ...(generate ? { generate: true } : { password: pwd }) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'save_failed');
      if (j?.generated_password) {
        setGeneratedPassword(String(j.generated_password));
        setNotice('Generated a new password (copy it now).');
      } else {
        setNotice('Password updated.');
      }
      setPassword('');
      await load();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const connectedCount = useMemo(() => (items || []).filter((x) => x && x.enabled && x.connected).length, [items]);

  if (!permitted) {
    return (
      <div className="rounded border bg-white">
        <div className="px-3 py-2 border-b font-medium">Android app</div>
        <div className="p-3 text-sm text-gray-600">Admin only.</div>
      </div>
    );
  }

  return (
    <div className="rounded border bg-white">
      <div className="px-3 py-2 border-b font-medium flex items-center justify-between gap-2">
        <div>Android app</div>
        <div className="flex items-center gap-2">
          <SmallButton onClick={load} disabled={loading || saving} title="Reload Android settings">
            {loading ? 'Loading…' : 'Reload'}
          </SmallButton>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="text-sm">
          <div>
            <span className="font-medium">Org:</span> <span className="font-mono">{orgId}</span>
          </div>
          <div>
            <span className="font-medium">Status:</span>{' '}
            <span className={connectedCount ? 'text-green-700' : 'text-gray-600'}>
              {connectedCount ? `${connectedCount} connected` : 'no connected device'}
            </span>
          </div>
        </div>

        <div className="rounded border bg-gray-50 p-2">
          <div className="text-xs text-gray-700 font-medium mb-2">Android users (stored in DB)</div>
          {items.length === 0 ? (
            <div className="text-xs text-gray-600">No Android users configured yet.</div>
          ) : (
            <div className="space-y-1">
              {items.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-xs text-gray-800">
                  <input
                    type="radio"
                    name="android-user"
                    checked={Number(selectedId) === Number(u.id)}
                    onChange={() => setSelectedId(Number(u.id))}
                  />
                  <span className="font-mono">{u.email}</span>
                  {u.label ? <span className="text-gray-600">{u.label}</span> : null}
                  <span className={u.connected ? 'text-green-700' : 'text-gray-500'}>
                    {u.connected ? 'connected' : 'offline'}
                  </span>
                  {u.last_seen ? <span className="text-gray-500">({fmtAgo(u.last_seen)})</span> : null}
                  {!u.enabled ? <span className="text-red-700">disabled</span> : null}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Add Android user email</label>
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="android-agent@example.com"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Label (optional)</label>
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Android tablet front desk"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={newEnabled} onChange={(e) => setNewEnabled(!!e.target.checked)} />
              enabled
            </label>
            <SmallButton kind="primary" disabled={saving || loading} onClick={createUser} title="Create or update by email">
              Add
            </SmallButton>
          </div>
        </div>

        {selected ? (
          <div className="rounded border p-2 bg-white space-y-2">
            <div className="text-xs text-gray-700 font-medium">Selected user</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Email</label>
                <input
                  className="w-full border rounded px-2 py-1 text-sm font-mono"
                  value={selected.email}
                  onChange={(e) => {
                    const next = String(e.target.value || '').trim().toLowerCase();
                    setItems((prev) => prev.map((x) => (Number(x.id) === Number(selected.id) ? { ...x, email: next } : x)));
                  }}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Label</label>
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={selected.label || ''}
                  onChange={(e) => {
                    const next = String(e.target.value || '');
                    setItems((prev) => prev.map((x) => (Number(x.id) === Number(selected.id) ? { ...x, label: next } : x)));
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={!!selected.enabled}
                    onChange={(e) => {
                      const next = !!e.target.checked;
                      setItems((prev) => prev.map((x) => (Number(x.id) === Number(selected.id) ? { ...x, enabled: next } : x)));
                    }}
                  />
                  enabled
                </label>
                <SmallButton kind="primary" disabled={saving || loading} onClick={() => saveUser(selected)}>
                  Save
                </SmallButton>
                <SmallButton disabled={saving || loading} onClick={() => disconnectUser(selected)} title="Clear server-side heartbeat/devices for this user">
                  Disconnect
                </SmallButton>
                <SmallButton kind="danger" disabled={saving || loading} onClick={() => deleteUser(selected)}>
                  Delete
                </SmallButton>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-600 mb-1">Set / reset password (optional)</label>
                <input
                  className="w-full border rounded px-2 py-1 text-sm font-mono"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="new password…"
                />
                <div className="text-[11px] text-gray-500 mt-1">We never show existing passwords; only set/reset.</div>
              </div>
              <div className="flex items-center gap-2">
                <SmallButton kind="danger" disabled={saving || loading} onClick={() => setPasswordForSelected({ generate: false })}>
                  Set password
                </SmallButton>
                <SmallButton kind="danger" disabled={saving || loading} onClick={() => setPasswordForSelected({ generate: true })}>
                  Generate
                </SmallButton>
              </div>
            </div>
          </div>
        ) : null}

        {generatedPassword ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-2">
            <div className="text-xs text-amber-900 font-medium">Generated password (copy now)</div>
            <div className="font-mono text-sm break-all">{generatedPassword}</div>
          </div>
        ) : null}

        {devices && devices.length ? (
          <div className="rounded border bg-gray-50 p-2">
            <div className="text-xs text-gray-700 font-medium mb-2">Recent Android devices</div>
            <div className="space-y-1">
              {devices.map((d) => (
                <div key={`${orgId}-${d.device_id}`} className="text-xs text-gray-700 flex flex-wrap gap-2">
                  <span className="font-mono">{d.device_id}</span>
                  {d.app_version ? <span className="text-gray-500">v{d.app_version}</span> : null}
                  {d.agent_email ? <span className="text-gray-500">{d.agent_email}</span> : null}
                  {d.last_seen ? <span className="text-gray-500">{fmtAgo(d.last_seen)}</span> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <div className="text-sm text-red-700">{error}</div> : null}
        {notice ? <div className="text-sm text-green-700">{notice}</div> : null}
      </div>
    </div>
  );
}
