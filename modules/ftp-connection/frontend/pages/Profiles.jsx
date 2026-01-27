import React from 'react';

export default function FtpProfilesPage() {
  const [items, setItems] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  // Default to SFTP (SSH) as requested; port 22
  const [form, setForm] = React.useState({ protocol: 'sftp', passive: true, port: 22, base_path: '/' });
  const isSftp = String(form.protocol||'').toLowerCase() === 'sftp';

  const load = async () => {
    setBusy(true); setMsg('');
    try { const r = await fetch('/api/ftp-connection/profiles', { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok) setItems(j.items||[]); else setItems([]); } catch { setItems([]); }
    finally { setBusy(false); }
  };
  React.useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setMsg('');
    try {
      const body = { ...form, port: Number(form.port||0)|| (String(form.protocol||'').toLowerCase()==='sftp'?22:21) };
      const r = await fetch('/api/ftp-connection/profiles', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setMsg(String(j?.message||j?.error||r.status)); }
      await load(); setForm({ protocol: 'ftp', passive: true, port: 21, base_path: '/' });
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const del = async (id) => {
    if (!id) return; setBusy(true); setMsg('');
    try { const r = await fetch(`/api/ftp-connection/profiles/${id}`, { method:'DELETE', credentials:'include' }); await load(); } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const test = async (id) => {
    if (!id) return;
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/ftp-connection/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ profile_id: id }) });
      const j = await r.json().catch(()=>null);
      if (!r.ok || (j && j.ok===false)) { setMsg(String((j && (j.message||j.error)) || r.status)); return; }
      setMsg(j?.connected ? `OK (${j.protocol} connected)` : 'Test returned without connection');
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="panel">
      <div className="panel__header flex items-center justify-between">
        <span>FTP Connection – Profiles</span>
        <div className="text-xs text-gray-500">Manage FTP/SFTP connection profiles</div>
      </div>
      <div className="panel__body">
        {msg && <div className="text-xs text-red-600 mb-2">{msg}</div>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-semibold mb-1">Create / Update</div>
            <div className="space-y-2 text-sm">
              <input className="border rounded px-2 py-1 w-full" placeholder="Name" value={form.name||''} onChange={(e)=>setForm(f=>({...f, name:e.target.value}))} />
              <input className="border rounded px-2 py-1 w-full" placeholder="Host" value={form.host||''} onChange={(e)=>setForm(f=>({...f, host:e.target.value}))} />
              <div className="flex items-center gap-2">
                <select className="border rounded px-2 py-1" value={form.protocol||'ftp'} onChange={(e)=>setForm(f=>({...f, protocol:e.target.value, port: (e.target.value==='sftp'?22:21)}))}>
                  <option value="ftp">ftp</option>
                  <option value="sftp">sftp</option>
                </select>
                <input className="border rounded px-2 py-1 w-24" type="number" placeholder="Port" value={form.port||''} onChange={(e)=>setForm(f=>({...f, port:e.target.value}))} />
                {!isSftp && (
                  <label className="text-xs inline-flex items-center gap-1"><input type="checkbox" checked={!!form.passive} onChange={(e)=>setForm(f=>({...f, passive: !!e.target.checked}))} /> passive</label>
                )}
              </div>
              {isSftp ? (<div className="text-[11px] text-gray-500">SFTP selected — default port 22; passive mode not applicable.</div>) : null}
              <input className="border rounded px-2 py-1 w-full" placeholder="Username" value={form.username||''} onChange={(e)=>setForm(f=>({...f, username:e.target.value}))} />
              <input className="border rounded px-2 py-1 w-full" type="password" placeholder="Password" value={form.password||''} onChange={(e)=>setForm(f=>({...f, password:e.target.value}))} />
              <input className="border rounded px-2 py-1 w-full" placeholder="Base path (e.g. /var/www/html)" value={form.base_path||'/'} onChange={(e)=>setForm(f=>({...f, base_path:e.target.value}))} />
              <div className="flex items-center gap-2">
                <button className="px-3 py-1.5 border rounded" disabled={busy} onClick={save}>Save</button>
                <button className="px-3 py-1.5 border rounded" disabled={busy} onClick={()=>setForm({ protocol:'ftp', passive:true, port:21, base_path:'/' })}>Reset</button>
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold mb-1">Profiles</div>
            <div className="text-xs text-gray-500 mb-2">{busy? 'Loading…' : ''}</div>
            <div className="border rounded divide-y">
              {(items||[]).map(it => (
                <div key={it.id} className="p-2 text-sm flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{it.name}</div>
                    <div className="text-xs text-gray-600">{it.protocol}://{it.host}:{it.port} <span className="ml-2">base: {it.base_path||'/'}</span></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="px-2 py-1 border rounded text-xs" onClick={()=>setForm({ id: it.id, name: it.name, host: it.host, protocol: it.protocol, port: it.port, username: it.username||'', password:'', base_path: it.base_path||'/', passive: !!it.passive })}>Edit</button>
                    <button className="px-2 py-1 border rounded text-xs" onClick={()=>test(it.id)}>Test</button>
                    <button className="px-2 py-1 border rounded text-xs" onClick={()=>del(it.id)}>Delete</button>
                  </div>
                </div>
              ))}
              {(!items || !items.length) && <div className="p-2 text-xs text-gray-500">No profiles</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
