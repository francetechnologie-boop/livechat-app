import React from 'react';

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

export default function AttrGroupsPanel({ profileId, prefix, orgId }) {
  const [shops, setShops] = React.useState([]);
  const [langs, setLangs] = React.useState([]);
  const [fromLangId, setFromLangId] = React.useState('');
  const [startFrom, setStartFrom] = React.useState('');
  const [promptConfigs, setPromptConfigs] = React.useState([]);
  const [selectedPromptId, setSelectedPromptId] = React.useState('');
  const [out, setOut] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    async function loadOpts() {
      if (!profileId || !prefix) { setShops([]); setLangs([]); return; }
      try {
        const q = `?profile_id=${encodeURIComponent(profileId)}&prefix=${encodeURIComponent(prefix)}`;
        const r = await api(`/api/product_data_update/mysql/options${q}`);
        setShops(Array.isArray(r?.shops) ? r.shops : []);
        setLangs(Array.isArray(r?.langs) ? r.langs : []);
        if (!fromLangId && r?.langs && r.langs[0]) setFromLangId(String(r.langs[0].id_lang));
      } catch { setShops([]); setLangs([]); }
    }
    loadOpts();
  }, [profileId, prefix]);

  React.useEffect(() => {
    (async () => {
      try {
        const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
        const r = await api(`/api/automation-suite/prompt-configs${q}`);
        const arr = Array.isArray(r?.items) ? r.items : [];
        setPromptConfigs(arr);
        if (arr.length && !selectedPromptId) setSelectedPromptId(String(arr[0].id || ''));
      } catch { setPromptConfigs([]); }
    })();
  }, [orgId]);

  async function run() {
    setBusy(true); setOut(null);
    try {
      if (!profileId || !prefix) throw new Error('Select DB profile and prefix');
      if (!fromLangId) throw new Error('Select source language');
      if (!selectedPromptId) throw new Error('Select prompt');
      const body = { profile_id: Number(profileId), prefix, from_lang_id: Number(fromLangId), prompt_config_id: selectedPromptId, start_from: startFrom ? Number(startFrom) : undefined };
      const r = await api('/api/product_data_update/attr-groups/translate', { method:'POST', body: JSON.stringify(body) });
      setOut(r);
    } catch (e) { setOut({ ok:false, error: String(e?.message||e) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <div className="panel__header">Attribute Groups – Translate (all languages)</div>
      <div className="panel__body space-y-3">
        <div className="text-xs text-gray-600">Translates ps_attribute_group_lang from the selected source language to all other languages found in ps_lang. Operates per DB profile/prefix, not shop-scoped.</div>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm mb-1">From language (ps_lang)</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[160px]" value={fromLangId} onChange={e=>setFromLangId(e.target.value)}>
              {langs.map(l => (<option key={l.id_lang} value={l.id_lang}>{`#${l.id_lang} ${l.iso_code||''}`}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Start from id_attribute_group</label>
            <input className="border rounded px-2 py-1 text-sm w-[160px]" placeholder="e.g. 100" value={startFrom} onChange={e=>setStartFrom(e.target.value.replace(/[^0-9]/g,''))} />
          </div>
          <div>
            <label className="block text-sm mb-1">Prompt</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={selectedPromptId} onChange={e=>setSelectedPromptId(e.target.value)}>
              <option value="">(none)</option>
              {promptConfigs.map(p => { const id = String(p.id||''); const label = p.name ? `${p.name} (${id})` : id; return (<option key={id||label} value={id}>{label}</option>); })}
            </select>
          </div>
          <div>
            <button className="px-3 py-1.5 text-sm border rounded" onClick={run} disabled={busy}>Run</button>
          </div>
        </div>
        {out && (
          <pre className="text-xs bg-gray-50 p-2 border rounded overflow-auto max-h-80">{JSON.stringify(out, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
