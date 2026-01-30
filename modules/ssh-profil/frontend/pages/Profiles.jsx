import React from 'react';
import ProfileForm from '../components/ProfileForm.jsx';
import ProfilesList from '../components/ProfilesList.jsx';
import TestResultPanel from '../components/TestResultPanel.jsx';

function getOrgIdFromLocation() {
  try {
    const u = new URL(window.location.href);
    const v = u.searchParams.get('org_id');
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const opts = { credentials: 'include', ...options };
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(String(j?.message || j?.error || r.status));
  if (j && j.ok === false) throw new Error(String(j?.message || j?.error || 'request_failed'));
  return j;
}

export default function SshProfilProfilesPage() {
  const [items, setItems] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [orgId, setOrgId] = React.useState(getOrgIdFromLocation());
  const [form, setForm] = React.useState({ port: 22 });
  const [lastTest, setLastTest] = React.useState(null);

  const load = async () => {
    setBusy(true); setMsg('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(String(orgId))}` : '';
      const j = await api(`/api/ssh-profil/profiles${q}`);
      setItems(j.items || []);
    } catch (e) {
      setItems([]);
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => { load(); }, [orgId]);

  const reset = () => {
    setForm({ port: 22 });
    setLastTest(null);
  };

  const save = async () => {
    setBusy(true); setMsg('');
    try {
      const body = { ...form, port: Number(form.port || 22) || 22 };
      if (orgId) body.org_id = orgId;
      await api('/api/ssh-profil/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await load();
      reset();
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (it) => {
    const id = it?.id;
    if (!id) return;
    setBusy(true); setMsg('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(String(orgId))}` : '';
      await api(`/api/ssh-profil/profiles/${id}${q}`, { method: 'DELETE' });
      await load();
      setLastTest(null);
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const test = async (it) => {
    const id = it?.id;
    if (!id) return;
    setBusy(true); setMsg('');
    try {
      const body = { profile_id: id };
      if (orgId) body.org_id = orgId;
      const j = await api('/api/ssh-profil/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setLastTest(j?.result || null);
      setMsg(j?.result?.ok ? 'OK (connected)' : String(j?.result?.message || 'Test failed'));
    } catch (e) {
      setLastTest(null);
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const edit = (it) => {
    setLastTest(null);
    setForm({
      id: it.id,
      name: it.name,
      host: it.host,
      port: it.port,
      username: it.username,
      key_path: it.key_path || '',
      has_password: !!it.has_password,
      password: '',
      clear_password: false,
    });
  };

  return (
    <div className="panel">
      <div className="panel__header flex items-center justify-between">
        <span>SSH Profil – Profiles</span>
        <div className="text-xs text-gray-500">Manage SSH profiles and test access</div>
      </div>
      <div className="panel__body">
        {msg ? <div className="text-xs text-red-600 mb-2">{msg}</div> : null}

        <div className="flex items-center gap-2 mb-3">
          <div className="text-xs text-gray-600">org_id (optional):</div>
          <input
            className="border rounded px-2 py-1 w-28 text-sm"
            type="number"
            placeholder="(none)"
            value={orgId ?? ''}
            onChange={(e) => setOrgId(e.target.value ? Number(e.target.value) : null)}
          />
          <button className="px-2 py-1 border rounded text-xs" disabled={busy} onClick={load}>Reload</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ProfileForm busy={busy} orgId={orgId} value={form} onChange={setForm} onSave={save} onReset={reset} />
          <ProfilesList items={items} busy={busy} onEdit={edit} onTest={test} onDelete={del} />
        </div>

        <TestResultPanel result={lastTest} />
      </div>
    </div>
  );
}
