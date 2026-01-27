import React, { useEffect, useRef, useState } from 'react';

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

export default function ProductSearchIndexPage() {
  const [profiles, setProfiles] = useState([]);
  const [orgId, setOrgId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ profile_id: '', id_shop: '', id_product_from: '', id_product_to: '', prefix: 'ps_', id_langs: '', clear_before: true, include_name: true, include_reference: true, include_attributes: true });
  const [runId, setRunId] = useState('');
  const [events, setEvents] = useState([]);
  const sseRef = useRef(null);
  const [shops, setShops] = useState([]);
  const [psiProfiles, setPsiProfiles] = useState([]);
  const [psiProfileId, setPsiProfileId] = useState('');
  const [psiProfileName, setPsiProfileName] = useState('');

  async function loadProfiles() {
    setErr('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/db-mysql/profiles${q}`);
      setProfiles(Array.isArray(r?.items) ? r.items : []);
    } catch (e) { setProfiles([]); setErr(String(e.message || e)); }
  }
  useEffect(() => { loadProfiles(); }, [orgId]);
  useEffect(() => { loadPsiProfiles(); }, [orgId]);

  function addEvent(ev) { setEvents(prev => [{ ts: Date.now(), ...ev }, ...prev].slice(0, 400)); }

  async function startRun() {
    setErr(''); setBusy(true); setEvents([]); setRunId('');
    try {
      const body = {
        profile_id: Number(form.profile_id || 0),
        id_shop: Number(form.id_shop || 0),
        id_product_from: Number(form.id_product_from || 0),
        id_product_to: Number(form.id_product_to || 0),
        prefix: String(form.prefix || 'ps_'),
        clear_before: !!form.clear_before,
        include_name: !!form.include_name,
        include_reference: !!form.include_reference,
        include_attributes: !!form.include_attributes,
      };
      const langsStr = String(form.id_langs || '').trim();
      if (langsStr) body.id_langs = langsStr.split(/[\s,;]+/).map(s=>Number(s)).filter(n=>n>0);
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/product-search-index/runs${q}`, { method:'POST', body: JSON.stringify(body) });
      const id = r?.run_id || '';
      setRunId(id);
      if (id) subscribe(id);
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  }

  function subscribe(id) {
    if (sseRef.current) { try { sseRef.current.close(); } catch {} sseRef.current = null; }
    const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
    const es = new EventSource(`/api/product-search-index/runs/${encodeURIComponent(id)}/stream${q}`);
    sseRef.current = es;
    es.addEventListener('message', (e) => {
      try { const data = JSON.parse(e.data || '{}'); if (data) addEvent(data); } catch {}
    });
    es.addEventListener('error', () => { /* silently ignore */ });
  }

  useEffect(() => () => { if (sseRef.current) { try { sseRef.current.close(); } catch {} sseRef.current = null; } }, []);

  // Load shops when profile or prefix changes
  useEffect(() => {
    (async () => {
      try {
        setShops([]);
        if (!form.profile_id) return;
        const q = new URLSearchParams();
        q.set('profile_id', String(form.profile_id));
        if (orgId) q.set('org_id', orgId);
        q.set('prefix', String(form.prefix || 'ps_'));
        const r = await api(`/api/product-search-index/mysql/shops?${q.toString()}`);
        const items = Array.isArray(r?.items) ? r.items : [];
        setShops(items);
        // Preserve selected shop if valid; otherwise choose sensible default
        setForm(m => {
          const current = String(m.id_shop || '');
          const exists = items.some(s => String(s.id_shop) === current);
          if (exists) return m;
          if (items.length === 1) return { ...m, id_shop: String(items[0].id_shop) };
          return { ...m, id_shop: '' };
        });
      } catch (_) {
        setShops([]);
      }
    })();
  }, [form.profile_id, form.prefix, orgId]);

  // Load languages when shop changes
  useEffect(() => {
    (async () => {
      try {
        if (!form.profile_id || !form.id_shop) return;
        const q = new URLSearchParams();
        q.set('profile_id', String(form.profile_id));
        q.set('id_shop', String(form.id_shop));
        if (orgId) q.set('org_id', orgId);
        q.set('prefix', String(form.prefix || 'ps_'));
        const r = await api(`/api/product-search-index/mysql/languages?${q.toString()}`);
        const items = Array.isArray(r?.items) ? r.items : [];
        if (items.length) setForm(m => ({ ...m, id_langs: items.join(',') }));
      } catch (_) {
        // ignore
      }
    })();
  }, [form.profile_id, form.id_shop, form.prefix, orgId]);

  async function loadPsiProfiles() {
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/product-search-index/profiles${q}`);
      setPsiProfiles(Array.isArray(r?.items) ? r.items : []);
    } catch { setPsiProfiles([]); }
  }

  async function onSelectPsiProfile(id) {
    setErr('');
    setPsiProfileId(String(id || ''));
    if (!id) { setPsiProfileName(''); return; }
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/product-search-index/profiles/${id}${q}`);
      const it = r?.item || {};
      setPsiProfileName(String(it.name || ''));
      setForm(m => ({
        ...m,
        profile_id: String(it.db_profile_id || ''),
        prefix: String(it.prefix || 'ps_'),
        id_shop: String(it.id_shop || ''),
        id_langs: (()=>{ try{ const arr = JSON.parse(it.id_langs||'[]'); return Array.isArray(arr)&&arr.length?arr.join(','):''; }catch{return ''} })(),
      }));
    } catch (e) { setErr(String(e.message||e)); }
  }

  async function onSavePsiProfile() {
    setErr('');
    try {
      const body = {
        name: psiProfileName || 'Default',
        db_profile_id: Number(form.profile_id || 0),
        prefix: String(form.prefix || 'ps_'),
        id_shop: Number(form.id_shop || 0),
        id_langs: String(form.id_langs || '').split(/[\s,;]+/).map(s=>Number(s)).filter(n=>n>0),
      };
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      if (psiProfileId) {
        await api(`/api/product-search-index/profiles/${psiProfileId}${q}`, { method:'PUT', body: JSON.stringify(body) });
      } else {
        const r = await api(`/api/product-search-index/profiles${q}`, { method:'POST', body: JSON.stringify(body) });
        setPsiProfileId(String(r?.id || ''));
      }
      await loadPsiProfiles();
    } catch (e) { setErr(String(e.message || e)); }
  }

  async function onDeletePsiProfile() {
    if (!psiProfileId) return;
    if (!window.confirm('Delete this profile?')) return;
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      await api(`/api/product-search-index/profiles/${psiProfileId}${q}`, { method:'DELETE' });
      setPsiProfileId(''); setPsiProfileName('');
      await loadPsiProfiles();
    } catch (e) { setErr(String(e.message||e)); }
  }

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Product Search Index</h2>

      <div style={{ marginBottom: 8, display:'flex', gap: 8 }}>
        <label className="inline-flex items-center gap-1">
          Org ID
          <input value={orgId} onChange={e=>setOrgId(e.target.value)} placeholder="optional" className="border px-2 py-1 rounded" />
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-3" style={{ marginBottom: 12 }}>
        <div>
          <div className="border rounded p-2 mb-3">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>PSI Profile</div>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom: 6 }}>
              <select className="border rounded px-2 py-1" value={psiProfileId} onChange={e=>onSelectPsiProfile(e.target.value)}>
                <option value="">(none)</option>
                {psiProfiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input className="border rounded px-2 py-1" placeholder="Profile name" value={psiProfileName} onChange={e=>setPsiProfileName(e.target.value)} />
              <button className="px-2 py-1 border rounded" onClick={onSavePsiProfile}>Save</button>
              <button className="px-2 py-1 border rounded" disabled={!psiProfileId} onClick={onDeletePsiProfile}>Delete</button>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>MySQL Profile</label>
            <select className="border rounded px-2 py-1 w-full" value={form.profile_id} onChange={e=>setForm(m=>({ ...m, profile_id: e.target.value }))}>
              <option value="">Select…</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.host}:{p.port}/{p.database})</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Shop ID</label>
            <select className="border rounded px-2 py-1 w-full" value={form.id_shop} onChange={e=>setForm(m=>({ ...m, id_shop: e.target.value }))}>
              <option value="">Select…</option>
              {shops.map(s => (
                <option key={s.id_shop} value={s.id_shop}>{s.id_shop}{s.name?` – ${s.name}`:''}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 8, display:'flex', gap:8 }}>
            <div style={{ flex:1 }}>
              <label>Product ID from</label>
              <input type="number" className="border rounded px-2 py-1 w-full" value={form.id_product_from} onChange={e=>setForm(m=>({ ...m, id_product_from: e.target.value }))} />
            </div>
            <div style={{ flex:1 }}>
              <label>to</label>
              <input type="number" className="border rounded px-2 py-1 w-full" value={form.id_product_to} onChange={e=>setForm(m=>({ ...m, id_product_to: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Language IDs (comma-separated)</label>
            <input className="border rounded px-2 py-1 w-full" value={form.id_langs} onChange={e=>setForm(m=>({ ...m, id_langs: e.target.value }))} placeholder="e.g., 1,2" />
          </div>
          <div style={{ marginBottom: 8, display:'flex', gap:8 }}>
            <div style={{ flex:1 }}>
              <label>Table prefix</label>
              <input className="border rounded px-2 py-1 w-full" value={form.prefix} onChange={e=>setForm(m=>({ ...m, prefix: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!form.clear_before} onChange={e=>setForm(m=>({ ...m, clear_before: e.target.checked }))} /> Clear existing index for range</label>
            <div style={{ marginTop: 6 }}>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!form.include_name} onChange={e=>setForm(m=>({ ...m, include_name: e.target.checked }))} /> Include product name</label>
            </div>
            <div style={{ marginTop: 6 }}>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!form.include_reference} onChange={e=>setForm(m=>({ ...m, include_reference: e.target.checked }))} /> Include product references</label>
            </div>
            <div style={{ marginTop: 6 }}>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!form.include_attributes} onChange={e=>setForm(m=>({ ...m, include_attributes: e.target.checked }))} /> Include attribute references</label>
            </div>
          </div>
          <div>
            <button className="px-3 py-1 border rounded" disabled={busy} onClick={startRun}>Start Index</button>
          </div>
          {err ? <div className="text-red-600 text-sm mt-2">{String(err)}</div> : null}
        </div>
        <div>
          <div style={{ marginBottom: 8, display:'flex', alignItems:'center', gap:8 }}>
            <div><b>Run ID:</b> {runId || '—'}</div>
            {runId ? <button className="text-xs px-2 py-0.5 border rounded" onClick={()=>subscribe(runId)}>Reconnect</button> : null}
          </div>
          <div className="border rounded p-2" style={{ minHeight: 240, maxHeight: 360, overflow:'auto', background:'#fafafa' }}>
            <div className="text-xs text-gray-600 mb-1">Live Steps (latest first)</div>
            <ul className="text-xs" style={{ listStyle:'none', padding:0, margin:0 }}>
              {events.map((ev, i) => (
                <li key={i} className="border-b py-1">
                  <code>{JSON.stringify(ev)}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
