import React, { useEffect, useState } from 'react';

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) }, ...opts });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || res.statusText);
  return json;
}

function summarizeConfig(obj, maxKeys = 5) {
  try {
    const o = (obj && typeof obj === 'object') ? obj : {};
    const keys = Object.keys(o);
    if (!keys.length) return '{}';
    const head = keys.slice(0, maxKeys);
    return `{ ${head.join(', ')}${keys.length > maxKeys ? ', …' : ''} }`;
  } catch { return '{}'; }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    alert('Copied to clipboard');
  } catch (e) {
    alert('Copy failed');
  }
}

export default function DbMysqlProfilesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name:'', host:'', port:3306, database:'', db_user:'', db_password:'', ssl:false, table_prefixes:'' });
  const [editId, setEditId] = useState(null);
  const [tools, setTools] = useState([]);
  const [toolForm, setToolForm] = useState({ name:'', description:'', config:'' });
  const [toolDesignBusy, setToolDesignBusy] = useState(false);
  const [resources, setResources] = useState([]);
  const [resourceForm, setResourceForm] = useState({ uri:'', name:'', description:'', mimeType:'' });
  const [templates, setTemplates] = useState([]);
  const [templateForm, setTemplateForm] = useState({ name:'', description:'', inputSchema:'' });
  // Inline row editor state for Tools
  const [openTool, setOpenTool] = useState({}); // { [name]: boolean }
  const [editBuf, setEditBuf] = useState({});   // { [name]: string JSON }
  const [editBusy, setEditBusy] = useState({}); // { [name]: boolean }
  const [editErr, setEditErr] = useState({});   // { [name]: string }
  const [tests, setTests] = useState({}); // { [id]: { ok:boolean, message:string } }
  const [formTest, setFormTest] = useState(null); // { ok, message }
  const [orgId, setOrgId] = useState('');
  // Prompt-assisted generation
  const [promptConfigs, setPromptConfigs] = useState([]);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [dbFlavor, setDbFlavor] = useState('prestashop8');
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/db-mysql/profiles${q}`);
      setItems(r.items || []);
    } catch (e) { setErr(String(e.message||e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [orgId]);

  // Load available Automation Suite prompts for selection
  useEffect(() => {
    (async () => {
      try {
        const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
        const r = await api(`/api/automation-suite/prompt-configs${q}`);
        const arr = Array.isArray(r?.items) ? r.items : [];
        setPromptConfigs(arr);
        if (arr.length && !selectedPromptId) setSelectedPromptId(arr[0].id || '');
      } catch { setPromptConfigs([]); }
    })();
  }, [orgId]);

  async function onCreate(e) {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const body = { ...form }; if (orgId) body.org_id = orgId;
      if (editId) {
        const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
        await api(`/api/db-mysql/profiles/${editId}${q}`, { method:'PUT', body: JSON.stringify(body) });
      } else {
        await api('/api/db-mysql/profiles', { method:'POST', body: JSON.stringify(body) });
      }
      setEditId(null);
      setForm({ name:'', host:'', port:3306, database:'', db_user:'', db_password:'', ssl:false, table_prefixes:'' });
      await load();
    } catch (e) { setErr(String(e.message||e)); } finally { setLoading(false); }
  }

  async function onDelete(id) {
    if (!window.confirm('Delete profile #' + id + '?')) return;
    setLoading(true); setErr('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      await api(`/api/db-mysql/profiles/${id}${q}`, { method:'DELETE' });
      await load();
    } catch (e) { setErr(String(e.message||e)); } finally { setLoading(false); }
  }

  async function onTest(id) {
    setLoading(true); setErr('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/db-mysql/test${q}`, { method:'POST', body: JSON.stringify({ profile_id: id }) });
      setTests(prev => ({ ...prev, [id]: { ok: true, message: 'Connection OK' } }));
    } catch (e) {
      setTests(prev => ({ ...prev, [id]: { ok: false, message: String(e.message||e) } }));
    } finally { setLoading(false); }
  }

  async function onEdit(it) {
    setErr('');
    setEditId(it.id);
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const det = await api(`/api/db-mysql/profiles/${it.id}${q}`);
      const p = det?.item || it;
      setForm({
        name: p.name || '',
        host: p.host || '',
        port: Number(p.port || 3306),
        database: p.database || '',
        db_user: p.db_user || '',
        db_password: p.db_password || '', // show actual password on edit
        ssl: !!p.ssl,
        table_prefixes: p.table_prefixes || '',
      });
      try {
        const toolsRes = await api(`/api/db-mysql/profiles/${it.id}/tools${q}`);
        setTools(Array.isArray(toolsRes?.items) ? toolsRes.items : []);
        // Reset inline editors when reloading tools
        setOpenTool({}); setEditBuf({}); setEditBusy({}); setEditErr({});
        const resRes = await api(`/api/db-mysql/profiles/${it.id}/resources${q}`);
        setResources(Array.isArray(resRes?.items) ? resRes.items : []);
        const tplRes = await api(`/api/db-mysql/profiles/${it.id}/resource-templates${q}`);
        setTemplates(Array.isArray(tplRes?.items) ? tplRes.items : []);
      } catch { setTools([]); }
    } catch (e) {
      // fallback to existing row if detail fetch fails
      setForm({
        name: it.name || '',
        host: it.host || '',
        port: Number(it.port || 3306),
        database: it.database || '',
        db_user: it.db_user || '',
        db_password: '',
        ssl: !!it.ssl,
        table_prefixes: it.table_prefixes || '',
      });
    }
  }

  async function onGenerateFromPrompt() {
    if (!editId || !selectedPromptId) return;
    setGenBusy(true); setGenMsg('');
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const r = await api(`/api/db-mysql/profiles/${editId}/generate-from-prompt${q}`, {
        method: 'POST',
        body: JSON.stringify({ prompt_config_id: selectedPromptId, context: { db_flavor: dbFlavor } })
      });
      setGenMsg('Generated and applied.');
      // refresh local lists
      try {
        const toolsRes = await api(`/api/db-mysql/profiles/${editId}/tools${q}`);
        setTools(Array.isArray(toolsRes?.items) ? toolsRes.items : []);
        const resRes = await api(`/api/db-mysql/profiles/${editId}/resources${q}`);
        setResources(Array.isArray(resRes?.items) ? resRes.items : []);
        const tplRes = await api(`/api/db-mysql/profiles/${editId}/resource-templates${q}`);
        setTemplates(Array.isArray(tplRes?.items) ? tplRes.items : []);
      } catch {}
    } catch (e) {
      setGenMsg('Error: ' + String(e.message || e));
    } finally {
      setGenBusy(false);
    }
  }

  async function onAddTool() {
    if (!editId) return;
    try {
      const cfg = (()=>{ try { return toolForm.config ? JSON.parse(toolForm.config) : {}; } catch { return {}; } })();
      const r = await api(`/api/db-mysql/profiles/${editId}/tools`, { method:'POST', body: JSON.stringify({ name: toolForm.name, description: toolForm.description, config: cfg }) });
      setTools(Array.isArray(r?.items) ? r.items : []);
      setToolForm({ name:'', description:'', config:'' });
    } catch (e) { alert(String(e.message||e)); }
  }

  async function onDeleteTool(name) {
    if (!editId) return;
    try {
      const r = await api(`/api/db-mysql/profiles/${editId}/tools/${encodeURIComponent(name)}`, { method:'DELETE' });
      setTools(Array.isArray(r?.items) ? r.items : []);
    } catch (e) { alert(String(e.message||e)); }
  }

  async function onAddResource() {
    if (!editId) return;
    try {
      const r = await api(`/api/db-mysql/profiles/${editId}/resources`, { method:'POST', body: JSON.stringify(resourceForm) });
      setResources(Array.isArray(r?.items) ? r.items : []);
      setResourceForm({ uri:'', name:'', description:'', mimeType:'' });
    } catch (e) { alert(String(e.message||e)); }
  }
  async function onDeleteResource(uri) {
    if (!editId) return;
    try {
      const r = await api(`/api/db-mysql/profiles/${editId}/resources/${encodeURIComponent(uri)}`, { method:'DELETE' });
      setResources(Array.isArray(r?.items) ? r.items : []);
    } catch (e) { alert(String(e.message||e)); }
  }

  async function onAddTemplate() {
    if (!editId) return;
    try {
      const schema = (()=>{ try { return templateForm.inputSchema ? JSON.parse(templateForm.inputSchema) : {}; } catch { return {}; } })();
      const r = await api(`/api/db-mysql/profiles/${editId}/resource-templates`, { method:'POST', body: JSON.stringify({ name: templateForm.name, description: templateForm.description, inputSchema: schema }) });
      setTemplates(Array.isArray(r?.items) ? r.items : []);
      setTemplateForm({ name:'', description:'', inputSchema:'' });
    } catch (e) { alert(String(e.message||e)); }
  }
  async function onDeleteTemplate(name) {
    if (!editId) return;
    try {
      const r = await api(`/api/db-mysql/profiles/${editId}/resource-templates/${encodeURIComponent(name)}`, { method:'DELETE' });
      setTemplates(Array.isArray(r?.items) ? r.items : []);
    } catch (e) { alert(String(e.message||e)); }
  }

  async function onTestForm() {
    setErr(''); setLoading(true); setFormTest(null);
    try {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      const payload = {
        host: form.host,
        port: form.port,
        database: form.database,
        user: form.db_user,
        password: form.db_password,
        ssl: !!form.ssl,
      };
      await api(`/api/db-mysql/test${q}`, { method: 'POST', body: JSON.stringify(payload) });
      setFormTest({ ok: true, message: 'Connection OK' });
    } catch (e) {
      setFormTest({ ok: false, message: String(e.message || e) });
    } finally { setLoading(false); }
  }

  function onCancelEdit() {
    setEditId(null);
    setForm({ name:'', host:'', port:3306, database:'', db_user:'', db_password:'', ssl:false, table_prefixes:'' });
  }

  return (
    <div style={{ padding: 16 }}>
      <h2>DB MySQL Profiles</h2>
      <div style={{ marginBottom: 12 }}>
        <label>Org ID: <input value={orgId} onChange={e=>setOrgId(e.target.value)} placeholder="optional" /></label>
        <button onClick={load} disabled={loading} style={{ marginLeft: 8 }}>Reload</button>
      </div>
      {err ? <div style={{ color:'red' }}>{err}</div> : null}
      <form onSubmit={onCreate} style={{ border:'1px solid #ccc', padding: 12, marginBottom: 16 }}>
        <h3>{editId ? `Edit Profile #${editId}` : 'Create Profile'}</h3>
        <div>
          <input placeholder="Name" value={form.name} onChange={e=>setForm({ ...form, name:e.target.value })} required />
          <input placeholder="Host" value={form.host} onChange={e=>setForm({ ...form, host:e.target.value })} required style={{ marginLeft: 8 }} />
          <input placeholder="Port" type="number" value={form.port} onChange={e=>setForm({ ...form, port:Number(e.target.value||3306) })} style={{ width: 90, marginLeft: 8 }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <input placeholder="Database" value={form.database} onChange={e=>setForm({ ...form, database:e.target.value })} required />
          <input placeholder="DB User" value={form.db_user} onChange={e=>setForm({ ...form, db_user:e.target.value })} required style={{ marginLeft: 8 }} />
          <input placeholder="DB Password" value={form.db_password} onChange={e=>setForm({ ...form, db_password:e.target.value })} style={{ marginLeft: 8 }} type="text" />
        </div>
        <div style={{ marginTop: 8 }}>
          <input placeholder="Table prefixes (comma separated), e.g. ps_, mod_" value={form.table_prefixes} onChange={e=>setForm({ ...form, table_prefixes:e.target.value })} style={{ width: '100%' }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <label><input type="checkbox" checked={form.ssl} onChange={e=>setForm({ ...form, ssl:e.target.checked })} /> SSL</label>
          <button type="submit" disabled={loading} style={{ marginLeft: 12 }}>{editId ? 'Save Changes' : 'Create'}</button>
          <button type="button" onClick={onTestForm} disabled={loading} style={{ marginLeft: 8 }}>Test connection</button>
          {formTest ? (
            <span style={{ marginLeft: 8, color: formTest.ok ? 'green' : 'red' }}>
              {formTest.message}
            </span>
          ) : null}
          {editId ? <button type="button" onClick={onCancelEdit} disabled={loading} style={{ marginLeft: 8 }}>Cancel</button> : null}
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
                  <span style={{ marginLeft: 8, color: tests[it.id].ok ? 'green' : 'red' }}>
                    {tests[it.id].message}
                  </span>
                ) : null}
                <button onClick={()=>onEdit(it)} disabled={loading} style={{ marginLeft: 8 }}>Edit</button>
                <button onClick={()=>onDelete(it.id)} disabled={loading} style={{ marginLeft: 8 }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editId ? (
        <div style={{ marginTop: 16, border:'1px solid #ccc', padding: 12 }}>
          <h3>Prompt‑assisted setup</h3>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8, flexWrap:'wrap' }}>
            <label>Prompt:</label>
            <select value={selectedPromptId} onChange={e=>setSelectedPromptId(e.target.value)}>
              {(promptConfigs||[]).map(p => (
                <option key={p.id} value={p.id}>{p.name || p.id}</option>
              ))}
              {(!promptConfigs || !promptConfigs.length) ? (<option value="">No prompts</option>) : null}
            </select>
            <label>DB flavor:</label>
            <input placeholder="e.g. prestashop8" value={dbFlavor} onChange={e=>setDbFlavor(e.target.value)} style={{ width:180 }} />
            <button type="button" disabled={!selectedPromptId || genBusy} onClick={onGenerateFromPrompt}>
              {genBusy ? 'Generating…' : 'Create Tools with Prompt'}
            </button>
            {genMsg ? (<span style={{ marginLeft:8, color: /^Error/.test(genMsg)? 'red':'green' }}>{genMsg}</span>) : null}
          </div>
          <div style={{ color:'#666' }}>The selected Automation Suite prompt will be run with the profile context and its JSON output will be applied to Tools, Resources and Resource Templates.</div>
        </div>
      ) : null}

      {editId ? (
        <div style={{ marginTop: 16, border:'1px solid #ccc', padding: 12 }}>
          <h3>Tools for profile #{editId}</h3>
          <div style={{ display:'flex', gap:8, marginBottom:8, alignItems:'flex-start' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:6, flex:1 }}>
              <input placeholder="Tool name" value={toolForm.name} onChange={e=>setToolForm({ ...toolForm, name:e.target.value })} />
              <input placeholder="Description" value={toolForm.description} onChange={e=>setToolForm({ ...toolForm, description:e.target.value })} />
              <textarea placeholder="Config (JSON)" value={toolForm.config} onChange={e=>setToolForm({ ...toolForm, config:e.target.value })} rows={5} style={{ width:'100%', fontFamily:'monospace' }} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <button type="button" onClick={onAddTool} disabled={!toolForm.name.trim()}>Add / Update</button>
              <button type="button" disabled={!selectedPromptId || !toolForm.name.trim() || toolDesignBusy} onClick={async()=>{
                try {
                  if (!editId) return; setToolDesignBusy(true);
                  const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
                  const r = await api(`/api/db-mysql/profiles/${editId}/tools/${encodeURIComponent(toolForm.name)}/generate-from-prompt${q}`, { method:'POST', body: JSON.stringify({ prompt_config_id: selectedPromptId, context: { db_flavor: dbFlavor } }) });
                  const t = r?.tool || {};
                  setToolForm({ name: t.name || toolForm.name, description: t.description || '', config: JSON.stringify(t.config || {}, null, 2) });
                } catch (e) { alert(String(e.message||e)); }
                finally { setToolDesignBusy(false); }
              }}>{toolDesignBusy? 'Designing…' : 'Design with Prompt'}</button>
            </div>
          </div>
          <table border="1" cellPadding="6" style={{ borderCollapse:'collapse', width:'100%' }}>
            <thead><tr><th>Name</th><th>Description</th><th style={{width:'55%'}}>Config</th><th>Actions</th></tr></thead>
            <tbody>
              {(tools||[]).map(t => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td>{t.description || ''}</td>
                  <td>
                    {openTool[t.name] ? (
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        <textarea
                          value={editBuf[t.name] ?? JSON.stringify(t.config || {}, null, 2)}
                          onChange={e=>setEditBuf(prev => ({ ...prev, [t.name]: e.target.value }))}
                          rows={8}
                          style={{ width:'100%', fontFamily:'monospace' }}
                        />
                        {editErr[t.name] ? (<div style={{ color:'red' }}>{editErr[t.name]}</div>) : null}
                        <div>
                          <button
                            disabled={!!editBusy[t.name]}
                            onClick={async()=>{
                              setEditErr(prev=>({ ...prev, [t.name]: '' }));
                              setEditBusy(prev=>({ ...prev, [t.name]: true }));
                              try {
                                const raw = (editBuf[t.name] ?? JSON.stringify(t.config || {}, null, 2)).trim();
                                let parsed = {};
                                try { parsed = raw ? JSON.parse(raw) : {}; } catch (e) { setEditErr(prev=>({ ...prev, [t.name]: 'Invalid JSON: ' + (e?.message || String(e)) })); return; }
                                const body = { name: t.name, description: t.description || '', config: parsed };
                                const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
                                const r = await api(`/api/db-mysql/profiles/${editId}/tools${q}`, { method:'POST', body: JSON.stringify(body) });
                                setTools(Array.isArray(r?.items) ? r.items : tools);
                                setOpenTool(prev=>({ ...prev, [t.name]: false }));
                              } catch (e) {
                                setEditErr(prev=>({ ...prev, [t.name]: String(e?.message || e) }));
                              } finally {
                                setEditBusy(prev=>({ ...prev, [t.name]: false }));
                              }
                            }}
                          >{editBusy[t.name] ? 'Saving…' : 'Save'}</button>
                          <button style={{ marginLeft:8 }} onClick={()=>{ setOpenTool(prev=>({ ...prev, [t.name]: false })); setEditErr(prev=>({ ...prev, [t.name]: '' })); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontFamily:'monospace', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                          {summarizeConfig(t.config || {}, 6)}
                        </div>
                        <button style={{ marginTop:6 }} onClick={()=>{ setOpenTool(prev=>({ ...prev, [t.name]: true })); setEditBuf(prev=>({ ...prev, [t.name]: JSON.stringify(t.config || {}, null, 2) })); }}>Expand</button>
                      </div>
                    )}
                  </td>
                  <td style={{ display:'flex', gap:6 }}>
                    <button onClick={()=>{ try { setToolForm({ name: t.name, description: t.description || '', config: JSON.stringify(t.config || {}, null, 2) }); } catch { setToolForm({ name: t.name, description: t.description || '', config: '{}' }); } }}>Edit form</button>
                    <button onClick={async()=>{ const json = JSON.stringify({ name: t.name, description: t.description || '', config: t.config || {} }, null, 2); await copyToClipboard(json); }}>Copy JSON</button>
                    <button onClick={()=>onDeleteTool(t.name)}>Delete</button>
                  </td>
                </tr>
              ))}
              {(!tools || !tools.length) ? (<tr><td colSpan={4} style={{ color:'#666' }}>No tools</td></tr>) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {editId ? (
        <div style={{ marginTop: 16, border:'1px solid #ccc', padding: 12 }}>
          <h3>Resources for profile #{editId}</h3>
          <div style={{ display:'flex', gap:8, marginBottom:8 }}>
            <input placeholder="URI" value={resourceForm.uri} onChange={e=>setResourceForm({ ...resourceForm, uri:e.target.value })} />
            <input placeholder="Name (optional)" value={resourceForm.name} onChange={e=>setResourceForm({ ...resourceForm, name:e.target.value })} />
            <input placeholder="Description" value={resourceForm.description} onChange={e=>setResourceForm({ ...resourceForm, description:e.target.value })} style={{ flex:1 }} />
            <input placeholder="mimeType" value={resourceForm.mimeType} onChange={e=>setResourceForm({ ...resourceForm, mimeType:e.target.value })} style={{ width:160 }} />
            <button type="button" onClick={onAddResource} disabled={!resourceForm.uri.trim()}>Add / Update</button>
          </div>
          <table border="1" cellPadding="6" style={{ borderCollapse:'collapse', width:'100%' }}>
            <thead><tr><th>URI</th><th>Name</th><th>Description</th><th>mimeType</th><th>Actions</th></tr></thead>
            <tbody>
              {(resources||[]).map(r => (
                <tr key={r.uri}>
                  <td className="font-mono">{r.uri}</td>
                  <td>{r.name||''}</td>
                  <td>{r.description||''}</td>
                  <td>{r.mimeType||''}</td>
                  <td><button onClick={()=>onDeleteResource(r.uri)}>Delete</button></td>
                </tr>
              ))}
              {(!resources || !resources.length) ? (<tr><td colSpan={5} style={{ color:'#666' }}>No resources</td></tr>) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {editId ? (
        <div style={{ marginTop: 16, border:'1px solid #ccc', padding: 12 }}>
          <h3>Resource Templates for profile #{editId}</h3>
          <div style={{ display:'flex', gap:8, marginBottom:8 }}>
            <input placeholder="Name" value={templateForm.name} onChange={e=>setTemplateForm({ ...templateForm, name:e.target.value })} />
            <input placeholder="Description" value={templateForm.description} onChange={e=>setTemplateForm({ ...templateForm, description:e.target.value })} />
            <input placeholder="inputSchema (JSON)" value={templateForm.inputSchema} onChange={e=>setTemplateForm({ ...templateForm, inputSchema:e.target.value })} style={{ flex:1 }} />
            <button type="button" onClick={onAddTemplate} disabled={!templateForm.name.trim()}>Add / Update</button>
          </div>
          <table border="1" cellPadding="6" style={{ borderCollapse:'collapse', width:'100%' }}>
            <thead><tr><th>Name</th><th>Description</th><th>inputSchema</th><th>Actions</th></tr></thead>
            <tbody>
              {(templates||[]).map(t => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td>{t.description||''}</td>
                  <td><pre style={{ margin:0, whiteSpace:'pre-wrap' }}>{JSON.stringify(t.inputSchema||{}, null, 2)}</pre></td>
                  <td><button onClick={()=>onDeleteTemplate(t.name)}>Delete</button></td>
                </tr>
              ))}
              {(!templates || !templates.length) ? (<tr><td colSpan={4} style={{ color:'#666' }}>No resource templates</td></tr>) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
