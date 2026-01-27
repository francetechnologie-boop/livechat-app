import React, { useEffect, useState } from 'react';

export default function DbManagerPostgres() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name:'', host:'', port:5432, database:'', db_user:'', db_password:'', ssl:false, is_default:false, table_prefixes:'' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['DB Manager PostgreSQL'] })); } catch {}
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/db-postgresql/profiles', { credentials:'include' });
      const j = await r.json().catch(()=>({}));
      setItems(Array.isArray(j.items)? j.items : []);
    } catch { setItems([]); }
    setLoading(false);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    try {
      const r = await fetch('/api/db-postgresql/profiles', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(form) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||'save_failed');
      setForm({ name:'', host:'', port:5432, database:'', db_user:'', db_password:'', ssl:false, is_default:false, table_prefixes:'' });
      load();
    } catch (e2) { alert(String(e2?.message||e2)); }
  };

  return (
    <div className="max-w-3xl">
      <div className="text-lg font-semibold mb-2">DB Manager PostgreSQL</div>
      <div className="text-xs text-gray-600 mb-4">Profiles stored in table <code>mod_db_postgresql_profiles</code>.</div>
      <form onSubmit={submit} className="border rounded p-3 space-y-2 mb-4">
        <div className="grid grid-cols-2 gap-2">
          <input className="border rounded px-2 py-1" placeholder="Name" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} />
          <input className="border rounded px-2 py-1" placeholder="Host" value={form.host} onChange={e=>setForm({...form, host:e.target.value})} />
          <input className="border rounded px-2 py-1" placeholder="Port" type="number" value={form.port} onChange={e=>setForm({...form, port:Number(e.target.value||5432)})} />
          <input className="border rounded px-2 py-1" placeholder="Database" value={form.database} onChange={e=>setForm({...form, database:e.target.value})} />
          <input className="border rounded px-2 py-1" placeholder="User" value={form.db_user} onChange={e=>setForm({...form, db_user:e.target.value})} />
          <input className="border rounded px-2 py-1" placeholder="Password" type="password" value={form.db_password} onChange={e=>setForm({...form, db_password:e.target.value})} />
          <input className="border rounded px-2 py-1 col-span-2" placeholder="Table prefixes (comma separated), e.g. public.mod_grabbing_zasilkovna_, mod_mcp2_" value={form.table_prefixes} onChange={e=>setForm({...form, table_prefixes:e.target.value})} />
        </div>
        <label className="inline-flex items-center text-sm"><input type="checkbox" className="mr-2" checked={!!form.ssl} onChange={e=>setForm({...form, ssl: !!e.target.checked})} />SSL</label>
        <label className="inline-flex items-center text-sm ml-4"><input type="checkbox" className="mr-2" checked={!!form.is_default} onChange={e=>setForm({...form, is_default: !!e.target.checked})} />Default</label>
        <div className="flex justify-end"><button className="px-3 py-1 bg-blue-600 text-white rounded" type="submit">Save</button></div>
      </form>
      <div className="border rounded">
        <div className="px-2 py-1 text-xs bg-gray-50 border-b flex items-center justify-between">
          <div>Profiles ({items.length})</div>
          <button className="text-xs border rounded px-2 py-0.5" onClick={load} disabled={loading}>{loading?'Loading.':'Refresh'}</button>
        </div>
        <div className="divide-y">
          {(items||[]).map((p)=> (
            <div key={p.id} className="px-2 py-1 text-sm">
              <div className="font-mono text-[12px]">{p.name} — {p.host}:{p.port}/{p.database} ({p.db_user}) {p.ssl? 'ssl':''} {p.is_default? '· default':''}</div>
              {p.table_prefixes ? <div className="text-[11px] text-gray-600">prefixes: <span className="font-mono">{p.table_prefixes}</span></div> : null}
            </div>
          ))}
          {(!items || !items.length) && (<div className="px-2 py-2 text-xs text-gray-500">No profiles</div>)}
        </div>
      </div>
    </div>
  );
}
