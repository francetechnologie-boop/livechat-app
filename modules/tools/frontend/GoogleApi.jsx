import React, { useEffect, useState } from "react";
import { loadModuleState, saveModuleState } from "@app-lib/uiState";

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-12 gap-3 items-center">
      <div className="col-span-12 md:col-span-3 text-xs text-gray-600">{label}</div>
      <div className="col-span-12 md:col-span-9">{children}</div>
    </div>
  );
}

export default function GoogleApi() {
  const [f, setF] = useState(() => {
    try { return loadModuleState('tools.google') || {}; } catch { return {}; }
  });
  useEffect(() => { try { saveModuleState('tools.google', f); } catch {} }, [f]);

  const [msg, setMsg] = useState("");
  const [testing, setTesting] = useState(false);
  const [oauth, setOauth] = useState({ connected: false, loading: true });
  const [gmailLabels, setGmailLabels] = useState([]);

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/google-api/oauth/debug', { credentials:'include' });
      const j = await r.json();
      setOauth({ connected: !!j?.connected, loading: false, info: j?.token || null, lastError: j?.last_error || '' });
    } catch { setOauth({ connected:false, loading:false }); }
  };
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => {
    const onMsg = (e) => { try { if (e?.data?.kind === 'oauth_ok') loadStatus(); } catch {} };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  
  // Auto-load Gmail labels when OAuth is connected
  useEffect(() => {
    (async () => {
      if (!oauth.connected || oauth.loading) return;
      try {
        const r = await fetch('/api/google-api/oauth/gmail', { credentials:'include' });
        const j = await r.json().catch(()=>null);
        if (r.ok && j && (j.ok===undefined || j.ok)) {
          const labels = Array.isArray(j.labels) ? j.labels : [];
          setGmailLabels(labels);
          setMsg(`Gmail OAuth OK - ${labels.length} label(s)`);
        }
      } catch {}
    })();
  }, [oauth.connected, oauth.loading]);

  const doTest = async () => {
    setTesting(true); setMsg('');
    try {
      const r = await fetch('/api/google-api/oauth/drive', { credentials:'include' });
      const j = await r.json().catch(()=>null);
      if (r.ok && j && (j.ok===undefined || j.ok)) {
        setMsg(`OK — ${j.count || 0} file(s)`);
      } else {
        setMsg(`Erreur: ${j?.message || j?.error || r.status}`);
      }
    } catch (e) { setMsg(String(e?.message || e)); }
    finally { setTesting(false); }
  };

  return (
    <div className="p-4">
      <div className="panel max-w-4xl">
        <div className="panel__header">Google API</div>
        <div className="panel__body space-y-3">
          <div className="text-xs text-gray-500">Connectez-vous avec les scopes nécessaires. Pour accéder aux Contacts, ajoutez le scope contacts.readonly ci-dessous ou utilisez le bouton de raccourci.</div>
          <div className="flex items-center gap-2 text-xs">
            <button className="px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async()=>{
              try { const r=await fetch('/api/google-api/auth-url?scopes='+encodeURIComponent('https://www.googleapis.com/auth/contacts.readonly'), { credentials:'include' }); const j=await r.json(); const u=j&&j.url; if(u){ const w=window.open(u,'oauth','width=600,height=700'); if(!w||w.closed||typeof w.closed==='undefined'){ window.location.href=u; } } else { setMsg(j?.message||j?.error||'Auth URL'); } } catch(e){ setMsg(String(e?.message||e)); }
            }}>Grant Contacts (readonly)</button>
            <button className="px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async()=>{
              try { const scopes = [
                'https://www.googleapis.com/auth/contacts',
                // Include readonly for compatibility and potential incremental auth
                'https://www.googleapis.com/auth/contacts.readonly'
              ].join(' ');
              const r=await fetch('/api/google-api/auth-url?scopes='+encodeURIComponent(scopes), { credentials:'include' });
              const j=await r.json(); const u=j&&j.url; if(u){ const w=window.open(u,'oauth','width=600,height=700'); if(!w||w.closed||typeof w.closed==='undefined'){ window.location.href=u; } } else { setMsg(j?.message||j?.error||'Auth URL'); } } catch(e){ setMsg(String(e?.message||e)); }
            }}>Grant Contacts (write)</button>
            <button className="px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async()=>{
              try { const r=await fetch('/api/google-api/auth-url?scopes='+encodeURIComponent('https://www.googleapis.com/auth/gmail.modify'), { credentials:'include' }); const j=await r.json(); const u=j&&j.url; if(u){ const w=window.open(u,'oauth','width=600,height=700'); if(!w||w.closed||typeof w.closed==='undefined'){ window.location.href=u; } } else { setMsg(j?.message||j?.error||'Auth URL'); } } catch(e){ setMsg(String(e?.message||e)); }
            }}>Grant Gmail Modify</button>
          </div>
          <Field label="Project ID">
            <input className="w-full border rounded px-3 py-2" placeholder="my-gcp-project" value={f.project_id || ''} onChange={(e)=>setF({ ...f, project_id:e.target.value })} />
          </Field>
          <Field label="Client ID (OAuth)">
            <input className="w-full border rounded px-3 py-2" placeholder="xxxxxxxx.apps.googleusercontent.com" value={f.client_id || ''} onChange={(e)=>setF({ ...f, client_id:e.target.value })} />
          </Field>
          <Field label="Client Secret (OAuth)">
            <input type="password" className="w-full border rounded px-3 py-2" placeholder="********" value={f.client_secret || ''} onChange={(e)=>setF({ ...f, client_secret:e.target.value })} />
          </Field>
          <Field label="Service Account (JSON)">
            <textarea
              className="w-full border rounded px-3 py-2 min-h-[120px] font-mono text-xs"
              placeholder={`{
  "type": "service_account", ...
}`}
              value={f.service_account_json || ''}
              onChange={(e)=>setF({ ...f, service_account_json:e.target.value })}
            />
          </Field>
          <Field label="Scopes (séparés par des espaces)">
            <input className="w-full border rounded px-3 py-2" placeholder="https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly" value={f.scopes || ''} onChange={(e)=>setF({ ...f, scopes:e.target.value })} />
          </Field>
          <Field label="Redirect URIs (OAuth)">
            <input className="w-full border rounded px-3 py-2" placeholder="https://app.example.com/oauth2/callback" value={f.redirect_uris || ''} onChange={(e)=>setF({ ...f, redirect_uris:e.target.value })} />
          </Field>
          <Field label="Impersonate user (Workspace email)">
            <input className="w-full border rounded px-3 py-2" placeholder="user@domain.com (required for Gmail/Calendar/Contacts tests)" value={f.impersonate || ''} onChange={(e)=>setF({ ...f, impersonate:e.target.value })} />
          </Field>
          {msg && (<div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{msg}</div>)}
          <div className="rounded border p-2 bg-white text-xs flex items-center justify-between">
            <div>
              <div className="font-medium">OAuth utilisateur</div>
              <div className="text-gray-600">Statut: {oauth.loading ? '...' : (oauth.connected ? 'Connecté' : 'Non connecté')}</div>
              {(!oauth.loading && !oauth.connected && oauth.lastError) && (
                <div className="text-red-600 mt-1">Erreur: {oauth.lastError}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!oauth.connected ? (
                <button className="px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-xs" onClick={async()=>{ try { const r=await fetch('/api/google-api/auth-url',{credentials:'include'}); const j=await r.json(); const u=j&&j.url; if (u) { const w=window.open(u,'oauth','width=600,height=700'); if (!w || w.closed || typeof w.closed === 'undefined') { window.location.href = u; } const t=setInterval(()=>loadStatus(),1200); setTimeout(()=>clearInterval(t),20000);} } catch {} }}>Se connecter</button>
              ) : (
                <button className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs" onClick={async()=>{ await fetch('/api/google-api/oauth/revoke',{ method:'POST', credentials:'include' }); loadStatus(); }}>Se déconnecter</button>
              )}
              <button className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs" onClick={loadStatus}>Rafraîchir</button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ try { saveModuleState('tools.google', f); setMsg('Enregistré localement.'); setTimeout(()=>setMsg(''), 1500);} catch {} }}>Enregistrer</button>
            <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ try { const s = loadModuleState('tools.google'); setF(s || {}); setMsg('Rechargé.'); setTimeout(()=>setMsg(''), 1200);} catch {} }}>Recharger</button>
            <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60" disabled={testing} onClick={doTest}>{testing ? 'Test…' : 'Test Drive (SA)'}</button>
            <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60" disabled={testing || !oauth.connected} onClick={async()=>{
              setTesting(true); setMsg('');
              try {
                const r = await fetch('/api/google-api/oauth/drive', { credentials:'include' });
                const j = await r.json().catch(()=>null);
                setMsg(r.ok && j?.ok ? `Drive OAuth OK — ${j.count||0} fichier(s)` : `Drive OAuth erreur: ${j?.message||j?.error||r.status}`);
              } catch (e) { setMsg(String(e?.message||e)); } finally { setTesting(false); }
            }}>Test Drive (OAuth)</button>
            <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" disabled={testing} onClick={async()=>{
              setTesting(true); setMsg('');
              try {
                const body = { service_account_json: f.service_account_json || null, scopes: (f.scopes||'https://www.googleapis.com/auth/gmail.readonly'), impersonate: f.impersonate||'' };
                const r = await fetch('/api/google/test/gmail', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const j = await r.json().catch(()=>null);
                setMsg(r.ok && j?.ok ? `Gmail OK — ${j.count||0} label(s)` : `Gmail erreur: ${j?.message||j?.error||r.status}`);
              } catch (e) { setMsg(String(e?.message||e)); } finally { setTesting(false); }
            }}>Test Gmail</button>
            <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" disabled={testing || !oauth.connected} onClick={async()=>{
              setTesting(true); setMsg('');
              try {
                const r = await fetch('/api/google-api/oauth/gmail', { credentials:'include' });
                const j = await r.json().catch(()=>null);
                if (r.ok && j?.ok) {
                  const labels = Array.isArray(j.labels) ? j.labels : [];
                  setGmailLabels(labels);
                  setMsg(`Gmail OAuth OK - ${labels.length||j.count||0} label(s)`);
                } else {
                  setMsg(`Gmail OAuth erreur: ${j?.message||j?.error||r.status}`);
                }
              } catch (e) { setMsg(String(e?.message||e)); } finally { setTesting(false); }
            }}>Test Gmail (OAuth)</button>
            <button className="text-xs px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60" disabled={testing} onClick={async()=>{
              setTesting(true); setMsg('');
              try {
                const body = { service_account_json: f.service_account_json || null, scopes: (f.scopes||'https://www.googleapis.com/auth/calendar.readonly'), impersonate: f.impersonate||'' };
                const r = await fetch('/api/google/test/calendar', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const j = await r.json().catch(()=>null);
                setMsg(r.ok && j?.ok ? `Calendar OK — ${j.count||0} évènement(s)` : `Calendar erreur: ${j?.message||j?.error||r.status}`);
              } catch (e) { setMsg(String(e?.message||e)); } finally { setTesting(false); }
            }}>Test Calendar</button>
            <button className="text-xs px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60" disabled={testing || !oauth.connected} onClick={async()=>{
              setTesting(true); setMsg('');
              try {
                const r = await fetch('/api/google-api/oauth/calendar', { credentials:'include' });
                const j = await r.json().catch(()=>null);
                setMsg(r.ok && j?.ok ? `Calendar OAuth OK — ${j.count||0} évènement(s)` : `Calendar OAuth erreur: ${j?.message||j?.error||r.status}`);
              } catch (e) { setMsg(String(e?.message||e)); } finally { setTesting(false); }
            }}>Test Calendar (OAuth)</button>
            <button className="text-xs px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60" disabled={testing} onClick={async()=>{
              setTesting(true); setMsg('');
              try {
                const body = { service_account_json: f.service_account_json || null, scopes: (f.scopes||'https://www.googleapis.com/auth/contacts.readonly'), impersonate: f.impersonate||'' };
                const r = await fetch('/api/google/test/people', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const j = await r.json().catch(()=>null);
                setMsg(r.ok && j?.ok ? `Contacts OK — ${j.count||0} contact(s)` : `Contacts erreur: ${j?.message||j?.error||r.status}`);
              } catch (e) { setMsg(String(e?.message||e)); } finally { setTesting(false); }
            }}>Test Contacts</button>
            <button className="text-xs px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60" disabled={testing || !oauth.connected} onClick={async()=>{
              setTesting(true); setMsg('');
              try {
                const r = await fetch('/api/google-api/oauth/people', { credentials:'include' });
                const j = await r.json().catch(()=>null);
                setMsg(r.ok && j?.ok ? `Contacts OAuth OK — ${j.count||0} contact(s)` : `Contacts OAuth erreur: ${j?.message||j?.error||r.status}`);
              } catch (e) { setMsg(String(e?.message||e)); } finally { setTesting(false); }
            }}>Test Contacts (OAuth)</button>
        </div>
        {gmailLabels && gmailLabels.length > 0 && (
          <div className="rounded border p-2 bg-white mt-2">
            <div className="text-xs font-medium mb-1">Gmail labels</div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Unread</th>
                    <th className="px-2 py-1">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {gmailLabels.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-2 py-1">{l.name}</td>
                      <td className="px-2 py-1">{l.messagesUnread ?? 0}</td>
                      <td className="px-2 py-1">{l.messagesTotal ?? 0}</td>
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
