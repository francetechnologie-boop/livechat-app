import React from 'react';

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

export default function FillMissingPanel({ profileId, prefix, orgId, onApplyProfile }) {
  const [fields, setFields] = React.useState({ meta_title:true, meta_description:true, link_rewrite:false, description_short:false });
  const [scope, setScope] = React.useState({ where:'', product_ids:'', product_id_from:'', product_id_to:'', id_shop:'', id_lang:'' });
  const [busy, setBusy] = React.useState(false);
  const [out, setOut] = React.useState(null);
  const [shops, setShops] = React.useState([]);
  const [langs, setLangs] = React.useState([]);
  const [langShop, setLangShop] = React.useState([]); // [{id_shop,id_lang}]
  const [promptConfigs, setPromptConfigs] = React.useState([]);
  const [selectedPromptId, setSelectedPromptId] = React.useState('');
  const [genBusy, setGenBusy] = React.useState(false);
  const [genOut, setGenOut] = React.useState(null);
  const [prog, setProg] = React.useState({ running:false, current:0, total:0, updated:0, skipped:0, errors:0 });
  const [chunkSize, setChunkSize] = React.useState(50);
  const cancelRef = React.useRef(false);
  const [recentRuns, setRecentRuns] = React.useState([]);
  const [runDetail, setRunDetail] = React.useState(null);
  // Saved profiles
  const [saved, setSaved] = React.useState([]);
  const [selProfileId, setSelProfileId] = React.useState('');
  const [profileName, setProfileName] = React.useState('');
  const [profileInfo, setProfileInfo] = React.useState(null); // db-mysql profile details
  const autoLoadedRef = React.useRef(false);

  async function loadSaved() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/product_data_update/fill-profiles${q}`);
      setSaved(Array.isArray(r?.items) ? r.items : []);
    } catch { setSaved([]); }
  }
  React.useEffect(() => { loadSaved(); /* eslint-disable-next-line */ }, [orgId]);

  // Load DB profile details for display (which profile is used)
  React.useEffect(() => {
    (async () => {
      if (!profileId) { setProfileInfo(null); return; }
      try {
        const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
        const r = await api(`/api/db-mysql/profiles/${encodeURIComponent(profileId)}${q}`);
        setProfileInfo(r?.item || null);
      } catch {
        setProfileInfo({ id: profileId });
      }
    })();
  }, [profileId, orgId]);

  // Auto-select and load last used saved profile for this org
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      const raw = localStorage.getItem('pdu:fill:last_profile');
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || !obj.id) return;
      // If orgId is set, prefer matching org; otherwise ignore org filter
      if (orgId && obj.orgId && String(obj.orgId) !== String(orgId)) return;
      if (!Array.isArray(saved) || !saved.length) return;
      const exists = saved.some(p => String(p.id) === String(obj.id));
      if (!exists) return;
      setSelProfileId(String(obj.id));
      // Auto-load it once
      autoLoadedRef.current = true;
      // Defer to ensure state applied before load
      setTimeout(() => { try { loadProfile(); } catch {} }, 0);
    } catch {}
  }, [saved, orgId]);

  // Fallback: if no last profile stored, auto-load the latest profile from server
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      if (!Array.isArray(saved) || !saved.length) return;
      // saved list is already ordered by updated_at DESC in the API
      const latest = saved[0];
      if (!latest || !latest.id) return;
      setSelProfileId(String(latest.id));
      autoLoadedRef.current = true;
      try { localStorage.setItem('pdu:fill:last_profile', JSON.stringify({ id: latest.id, orgId: orgId || null, when: Date.now() })); } catch {}
      setTimeout(() => { try { loadProfile(); } catch {} }, 0);
    } catch {}
  }, [saved, orgId]);

  React.useEffect(() => {
    async function loadOpts() {
      if (!profileId || !prefix) { setShops([]); setLangs([]); setLangShop([]); return; }
      try {
        const q = `?profile_id=${encodeURIComponent(profileId)}&prefix=${encodeURIComponent(prefix)}`;
        const r = await api(`/api/product_data_update/mysql/options${q}`);
        setShops(Array.isArray(r?.shops) ? r.shops : []);
        setLangs(Array.isArray(r?.langs) ? r.langs : []);
        setLangShop(Array.isArray(r?.lang_shop) ? r.lang_shop : []);
      } catch { setShops([]); setLangs([]); setLangShop([]); }
    }
    loadOpts();
  }, [profileId, prefix]);

  async function loadRuns() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}&limit=20` : '?limit=20';
      const r = await api(`/api/product_data_update/runs${q}`);
      setRecentRuns(Array.isArray(r?.items) ? r.items : []);
    } catch { setRecentRuns([]); }
  }
  React.useEffect(() => { loadRuns(); /* eslint-disable-next-line */ }, [orgId]);

  // Load Automation Suite prompts for selection
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

  const visibleLangs = React.useMemo(() => {
    try {
      const sid = Number(scope.id_shop || 0);
      if (!sid || !Array.isArray(langShop) || !langShop.length) return langs;
      const ok = new Set(langShop.filter(x=>Number(x.id_shop)===sid).map(x=>Number(x.id_lang)));
      return langs.filter(l=>ok.has(Number(l.id_lang)));
    } catch { return langs; }
  }, [langs, langShop, scope.id_shop]);

  async function run() {
    setBusy(true); setOut(null);
    try {
      const list = Object.entries(fields).filter(([,v])=>!!v).map(([k])=>k);
      const ids = String(scope.product_ids||'').split(',').map(s=>Number(s.trim())).filter(Boolean);
      const body = { profile_id: profileId, prefix, fields: list, scope: { where: scope.where || null, product_ids: ids.length ? ids : null, id_shop: scope.id_shop ? Number(scope.id_shop) : null, id_lang: scope.id_lang ? Number(scope.id_lang) : null } };
      const r = await api('/api/product_data_update/products/fill-missing', { method:'POST', body: JSON.stringify(body) });
      setOut(r);
    } catch (e) { setOut({ ok:false, error:String(e.message||e) }); }
    finally { setBusy(false); }
  }

  const [requestedIds, setRequestedIds] = React.useState([]);

  async function runGenerate(dry = true) {
    setGenBusy(true); setGenOut(null); cancelRef.current = false;
    try {
      const typedIds = String(scope.product_ids||'').split(',').map(s=>Number(s.trim())).filter(Boolean);
      let rangeIds = [];
      const a = Number(scope.product_id_from || 0);
      const b = Number(scope.product_id_to || 0);
      if (a && b && b >= a) {
        const cap = Math.min(5000, b - a + 1);
        rangeIds = Array.from({ length: cap }, (_, i) => a + i);
      }
      const ids = Array.from(new Set([ ...typedIds, ...rangeIds ])).filter(n=>Number.isFinite(n) && n>0);
      if (!ids.length) throw new Error('Provide at least one product id');
      if (!scope.id_shop) throw new Error('Select a shop');
      if (!scope.id_lang) throw new Error('Select a language');
      if (!selectedPromptId) throw new Error('Select a prompt');
      setRequestedIds(ids);
      // Build chunks
      const size = Math.max(1, Number(chunkSize)||50);
      const chunks = []; for (let i=0; i<ids.length; i+=size) chunks.push(ids.slice(i, i+size));
      // Start run
      let runId = null;
      try {
        const start = await api('/api/product_data_update/runs', { method:'POST', body: JSON.stringify({ org_id: orgId || null, profile_id: profileId, prefix, id_shop: Number(scope.id_shop), id_lang: Number(scope.id_lang), prompt_config_id: selectedPromptId, totals: { requested: ids.length, done: 0, updated: 0, skipped: 0, errors: 0 }, params: { limits: { title:60, description_min:150, description_max:160 }, scope: { list: String(scope.product_ids||''), range: { from: scope.product_id_from || null, to: scope.product_id_to || null }, where: scope.where || null, id_shop: Number(scope.id_shop), id_lang: Number(scope.id_lang) } } }) });
        runId = start?.id || null;
      } catch {}

      setProg({ running:true, current:0, total: ids.length, updated:0, skipped:0, errors:0 });
      const headers = { 'Content-Type': 'application/json' };
      if (orgId) headers['X-Org-Id'] = orgId;
      let done=0, updated=0, skipped=0, errors=0; const aggItems = [];
      for (let ci=0; ci<chunks.length; ci++) {
        if (cancelRef.current) break;
        const body = { profile_id: profileId, prefix, id_shop: Number(scope.id_shop), id_lang: Number(scope.id_lang), product_ids: chunks[ci], prompt_config_id: selectedPromptId, overwrite: false, dry_run: !!dry, limits: { title:60, description_min:150, description_max:160 }, run_id: runId };
        const res = await fetch('/api/product_data_update/products/generate-meta', { method:'POST', credentials:'include', headers, body: JSON.stringify(body) });
        const text = await res.text();
        let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok || (json && json.ok === false)) {
          const message = (json && (json.message || json.error)) || text || res.statusText || 'request_failed';
          const errItem = { id_product: chunks[ci][0], error: true, message: String(message) };
          aggItems.push(errItem);
          done += chunks[ci].length; errors += chunks[ci].length;
          // Append handled by server when run_id is provided
        } else {
          const items = Array.isArray(json?.items) ? json.items : [];
          aggItems.push(...items);
          done += items.length;
          updated += items.filter(it=>it.updated).length;
          skipped += items.filter(it=>it.skipped).length;
          errors += items.filter(it=>it.error).length;
          // Append handled by server when run_id is provided
        }
        setProg({ running:true, current: done, total: ids.length, updated, skipped, errors });
      }
      if (runId) { try { await api(`/api/product_data_update/runs/${runId}/finish`, { method:'POST', body: JSON.stringify({ status: cancelRef.current ? 'failed' : 'done' }) }); } catch {} }
      setGenOut({ ok:true, items: aggItems });
      loadRuns();
    } catch (e) {
      setGenOut({ ok:false, error:String(e?.message||e) });
    } finally { setGenBusy(false); }
  }

  // ---- Save/Load profile helpers ----
  async function saveNewProfile() {
    try {
      const name = profileName.trim(); if (!name) throw new Error('Enter a profile name');
      const body = {
        org_id: orgId || null,
        name,
        profile_id: profileId || null,
        prefix,
        fields,
        prompt_config_id: selectedPromptId || null,
        limits: { title:60, description_min:150, description_max:160 },
        overwrite: false
      };
      const r = await api('/api/product_data_update/fill-profiles', { method:'POST', body: JSON.stringify(body) });
      await loadSaved();
      const newId = String(r?.id || '');
      setSelProfileId(newId);
      if (newId) { try { await api(`/api/product_data_update/fill-profiles/${newId}`); } catch {} }
    } catch (e) { alert(String(e?.message||e)); }
  }

  async function updateProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) throw new Error('Select a saved profile');
      const body = {
        org_id: orgId || null,
        name: profileName || undefined,
        profile_id: profileId || null,
        prefix,
        fields,
        prompt_config_id: selectedPromptId || null,
        limits: { title:60, description_min:150, description_max:160 },
        overwrite: false
      };
      await api(`/api/product_data_update/fill-profiles/${id}`, { method:'PUT', body: JSON.stringify(body) });
      await loadSaved();
      // Re-read profile to reflect latest values in the form
      try { const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''; const r = await api(`/api/product_data_update/fill-profiles/${id}${q}`); const it = r?.item; if (it) { setProfileName(it.name||''); if (it.fields && typeof it.fields==='object') setFields(it.fields); if (it.prompt_config_id) setSelectedPromptId(String(it.prompt_config_id)); } } catch {}
    } catch (e) { alert(String(e?.message||e)); }
  }

  async function deleteProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) throw new Error('Select a saved profile');
      if (!window.confirm('Delete this profile?')) return;
      await api(`/api/product_data_update/fill-profiles/${id}`, { method:'DELETE' });
      setSelProfileId(''); setProfileName('');
      await loadSaved();
    } catch (e) { alert(String(e?.message||e)); }
  }

  async function loadProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) throw new Error('Select a saved profile');
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/product_data_update/fill-profiles/${id}${q}`);
      const it = r?.item; if (!it) return;
      setProfileName(it.name || '');
      if (it.fields && typeof it.fields === 'object') setFields(it.fields);
      if (it.prompt_config_id) setSelectedPromptId(String(it.prompt_config_id));
      try {
        if (onApplyProfile && (it.profile_id || it.prefix)) onApplyProfile(it.profile_id || null, it.prefix || '');
      } catch {}
      // Remember last loaded saved profile
      try { localStorage.setItem('pdu:fill:last_profile', JSON.stringify({ id, orgId: orgId || null, when: Date.now() })); } catch {}
    } catch (e) { alert(String(e?.message||e)); }
  }

  return (
    <div className="panel">
      <div className="panel__header">Product(s) – Fill Missing</div>
      <div className="panel__body space-y-3">
        {/* Saved profiles */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm mb-1">Saved profiles</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={selProfileId} onChange={e=>setSelProfileId(e.target.value)}>
              <option value="">(none)</option>
              {saved.map(p => (<option key={p.id} value={p.id}>{`${p.name} (#${p.id})`}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm border rounded" onClick={loadProfile} disabled={!selProfileId}>Load</button>
            <button className="px-3 py-1.5 text-sm border rounded" onClick={deleteProfile} disabled={!selProfileId}>Delete</button>
          </div>
          <div>
            <label className="block text-sm mb-1">Name</label>
            <input className="border rounded px-2 py-1 text-sm min-w-[220px]" placeholder="Profile name" value={profileName} onChange={e=>setProfileName(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm border rounded" onClick={saveNewProfile}>Save New</button>
            <button className="px-3 py-1.5 text-sm border rounded" onClick={updateProfile} disabled={!selProfileId}>Update</button>
          </div>
        </div>
        <div className="text-xs text-gray-600">Runs against PrestaShop DB via selected profile and table prefix.</div>

        <div className="flex flex-wrap gap-6">
          <div>
            <div className="font-medium mb-1">Fields</div>
            {Object.keys(fields).map(k => (
              <label key={k} className="block text-sm"><input className="mr-2" type="checkbox" checked={!!fields[k]} onChange={e=>setFields(prev=>({ ...prev, [k]: e.target.checked }))} />{k}</label>
            ))}
          </div>
        </div>

        {/* Run section: define scope and generate */}
        <div className="mt-2 p-3 border rounded bg-white">
          <div className="font-medium mb-2">Run — Generate Meta</div>
          {profileId && (
            <div className="text-[11px] text-gray-600 mb-2">
              Using DB profile: #{profileId}
              {profileInfo?.name ? ` ${profileInfo.name}` : ''}
              {profileInfo?.host ? ` (${profileInfo.host}:${profileInfo.port}/${profileInfo.database})` : ''}
              {prefix ? `, prefix '${prefix}'` : ''}
            </div>
          )}
          <div className="mb-3">
            <div className="font-medium mb-1">Scope</div>
            <div className="text-xs text-gray-600 mb-1">Only active products will be updated; inactive products are skipped.</div>
            <label className="block text-sm mb-1">Product IDs (comma separated)</label>
            <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. 1,2,3" value={scope.product_ids} onChange={e=>setScope(prev=>({ ...prev, product_ids: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-sm mb-1">From ID</label>
                <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. 100" value={scope.product_id_from} onChange={e=>setScope(prev=>({ ...prev, product_id_from: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm mb-1">To ID</label>
                <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. 150" value={scope.product_id_to} onChange={e=>setScope(prev=>({ ...prev, product_id_to: e.target.value }))} />
              </div>
            </div>
            <label className="block text-sm mt-2 mb-1">SQL WHERE (optional)</label>
            <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. active=1" value={scope.where} onChange={e=>setScope(prev=>({ ...prev, where: e.target.value }))} />
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-sm mb-1">Shop (id_shop)</label>
                <select className="border rounded px-2 py-1 text-sm w-full" value={scope.id_shop} onChange={e=>setScope(prev=>({ ...prev, id_shop: e.target.value }))}>
                  <option value="">All shops</option>
                  {shops.map(s => (<option key={s.id_shop} value={s.id_shop}>{`#${s.id_shop} ${s.name||''}`}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Language (id_lang)</label>
                <select className="border rounded px-2 py-1 text-sm w-full" value={scope.id_lang} onChange={e=>setScope(prev=>({ ...prev, id_lang: e.target.value }))}>
                  <option value="">All languages</option>
                  {visibleLangs.map(l => (<option key={l.id_lang} value={l.id_lang}>{`#${l.id_lang} ${l.iso_code||''} ${l.name||''}`}</option>))}
                </select>
              </div>
            </div>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-sm mb-1">Prompt</label>
              <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={selectedPromptId} onChange={e=>setSelectedPromptId(e.target.value)}>
                <option value="">Select a prompt…</option>
                {promptConfigs.map(p => {
                  const id = String(p.id || '');
                  const label = p.name ? `${p.name} (${id})` : id;
                  return (<option key={id || label} value={id}>{label}</option>);
                })}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>runGenerate(true)} disabled={genBusy || !profileId || !prefix}>{genBusy? 'Running…':'Preview'}</button>
              <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>runGenerate(false)} disabled={genBusy || !profileId || !prefix}>Apply</button>
              <div className="flex items-center gap-2 ml-4">
                <label className="text-xs text-gray-600">Chunk size</label>
                <input className="border rounded px-2 py-1 text-xs w-[70px]" value={chunkSize} onChange={e=>setChunkSize(e.target.value)} />
              </div>
              {prog.running && (
                <div className="flex items-center gap-2 ml-4 min-w-[220px]">
                  <div className="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                    <div className="h-full bg-indigo-600" style={{ width: `${Math.min(100, Math.round((prog.current/prog.total)*100))}%` }} />
                  </div>
                  <div className="text-[11px] text-gray-700">{prog.current}/{prog.total}</div>
                  <button className="text-[11px] underline" onClick={()=>{ cancelRef.current = true; }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
          {genOut && genOut.items && Array.isArray(genOut.items) && (
            <div className="mt-3">
              <div className="text-xs text-gray-600 mb-1">
                Requested: {requestedIds.length || genOut.items.length} ·
                Done: {genOut.items.length} ·
                Updated: {genOut.items.filter(it=>it.updated).length} ·
                Skipped: {genOut.items.filter(it=>it.skipped).length} ·
                Errors: {genOut.items.filter(it=>it.error).length}
              </div>
              <div className="overflow-auto border rounded max-h-64">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-2 py-1 border-b">Product</th>
                      <th className="text-left px-2 py-1 border-b">Status</th>
                      <th className="text-left px-2 py-1 border-b">Meta Title</th>
                      <th className="text-left px-2 py-1 border-b">Meta Description</th>
                      <th className="text-left px-2 py-1 border-b">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {genOut.items.map((it, idx) => {
                      const status = it.error ? 'error' : (it.skipped ? `skipped:${it.reason||''}` : (it.updated ? 'updated' : 'ok'));
                      const msg = it.message || it.warning || '';
                      return (
                        <tr key={idx} className="odd:bg-white even:bg-gray-50">
                          <td className="px-2 py-1 border-b">{it.id_product}</td>
                          <td className="px-2 py-1 border-b">{status}</td>
                          <td className="px-2 py-1 border-b break-all">{it.meta_title || ''}</td>
                          <td className="px-2 py-1 border-b break-all">{it.meta_description || ''}</td>
                          <td className="px-2 py-1 border-b break-all">{msg}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {genOut && (!genOut.items || !Array.isArray(genOut.items)) && (
            <pre className="text-xs bg-gray-50 p-2 border rounded overflow-auto max-h-64 mt-2">{JSON.stringify(genOut, null, 2)}</pre>
          )}
        </div>

        {/* Recent runs */}
        <div className="mt-4 p-3 border rounded bg-white">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Recent Runs</div>
            <button className="px-2 py-1 text-xs border rounded" onClick={loadRuns}>Refresh</button>
          </div>
          <div className="overflow-auto max-h-64 border rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-1 border-b">#</th>
                  <th className="text-left px-2 py-1 border-b">Status</th>
                  <th className="text-left px-2 py-1 border-b">Shop/Lang</th>
                  <th className="text-left px-2 py-1 border-b">Totals</th>
                  <th className="text-left px-2 py-1 border-b">When</th>
                  <th className="text-left px-2 py-1 border-b"></th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map(r => {
                  const t = r.totals || {}; const req = Number(t.requested||0), dn=Number(t.done||0), up=Number(t.updated||0), sk=Number(t.skipped||0), er=Number(t.errors||0);
                  return (
                    <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                      <td className="px-2 py-1 border-b">{r.id}</td>
                      <td className="px-2 py-1 border-b">{r.status}</td>
                      <td className="px-2 py-1 border-b">{r.id_shop}/{r.id_lang}</td>
                      <td className="px-2 py-1 border-b">req:{req} done:{dn} up:{up} sk:{sk} er:{er}</td>
                      <td className="px-2 py-1 border-b">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-2 py-1 border-b"><button className="px-2 py-0.5 border rounded" onClick={async()=>{ try { const det = await api(`/api/product_data_update/runs/${r.id}`); setRunDetail(det); } catch(e){ alert(String(e?.message||e)); } }}>View</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {runDetail && (
            <div className="mt-3">
              <div className="font-medium mb-1">Run #{runDetail.run?.id}</div>
              <div className="text-[11px] text-gray-600 mb-2">
                {(() => { try {
                  const p = runDetail.run?.params || {}; const sc = p.scope || {};
                  const s = [
                    sc.list ? `list: ${String(sc.list).slice(0,120)}${String(sc.list).length>120?'…':''}` : '',
                    (sc.range && (sc.range.from||sc.range.to)) ? `range: ${sc.range.from||''}-${sc.range.to||''}` : '',
                    sc.where ? `where: ${sc.where}` : ''
                  ].filter(Boolean).join(' | ');
                  return s ? `Scope — ${s}` : '';
                } catch { return ''; } })()}
              </div>
              <div className="mb-2 flex items-center gap-2">
                <button className="px-2 py-1 text-xs border rounded" onClick={() => {
                  try {
                    const run = runDetail.run || {};
                    const sc = (run.params && run.params.scope) ? run.params.scope : {};
                    setScope(prev => ({
                      ...prev,
                      product_ids: sc.list || '',
                      product_id_from: (sc.range && sc.range.from) ? sc.range.from : '',
                      product_id_to: (sc.range && sc.range.to) ? sc.range.to : '',
                      where: sc.where || '',
                      id_shop: String(sc.id_shop || run.id_shop || ''),
                      id_lang: String(sc.id_lang || run.id_lang || ''),
                    }));
                    if (run.prompt_config_id) setSelectedPromptId(String(run.prompt_config_id));
                    try { if (onApplyProfile && (run.profile_id || run.prefix)) onApplyProfile(run.profile_id || null, run.prefix || ''); } catch {}
                  } catch {}
                }}>Load scope</button>
                <button className="px-2 py-1 text-xs border rounded" onClick={() => {
                  try {
                    const run = runDetail.run || {};
                    const sc = (run.params && run.params.scope) ? run.params.scope : {};
                    setScope(prev => ({
                      ...prev,
                      product_ids: sc.list || '',
                      product_id_from: (sc.range && sc.range.from) ? sc.range.from : '',
                      product_id_to: (sc.range && sc.range.to) ? sc.range.to : '',
                      where: sc.where || '',
                      id_shop: String(sc.id_shop || run.id_shop || ''),
                      id_lang: String(sc.id_lang || run.id_lang || ''),
                    }));
                    if (run.prompt_config_id) setSelectedPromptId(String(run.prompt_config_id));
                    try { if (onApplyProfile && (run.profile_id || run.prefix)) onApplyProfile(run.profile_id || null, run.prefix || ''); } catch {}
                    setTimeout(() => { try { runGenerate(true); } catch {} }, 0);
                  } catch {}
                }}>Re-run (Preview)</button>
                <button className="px-2 py-1 text-xs border rounded" onClick={() => {
                  try {
                    const run = runDetail.run || {};
                    const sc = (run.params && run.params.scope) ? run.params.scope : {};
                    setScope(prev => ({
                      ...prev,
                      product_ids: sc.list || '',
                      product_id_from: (sc.range && sc.range.from) ? sc.range.from : '',
                      product_id_to: (sc.range && sc.range.to) ? sc.range.to : '',
                      where: sc.where || '',
                      id_shop: String(sc.id_shop || run.id_shop || ''),
                      id_lang: String(sc.id_lang || run.id_lang || ''),
                    }));
                    if (run.prompt_config_id) setSelectedPromptId(String(run.prompt_config_id));
                    try { if (onApplyProfile && (run.profile_id || run.prefix)) onApplyProfile(run.profile_id || null, run.prefix || ''); } catch {}
                    setTimeout(() => { try { runGenerate(false); } catch {} }, 0);
                  } catch {}
                }}>Re-run (Apply)</button>
              </div>
              <div className="overflow-auto border rounded max-h-64">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-2 py-1 border-b">Product</th>
                      <th className="text-left px-2 py-1 border-b">Status</th>
                      <th className="text-left px-2 py-1 border-b">Meta Title</th>
                      <th className="text-left px-2 py-1 border-b">Meta Description</th>
                      <th className="text-left px-2 py-1 border-b">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(runDetail.items||[]).map((it, idx) => (
                      <tr key={idx} className="odd:bg-white even:bg-gray-50">
                        <td className="px-2 py-1 border-b">{it.id_product}</td>
                        <td className="px-2 py-1 border-b">{it.status}</td>
                        <td className="px-2 py-1 border-b break-all">{it.meta_title||''}</td>
                        <td className="px-2 py-1 border-b break-all">{it.meta_description||''}</td>
                        <td className="px-2 py-1 border-b break-all">{it.message||''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-sm border rounded" onClick={run} disabled={busy || !profileId || !prefix}>{busy? 'Running…':'Run (stub)'}</button>
          {(!profileId || !prefix) && <div className="text-xs text-gray-500">Select a profile and prefix first</div>}
        </div>

        {out && (
          <pre className="text-xs bg-gray-50 p-2 border rounded overflow-auto max-h-64">{JSON.stringify(out, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
