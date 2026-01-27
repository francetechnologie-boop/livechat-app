import React, { useEffect, useMemo, useState } from "react";

function Avatar({ name = "" }) {
  const letter = (name || '').trim()[0]?.toUpperCase() || '?';
  const hue = (letter.charCodeAt(0) * 19) % 360;
  const bg = `hsl(${hue} 70% 90%)`;
  const fg = `hsl(${hue} 60% 35%)`;
  return (
    <div className="inline-flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold" style={{ backgroundColor: bg, color: fg }} aria-hidden>
      {letter}
    </div>
  );
}

export default function Contact() {
  const [status, setStatus] = useState({ loading: true, connected: false, lastError: "" });
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [next, setNext] = useState(null);
  const [msg, setMsg] = useState('');
  const [newContact, setNewContact] = useState({ name:'', email:'', phone:'', organization:'', jobTitle:'' });
  const [editModal, setEditModal] = useState(null); // { resourceName, name, email, phone, organization, jobTitle }
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [pageSize, setPageSize] = useState(500);

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/google-api/oauth/debug', { credentials: 'include' });
      const j = await r.json();
      setStatus({ loading: false, connected: !!j?.connected, lastError: j?.last_error || '' });
    } catch {
      setStatus({ loading: false, connected: false, lastError: '' });
    }
  };

  useEffect(() => {
    loadStatus();
    const onMsg = (e) => { try { if (e?.data?.kind === 'oauth_ok') loadStatus(); } catch {} };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const loadContacts = async (opts = {}) => {
    setBusy(true);
    setMsg('');
    try {
      const params = new URLSearchParams();
      params.set('max', String(opts.max || pageSize || 500));
      params.set('fields', 'names,emailAddresses,phoneNumbers,organizations,memberships');
      if (opts.pageToken) params.set('pageToken', opts.pageToken);
      const r = await fetch(`/api/google-api/oauth/people?${params.toString()}`, { credentials: 'include' });
      const j = await r.json().catch(()=>({ ok:false }));
      if (r.ok && j && j.ok) {
        const list = Array.isArray(j.contacts) ? j.contacts : [];
        setItems((prev) => opts.append ? [...prev, ...list] : list);
        setNext(j.nextPageToken || null);
      } else {
        setMsg(j?.message || j?.error || `Failed to load contacts (${r.status})`);
        if (!opts.append) setItems([]);
        setNext(null);
      }
    } catch {
      setMsg('Network or server error while loading contacts');
      if (!opts.append) setItems([]);
      setNext(null);
    } finally { setBusy(false); }
  };

  useEffect(() => { if (status.connected) loadContacts({ max: pageSize }); }, [status.connected, pageSize]);

  const loadAll = async () => {
    setBusy(true); setMsg('');
    try {
      let token = null; let total = 0; let guard = 0;
      setItems([]); setNext(null);
      while (guard < 50) { // up to ~50k if pageSize=1000
        const params = new URLSearchParams();
        params.set('max', String(pageSize || 500));
        params.set('fields', 'names,emailAddresses,phoneNumbers,organizations');
        if (token) params.set('pageToken', token);
        const r = await fetch(`/api/google-api/oauth/people?${params.toString()}`, { credentials: 'include' });
        const j = await r.json().catch(()=>({ ok:false }));
        if (!r.ok || !j?.ok) { setMsg(j?.message||j?.error||`Load failed (${r.status})`); break; }
        const list = Array.isArray(j.contacts) ? j.contacts : [];
        setItems(prev => [...prev, ...list]);
        total += list.length; token = j.nextPageToken || null; guard++;
        if (!token || list.length === 0) break;
      }
      setNext(null);
      if (guard >= 50) setMsg(`Loaded ${total}+ (limit reached)`); else setMsg(`Loaded ${total}`);
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => {
    const t = (q || '').trim().toLowerCase();
    if (!t) return items;
    return items.filter(x =>
      (x.name || '').toLowerCase().includes(t) ||
      (x.email || '').toLowerCase().includes(t) ||
      (x.phone || '').toLowerCase().includes(t) ||
      (x.organization || '').toLowerCase().includes(t) ||
      (x.jobTitle || '').toLowerCase().includes(t)
    );
  }, [q, items]);

  if (status.loading) return <div className="p-4 text-sm text-gray-500">Chargement.</div>;
  if (!status.connected) {
    return (
      <div className="p-4">
        <div className="panel max-w-3xl">
          <div className="panel__header">Contacts (Google)</div>
          <div className="panel__body space-y-3">
            <div className="text-sm text-gray-600">Connectez votre compte Google pour afficher les contacts.</div>
            {status.lastError && <div className="text-xs text-red-600">Dernière erreur: {status.lastError}</div>}
            <div>
              <button
                className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={async () => {
                  try {
                    const r = await fetch('/api/google-api/auth-url', { credentials:'include' });
                    const j = await r.json();
                    const url = j && (j.url || (j.ok && j.url));
                    if (url) {
                      const w = window.open(url, 'google-oauth', 'width=600,height=700');
                      if (w) w.focus();
                    } else {
                      alert('Configuration manquante (OAuth)');
                    }
                  } catch {}
                }}
              >
                Se connecter à Google
              </button>
            </div>
            <div className="text-xs text-gray-500">Ou configurez via Outils → Google API.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="h-full w-full flex min-h-0">
      <aside className="w-72 border-r bg-white p-3 flex flex-col gap-2">
        <div className="text-xs text-gray-600">Contacts</div>
        <input
          className="border rounded px-3 py-2 text-sm"
          placeholder="Rechercher par nom, email, téléphone, société"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mt-2 p-2 border rounded bg-gray-50">
          <div className="text-[11px] text-gray-600 mb-1">Ajouter un contact</div>
          <input className="border rounded px-2 py-1 text-sm w-full mb-1" placeholder="Nom" value={newContact.name} onChange={(e)=>setNewContact({ ...newContact, name:e.target.value })} />
          <input className="border rounded px-2 py-1 text-sm w-full mb-1" placeholder="Email" value={newContact.email} onChange={(e)=>setNewContact({ ...newContact, email:e.target.value })} />
          <input className="border rounded px-2 py-1 text-sm w-full mb-1" placeholder="Téléphone" value={newContact.phone} onChange={(e)=>setNewContact({ ...newContact, phone:e.target.value })} />
          <input className="border rounded px-2 py-1 text-sm w-full mb-1" placeholder="Société" value={newContact.organization} onChange={(e)=>setNewContact({ ...newContact, organization:e.target.value })} />
          <input className="border rounded px-2 py-1 text-sm w-full mb-2" placeholder="Fonction" value={newContact.jobTitle} onChange={(e)=>setNewContact({ ...newContact, jobTitle:e.target.value })} />
          <button className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-60" disabled={busy} onClick={async()=>{
            try { setBusy(true); setMsg('');
              const r = await fetch('/api/google-api/oauth/people', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(newContact) });
              const j = await r.json().catch(()=>null);
              if (!r.ok || !j?.ok) alert(j?.message||j?.error||`Create failed (${r.status})`);
              else { setNewContact({ name:'', email:'', phone:'', organization:'', jobTitle:'' }); loadContacts({ max:200 }); }
            } catch (e) { alert(String(e?.message||e)); } finally { setBusy(false); }
          }}>Ajouter</button>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-60"
            disabled={busy}
            onClick={() => loadContacts({ max: pageSize })}
          >
            {busy ? 'Chargement…' : 'Rafraîchir'}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-60"
            disabled={busy || !next}
            onClick={() => loadContacts({ max: pageSize, pageToken: next, append: true })}
          >
            {busy ? '…' : (next ? 'Charger plus' : 'Fin')}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-60"
            disabled={busy}
            onClick={loadAll}
          >
            {busy ? '…' : 'Charger tout'}
          </button>
          <div className="text-xs text-gray-600 flex items-center gap-1">
            <span>Page:</span>
            <select className="border rounded px-1 py-0.5" value={pageSize} onChange={(e)=>setPageSize(Number(e.target.value))}>
              <option value={200}>200</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>
          <div className="text-[11px] text-gray-600">{filtered.length} / {items.length}</div>
        </div>
      </aside>
      <main className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="panel max-w-[1200px]">
          <div className="panel__header flex items-center justify-between">
            <div>Contacts <span className="text-xs text-gray-500">({items.length})</span></div>
            <div className="flex items-center gap-2">
              {msg && <div className="text-xs text-red-600">{msg}</div>}
              <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async()=>{
                try { const r=await fetch('/api/google-api/auth-url?scopes='+encodeURIComponent('https://www.googleapis.com/auth/contacts.readonly'), { credentials:'include' }); const j=await r.json(); const u=j&&j.url; if(u){ const w=window.open(u,'oauth','width=600,height=700'); if(!w||w.closed||typeof w.closed==='undefined'){ window.location.href=u; } } else { alert(j?.message||j?.error||'Auth URL'); } } catch(e){ alert(String(e?.message||e)); }
              }}>Grant Contacts (readonly)</button>
              <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async()=>{
                try { const scopes = [
                  'https://www.googleapis.com/auth/contacts',
                  'https://www.googleapis.com/auth/contacts.readonly'
                ].join(' ');
                const r=await fetch('/api/google-api/auth-url?scopes='+encodeURIComponent(scopes), { credentials:'include' }); const j=await r.json(); const u=j&&j.url; if(u){ const w=window.open(u,'oauth','width=600,height=700'); if(!w||w.closed||typeof w.closed==='undefined'){ window.location.href=u; } } else { alert(j?.message||j?.error||'Auth URL'); } } catch(e){ alert(String(e?.message||e)); }
              }}>Grant Contacts (write)</button>
            </div>
          </div>
          <div className="panel__body p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b">
                    <th className="px-4 py-2 w-[34%]">Name</th>
                    <th className="px-4 py-2 w-[24%]">Email</th>
                    <th className="px-4 py-2 w-[18%]">Phone number</th>
                    <th className="px-4 py-2 w-[14%]">Job title and company</th>
                    <th className="px-4 py-2 w-[10%] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!filtered.length && !busy && (
                    <tr>
                      <td className="px-4 py-6 text-gray-500" colSpan={5}>Aucun contact.</td>
                    </tr>
                  )}
                  {filtered.map((c, idx) => (
                    <tr key={`${c.email || c.name || idx}-${idx}`} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.name || c.email || ''} />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{c.name || '(Sans nom)'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-gray-700">
                        {c.email || ''}
                      </td>
                      <td className="px-4 py-2 text-gray-700">
                        {c.phone || ''}
                      </td>
                      <td className="px-4 py-2 text-gray-700">{(c.jobTitle || '') + (c.organization ? (c.jobTitle ? ' · ' : '') + c.organization : '')}</td>
                      <td className="px-4 py-2 text-right">
                        <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 mr-1" onClick={()=>{
                          setEditModal({ resourceName: c.resourceName, name: c.name||'', email: c.email||'', phone: c.phone||'', organization: c.organization||'', jobTitle: c.jobTitle||'' });
                        }}>Edit</button>
                        <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 text-red-700" onClick={async()=>{
                          if (!confirm('Delete this contact?')) return;
                          try { setBusy(true); setMsg('');
                            const r = await fetch(`/api/google-api/oauth/people/${encodeURIComponent(c.resourceName)}`, { method:'DELETE', credentials:'include' });
                            const j = await r.json().catch(()=>null);
                            if (!r.ok || !j?.ok) alert(j?.message||j?.error||`Delete failed (${r.status})`);
                            else loadContacts({ max:200 });
                          } catch (e) { alert(String(e?.message||e)); } finally { setBusy(false); }
                        }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
    {editModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={(e)=>{ if(e.key==='Escape') setEditModal(null); if(e.key==='Enter' && (e.ctrlKey||e.metaKey)) document.getElementById('saveContactBtn')?.click(); }}>
        <div className="absolute inset-0 bg-black/40" onClick={()=>setEditModal(null)} />
        <div className="relative bg-white rounded-lg shadow-2xl w-full max-w-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold">{(editModal.name||editModal.email||'?').trim()[0]?.toUpperCase()||'?'}</div>
              <div>
                <div className="text-sm font-medium">Edit contact</div>
                <div className="text-xs text-gray-500">{editModal.email || '—'}</div>
              </div>
            </div>
            <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setEditModal(null)} aria-label="Close">✕</button>
          </div>
          {editError && <div className="text-xs text-red-600 mb-2">{editError}</div>}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="col-span-2">
              <label className="text-xs text-gray-600">Name</label>
              <input autoFocus className="border rounded px-3 py-2 w-full" placeholder="Full name" value={editModal.name} onChange={(e)=>setEditModal({ ...editModal, name:e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-600">Email</label>
              <input type="email" className="border rounded px-3 py-2 w-full" placeholder="name@example.com" value={editModal.email} onChange={(e)=>setEditModal({ ...editModal, email:e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-600">Phone</label>
              <input type="tel" className="border rounded px-3 py-2 w-full" placeholder="+420 …" value={editModal.phone} onChange={(e)=>setEditModal({ ...editModal, phone:e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-600">Company</label>
              <input className="border rounded px-3 py-2 w-full" placeholder="Company" value={editModal.organization} onChange={(e)=>setEditModal({ ...editModal, organization:e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-600">Job title</label>
              <input className="border rounded px-3 py-2 w-full" placeholder="Job title" value={editModal.jobTitle} onChange={(e)=>setEditModal({ ...editModal, jobTitle:e.target.value })} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">Press Esc to close • Ctrl/Cmd+Enter to save</div>
            <div className="flex items-center gap-2">
              <button className="text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setEditModal(null)}>Cancel</button>
              <button id="saveContactBtn" className="text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60" disabled={savingEdit} onClick={async()=>{
                try {
                  setSavingEdit(true); setEditError(''); setMsg('');
                  const body = { name: editModal.name, email: editModal.email, phone: editModal.phone, organization: editModal.organization, jobTitle: editModal.jobTitle };
                  const r = await fetch(`/api/google-api/oauth/people/${encodeURIComponent(editModal.resourceName)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                  const j = await r.json().catch(()=>null);
                  if (!r.ok || !j?.ok) setEditError(j?.message||j?.error||`Update failed (${r.status})`);
                  else { setEditModal(null); loadContacts({ max:200 }); }
                } catch (e) { setEditError(String(e?.message||e)); } finally { setSavingEdit(false); }
              }}>{savingEdit? 'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
