import React, { useEffect, useState } from 'react';

export default function Organization() {
  const [org, setOrg] = useState(null);
  const [form, setForm] = useState({
    name: '', contact_email: '', logo_url: '', locale: '',
    timezone: '', default_lang: '',
    brand_logo_light: '', brand_logo_dark: '', favicon_url: '',
    theme_primary: '', theme_accent: '',
    allowed_email_domains_text: '', ip_allowlist_text: '',
    sso_required: false, invite_policy: '', data_retention_days: '', audit_log_enabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Agents', 'Organization'] })); } catch {} }, []);

  const load = async () => {
    setLoading(true); setError(''); setMsg('');
    try {
      const r = await fetch('/api/agents/organization', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      const o = j.organization || {};
      setOrg(o);
      setForm({
        name: o.name || '',
        contact_email: o.contact_email || '',
        logo_url: o.logo_url || '',
        locale: o.locale || '',
        timezone: o.timezone || '',
        default_lang: o.default_lang || '',
        brand_logo_light: o.brand_logo_light || '',
        brand_logo_dark: o.brand_logo_dark || '',
        favicon_url: o.favicon_url || '',
        theme_primary: o.theme_primary || '',
        theme_accent: o.theme_accent || '',
        allowed_email_domains_text: Array.isArray(o.allowed_email_domains) ? o.allowed_email_domains.join(', ') : '',
        ip_allowlist_text: Array.isArray(o.ip_allowlist) ? o.ip_allowlist.join(', ') : '',
        sso_required: !!o.sso_required,
        invite_policy: o.invite_policy || '',
        data_retention_days: (o.data_retention_days ?? '') + '',
        audit_log_enabled: !!o.audit_log_enabled,
      });
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setError(''); setMsg('');
    try {
      const payload = {
        name: form.name,
        contact_email: form.contact_email,
        logo_url: form.logo_url,
        locale: form.locale,
        timezone: form.timezone || null,
        default_lang: form.default_lang || null,
        brand_logo_light: form.brand_logo_light || null,
        brand_logo_dark: form.brand_logo_dark || null,
        favicon_url: form.favicon_url || null,
        theme_primary: form.theme_primary || null,
        theme_accent: form.theme_accent || null,
        allowed_email_domains: (form.allowed_email_domains_text||'').split(',').map(s=>s.trim()).filter(Boolean),
        ip_allowlist: (form.ip_allowlist_text||'').split(',').map(s=>s.trim()).filter(Boolean),
        sso_required: !!form.sso_required,
        invite_policy: form.invite_policy || null,
        data_retention_days: form.data_retention_days ? Number(form.data_retention_days) : null,
        audit_log_enabled: !!form.audit_log_enabled,
      };
      const r = await fetch('/api/agents/organization', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j.ok === false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      setMsg('Saved');
      await load();
    } catch (e) { setError(String(e?.message || e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="panel">
        <div className="panel__header">Organization</div>
        <div className="panel__body text-sm text-gray-700">
          {loading ? (
            <div className="text-gray-500 text-sm">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input className="w-full rounded border px-3 py-2" value={form.name} onChange={e=>setForm(f=>({...f, name:e.target.value}))} placeholder="Organization name" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Contact email</label>
                <input className="w-full rounded border px-3 py-2" value={form.contact_email} onChange={e=>setForm(f=>({...f, contact_email:e.target.value}))} placeholder="contact@example.com" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Logo URL</label>
                <input className="w-full rounded border px-3 py-2" value={form.logo_url} onChange={e=>setForm(f=>({...f, logo_url:e.target.value}))} placeholder="https://…/logo.svg" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Locale</label>
                <input className="w-full rounded border px-3 py-2" value={form.locale} onChange={e=>setForm(f=>({...f, locale:e.target.value}))} placeholder="fr, en, …" />
              </div>
              <div className="md:col-span-2 flex items-center gap-2">
                <button className="rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1.5 disabled:opacity-60" onClick={save} disabled={saving}>{saving? 'Saving…' : 'Save'}</button>
                {msg && <span className="text-xs text-green-700">{msg}</span>}
                {error && <span className="text-xs text-red-600">{error}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Advanced fields */}
      <div className="panel">
        <div className="panel__header">Advanced</div>
        <div className="panel__body text-sm text-gray-700">
          {loading ? (
            <div className="text-gray-500 text-sm">Loading.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Timezone</label>
                <input className="w-full rounded border px-3 py-2" value={form.timezone} onChange={e=>setForm(f=>({...f, timezone:e.target.value}))} placeholder="Europe/Prague" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Default language</label>
                <input className="w-full rounded border px-3 py-2" value={form.default_lang} onChange={e=>setForm(f=>({...f, default_lang:e.target.value}))} placeholder="fr" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Brand logo (light)</label>
                <input className="w-full rounded border px-3 py-2" value={form.brand_logo_light} onChange={e=>setForm(f=>({...f, brand_logo_light:e.target.value}))} placeholder="/logos/brand-light.svg" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Brand logo (dark)</label>
                <input className="w-full rounded border px-3 py-2" value={form.brand_logo_dark} onChange={e=>setForm(f=>({...f, brand_logo_dark:e.target.value}))} placeholder="/logos/brand-dark.svg" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Favicon URL</label>
                <input className="w-full rounded border px-3 py-2" value={form.favicon_url} onChange={e=>setForm(f=>({...f, favicon_url:e.target.value}))} placeholder="/favicon.ico" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Theme primary</label>
                <input className="w-full rounded border px-3 py-2" value={form.theme_primary} onChange={e=>setForm(f=>({...f, theme_primary:e.target.value}))} placeholder="#2563eb" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Theme accent</label>
                <input className="w-full rounded border px-3 py-2" value={form.theme_accent} onChange={e=>setForm(f=>({...f, theme_accent:e.target.value}))} placeholder="#0d9488" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Allowed email domains (CSV)</label>
                <input className="w-full rounded border px-3 py-2" value={form.allowed_email_domains_text} onChange={e=>setForm(f=>({...f, allowed_email_domains_text:e.target.value}))} placeholder="acme.fr, autre.fr" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">IP allowlist (CSV)</label>
                <input className="w-full rounded border px-3 py-2" value={form.ip_allowlist_text} onChange={e=>setForm(f=>({...f, ip_allowlist_text:e.target.value}))} placeholder="203.0.113.0/24, 198.51.100.10" />
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.sso_required} onChange={e=>setForm(f=>({...f, sso_required:e.target.checked}))} /> SSO required</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.audit_log_enabled} onChange={e=>setForm(f=>({...f, audit_log_enabled:e.target.checked}))} /> Audit log</label>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Invite policy</label>
                <select className="w-full rounded border px-3 py-2" value={form.invite_policy} onChange={e=>setForm(f=>({...f, invite_policy:e.target.value}))}>
                  <option value="">(none)</option>
                  <option value="open">open</option>
                  <option value="domain">domain</option>
                  <option value="admin_approval">admin_approval</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Data retention (days)</label>
                <input type="number" className="w-full rounded border px-3 py-2" value={form.data_retention_days} onChange={e=>setForm(f=>({...f, data_retention_days:e.target.value}))} placeholder="365" />
              </div>
              <div className="md:col-span-2 flex items-center gap-2">
                <button className="rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1.5 disabled:opacity-60" onClick={save} disabled={saving}>{saving? 'Saving.' : 'Save'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
