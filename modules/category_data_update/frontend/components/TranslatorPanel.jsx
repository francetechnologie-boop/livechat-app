import React from 'react';
import Toast from './Toast.jsx';

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

const FIELD_DEFAULTS = { name:true, meta_title:true, meta_description:true, link_rewrite:false, description:false };

export default function TranslatorPanel({ profileId, prefix, orgId, onApplyProfile }) {
  const [fields, setFields] = React.useState({ ...FIELD_DEFAULTS });
  const [scope, setScope] = React.useState({ category_id_from:'', category_id_to:'', where:'', id_shop_from:'', id_shop_to:'' });
  const [shops, setShops] = React.useState([]);
  const [langs, setLangs] = React.useState([]);
  const [langShop, setLangShop] = React.useState([]);
  const [langFromId, setLangFromId] = React.useState('');
  const [langToIds, setLangToIds] = React.useState([]);
  const [promptConfigs, setPromptConfigs] = React.useState([]);
  const [selectedPromptId, setSelectedPromptId] = React.useState('');
  const [chunkSize, setChunkSize] = React.useState(50);
  const [prog, setProg] = React.useState({ running:false, current:0, total:0, updated:0, skipped:0, errors:0 });
  const [genBusy, setGenBusy] = React.useState(false);
  const [genOut, setGenOut] = React.useState(null);
  const cancelRef = React.useRef(false);
  // Prompt debug UI removed per request
  const [showPromptJson, setShowPromptJson] = React.useState(false);
  const [promptJsonLoading, setPromptJsonLoading] = React.useState(false);
  const [promptJson, setPromptJson] = React.useState([]);
  const [recentRuns, setRecentRuns] = React.useState([]);
  const [runDetail, setRunDetail] = React.useState(null);
  // Live Steps (SSE)
  const [sseEnabled, setSseEnabled] = React.useState(true);
  const [currentRunId, setCurrentRunId] = React.useState(null);
  const sseRef = React.useRef(null);
  const [stepEvents, setStepEvents] = React.useState([]);
  const [copiedKey, setCopiedKey] = React.useState(null);
  // Saved translator profiles
  const [saved, setSaved] = React.useState([]);
  const [selProfileId, setSelProfileId] = React.useState('');
  const [profileName, setProfileName] = React.useState('');
  const [toast, setToast] = React.useState({ open:false, type:'info', message:'' });
  const autoLoadedRef = React.useRef(false);
  const [dbProfiles, setDbProfiles] = React.useState([]);
  const [dbProfileId, setDbProfileId] = React.useState('');

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    async function loadOpts() {
      if (!profileId || !prefix) { setShops([]); setLangs([]); setLangShop([]); return; }
      try {
        const q = `?profile_id=${encodeURIComponent(profileId)}&prefix=${encodeURIComponent(prefix)}`;
        const r = await api(`/api/category_data_update/mysql/options${q}`);
        setShops(Array.isArray(r?.shops) ? r.shops : []);
        setLangs(Array.isArray(r?.langs) ? r.langs : []);
        setLangShop(Array.isArray(r?.lang_shop) ? r.lang_shop : []);
        // Set a default from-language only if it hasn't been set by a loaded profile or user action.
        if (r?.langs && r.langs[0]) setLangFromId(prev => (prev ? prev : String(r.langs[0].id_lang)));
      } catch { setShops([]); setLangs([]); setLangShop([]); }
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

  const visibleLangs = React.useMemo(() => {
    try {
      const sid = Number(scope.id_shop_to || 0);
      if (!sid || !Array.isArray(langShop) || !langShop.length) return langs;
      const ok = new Set(langShop.filter(x=>Number(x.id_shop)===sid).map(x=>Number(x.id_lang)));
      return langs.filter(l=>ok.has(Number(l.id_lang)));
    } catch { return langs; }
  }, [langs, langShop, scope.id_shop_to]);

  // Limit From-language choices to origin shop languages
  const fromVisibleLangs = React.useMemo(() => {
    try {
      const sid = Number(scope.id_shop_from || 0);
      if (!sid || !Array.isArray(langShop) || !langShop.length) return langs;
      const ok = new Set(langShop.filter(x=>Number(x.id_shop)===sid).map(x=>Number(x.id_lang)));
      return langs.filter(l=>ok.has(Number(l.id_lang)));
    } catch { return langs; }
  }, [langs, langShop, scope.id_shop_from]);

  // Keep selected target languages consistent with destination shop
  React.useEffect(() => {
    try {
      const list = Array.isArray(visibleLangs) ? visibleLangs : [];
      // Do not prune until destination shop languages are loaded
      if (!list.length) return;
      const allowed = new Set(list.map(l => String(l.id_lang)));
      setLangToIds(prev => Array.isArray(prev) ? prev.filter(id => allowed.has(String(id))) : []);
    } catch {}
  }, [visibleLangs, scope.id_shop_to]);

  // Ensure selected from-language is valid for origin shop
  React.useEffect(() => {
    try {
      const list = Array.isArray(fromVisibleLangs) ? fromVisibleLangs : [];
      if (!list.length) return; // options not loaded yet
      const allowed = new Set(list.map(l => String(l.id_lang)));
      if (!allowed.has(String(langFromId || ''))) {
        const fallback = list[0] ? String(list[0].id_lang) : '';
        setLangFromId(fallback);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromVisibleLangs, scope.id_shop_from]);

  // Load saved translator profiles
  async function loadSaved() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/category_data_update/translator-profiles${q}`);
      setSaved(Array.isArray(r?.items) ? r.items : []);
    } catch { setSaved([]); }
  }
  React.useEffect(() => { loadSaved(); /* eslint-disable-next-line */ }, [orgId]);

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

  // Auto-load last translator profile or fallback to latest
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      const raw = localStorage.getItem('cdu:translator:last_profile');
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || !obj.id) return;
      if (orgId && obj.orgId && String(obj.orgId) !== String(orgId)) return;
      if (!Array.isArray(saved) || !saved.length) return;
      const exists = saved.some(p => String(p.id) === String(obj.id));
      if (!exists) return;
      setSelProfileId(String(obj.id));
      autoLoadedRef.current = true;
      setTimeout(()=>{ try { onLoadProfile(); } catch {} },0);
    } catch {}
  }, [saved, orgId]);

  // Auto-load when a saved profile is selected
  React.useEffect(() => {
    if (selProfileId) {
      try { onLoadProfile(); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selProfileId]);

  function buildIds() {
    let range = [];
    const a = Number(scope.category_id_from || 0);
    const b = Number(scope.category_id_to || 0);
    if (a && b && b >= a) {
      const cap = Math.min(5000, b - a + 1);
      range = Array.from({ length: cap }, (_, i) => a + i);
    }
    return Array.from(new Set(range)).filter(n=>Number.isFinite(n) && n>0);
  }

  async function loadRuns() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}&limit=20` : '?limit=20';
      const r = await api(`/api/category_data_update/translator-runs${q}`);
      setRecentRuns(Array.isArray(r?.items) ? r.items : []);
    } catch { setRecentRuns([]); }
  }
  React.useEffect(() => { loadRuns(); /* eslint-disable-next-line */ }, [orgId]);

  async function startRuns(dry = true) {
    setGenBusy(true); setGenOut(null); cancelRef.current = false; setRunDetail(null);
    try {
      if (!profileId || !prefix) throw new Error('Select DB profile and prefix');
      if (!scope.id_shop_to) throw new Error('Select destination shop');
      if (!langFromId) throw new Error('Select from language');
      if (!Array.isArray(langToIds) || !langToIds.length) throw new Error('Select at least one target language');
      const ids = buildIds();
      if (!ids.length) throw new Error('Provide at least one category id');
      const size = Math.max(1, Number(chunkSize)||50);
      const fieldsArr = Object.entries(fields).filter(([,v])=>!!v).map(([k])=>k);
      const toIds = Array.from(new Set((langToIds||[]).map(x=>Number(x)).filter(Number.isFinite))).sort((a,b)=>a-b);
      setProg({ running:true, current:0, total: ids.length * toIds.length, updated:0, skipped:0, errors:0 });

      // Create a single run for multi-language processing
      let runId = null;
      try {
        const start = await api('/api/category_data_update/translator-runs', { method:'POST', body: JSON.stringify({
          org_id: orgId || null,
          profile_id: (dbProfileId || profileId),
          prefix,
          prompt_config_id: selectedPromptId || null,
          totals: { requested: ids.length * toIds.length, done: 0, updated: 0, skipped: 0, errors: 0 },
          params: { kind:'translator', scope: { list: '', range: { from: scope.category_id_from || null, to: scope.category_id_to || null }, where: scope.where || null, id_shop_from: scope.id_shop_from ? Number(scope.id_shop_from) : null, id_shop: Number(scope.id_shop_to), lang_from_id: Number(langFromId), lang_to_ids: toIds } }
        }) });
        runId = start?.id || null;
        if (runId) setCurrentRunId(runId);
      } catch {}

      const chunks = []; for (let i=0; i<ids.length; i+=size) chunks.push(ids.slice(i, i+size));
      for (const chunk of chunks) {
        if (cancelRef.current) break;
        try {
          await api('/api/category_data_update/categories/translate', { method:'POST', body: JSON.stringify({ run_id: runId || null, profile_id: profileId, prefix, fields: fieldsArr, lang_from: Number(langFromId), lang_to_ids: toIds, scope: { category_ids: chunk, id_shop_from: scope.id_shop_from ? Number(scope.id_shop_from) : null, id_shop: Number(scope.id_shop_to), where: scope.where || null }, prompt_config_id: selectedPromptId || null, dry_run: !!dry }) });
        } catch {}
        // Append totals for this chunk (per category × per language)
        if (runId) {
          const items = [];
          for (const id of chunk) { for (const lid of toIds) items.push({ id_category: id, updated: !dry, status: dry ? 'ok' : 'updated' }); }
          const inc = { requested: items.length, done: items.length, updated: items.filter(it=>it.updated).length, skipped: items.filter(it=>it.status==='skipped').length, errors: items.filter(it=>it.status==='error').length };
          try { await api(`/api/category_data_update/translator-runs/${encodeURIComponent(runId)}/append`, { method:'POST', body: JSON.stringify({ items, totals: inc }) }); } catch {}
        }
        setProg(prev => ({ ...prev, current: Math.min(prev.total, prev.current + (chunk.length * toIds.length)) }));
      }
      if (runId) { try { await api(`/api/category_data_update/translator-runs/${encodeURIComponent(runId)}/finish`, { method:'POST', body: JSON.stringify({ status: dry ? 'done':'done' }) }); } catch {} }
      setGenOut({ ok:true, message: dry ? 'Preview completed' : 'Run(s) completed' });
      loadRuns();
    } catch (e) {
      setGenOut({ ok:false, error:String(e?.message||e) });
    } finally {
      setGenBusy(false); setProg(prev => ({ ...prev, running:false }));
    }
  }

  function cancelRun() { cancelRef.current = true; }

  async function fetchPromptJson() {
    setShowPromptJson(true);
    setPromptJsonLoading(true);
    setPromptJson([]);
    try {
      if (!profileId || !prefix) throw new Error('Select DB profile and prefix');
      if (!scope.id_shop_to) throw new Error('Select destination shop');
      if (!langFromId) throw new Error('Select from language');
      if (!Array.isArray(langToIds) || !langToIds.length) throw new Error('Select at least one target language');
      const ids = buildIds();
      if (!ids.length) throw new Error('Provide at least one category id');
      const fieldsArr = Object.entries(fields).filter(([,v])=>!!v).map(([k])=>k);
      // Preview for the first selected target language (sorted for stability)
      const toId = Array.from(new Set((langToIds||[]).map(x=>Number(x)).filter(Number.isFinite))).sort((a,b)=>a-b)[0];
      const body = {
        profile_id: profileId,
        prefix,
        fields: fieldsArr,
        lang_from: Number(langFromId),
        lang_to: toId,
        scope: {
          category_ids: ids.slice(0, Math.max(1, Number(chunkSize)||50)),
          id_shop_from: scope.id_shop_from ? Number(scope.id_shop_from) : null,
          id_shop: Number(scope.id_shop_to),
          where: scope.where || null
        }
      };
      const r = await api('/api/category_data_update/categories/translate-build-input', { method:'POST', body: JSON.stringify(body) });
      setPromptJson(Array.isArray(r?.inputs) ? r.inputs : []);
    } catch (e) {
      setPromptJson([{ error: String(e?.message||e) }]);
    } finally {
      setPromptJsonLoading(false);
    }
  }
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      if (!Array.isArray(saved) || !saved.length) return;
      const latest = saved[0]; if (!latest || !latest.id) return;
      setSelProfileId(String(latest.id)); autoLoadedRef.current = true;
      try { localStorage.setItem('cdu:translator:last_profile', JSON.stringify({ id: latest.id, orgId: orgId || null, when: Date.now() })); } catch {}
      setTimeout(()=>{ try { onLoadProfile(); } catch {} },0);
    } catch {}
  }, [saved, orgId]);

  async function onLoadProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) return;
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/category_data_update/translator-profiles/${id}${q}`);
      const it = r?.item; if (!it) return;
      setProfileName(it.name || '');
      if (it.fields && typeof it.fields === 'object') setFields(prev => ({ ...prev, ...FIELD_DEFAULTS, ...it.fields }));
      setScope(prev => ({ ...prev, id_shop_from: String(it.id_shop_from || ''), id_shop_to: String((it.id_shop_to != null ? it.id_shop_to : it.id_shop) || ''), category_id_from: it.scope_from != null ? String(it.scope_from) : '', category_id_to: it.scope_to != null ? String(it.scope_to) : '', where: String(it.scope_where || '') }));
      if (it.lang_from_id != null) setLangFromId(String(it.lang_from_id));
      if (Array.isArray(it.lang_to_ids)) setLangToIds(it.lang_to_ids.map(x=>String(x)));
      if (it.prompt_config_id) setSelectedPromptId(String(it.prompt_config_id));
      try { if (onApplyProfile && (it.profile_id || it.prefix)) onApplyProfile(it.profile_id || null, it.prefix || ''); } catch {}
      try { if (it.profile_id) setDbProfileId(String(it.profile_id)); } catch {}
      try { localStorage.setItem('cdu:translator:last_profile', JSON.stringify({ id, orgId: orgId || null, when: Date.now() })); } catch {}
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  async function onSaveNew() {
    try {
      const allowed = new Set((visibleLangs||[]).map(l => String(l.id_lang)));
      const cleaned = (langToIds||[]).filter(id => allowed.has(String(id)));
      const body = {
        org_id: orgId || null,
        name: profileName || 'Profile',
        profile_id: (dbProfileId || profileId || null),
        prefix: prefix || '',
        id_shop_to: scope.id_shop_to ? Number(scope.id_shop_to) : null,
        id_shop_from: scope.id_shop_from ? Number(scope.id_shop_from) : null,
        lang_from_id: langFromId ? Number(langFromId) : null,
        lang_to_ids: cleaned.map(x=>Number(x)).filter(Number.isFinite),
        fields,
        prompt_config_id: selectedPromptId || null,
        limits: {},
        scope_from: scope.category_id_from ? Number(scope.category_id_from) : null,
        scope_to: scope.category_id_to ? Number(scope.category_id_to) : null,
        scope_where: scope.where || null,
        overwrite: false
      };
      const r = await api('/api/category_data_update/translator-profiles', { method:'POST', body: JSON.stringify(body) });
      setToast({ open:true, type:'success', message:`Saved translator profile #${r.id}` });
      await loadSaved();
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  async function onUpdateProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) return;
      const allowed = new Set((visibleLangs||[]).map(l => String(l.id_lang)));
      const cleaned = (langToIds||[]).filter(id => allowed.has(String(id)));
      const body = {
        org_id: orgId || null,
        name: profileName || null,
        profile_id: (dbProfileId || profileId || null),
        prefix: prefix || null,
        id_shop_to: scope.id_shop_to ? Number(scope.id_shop_to) : null,
        id_shop_from: scope.id_shop_from ? Number(scope.id_shop_from) : null,
        lang_from_id: langFromId ? Number(langFromId) : null,
        lang_to_ids: cleaned.map(x=>Number(x)).filter(Number.isFinite),
        fields,
        prompt_config_id: selectedPromptId || null,
        limits: {},
        scope_from: scope.category_id_from ? Number(scope.category_id_from) : null,
        scope_to: scope.category_id_to ? Number(scope.category_id_to) : null,
        scope_where: scope.where || null,
      };
      await api(`/api/category_data_update/translator-profiles/${id}`, { method:'PUT', body: JSON.stringify(body) });
      setToast({ open:true, type:'success', message:`Updated translator profile #${id}` });
      await loadSaved();
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  async function onDeleteProfile() {
    try {
      const id = Number(selProfileId || 0); if (!id) return;
      await api(`/api/category_data_update/translator-profiles/${id}`, { method:'DELETE' });
      setToast({ open:true, type:'success', message:`Deleted translator profile #${id}` });
      setSelProfileId(''); setProfileName('');
      await loadSaved();
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  return (
    <div className="panel">
      {toast.open && (
        <Toast open={toast.open} type={toast.type} message={toast.message} onClose={()=>setToast({ open:false, type:'info', message:'' })} />
      )}
      <div className="panel__header">Category – Translator</div>
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

        {/* Fields and scope */}
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="font-medium mb-1">Fields</div>
            {Object.keys(FIELD_DEFAULTS).map(k => (
              <label key={k} className="block text-sm"><input className="mr-2" type="checkbox" checked={!!fields[k]} onChange={e=>setFields(prev=>({ ...prev, [k]: e.target.checked }))} />{k}</label>
            ))}
          </div>
          <div className="grow min-w-[320px]">
            <div className="font-medium mb-1">Scope</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Origin Shop (id_shop_from)</label>
                <select className="border rounded px-2 py-1 text-sm w-full" value={scope.id_shop_from} onChange={e=>setScope(prev=>({ ...prev, id_shop_from: e.target.value }))}>
                  <option value="">Select origin shop</option>
                  {shops.map(s => (<option key={s.id_shop} value={s.id_shop}>{`#${s.id_shop} ${s.name||''}`}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Destination Shop (id_shop_to)</label>
                <select className="border rounded px-2 py-1 text-sm w-full" value={scope.id_shop_to} onChange={e=>setScope(prev=>({ ...prev, id_shop_to: e.target.value }))}>
                  <option value="">Select destination shop</option>
                  {shops.map(s => (<option key={s.id_shop} value={s.id_shop}>{`#${s.id_shop} ${s.name||''}`}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">From language (ps_lang ∩ ps_lang_shop for origin)</label>
                <select className="border rounded px-2 py-1 text-sm w-full" value={langFromId} onChange={e=>setLangFromId(e.target.value)}>
                  {fromVisibleLangs.map(l => (<option key={l.id_lang} value={l.id_lang}>{`#${l.id_lang} ${l.iso_code||''}`}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">To languages (ps_lang ∩ ps_lang_shop for destination)</label>
                <div className="border rounded p-2 h-[84px] overflow-auto">
                  {visibleLangs.map(l => {
                    const id = String(l.id_lang);
                    const checked = langToIds.includes(id);
                    return (
                      <label key={id} className="inline-flex items-center text-sm mr-3 mb-1">
                        <input type="checkbox" className="mr-1" checked={checked} onChange={(e)=>{
                          setLangToIds(prev => e.target.checked ? Array.from(new Set([...prev, id])) : prev.filter(x=>x!==id));
                        }} />
                        {`#${l.id_lang} ${l.iso_code||''}`}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            {/* Category IDs input removed: range-only */}
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
            <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. active=1" value={scope.where} onChange={e=>setScope(prev=>({ ...prev, where: e.target.value }))} />
          </div>
          <div>
            <div className="font-medium mb-1">Prompt</div>
            <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={selectedPromptId} onChange={e=>setSelectedPromptId(e.target.value)}>
              <option value="">(none)</option>
              {promptConfigs.map(p => (<option key={p.id} value={p.id}>{`${p.name || p.id}`}</option>))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <span className="mx-2" />
          <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>startRuns(true)} disabled={!profileId || !prefix || genBusy}>{genBusy ? 'Running…' : 'Preview'}</button>
          <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>startRuns(false)} disabled={!profileId || !prefix || genBusy}>Apply</button>
          <button className="px-3 py-1.5 text-sm border rounded" onClick={fetchPromptJson} disabled={!profileId || !prefix || genBusy}>See Prompt JSON</button>
          <button className="px-3 py-1.5 text-sm border rounded" onClick={cancelRun} disabled={!genBusy}>Cancel</button>
          <div className="text-xs text-gray-600">Chunk size:</div>
          <input className="border rounded px-2 py-1 text-sm w-[64px]" value={chunkSize} onChange={e=>setChunkSize(e.target.value)} />
          {prog.running && (
            <div className="text-xs text-gray-700">{`${prog.current}/${prog.total}`}</div>
          )}
        </div>

        {/* Live Steps (below Apply) */}
        <div className="p-3 border rounded bg-white">
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
                {stepEvents.map((e, idx) => {
                  const t = new Date(e.t||Date.now());
                  const time = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
                  let det = '';
                  try {
                    const m = { ...e };
                    delete m.t; delete m.type; delete m.run_id;
                    det = JSON.stringify(m);
                  } catch {}
                  return (
                    <tr key={idx} className="odd:bg-white even:bg-gray-50">
                      <td className="px-2 py-1 border-b whitespace-nowrap">{time}</td>
                      <td className="px-2 py-1 border-b">{e.id_category || ''}</td>
                      <td className="px-2 py-1 border-b">{e.id_lang != null ? String(e.id_lang) : ''}</td>
                      <td className="px-2 py-1 border-b">{e.type}</td>
                      <td className="px-2 py-1 border-b break-all">
                        <button className="px-1 py-0.5 border rounded mr-2" onClick={()=>{ try { const v = e.prompt || e.output || det; navigator.clipboard?.writeText?.(typeof v === 'string'? v : JSON.stringify(v, null, 2)); setCopiedKey(idx); setTimeout(()=>setCopiedKey(null), 1200); } catch {} }}>{copiedKey===idx? 'Copied':'Copy'}</button>
                        {det}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {genOut && <div className={"text-xs mt-2 "+(genOut.ok? 'text-green-700':'text-red-700')}>{genOut.ok? genOut.message : genOut.error}</div>}

        {/* Prompt debug UI removed per request */}

        {showPromptJson && (
          <div className="mt-3 p-2 border rounded bg-white">
            <div className="font-medium mb-1 text-sm">Prompt JSON preview (first target language)</div>
            {promptJsonLoading && <div className="text-xs text-gray-600">Loading…</div>}
            {!promptJsonLoading && (
              <div className="max-h-60 overflow-auto text-xs">
                <pre className="whitespace-pre-wrap break-all bg-gray-50 p-2 rounded">{JSON.stringify(promptJson, null, 2)}</pre>
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
          <div className="font-medium mb-1">Recent Translator Runs</div>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-1 border-b">ID</th>
                  <th className="text-left px-2 py-1 border-b">Status</th>
                  <th className="text-left px-2 py-1 border-b">Shop/Lang</th>
                  <th className="text-left px-2 py-1 border-b">Totals</th>
                  <th className="text-left px-2 py-1 border-b">Created</th>
                  <th className="text-left px-2 py-1 border-b">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map(r => { const t=r.totals||{}; const req=+t.requested||0, dn=+t.done||0, up=+t.updated||0, sk=+t.skipped||0, er=+t.errors||0; const sc=(r.params&&r.params.scope)||{}; const shop=sc.id_shop!=null?String(sc.id_shop):''; const langsArr=Array.isArray(sc.lang_to_ids)?sc.lang_to_ids:[]; const langDisp=(langsArr.length===1? String(langsArr[0]) : (langsArr.length>1? `multi(${langsArr.length})` : (sc.id_lang!=null? String(sc.id_lang):''))); return (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-1 border-b">{r.id}</td>
                    <td className="px-2 py-1 border-b">{r.status}</td>
                    <td className="px-2 py-1 border-b">{shop}/{langDisp}</td>
                    <td className="px-2 py-1 border-b">{`req:${req} done:${dn} up:${up} sk:${sk} er:${er}`}</td>
                    <td className="px-2 py-1 border-b">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-2 py-1 border-b"><button className="px-2 py-0.5 border rounded" onClick={async()=>{ try { const det = await api(`/api/category_data_update/translator-runs/${r.id}`); setRunDetail(det); } catch(e){ setToast({ open:true, type:'error', message:String(e?.message||e)}); } }}>View</button></td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
          {runDetail && (
            <div className="mt-3">
              <div className="font-medium mb-1">Run #{runDetail.run?.id}</div>
              <div className="overflow-auto border rounded max-h-64">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-2 py-1 border-b">Category</th>
                      <th className="text-left px-2 py-1 border-b">Status</th>
                      <th className="text-left px-2 py-1 border-b">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(runDetail.items||[]).map((it, idx) => (
                      <tr key={idx} className="odd:bg-white even:bg-gray-50">
                        <td className="px-2 py-1 border-b">{it.id_category}</td>
                        <td className="px-2 py-1 border-b">{it.status}</td>
                        <td className="px-2 py-1 border-b break-all">{it.message||''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
