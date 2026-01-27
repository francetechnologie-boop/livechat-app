import React from 'react';
import Toast from './Toast.jsx';

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

export default function ProfileSelector({ value, onChange }) {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [orgId, setOrgId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState({ open:false, type:'info', message:'' });

  const profileId = value?.profileId || null;
  const prefix = value?.prefix ?? '';
  React.useEffect(() => { if (value?.orgId !== undefined) setOrgId(value.orgId || ''); }, [value?.orgId]);

  async function load() {
    setLoading(true); setErr('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      // profiles come from db-mysql module
      const p = await api(`/api/db-mysql/profiles${q}`);
      setItems(Array.isArray(p?.items) ? p.items : []);
      // load stored default config for this module (to prefill selection)
      const c = await api(`/api/product_data_update/config${q}`).catch(()=>({}));
      const item = c?.item || null;
      let pid = item?.default_profile_id || null;
      let px = item?.default_prefix || '';
      // Fallback to last-used local storage when no module default is set
      try {
        if (!pid && !px) {
          const raw = localStorage.getItem('pdu:db:last_profile');
          if (raw) {
            const obj = JSON.parse(raw);
            if (!orgId || !obj.orgId || String(obj.orgId) === String(orgId)) {
              pid = obj.profileId || pid;
              px = (obj.prefix != null) ? obj.prefix : px;
            }
          }
        }
      } catch {}
      // Fallback to first available DB profile if still unset
      if (!pid && Array.isArray(p?.items) && p.items.length) {
        pid = p.items[0]?.id || null;
      }
      if (!px) px = '';
      if (onChange) onChange({ profileId: pid, prefix: px, orgId });
    } catch (e) { setErr(String(e.message||e)); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); /* eslint-disable-next-line */ }, [orgId]);

  async function saveConfig() {
    setSaving(true);
    try {
      const body = { org_id: orgId || null, default_profile_id: profileId || null, default_prefix: prefix || '' };
      await api('/api/product_data_update/config', { method:'PUT', body: JSON.stringify(body) });
      setToast({ open:true, type:'success', message:'Saved default profile/prefix.' });
    } catch (e) {
      setToast({ open:true, type:'error', message: String(e?.message || e) || 'Save failed' });
    }
    finally { setSaving(false); }
  }

  return (
    <div className="px-4 pt-4 pb-1 border-b bg-white">
      {toast.open && (
        <Toast open={toast.open} type={toast.type} message={toast.message} onClose={()=>setToast({ open:false, type:'info', message:'' })} />
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500">Org ID (optional)</label>
          <input className="border rounded px-2 py-1 text-sm" placeholder="org id" value={orgId} onChange={e=>{ setOrgId(e.target.value); onChange && onChange({ profileId, prefix, orgId: e.target.value }); }} />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Profile</label>
          <select className="border rounded px-2 py-1 text-sm min-w-[240px]" value={profileId || ''} onChange={e=>{ const next = e.target.value ? Number(e.target.value) : null; onChange && onChange({ profileId: next, prefix, orgId }); try { localStorage.setItem('pdu:db:last_profile', JSON.stringify({ profileId: next, prefix, orgId: orgId || null, when: Date.now() })); } catch {} }} disabled={loading}>
            <option value="">Select profile…</option>
            {items.map(it => (
              <option key={it.id} value={it.id}>{`#${it.id} ${it.name} (${it.host}:${it.port}/${it.database})`}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500">Prefix</label>
          <input className="border rounded px-2 py-1 text-sm w-[120px]" placeholder="ps_" value={prefix} onChange={e=>{ const px = e.target.value; onChange && onChange({ profileId, prefix: px, orgId }); try { localStorage.setItem('pdu:db:last_profile', JSON.stringify({ profileId: profileId || null, prefix: px, orgId: orgId || null, when: Date.now() })); } catch {} }} />
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-sm border rounded" onClick={load} disabled={loading}>{loading? 'Loading…':'Reload'}</button>
          <button className="px-3 py-1.5 text-sm border rounded" onClick={saveConfig} disabled={saving || (!profileId && !prefix)}>{saving? 'Saving…':'Save as Default'}</button>
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
      </div>
    </div>
  );
}
