import React from 'react';
import Toast from './Toast.jsx';

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

export default function ImageMakerPanel({ orgId, profileId, prefix }) {
  const [items, setItems] = React.useState([]);
  const [selId, setSelId] = React.useState('');
  const [name, setName] = React.useState('');
  const [ftpProfiles, setFtpProfiles] = React.useState([]);
  const [ftpProfileId, setFtpProfileId] = React.useState('');
  const [dbProfiles, setDbProfiles] = React.useState([]);
  const [dbProfileId, setDbProfileId] = React.useState('');
  const [basePath, setBasePath] = React.useState('');
  const [promptId, setPromptId] = React.useState('');
  const [promptConfigs, setPromptConfigs] = React.useState([]);
  const [categoryIds, setCategoryIds] = React.useState('');
  const [rangeFrom, setRangeFrom] = React.useState('');
  const [rangeTo, setRangeTo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [out, setOut] = React.useState(null);
  const [toast, setToast] = React.useState({ open:false, type:'info', message:'' });
  const [shops, setShops] = React.useState([]);
  const [langs, setLangs] = React.useState([]);
  const [langShop, setLangShop] = React.useState([]);
  const [idShop, setIdShop] = React.useState('');
  const [idLang, setIdLang] = React.useState('');
  // Live steps (SSE)
  const [sseEnabled, setSseEnabled] = React.useState(true);
  const [currentRunId, setCurrentRunId] = React.useState(null);
  const sseRef = React.useRef(null);
  const [stepEvents, setStepEvents] = React.useState([]);

  async function loadProfiles() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/category_data_update/image-profiles${q}`);
      setItems(Array.isArray(r?.items) ? r.items : []);
    } catch { setItems([]); }
  }
  React.useEffect(() => { loadProfiles(); /* eslint-disable-next-line */ }, [orgId]);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await api('/api/ftp-connection/profiles');
        setFtpProfiles(Array.isArray(r?.items) ? r.items : []);
      } catch { setFtpProfiles([]); }
      try {
        const r2 = await api('/api/db-mysql/profiles');
        const items = Array.isArray(r2?.items) ? r2.items : [];
        setDbProfiles(items);
        // Default dbProfileId to header profileId or first
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
        const arr = Array.isArray(r?.items) ? r.items : [];
        setPromptConfigs(arr);
        if (arr.length && !promptId) setPromptId(String(arr[0].id || ''));
      } catch { setPromptConfigs([]); }
    })();
  }, [orgId]);

  async function loadOne(id) {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/category_data_update/image-profiles/${id}${q}`);
      const it = r?.item; if (!it) return;
      setName(it.name || '');
      setFtpProfileId(String(it.ftp_profile_id || ''));
      setBasePath(it.base_path || '');
      setIdShop(it.id_shop != null ? String(it.id_shop) : '');
      setIdLang(it.id_lang != null ? String(it.id_lang) : '');
      setPromptId(String(it.prompt_config_id || ''));
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }
  React.useEffect(() => { if (selId) loadOne(selId); }, [selId]);

  // Load shops/langs from selected DB profile + prefix
  React.useEffect(() => {
    (async () => {
      try {
        const useId = dbProfileId || profileId;
        if (!useId || !prefix) { setShops([]); setLangs([]); setLangShop([]); return; }
        const q = `?profile_id=${encodeURIComponent(useId)}&prefix=${encodeURIComponent(prefix)}`;
        const r = await api(`/api/category_data_update/mysql/options${q}`);
        setShops(Array.isArray(r?.shops) ? r.shops : []);
        setLangs(Array.isArray(r?.langs) ? r.langs : []);
        setLangShop(Array.isArray(r?.lang_shop) ? r.lang_shop : []);
      } catch { setShops([]); setLangs([]); setLangShop([]); }
    })();
  }, [dbProfileId, profileId, prefix]);

  const visibleLangs = React.useMemo(() => {
    try {
      const sid = Number(idShop || 0);
      if (!sid || !Array.isArray(langShop) || !langShop.length) return langs;
      const ok = new Set(langShop.filter(x=>Number(x.id_shop)===sid).map(x=>Number(x.id_lang)));
      return langs.filter(l=>ok.has(Number(l.id_lang)));
    } catch { return langs; }
  }, [langs, langShop, idShop]);

  async function saveNew() {
    try {
      const pid = ftpProfileId || (ftpProfiles[0]?.id ? String(ftpProfiles[0].id) : '');
      const body = { org_id: orgId || null, name, ftp_profile_id: pid ? Number(pid) : null, db_profile_id: dbProfileId ? Number(dbProfileId) : (profileId || null), id_shop: idShop ? Number(idShop) : null, id_lang: idLang ? Number(idLang) : null, base_path: basePath, prompt_config_id: promptId || null };
      const r = await api('/api/category_data_update/image-profiles', { method:'POST', body: JSON.stringify(body) });
      setToast({ open:true, type:'success', message:`Saved profile #${r.id}` });
      setSelId(String(r.id));
      await loadProfiles();
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }
  async function update() {
    try {
      const id = Number(selId || 0); if (!id) return;
      const body = { org_id: orgId || null, name, ftp_profile_id: ftpProfileId ? Number(ftpProfileId) : null, db_profile_id: dbProfileId ? Number(dbProfileId) : (profileId || null), id_shop: idShop ? Number(idShop) : null, id_lang: idLang ? Number(idLang) : null, base_path: basePath, prompt_config_id: promptId || null };
      await api(`/api/category_data_update/image-profiles/${id}`, { method:'PUT', body: JSON.stringify(body) });
      setToast({ open:true, type:'success', message:`Updated profile #${id}` });
      await loadProfiles();
    } catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }
  async function remove() {
    try { const id = Number(selId||0); if (!id) return; await api(`/api/category_data_update/image-profiles/${id}`, { method:'DELETE' }); setToast({ open:true, type:'success', message:`Deleted profile #${id}` }); setSelId(''); await loadProfiles(); }
    catch (e) { setToast({ open:true, type:'error', message:String(e?.message||e)}); }
  }

  function parseIds() {
    const typed = String(categoryIds||'').split(',').map(s=>Number(s.trim())).filter(n=>Number.isFinite(n) && n>0);
    const a = Number(rangeFrom || 0);
    const b = Number(rangeTo || 0);
    let rng = [];
    if (a && b && b >= a) {
      const cap = Math.min(5000, b - a + 1);
      rng = Array.from({ length: cap }, (_, i) => a + i);
    }
    return Array.from(new Set([...typed, ...rng])).filter(n=>Number.isFinite(n) && n>0).sort((x,y)=>x-y);
  }

  async function run(dry = true) {
    setBusy(true); setOut(null);
    try {
      const useDb = dbProfileId || profileId;
      if (!useDb || !prefix) throw new Error('Select MySQL profile and prefix');
      const ids = parseIds(); if (!ids.length) throw new Error('Provide category ids');
      const id = Number(selId||0); if (!id) throw new Error('Select an image profile');
      // Start a run for live steps
      let runId = null;
      if (sseEnabled) {
        try {
          const rr = await api('/api/category_data_update/runs', { method:'POST', body: JSON.stringify({ org_id: orgId || null, profile_id: Number(useDb), prefix: prefix || null, id_shop: idShop ? Number(idShop) : null, id_lang: idLang ? Number(idLang) : null, prompt_config_id: promptId || null, totals: { requested: ids.length, done: 0, updated: 0, skipped: 0, errors: 0 }, params: { kind: 'image-maker', preview: !!dry } }) });
          runId = rr?.id || null; setCurrentRunId(runId);
        } catch (e) { /* non-fatal for preview */ }
        // Open SSE stream
        try {
          if (runId) {
            try { sseRef.current?.close?.(); } catch {}
            const es = new EventSource(`/api/category_data_update/translator-runs/${encodeURIComponent(runId)}/stream`);
            sseRef.current = es;
            const pushEvt = (type, payload) => { try { setStepEvents(prev => [{ t: Date.now(), type, ...(payload||{}) }, ...prev].slice(0, 200)); } catch {} };
            es.addEventListener('image_start', ev => { try { pushEvt('image_start', JSON.parse(ev.data||'{}')); } catch {} });
            es.addEventListener('prompt_request', ev => { try { pushEvt('prompt_request', JSON.parse(ev.data||'{}')); } catch {} });
            es.addEventListener('prompt_received', ev => { try { pushEvt('prompt_received', JSON.parse(ev.data||'{}')); } catch {} });
            es.addEventListener('prompt_output', ev => { try { pushEvt('prompt_output', JSON.parse(ev.data||'{}')); } catch {} });
            es.addEventListener('resize_done', ev => { try { pushEvt('resize_done', JSON.parse(ev.data||'{}')); } catch {} });
            es.addEventListener('ftp_upload', ev => { try { pushEvt('ftp_upload', JSON.parse(ev.data||'{}')); } catch {} });
            es.addEventListener('image_done', ev => { try { pushEvt('image_done', JSON.parse(ev.data||'{}')); } catch {} });
            es.addEventListener('image_error', ev => { try { pushEvt('image_error', JSON.parse(ev.data||'{}')); } catch {} });
          }
        } catch {}
      }
      const r = await api('/api/category_data_update/categories/image-make', { method:'POST', body: JSON.stringify({ org_id: orgId || null, profile_id: id, ids, db_profile_id: Number(useDb), prefix: prefix || null, prompt_config_id: promptId || null, dry_run: !!dry, run_id: runId }) });
      setOut(r);
      setToast({ open:true, type:'success', message: dry ? 'Preview completed' : 'Uploaded images' });
      if (runId) { try { await api(`/api/category_data_update/runs/${encodeURIComponent(runId)}/finish`, { method:'POST', body: JSON.stringify({ status: 'done' }) }); } catch {} }
    } catch (e) { setOut({ ok:false, error:String(e?.message||e) }); setToast({ open:true, type:'error', message:String(e?.message||e)}); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel">
      {toast.open && (
        <Toast open={toast.open} type={toast.type} message={toast.message} onClose={()=>setToast({ open:false, type:'info', message:'' })} />
      )}
      <div className="panel__header">Category – Image Maker</div>
      <div className="panel__body space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm mb-1">Saved profiles</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[280px]" value={selId} onChange={e=>setSelId(e.target.value)}>
              <option value="">(none)</option>
              {items.map(p => (<option key={p.id} value={p.id}>{`${p.name} (#${p.id})`}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm border rounded" onClick={remove} disabled={!selId}>Delete</button>
          </div>
          <div>
            <label className="block text-sm mb-1">Name</label>
            <input className="border rounded px-2 py-1 text-sm min-w-[200px]" value={name} onChange={e=>setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">FTP profile</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={ftpProfileId} onChange={e=>setFtpProfileId(e.target.value)}>
              <option value="">(select)</option>
              {ftpProfiles.map(p => (<option key={p.id} value={p.id}>{`#${p.id} ${p.name} [${p.protocol||'ftp'}://${p.host}:${p.port}]`}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Base path (remote)</label>
            <input className="border rounded px-2 py-1 text-sm min-w-[260px]" placeholder="/var/www/html/.../img/c" value={basePath} onChange={e=>setBasePath(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">MySQL profile</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={dbProfileId} onChange={e=>setDbProfileId(e.target.value)}>
              <option value="">(select)</option>
              {dbProfiles.map(p => (<option key={p.id} value={p.id}>{`#${p.id} ${p.name} (${p.host}:${p.port}/${p.database})`}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Shop</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[160px]" value={idShop} onChange={e=>setIdShop(e.target.value)}>
              <option value="">(select)</option>
              {shops.map(s => (<option key={s.id_shop} value={s.id_shop}>{`#${s.id_shop} ${s.name||''}`}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Language</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[140px]" value={idLang} onChange={e=>setIdLang(e.target.value)}>
              <option value="">(select)</option>
              {visibleLangs.map(l => (<option key={l.id_lang} value={l.id_lang}>{`#${l.id_lang} ${l.iso_code||''}`}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Prompt</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={promptId} onChange={e=>setPromptId(e.target.value)}>
              <option value="">(none)</option>
              {promptConfigs.map(p => { const id = String(p.id||''); const label = p.name ? `${p.name} (${id})` : id; return (<option key={id||label} value={id}>{label}</option>); })}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 text-sm border rounded" onClick={saveNew}>Save New</button>
            <button className="px-3 py-1.5 text-sm border rounded" onClick={update} disabled={!selId}>Update</button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="grow min-w-[320px]">
            <div className="font-medium mb-1">Scope</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <label className="block text-sm mb-1">Category IDs (optional, comma separated)</label>
                <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. 10,20,30" value={categoryIds} onChange={e=>setCategoryIds(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm mb-1">From ID</label>
                <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. 100" value={rangeFrom} onChange={e=>setRangeFrom(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm mb-1">To ID</label>
                <input className="border rounded px-2 py-1 text-sm w-full" placeholder="e.g. 150" value={rangeTo} onChange={e=>setRangeTo(e.target.value)} />
              </div>
              <div className="flex items-end">
                <div className="text-xs text-gray-600">IDs to process are built from range and typed list.</div>
              </div>
            </div>
          </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>run(true)} disabled={busy}>{busy? 'Running…':'Preview'}</button>
          <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>run(false)} disabled={busy}>Apply</button>
        </div>
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
        <div className="border rounded max-h-64 overflow-auto mt-2">
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
                try { const m = { ...e }; delete m.t; delete m.type; delete m.run_id; det = JSON.stringify(m); } catch {}
                return (
                  <tr key={idx} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-1 border-b whitespace-nowrap">{time}</td>
                    <td className="px-2 py-1 border-b">{e.id_category || ''}</td>
                    <td className="px-2 py-1 border-b">{e.type}</td>
                    <td className="px-2 py-1 border-b break-all">{det}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {out && (
          <div className="mt-2 border rounded p-2 bg-white">
            <div className="font-medium text-sm mb-2">Results</div>
            {Array.isArray(out?.items) && out.items.some(it=>it.thumb) && (
              <div className="grid grid-cols-6 gap-2 mb-2">
                {out.items.map((it, idx) => it.thumb ? (
                  <div key={idx} className="border rounded p-1 text-center">
                    <img src={it.thumb} alt={`cat ${it.id_category}`} className="w-full h-[64px] object-contain" />
                    <div className="text-[11px] text-gray-600 mt-1">#{it.id_category}</div>
                  </div>
                ) : null)}
              </div>
            )}
            <div className="text-xs max-h-60 overflow-auto">
              <pre className="whitespace-pre-wrap break-all bg-gray-50 p-2 rounded">{JSON.stringify(out, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
