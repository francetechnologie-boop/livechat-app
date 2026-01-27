import React, { useEffect, useState } from 'react';

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

export default function DbPostgresProfilesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name:'', host:'', port:5432, database:'', db_user:'', db_password:'', ssl:false, table_prefixes:'' });
  const [editId, setEditId] = useState(null);
  const [tests, setTests] = useState({});
  const [formTest, setFormTest] = useState(null);
  const [orgId, setOrgId] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/db-postgresql/profiles${q}`);
      setItems(r.items || []);
    } catch (e) { setErr(String(e.message||e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [orgId]);

  async function onSubmit(e) {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const body = { ...form }; if (orgId) body.org_id = orgId;
      if (editId) {
        await api(`/api/db-postgresql/profiles/${editId}`, { method:'PUT', body: JSON.stringify(body) });
      } else {
        await api('/api/db-postgresql/profiles', { method:'POST', body: JSON.stringify(body) });
      }
      setEditId(null);
      setForm({ name:'', host:'', port:5432, database:'', db_user:'', db_password:'', ssl:false, table_prefixes:'' });
      await load();
    } catch (e2) { setErr(String(e2.message||e2)); } finally { setLoading(false); }
  }

  async function onDelete(id) {
    if (!window.confirm('Delete profile #' + id + '?')) return;
    setLoading(true); setErr('');
    try { await api(`/api/db-postgresql/profiles/${id}`, { method:'DELETE' }); await load(); }
    catch (e2) { setErr(String(e2.message||e2)); }
    finally { setLoading(false); }
  }

  async function onTest(id) {
    setLoading(true); setErr('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      await api(`/api/db-postgresql/test${q}`, { method:'POST', body: JSON.stringify({ profile_id: id }) });
      setTests(prev => ({ ...prev, [id]: { ok: true, message: 'Connection OK' } }));
    } catch (e2) { setTests(prev => ({ ...prev, [id]: { ok:false, message: String(e2.message||e2) } })); }
    finally { setLoading(false); }
  }

  async function onEdit(it) {
    setErr(''); setEditId(it.id);
    try {
      const det = await api(`/api/db-postgresql/profiles/${it.id}`);
      const p = det?.item || it;
      setForm({ name:p.name||'', host:p.host||'', port:Number(p.port||5432), database:p.database||'', db_user:p.db_user||'', db_password:p.db_password||'', ssl:!!p.ssl, table_prefixes:p.table_prefixes||'' });
    } catch {
      setForm({ name:it.name||'', host:it.host||'', port:Number(it.port||5432), database:it.database||'', db_user:it.db_user||'', db_password:'', ssl:!!it.ssl, table_prefixes:it.table_prefixes||'' });
    }
  }

  async function onTestForm() {
    setErr(''); setLoading(true); setFormTest(null);
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const payload = { host: form.host, port: form.port, database: form.database, user: form.db_user, password: form.db_password, ssl: !!form.ssl };
      await api(`/api/db-postgresql/test${q}`, { method:'POST', body: JSON.stringify(payload) });
      setFormTest({ ok:true, message: 'Connection OK' });
    } catch (e2) { setFormTest({ ok:false, message: String(e2.message||e2) }); }
    finally { setLoading(false); }
  }

  function onCancel() { setEditId(null); setForm({ name:'', host:'', port:5432, database:'', db_user:'', db_password:'', ssl:false, table_prefixes:'' }); }

  return (
    <div style={{ padding: 16 }}>
      <h2>DB PostgreSQL Profiles</h2>
      <div style={{ marginBottom: 12 }}>
        <label>Org ID: <input value={orgId} onChange={e=>setOrgId(e.target.value)} placeholder="optional" /></label>
        <button onClick={load} disabled={loading} style={{ marginLeft: 8 }}>Reload</button>
      </div>
      {err ? <div style={{ color:'red' }}>{err}</div> : null}
      <form onSubmit={onSubmit} style={{ border:'1px solid #ccc', padding: 12, marginBottom: 16 }}>
        <h3>{editId ? `Edit Profile #${editId}` : 'Create Profile'}</h3>
        <div>
          <input placeholder="Name" value={form.name} onChange={e=>setForm({ ...form, name:e.target.value })} required />
          <input placeholder="Host" value={form.host} onChange={e=>setForm({ ...form, host:e.target.value })} required style={{ marginLeft: 8 }} />
          <input placeholder="Port" type="number" value={form.port} onChange={e=>setForm({ ...form, port:Number(e.target.value||5432) })} style={{ width: 90, marginLeft: 8 }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <input placeholder="Database" value={form.database} onChange={e=>setForm({ ...form, database:e.target.value })} required />
          <input placeholder="DB User" value={form.db_user} onChange={e=>setForm({ ...form, db_user:e.target.value })} required style={{ marginLeft: 8 }} />
          <input placeholder="DB Password" value={form.db_password} onChange={e=>setForm({ ...form, db_password:e.target.value })} style={{ marginLeft: 8 }} type="text" />
        </div>
        <div style={{ marginTop: 8 }}>
          <input placeholder="Table prefixes (comma separated), e.g. public.mod_grabbing_zasilkovna_, mod_mcp2_" value={form.table_prefixes} onChange={e=>setForm({ ...form, table_prefixes:e.target.value })} style={{ width: '100%' }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <label><input type="checkbox" checked={form.ssl} onChange={e=>setForm({ ...form, ssl:e.target.checked })} /> SSL</label>
          <button type="submit" disabled={loading} style={{ marginLeft: 12 }}>{editId ? 'Save Changes' : 'Create'}</button>
          <button type="button" onClick={onTestForm} disabled={loading} style={{ marginLeft: 8 }}>Test connection</button>
          {formTest ? (<span style={{ marginLeft: 8, color: formTest.ok ? 'green' : 'red' }}>{formTest.message}</span>) : null}
          {editId ? <button type="button" onClick={onCancel} disabled={loading} style={{ marginLeft: 8 }}>Cancel</button> : null}
        </div>
      </form>
      <table border="1" cellPadding="6" style={{ borderCollapse:'collapse', width:'100%' }}>
        <thead>
          <tr>
            <th>ID</th><th>Name</th><th>Host</th><th>Port</th><th>Database</th><th>User</th><th>SSL</th><th>Prefixes</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {(items||[]).map(it => (
            <tr key={it.id}>
              <td>{it.id}</td>
              <td>{it.name}</td>
              <td>{it.host}</td>
              <td>{it.port}</td>
              <td>{it.database}</td>
              <td>{it.db_user}</td>
              <td>{String(it.ssl)}</td>
              <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.table_prefixes || ''}>{it.table_prefixes || ''}</td>
              <td>
                <button onClick={()=>onTest(it.id)} disabled={loading}>Test</button>
                {tests[it.id] ? (
                  <span style={{ marginLeft: 8, color: tests[it.id].ok ? 'green' : 'red' }}>{tests[it.id].message}</span>
                ) : null}
                <button onClick={()=>onEdit(it)} disabled={loading} style={{ marginLeft: 8 }}>Edit</button>
                <button onClick={()=>onDelete(it.id)} disabled={loading} style={{ marginLeft: 8 }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
