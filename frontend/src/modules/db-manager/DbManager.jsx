import React, { useEffect, useMemo, useState } from "react";
import { loadModuleState, saveModuleState } from "@app-lib/uiState";
import DOMPurify from 'dompurify';
function Subnav({ subTab, setSubTab }) {
  const Item = ({ id, label, icon }) => (
    <button
      onClick={() => setSubTab(id)}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors
        ${subTab === id ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-gray-50'}`}
    >
      <span className="text-base w-5 text-center" aria-hidden>{icon}</span>
      <span className="text-sm">{label}</span>
    </button>
  );
  return (
    <aside className="w-64 border-r bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">DB Manager</div>
      <nav className="space-y-1">
        <Item id="connection" label="DB connection set-up" icon="🔌" />
        <Item id="views" label="View Manager" icon="👁️" />
        <Item id="mydb" label="My DB" icon="📘" />
      </nav>
    </aside>
  );
}
function ConnectionSetup() {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwLoaded, setPwLoaded] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const [form, setForm] = useState({
    dialect: 'mysql',
    host: '',
    port: '3306',
    database: '',
    user: '',
    password: '',
    ssl: false,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      setLoading(true); setErr(''); setMsg('');
      try {
        const rp = await fetch('/api/db-manager/profiles', { credentials:'include' });
        if (rp.ok) {
          const pj = await rp.json().catch(()=>({}));
          const items = Array.isArray(pj.items) ? pj.items : [];
          setProfiles(items);
          setActiveId(pj.active_id || (items.find(x=>x.is_default)?.id ?? null));
          // Do not auto-select any saved profile; user will pick one to edit
          setSelectedId(null);
          setProfileName('');
        }
        // Fallback to legacy single config
        const r = await fetch('/api/db-manager/config', { credentials:'include' });
        const j = await r.json().catch(()=>({}));
        if (r.ok && j && (j.ok == null || j.ok === true)) {
          const cfg = j.config || j;
          setForm((f)=>({ ...f, ...cfg }));
        }
      } catch (e) { setErr(String(e?.message || e)); }
      finally { setLoading(false); }
    })();
  }, []);

  const refreshProfiles = async () => {
    try {
      const rp = await fetch('/api/db-manager/profiles', { credentials: 'include' });
      if (!rp.ok) return;
      const pj = await rp.json().catch(()=>({}));
      setProfiles(Array.isArray(pj.items)?pj.items:[]);
      setActiveId(pj.active_id || null);
    } catch {}
  };

  const fetchPassword = async () => {
    if (!selectedId) return;
    try {
      const r = await fetch(`/api/db-manager/profiles/${selectedId}`, { credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || (j && j.ok === false)) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
      const pw = j?.item?.password || '';
      setForm((f)=>({ ...f, password: String(pw||'') }));
      setPwLoaded(true);
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const save = async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      const payload = { name: profileName || 'default', ...form, port: Number(form.port||3306), is_default: !!makeDefault };
      let r;
      if (selectedId) {
        r = await fetch(`/api/db-manager/profiles/${selectedId}`, { method:'PATCH', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload) });
      } else {
        r = await fetch('/api/db-manager/profiles', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(payload) });
      }
      const j = await r.json().catch(()=>({}));
      if (!r.ok || (j && j.ok === false)) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
      if (j && j.id && !selectedId) setSelectedId(j.id);
      await refreshProfiles();
      setMsg('Profile saved');
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setSaving(false); }
  };
  const test = async () => {
    setTesting(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/db-manager/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials:'include',
        body: JSON.stringify({ ...form, port: Number(form.port||3306), profile_id: selectedId || undefined }),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || (j && j.ok === false)) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
      setMsg(j?.message || 'Connection OK');
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setTesting(false); }
  };
  return (
    <div className="flex-1 min-h-0 p-4 space-y-4">
      <div className="text-sm text-gray-500">Manage MySQL/MariaDB connection profiles used for view discovery and management.</div>
      {err && <div className="px-3 py-2 rounded border border-red-200 bg-red-50 text-sm text-red-700">{err}</div>}
      {msg && <div className="px-3 py-2 rounded border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">{msg}</div>}

      <div className="border rounded bg-white overflow-hidden">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <div className="text-sm font-medium">Saved connections</div>
          <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={refreshProfiles} disabled={loading}>{loading?'…':'Refresh'}</button>
        </div>
        <div className="divide-y">
          {profiles.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-500">No saved connections yet.</div>
          )}
          {profiles.map((p) => (
            <div key={p.id} className="px-3 py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-xs text-gray-500 truncate">{p.dialect || 'mysql'} · {p.host}:{p.port} · {p.database} · {p.user}</div>
              </div>
              <div className="flex items-center gap-2">
                <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={() => {
                  setSelectedId(p.id);
                  setProfileName(p.name || '');
                  // Do not load the password back into the form; leave blank to keep existing on save
                  setForm({ dialect:p.dialect||'mysql', host:p.host||'', port:String(p.port||'3306'), database:p.database||'', user:p.user||'', password:'', ssl:!!p.ssl });
                }}>Edit</button>
                <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async () => {
                  if (!confirm('Delete this profile?')) return;
                  try {
                    const r = await fetch(`/api/db-manager/profiles/${p.id}`, { method: 'DELETE', credentials: 'include' });
                    const j = await r.json().catch(()=>({}));
                    if (!r.ok || (j && j.ok === false)) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
                    if (selectedId === p.id) { setSelectedId(null); setProfileName(''); }
                    await refreshProfiles();
                  } catch (e) { setErr(String(e?.message || e)); }
                }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
        <div className="md:col-span-2">
          <div className="text-xs text-gray-600 mb-1">Selected profile</div>
          <select className="w-full border rounded px-3 py-2" value={selectedId || ''}
            onChange={(e)=>{
              const id = e.target.value ? Number(e.target.value) : null;
              setSelectedId(id);
              const p = profiles.find(x=>x.id===id);
              if (p) {
                setProfileName(p.name||'');
                setForm({ dialect:p.dialect||'mysql', host:p.host||'', port:String(p.port||'3306'), database:p.database||'', user:p.user||'', password:p.password||'', ssl:!!p.ssl });
              } else {
                setProfileName('');
                setForm({ dialect:'mysql', host:'', port:'3306', database:'', user:'', password:'', ssl:false });
              }
            }}
          >
            <option value="">(new profile)</option>
            {profiles.map(p=> (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <div className="text-xs text-gray-600 mb-1">Profile name</div>
          <input className="w-full border rounded px-3 py-2" value={profileName} onChange={(e)=>setProfileName(e.target.value)} placeholder="default" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-gray-700 flex items-center gap-2 select-none">
            <input type="checkbox" checked={makeDefault} onChange={(e)=>setMakeDefault(e.target.checked)} /> Set as active on save
          </label>
        </div>
        <div>
          <div className="text-xs text-gray-600 mb-1">Dialect</div>
          <select className="w-full border rounded px-3 py-2" value={form.dialect}
            onChange={(e)=>setForm({ ...form, dialect:e.target.value })}
          >
            <option value="mysql">MySQL / MariaDB</option>
            <option value="postgres">PostgreSQL</option>
          </select>
        </div>
        <div>
          <div className="text-xs text-gray-600 mb-1">Host</div>
          <input className="w-full border rounded px-3 py-2" value={form.host}
            onChange={(e)=>setForm({ ...form, host:e.target.value })} placeholder="localhost" />
        </div>
        <div>
          <div className="text-xs text-gray-600 mb-1">Port</div>
          <input className="w-full border rounded px-3 py-2" value={form.port}
            onChange={(e)=>setForm({ ...form, port:e.target.value })} placeholder="3306" />
        </div>
        <div>
          <div className="text-xs text-gray-600 mb-1">Database</div>
          <input className="w-full border rounded px-3 py-2" value={form.database}
            onChange={(e)=>setForm({ ...form, database:e.target.value })} placeholder="mydb" />
        </div>
        <div>
          <div className="text-xs text-gray-600 mb-1">User</div>
          <input className="w-full border rounded px-3 py-2" value={form.user}
            onChange={(e)=>setForm({ ...form, user:e.target.value })} placeholder="dbuser" />
        </div>
        <div>
          <div className="text-xs text-gray-600 mb-1 flex items-center justify-between">
            <span>Password</span>
            <button type="button" className="text-[11px] text-blue-600 hover:underline"
              onClick={async ()=>{ if (selectedId && !pwLoaded && !showPw) { await fetchPassword(); } setShowPw(v=>!v); }}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <input type={showPw ? 'text' : 'password'} className="w-full border rounded px-3 py-2" value={form.password}
            onChange={(e)=>setForm({ ...form, password:e.target.value })} placeholder="••••••" />
        </div>
        <div className="flex items-center gap-2">
          <input id="ssl" type="checkbox" checked={!!form.ssl} onChange={(e)=>setForm({ ...form, ssl:e.target.checked })} />
          <label htmlFor="ssl" className="text-sm text-gray-700 select-none">Use SSL</label>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" onClick={save} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="text-xs px-3 py-1.5 rounded border bg-white hover:bg-gray-50" onClick={test} disabled={testing || loading}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
      </div>
    </div>
  );
}
function MyDb() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [options, setOptions] = useState({ tables: true, columns: true, foreignKeys: true, views: false, data: false, allData: false, sampleRows: '5', sampleTables: '10', maxDataBytes: '120000' });
  const [prompts, setPrompts] = useState([]);
  const [promptId, setPromptId] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    (async () => {
      setLoading(true); setErr('');
      try {
        const r = await fetch('/api/db-manager/config', { credentials:'include' });
        const j = await r.json().catch(()=>({}));
        if (r.ok && (j.ok==null || j.ok===true)) setCfg(j.config || j);
        const r2 = await fetch('/api/prompt-configs', { credentials:'include' });
        const j2 = await r2.json().catch(()=>({}));
        if (r2.ok && j2?.ok && Array.isArray(j2.items)) setPrompts(j2.items);
      } catch (e) { setErr(String(e?.message || e)); }
      finally { setLoading(false); }
    })();
  }, []);
  const generate = async () => {
    setGenBusy(true); setErr(''); setMsg('');
    try {
      const r = await fetch('/api/db-manager/ai/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(options),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || (j && j.ok===false)) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
      setContent(j.content || '');
      setFilename(j.filename || 'mydb-summary.md');
      setMsg('Summary generated');
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setGenBusy(false); }
  };
  const uploadToPrompt = async () => {
    if (!content || !promptId) return;
    setUploadBusy(true); setErr(''); setMsg('');
    try {
      const b64 = typeof window !== 'undefined' ? btoa(unescape(encodeURIComponent(content))) : Buffer.from(content,'utf8').toString('base64');
      const r = await fetch(`/api/prompt-configs/${encodeURIComponent(promptId)}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content_b64: b64, filename: filename || 'mydb-summary.md' }),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || (j && j.ok===false)) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
      setMsg('Uploaded to vector store');
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setUploadBusy(false); }
  };
  const dlHref = filename ? `/api/db-manager/ai/summary/${encodeURIComponent(filename)}` : '';
  const saveToAppFiles = async () => {
    if (!content) return;
    setSaveBusy(true); setErr(''); setMsg('');
    try {
      const b64 = typeof window !== 'undefined' ? btoa(unescape(encodeURIComponent(content))) : Buffer.from(content,'utf8').toString('base64');
      const body = {
        filename: filename || `mydb-summary-${(cfg?.database||'db')}.md`,
        content_b64: b64,
        title: `DB Summary: ${(cfg?.database||'database')}`,
        description: `Generated from DB Manager → My DB on ${new Date().toISOString()}`,
      };
      const r = await fetch('/api/app-files', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || (j && j.ok===false)) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
      setMsg('Saved to Files in app');
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setSaveBusy(false); }
  };
  return (
    <div className="flex-1 min-h-0 p-4 space-y-4">
      <div className="text-sm text-gray-500">Generate a compact schema summary file to help AI understand your database. For large DBs, this uses metadata only (no row scans).</div>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {err && <div className="px-3 py-2 rounded border border-red-200 bg-red-50 text-sm text-red-700">{err}</div>}
      {msg && <div className="px-3 py-2 rounded border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">{msg}</div>}
      {!cfg && !loading && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">DB Manager is not configured yet. Set up the connection first.</div>
      )}
      <div className="border rounded bg-white">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <div className="text-sm font-medium">Summary Options</div>
          <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" onClick={generate} disabled={!cfg || genBusy}>{genBusy ? 'Generating…' : 'Generate summary'}</button>
        </div>
        <div className="p-3 grid grid-cols-2 gap-3 max-w-2xl">
          <label className="text-sm text-gray-700 flex items-center gap-2 select-none"><input type="checkbox" checked={options.tables} onChange={(e)=>setOptions({...options, tables: e.target.checked})} /> Tables</label>
          <label className="text-sm text-gray-700 flex items-center gap-2 select-none"><input type="checkbox" checked={options.columns} onChange={(e)=>setOptions({...options, columns: e.target.checked})} /> Columns</label>
          <label className="text-sm text-gray-700 flex items-center gap-2 select-none"><input type="checkbox" checked={options.foreignKeys} onChange={(e)=>setOptions({...options, foreignKeys: e.target.checked})} /> Foreign keys</label>
          <label className="text-sm text-gray-700 flex items-center gap-2 select-none"><input type="checkbox" checked={options.views} onChange={(e)=>setOptions({...options, views: e.target.checked})} /> Include view definitions</label>
          <label className="text-sm text-gray-700 flex items-center gap-2 select-none"><input type="checkbox" checked={options.data} onChange={(e)=>setOptions({...options, data: e.target.checked, allData: e.target.checked ? options.allData : false})} /> Include sample data</label>
          <label className="text-sm text-gray-700 flex items-center gap-2 select-none"><input type="checkbox" checked={options.allData} onChange={(e)=>setOptions({...options, allData: e.target.checked, data: e.target.checked || options.data})} /> All data (best effort, capped)</label>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <span>Rows per table</span>
            <input className="w-20 border rounded px-2 py-1" type="number" min={1} max={options.allData?1000000:50} value={options.sampleRows} onChange={(e)=>setOptions({...options, sampleRows: e.target.value})} disabled={options.allData} />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <span>Max tables</span>
            <input className="w-20 border rounded px-2 py-1" type="number" min={1} max={options.allData?100000:200} value={options.sampleTables} onChange={(e)=>setOptions({...options, sampleTables: e.target.value})} disabled={options.allData} />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-700 col-span-2">
            <span>Max data bytes</span>
            <input
              className="w-40 border rounded px-2 py-1"
              type="number"
              min={1000}
              max={20000000}
              step={1000}
              value={options.maxDataBytes}
              onChange={(e)=>setOptions({...options, maxDataBytes: e.target.value})}
              placeholder="120000"
            />
            <span className="text-xs text-gray-500">Raise to avoid truncation (server clamps 1k–20M).</span>
          </div>
          <div className="col-span-2 text-xs text-gray-500">Note: “All data” attempts to include as much as possible but remains capped by server safety limits. For large DBs, prefer curated views.</div>
        </div>
      </div>
      {content && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">{filename}</div>
            <div className="flex items-center gap-2">
              {dlHref && <a href={dlHref} className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" target="_blank" rel="noreferrer">Download</a>}
              <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={() => { try { navigator.clipboard.writeText(content); setMsg('Copied to clipboard'); } catch {} }}>Copy</button>
              <button className="text-xs px-2 py-1 rounded bg-white border hover:bg-gray-50 disabled:opacity-60" onClick={saveToAppFiles} disabled={!content || saveBusy}>{saveBusy ? 'Saving…' : 'Save to App Files'}</button>
            </div>
          </div>
          <textarea className="sql-editor" rows={16} value={content} onChange={()=>{}} readOnly />
          <div className="border rounded bg-white">
            <div className="px-3 py-2 border-b text-sm font-medium">Upload to Prompt’s Vector Store</div>
            <div className="p-3 flex items-center gap-3">
              <select className="border rounded px-2 py-1 text-sm" value={promptId} onChange={(e)=>setPromptId(e.target.value)}>
                <option value="">Select a prompt…</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name || p.id}</option>
                ))}
              </select>
              <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" onClick={uploadToPrompt} disabled={!promptId || !content || uploadBusy}>{uploadBusy ? 'Uploading…' : 'Upload'}</button>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Tips for large databases: focus on schema, not data; create views for the most relevant slices; and keep each summary scoped (per domain/module) for best retrieval quality.
          </div>
        </div>
      )}
    </div>
  );
}
function ViewManager() {
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [viewProfileId, setViewProfileId] = useState(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null); // {schema,name,definition}
  const [favSet, setFavSet] = useState(() => new Set());
  const [favOnly, setFavOnly] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [friendly, setFriendly] = useState(true);
  const [hl, setHl] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editorText, setEditorText] = useState('');
  const [editorName, setEditorName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [friendlyEdit, setFriendlyEdit] = useState(true);
  const [runLimit, setRunLimit] = useState(100);
  const [runRows, setRunRows] = useState([]);
  const [runCols, setRunCols] = useState([]);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState('');
  const [histItems, setHistItems] = useState([]);
  const [histBusyId, setHistBusyId] = useState(null);
  const [prevOpen, setPrevOpen] = useState(false);
  const [prevBusy, setPrevBusy] = useState(false);
  const [prevErr, setPrevErr] = useState('');
  const [prevChange, setPrevChange] = useState(null);
  const [prevWhich, setPrevWhich] = useState('after');
  const loadProfiles = async () => {
    try {
      const rp = await fetch('/api/db-manager/profiles', { credentials:'include' });
      if (rp.ok) {
        const pj = await rp.json().catch(()=>({}));
        setProfiles(Array.isArray(pj.items) ? pj.items : []);
      }
      const rs = await fetch('/api/db-manager/views/profile', { credentials:'include' });
      const sj = await rs.json().catch(()=>({}));
      if (rs.ok && (sj?.ok == null || sj?.ok === true)) {
        const pid = (sj.profile_id != null) ? Number(sj.profile_id) : null;
        setViewProfileId(Number.isFinite(pid) ? pid : null);
      }
    } catch {}
  };
  useEffect(()=>{ loadProfiles(); }, []);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/db-manager/views', { credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || (j && j.ok === false)) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
      const list = Array.isArray(j.views) ? j.views : (Array.isArray(j) ? j : []);
      setViews(list);
      if (!selected && list.length) setSelected(list[0]);
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };
  useEffect(()=>{ load(); }, []);
  const setSelectedProfile = async (id) => {
    try {
      const r = await fetch('/api/db-manager/views/profile', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ profile_id: id || null }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || (j && j.ok === false)) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
      setViewProfileId(id || null);
      await load();
    } catch (e) { setError(String(e?.message || e)); }
  };
  const favKey = (v) => `${v.schema || 'public'}.${v.name}`;
  const loadFavs = async () => {
    try {
      const r = await fetch('/api/db-manager/favorites', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok && Array.isArray(j.items)) setFavSet(new Set(j.items));
    } catch {}
  };
  useEffect(()=>{ loadFavs(); }, []);
  const toggleFav = async (v) => {
    const key = favKey(v);
    setFavSet(prev => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
    try {
      await fetch('/api/db-manager/favorites', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ action:'toggle', key }) });
    } catch {}
  };
  // Auto-select a favorite if none selected, else first item
  useEffect(() => {
    if (!Array.isArray(views) || !views.length) return;
    if (selected && views.some(it => it.schema===selected.schema && it.name===selected.name)) return;
    const pick = views.find(it => favSet.has(favKey(it))) || views[0];
    setSelected(pick);
  }, [views, favSet]);
  const filtered = useMemo(() => {
    const v = (q||'').trim().toLowerCase();
    const base = Array.isArray(views) ? views : [];
    let rows = base;
    if (favOnly) rows = rows.filter(it => favSet.has(favKey(it)));
    // Text filter
    if (v) rows = rows.filter((it) => {
      const n = `${it.schema || ''}.${it.name || ''}`.toLowerCase();
      return n.includes(v);
    });
    // Sort: favorites first, then by schema.name
    const sorted = rows.slice().sort((a,b) => {
      const af = favSet.has(favKey(a));
      const bf = favSet.has(favKey(b));
      if (af !== bf) return af ? -1 : 1;
      const an = `${a.schema || ''}.${a.name || ''}`;
      const bn = `${b.schema || ''}.${b.name || ''}`;
      return an.localeCompare(bn);
    });
    return sorted;
  }, [q, views, favOnly, favSet]);
  useEffect(() => {
    try {
      const has = filtered.some(it => selected && it.schema===selected.schema && it.name===selected.name);
      if (!has && filtered.length) setSelected(filtered[0]);
    } catch {}
  }, [favOnly, q, JSON.stringify(filtered)]);
  // --- SQL formatting + highlighting (lightweight) ---
  const escapeHtml = (s='') => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const simplifySqlNames = (sql = '') => {
    if (!sql) return '';
    let s = String(sql);
    // Collapse fully-qualified columns to their alias or column name
    s = s.replace(/`[^`]+`\.`[^`]+`\.`([^`]+)`\s*(?:AS\s*`([^`]+)`)?/gi, (_m, col, al) => {
      const name = (al && al.trim()) ? al : col;
      return '`' + name + '`';
    });
    // Collapse fully-qualified tables to table name
    s = s.replace(/`[^`]+`\.`([^`]+)`/g, (_m, t) => '`' + t + '`');
    // Normalize AS spacing
    s = s.replace(/\s+AS\s+/gi, ' AS ');
    // Optionally strip backticks to make it cleaner (safe for typical identifiers)
    s = s.replace(/`([^`]+)`/g, '$1');
    return s;
  };
  const formatSqlLight = (sql = '') => {
    if (!sql) return '';
    // Mask string literals and identifiers to avoid breaking them during formatting
    const masks = [];
    let out = '';
    let mode = 'plain';
    let buf = '';
    let esc = false;
    const pushMask = (text, kind) => {
      const id = `__MASK_${masks.length}__`;
      masks.push({ id, text, kind });
      return id;
    };
    for (let i=0;i<sql.length;i++) {
      const ch = sql[i];
      if (mode === 'plain') {
        if (ch === "'" || ch === '"' || ch === '`') {
          if (buf) { out += buf; buf = ''; }
          mode = ch === '`' ? 'bt' : (ch === '"' ? 'dq' : 'sq');
          buf = ch;
          esc = false;
        } else {
          buf += ch;
        }
      } else if (mode === 'sq') {
        buf += ch;
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === "'") { out += pushMask(buf, 'str'); buf=''; mode='plain'; }
      } else if (mode === 'dq') {
        buf += ch;
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { out += pushMask(buf, 'str'); buf=''; mode='plain'; }
      } else if (mode === 'bt') {
        buf += ch;
        if (ch === '`') { out += pushMask(buf, 'ident'); buf=''; mode='plain'; }
      }
    }
    if (buf) out += buf;
    let s = out;
    // Normalize whitespace
    s = s.replace(/\s+/g, ' ');
    // New lines before key clauses
    const breaks = ['FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'UNION ALL', 'UNION'];
    for (const kw of breaks) {
      const re = new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`, 'gi');
      s = s.replace(re, m => `\n${m.toUpperCase()}`);
    }
    // Put columns on their own lines after SELECT
    s = s.replace(/\bSELECT\b\s*/i, 'SELECT\n  ');
    // Break JOINs
    s = s.replace(/\b((?:LEFT|RIGHT|INNER|OUTER|CROSS)\s+)?JOIN\b/gi, m => `\n${m.toUpperCase()}`);
    // Break ON / AND / OR
    s = s.replace(/\b(ON|AND|OR)\b/gi, (m) => `\n  ${m.toUpperCase()}`);
    // Commas to new lines in select lists
    s = s.replace(/,\s*/g, ',\n  ');
    // Restore masks
    for (const { id, text } of masks) {
      s = s.split(id).join(text);
    }
    return s.trim();
  };
  const highlightSqlLight = (sql = '') => {
    if (!sql) return '';
    // token-aware masking again for strings/backticks so we can wrap them distinctly
    const parts = [];
    let mode = 'plain'; let buf=''; let esc=false;
    const flushPlain = () => {
      if (!buf) return; let t = escapeHtml(buf);
      // keywords
      const KW = [
        'SELECT','FROM','WHERE','AND','OR','JOIN','LEFT','RIGHT','INNER','OUTER','CROSS','ON','GROUP','BY','ORDER','LIMIT','HAVING','UNION','ALL','AS','CASE','WHEN','THEN','ELSE','END','DISTINCT','CREATE','VIEW','OR','REPLACE','WITH'
      ];
      const kwRe = new RegExp(`\\b(${KW.join('|')})\\b`, 'gi');
      t = t.replace(kwRe, (m)=>`<span class="sql-kw">${m.toUpperCase()}</span>`);
      // numbers
      t = t.replace(/\b\d+(?:\.\d+)?\b/g, (m)=>`<span class="sql-num">${m}</span>`);
      // operators
      t = t.replace(/([=<>!*]+|\bIN\b|\bIS\b|\bNOT\b|\bNULL\b)/gi, (m)=>`<span class="sql-op">${m}</span>`);
      parts.push(t); buf='';
    };
    for (let i=0;i<sql.length;i++) {
      const ch = sql[i];
      if (mode === 'plain') {
        if (ch === "'" || ch === '"' || ch === '`') {
          flushPlain(); mode = ch === '`' ? 'bt' : (ch === '"' ? 'dq' : 'sq'); buf = ch; esc=false;
        } else { buf += ch; }
      } else if (mode === 'sq') {
        buf += ch; if (esc) { esc=false; continue; } if (ch === '\\') { esc=true; continue; } if (ch === "'") { parts.push(`<span class="sql-str">${escapeHtml(buf)}</span>`); buf=''; mode='plain'; }
      } else if (mode === 'dq') {
        buf += ch; if (esc) { esc=false; continue; } if (ch === '\\') { esc=true; continue; } if (ch === '"') { parts.push(`<span class="sql-str">${escapeHtml(buf)}</span>`); buf=''; mode='plain'; }
      } else if (mode === 'bt') {
        buf += ch; if (ch === '`') { parts.push(`<span class="sql-ident">${escapeHtml(buf)}</span>`); buf=''; mode='plain'; }
      }
    }
    flushPlain();
    const html = parts.join('');
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  };
  const prettyText = useMemo(() => {
    try {
      const base = String(selected?.definition || '');
      const src = friendly ? simplifySqlNames(base) : base;
      return formatSqlLight(src);
    } catch { return ''; }
  }, [selected?.definition, friendly]);
  const formattedHtml = useMemo(() => {
    if (!hl) return '';
    try { return highlightSqlLight(prettyText); } catch { return ''; }
  }, [prettyText, hl]);
  const beginCreate = () => {
    const raw = 'SELECT 1 AS sample';
    const pretty = formatSqlLight(friendlyEdit ? simplifySqlNames(raw) : raw);
    setCreating(true); setEditing(true); setEditorName(''); setEditorText(pretty + '\n');
  };
  const beginEdit = async () => {
    if (!selected) return;
    try {
      const r = await fetch(`/api/db-manager/views/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}`, { credentials:'include' });
      const j = await r.json();
      const base = (r.ok && j?.ok) ? String(j.body || selected.definition || '') : String(selected.definition || '');
      const pretty = formatSqlLight(friendlyEdit ? simplifySqlNames(base) : base);
      setEditorText(pretty);
    } catch { setEditorText(String(selected.definition || '')); }
    setEditorName(selected.name);
    setCreating(false);
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setCreating(false); setEditorText(''); setEditorName(''); };
  const save = async () => {
    if (!editorText.trim()) return;
    setSaving(true);
    try {
      if (creating) {
        const name = String(editorName || '').trim();
        if (!name) { alert('Enter a view name'); setSaving(false); return; }
        const r = await fetch('/api/db-manager/views', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ name, body: editorText }) });
        const j = await r.json().catch(()=>({}));
        if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
        await load();
        setSelected({ schema: j.schema, name: j.name, definition: editorText });
      } else if (selected) {
        const r = await fetch(`/api/db-manager/views/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ body: editorText }) });
        const j = await r.json().catch(()=>({}));
        if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
        await load();
      }
      cancelEdit();
    } catch (e) { alert('Save failed: ' + (e?.message || e)); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!selected) return;
    if (!confirm(`Delete view ${selected.schema}.${selected.name} ?`)) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/db-manager/views/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}`, { method:'DELETE', credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
      setSelected(null);
      await load();
    } catch (e) { alert('Delete failed: ' + (e?.message || e)); }
    finally { setDeleting(false); }
  };
  const run = async () => {
    if (!selected) return;
    setRunLoading(true); setRunError(''); setRunRows([]); setRunCols([]);
    try {
      const qs = new URLSearchParams({ limit: String(Math.max(1, Math.min(1000, Number(runLimit)||100))) });
      const r = await fetch(`/api/db-manager/views/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}/run?${qs.toString()}`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
      setRunCols(Array.isArray(j.columns)? j.columns: []);
      setRunRows(Array.isArray(j.rows)? j.rows: []);
    } catch (e) { setRunError(String(e?.message || e)); }
    finally { setRunLoading(false); }
  };
  const loadHistory = async () => {
    if (!selected) return;
    setShowHistory(true); setHistLoading(true); setHistError('');
    try {
      const r = await fetch(`/api/db-manager/views/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}/changes`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
      setHistItems(Array.isArray(j.items)? j.items: []);
    } catch (e) { setHistError(String(e?.message || e)); }
    finally { setHistLoading(false); }
  };
  const previewChange = async (id) => {
    if (!selected || !id) return;
    setPrevBusy(true); setPrevErr(''); setPrevChange(null); setPrevOpen(true);
    try {
      const r = await fetch(`/api/db-manager/views/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}/changes/${encodeURIComponent(id)}`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
      setPrevChange(j.item || {});
      setPrevWhich('after');
    } catch (e) { setPrevErr(String(e?.message || e)); }
    finally { setPrevBusy(false); }
  };
  const loadChangeSql = async (id, which) => {
    if (!selected || !id) return;
    setHistBusyId(id);
    try {
      const r = await fetch(`/api/db-manager/views/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}/changes/${encodeURIComponent(id)}`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
      const item = j.item || {};
      const body = which === 'before' ? (item.body_before || '') : (item.body_after || item.body_before || '');
      // Load the exact snapshot; do not simplify on load
      const pretty = formatSqlLight(body || '');
      setEditorName(selected.name);
      setEditorText(pretty);
      setFriendlyEdit(false);
      setCreating(false);
      setEditing(true);
    } catch (e) {
      alert('Load failed: ' + (e?.message || e));
    } finally {
      setHistBusyId(null);
    }
  };
  return (
    <div className="flex-1 min-h-0 flex">
      <aside className="w-72 border-r bg-white p-3 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Views</div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-700 flex items-center gap-1 select-none"><input type="checkbox" checked={favOnly} onChange={(e)=>setFavOnly(e.target.checked)} /> Favorites</label>
            <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ load(); loadFavs(); }} disabled={loading}>{loading?'…':'Refresh'}</button>
            <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700" onClick={beginCreate}>New</button>
          </div>
        </div>
        <div className="mb-2">
          <div className="text-[11px] text-gray-500 mb-1">Connection</div>
          <select className="w-full border rounded px-2 py-1 text-sm" value={viewProfileId || ''}
            onChange={(e)=>{ const id = e.target.value ? Number(e.target.value) : null; setSelectedProfile(id); }}
          >
            <option value="">(default)</option>
            {profiles.map((p)=> (
              <option key={p.id} value={p.id}>{p.name || p.id}</option>
            ))}
          </select>
        </div>
        <input type="search" placeholder="Filter…" className="w-full border rounded px-2 py-1 text-sm mb-2" value={q} onChange={(e)=>setQ(e.target.value)} />
        <div className="flex-1 overflow-y-auto scroll-area">
          {error && <div className="text-xs text-red-600 p-2">{error}</div>}
          {filtered.map((v) => {
            const key = `${v.schema || 'public'}.${v.name}`;
            const active = selected && (selected.schema===v.schema && selected.name===v.name);
            return (
              <div key={key} className={`w-full flex items-center justify-between px-2 py-1.5 rounded mb-1 ${active?'bg-blue-50':'hover:bg-gray-50'}`}>
                <button onClick={()=>setSelected(v)} className="flex-1 text-left px-1">
                  <div className="font-medium text-sm">{v.name}</div>
                  <div className="text-[11px] text-gray-500">{v.schema || 'public'}</div>
                </button>
                <button title={favSet.has(key)?'Unfavorite':'Favorite'} className="p-1 text-xs rounded hover:bg-gray-100" onClick={(e)=>{ e.stopPropagation(); toggleFav(v); }}>
                  <span style={{ color: favSet.has(key)? '#eab308' : '#94a3b8' }}>{favSet.has(key)? '★':'☆'}</span>
                </button>
              </div>
            );
          })}
          {!filtered.length && !loading && (
            <div className="text-xs text-gray-500 p-2">No views.</div>
          )}
        </div>
      </aside>
      <main className="flex-1 p-4 min-h-0 overflow-y-auto scroll-area">
        {!editing && !selected && <div className="text-sm text-gray-500">Select a view on the left.</div>}
        {!editing && selected && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{selected.schema || 'public'}.{selected.name}</div>
              <div className="sql-toolbar flex items-center gap-2">
                <label className="text-xs text-gray-600 flex items-center gap-1 select-none"><input type="checkbox" checked={friendly} onChange={(e)=>setFriendly(e.target.checked)} /> Friendly</label>
                <label className="text-xs text-gray-600 flex items-center gap-1 select-none"><input type="checkbox" checked={wrap} onChange={(e)=>setWrap(e.target.checked)} /> Wrap</label>
                <label className="text-xs text-gray-600 flex items-center gap-1 select-none"><input type="checkbox" checked={hl} onChange={(e)=>setHl(e.target.checked)} /> Highlight</label>
                <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={async ()=>{ try { await navigator.clipboard.writeText(String(selected.definition||'')); } catch {} }}>Copy SQL</button>
                <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={beginEdit}>Edit</button>
                <button className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700" onClick={remove} disabled={deleting}>{deleting?'Deleting…':'Delete'}</button>
                <div className="flex items-center gap-1 ml-2">
                  <span className="text-xs text-gray-600">Limit</span>
                  <input className="w-16 border rounded px-2 py-1 text-xs" value={runLimit} onChange={(e)=>setRunLimit(e.target.value)} />
                  <button className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700" onClick={run} disabled={runLoading}>{runLoading?'Running…':'Run'}</button>
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={loadHistory}>History</button>
                </div>
              </div>
            </div>
            {selected.definition ? (
              hl ? (
                <pre className={`sql-code ${wrap? 'sql-code--wrap':''}`} dangerouslySetInnerHTML={{ __html: formattedHtml }} />
              ) : (
                <pre className={`sql-code ${wrap? 'sql-code--wrap':''}`}>{prettyText}</pre>
              )
            ) : (
              <div className="text-sm text-gray-500">No SQL definition available.</div>
            )}
            {/* Result preview */}
            {(runError) && <div className="text-sm text-red-600">{runError}</div>}
            {!!runRows.length && (
              <div className="overflow-auto border rounded bg-white">
                <table className="sql-table min-w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      {runCols.map((c,i)=> <th key={i} className="text-left px-3 py-1">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {runRows.map((row, ri) => (
                      <tr key={ri} className="border-b last:border-0">
                        {runCols.map((c,ci)=> <td key={ci} className="px-3 py-1 whitespace-pre-wrap break-words text-gray-800">{String(row[c] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* History panel */}
            {showHistory && (
              <div className="mt-3 border rounded bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <div className="text-sm font-medium">Change history</div>
                  <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setShowHistory(false)}>Close</button>
                </div>
                {histError && <div className="text-sm text-red-600 px-3 py-2">{histError}</div>}
                {histLoading ? (
                  <div className="text-sm text-gray-500 px-3 py-2">Loading…</div>
                ) : (
                  <div className="max-h-56 overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left px-3 py-1">When</th>
                          <th className="text-left px-3 py-1">Action</th>
                          <th className="text-left px-3 py-1">User</th>
                        </tr>
                      </thead>
                      <tbody>
                        {histItems.map((h)=> (
                          <tr key={h.id} className="border-b last:border-0">
                            <td className="px-3 py-1 whitespace-nowrap">{new Date(h.created_at).toLocaleString()}</td>
                            <td className="px-3 py-1">{h.action}</td>
                            <td className="px-3 py-1">{h.user_id ?? '-'}</td>
                            <td className="px-3 py-1 text-right">
                              <div className="flex items-center gap-2 justify-end">
                                <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>previewChange(h.id)} disabled={prevBusy && (!prevChange || prevChange.id===h.id)}>{prevBusy && (!prevChange || prevChange.id===h.id) ? '…' : 'Preview'}</button>
                                <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700" disabled={histBusyId===h.id} onClick={()=>loadChangeSql(h.id, 'version')}>{histBusyId===h.id?'…':'Load'}</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {!histItems.length && (
                          <tr><td className="px-3 py-2 text-gray-500" colSpan={3}>No changes yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {prevOpen && (
              <div className="mt-3 border rounded bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <div className="text-sm font-medium">Preview</div>
                  <div className="flex items-center gap-2">
                    <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setPrevOpen(false)}>Close</button>
                  </div>
                </div>
                {prevErr && <div className="text-sm text-red-600 px-3 py-2">{prevErr}</div>}
                {!prevErr && (prevBusy ? (
                  <div className="text-sm text-gray-500 px-3 py-2">Loading…</div>
                ) : (
                  <div className="p-3">
                    {(() => {
                      const action = String(prevChange?.action || '').toLowerCase();
                      const body = action==='delete' ? (prevChange?.body_before || '') : (prevChange?.body_after || prevChange?.body_before || '');
                      const pretty = formatSqlLight(body);
                      if (hl) {
                        const html = highlightSqlLight(pretty);
                        return <pre className={`sql-code ${wrap? 'sql-code--wrap':''}`} dangerouslySetInnerHTML={{ __html: html }} />;
                      }
                      return <pre className={`sql-code ${wrap? 'sql-code--wrap':''}`}>{pretty}</pre>;
                    })()}
                  </div>
                ))}
              </div>
            )}
            {prevOpen && (
              <div className="mt-3 border rounded bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <div className="text-sm font-medium">Preview</div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 flex items-center gap-1 select-none"><input type="radio" name="prevWhich" checked={prevWhich==='after'} onChange={()=>setPrevWhich('after')} /> After</label>
                    <label className="text-xs text-gray-600 flex items-center gap-1 select-none"><input type="radio" name="prevWhich" checked={prevWhich==='before'} onChange={()=>setPrevWhich('before')} /> Before</label>
                    <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setPrevOpen(false)}>Close</button>
                  </div>
                </div>
                {prevErr && <div className="text-sm text-red-600 px-3 py-2">{prevErr}</div>}
                {!prevErr && (prevBusy ? (
                  <div className="text-sm text-gray-500 px-3 py-2">Loading…</div>
                ) : (
                  <div className="p-3">
                    {(() => {
                      const body = prevWhich==='after' ? (prevChange?.body_after || prevChange?.body_before || '') : (prevChange?.body_before || '');
                      const pretty = formatSqlLight(body);
                      if (hl) {
                        const html = highlightSqlLight(pretty);
                        return <pre className={`sql-code ${wrap? 'sql-code--wrap':''}`} dangerouslySetInnerHTML={{ __html: html }} />;
                      }
                      return <pre className={`sql-code ${wrap? 'sql-code--wrap':''}`}>{pretty}</pre>;
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {editing && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{creating ? 'Create view' : `Edit ${selected?.schema || 'public'}.${selected?.name}`}</div>
              <div className="flex items-center gap-2">
                {creating && (
                  <input className="border rounded px-2 py-1 text-sm" placeholder="view_name" value={editorName} onChange={(e)=>setEditorName(e.target.value)} />
                )}
                <label className="text-xs text-gray-600 flex items-center gap-1 select-none"><input type="checkbox" checked={friendlyEdit} onChange={(e)=>{ setFriendlyEdit(e.target.checked); try { setEditorText(formatSqlLight(e.target.checked ? simplifySqlNames(editorText) : editorText)); } catch {} }} /> Friendly</label>
                <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ try { setEditorText(formatSqlLight(friendlyEdit ? simplifySqlNames(editorText) : editorText)); } catch {} }}>Format</button>
                <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={cancelEdit}>Cancel</button>
                <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" onClick={save} disabled={saving}>{saving?'Saving…':'Save'}</button>
              </div>
            </div>
            <textarea className="sql-editor" rows={14} value={editorText} onChange={(e)=>setEditorText(e.target.value)} />
          </div>
        )}
      </main>
    </div>
  );
}
export default function DbManager({ embedded = false, forceSubTab = null }) {
  const [subTab, setSubTab] = useState(() => {
    if (forceSubTab) return forceSubTab;
    try { const st = loadModuleState('db-manager'); return st.subTab || 'connection'; } catch { return 'connection'; }
  });
  useEffect(() => {
    if (embedded) return; // Let parent control breadcrumb when embedded
    const base = ['DB Manager'];
    const sec = subTab === 'views' ? 'View Manager' : (subTab === 'mydb' ? 'My DB' : 'Db connection set-up');
    const trail = [...base, sec];
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: trail })); } catch {}
  }, [subTab, embedded]);
  // Persist active sub-tab
  useEffect(() => { try { saveModuleState('db-manager', { subTab }); } catch {} }, [subTab]);
  // React to restore broadcast
  useEffect(() => {
    const onRestore = (e) => {
      try {
        const v = e?.detail?.modules?.['db-manager']?.subTab;
        if (typeof v === 'string' && v) setSubTab(v);
      } catch {}
    };
    window.addEventListener('app-restore', onRestore);
    return () => window.removeEventListener('app-restore', onRestore);
  }, []);
  return (
    <div className="h-full w-full flex min-h-0">
      {!embedded && <Subnav subTab={subTab} setSubTab={setSubTab} />}
      {subTab === 'connection' && <ConnectionSetup />}
      {subTab === 'views' && <ViewManager />}
      {subTab === 'mydb' && <MyDb />}
    </div>
  );
}
