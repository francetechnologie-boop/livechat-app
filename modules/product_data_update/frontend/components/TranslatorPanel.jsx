import React from 'react';
// Defensive shims for any stray globals from stale chunks
try {
  if (typeof window !== 'undefined') {
    if (typeof window.currentRunId === 'undefined') window.currentRunId = null;
    if (typeof window.genBusy === 'undefined') window.genBusy = false;
    if (typeof window.prog === 'undefined') window.prog = { running:false, current:0, total:0, updated:0, skipped:0, errors:0 };
  }
} catch {}

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

const FIELD_DEFAULTS = { name:true, description:false, description_short:true, meta_title:true, meta_description:true, link_rewrite:false, features:false, attributes:false, attachments:false, images:false };

export default function TranslatorPanel({ profileId, prefix, orgId, onApplyProfile }) {
  const [fields, setFields] = React.useState({ ...FIELD_DEFAULTS });
  const [scope, setScope] = React.useState({ product_ids:'', product_id_from:'', product_id_to:'', where:'', id_shop_from:'', id_shop_to:'' });
  const [shops, setShops] = React.useState([]);
  const [langs, setLangs] = React.useState([]);
  const [langShop, setLangShop] = React.useState([]);
  const [langFromId, setLangFromId] = React.useState('');
  const [langToIds, setLangToIds] = React.useState([]);
  const [promptConfigs, setPromptConfigs] = React.useState([]);
  const [selectedPromptId, setSelectedPromptId] = React.useState('');
  const [chunkSize, setChunkSize] = React.useState(50);
  const [asyncMode, setAsyncMode] = React.useState(false);
  // Always run per-language (split mode)
  const oneLangPerPrompt = true;
  const [asyncJob, setAsyncJob] = React.useState(null);
  const [prog, setProg] = React.useState({ running:false, current:0, total:0, updated:0, skipped:0, errors:0 });
  const [genBusy, setGenBusy] = React.useState(false);
  const [genOut, setGenOut] = React.useState(null);
  const cancelRef = React.useRef(false);
  const [recentRuns, setRecentRuns] = React.useState([]);
  const [runDetail, setRunDetail] = React.useState(null);
  const [currentRunId, setCurrentRunId] = React.useState(null);
  const [liveStep, setLiveStep] = React.useState({ productId: null, langsDone: 0, langsTotal: 0 });
  const [currentLangId, setCurrentLangId] = React.useState(null);
  // Live activity tracking (per product)
  const [startedMap, setStartedMap] = React.useState({});
  const [finishedMap, setFinishedMap] = React.useState({});
  const [recentItems, setRecentItems] = React.useState([]);
  // Live step-by-step activity (SSE)
  const [stepEvents, setStepEvents] = React.useState([]);
  const [copiedKey, setCopiedKey] = React.useState(null);
  const [stepLimit, setStepLimit] = React.useState(20);

  async function copyToClipboard(text, key) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(text||''));
      } else {
        const ta = document.createElement('textarea');
        ta.value = String(text||'');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand('copy'); } catch {}
        document.body.removeChild(ta);
      }
      setCopiedKey(key);
      setTimeout(() => { try { setCopiedKey(null); } catch {} }, 1500);
    } catch {
      // no-op
    }
  }

  async function retryOneEvent(evt) {
    try {
      const pid = Number(evt?.id_product || 0);
      if (!pid || !currentRunId) return;
      const ok = window.confirm(`Retry product #${pid} now?`);
      if (!ok) return;
      const headers = { 'Content-Type': 'application/json' };
      const body = { mode: 'all', product_ids: [pid], chunk_size: 1, one_lang_per_prompt: true };
      const r = await api(`/api/product_data_update/translator-runs/${currentRunId}/retry`, { method:'POST', body: JSON.stringify(body), headers });
      setCurrentRunId(r.run_id || currentRunId);
      setAsyncJob({ id: r.job_id, run_id: r.run_id || currentRunId });
      setNotice({ text: `Retry queued for product #${pid} (job #${r.job_id})`, kind: 'success' });
      setTimeout(()=>{ try { setNotice(null); } catch {} }, 3000);
    } catch (e) { alert(String(e?.message||e)); }
  }

  async function retryOneLangEvent(evt) {
    try {
      const pid = Number(evt?.id_product || 0);
      const idLang = Number(evt?.id_lang || 0);
      if (!pid || !idLang || !currentRunId) return;
      const ok = window.confirm(`Retry product #${pid} lang #${idLang} now?`);
      if (!ok) return;
      const headers = { 'Content-Type': 'application/json' };
      const body = { product_id: pid, id_lang: idLang, chunk_size: 1 };
      const r = await api(`/api/product_data_update/translator-runs/${currentRunId}/retry/lang`, { method:'POST', body: JSON.stringify(body), headers });
      setCurrentRunId(r.run_id || currentRunId);
      setAsyncJob({ id: r.job_id, run_id: r.run_id || currentRunId });
      setNotice({ text: `Retry queued for product #${pid} lang #${idLang} (job #${r.job_id})`, kind: 'success' });
      setTimeout(()=>{ try { setNotice(null); } catch {} }, 3000);
    } catch (e) { alert(String(e?.message||e)); }
  }
  // Avg prompt per language
  const [avgByLang, setAvgByLang] = React.useState([]);
  const pollRef = React.useRef(null);
  const runPollRef = React.useRef(null);
  const [sseEnabled, setSseEnabled] = React.useState(true);
  const sseRef = React.useRef(null);
  const [notice, setNotice] = React.useState(null); // { text, kind }
  // Saved translator profiles
  const [saved, setSaved] = React.useState([]);
  const [selProfileId, setSelProfileId] = React.useState('');
  const [profileName, setProfileName] = React.useState('');
  const autoLoadedRef = React.useRef(false);

  React.useEffect(() => {
    // Mirror into a global for any 3rd-party or stale code paths that still expect a global
    try { if (typeof window !== 'undefined') window.currentRunId = currentRunId || null; } catch {}
  }, [currentRunId]);

  React.useEffect(() => {
    // Keep legacy global in sync to avoid ReferenceError from old code paths
    try { if (typeof window !== 'undefined') window.genBusy = !!genBusy; } catch {}
  }, [genBusy]);

  React.useEffect(() => {
    // Keep progress global mirror updated for any stale references
    try { if (typeof window !== 'undefined') window.prog = { ...prog }; } catch {}
  }, [prog]);

  React.useEffect(() => {
    async function loadOpts() {
      if (!profileId || !prefix) { setShops([]); setLangs([]); setLangShop([]); return; }
      try {
        const q = `?profile_id=${encodeURIComponent(profileId)}&prefix=${encodeURIComponent(prefix)}`;
        const r = await api(`/api/product_data_update/mysql/options${q}`);
        setShops(Array.isArray(r?.shops) ? r.shops : []);
        setLangs(Array.isArray(r?.langs) ? r.langs : []);
        setLangShop(Array.isArray(r?.lang_shop) ? r.lang_shop : []);
        if (!langFromId && r?.langs && r.langs[0]) setLangFromId(String(r.langs[0].id_lang));
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

  // Poll avg-by-language metrics when a run is in progress (inside component)
  React.useEffect(() => {
    const active = !!currentRunId && (genBusy || prog.running);
    if (!active) { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } return; }
    async function poll() {
      try { const r = await api(`/api/product_data_update/translator-runs/${currentRunId}/metrics/avg-by-language`); setAvgByLang(Array.isArray(r?.items) ? r.items : []); } catch {}
    }
    poll();
    pollRef.current = setInterval(poll, 5000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [currentRunId, genBusy, prog.running]);

  // Poll run status when asyncMode is used
  React.useEffect(() => {
    if (!asyncJob || !currentRunId) { if (runPollRef.current) { clearInterval(runPollRef.current); runPollRef.current = null; } return; }
    async function pollRun() {
      try {
        const det = await api(`/api/product_data_update/translator-runs/${currentRunId}?limit=200`);
        setRunDetail(det);
        const st = String(det?.run?.status || '');
        const t = det?.run?.totals || {};
        const req = Number(t.requested||0), dn = Number(t.done||0), up = Number(t.updated||0), sk = Number(t.skipped||0), er = Number(t.errors||0);
        if (req > 0) setProg({ running: st !== 'done' && st !== 'failed', current: dn, total: req, updated: up, skipped: sk, errors: er });
        // update recent items from polling
        const items = Array.isArray(det?.items) ? det.items : [];
        setRecentItems(items);
        if (st === 'done' || st === 'failed') { clearInterval(runPollRef.current); runPollRef.current = null; setAsyncJob(null); }
      } catch {}
    }
    pollRun();
    runPollRef.current = setInterval(pollRun, 5000);
    return () => { if (runPollRef.current) { clearInterval(runPollRef.current); runPollRef.current = null; } };
  }, [asyncJob, currentRunId]);

  // Load saved translator profiles
  async function loadSaved() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/product_data_update/translator-profiles${q}`);
      setSaved(Array.isArray(r?.items) ? r.items : []);
    } catch { setSaved([]); }
  }
  React.useEffect(() => { loadSaved(); /* eslint-disable-next-line */ }, [orgId]);

  // SSE live stream for per-product events
  React.useEffect(() => {
    if (!sseEnabled || !currentRunId) { if (sseRef.current) { try { sseRef.current.close(); } catch {}; sseRef.current = null; } return; }
    try {
      const es = new EventSource(`/api/product_data_update/translator-runs/${currentRunId}/stream`);
      sseRef.current = es;
      const pushEvt = (type, payload) => {
        try {
          setStepEvents(prev => [{ t: Date.now(), type, ...(payload||{}) }, ...prev].slice(0, 200));
        } catch {}
      };
      // Backfill from logs so we see more than a few initial SSE lines
      (async () => {
        try {
          const r = await fetch(`/api/product_data_update/logs/tail?lines=2000`, { credentials: 'include' });
          const j = await r.json().catch(()=>({}));
          const lines = Array.isArray(j?.lines) ? j.lines : [];
          const events = [];
          for (const line of lines) {
            try {
              // Example: [ISO] [product_data_update] event {json}
              const m = String(line||'').match(/^\[(.*?)\] \[product_data_update\] (\w+) (\{.*\})$/);
              if (!m) continue;
              const ts = Date.parse(m[1]);
              const type = m[2];
              const payload = JSON.parse(m[3]);
              if (!payload || (payload.run_id == null)) continue;
              if (String(payload.run_id) !== String(currentRunId)) continue;
              events.push({ t: isFinite(ts) ? ts : Date.now(), type, ...payload });
            } catch {}
          }
          if (events.length) {
            // Sort newest first, de-dup naive by key
            events.sort((a,b)=>b.t-a.t);
            const seen = new Set();
            const uniq = [];
            for (const e of events) {
              const key = [e.type, e.id_product||'', e.id_lang||'', e.ms||'', e.message||''].join('|');
              if (seen.has(key)) continue; seen.add(key); uniq.push(e);
            }
            setStepEvents(prev => [...uniq, ...prev].slice(0, 200));
          }
        } catch {}
      })();
      es.addEventListener('product_start', (ev) => {
        try {
          const d = JSON.parse(ev.data||'{}');
          if (d && d.id_product) {
            setStartedMap(prev => ({ ...prev, [d.id_product]: true }));
            setLiveStep({ productId: d.id_product, langsDone: 0, langsTotal: Array.isArray(langToIds) ? langToIds.length : 0 });
            setCurrentLangId(null);
          }
          pushEvt('product_start', d);
        } catch {}
      });
      es.addEventListener('prompt_request', (ev) => { try { pushEvt('prompt_request', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('prompt_start', (ev) => { try { const d = JSON.parse(ev.data||'{}'); if (d && d.id_lang != null) setCurrentLangId(Number(d.id_lang)); pushEvt('prompt_start', d); } catch {} });
      es.addEventListener('prompt_received', (ev) => { try { pushEvt('prompt_received', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('prompt_output', (ev) => { try { pushEvt('prompt_output', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('prompt_error', (ev) => { try { pushEvt('prompt_error', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('db_update_start', (ev) => { try { pushEvt('db_update_start', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('db_update_done', (ev) => { try {
        const d = JSON.parse(ev.data||'{}');
        setLiveStep(prev => {
          if (!prev || !prev.productId) return prev;
          if (d && Number(d.id_product) === Number(prev.productId)) {
            const next = { ...prev, langsDone: Math.min((prev.langsTotal||0), (Number(prev.langsDone)||0) + 1) };
            return next;
          }
          return prev;
        });
        if (d && d.id_lang != null && Number(d.id_lang) === Number(currentLangId)) setCurrentLangId(null);
        pushEvt('db_update_done', d);
      } catch {} });
      es.addEventListener('db_update_error', (ev) => { try { pushEvt('db_update_error', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('db_related_update', (ev) => { try { pushEvt('db_related_update', JSON.parse(ev.data||'{}')); } catch {} });
      es.addEventListener('product_done', (ev) => {
        try {
          const it = JSON.parse(ev.data||'{}');
          if (it && it.id_product) {
            setFinishedMap(prev => ({ ...prev, [it.id_product]: true }));
            setRecentItems(prev => [it, ...prev].slice(0, 20));
            const langsTotal = Array.isArray(langToIds) ? langToIds.length : 0;
            const firstPart = String(it.message || '').split(';')[0] || '';
            const segments = firstPart.split(',').map(s=>s.trim()).filter(Boolean);
            const langsDone = segments.filter(s => /:/.test(s)).length;
            setLiveStep({ productId: it.id_product, langsDone, langsTotal });
            setCurrentLangId(null);
          }
        } catch {}
        try { const d = JSON.parse(ev.data||'{}'); pushEvt('product_done', d); } catch {}
      });
      es.addEventListener('totals_update', (ev) => {
        try {
          const d = JSON.parse(ev.data||'{}');
          const t = d?.totals || {};
          const req = Number(t.requested||0), dn = Number(t.done||0), up = Number(t.updated||0), sk = Number(t.skipped||0), er = Number(t.errors||0);
          if (req > 0) setProg(prev => ({ running: prev.running, current: dn, total: req, updated: up, skipped: sk, errors: er }));
        } catch {}
      });
      es.onerror = () => {};
    } catch {}
    return () => { if (sseRef.current) { try { sseRef.current.close(); } catch {}; sseRef.current = null; } };
  }, [sseEnabled, currentRunId, langToIds]);

  // Auto-load last translator profile or fallback to latest
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      const raw = localStorage.getItem('pdu:translator:last_profile');
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
  React.useEffect(() => {
    try {
      if (autoLoadedRef.current) return;
      if (!Array.isArray(saved) || !saved.length) return;
      const latest = saved[0]; if (!latest || !latest.id) return;
      setSelProfileId(String(latest.id)); autoLoadedRef.current = true;
      try { localStorage.setItem('pdu:translator:last_profile', JSON.stringify({ id: latest.id, orgId: orgId || null, when: Date.now() })); } catch {}
      setTimeout(()=>{ try { onLoadProfile(); } catch {} },0);
    } catch {}
  }, [saved, orgId]);

  const visibleLangs = React.useMemo(() => {
    try {
      const sid = Number(scope.id_shop_to || 0);
      if (!sid || !Array.isArray(langShop) || !langShop.length) return langs;
      const ok = new Set(langShop.filter(x=>Number(x.id_shop)===sid).map(x=>Number(x.id_lang)));
      return langs.filter(l=>ok.has(Number(l.id_lang)));
    } catch { return langs; }
  }, [langs, langShop, scope.id_shop_to]);

  // Allowed language ids for the selected destination shop
  const allowedToLangIds = React.useMemo(() => {
    try { return new Set(visibleLangs.map(l => Number(l.id_lang))); } catch { return new Set(); }
  }, [visibleLangs]);

  // Prune selection whenever destination shop allowed languages change
  React.useEffect(() => {
    setLangToIds(prev => Array.isArray(prev) ? prev.filter(id => allowedToLangIds.has(Number(id))) : []);
  }, [allowedToLangIds]);

  async function loadRuns() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}&limit=20` : '?limit=20';
      const r = await api(`/api/product_data_update/translator-runs${q}`);
      setRecentRuns(Array.isArray(r?.items) ? r.items : []);
    } catch { setRecentRuns([]); }
  }
  React.useEffect(() => { loadRuns(); /* eslint-disable-next-line */ }, [orgId]);

  const [requestedIds, setRequestedIds] = React.useState([]);
  async function runGenerate(dry = true) {
    setGenBusy(true); setGenOut(null); cancelRef.current = false;
    // Reset live activity
    setStartedMap({}); setFinishedMap({}); setRecentItems([]); setLiveStep({ productId:null, langsDone:0, langsTotal:0 });
    try {
      const typedIds = String(scope.product_ids||'').split(',').map(s=>Number(s.trim())).filter(Boolean);
      let rangeIds = [];
      const a = Number(scope.product_id_from || 0);
      const b = Number(scope.product_id_to || 0);
      const rangeMode = !!(a && b && b >= a);
      if (rangeMode) {
        const cap = Math.min(5000, b - a + 1);
        rangeIds = Array.from({ length: cap }, (_, i) => a + i);
      }
      const ids = Array.from(new Set([ ...typedIds, ...rangeIds ])).filter(n=>Number.isFinite(n) && n>0);
      if (!ids.length) throw new Error('Provide at least one product id');
      if (!scope.id_shop_from) throw new Error('Select an origin shop');
      if (!scope.id_shop_to) throw new Error('Select a destination shop');
      if (!langFromId) throw new Error('Select a source language');
      if (!Array.isArray(langToIds) || !langToIds.length) throw new Error('Select at least one target language');
      setRequestedIds(ids);
      // When using a From/To ID range, process strictly one product per request
      const size = (rangeMode ? 1 : Math.max(1, Number(chunkSize)||50));
      const chunks = rangeMode ? ids.map(id => [id]) : (()=>{ const out=[]; for (let i=0;i<ids.length;i+=size) out.push(ids.slice(i,i+size)); return out; })();
      setProg({ running:true, current:0, total: ids.length * langToIds.length, updated:0, skipped:0, errors:0 });
      const headers = { 'Content-Type': 'application/json' }; if (orgId) headers['X-Org-Id'] = orgId;
      let done=0, updated=0, skipped=0, errors=0; const aggItems = [];
      // Create a single run for all target languages (store langs in params)
      let runId = null;
      try {
        const start = await api('/api/product_data_update/translator-runs', { method:'POST', body: JSON.stringify({ org_id: orgId || null, profile_id: profileId, prefix, id_shop: Number(scope.id_shop_to), id_lang: (langToIds.length === 1 ? Number(langToIds[0]) : null), prompt_config_id: selectedPromptId || null, totals: { requested: ids.length * langToIds.length, done: 0, updated: 0, skipped: 0, errors: 0 }, params: { kind: 'translator', scope: { list: String(scope.product_ids||''), range: { from: scope.product_id_from || null, to: scope.product_id_to || null }, where: scope.where || null, id_shop_from: Number(scope.id_shop_from), id_shop: Number(scope.id_shop_to), lang_from_id: Number(langFromId), lang_to_ids: langToIds.map(x=>Number(x)) } } }) });
        runId = start?.id || null;
        setCurrentRunId(runId || null);
      } catch {}
      for (let ci=0; ci<chunks.length; ci++) {
        if (cancelRef.current) break;
        // Mark products in this chunk as started (live activity) before issuing the request
        try { setStartedMap(prev => { const next = { ...prev }; for (const id of chunks[ci]) next[id] = true; return next; }); } catch {}
        const body = { profile_id: profileId, prefix, id_shop_from: Number(scope.id_shop_from), id_shop: Number(scope.id_shop_to), lang_from_id: Number(langFromId), lang_to_ids: langToIds.map(x=>Number(x)), product_ids: chunks[ci], fields: Object.entries(fields).filter(([k,v])=>['name','description_short','description','meta_title','meta_description','link_rewrite'].includes(k) && !!v).map(([k])=>k), include_features: !!fields.features, include_attributes: !!fields.attributes, include_attachments: !!fields.attachments, include_images: !!fields.images, prompt_config_id: selectedPromptId || null, one_lang_per_prompt: !!oneLangPerPrompt, dry_run: !!dry, run_id: runId };
        const res = await fetch('/api/product_data_update/products/translate-run', { method:'POST', credentials:'include', headers, body: JSON.stringify(body) });
        const text = await res.text(); let json=null; try { json = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok || (json && json.ok === false)) {
          const message = (json && (json.message || json.error)) || text || res.statusText || 'request_failed';
          const errItems = chunks[ci].map(id => ({ id_product: id, error: true, status: 'error', message: String(message) }));
          aggItems.push(...errItems);
          try { setFinishedMap(prev => { const next = { ...prev }; for (const id of chunks[ci]) next[id] = true; return next; }); setRecentItems(prev => { const merged = [...errItems, ...prev]; return merged.slice(0, 20); }); } catch {}
          done += chunks[ci].length * (Array.isArray(langToIds)? langToIds.length : 1);
          errors += chunks[ci].length * (Array.isArray(langToIds)? langToIds.length : 1);
        } else {
          const items = Array.isArray(json?.items) ? json.items : [];
          const stats = (json && json.stats) || {};
          aggItems.push(...items);
          // Update live "finished" map and recent list
          try {
            setFinishedMap(prev => { const next = { ...prev }; for (const it of items) { if (it && it.id_product) next[it.id_product] = true; } return next; });
            setRecentItems(prev => { const merged = [...items, ...prev]; return merged.slice(0, 20); });
          } catch {}
          // Update live step from the last item of this chunk
          try {
            const last = items[items.length - 1];
            if (last && last.id_product) {
              const langsTotal = Array.isArray(langToIds) ? langToIds.length : 0;
              const firstPart = String(last.message || '').split(';')[0] || '';
              const segments = firstPart.split(',').map(s=>s.trim()).filter(Boolean);
              const langsDone = segments.filter(s => /:/.test(s)).length;
              setLiveStep({ productId: last.id_product, langsDone, langsTotal });
            }
          } catch {}
          if (Number.isFinite(stats.done)) done += Number(stats.done); else done += items.length * langToIds.length;
          if (Number.isFinite(stats.updated)) updated += Number(stats.updated); else updated += items.filter(it=>it.updated).length;
          if (Number.isFinite(stats.skipped)) skipped += Number(stats.skipped); else skipped += items.filter(it=>it.skipped).length;
          if (Number.isFinite(stats.errors)) errors += Number(stats.errors); else errors += items.filter(it=>it.error).length;
        }
        setProg({ running:true, current: done, total: ids.length * langToIds.length, updated, skipped, errors });
      }
      if (runId) { try { await api(`/api/product_data_update/translator-runs/${runId}/finish`, { method:'POST', body: JSON.stringify({ status: cancelRef.current ? 'failed' : 'done' }) }); } catch {} }
      setGenOut({ ok:true, items: aggItems, stats: { done, updated, skipped, errors } });
      loadRuns();
    } catch (e) { setGenOut({ ok:false, error:String(e?.message||e) }); }
    finally { setGenBusy(false); }
  }

  async function cancelRun() {
    try {
      // If an async job is running, cancel it server-side
      if (asyncJob && asyncJob.id) {
        try { await api(`/api/product_data_update/jobs/${asyncJob.id}/cancel`, { method: 'POST' }); } catch {}
        // Stop SSE and polling
        try { if (sseRef.current) { sseRef.current.close(); sseRef.current = null; } } catch {}
        if (runPollRef.current) { clearInterval(runPollRef.current); runPollRef.current = null; }
        setAsyncJob(null);
        setProg(prev => ({ ...prev, running: false }));
        setNotice({ kind: 'success', text: 'Run cancelled' });
        setTimeout(()=>{ try { setNotice(null); } catch {} }, 2000);
        return;
      }
      // Fallback: stop the sync loop on next chunk
      cancelRef.current = true;
    } catch {}
  }

  async function startAsyncRun() {
    try {
      // Build product ids from scope same as generate
      const typedIds = String(scope.product_ids||'').split(',').map(s=>Number(s.trim())).filter(Boolean);
      let rangeIds = [];
      const a = Number(scope.product_id_from || 0);
      const b = Number(scope.product_id_to || 0);
      const rangeMode = !!(a && b && b >= a);
      if (rangeMode) {
        const cap = Math.min(5000, b - a + 1);
        rangeIds = Array.from({ length: cap }, (_, i) => a + i);
      }
      const ids = Array.from(new Set([ ...typedIds, ...rangeIds ])).filter(n=>Number.isFinite(n) && n>0);
      if (!ids.length) throw new Error('Provide at least one product id');
      if (!scope.id_shop_from) throw new Error('Select an origin shop');
      if (!scope.id_shop_to) throw new Error('Select a destination shop');
      if (!langFromId) throw new Error('Select a source language');
      if (!Array.isArray(langToIds) || !langToIds.length) throw new Error('Select at least one target language');
      setRequestedIds(ids);
      const headers = { 'Content-Type': 'application/json' }; if (orgId) headers['X-Org-Id'] = orgId;
      const body = { profile_id: profileId, prefix, id_shop_from: Number(scope.id_shop_from), id_shop: Number(scope.id_shop_to), lang_from_id: Number(langFromId), lang_to_ids: langToIds.map(x=>Number(x)), product_ids: ids, fields: Object.entries(fields).filter(([k,v])=>['name','description_short','description','meta_title','meta_description','link_rewrite'].includes(k) && !!v).map(([k])=>k), include_features: !!fields.features, include_attributes: !!fields.attributes, include_attachments: !!fields.attachments, include_images: !!fields.images, prompt_config_id: selectedPromptId || null, one_lang_per_prompt: !!oneLangPerPrompt, chunk_size: (rangeMode ? 1 : Math.max(1, Number(chunkSize)||10)) };
      const res = await fetch('/api/product_data_update/products/translate-run/async', { method:'POST', credentials:'include', headers, body: JSON.stringify(body) });
      const json = await res.json().catch(()=>({}));
      if (!res.ok || json.ok === false) throw new Error(json?.message || json?.error || res.statusText);
      setCurrentRunId(json.run_id || null);
      setAsyncJob({ id: json.job_id, run_id: json.run_id });
    } catch (e) { alert(String(e?.message||e)); }
  }

  // Resume logic: continue a previous run using remaining scope (after last processed)
  async function resumeRun(run) {
    try {
      if (!run || !run.id) return;
      // Flip status back to running for display
      try { await api(`/api/product_data_update/translator-runs/${run.id}/status`, { method:'POST', body: JSON.stringify({ status: 'running' }) }); } catch {}
      // Load complete detail (up to 5000 items)
      const det = await api(`/api/product_data_update/translator-runs/${run.id}?limit=5000`);
      const r = det?.run || {};
      const items = Array.isArray(det?.items) ? det.items : [];
      const sc = (r.params && r.params.scope) ? r.params.scope : {};
      // Re-apply profile/prefix and prompt
      try { onApplyProfile && onApplyProfile(r.profile_id || null, r.prefix || ''); } catch {}
      if (r.prompt_config_id) setSelectedPromptId(String(r.prompt_config_id));
      // Update UI scope/langs to match the run we are resuming
      setScope(prev => ({
        ...prev,
        id_shop_from: sc.id_shop_from != null ? String(sc.id_shop_from) : prev.id_shop_from,
        id_shop_to: sc.id_shop != null ? String(sc.id_shop) : prev.id_shop_to,
        product_ids: sc.list != null ? String(sc.list) : prev.product_ids,
        product_id_from: sc.range?.from != null ? String(sc.range.from) : prev.product_id_from,
        product_id_to: sc.range?.to != null ? String(sc.range.to) : prev.product_id_to,
        where: sc.where != null ? String(sc.where) : prev.where,
      }));
      if (sc.lang_from_id != null) setLangFromId(String(sc.lang_from_id));
      const toIds = Array.isArray(sc.lang_to_ids) ? sc.lang_to_ids : (sc.lang_to_id != null ? [sc.lang_to_id] : []);
      setLangToIds(toIds.map(x=>String(x)));

      // Compute remaining product ids
      const processed = new Set(items.map(it => Number(it.id_product || 0)).filter(Boolean));
      let remaining = [];
      if (sc.list != null && String(sc.list).trim()) {
        const list = String(sc.list).split(',').map(s=>Number(s.trim())).filter(Boolean);
        remaining = list.filter(id => !processed.has(id));
      } else if (sc.range && (sc.range.to != null)) {
        const last = (r.params && r.params.progress && r.params.progress.last_product_id) ? Number(r.params.progress.last_product_id) : (processed.size ? Math.max(...Array.from(processed)) : 0);
        const from = Math.max(Number(sc.range.from || 0), last + 1);
        const to = Number(sc.range.to);
        for (let i = from; i <= to; i++) remaining.push(i);
      }
      if (!remaining.length) { alert('Nothing to resume. All products in scope appear processed.'); return; }
      await runGenerateFromIds(remaining, run.id);
    } catch (e) { alert(String(e?.message||e)); }
  }

  // Retry a previous run's failed items as a new async job
  async function retryRun(run, mode = 'failed') {
    try {
      if (!run || !run.id) return;
      const conf = window.confirm(`Retry ${mode === 'all' ? 'all items' : 'failed items'} for run #${run.id}?`);
      if (!conf) return;
      const headers = { 'Content-Type': 'application/json' };
      const body = { mode, chunk_size: Math.max(1, Number(chunkSize)||10), one_lang_per_prompt: !!oneLangPerPrompt };
      const r = await api(`/api/product_data_update/translator-runs/${run.id}/retry`, { method:'POST', body: JSON.stringify(body), headers });
      // r: { ok, job_id, run_id, products }
      setCurrentRunId(r.run_id || run.id);
      setAsyncJob({ id: r.job_id, run_id: r.run_id || run.id });
      // refresh visible runs
      loadRuns();
      setNotice({ text: `Retry queued: job #${r.job_id} for ${r.products||0} product(s)`, kind: 'success' });
      setTimeout(()=>{ try { setNotice(null); } catch {} }, 3000);
    } catch (e) { alert(String(e?.message||e)); }
  }

  // Run generator using explicit product ids and existing run id (resume)
  async function runGenerateFromIds(ids, runId) {
    setGenBusy(true); setGenOut(null); cancelRef.current = false; setCurrentRunId(runId || null); setRequestedIds(ids);
    // Reset live activity on resume
    setStartedMap({}); setFinishedMap({}); setRecentItems([]); setLiveStep({ productId:null, langsDone:0, langsTotal:0 });
    try {
      const size = Math.max(1, Number(chunkSize)||50);
      const chunks = []; for (let i=0; i<ids.length; i+=size) chunks.push(ids.slice(i, i+size));
      setProg({ running:true, current:0, total: ids.length * langToIds.length, updated:0, skipped:0, errors:0 });
      const headers = { 'Content-Type': 'application/json' }; if (orgId) headers['X-Org-Id'] = orgId;
      let done=0, updated=0, skipped=0, errors=0; const aggItems = [];
      for (let ci=0; ci<chunks.length; ci++) {
        if (cancelRef.current) break;
        // Mark products in this chunk as started
        try { setStartedMap(prev => { const next = { ...prev }; for (const id of chunks[ci]) next[id] = true; return next; }); } catch {}
        const body = { profile_id: profileId, prefix, id_shop_from: Number(scope.id_shop_from), id_shop: Number(scope.id_shop_to), lang_from_id: Number(langFromId), lang_to_ids: langToIds.map(x=>Number(x)), product_ids: chunks[ci], fields: Object.entries(fields).filter(([k,v])=>['name','description_short','description','meta_title','meta_description','link_rewrite'].includes(k) && !!v).map(([k])=>k), include_features: !!fields.features, include_attributes: !!fields.attributes, include_attachments: !!fields.attachments, include_images: !!fields.images, prompt_config_id: selectedPromptId || null, dry_run: false, run_id: runId };
        const res = await fetch('/api/product_data_update/products/translate-run', { method:'POST', credentials:'include', headers, body: JSON.stringify(body) });
        const text = await res.text(); let json=null; try { json = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok || (json && json.ok === false)) {
          const message = (json && (json.message || json.error)) || text || res.statusText || 'request_failed';
          const errItems = chunks[ci].map(id => ({ id_product: id, error: true, status: 'error', message: String(message) }));
          aggItems.push(...errItems);
          try { setFinishedMap(prev => { const next = { ...prev }; for (const id of chunks[ci]) next[id] = true; return next; }); setRecentItems(prev => { const merged = [...errItems, ...prev]; return merged.slice(0, 20); }); } catch {}
          done += chunks[ci].length * (Array.isArray(langToIds)? langToIds.length : 1);
          errors += chunks[ci].length * (Array.isArray(langToIds)? langToIds.length : 1);
        } else {
          const items = Array.isArray(json?.items) ? json.items : [];
          const stats = (json && json.stats) || {};
          aggItems.push(...items);
          // Update finished & recent
          try {
            setFinishedMap(prev => { const next = { ...prev }; for (const it of items) { if (it && it.id_product) next[it.id_product] = true; } return next; });
            setRecentItems(prev => { const merged = [...items, ...prev]; return merged.slice(0, 20); });
          } catch {}
          try {
            const last = items[items.length - 1];
            if (last && last.id_product) {
              const langsTotal = Array.isArray(langToIds) ? langToIds.length : 0;
              const firstPart = String(last.message || '').split(';')[0] || '';
              const segments = firstPart.split(',').map(s=>s.trim()).filter(Boolean);
              const langsDone = segments.filter(s => /:/.test(s)).length;
              setLiveStep({ productId: last.id_product, langsDone, langsTotal });
            }
          } catch {}
          if (Number.isFinite(stats.done)) done += Number(stats.done); else done += items.length * langToIds.length;
          if (Number.isFinite(stats.updated)) updated += Number(stats.updated); else updated += items.filter(it=>it.updated).length;
          if (Number.isFinite(stats.skipped)) skipped += Number(stats.skipped); else skipped += items.filter(it=>it.skipped).length;
          if (Number.isFinite(stats.errors)) errors += Number(stats.errors); else errors += items.filter(it=>it.error).length;
        }
        setProg({ running:true, current: done, total: ids.length * langToIds.length, updated, skipped, errors });
      }
      if (runId) { try { await api(`/api/product_data_update/translator-runs/${runId}/finish`, { method:'POST', body: JSON.stringify({ status: cancelRef.current ? 'failed' : 'done' }) }); } catch {} }
      setGenOut({ ok:true, items: aggItems, stats: { done, updated, skipped, errors } });
      loadRuns();
    } catch (e) { setGenOut({ ok:false, error:String(e?.message||e) }); }
    finally { setGenBusy(false); }
  }

  async function onLoadProfile() {
    try {
      const id = Number(selProfileId||0); if (!id) return;
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/product_data_update/translator-profiles/${id}${q}`);
      const it = r?.item; if (!it) return;
      setProfileName(it.name || '');
      if (it.fields && typeof it.fields === 'object') setFields({ ...FIELD_DEFAULTS, ...it.fields });
      if (it.id_shop != null) setScope(prev=>({ ...prev, id_shop_to: String(it.id_shop||'') }));
      if (it.id_shop_from != null) setScope(prev=>({ ...prev, id_shop_from: String(it.id_shop_from||'') }));
      // Load persisted scope into UI
      setScope(prev => ({
        ...prev,
        product_ids: (it.scope_list != null) ? String(it.scope_list) : prev.product_ids,
        product_id_from: (it.scope_from != null) ? String(it.scope_from) : prev.product_id_from,
        product_id_to: (it.scope_to != null) ? String(it.scope_to) : prev.product_id_to,
        where: (it.scope_where != null) ? String(it.scope_where) : prev.where,
      }));
      if (it.lang_from_id != null) setLangFromId(String(it.lang_from_id));
      if (Array.isArray(it.lang_to_ids) && it.lang_to_ids.length) {
        setLangToIds(it.lang_to_ids.map(x=>String(x)));
      } else if (it.lang_to_id != null) {
        setLangToIds([String(it.lang_to_id)]);
      }
      if (it.prompt_config_id) setSelectedPromptId(String(it.prompt_config_id));
      try { if (onApplyProfile && (it.profile_id || it.prefix)) onApplyProfile(it.profile_id || null, it.prefix || ''); } catch {}
      try { localStorage.setItem('pdu:translator:last_profile', JSON.stringify({ id, orgId: orgId || null, when: Date.now() })); } catch {}
    } catch (e) { alert(String(e?.message||e)); }
  }

  async function onDeleteProfile() {
    try {
      const id = Number(selProfileId||0); if (!id) return;
      if (!window.confirm('Delete this profile?')) return;
      await api(`/api/product_data_update/translator-profiles/${id}`, { method:'DELETE' });
      setSelProfileId(''); setProfileName(''); await loadSaved();
    } catch (e) { alert(String(e?.message||e)); }
  }

  async function onSaveNew() {
    try {
      const name = profileName.trim(); if (!name) throw new Error('Enter a profile name');
      const langToIdsFiltered = (langToIds||[]).map(x=>Number(x)).filter(id => allowedToLangIds.has(id));
      const body = { org_id: orgId || null, name, profile_id: profileId || null, prefix, id_shop: scope.id_shop_to ? Number(scope.id_shop_to) : null, id_shop_from: scope.id_shop_from ? Number(scope.id_shop_from) : null, lang_from_id: langFromId ? Number(langFromId) : null, lang_to_ids: langToIdsFiltered, scope_list: String(scope.product_ids||''), scope_from: scope.product_id_from ? Number(scope.product_id_from) : null, scope_to: scope.product_id_to ? Number(scope.product_id_to) : null, scope_where: String(scope.where||''), fields, prompt_config_id: selectedPromptId || null, limits: null, overwrite: false };
      const r = await api('/api/product_data_update/translator-profiles', { method:'POST', body: JSON.stringify(body) });
      await loadSaved(); setSelProfileId(String(r?.id||''));
    } catch (e) { alert(String(e?.message||e)); }
  }

  async function onUpdateProfile() {
    try {
      const id = Number(selProfileId||0); if (!id) throw new Error('Select a saved profile');
      const langToIdsFiltered2 = (langToIds||[]).map(x=>Number(x)).filter(id => allowedToLangIds.has(id));
      const body = { org_id: orgId || null, name: profileName || undefined, profile_id: profileId || null, prefix, id_shop: scope.id_shop_to ? Number(scope.id_shop_to) : null, id_shop_from: scope.id_shop_from ? Number(scope.id_shop_from) : null, lang_from_id: langFromId ? Number(langFromId) : null, lang_to_ids: langToIdsFiltered2, scope_list: String(scope.product_ids||''), scope_from: scope.product_id_from ? Number(scope.product_id_from) : null, scope_to: scope.product_id_to ? Number(scope.product_id_to) : null, scope_where: String(scope.where||''), fields, prompt_config_id: selectedPromptId || null, limits: null, overwrite: false };
      await api(`/api/product_data_update/translator-profiles/${id}`, { method:'PUT', body: JSON.stringify(body) });
      await loadSaved();
    } catch (e) { alert(String(e?.message||e)); }
  }

  return (
    <div className="panel">
      <div className="panel__header">Product(s) – Translator</div>
      <div className="panel__body space-y-3">
        <div className="text-xs text-gray-600">Translate product text fields between languages. Writes to product_lang.</div>
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
            {Object.keys(fields).map(k => (
              <label key={k} className="block text-sm"><input className="mr-2" type="checkbox" checked={!!fields[k]} onChange={e=>setFields(prev=>({ ...prev, [k]: e.target.checked }))} />{k}</label>
            ))}
          </div>
          <div className="grow min-w-[280px]">
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
                <label className="block text-sm mb-1">From language (ps_lang)</label>
                <select className="border rounded px-2 py-1 text-sm w-full" value={langFromId} onChange={e=>setLangFromId(e.target.value)}>
                  {langs.map(l => (<option key={l.id_lang} value={l.id_lang}>{`#${l.id_lang} ${l.iso_code||''}`}</option>))}
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
            <label className="block text-sm mt-2 mb-1">Product IDs (comma separated)</label>
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
          </div>
        </div>

        <div className="p-3 border rounded bg-white">
          <div className="font-medium mb-2">Run — Translate</div>
          <div className="mb-2">
            <label className="block text-sm mb-1">Prompt (optional)</label>
            <select className="border rounded px-2 py-1 text-sm min-w-[260px]" value={selectedPromptId} onChange={e=>setSelectedPromptId(e.target.value)}>
              <option value="">(none)</option>
              {promptConfigs.map(p => { const id = String(p.id||''); const label = p.name ? `${p.name} (${id})` : id; return (<option key={id||label} value={id}>{label}</option>); })}
            </select>
            <label className="ml-4 inline-flex items-center text-sm"><input type="checkbox" className="mr-2" checked={asyncMode} onChange={e=>setAsyncMode(e.target.checked)} />Async mode</label>
            {/* One language per prompt is always enabled (split mode); toggle removed */}
            <label className="ml-4 inline-flex items-center text-sm"><input type="checkbox" className="mr-2" checked={sseEnabled} onChange={e=>setSseEnabled(e.target.checked)} />Live stream</label>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>runGenerate(true)} disabled={genBusy || !profileId || !prefix}>{genBusy? 'Running…':'Preview'}</button>
            <button className="px-3 py-1.5 text-sm border rounded" onClick={()=>{ if (asyncMode) startAsyncRun(); else runGenerate(false); }} disabled={genBusy || !profileId || !prefix}>{asyncMode ? 'Apply (Async)' : 'Apply'}</button>
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
                <button className="text-[11px] underline" onClick={cancelRun}>Cancel</button>
              </div>
            )}
            {asyncJob && (
              <div className="text-[11px] text-gray-700 ml-2">Async job #{asyncJob.id} for run #{asyncJob.run_id} started…</div>
            )}
            {prog.running && (
              <div className="text-[11px] text-gray-700 ml-2">
                {(() => {
                  const perLang = Math.max(1, (langToIds||[]).length);
                  const prodDone = Math.floor((prog.current||0) / perLang);
                  const prodTotal = Array.isArray(requestedIds) ? requestedIds.length : 0;
                  const a = liveStep.productId ? `Product #${liveStep.productId} langs ${liveStep.langsDone}/${liveStep.langsTotal}` : '';
                  const c = currentLangId != null ? `Lang running: #${currentLangId}` : '';
                  const b = `Products ${prodDone}/${prodTotal}`;
                  return [a,c,b].filter(Boolean).join(' · ');
                })()}
              </div>
            )}
          </div>
          {genOut && (
            <pre className="text-xs bg-gray-50 p-2 border rounded overflow-auto max-h-64 mt-2">{JSON.stringify(genOut, null, 2)}</pre>
          )}
        </div>

        {/* Live Activity section removed per request */}

        {/* Live step-by-step events */}
        <div className="mt-3 p-3 border rounded bg-white">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Live Steps</div>
            <div className="text-[11px] text-gray-600 flex items-center gap-2">
              <span>Last {stepLimit}</span>
              <select className="border rounded px-1 py-0.5 text-[11px]" value={stepLimit} onChange={e=>setStepLimit(Number(e.target.value)||20)}>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>
          <div className="border rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-0.5 border-b">Time</th>
                  <th className="text-left px-2 py-0.5 border-b">Product</th>
                  <th className="text-left px-2 py-0.5 border-b">Step</th>
                  <th className="text-left px-2 py-0.5 border-b">Lang</th>
                  <th className="text-left px-2 py-0.5 border-b">Details</th>
                </tr>
              </thead>
              <tbody>
                {stepEvents.slice(0, stepLimit).map((e, idx) => {
                  const t = new Date(e.t||Date.now());
                  const hh = String(t.getHours()).padStart(2,'0');
                  const mm = String(t.getMinutes()).padStart(2,'0');
                  const ss = String(t.getSeconds()).padStart(2,'0');
                  const time = `${hh}:${mm}:${ss}`;
                  const isErr = /error/i.test(String(e.type||'')) || /fail/i.test(String(e.message||''));
                  const lang = e.id_lang != null ? String(e.id_lang) : '';
                  let det = '';
                  if (e.ms != null) det = `ms=${e.ms}`;
                  if (e.updated != null) det = `${det}${det?'; ':''}updated=${e.updated ? '1':'0'}`;
                  if (e.message) det = `${det}${det?'; ':''}${String(e.message)}`;
                  if (e.prompt_id) det = `${det}${det?'; ':''}prompt_id=${String(e.prompt_id)}`;
                  if (e.input) {
                    const txt = String(e.input);
                    const short = txt.length > 160 ? (txt.slice(0,160) + '…') : txt;
                    det = `${det}${det?'; ':''}input=${short}`;
                  } else if (e.input_len != null) {
                    det = `${det}${det?'; ':''}input_len=${String(e.input_len)}`;
                  }
                  if (e.type === 'prompt_output' && e.out) {
                    try {
                      const txt = JSON.stringify(e.out);
                      const short = txt.length > 160 ? (txt.slice(0,160) + '…') : txt;
                      det = `${det}${det?'; ':''}output=${short}`;
                    } catch {}
                  }
                  if (e.type === 'db_update_done' && Array.isArray(e.fields) && e.fields.length) {
                    try {
                      det = `${det}${det?'; ':''}fields=${e.fields.join(',')}`;
                    } catch {}
                  }
                  const rowKey = `${idx}:${e.t||''}`;
                  return (
                    <tr key={idx} className={isErr ? 'bg-red-50' : (e.type==='db_update_done' ? 'bg-green-50' : (e.type==='prompt_received' ? 'bg-blue-50' : ''))}>
                      <td className="px-2 py-0.5 border-b whitespace-nowrap">{time}</td>
                      <td className="px-2 py-0.5 border-b">{e.id_product || ''}</td>
                      <td className="px-2 py-0.5 border-b whitespace-nowrap">{e.type}</td>
                      <td className="px-2 py-0.5 border-b">{lang}</td>
                      <td className="px-2 py-0.5 border-b break-all">
                        {det || ''}
                        {(e.type === 'prompt_output' && e.out) && (
                          <pre className="mt-1 p-1 bg-gray-50 border rounded text-[11px] max-h-80 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(e.out, null, 2)}</pre>
                        )}
                        {(e.type === 'prompt_request' && e.input) && (
                          <button
                            className="ml-2 px-2 py-0.5 text-[11px] border rounded"
                            title="Copy full prompt input"
                            onClick={() => copyToClipboard(e.input, rowKey)}
                          >{copiedKey === rowKey ? 'Copied' : 'Copy input'}</button>
                        )}
                        {(e.type === 'prompt_output' && e.out) && (
                          <button
                            className="ml-2 px-2 py-0.5 text-[11px] border rounded"
                            title="Copy full prompt output"
                            onClick={() => copyToClipboard(JSON.stringify(e.out, null, 2), rowKey)}
                          >{copiedKey === rowKey ? 'Copied' : 'Copy output'}</button>
                        )}
                        {(/error/i.test(String(e.type||'')) && e.id_product) && (
                          <button
                            className="ml-2 px-2 py-0.5 text-[11px] border rounded text-red-800"
                            title="Retry this product now"
                            onClick={() => retryOneEvent(e)}
                          >Retry</button>
                        )}
                        {(/error/i.test(String(e.type||'')) && e.id_product && e.id_lang != null) && (
                          <button
                            className="ml-2 px-2 py-0.5 text-[11px] border rounded text-red-800"
                            title="Retry this product + language now"
                            onClick={() => retryOneLangEvent(e)}
                          >Retry lang</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Avg Prompt per Language section removed per request */}

        <div className="mt-4 p-3 border rounded bg-white">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium">Recent Runs</div>
            <button className="px-2 py-1 text-xs border rounded" onClick={loadRuns}>Refresh</button>
          </div>
          {notice && (
            <div className={`mb-2 text-[12px] px-2 py-1 rounded border ${notice.kind==='success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-yellow-50 border-yellow-200 text-yellow-800'}`}>
              {notice.text}
            </div>
          )}
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
                {recentRuns.map(r => { const t=r.totals||{}; const req=+t.requested||0, dn=+t.done||0, up=+t.updated||0, sk=+t.skipped||0, er=+t.errors||0; return (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                    <td className="px-2 py-1 border-b">{r.id}</td>
                    <td className="px-2 py-1 border-b">{r.status}</td>
                    <td className="px-2 py-1 border-b">{r.id_shop}/{r.id_lang}</td>
                    <td className="px-2 py-1 border-b">req:{req} done:{dn} up:{up} sk:{sk} er:{er}</td>
                    <td className="px-2 py-1 border-b">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-2 py-1 border-b">
                      <div className="flex items-center gap-2">
                        <button className="px-2 py-0.5 border rounded" onClick={async()=>{ try { const det = await api(`/api/product_data_update/translator-runs/${r.id}?limit=5000`); setRunDetail(det); } catch(e){ alert(String(e?.message||e)); } }}>View</button>
                        <button className="px-2 py-0.5 border rounded" onClick={()=>resumeRun(r)} disabled={genBusy}>Resume</button>
                        <button className="px-2 py-0.5 border rounded" onClick={()=>retryRun(r,'failed')} title="Retry only failed items">Retry failed</button>
                        <button className="px-2 py-0.5 border rounded" onClick={()=>retryRun(r,'all')} title="Re-run all items">Retry all</button>
                      </div>
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
          {runDetail && (
            <div className="mt-3">
              <div className="font-medium mb-1">Run #{runDetail.run?.id}</div>
              {(() => {
                try {
                  const items = Array.isArray(runDetail.items) ? runDetail.items : [];
                  const counts = {};
                  for (const it of items) {
                    const msg = String(it?.message||'');
                    const parts = msg.split(',');
                    for (let seg of parts) {
                      seg = seg.trim();
                      if (!seg || seg.indexOf(':') === -1) continue;
                      const [isoRaw, statRaw] = seg.split(':');
                      const iso = String(isoRaw||'').trim();
                      const stat = String(statRaw||'').trim();
                      const isFail = (/prompt_failed|target_missing|invalid_output|no_output_for_lang|row_missing_for_shop_lang|error/i).test(stat);
                      if (isFail && iso) counts[iso] = (counts[iso]||0) + 1;
                    }
                  }
                  const entries = Object.entries(counts).filter(([,v]) => v>0).sort((a,b)=>b[1]-a[1]);
                  if (entries.length) {
                    return (
                      <div className="text-[12px] text-gray-700 mb-2">
                        Per-language failures: {entries.map(([iso,v],i)=> (<span key={iso} className="inline-block ml-2 px-2 py-0.5 border rounded bg-red-50 text-red-800">{iso}: {v}</span>))}
                      </div>
                    );
                  }
                } catch {}
                return null;
              })()}
              <div className="mb-2 flex items-center gap-2">
                <button className="px-2 py-1 text-xs border rounded" onClick={()=>resumeRun(runDetail.run)} disabled={genBusy}>Resume from last product</button>
                <button className="px-2 py-1 text-xs border rounded" onClick={()=>retryRun(runDetail.run,'failed')} title="Retry only failed items">Retry failed</button>
                <button className="px-2 py-1 text-xs border rounded" onClick={()=>retryRun(runDetail.run,'all')} title="Re-run all items">Retry all</button>
              </div>
              <div className="overflow-auto border rounded max-h-64">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-2 py-1 border-b">Product</th>
                      <th className="text-left px-2 py-1 border-b">Status</th>
                      <th className="text-left px-2 py-1 border-b">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(runDetail.items||[]).map((it, idx) => (
                      <tr key={idx} className="odd:bg-white even:bg-gray-50">
                        <td className="px-2 py-1 border-b">{it.id_product}</td>
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
  
