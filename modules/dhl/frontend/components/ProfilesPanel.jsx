import React from 'react';

function normalizeCC(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return '';
  return /^[A-Z]{2}$/.test(s) ? s : '';
}

function InputRow({ label, hint, children }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start">
      <div className="md:pt-2">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        {hint ? <div className="text-xs text-gray-600 mt-0.5">{hint}</div> : null}
      </div>
      <div className="md:col-span-2">{children}</div>
    </div>
  );
}

function useLocalStorageState(key, initialValue) {
  const [val, setVal] = React.useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initialValue;
      return raw;
    } catch { return initialValue; }
  });
  React.useEffect(() => {
    try {
      if (val == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(val));
    } catch {}
  }, [key, val]);
  return [val, setVal];
}

export default function ProfilesPanel({ orgId, onProfilesChanged }) {
  const [adminToken, setAdminToken] = useLocalStorageState('dhl:admin_token', '');
  const [profiles, setProfiles] = React.useState([]);
  const [mysqlProfiles, setMysqlProfiles] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [msg, setMsg] = React.useState('');

  const [createForm, setCreateForm] = React.useState({
    name: 'Default',
    api_key: '',
    mysql_profile_id: '',
    presta_prefix: 'ps_',
    language: 'en',
    service: 'express',
    origin_country_code: '',
    requester_country_code: '',
    is_default: true,
  });

  const headersBase = React.useMemo(() => {
    const h = {};
    if (orgId) h['X-Org-Id'] = orgId;
    return h;
  }, [orgId]);

  const headersAdmin = React.useMemo(() => {
    const h = { ...headersBase };
    if (adminToken && String(adminToken).trim()) h['X-Admin-Token'] = String(adminToken).trim();
    return h;
  }, [headersBase, adminToken]);

  const loadProfiles = React.useCallback(async () => {
    setError('');
    setMsg('');
    try {
      const r = await fetch('/api/dhl/profiles', { credentials: 'include', headers: headersBase });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setProfiles(Array.isArray(j?.items) ? j.items : []);
    } catch (e) {
      setProfiles([]);
      setError(e?.message || String(e));
    }
  }, [headersBase]);

  const loadMysqlProfiles = React.useCallback(async () => {
    try {
      const r = await fetch('/api/dhl/mysql/profiles', { credentials: 'include', headers: headersBase });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setMysqlProfiles(Array.isArray(j?.items) ? j.items : []);
    } catch {
      setMysqlProfiles([]);
    }
  }, [headersBase]);

  React.useEffect(() => { loadProfiles(); loadMysqlProfiles(); }, [loadProfiles, loadMysqlProfiles]);

  const createProfile = async () => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const body = {
        name: createForm.name,
        api_key: createForm.api_key || undefined,
        mysql_profile_id: createForm.mysql_profile_id ? Number(createForm.mysql_profile_id) : null,
        presta_prefix: createForm.presta_prefix,
        language: createForm.language || null,
        service: createForm.service || null,
        origin_country_code: normalizeCC(createForm.origin_country_code) || null,
        requester_country_code: normalizeCC(createForm.requester_country_code) || null,
        is_default: createForm.is_default === true,
      };
      const r = await fetch('/api/dhl/profiles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...headersAdmin },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setMsg('Profile created.');
      setCreateForm((p) => ({ ...p, api_key: '' }));
      await loadProfiles();
      try { onProfilesChanged?.(); } catch {}
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateProfile = async (id, patch) => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const r = await fetch(`/api/dhl/profiles/${encodeURIComponent(String(id))}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...headersAdmin },
        body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setMsg('Profile saved.');
      await loadProfiles();
      try { onProfilesChanged?.(); } catch {}
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteProfile = async (id) => {
    if (!confirm('Delete this DHL profile?')) return;
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const r = await fetch(`/api/dhl/profiles/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: headersAdmin,
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setMsg('Profile deleted.');
      await loadProfiles();
      try { onProfilesChanged?.(); } catch {}
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 rounded border bg-white">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">DHL Profiles</div>
          <div className="text-xs text-gray-600">Stored in DB (per org). API key is never returned by the server.</div>
        </div>
        <button className="text-xs underline text-gray-700" onClick={loadProfiles}>Reload</button>
      </div>

      <div className="mt-3 p-3 rounded border bg-gray-50">
        <div className="text-sm font-medium mb-2">Admin</div>
        <InputRow label="Admin token" hint="Required for create/update/delete. Stored in your browser localStorage.">
          <input
            className="w-full border rounded px-2 py-1 text-sm"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="x-admin-token"
          />
        </InputRow>
      </div>

      <div className="mt-3 p-3 rounded border bg-gray-50">
        <div className="text-sm font-medium mb-2">Create profile</div>
        <div className="space-y-3">
          <InputRow label="Name">
            <input className="w-full border rounded px-2 py-1 text-sm" value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} />
          </InputRow>
          <InputRow label="DHL API key" hint="Shipment Tracking – Unified subscription key (DHL-API-Key).">
            <input className="w-full border rounded px-2 py-1 text-sm" type="password" value={createForm.api_key} onChange={(e) => setCreateForm((p) => ({ ...p, api_key: e.target.value }))} placeholder="••••••••" />
          </InputRow>
          <InputRow label="MySQL profile" hint="Presta DB connection profile (from db-mysql module).">
            <select className="w-full border rounded px-2 py-1 text-sm" value={createForm.mysql_profile_id} onChange={(e) => setCreateForm((p) => ({ ...p, mysql_profile_id: e.target.value }))}>
              <option value="">Select…</option>
              {mysqlProfiles.map((p) => (
                <option key={p.id} value={String(p.id)}>{p.name || `Profile ${p.id}`} ({p.host}:{p.port}/{p.database})</option>
              ))}
            </select>
          </InputRow>
          <InputRow label="Presta prefix">
            <input className="w-full border rounded px-2 py-1 text-sm" value={createForm.presta_prefix} onChange={(e) => setCreateForm((p) => ({ ...p, presta_prefix: e.target.value }))} placeholder="ps_" />
          </InputRow>
          <InputRow label="Defaults" hint="Optional defaults used by tracking endpoints.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input className="border rounded px-2 py-1 text-sm" value={createForm.language} onChange={(e) => setCreateForm((p) => ({ ...p, language: e.target.value }))} placeholder="language (en)" />
              <input className="border rounded px-2 py-1 text-sm" value={createForm.service} onChange={(e) => setCreateForm((p) => ({ ...p, service: e.target.value }))} placeholder="service (express)" />
              <input className="border rounded px-2 py-1 text-sm" value={createForm.origin_country_code} onChange={(e) => setCreateForm((p) => ({ ...p, origin_country_code: e.target.value }))} placeholder="origin CC (FR)" />
              <input className="border rounded px-2 py-1 text-sm" value={createForm.requester_country_code} onChange={(e) => setCreateForm((p) => ({ ...p, requester_country_code: e.target.value }))} placeholder="requester CC (FR)" />
            </div>
          </InputRow>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={createForm.is_default === true} onChange={(e) => setCreateForm((p) => ({ ...p, is_default: e.target.checked }))} />
              Set as default
            </label>
            <button className="px-3 py-1 rounded bg-black text-white text-sm disabled:opacity-50" disabled={busy} onClick={createProfile}>Create</button>
          </div>
        </div>
      </div>

      {error ? <div className="mt-3 text-sm text-red-700 break-words">Error: {error}</div> : null}
      {msg ? <div className="mt-3 text-sm text-green-700">{msg}</div> : null}

      <div className="mt-4">
        <div className="text-sm font-medium mb-2">Existing profiles</div>
        {!profiles.length ? (
          <div className="text-sm text-gray-600">No profiles yet.</div>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => (
              <ProfileCard
                key={p.id}
                prof={p}
                busy={busy}
                mysqlProfiles={mysqlProfiles}
                onSave={updateProfile}
                onDelete={deleteProfile}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProfileCard({ prof, busy, mysqlProfiles, onSave, onDelete }) {
  const [edit, setEdit] = React.useState({
    name: prof.name || '',
    api_key: '',
    mysql_profile_id: prof.mysql_profile_id != null ? String(prof.mysql_profile_id) : '',
    presta_prefix: prof.presta_prefix || 'ps_',
    language: prof.language || '',
    service: prof.service || '',
    origin_country_code: prof.origin_country_code || '',
    requester_country_code: prof.requester_country_code || '',
    is_default: prof.is_default === true,
  });

  React.useEffect(() => {
    setEdit({
      name: prof.name || '',
      api_key: '',
      mysql_profile_id: prof.mysql_profile_id != null ? String(prof.mysql_profile_id) : '',
      presta_prefix: prof.presta_prefix || 'ps_',
      language: prof.language || '',
      service: prof.service || '',
      origin_country_code: prof.origin_country_code || '',
      requester_country_code: prof.requester_country_code || '',
      is_default: prof.is_default === true,
    });
  }, [prof.id, prof.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const patch = {
      name: edit.name,
      mysql_profile_id: edit.mysql_profile_id ? Number(edit.mysql_profile_id) : null,
      presta_prefix: edit.presta_prefix,
      language: edit.language || null,
      service: edit.service || null,
      origin_country_code: normalizeCC(edit.origin_country_code) || null,
      requester_country_code: normalizeCC(edit.requester_country_code) || null,
      is_default: edit.is_default === true,
    };
    if (edit.api_key && String(edit.api_key).trim()) patch.api_key = String(edit.api_key).trim();
    await onSave?.(prof.id, patch);
    setEdit((p) => ({ ...p, api_key: '' }));
  };

  return (
    <div className="p-3 rounded border bg-white">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">
          {prof.name || `Profile ${prof.id}`}
          {prof.is_default ? <span className="ml-2 text-xs px-2 py-0.5 rounded border bg-blue-50 text-blue-800 border-blue-200">default</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button className="text-xs underline text-gray-700 disabled:opacity-50" disabled={busy} onClick={() => onDelete?.(prof.id)}>Delete</button>
        </div>
      </div>
      <div className="mt-2 text-xs text-gray-600">
        API key: {prof.has_api_key ? <span className="font-mono">****{prof.api_key_last4 || ''}</span> : <span className="text-red-700">missing</span>}
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
        <input className="border rounded px-2 py-1 text-sm" value={edit.name} onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))} placeholder="Name" />
        <input className="border rounded px-2 py-1 text-sm" type="password" value={edit.api_key} onChange={(e) => setEdit((p) => ({ ...p, api_key: e.target.value }))} placeholder="New API key (optional)" />
        <select className="border rounded px-2 py-1 text-sm" value={edit.mysql_profile_id} onChange={(e) => setEdit((p) => ({ ...p, mysql_profile_id: e.target.value }))}>
          <option value="">MySQL profile…</option>
          {mysqlProfiles.map((mp) => (
            <option key={mp.id} value={String(mp.id)}>{mp.name || `Profile ${mp.id}`} ({mp.host}:{mp.port}/{mp.database})</option>
          ))}
        </select>
        <input className="border rounded px-2 py-1 text-sm" value={edit.presta_prefix} onChange={(e) => setEdit((p) => ({ ...p, presta_prefix: e.target.value }))} placeholder="Presta prefix (ps_)" />
        <input className="border rounded px-2 py-1 text-sm" value={edit.language} onChange={(e) => setEdit((p) => ({ ...p, language: e.target.value }))} placeholder="language (en)" />
        <input className="border rounded px-2 py-1 text-sm" value={edit.service} onChange={(e) => setEdit((p) => ({ ...p, service: e.target.value }))} placeholder="service (express)" />
        <input className="border rounded px-2 py-1 text-sm" value={edit.origin_country_code} onChange={(e) => setEdit((p) => ({ ...p, origin_country_code: e.target.value }))} placeholder="origin CC (FR)" />
        <input className="border rounded px-2 py-1 text-sm" value={edit.requester_country_code} onChange={(e) => setEdit((p) => ({ ...p, requester_country_code: e.target.value }))} placeholder="requester CC (FR)" />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={edit.is_default === true} onChange={(e) => setEdit((p) => ({ ...p, is_default: e.target.checked }))} />
          Default
        </label>
        <button className="px-3 py-1 rounded bg-black text-white text-sm disabled:opacity-50" disabled={busy} onClick={save}>Save</button>
      </div>
    </div>
  );
}

