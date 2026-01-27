import React from 'react';

const DEFAULT_FORM = {
  id: null,
  name: '',
  ssh_host: '',
  ssh_user: '',
  ssh_port: '',
  ssh_key_path: '',
  log_path: '',
};

export default function ConnectionSettingsPanel({ headers }) {
  const [mode, setMode] = React.useState('profiles'); // profiles | legacy
  const [profiles, setProfiles] = React.useState([]);
  const [selectedProfileId, setSelectedProfileId] = React.useState(''); // ''=auto/default, '__new__'=new, number as string
  const [form, setForm] = React.useState(DEFAULT_FORM);
  const [legacyForm, setLegacyForm] = React.useState(DEFAULT_FORM);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [configured, setConfigured] = React.useState(false); // legacy configured
  const [source, setSource] = React.useState('env'); // legacy source
  const [activeSrc, setActiveSrc] = React.useState('');

  const loadLegacy = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/security/settings', { headers });
      const data = await response.json().catch(() => null);
      if (data && data.ok) {
        setLegacyForm({
          id: null,
          name: '',
          ssh_host: data.config.ssh_host || '',
          ssh_user: data.config.ssh_user || '',
          ssh_port: data.config.ssh_port ? String(data.config.ssh_port) : '',
          ssh_key_path: data.config.ssh_key_path || '',
          log_path: data.config.log_path || '',
        });
        setConfigured(!!data.config.ssh_host);
        setSource(data.source || (data.config.ssh_host ? 'db' : 'env'));
        setMessage('');
      } else {
        setMessage('Unable to load settings.');
      }
    } catch {
      setMessage('Unable to load settings.');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  const loadProfiles = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/security/remote/connections', { headers });
      const data = await response.json().catch(() => null);
      if (data && data.ok) {
        const list = Array.isArray(data.connections) ? data.connections : [];
        setProfiles(list);
        setActiveSrc(String(data?.active?.src || ''));
        setMessage('');

        const activeId = data?.active?.connection_id ? String(data.active.connection_id) : '';
        setSelectedProfileId((prev) => {
          if (prev === '__new__') return prev;
          if (prev && list.some((x) => String(x?.id) === String(prev))) return String(prev);
          if (activeId && list.some((x) => String(x?.id) === activeId)) return activeId;
          return '';
        });
      } else {
        setProfiles([]);
        setActiveSrc('');
        setMessage('Unable to load profiles.');
      }
    } catch {
      setProfiles([]);
      setActiveSrc('');
      setMessage('Unable to load profiles.');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  React.useEffect(() => { loadLegacy(); }, [loadLegacy]);
  React.useEffect(() => { loadProfiles(); }, [loadProfiles]);

  React.useEffect(() => {
    if (mode !== 'profiles') return;
    if (selectedProfileId === '__new__') {
      setForm(DEFAULT_FORM);
      return;
    }
    if (!selectedProfileId) {
      setForm(DEFAULT_FORM);
      return;
    }
    const hit = profiles.find((p) => String(p?.id) === String(selectedProfileId));
    if (!hit) {
      setForm(DEFAULT_FORM);
      return;
    }
    setForm({
      id: hit.id,
      name: hit.name || '',
      ssh_host: hit.ssh_host || '',
      ssh_user: hit.ssh_user || '',
      ssh_port: hit.ssh_port ? String(hit.ssh_port) : '',
      ssh_key_path: hit.ssh_key_path || '',
      log_path: hit.log_path || '',
    });
  }, [mode, selectedProfileId, profiles]);

  const saveLegacy = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/security/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          ssh_host: legacyForm.ssh_host,
          ssh_user: legacyForm.ssh_user,
          ssh_port: legacyForm.ssh_port,
          ssh_key_path: legacyForm.ssh_key_path,
          log_path: legacyForm.log_path,
        }),
      });
      const data = await response.json().catch(() => null);
      if (data && data.ok) {
        setMessage('Configuration saved.');
        setConfigured(!!data.config.ssh_host);
        setSource(data.source || (data.config.ssh_host ? 'db' : 'env'));
      } else {
        setMessage('Failed to save configuration.');
      }
    } catch {
      setMessage('Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async ({ setDefault = false } = {}) => {
    setSaving(true);
    try {
      const response = await fetch('/api/security/remote/connections', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: form.id || undefined,
          name: form.name,
          ssh_host: form.ssh_host,
          ssh_user: form.ssh_user,
          ssh_port: form.ssh_port,
          ssh_key_path: form.ssh_key_path,
          log_path: form.log_path,
          set_default: Boolean(setDefault),
        }),
      });
      const data = await response.json().catch(() => null);
      if (data && data.ok) {
        setMessage(setDefault ? 'Profile saved and set as default.' : 'Profile saved.');
        await loadProfiles();
        if (data?.connection?.id) setSelectedProfileId(String(data.connection.id));
      } else {
        setMessage(String(data?.message || (data?.error === 'conflict' ? 'Name already exists.' : 'Failed to save profile.')));
      }
    } catch {
      setMessage('Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async () => {
    const id = String(form.id || '').trim();
    if (!id) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/security/remote/connections/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      const data = await response.json().catch(() => null);
      if (data && data.ok) {
        setMessage('Profile deleted.');
        setSelectedProfileId('');
        setForm(DEFAULT_FORM);
        await loadProfiles();
      } else {
        setMessage('Failed to delete profile.');
      }
    } catch {
      setMessage('Failed to delete profile.');
    } finally {
      setSaving(false);
    }
  };

  const testCurrent = async () => {
    setTesting(true);
    try {
      const body = mode === 'legacy'
        ? {
          ssh_host: legacyForm.ssh_host,
          ssh_user: legacyForm.ssh_user,
          ssh_port: legacyForm.ssh_port,
          ssh_key_path: legacyForm.ssh_key_path,
          log_path: legacyForm.log_path,
        }
        : (form.id ? { id: form.id } : {
          ssh_host: form.ssh_host,
          ssh_user: form.ssh_user,
          ssh_port: form.ssh_port,
          ssh_key_path: form.ssh_key_path,
          log_path: form.log_path,
        });
      const response = await fetch('/api/security/remote/connections/test', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (data && data.ok) {
        const r = data.result || {};
        if (r && r.ok && r.configured) {
          const elapsed = Number(r.elapsed_ms) ? ` (${r.elapsed_ms}ms)` : '';
          setMessage(`Connection OK${elapsed}.`);
        } else if (r && r.configured === false) {
          setMessage(String(r.message || 'Not configured.'));
        } else {
          setMessage(String(r.message || 'Test finished.'));
        }
      } else {
        setMessage(String(data?.message || 'Test failed.'));
      }
    } catch {
      setMessage('Test failed.');
    } finally {
      setTesting(false);
    }
  };

  const updateField = (key, value) => {
    if (mode === 'legacy') setLegacyForm((prev) => ({ ...prev, [key]: value }));
    else setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="h-full min-h-0 border rounded bg-white flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <div className="text-sm font-semibold">Remote log settings</div>
        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
            disabled={saving || loading}
            title="Profiles are recommended; Legacy keeps the old single-config behavior."
          >
            <option value="profiles">Profiles</option>
            <option value="legacy">Legacy</option>
          </select>
          <button
            className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            onClick={testCurrent}
            disabled={testing || saving || loading}
            title="Quick SSH + log-path readability test"
          >
            {testing ? 'Testing…' : 'Test'}
          </button>
          {mode === 'legacy' ? (
            <button
              className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
              onClick={saveLegacy}
              disabled={saving || loading}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          ) : (
            <>
              <button
                className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
                onClick={() => saveProfile({ setDefault: false })}
                disabled={saving || loading}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
                onClick={() => saveProfile({ setDefault: true })}
                disabled={saving || loading}
                title="Save + set as default for Remote Apache log"
              >
                Save + Default
              </button>
              <button
                className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
                onClick={deleteProfile}
                disabled={saving || loading || !form.id}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      <div className="px-3 py-2 text-xs text-gray-600 bg-gray-50 border-b">
        {mode === 'legacy'
          ? <>Values are scoped to the database; leave empty to clear. {configured ? `Active source: ${source}` : 'Not configured yet.'}</>
          : <>Profiles are stored in the database. Current auto source: {activeSrc || 'unknown'}.</>
        }
      </div>
      <div className="p-3 flex-1 min-h-0 space-y-3">
        {message ? (
          <div className={`px-2 py-1 text-sm rounded ${message.startsWith('Failed') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
            {message}
          </div>
        ) : null}

        {mode === 'profiles' ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col text-sm gap-1">
              <span>Profile</span>
              <select
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
                disabled={saving || loading}
              >
                <option value="">(default / auto)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.is_default ? '★ ' : ''}{p.name}
                  </option>
                ))}
                <option value="__new__">+ New profile…</option>
              </select>
            </label>
          </div>
        ) : null}

        {mode === 'profiles' ? (
          <label className="flex flex-col text-sm gap-1">
            <span>Profile name</span>
            <input
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="prod-vps"
              className="border rounded px-2 py-1 text-sm"
              disabled={selectedProfileId === ''}
              title={selectedProfileId === '' ? 'Select an existing profile or create a new one.' : ''}
            />
          </label>
        ) : null}

        <label className="flex flex-col text-sm gap-1">
          <span>SSH host</span>
          <input
            value={mode === 'legacy' ? legacyForm.ssh_host : form.ssh_host}
            onChange={(e) => updateField('ssh_host', e.target.value)}
            placeholder="185.97.146.187"
            className="border rounded px-2 py-1 text-sm"
            disabled={mode === 'profiles' && selectedProfileId === ''}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          <span>SSH user</span>
          <input
            value={mode === 'legacy' ? legacyForm.ssh_user : form.ssh_user}
            onChange={(e) => updateField('ssh_user', e.target.value)}
            placeholder="root"
            className="border rounded px-2 py-1 text-sm"
            disabled={mode === 'profiles' && selectedProfileId === ''}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          <span>SSH port</span>
          <input
            value={mode === 'legacy' ? legacyForm.ssh_port : form.ssh_port}
            onChange={(e) => updateField('ssh_port', e.target.value)}
            placeholder="22"
            className="border rounded px-2 py-1 text-sm"
            disabled={mode === 'profiles' && selectedProfileId === ''}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          <span>SSH key path (optional)</span>
          <input
            value={mode === 'legacy' ? legacyForm.ssh_key_path : form.ssh_key_path}
            onChange={(e) => updateField('ssh_key_path', e.target.value)}
            placeholder="/root/.ssh/id_ed25519"
            className="border rounded px-2 py-1 text-sm"
            disabled={mode === 'profiles' && selectedProfileId === ''}
          />
        </label>
        <label className="flex flex-col text-sm gap-1">
          <span>Remote log path</span>
          <input
            value={mode === 'legacy' ? legacyForm.log_path : form.log_path}
            onChange={(e) => updateField('log_path', e.target.value)}
            placeholder="/var/log/apache2/access_unified_website.log"
            className="border rounded px-2 py-1 text-sm"
            disabled={mode === 'profiles' && selectedProfileId === ''}
          />
        </label>

        {mode === 'profiles' && selectedProfileId === '' ? (
          <div className="text-xs text-gray-600">
            Using auto/default source. Choose an existing profile to edit, or create a new one.
          </div>
        ) : null}
      </div>
    </div>
  );
}
