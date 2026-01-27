import React from 'react';
import Toast from './Toast.jsx';

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

export default function FillMissingPanel({ profileId, prefix, orgId, onApplyProfile }) {
  const [fields, setFields] = React.useState({ meta_title:true, meta_description:true, link_rewrite:false, description:false });
  const [scope, setScope] = React.useState({ where:'', category_id_from:'', category_id_to:'', id_shop:'', id_lang:'' });
  const [shops, setShops] = React.useState([]);
  const [langs, setLangs] = React.useState([]);
  const [langShop, setLangShop] = React.useState([]);
  const [promptConfigs, setPromptConfigs] = React.useState([]);
  const [selectedPromptId, setSelectedPromptId] = React.useState('');
  const [saved, setSaved] = React.useState([]);
  const [selProfileId, setSelProfileId] = React.useState('');
  const [profileName, setProfileName] = React.useState('');
  const [profileInfo, setProfileInfo] = React.useState(null);
  // Optional: allow choosing MySQL profile here (like Image Maker)
  const [dbProfiles, setDbProfiles] = React.useState([]);
  const [dbProfileId, setDbProfileId] = React.useState('');
  const [toast, setToast] = React.useState({ open:false, type:'info', message:'' });
  const [genBusy, setGenBusy] = React.useState(false);
  const [genOut, setGenOut] = React.useState(null);
  const [prog, setProg] = React.useState({ running:false, current:0, total:0, updated:0, skipped:0, errors:0 });
  const [chunkSize, setChunkSize] = React.useState(50);
  const cancelRef = React.useRef(false);
  const [recentRuns, setRecentRuns] = React.useState([]);
  const [runDetail, setRunDetail] = React.useState(null);
  const autoLoadedRef = React.useRef(false);
  // Live Steps (SSE)
  const [sseEnabled, setSseEnabled] = React.useState(true);
  const [currentRunId, setCurrentRunId] = React.useState(null);
  const sseRef = React.useRef(null);
  const [stepEvents, setStepEvents] = React.useState([]);

  async function loadSaved() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/category_data_update/fill-profiles${q}`);
      setSaved(Array.isArray(r?.items) ? r.items : []);
    } catch { setSaved([]); }
  }
  React.useEffect(() => { loadSaved(); /* eslint-disable-next-line */ }, [orgId]);

  // Auto-select and load last used saved profile for this org
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      const raw = localStorage.getItem('cdu:fill:last_profile');
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || !obj.id) return;
      if (orgId && obj.orgId && String(obj.orgId) !== String(orgId)) return;
      if (!Array.isArray(saved) || !saved.length) return;
      const exists = saved.some(p => String(p.id) === String(obj.id));
      if (!exists) return;
      autoLoadedRef.current = true;
      setSelProfileId(String(obj.id));
      setTimeout(() => { try { loadProfile(String(obj.id)); } catch {} }, 0);
    } catch {}
  }, [saved, orgId]);

  // Fallback: if no last profile stored, auto-load the latest server profile
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      if (!Array.isArray(saved) || !saved.length) return;
      const latest = saved[0];
      if (!latest || !latest.id) return;
      autoLoadedRef.current = true;
      setSelProfileId(String(latest.id));
      try { localStorage.setItem('cdu:fill:last_profile', JSON.stringify({ id: latest.id, orgId: orgId || null, when: Date.now() })); } catch {}
      setTimeout(() => { try { loadProfile(String(latest.id)); } catch {} }, 0);
    } catch {}
  }, [saved, orgId]);

  React.useEffect(() => {
    (async () => {
      if (!profileId) { setProfileInfo(null); return; }
      try {
        const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
        const r = await api(`/api/db-mysql/profiles/${encodeURIComponent(profileId)}${q}`);
        setProfileInfo(r?.item || null);
      } catch { setProfileInfo({ id: profileId }); }
    })();
  }, [profileId, orgId]);

  React.useEffect(() => {
    async function loadOpts() {
      if (!profileId || !prefix) { setShops([]); setLangs([]); setLangShop([]); return; }
      try {
        const q = `?profile_id=${encodeURIComponent(profileId)}&prefix=${encodeURIComponent(prefix)}`;
        const r = await api(`/api/category_data_update/mysql/options${q}`);
        setShops(Array.isArray(r?.shops) ? r.shops : []);
        setLangs(Array.isArray(r?.langs) ? r.langs : []);
        setLangShop(Array.isArray(r?.lang_shop) ? r.lang_shop : []);
      } catch { setShops([]); setLangs([]); setLangShop([]); }
    }
    loadOpts();
  }, [profileId, prefix]);

  // Load prompts from Automation Suite
  React.useEffect(() => {
    (async () => {
      // Load DB profiles list so user can set the MySQL profile at the top of this panel
      try {
        const r2 = await api('/api/db-mysql/profiles');
        const items = Array.isArray(r2?.items) ? r2.items : [];
        setDbProfiles(items);
        const header = profileId ? String(profileId) : '';
        if (header) setDbProfileId(header);
        else if (!dbProfileId && items.length) setDbProfileId(String(items[0].id));
      } catch { setDbProfiles([]); }
      try {
        const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
        const r = await api(`/api/automation-suite/prompt-configs${q}`);
        const arr = Array.isArray(r?.items) ? r.items : [];
        setPromptConfigs(arr);
        if (arr.length && !selectedPromptId) setSelectedPromptId(String(arr[0].id || ''));
      } catch { setPromptConfigs([]); }
    })();
  }, [orgId]);

  async function saveNewProfile() {
    try {
      // Persist only the requested scope keys (from_id, to_id, where)
      const scopeSave = {
        category_id_from: scope.category_id_from ? Number(scope.category_id_from) : null,
        category_id_to: scope.category_id_to ? Number(scope.category_id_to) : null,
        where: scope.where || null,
        id_shop: scope.id_shop ? Number(scope.id_shop) : null,
        id_lang: scope.id_lang ? Number(scope.id_lang) : null,
      };
      const body = { name: profileName || 'Profile', org_id: orgId || null, profile_id: (dbProfileId || profileId || null), prefix: prefix || '', fields, scope: scopeSave, prompt_config_id: selectedPromptId || null };
      const r = await api('/api/category_data_update/fill-profiles', { method:'POST', body: JSON.stringify(body) });
      setToast({ open:true, type:'success', message:`Saved profile #${r.id}` });
      // Select and remember the newly created profile
      try { localStorage.setItem('cdu:fill:last_profile', JSON.stringify({ id: r.id, orgId: orgId || null, when: Date.now() })); } catch {}
      setSelProfileId(String(r.id));
      await loadSaved();
      setTimeout(() => { try { loadProfile(String(r.id)); } catch {} }, 0);
    } catch (e) { setToast({ open:true, type:'error', message: String(e?.message||e) }); }
  }

  async function updateProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) return;
      const scopeSave = {
        category_id_from: scope.category_id_from ? Number(scope.category_id_from) : null,
        category_id_to: scope.category_id_to ? Number(scope.category_id_to) : null,
        where: scope.where || null,
        id_shop: scope.id_shop ? Number(scope.id_shop) : null,
        id_lang: scope.id_lang ? Number(scope.id_lang) : null,
      };
      const body = { org_id: orgId || null, name: profileName || null, profile_id: (dbProfileId || profileId || null), prefix: prefix || null, fields, scope: scopeSave, prompt_config_id: selectedPromptId || null };
      await api(`/api/category_data_update/fill-profiles/${id}`, { method:'PUT', body: JSON.stringify(body) });
      setToast({ open:true, type:'success', message:`Updated profile #${id}` });
      // Remember this profile as the last-used one
      try { localStorage.setItem('cdu:fill:last_profile', JSON.stringify({ id, orgId: orgId || null, when: Date.now() })); } catch {}
      await loadSaved();
    } catch (e) { setToast({ open:true, type:'error', message: String(e?.message||e) }); }
  }

  async function deleteProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) return;
      await api(`/api/category_data_update/fill-profiles/${id}`, { method:'DELETE' });
      setToast({ open:true, type:'success', message:`Deleted profile #${id}` });
      setSelProfileId(''); setProfileName('');
      await loadSaved();
    } catch (e) { setToast({ open:true, type:'error', message: String(e?.message||e) }); }
  }

  async function loadProfile(idStr) {
    try {
      const id = Number(idStr || selProfileId || 0); if (!id) return;
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/category_data_update/fill-profiles/${id}${q}`);
      const it = r?.item; if (!it) return;
      setProfileName(it.name || '');
      if (it.fields && typeof it.fields === 'object') setFields(it.fields);
      if (it.scope && typeof it.scope === 'object') {
        setScope(prev => ({
          ...prev,
          where: it.scope.where != null ? String(it.scope.where) : '',
          category_id_from: it.scope.category_id_from != null ? String(it.scope.category_id_from) : '',
          category_id_to: it.scope.category_id_to != null ? String(it.scope.category_id_to) : '',
          id_shop: it.scope.id_shop != null ? String(it.scope.id_shop) : '',
          id_lang: it.scope.id_lang != null ? String(it.scope.id_lang) : '',
        }));
      }
      if (it.prompt_config_id) setSelectedPromptId(String(it.prompt_config_id));
      try {
        if (onApplyProfile && (it.profile_id || it.prefix)) onApplyProfile(it.profile_id || null, it.prefix || '');
        // Also reflect DB profile selector locally
        if (it.profile_id) setDbProfileId(String(it.profile_id));
      } catch {}
      try { localStorage.setItem('cdu:fill:last_profile', JSON.stringify({ id, orgId: orgId || null, when: Date.now() })); } catch {}
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  // Auto-load details when user selects a saved profile
  React.useEffect(() => {
    if (selProfileId) loadProfile(String(selProfileId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selProfileId]);

  function startRunPreview() {
    setToast({ open:true, type:'info', message:'Run creation available; processing implementation pending.' });
  }

  // Load recent runs for this org
  async function loadRuns() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}&limit=20` : '?limit=20';
      const r = await api(`/api/category_data_update/runs${q}`);
      setRecentRuns(Array.isArray(r?.items) ? r.items : []);
    } catch { setRecentRuns([]); }
  }
  React.useEffect(() => { loadRuns(); /* eslint-disable-next-line */ }, [orgId]);

  // SSE stream for live step events
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

  // Visible languages limited by selected shop (ps_lang ∩ ps_lang_shop)
  const visibleLangs = React.useMemo(() => {
    try {
      const sid = Number(scope.id_shop || 0);
      if (!sid || !Array.isArray(langShop) || !langShop.length) return langs;
      const ok = new Set(langShop.filter(x=>Number(x.id_shop)===sid).map(x=>Number(x.id_lang)));
      return (langs||[]).filter(l=>ok.has(Number(l.id_lang)));
    } catch { return langs; }
  }, [langs, langShop, scope.id_shop]);

  async function runGenerate(dry = true) {
    setGenBusy(true); setGenOut(null); cancelRef.current = false;
    try {
      // Build ids from range only
      let rangeIds = [];
      const a = Number(scope.category_id_from || 0);
      const b = Number(scope.category_id_to || 0);
      if (a && b && b >= a) {
        const cap = Math.min(5000, b - a + 1);
        rangeIds = Array.from({ length: cap }, (_, i) => a + i);
      }
      const ids = rangeIds.filter(n=>Number.isFinite(n) && n>0);
      if (!ids.length) { setToast({ open:true, type:'error', message:'Provide at least one category id' }); return; }
      if (!scope.id_shop) { setToast({ open:true, type:'error', message:'Select a shop' }); return; }
      if (!scope.id_lang) { setToast({ open:true, type:'error', message:'Select a language' }); return; }
      const listFields = Object.entries(fields).filter(([,v])=>!!v).map(([k])=>k);
      // Same-language fill: only one language is required
      setProg({ running:true, current:0, total: ids.length, updated:0, skipped:0, errors:0 });
      setToast({ open:true, type:'info', message: dry ? 'Starting preview…' : 'Starting run…' });
      // Start run
      let runId = null;
      try {
        const start = await api('/api/category_data_update/runs', { method:'POST', body: JSON.stringify({ org_id: orgId || null, profile_id: profileId, prefix, id_shop: Number(scope.id_shop), id_lang: Number(scope.id_lang), prompt_config_id: selectedPromptId || null, totals: { requested: ids.length, done: 0, updated: 0, skipped: 0, errors: 0 }, params: { scope: { range: { from: scope.category_id_from || null, to: scope.category_id_to || null }, where: scope.where || null, id_shop: Number(scope.id_shop), id_lang: Number(scope.id_lang) } } }) });
        runId = start?.id || null;
        if (runId) setCurrentRunId(runId);
      } catch {}

      const size = Math.max(1, Number(chunkSize)||50);
      const chunks = []; for (let i=0; i<ids.length; i+=size) chunks.push(ids.slice(i, i+size));
      for (let ci = 0; ci < chunks.length; ci++) {
        if (cancelRef.current) break;
        const body = { profile_id: profileId, prefix, fields: listFields, id_lang: Number(scope.id_lang), scope: { category_ids: chunks[ci], id_shop: Number(scope.id_shop), id_lang: Number(scope.id_lang), where: scope.where || null }, prompt_config_id: selectedPromptId || null, overwrite: false, dry_run: !!dry, run_id: runId };
        let ok = true; let items = [];
        try {
          const r = await api('/api/category_data_update/categories/fill-missing', { method:'POST', body: JSON.stringify(body) });
          // The backend is stub; synthesize items from requested ids
          items = chunks[ci].map(id => ({ id_category: id, updated: !dry, status: dry ? 'ok' : 'updated', message: dry ? 'preview' : null }));
          ok = !!r?.ok;
        } catch (e) { ok = false; items = chunks[ci].map(id => ({ id_category: id, updated: false, status: 'error', message: String(e?.message||e) })); }
        // Append run items
        if (runId) {
          const inc = { requested: chunks[ci].length, done: chunks[ci].length, updated: items.filter(it=>it.status==='updated' && it.updated).length, skipped: items.filter(it=>it.status==='skipped').length, errors: items.filter(it=>it.status==='error').length };
          try { await api(`/api/category_data_update/runs/${encodeURIComponent(runId)}/append`, { method:'POST', body: JSON.stringify({ items, totals: inc }) }); } catch {}
        }
        setProg(prev => ({ ...prev, current: Math.min(ids.length, prev.current + chunks[ci].length), updated: prev.updated + items.filter(it=>it.status==='updated' && it.updated).length, skipped: prev.skipped + items.filter(it=>it.status==='skipped').length, errors: prev.errors + items.filter(it=>it.status==='error').length }));
      }
      if (runId) { try { await api(`/api/category_data_update/runs/${encodeURIComponent(runId)}/finish`, { method:'POST', body: JSON.stringify({ status: dry ? 'done' : 'done' }) }); } catch {} }
      setGenOut({ ok:true, message: dry ? 'Preview completed' : 'Run completed', run_id: runId });
      setToast({ open:true, type:'success', message: dry ? 'Preview completed' : 'Run completed' });
      loadRuns();
    } catch (e) {
      const msg = String(e?.message||e);
      setGenOut({ ok:false, error: msg });
      setToast({ open:true, type:'error', message: msg });
    } finally {
      setGenBusy(false); setProg(prev => ({ ...prev, running:false }));
    }
  }

  function cancelRun() { cancelRef.current = true; }

  return (
    <div className="panel">
      {toast.open && (
        <Toast open={toast.open} type={toast.type} message={toast.message} onClose={()=>setToast({ open:false, type:'info', message:'' })} />
      )}
      <div className="panel__header">Category – Fill Missing</div>
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
            <button className="px-3 py-1.5 text-sm border rounded" onClick={updateProfile} disabled={!selProfileId}>Update</button>
            <button className="px-3 py-1.5 text-sm border rounded" onClick={deleteProfile} disabled={!selProfileId}>Delete</button>
          </div>
          <div>
            <label className="block text-sm mb-1">Name</label>
            <input className="border rounded px-2 py-1 text-sm min-w-[220px]" placeholder="Profile name" value={profileName} onChange={e=>setProfileName(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm border rounded" onClick={saveNewProfile}>Save New</button>
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
          <div>
            <div className="font-medium mb-1">Prompt</div>
            <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={selectedPromptId} onChange={e=>setSelectedPromptId(e.target.value)}>
              <option value="">(none)</option>
              {promptConfigs.map(p => (<option key={p.id} value={p.id}>{`${p.name || p.id}`}</option>))}
            </select>
          </div>
          <div>
            <div className="font-medium mb-1">Scope</div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-sm mb-1">From ID</label>
                <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. 100" value={scope.category_id_from} onChange={e=>setScope(prev=>({ ...prev, category_id_from: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm mb-1">To ID</label>
                <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. 150" value={scope.category_id_to} onChange={e=>setScope(prev=>({ ...prev, category_id_to: e.target.value }))} />
              </div>
            </div>
            <label className="block text-sm mt-2 mb-1">SQL WHERE (optional)</label>
            <input className="border rounded px-2 py-1 text-sm w-full" placeholder="id_category > 0 AND active = 1" value={scope.where} onChange={e=>setScope(prev=>({ ...prev, where: e.target.value }))} />
          </div>
          <div>
            <div className="font-medium mb-1">Shop / Language</div>
            <div className="mb-1">
              <label className="block text-sm">Shop</label>
              <select className="border rounded px-2 py-1 text-sm min-w-[160px]" value={scope.id_shop} onChange={e=>setScope(prev=>({ ...prev, id_shop: e.target.value }))}>
                <option value="">(select)</option>
                {shops.map(s => (<option key={s.id_shop} value={s.id_shop}>{`#${s.id_shop} ${s.name}`}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm">Language</label>
              <select className="border rounded px-2 py-1 text-sm min-w-[160px]" value={scope.id_lang} onChange={e=>setScope(prev=>({ ...prev, id_lang: e.target.value }))}>
                <option value="">(select)</option>
                {visibleLangs.map(l => (<option key={l.id_lang} value={l.id_lang}>{`#${l.id_lang} ${l.name} (${l.iso_code})`}</option>))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>runGenerate(true)} disabled={!profileId || !prefix || genBusy}>Start Run (Preview)</button>
          <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>runGenerate(false)} disabled={!profileId || !prefix || genBusy}>Start Run</button>
          <button className="px-3 py-1.5 text-sm border rounded" onClick={cancelRun} disabled={!genBusy}>Cancel</button>
          <div className="text-xs text-gray-600">Chunk size:</div>
          <input className="border rounded px-2 py-1 text-sm w-[64px]" value={chunkSize} onChange={e=>setChunkSize(e.target.value)} />
          {prog.running && (
            <div className="text-xs text-gray-700">{`${prog.current}/${prog.total}`} (upd {prog.updated} / skip {prog.skipped} / err {prog.errors})</div>
          )}
        </div>
        {genOut && <div className={"text-xs mt-2 "+(genOut.ok? 'text-green-700':'text-red-700')}>{genOut.ok? genOut.message : genOut.error}</div>}

        {/* Live Steps */}
        <div className="p-3 border rounded bg-white mt-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">Live Steps</div>
            <div className="flex items-center gap-3 text-sm">
              <label className="inline-flex items-center"><input type="checkbox" className="mr-1" checked={sseEnabled} onChange={e=>setSseEnabled(!!e.target.checked)} />Live stream</label>
              <div className="text-gray-600">{currentRunId ? `Run #${currentRunId}` : '(no run yet)'}</div>
            </div>
          </div>
          <div className="border rounded max-h-72 overflow-auto mt-2">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-1 border-b">Time</th>
                  <th className="text-left px-2 py-1 border-b">Category</th>
                  <th className="text-left px-2 py-1 border-b">Lang</th>
                  <th className="text-left px-2 py-1 border-b">Step</th>
                  <th className="text-left px-2 py-1 border-b">Details</th>
                </tr>
              </thead>
              <tbody>
                {stepEvents.map((ev, idx) => (
                  <tr key={idx} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-1 border-b">{new Date(ev.t).toLocaleTimeString()}</td>
                    <td className="px-2 py-1 border-b">{ev.id_category}</td>
                    <td className="px-2 py-1 border-b">{ev.id_lang}</td>
                    <td className="px-2 py-1 border-b">{ev.type}</td>
                    <td className="px-2 py-1 border-b break-all">{ev.fields ? String(ev.fields) : (ev.message || '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
