import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../utils/api.js';

export default function SettingsPanel() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [mysqlProfileId, setMysqlProfileId] = useState('');
  const [coverageDays, setCoverageDays] = useState(220);

  const profileOptions = useMemo(() => {
    return Array.isArray(profiles) ? profiles : [];
  }, [profiles]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const s = await api('/api/supply-planification/settings');
      setMysqlProfileId(s?.settings?.mysql_profile_id ? String(s.settings.mysql_profile_id) : '');
      setCoverageDays(Number(s?.settings?.coverage_days || 220));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
    try {
      const r = await fetch('/api/db-mysql/profiles', { credentials: 'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setProfiles(j.items || j.profiles || []);
    } catch {}
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body = {
        mysql_profile_id: mysqlProfileId ? Number(mysqlProfileId) : null,
        coverage_days: Number(coverageDays || 220),
      };
      await api('/api/supply-planification/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-semibold">Settings</div>
          <div className="text-xs text-gray-500">Coverage-days planning + MySQL profile selection.</div>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1 rounded border text-sm" onClick={load} disabled={loading || saving}>
            Reload
          </button>
          <button className="px-3 py-1 rounded bg-black text-white text-sm" onClick={save} disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error ? <div className="mb-3 text-sm text-red-600">{error}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded border p-3">
          <div className="text-sm font-semibold mb-2">Coverage days</div>
          <input
            className="w-full border rounded px-2 py-1 text-sm"
            type="number"
            min={1}
            max={3650}
            value={coverageDays}
            onChange={(e) => setCoverageDays(e.target.value)}
          />
          <div className="text-xs text-gray-500 mt-1">Example: 220</div>
        </div>

        <div className="rounded border p-3">
          <div className="text-sm font-semibold mb-2">MySQL profile</div>
          <select
            className="w-full border rounded px-2 py-1 text-sm"
            value={mysqlProfileId}
            onChange={(e) => setMysqlProfileId(e.target.value)}
          >
            <option value="">(not selected)</option>
            {profileOptions.map((p) => (
              <option key={p.id} value={String(p.id)}>
                #{p.id} {p.name || p.host || 'profile'}
              </option>
            ))}
          </select>
          <div className="text-xs text-gray-500 mt-1">Loaded from `db-mysql` module profiles.</div>
        </div>
      </div>
    </div>
  );
}

