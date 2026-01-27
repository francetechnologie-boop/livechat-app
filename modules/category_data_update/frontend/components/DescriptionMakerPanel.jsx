import React from 'react';
import Toast from './Toast.jsx';

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

const DEFAULT_FIELDS = { description: true, meta_title: true, meta_description: true, link_rewrite: true };

export default function DescriptionMakerPanel({ profileId, prefix, orgId, onApplyProfile }) {
  const [shops, setShops] = React.useState([]);
  const [langs, setLangs] = React.useState([]);
  const [langShop, setLangShop] = React.useState([]);
  const [idShop, setIdShop] = React.useState('');
  const [idLang, setIdLang] = React.useState('');
  const [fields, setFields] = React.useState({ ...DEFAULT_FIELDS });
  // Removed typed category list; range-only
  const [rangeFrom, setRangeFrom] = React.useState('');
  const [rangeTo, setRangeTo] = React.useState('');
  const [promptConfigs, setPromptConfigs] = React.useState([]);
  const [selectedPromptId, setSelectedPromptId] = React.useState('');
  const [chunkSize, setChunkSize] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [out, setOut] = React.useState(null);
  const [sourceSite, setSourceSite] = React.useState('');
  const [sseEnabled, setSseEnabled] = React.useState(true);
  const [currentRunId, setCurrentRunId] = React.useState(null);
  const sseRef = React.useRef(null);
  const [stepEvents, setStepEvents] = React.useState([]);
  const [copiedKey, setCopiedKey] = React.useState(null);
  const [toast, setToast] = React.useState({ open:false, type:'info', message:'' });
  const [saved, setSaved] = React.useState([]);
  const [selProfileId, setSelProfileId] = React.useState('');
  const [profileName, setProfileName] = React.useState('');
  const [dbProfiles, setDbProfiles] = React.useState([]);
  const [dbProfileId, setDbProfileId] = React.useState('');
  const autoLoadedRef = React.useRef(false);

  async function copyToClipboard(text, key) {
    try {
      const value = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(value||''));
      } else {
        const ta = document.createElement('textarea'); ta.value = String(value||'');
        ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta);
        ta.focus(); ta.select(); try { document.execCommand('copy'); } catch {}
        document.body.removeChild(ta);
      }
      setCopiedKey(key);
      setTimeout(() => { try { setCopiedKey(null); } catch {} }, 1500);
    } catch {}
  }

  React.useEffect(() => {
    if (!sseEnabled || !currentRunId) { try { sseRef.current?.close?.(); } catch {}; sseRef.current = null; return; }
    try {
      const es = new EventSource(`/api/category_data_update/translator-runs/${encodeURIComponent(currentRunId)}/stream`);
      sseRef.current = es;
      const pushEvt = (type, payload) => { try { setStepEvents(prev => [{ t: Date.now(), type, ...(payload||{}) }, ...prev].slice(0, 200)); } catch {} };
      es.addEventListener('category_start', ev => { try { pushEvt('category_start', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('prompt_request', ev => { try { pushEvt('prompt_request', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('prompt_received', ev => { try { pushEvt('prompt_received', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('prompt_output', ev => { try { pushEvt('prompt_output', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('db_update_start', ev => { try { pushEvt('db_update_start', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('db_update_done', ev => { try { pushEvt('db_update_done', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('db_update_error', ev => { try { pushEvt('db_update_error', JSON.parse(ev.data||'{}')); } catch {} });
      es.onerror = () => {};
    } catch {}
    return () => { try { sseRef.current?.close?.(); } catch {}; sseRef.current = null; };
  }, [sseEnabled, currentRunId]);

  React.useEffect(() => {
    (async () => {
      if (!profileId || !prefix) { setShops([]); setLangs([]); setLangShop([]); return; }
      try {
        const q = `?profile_id=${encodeURIComponent(profileId)}&prefix=${encodeURIComponent(prefix)}`;
        const r = await api(`/api/category_data_update/mysql/options${q}`);
        setShops(Array.isArray(r?.shops) ? r.shops : []);
        setLangs(Array.isArray(r?.langs) ? r.langs : []);
        setLangShop(Array.isArray(r?.lang_shop) ? r.lang_shop : []);
      } catch { setShops([]); setLangs([]); setLangShop([]); }
    })();
  }, [profileId, prefix]);

  // Load DB profiles list for explicit selection in this panel
  React.useEffect(() => {
    (async () => {
      try {
        const r2 = await api('/api/db-mysql/profiles');
        const items = Array.isArray(r2?.items) ? r2.items : [];
        setDbProfiles(items);
        const header = profileId ? String(profileId) : '';
        if (header) setDbProfileId(header);
        else if (!dbProfileId && items.length) setDbProfileId(String(items[0].id));
      } catch { setDbProfiles([]); }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
        const r = await api(`/api/automation-suite/prompt-configs${q}`);
        const items = Array.isArray(r?.items) ? r.items : [];
        setPromptConfigs(items);
        if (items.length && !selectedPromptId) setSelectedPromptId(String(items[0].id||''));
      } catch { setPromptConfigs([]); }
    })();
  }, [orgId]);

  // Load saved maker profiles for this org
  async function loadSaved() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/category_data_update/maker-profiles${q}`);
      setSaved(Array.isArray(r?.items) ? r.items : []);
    } catch { setSaved([]); }
  }
  React.useEffect(() => { loadSaved(); /* eslint-disable-next-line */ }, [orgId]);

  // Auto-load last used maker profile for this org
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      const raw = localStorage.getItem('cdu:maker:last_profile');
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || !obj.id) return;
      if (orgId && obj.orgId && String(obj.orgId) !== String(orgId)) return;
      if (!Array.isArray(saved) || !saved.length) return;
      const exists = saved.some(p => String(p.id) === String(obj.id));
      if (!exists) return;
      autoLoadedRef.current = true;
      setSelProfileId(String(obj.id));
      setTimeout(() => { try { onLoadProfile(); } catch {} }, 0);
    } catch {}
  }, [saved, orgId]);

  // Fallback: auto-select latest server profile
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      if (!Array.isArray(saved) || !saved.length) return;
      const latest = saved[0]; if (!latest || !latest.id) return;
      autoLoadedRef.current = true; setSelProfileId(String(latest.id));
      try { localStorage.setItem('cdu:maker:last_profile', JSON.stringify({ id: latest.id, orgId: orgId || null, when: Date.now() })); } catch {}
      setTimeout(() => { try { onLoadProfile(); } catch {} }, 0);
    } catch {}
  }, [saved, orgId]);

  async function onLoadProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) return;
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/category_data_update/maker-profiles/${id}${q}`);
      const it = r?.item; if (!it) return;
      setProfileName(it.name || '');
      if (it.fields && typeof it.fields === 'object') setFields(prev => ({ ...prev, ...DEFAULT_FIELDS, ...it.fields }));
      if (it.id_shop != null) setIdShop(String(it.id_shop));
      if (it.id_lang != null) setIdLang(String(it.id_lang));
      if (it.prompt_config_id) setSelectedPromptId(String(it.prompt_config_id));
      if (it.source_site != null) setSourceSite(String(it.source_site));
      try { if (onApplyProfile && (it.profile_id || it.prefix)) onApplyProfile(it.profile_id || null, it.prefix || ''); } catch {}
      try { if (it.profile_id) setDbProfileId(String(it.profile_id)); } catch {}
      try { localStorage.setItem('cdu:maker:last_profile', JSON.stringify({ id, orgId: orgId || null, when: Date.now() })); } catch {}
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  async function onSaveNew() {
    try {
      const body = {
        org_id: orgId || null,
        name: profileName || 'Profile',
        profile_id: (dbProfileId || profileId || null),
        prefix: prefix || '',
        fields,
        id_shop: idShop ? Number(idShop) : null,
        id_lang: idLang ? Number(idLang) : null,
        prompt_config_id: selectedPromptId || null,
        source_site: sourceSite || null,
        limits: {},
        overwrite: false
      };
      const r = await api('/api/category_data_update/maker-profiles', { method:'POST', body: JSON.stringify(body) });
      setToast({ open:true, type:'success', message:`Saved maker profile #${r.id}` });
      await loadSaved();
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  async function onUpdateProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) return;
      const body = {
        org_id: orgId || null,
        name: profileName || null,
        profile_id: (dbProfileId || profileId || null),
        prefix: prefix || null,
        fields,
        id_shop: idShop ? Number(idShop) : null,
        id_lang: idLang ? Number(idLang) : null,
        prompt_config_id: selectedPromptId || null,
        source_site: sourceSite || null,
        limits: {},
      };
      await api(`/api/category_data_update/maker-profiles/${id}`, { method:'PUT', body: JSON.stringify(body) });
      setToast({ open:true, type:'success', message:`Updated maker profile #${id}` });
      await loadSaved();
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  async function onDeleteProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) return;
      await api(`/api/category_data_update/maker-profiles/${id}`, { method:'DELETE' });
      setToast({ open:true, type:'success', message:`Deleted maker profile #${id}` });
      setSelProfileId(''); setProfileName('');
      await loadSaved();
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  const visibleLangs = React.useMemo(() => {
    try {
      const sid = Number(idShop || 0);
      if (!sid || !Array.isArray(langShop) || !langShop.length) return langs;
      const ok = new Set(langShop.filter(x=>Number(x.id_shop)===sid).map(x=>Number(x.id_lang)));
      return langs.filter(l=>ok.has(Number(l.id_lang)));
    } catch { return langs; }
  }, [langs, langShop, idShop]);

  async function runGenerate() {
    setBusy(true); setOut(null);
    try {
      const a = Number(rangeFrom||0), b = Number(rangeTo||0);
      let range = [];
      if (a && b && b>=a) { const cap = Math.min(5000, b-a+1); range = Array.from({length:cap},(_,i)=>a+i); }
      const ids = Array.from(new Set([...range])).filter(n=>n>0);
      if (!ids.length) throw new Error('Provide at least one category id');
      if (!idShop) throw new Error('Select a destination shop');
      if (!idLang) throw new Error('Select a language');
      if (!selectedPromptId) throw new Error('Select a prompt');
      const f = Object.entries(fields).filter(([,v])=>!!v).map(([k])=>k);
      const size = 1; // update DB after each category (one per chunk)
      const chunks = []; for (let i=0;i<ids.length;i+=size) chunks.push(ids.slice(i,i+size));
      const all = [];
      const runId = `cdu-${Date.now()}`;
      setCurrentRunId(runId);
      for (let ci=0; ci<chunks.length; ci++) {
        const body = {
          profile_id: profileId,
          prefix,
          fields: f,
          lang_from: Number(idLang),
          lang_to: Number(idLang),
          scope: { category_ids: chunks[ci], id_shop_from: Number(idShop), id_shop: Number(idShop), id_lang: Number(idLang), where: null, source_site: sourceSite || null },
          source_site: sourceSite || null,
          prompt_config_id: selectedPromptId,
          dry_run: false
        };
        const r = await api('/api/category_data_update/categories/translate', { method:'POST', body: JSON.stringify({ ...body, run_id: runId }) });
        all.push(r);
      }
      setOut({ ok:true, chunks: all.length, results: all });
    } catch (e) { setOut({ ok:false, error:String(e?.message||e) }); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel">
      {toast.open && (
        <Toast open={toast.open} type={toast.type} message={toast.message} onClose={()=>setToast({ open:false, type:'info', message:'' })} />
      )}
      <div className="panel__header">Category – Description Maker</div>
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
          <div>
            <label className="block text-sm mb-1">DB Profile (MySQL)</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[220px]" value={dbProfileId} onChange={e=>{ setDbProfileId(e.target.value); try { if (onApplyProfile) onApplyProfile(Number(e.target.value)||null, prefix||''); } catch {} }}>
              <option value="">(header)</option>
              {dbProfiles.map(p => (<option key={p.id} value={p.id}>{`#${p.id} ${p.name || ''}`}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm border rounded" onClick={onLoadProfile} disabled={!selProfileId}>Load</button>
            <button className="px-3 py-1.5 text-sm border rounded" onClick={onDeleteProfile} disabled={!selProfileId}>Delete</button>
          </div>
          <div>
            <label className="block text-sm mb-1">Name</label>
            <input className="border rounded px-2 py-1 text-sm min-w-[220px]" placeholder="Profile name" value={profileName} onChange={e=>setProfileName(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm border rounded" onClick={onSaveNew}>Save New</button>
            <button className="px-3 py-1.5 text-sm border rounded" onClick={onUpdateProfile} disabled={!selProfileId}>Update</button>
          </div>
        </div>

        <div className="text-xs text-gray-600">Generate category description, meta title/description and update link_rewrite for the selected language.</div>
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="font-medium mb-1">Fields</div>
            {Object.keys(DEFAULT_FIELDS).map(k => (
              <label key={k} className="block text-sm"><input className="mr-2" type="checkbox" checked={!!fields[k]} onChange={e=>setFields(prev=>({ ...prev, [k]: e.target.checked }))} />{k}</label>
            ))}
          </div>
          <div className="grow min-w-[300px]">
            <div className="font-medium mb-1">Destination</div>
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-sm mb-1">Shop</label>
                <select className="border rounded px-2 py-1 text-sm min-w-[200px]" value={idShop} onChange={e=>setIdShop(e.target.value)}>
                  <option value="">Select…</option>
                  {shops.map(s => (<option key={s.id_shop} value={s.id_shop}>{`#${s.id_shop} ${s.name||''}`}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Language</label>
                <select className="border rounded px-2 py-1 text-sm min-w-[140px]" value={idLang} onChange={e=>setIdLang(e.target.value)}>
                  <option value="">Select…</option>
                  {visibleLangs.map(l => (<option key={l.id_lang} value={l.id_lang}>{`#${l.id_lang} ${l.iso_code||''}`}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Prompt</label>
                <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={selectedPromptId} onChange={e=>setSelectedPromptId(e.target.value)}>
                  <option value="">(none)</option>
                  {promptConfigs.map(p => { const id = String(p.id||''); const label = p.name ? `${p.name} (${id})` : id; return (<option key={id||label} value={id}>{label}</option>); })}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Source site (optional)</label>
                <input className="border rounded px-2 py-1 text-sm min-w-[220px]" placeholder="e.g. sensorex.com" value={sourceSite} onChange={e=>setSourceSite(e.target.value)} />
              </div>
              <label className="ml-2 inline-flex items-center text-sm"><input type="checkbox" className="mr-1" checked={sseEnabled} onChange={e=>setSseEnabled(!!e.target.checked)} />Live stream</label>
            </div>
          </div>
        </div>
        <div className="mt-3 p-3 border rounded bg-white">
          <div className="font-medium mb-2">Live Steps</div>
          <div className="border rounded max-h-72 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-1 border-b">Time</th>
                  <th className="text-left px-2 py-1 border-b">Category</th>
                  <th className="text-left px-2 py-1 border-b">Step</th>
                  <th className="text-left px-2 py-1 border-b">Details</th>
                </tr>
              </thead>
              <tbody>
                {stepEvents.map((e, idx) => {
                  const t = new Date(e.t||Date.now());
                  const time = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
                  let det = '';
                  if (e.ms != null) det = `ms=${e.ms}`;
                  if (Array.isArray(e.fields) && e.fields.length) det = `${det}${det?'; ':''}fields=${e.fields.join(',')}`;
                  if (e.message) det = `${det}${det?'; ':''}${String(e.message)}`;
                  if (e.input_len != null) det = `${det}${det?'; ':''}input_len=${e.input_len}`;
                  if (e.out) { try { const txt = JSON.stringify(e.out); det = `${det}${det?'; ':''}output=${txt.length>160?txt.slice(0,160)+'…':txt}`; } catch {} }
                  const rowKey = `${idx}:${e.t||''}`;
                  return (
                    <tr key={idx} className={e.type==='db_update_done' ? 'bg-green-50' : (e.type==='prompt_output' ? 'bg-blue-50' : (e.type==='db_update_error' ? 'bg-red-50' : ''))}>
                      <td className="px-2 py-1 border-b whitespace-nowrap">{time}</td>
                      <td className="px-2 py-1 border-b">{e.id_category || ''}</td>
                      <td className="px-2 py-1 border-b whitespace-nowrap">{e.type}</td>
                      <td className="px-2 py-1 border-b break-all">
                        {det}
                        {(e.type === 'prompt_output' && e.out) && (
                          <button
                            className="ml-2 px-2 py-0.5 text-[11px] border rounded"
                            title="Copy full prompt output"
                            onClick={() => copyToClipboard(JSON.stringify(e.out, null, 2), rowKey)}
                          >{copiedKey === rowKey ? 'Copied' : 'Copy output'}</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="font-medium mb-1">Scope</div>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <label className="block text-sm mb-1">From ID</label>
              <input className="border rounded px-2 py-1 text-sm w-full" value={rangeFrom} onChange={e=>setRangeFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">To ID</label>
              <input className="border rounded px-2 py-1 text-sm w-full" value={rangeTo} onChange={e=>setRangeTo(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-3 py-1.5 text-sm border rounded" onClick={runGenerate} disabled={busy || !profileId || !prefix}>{busy? 'Running…' : 'Apply'}</button>
          <label className="text-xs text-gray-600">Chunk size</label>
          <input className="border rounded px-2 py-1 text-xs w-[70px]" value={chunkSize} onChange={e=>setChunkSize(e.target.value)} />
        </div>
        {out && (
          <pre className="mt-3 p-2 bg-gray-50 border rounded text-xs overflow-auto max-h-96">{JSON.stringify(out, null, 2)}</pre>
        )}
        <div className="text-xs text-gray-600">
          Tip: Create a prompt in Automation Suite that returns a JSON object with keys "meta_title", "meta_description", and "description" based on the provided category name and context. See instructions below.
        </div>
      </div>
    </div>
  );
}
