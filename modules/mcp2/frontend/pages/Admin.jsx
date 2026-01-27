import React, { useEffect, useMemo, useState } from "react";
import McpInspectorPanel from "../components/McpInspectorPanel.jsx";
import JsonEditModal from "../components/JsonEditModal.jsx";
import TypeToolsPanel from "../components/TypeToolsPanel.jsx";

function Section({ title, right, children }) {
  return (
    <div className="bg-white rounded border">
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <div className="font-medium text-sm">{title}</div>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-600 text-xs">{label}</span>
      <input
        className="mt-1 w-full border rounded px-3 py-2"
        value={value}
        onChange={(e) => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        placeholder={placeholder || ""}
        type={type}
      />
    </label>
  );
}

function Select({ label, value, onChange, options, placeholder }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-600 text-xs">{label}</span>
      <select
        className="mt-1 w-full border rounded px-3 py-2 bg-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder || "Select"}</option>
        {(options || []).map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

function SmallButton({ children, onClick, kind = "secondary", disabled }) {
  const base = "text-xs px-2 py-1 rounded border";
  const styles = kind === 'primary'
    ? " bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
    : kind === 'danger'
      ? " text-red-700 border-red-300 hover:bg-red-50"
      : " text-gray-700 border-gray-300 hover:bg-gray-50";
  return (
    <button disabled={disabled} className={`${base}${styles} disabled:opacity-60`} onClick={onClick}>{children}</button>
  );
}

export default function Mcp2Admin() {
  const [tab, setTab] = useState('servers'); // 'kinds' | 'types' | 'servers' | 'inspector'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [kinds, setKinds] = useState([]);
  const [types, setTypes] = useState([]);
  const [servers, setServers] = useState([]);
  // Modules that expose MCP tools (for Origin Module selector)
  const [modChoices, setModChoices] = useState([]);
  const originOpts = useMemo(() => (Array.isArray(modChoices) ? modChoices : []).map(m => ({ value: m.id, label: m.name || m.id })), [modChoices]);
  const [moduleProfiles, setModuleProfiles] = useState([]); // loaded profiles for selected origin module
  const [vectorStores, setVectorStores] = useState([]); // OpenAI vector stores (from automation-suite)
  const [vectorStoresLoading, setVectorStoresLoading] = useState(false);
  const kindOpts = useMemo(() => (Array.isArray(kinds) ? kinds : []).map(k => ({ value: k.id, label: k.name || k.code || k.id })), [kinds]);
  const typeOpts = useMemo(() => (Array.isArray(types) ? types : []).map(t => ({ value: t.id, label: t.name || t.code || t.id })), [types]);
  const [statuses, setStatuses] = useState({}); // id -> { ok, method, ms }
  const [statusMeta, setStatusMeta] = useState({ mounted:false, moduleLoaded:false, node:'' });
  // Process status for the currently edited server
  const [procStatus, setProcStatus] = useState(null);
  // Process config form (stored under server.options)
  const [procForm, setProcForm] = useState({ command:'', args:'', cwd:'', env:'', upstream_mcp_url:'' });

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [rk, rt, rs, rm] = await Promise.all([
        fetch('/api/mcp2/kinds', { credentials: 'include' }),
        fetch('/api/mcp2/types', { credentials: 'include' }),
        fetch('/api/mcp2/servers', { credentials: 'include' }),
        fetch('/api/mcp2/modules', { credentials: 'include' }),
      ]);
      const jk = await rk.json().catch(()=>({}));
      const jt = await rt.json().catch(()=>({}));
      const js = await rs.json().catch(()=>({}));
      setKinds(Array.isArray(jk?.items) ? jk.items : []);
      setTypes(Array.isArray(jt?.items) ? jt.items : []);
      setServers(Array.isArray(js?.items) ? js.items : []);
      try {
        const jmods = await rm.json().catch(()=>({}));
        let items = Array.isArray(jmods?.items) ? jmods.items : [];
        // Fallback: if MCP2 endpoint returns nothing, derive from Module Manager catalog
        if (!items.length) {
          try {
            const r2 = await fetch('/api/modules', { credentials:'include' });
            if (r2.ok) {
              const j2 = await r2.json().catch(()=>({}));
              const list = Array.isArray(j2?.modules) ? j2.modules : [];
              items = list.filter(m => {
                try {
                  const has = (m && (m.has_mcp_tool === true || m.hasMcpTool === true));
                  const tools = Array.isArray(m?.mcp_tools) ? m.mcp_tools : (Array.isArray(m?.mcpTools) ? m.mcpTools : []);
                  return has || tools.length > 0;
                } catch { return false; }
              }).map(m => ({ id: String(m.id || m.module_name || m.name || '').trim(), name: m.name || m.module_name || m.id, tools: Array.isArray(m?.mcp_tools) ? m.mcp_tools : (Array.isArray(m?.mcpTools) ? m.mcpTools : []), hasProfil: !!(m.has_profil || m.hasProfil) }));
            }
          } catch {}
        }
        setModChoices(items);
      } catch {}
      try {
        const rs2 = await fetch('/api/mcp2/servers/status', { credentials: 'include' });
        const j2 = await rs2.json().catch(()=>({}));
        if (rs2.ok && j2?.ok) {
          if (Array.isArray(j2.items)) { const m = {}; for (const it of j2.items) m[String(it.id)] = it; setStatuses(m); } else setStatuses({});
          setStatusMeta({ mounted: !!j2.mounted, moduleLoaded: !!j2.moduleLoaded, node: j2.node || '' });
        } else { setStatuses({}); setStatusMeta({ mounted:false, moduleLoaded:false, node:'' }); }
      } catch { setStatuses({}); setStatusMeta({ mounted:false, moduleLoaded:false, node:'' }); }
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };
  const maskToken = (t) => {
    try { const s = String(t || ''); if (!s) return '—'; return s.length <= 8 ? '••••' : `${s.slice(0,4)}…${s.slice(-4)}`; } catch { return '—'; }
  };
  const computeOpenAiSseUrl = (server) => {
    try {
      const name = String(server?.name || '').trim();
      const base = String(server?.http_base || '').trim().replace(/\/+$/, '') || window.location.origin;
      const fallback = name ? `${base}/api/mcp2/${encodeURIComponent(name)}/events` : `${base}/api/mcp2/<name>/events`;
      const raw = String(server?.sse_url || '').trim();
      if (!raw) return fallback;
      if (/\/events(\?|#|$)/.test(raw)) return raw;
      if (/\/stream(\?|#|$)/.test(raw)) return raw.replace(/\/stream(\?|#|$)/, '/events$1');
      if (/\/api\/mcp2\/[^/]+\/?$/.test(raw)) return raw.replace(/\/+$/, '') + '/events';
      return raw;
    } catch {
      return `${window.location.origin}/api/mcp2/<name>/events`;
    }
  };
  const computeStreamUrl = (server) => {
    try {
      const name = String(server?.name || '').trim();
      const base = String(server?.http_base || '').trim().replace(/\/+$/, '') || window.location.origin;
      const fallback = name ? `${base}/api/mcp2/${encodeURIComponent(name)}/stream` : `${base}/api/mcp2/<name>/stream`;
      const raw = String(server?.stream_url || '').trim();
      if (!raw) return fallback;
      if (/\/stream(\?|#|$)/.test(raw)) return raw;
      if (/\/events(\?|#|$)/.test(raw)) return raw.replace(/\/events(\?|#|$)/, '/stream$1');
      if (/\/api\/mcp2\/[^/]+\/?$/.test(raw)) return raw.replace(/\/+$/, '') + '/stream';
      return raw;
    } catch {
      return `${window.location.origin}/api/mcp2/<name>/stream`;
    }
  };
  const appendTokenQuery = (url, token) => {
    try {
      const tok = String(token || '').trim();
      if (!tok) return String(url || '');
      const u = String(url || '');
      const sep = u.includes('?') ? '&' : '?';
      return `${u}${sep}token=${encodeURIComponent(tok)}`;
    } catch {
      return String(url || '');
    }
  };
  useEffect(() => { load(); }, []);
  // (moved below to avoid TDZ on editServerId)
  // Periodically refresh server statuses
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const rs2 = await fetch('/api/mcp2/servers/status', { credentials: 'include' });
        const j2 = await rs2.json().catch(()=>({}));
        if (rs2.ok && j2?.ok && Array.isArray(j2.items)) {
          const m = {}; for (const it of j2.items) m[String(it.id)] = it; setStatuses(m);
        }
        if (rs2.ok && j2?.ok) {
          setStatusMeta({ mounted: !!j2.mounted, moduleLoaded: !!j2.moduleLoaded, node: j2.node || '' });
        }
      } catch {}
    }, 10000);
    return () => clearInterval(t);
  }, []);

  // Kinds form
  const [kindForm, setKindForm] = useState({ code: '', name: '', description: '' });
  const addKind = async () => {
    try {
      const r = await fetch('/api/mcp2/kinds', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(kindForm) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'create_failed');
      setKindForm({ code:'', name:'', description:'' });
      await load();
    } catch (e) { alert(String(e?.message || e)); }
  };
  const deleteKind = async (id) => {
    if (!id) return; if (!confirm('Delete kind?')) return;
    try { await fetch(`/api/mcp2/kinds/${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include' }); await load(); } catch {}
  };

  // Types form
  const [typeForm, setTypeForm] = useState({ code: '', name: '', description: '' });
  const addType = async () => {
    try {
      const r = await fetch('/api/mcp2/types', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(typeForm) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'create_failed');
      setTypeForm({ code:'', name:'', description:'' });
      await load();
    } catch (e) { alert(String(e?.message || e)); }
  };
  const deleteType = async (id) => {
    if (!id) return; if (!confirm('Delete type?')) return;
    try { await fetch(`/api/mcp2/types/${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include' }); await load(); } catch {}
  };

  // Servers form
  const [editServerId, setEditServerId] = useState(null);
  const editing = useMemo(() => (servers || []).find(s => s && s.id === editServerId) || null, [servers, editServerId]);
  const DEFAULT_HTTP_BASE = 'https://chat.piscinesondespro.fr/';
  const [serverForm, setServerForm] = useState({ name:'', kind_id:'', type_id:'', origin_module:'', origin_profile_id:'', vector_store_id:'', http_base: DEFAULT_HTTP_BASE, ws_url:'', stream_url:'', sse_url:'', token:'', require_token:true, enabled:false, notes:'', server_url_pref:'stream', persist_disabled:false });
  const [persistBusy, setPersistBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  // When editing a server, poll its process status (must be after editServerId declaration)
  useEffect(() => {
    let t;
    const fetchOnce = async () => {
      if (!editServerId) { setProcStatus(null); return; }
      try {
        const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/process`, { credentials:'include' });
        const j = await r.json().catch(()=>({}));
        if (r.ok && j?.ok) setProcStatus(j.status || {}); else setProcStatus(null);
      } catch { setProcStatus(null); }
    };
    fetchOnce();
    if (editServerId) t = setInterval(fetchOnce, 3000);
    return () => { if (t) clearInterval(t); };
  }, [editServerId]);
  // Per-server tools view
  const [serverTools, setServerTools] = useState([]);
  const [serverToolsMeta, setServerToolsMeta] = useState({ source:'', origin_profile_id:null });
  const [serverToolsLoading, setServerToolsLoading] = useState(false);
  const [serverResources, setServerResources] = useState([]);
  const [serverResourcesMeta, setServerResourcesMeta] = useState({ source:'', origin_profile_id:null });
  const [serverResourcesLoading, setServerResourcesLoading] = useState(false);
  const [serverTpls, setServerTpls] = useState([]);
  const [serverTplsMeta, setServerTplsMeta] = useState({ source:'', origin_profile_id:null });
  const [serverTplsLoading, setServerTplsLoading] = useState(false);
  const [persisted, setPersisted] = useState({ toolsEnabled: {}, resources: [], resourceTemplates: [] });
  const [viewer, setViewer] = useState(null); // { title, json }
  const [jsonEditor, setJsonEditor] = useState(null); // { title, value, onSave }
  const [recentRpc, setRecentRpc] = useState([]);
  const [recentRpcLoading, setRecentRpcLoading] = useState(false);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [saveCfgBusy, setSaveCfgBusy] = useState(false);
  const saveServerConfig = async (override) => {
    if (!editServerId) return false;
    setSaveCfgBusy(true);
    try {
      const toolsBase = override?.tools || serverTools;
      const resourcesBase = override?.resources || serverResources;
      const templatesBase = override?.resourceTemplates || serverTpls;
      // Tools are type-scoped; server persists only enabled/disabled overrides.
      const tools = (toolsBase||[]).map(t => ({ tool_id: t?.tool_id || null, name: t.name, enabled: t?.enabled !== false }));
      const resources = (resourcesBase||[]).map(r => ({ uri: r.uri, name: r.name||'', description: r.description||'', mimeType: r.mimeType||null, enabled: r?.enabled !== false }));
      const resourceTemplates = (templatesBase||[]).map(t => ({ name: t.name, description: t.description||'', inputSchema: t.inputSchema || {}, uriTemplate: t.uriTemplate || null, enabled: t?.enabled !== false }));
      await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/apply-config`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ tools, resources, resourceTemplates }) });
      try { await loadPersisted(editServerId); } catch {}
      return true;
    } catch { return false; }
    finally { setSaveCfgBusy(false); }
  };
  const [importBusy, setImportBusy] = useState(false);
  const importFromProfile = async () => {
    if (!editServerId) return;
    setImportBusy(true);
    try {
      const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/materialize-from-profile`, { method:'POST', credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'import_failed');
      await loadServerTools(editServerId);
      await loadServerResources(editServerId);
      await loadServerTpls(editServerId);
    } catch (e) { alert(String(e?.message || e)); }
    finally { setImportBusy(false); }
  };
  const [seedBusy, setSeedBusy] = useState(false);
  const seedTypeToolsFromProfile = async () => {
    if (!editServerId) return;
    const ok = window.confirm('Copy tools from this server’s Origin Profile into the selected Type standard tools?\n\nThis makes the tool list available for all servers of that type (then you can toggle per-server ON/OFF).');
    if (!ok) return;
    setSeedBusy(true);
    try {
      const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/seed-type-tools`, { method:'POST', credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'seed_failed');
      await loadServerTools(editServerId);
    } catch (e) { alert(String(e?.message || e)); }
    finally { setSeedBusy(false); }
  };

  // Tools are type-scoped; no per-server tool definition editing.
  const openEditResource = (r) => {
    const res = r || { uri: '', name: '', description: '', mimeType: '', enabled: true };
    setJsonEditor({
      title: `Edit resource: ${res.uri || '(new)'}`,
      value: res,
      onSave: async (next) => {
        const uri = String(next?.uri || '').trim();
        if (!uri) throw new Error('Resource.uri is required');
        const item = { ...next, uri };
        const nextResources = (() => {
          const list = Array.isArray(serverResources) ? serverResources.slice() : [];
          const i = list.findIndex((x) => String(x?.uri || '').trim().toLowerCase() === uri.toLowerCase());
          if (i >= 0) list[i] = item;
          else list.push(item);
          return list;
        })();
        setJsonSaving(true);
        try {
          const ok = await saveServerConfig({ tools: serverTools, resources: nextResources, resourceTemplates: serverTpls });
          if (ok) setServerResources(nextResources);
        } finally { setJsonSaving(false); setJsonEditor(null); }
      },
    });
  };
  const openEditTemplate = (t) => {
    const tpl = t || { name: '', description: '', inputSchema: { type: 'object' }, uriTemplate: '', enabled: true };
    setJsonEditor({
      title: `Edit template: ${tpl.name || '(new)'}`,
      value: tpl,
      onSave: async (next) => {
        const name = String(next?.name || '').trim();
        if (!name) throw new Error('Template.name is required');
        const item = { ...next, name };
        const nextTpls = (() => {
          const list = Array.isArray(serverTpls) ? serverTpls.slice() : [];
          const i = list.findIndex((x) => String(x?.name || '').trim().toLowerCase() === name.toLowerCase());
          if (i >= 0) list[i] = item;
          else list.push(item);
          return list;
        })();
        setJsonSaving(true);
        try {
          const ok = await saveServerConfig({ tools: serverTools, resources: serverResources, resourceTemplates: nextTpls });
          if (ok) setServerTpls(nextTpls);
        } finally { setJsonSaving(false); setJsonEditor(null); }
      },
    });
  };
  const loadServerTools = async (id) => {
    if (!id) { setServerTools([]); return; }
    setServerToolsLoading(true);
    try {
      const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(id)}/tools`, { credentials: 'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'load_failed');
      setServerTools(Array.isArray(j.items) ? j.items : []);
      setServerToolsMeta({ source: j.source || '', origin_profile_id: j.origin_profile_id || null });
    } catch { setServerTools([]); }
    finally { setServerToolsLoading(false); }
  };
  const loadServerResources = async (id) => {
    if (!id) { setServerResources([]); return; }
    setServerResourcesLoading(true);
    try {
      const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(id)}/resources`, { credentials: 'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'load_failed');
      setServerResources(Array.isArray(j.items) ? j.items : []);
      setServerResourcesMeta({ source: j.source || '', origin_profile_id: j.origin_profile_id || null });
    } catch { setServerResources([]); }
    finally { setServerResourcesLoading(false); }
  };
  const loadServerTpls = async (id) => {
    if (!id) { setServerTpls([]); return; }
    setServerTplsLoading(true);
    try {
      const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(id)}/resource-templates`, { credentials: 'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'load_failed');
      setServerTpls(Array.isArray(j.items) ? j.items : []);
      setServerTplsMeta({ source: j.source || '', origin_profile_id: j.origin_profile_id || null });
    } catch { setServerTpls([]); }
    finally { setServerTplsLoading(false); }
  };
  const urlEncode = (s='') => encodeURIComponent(String(s));
  const trimBase = (b='') => String(b||'').replace(/\/+$/,'');
  const computeDerivedUrls = (base, name) => {
    const safeBase = trimBase(base || DEFAULT_HTTP_BASE);
    const safeName = urlEncode(name || '');
    const host = safeBase.replace(/^https?:\/\//i, '');
    const wsScheme = /^https:\/\//i.test(safeBase) ? 'wss://' : 'ws://';
    return {
      base_url: safeBase + '/api/mcp2/' + safeName,
      ws_url: wsScheme + host + '/mcp2/' + safeName + '/ws',
      stream_url: safeBase + '/api/mcp2/' + safeName + '/stream',
      sse_url: safeBase + '/api/mcp2/' + safeName + '/events',
    };
  };

  // Auto-fill URLs when Name or HTTP Base changes (runs after helpers are defined)
  useEffect(() => {
    try {
      const derived = computeDerivedUrls(serverForm.http_base, serverForm.name);
      if (derived.ws_url !== serverForm.ws_url || derived.stream_url !== serverForm.stream_url || derived.sse_url !== serverForm.sse_url) {
        setServerForm(f => ({ ...f, ...derived }));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverForm.name, serverForm.http_base]);
  const regenerateToken = () => {
    try {
      const arr = new Uint8Array(32);
      (window.crypto || window.msCrypto).getRandomValues(arr);
      const hex = Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('');
      setServerForm(f => ({ ...f, token: hex }));
    } catch {
      const hex = Array.from({length:64},()=>Math.floor(Math.random()*16).toString(16)).join('');
      setServerForm(f => ({ ...f, token: hex }));
    }
  };
  const beginNew = () => { setEditServerId(null); setServerForm({ name:'', kind_id:'', type_id:'', origin_module:'', origin_profile_id:'', vector_store_id:'', http_base: DEFAULT_HTTP_BASE, ws_url:'', stream_url:'', sse_url:'', token:'', require_token:true, enabled:false, notes:'', server_url_pref:'stream', persist_disabled:false }); setProcForm({ command:'', args:'', cwd:'', env:'' }); setProcStatus(null); setServerTools([]); setModuleProfiles([]); };
  const beginEdit = (it) => {
    setEditServerId(it?.id || null);
    let pref = 'stream';
    try { const opt = typeof it.options === 'string' ? JSON.parse(it.options) : (it.options || {}); if (opt && (opt.server_url_pref === 'sse' || opt.server_url_pref === 'stream')) pref = opt.server_url_pref; } catch {}
    const opt = (()=>{ try { return typeof it?.options==='string'? JSON.parse(it.options): (it?.options||{}); } catch { return {}; } })();
    const require_token = (()=>{ try { const o = typeof it?.options==='string'? JSON.parse(it.options): (it?.options||{}); if (o && typeof o.require_auth==='boolean') return !!o.require_auth; } catch {} return !!(it?.token); })();
    const persist_disabled = (()=>{ try { const o = typeof it?.options==='string'? JSON.parse(it.options): (it?.options||{}); if (!o) return false; if (o.persist_disabled === true) return true; if (o.persist_enabled === false) return true; if (String(o.persist_mode||'').toLowerCase()==='disabled') return true; return false; } catch { return false; } })();
    setServerForm({ name: it?.name || '', kind_id: it?.kind_id || '', type_id: it?.type_id || '', origin_module: opt.origin_module || '', origin_profile_id: opt.origin_profile_id || '', vector_store_id: opt.vector_store_id || '', http_base: it?.http_base || DEFAULT_HTTP_BASE, ws_url: it?.ws_url || '', stream_url: it?.stream_url || '', sse_url: it?.sse_url || '', token: it?.token || '', require_token, enabled: !!it?.enabled, notes: it?.notes || '', server_url_pref: pref, persist_disabled });
    // Populate process form from options
    const pf = { command:'', args:'', cwd:'', env:'', upstream_mcp_url:'' };
    try { if (opt && typeof opt.command==='string') pf.command = opt.command; } catch {}
    try { if (Array.isArray(opt?.args)) pf.args = opt.args.join(' '); else if (typeof opt?.args==='string') pf.args = opt.args; } catch {}
    try { if (typeof opt?.cwd==='string') pf.cwd = opt.cwd; } catch {}
    try { if (opt && typeof opt.env==='object') pf.env = JSON.stringify(opt.env); } catch {}
    try { if (typeof opt?.upstream_mcp_url==='string') pf.upstream_mcp_url = opt.upstream_mcp_url; } catch {}
    setProcForm(pf);
    loadServerTools(it?.id || null);
    loadServerResources(it?.id || null);
    loadServerTpls(it?.id || null);
    loadPersisted(it?.id || null);
  };
  const loadRecentRpc = async (serverName) => {
    const nm = String(serverName || '').trim();
    if (!nm) { setRecentRpc([]); return; }
    setRecentRpcLoading(true);
    try {
      const r = await fetch(`/api/mcp2/${encodeURIComponent(nm)}/recent-rpc`, { credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'load_failed');
      setRecentRpc(Array.isArray(j.items) ? j.items : []);
    } catch {
      setRecentRpc([]);
    } finally {
      setRecentRpcLoading(false);
    }
  };
  const loadPersisted = async (id) => {
    if (!id) { setPersisted({ toolsEnabled: {}, resources: [], resourceTemplates: [] }); return; }
    try {
      const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(id)}/persisted`, { credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'load_failed');
      setPersisted({
        toolsEnabled: (j.tools_enabled && typeof j.tools_enabled === 'object') ? j.tools_enabled : {},
        resources: Array.isArray(j.resources) ? j.resources : [],
        resourceTemplates: Array.isArray(j.resourceTemplates) ? j.resourceTemplates : [],
      });
    } catch { setPersisted({ toolsEnabled: {}, resources: [], resourceTemplates: [] }); }
  };
  const showPersisted = (kind, key) => {
    try {
      let item = null;
      if (kind === 'resource') {
        const k = String(key||'').trim().toLowerCase();
        item = (persisted.resources||[]).find(x => String(x?.uri||'').trim().toLowerCase() === k) || null;
      } else if (kind === 'template') {
        const k = String(key||'').trim().toLowerCase();
        item = (persisted.resourceTemplates||[]).find(x => String(x?.name||'').trim().toLowerCase() === k) || null;
      }
      if (!item) setViewer({ title: 'Not persisted', json: '// This item is not persisted (OFF)\n{}' });
      else setViewer({ title: `Persisted ${kind}`, json: JSON.stringify(item, null, 2) });
    } catch { setViewer({ title: 'Error', json: '// Failed to load' }); }
  };
  const copyPersisted = async (kind, key) => {
    try {
      let item = null;
      if (kind === 'resource') {
        const k = String(key||'').trim().toLowerCase();
        item = (persisted.resources||[]).find(x => String(x?.uri||'').trim().toLowerCase() === k) || null;
      } else if (kind === 'template') {
        const k = String(key||'').trim().toLowerCase();
        item = (persisted.resourceTemplates||[]).find(x => String(x?.name||'').trim().toLowerCase() === k) || null;
      }
      const text = item ? JSON.stringify(item, null, 2) : '{}';
      await navigator.clipboard.writeText(text);
      alert('Copied JSON to clipboard');
    } catch {
      alert('Copy failed');
    }
  };
  // Load profiles for a module that declares hasProfil
  const loadModuleProfiles = async (moduleId) => {
    setModuleProfiles([]);
    try {
      if (!moduleId) return;
      const mod = (modChoices||[]).find(m => m && m.id === moduleId);
      if (!mod || !mod.hasProfil) return;
      const r = await fetch(`/api/${encodeURIComponent(moduleId)}/profiles`, { credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (r.ok && Array.isArray(j?.items)) {
        setModuleProfiles(j.items.map(p => ({ value: String(p.id), label: p.name || `#${p.id}` })));
      }
    } catch {}
  };
  useEffect(() => { loadModuleProfiles(serverForm.origin_module); /* eslint-disable-next-line */ }, [serverForm.origin_module, modChoices]);

  const selectedType = useMemo(() => {
    const id = String(serverForm.type_id || '').trim();
    if (!id) return null;
    return (types || []).find(t => t && t.id === id) || (types || []).find(t => t && (t.code === id || t.name === id)) || null;
  }, [types, serverForm.type_id]);
  const wantsVectorStore = useMemo(() => {
    const code = String(selectedType?.code || selectedType?.name || '').trim();
    const isFileData = /files?_data/i.test(code);
    return isFileData && serverForm.origin_module === 'automation-suite';
  }, [selectedType, serverForm.origin_module]);
  const vectorStoreOpts = useMemo(() => (Array.isArray(vectorStores) ? vectorStores : []).map(v => ({ value: String(v.id || ''), label: v.name ? `${v.name} (${v.id})` : String(v.id || '') })), [vectorStores]);
  const loadVectorStores = async () => {
    setVectorStoresLoading(true);
    try {
      const r = await fetch('/api/automation-suite/vector-stores?limit=100', { credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'load_failed');
      const items = Array.isArray(j.items) ? j.items : [];
      setVectorStores(items.map(v => ({ id: v.id, name: v.name || '' })));
    } catch {
      setVectorStores([]);
    } finally {
      setVectorStoresLoading(false);
    }
  };
  useEffect(() => {
    if (!wantsVectorStore) return;
    if (vectorStoresLoading) return;
    if (vectorStores && vectorStores.length > 0) return;
    loadVectorStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsVectorStore]);
  const parseArgsString = (s) => {
    const v = String(s || '').trim();
    if (!v) return [];
    if (v.startsWith('[')) { try { const arr = JSON.parse(v); return Array.isArray(arr)? arr.map(x=>String(x)) : []; } catch { /* fallthrough */ } }
    // naive split preserving quoted segments
    const re = /\"([^\"]*)\"|'([^']*)'|\S+/g; const out=[]; let m; while((m=re.exec(v))) { out.push(m[1]||m[2]||m[0]); } return out;
  };
  const parseEnvString = (s) => {
    const v = String(s || '').trim();
    if (!v) return {};
    try { const o = JSON.parse(v); if (o && typeof o==='object' && !Array.isArray(o)) return o; } catch {}
    // support KEY=VAL lines
    const obj = {}; v.split(/\s+/).forEach(p=>{ const i=p.indexOf('='); if (i>0) obj[p.slice(0,i)] = p.slice(i+1); }); return obj;
  };
  const saveServer = async () => {
    try {
      const derived = computeDerivedUrls(serverForm.http_base, serverForm.name);
      const tokenOut = serverForm.require_token ? (serverForm.token || '') : '';
      const baseOptions = (() => {
        try {
          const v = editing?.options;
          if (v && typeof v === 'object' && !Array.isArray(v)) return v;
          if (typeof v === 'string' && v.trim()) {
            const o = JSON.parse(v);
            if (o && typeof o === 'object' && !Array.isArray(o)) return o;
          }
        } catch {}
        return {};
      })();
      const options = { ...baseOptions, origin_module: serverForm.origin_module || '', require_auth: !!serverForm.require_token, server_url_pref: serverForm.server_url_pref || 'stream', ...(serverForm.persist_disabled ? { persist_disabled: true, persist_enabled: false } : {}) };
      if (serverForm.origin_profile_id && String(serverForm.origin_profile_id).trim()) options.origin_profile_id = String(serverForm.origin_profile_id).trim();
      else delete options.origin_profile_id;
      if (serverForm.vector_store_id && String(serverForm.vector_store_id).trim()) options.vector_store_id = String(serverForm.vector_store_id).trim();
      else delete options.vector_store_id;
      const payload = { ...serverForm, ...derived, token: tokenOut, options };
      if (!editServerId) {
        const r = await fetch('/api/mcp2/servers', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
        const j = await r.json().catch(()=>({}));
        if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'create_failed');
        await load();
        // Keep editing after create for immediate tool toggles.
        try {
          if (j?.item?.id) beginEdit(j.item);
          else beginNew();
        } catch { beginNew(); }
      } else {
        const derived = computeDerivedUrls(serverForm.http_base, serverForm.name);
        const tokenOut2 = serverForm.require_token ? (serverForm.token || '') : '';
        const options2 = { ...options };
        const body = { ...serverForm, ...derived, token: tokenOut2, options: options2 };
        const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
        const j = await r.json().catch(()=>({}));
        if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'update_failed');
        await load();
        // Keep editing after save so the user can immediately toggle tools/resources/templates.
        try {
          await loadPersisted(editServerId);
          await loadServerTools(editServerId);
          await loadServerResources(editServerId);
          await loadServerTpls(editServerId);
        } catch {}
      }
    } catch (e) { alert(String(e?.message || e)); }
  };
  const togglePersistence = async (disable) => {
    try {
      setPersistBusy(true);
      if (!editServerId) { setServerForm(f=>({ ...f, persist_disabled: !!disable })); setPersistBusy(false); return; }
      if (disable) {
        // Clear persisted and disable persistence server-side
        const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/clear-persisted`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ disablePersistence: true }) });
        const j = await r.json().catch(()=>({})); if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'persist_disable_failed');
      } else {
        // Re-enable persistence flag without materializing anything
        const options = { origin_module: serverForm.origin_module || '', require_auth: !!serverForm.require_token, persist_disabled: false, persist_enabled: true };
        const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ options }) });
        const j = await r.json().catch(()=>({})); if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'persist_enable_failed');
      }
      setServerForm(f=>({ ...f, persist_disabled: !!disable }));
      // Reload lists to reflect mode
      try { await loadServerTools(editServerId); await loadServerResources(editServerId); await loadServerTpls(editServerId); } catch {}
    } catch(e) { alert(String(e?.message || e)); }
    finally { setPersistBusy(false); }
  };
  const clearPersistedNow = async () => {
    try {
      if (!editServerId) return;
      setClearBusy(true);
      const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/clear-persisted`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ disablePersistence: false }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'clear_persist_failed');
      // Reload persisted + server lists to reflect clearing
      try { await loadPersisted(editServerId); await loadServerTools(editServerId); await loadServerResources(editServerId); await loadServerTpls(editServerId); } catch {}
      alert('Cleared persisted server config.');
    } catch (e) { alert(String(e?.message || e)); }
    finally { setClearBusy(false); }
  };
  const deleteServer = async (id) => {
    if (!id) return; if (!confirm('Delete server?')) return;
    try { await fetch(`/api/mcp2/servers/${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include' }); await load(); } catch {}
  };
  const testServer = async (id) => {
    try {
      let r, j;
      if (id) {
        r = await fetch(`/api/mcp2/servers/${encodeURIComponent(id)}/status`, { credentials:'include' });
        j = await r.json().catch(()=>({}));
      } else {
        const derived = computeDerivedUrls(serverForm.http_base, serverForm.name);
        const payload = { http_base: serverForm.http_base, stream_url: derived.stream_url, sse_url: derived.sse_url, token: serverForm.token, options: {} };
        r = await fetch('/api/mcp2/servers/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
        j = await r.json().catch(()=>({}));
      }
      if (r.ok && j?.ok) {
        const st = j.status || {};
        alert(st.ok ? `OK (${st.method||''}) in ${st.ms||'?'}ms` : `Failed: ${st.error || st.status || 'unreachable'}`);
      } else alert(j?.error || 'test_failed');
    } catch (e) { alert(String(e?.message || e)); }
  };

  // (removed duplicates: kindOpts/modChoices/originOpts and serverTools were already declared earlier in file)

  // Breadcrumb: tell shell we are on MCP2 Admin
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['MCP2 Admin'] })); } catch {}
  }, []);

  return (
    <div className="w-full px-2 md:px-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-lg font-semibold">MCP2 Administration</div>
        <div className="space-x-2">
          <SmallButton onClick={() => setTab('kinds')} kind={tab==='kinds'?'primary':'secondary'}>Kinds</SmallButton>
          <SmallButton onClick={() => setTab('types')} kind={tab==='types'?'primary':'secondary'}>Types</SmallButton>
          <SmallButton onClick={() => setTab('servers')} kind={tab==='servers'?'primary':'secondary'}>Servers</SmallButton>
          <SmallButton onClick={() => setTab('inspector')} kind={tab==='inspector'?'primary':'secondary'}>Inspector</SmallButton>
        </div>
      </div>
      <div className="mb-3 text-xs text-gray-600">
        <span className={statusMeta.mounted? 'text-green-700 font-medium':'text-red-700 font-medium'}>
          Transport Mounted: {statusMeta.mounted? 'Yes':'No'}
        </span>
        <span className="mx-2">|</span>
        <span>Node: <span className="font-mono">{statusMeta.node || 'n/a'}</span></span>
      </div>
      {!statusMeta.mounted && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-xs">
          <div className="font-medium">MCP2 transport not mounted</div>
          <div className="mt-1">Backend didn’t load /mcp2 stream/events routes. Status checks may show 404/401.</div>
          <div className="mt-1">
            <span className="underline cursor-help" title="Tips: Ensure Apache vhost has ProxyPass for /mcp2/ and a WebSocket Upgrade rule for /mcp2/*/ws. Restart backend with PM2 and verify Node interpreter: 'pm2 restart livechat --update-env' and 'pm2 restart livechat --interpreter $(which node)'. Check PM2 logs for 'backend/index load error' or 'transport.routes.js'.">Troubleshooting tips</span>
            <span className="ml-2 text-gray-700">• Node: <span className="font-mono">{statusMeta.node || 'n/a'}</span></span>
          </div>
        </div>
      )}
      {loading && (<div className="text-sm text-gray-500">Loading…</div>)}
      {error && (<div className="text-sm text-red-600">{error}</div>)}

      {tab === 'kinds' && (
        <div className="grid md:grid-cols-2 gap-3">
          <Section title="Kinds">
            <div className="space-y-2">
              {(kinds || []).map(k => (
                <div key={k.id} className="border rounded p-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{k.name || k.code} <span className="text-xs text-gray-500">({k.code})</span></div>
                    {k.description ? (<div className="text-xs text-gray-600">{k.description}</div>) : null}
                  </div>
                  <div className="space-x-2">
                    <SmallButton kind="danger" onClick={() => deleteKind(k.id)}>Delete</SmallButton>
                  </div>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Add Kind">
            <div className="space-y-2">
              <TextInput label="Code" value={kindForm.code} onChange={(v) => setKindForm({ ...kindForm, code: v })} />
              <TextInput label="Name" value={kindForm.name} onChange={(v) => setKindForm({ ...kindForm, name: v })} />
              <TextInput label="Description" value={kindForm.description} onChange={(v) => setKindForm({ ...kindForm, description: v })} />
              <div className="flex justify-end"><SmallButton kind="primary" onClick={addKind}>Create</SmallButton></div>
            </div>
          </Section>
        </div>
      )}

      {tab === 'types' && (
        <div className="grid md:grid-cols-2 gap-3">
          <Section title="Types">
            <div className="space-y-2">
              {(types || []).map(t => (
                <div key={t.id} className="border rounded p-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{t.name || t.code} <span className="text-xs text-gray-500">({t.code})</span></div>
                    {t.description ? (<div className="text-xs text-gray-600">{t.description}</div>) : null}
                  </div>
                  <div className="space-x-2">
                    <SmallButton kind="danger" onClick={() => deleteType(t.id)}>Delete</SmallButton>
                  </div>
                </div>
              ))}
            </div>
          </Section>
          <div className="space-y-3">
            <Section title="Add Type">
              <div className="space-y-2">
                <TextInput label="Code" value={typeForm.code} onChange={(v) => setTypeForm({ ...typeForm, code: v })} />
                <TextInput label="Name" value={typeForm.name} onChange={(v) => setTypeForm({ ...typeForm, name: v })} />
                <TextInput label="Description" value={typeForm.description} onChange={(v) => setTypeForm({ ...typeForm, description: v })} />
                <div className="flex justify-end"><SmallButton kind="primary" onClick={addType}>Create</SmallButton></div>
              </div>
            </Section>
            <TypeToolsPanel types={types} />
          </div>
        </div>
      )}

      {tab === 'inspector' && (
        <div className="grid grid-cols-1 gap-3">
          <McpInspectorPanel
            servers={servers}
            defaultServerId={editServerId || (Array.isArray(servers) && servers[0] ? servers[0].id : '')}
          />
        </div>
      )}

      {tab === 'servers' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-1">
          <Section title="Servers" right={<SmallButton onClick={beginNew}>New</SmallButton>}>
            <div className="space-y-2">
              {(servers || []).map(s => {
                const st = statuses[s.id] || {};
                const online = !!st.ok;
                const kindLabel = (() => { try { const k = (kinds || []).find(kk => kk.id === s.kind_id); return k ? (k.name || k.code || k.id) : '—'; } catch { return '—'; } })();
                const typeLabel = (() => { try { const t = (types || []).find(tt => tt.id === s.type_id); return t ? (t.name || t.code || t.id) : '—'; } catch { return '—'; } })();
                return (
                  <div key={s.id} className={`w-full text-left border rounded p-2 ${editServerId===s.id?'border-blue-400 bg-blue-50':''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <button onClick={() => beginEdit(s)} className="font-medium text-sm truncate hover:underline text-left flex-1">
                        {s.name || s.id}
                      </button>
                      
                      <div className={`text-xs inline-flex items-center gap-1 ${online?'text-green-700':'text-gray-600'}`}>
                        <span className={`inline-block w-2 h-2 rounded-full ${online?'bg-green-500':'bg-gray-400'}`}></span>
                        {online ? 'Online' : 'Offline'}
                      </div>
                    </div>
                    <div className="mt-1 space-y-1 text-[11px] text-gray-700">
                      <div><span className="text-gray-500">Origin:</span> {(() => { try { const o = typeof s.options === 'string' ? JSON.parse(s.options) : (s.options||{}); return o.origin_module || o.module || '—'; } catch { return '—'; } })()}</div>
                      <div><span className="text-gray-500">Kind:</span> {kindLabel}</div>
                      <div><span className="text-gray-500">Type:</span> {typeLabel}</div>
                      <div className="truncate flex items-center gap-2">
                        <span className="text-gray-500">OpenAI URL (SSE):</span>
                        <span className="font-mono truncate">
                          {(() => {
                            try {
                              return computeOpenAiSseUrl(s);
                            } catch {
                              return `${window.location.origin}/api/mcp2/${encodeURIComponent(s.name || '')}/events`;
                            }
                          })()}
                        </span>
                        <SmallButton onClick={async()=>{ try { const url = computeOpenAiSseUrl(s); await navigator.clipboard.writeText(url); } catch {} }}>Copy</SmallButton>
                      </div>
                      <div className="truncate flex items-center gap-2">
                        <span className="text-gray-500">Stream URL:</span>
                        <span className="font-mono truncate">{computeStreamUrl(s)}</span>
                        <SmallButton onClick={async()=>{ try { const url = computeStreamUrl(s); await navigator.clipboard.writeText(url); } catch {} }}>Copy</SmallButton>
                      </div>
                      <div className="truncate flex items-center gap-2">
                        <span className="text-gray-500">Token:</span>
                        <span className="font-mono">{maskToken(s.token)}</span>
                        <SmallButton onClick={async()=>{ try { if (s.token) await navigator.clipboard.writeText(String(s.token)); } catch {} }} disabled={!s.token}>Copy</SmallButton>
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-600 truncate">{s.http_base || s.sse_url || s.stream_url || s.ws_url || ''}</div>
                    {/* Preferred URL indicator removed for simplified UI */}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-[11px] text-gray-500">
                        {online ? (<>
                          {st.method || ''}{st.ms!=null?` • ${st.ms}ms`:''}
                        </>) : (
                          <>
                            {st.code ? `HTTP ${st.code}` : 'No response'}{st.error ? ` • ${st.error}` : ''}
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <SmallButton onClick={() => beginEdit(s)}>Edit</SmallButton>
                        <SmallButton kind="danger" onClick={() => deleteServer(s.id)}>Delete</SmallButton>
                      </div>
                    </div>
                  </div>
                );
              })}
              {(!servers || !servers.length) && (
                <div className="text-xs text-gray-500">No servers yet. Click New to create one.</div>
              )}
            </div>
          </Section>
          </div>
          <div className="lg:col-span-2 space-y-3">
          <Section title={editServerId? 'Edit Server' : 'New Server'}>
            <div className="space-y-2">
              <TextInput label="Name" value={serverForm.name} onChange={(v)=>setServerForm({...serverForm, name:v})} />
              {editServerId && (
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <div>ID: <span className="font-mono">{editServerId}</span></div>
                  <SmallButton onClick={async ()=>{ try { await navigator.clipboard.writeText(editServerId); } catch {} }}>Copy Id</SmallButton>
                </div>
              )}
              {editServerId && (
                <div className="flex items-center justify-between text-xs">
                  <div className="text-gray-700">
                    Proc: {procStatus?.running ?
                      (<span className="text-green-700">running</span>) :
                      (<span className="text-gray-600">stopped</span>)}
                    {procStatus?.pid ? <span> • PID <span className="font-mono">{procStatus.pid}</span></span> : null}
                  </div>
                  <div className="space-x-2">
                    <SmallButton kind="secondary" onClick={async ()=>{
                      try { const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/start`, { method:'POST', credentials:'include' }); await r.json().catch(()=>({})); } catch {}
                    }}>Start</SmallButton>
                    <SmallButton kind="danger" onClick={async ()=>{
                      try { const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/stop`, { method:'POST', credentials:'include' }); await r.json().catch(()=>({})); } catch {}
                    }}>Stop</SmallButton>
                  </div>
                </div>
	              )}
	              <Select label="Kind" value={serverForm.kind_id} onChange={(v)=>setServerForm({...serverForm, kind_id:v})} options={kindOpts} placeholder="Choose a kind" />
	              <Select label="Type" value={serverForm.type_id} onChange={(v)=>setServerForm({...serverForm, type_id:v})} options={typeOpts} placeholder="Choose a type (optional)" />
	              <Select label="Origin Module" value={serverForm.origin_module} onChange={(v)=>setServerForm({...serverForm, origin_module:v, origin_profile_id:'', vector_store_id: v === 'automation-suite' ? serverForm.vector_store_id : ''})} options={originOpts} placeholder="Choose a module" />
	              {(moduleProfiles && moduleProfiles.length>0) && (
	                <Select label="Profile" value={serverForm.origin_profile_id||''} onChange={(v)=>setServerForm({...serverForm, origin_profile_id:v})} options={moduleProfiles} placeholder="Select a profile" />
	              )}
	              {wantsVectorStore && (
	                <div className="space-y-2">
	                  <div className="flex items-end gap-2">
	                    <div className="flex-1">
	                      <Select
	                        label="Vector Store"
	                        value={serverForm.vector_store_id || ''}
	                        onChange={(v)=>setServerForm({...serverForm, vector_store_id:v})}
	                        options={vectorStoreOpts}
	                        placeholder={vectorStoresLoading ? 'Loading…' : 'Select a vector store'}
	                      />
	                    </div>
	                    <SmallButton onClick={loadVectorStores} disabled={vectorStoresLoading}>Refresh</SmallButton>
	                  </div>
	                  <TextInput label="Vector Store ID (manual)" value={serverForm.vector_store_id || ''} onChange={(v)=>setServerForm({...serverForm, vector_store_id:v})} placeholder="vs_..." />
	                  <div className="text-[11px] text-gray-500">Used by `filedata` tools when searching vector store files.</div>
	                </div>
	              )}
	              {(!originOpts || originOpts.length===0) && (
	                <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
	                  No modules discovered. Ensure a module has "hasMcpTool": true or "mcpTools" in modules/&lt;id&gt;/module.config.json, then reload.
	                </div>
	              )}
              <TextInput label="HTTP Base" value={serverForm.http_base} onChange={(v)=>setServerForm({...serverForm, http_base:v})} placeholder="https://chat.piscinesondespro.fr/" />
              {/* Only show a single copyable URL for OpenAI UI */}
              <div className="text-xs text-gray-700 -mt-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate">
                    <span className="text-gray-500">OpenAI URL (SSE):</span>{' '}
                    <span className="font-mono">
                      {(() => {
                        try {
                          const base = (serverForm.http_base || '').replace(/\/+$/, '') || window.location.origin;
                          const nm = serverForm.name ? encodeURIComponent(serverForm.name) : '<name>';
                          return `${base}/api/mcp2/${nm}/events`;
                        } catch {
                          return `${window.location.origin}/api/mcp2/<name>/events`;
                        }
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <SmallButton onClick={async()=>{ try { if (!serverForm.name) return alert('Set Name before copying'); const base=(serverForm.http_base||'').replace(/\/+$/,'') || window.location.origin; const url=`${base}/api/mcp2/${encodeURIComponent(serverForm.name)}/events`; await navigator.clipboard.writeText(url); } catch {} }}>Copy</SmallButton>
                    <SmallButton
                      onClick={async()=>{ try {
                        if (!serverForm.name) return alert('Set Name before copying');
                        if (!serverForm.token || !serverForm.require_token) return alert('Enable Require token and set Token first');
                        const base=(serverForm.http_base||'').replace(/\/+$/,'') || window.location.origin;
                        const url=appendTokenQuery(`${base}/api/mcp2/${encodeURIComponent(serverForm.name)}/events`, serverForm.token);
                        await navigator.clipboard.writeText(url);
                      } catch {} }}
                      disabled={!serverForm.require_token || !serverForm.token}
                    >
                      Copy + token
                    </SmallButton>
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="truncate">
                    <span className="text-gray-500">Stream URL:</span>{' '}
                    <span className="font-mono">
                      {(() => {
                        try {
                          const base = (serverForm.http_base || '').replace(/\/+$/, '') || window.location.origin;
                          const nm = serverForm.name ? encodeURIComponent(serverForm.name) : '<name>';
                          return `${base}/api/mcp2/${nm}/stream`;
                        } catch {
                          return `${window.location.origin}/api/mcp2/<name>/stream`;
                        }
                      })()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <SmallButton onClick={async()=>{ try { if (!serverForm.name) return alert('Set Name before copying'); const base=(serverForm.http_base||'').replace(/\/+$/,'') || window.location.origin; const url=`${base}/api/mcp2/${encodeURIComponent(serverForm.name)}/stream`; await navigator.clipboard.writeText(url); } catch {} }}>Copy</SmallButton>
                    <SmallButton
                      onClick={async()=>{ try {
                        if (!serverForm.name) return alert('Set Name before copying');
                        if (!serverForm.token || !serverForm.require_token) return alert('Enable Require token and set Token first');
                        const base=(serverForm.http_base||'').replace(/\/+$/,'') || window.location.origin;
                        const url=appendTokenQuery(`${base}/api/mcp2/${encodeURIComponent(serverForm.name)}/stream`, serverForm.token);
                        await navigator.clipboard.writeText(url);
                      } catch {} }}
                      disabled={!serverForm.require_token || !serverForm.token}
                    >
                      Copy + token
                    </SmallButton>
                  </div>
                </div>
                {serverForm.require_token ? (
                  <div className="mt-1 text-[11px] text-gray-500">
                    Auth required: OpenAI must send <span className="font-mono">Authorization: Bearer …</span> or use <span className="font-mono">?token=…</span>.
                  </div>
                ) : null}
              </div>
              <div className="flex items-end gap-2">
                <label className="inline-flex items-center text-sm select-none mr-2">
                  <input type="checkbox" className="mr-2" checked={!!serverForm.require_token} onChange={(e)=>setServerForm({...serverForm, require_token: !!e.target.checked})} />
                  Require token
                </label>
                <div className="flex-1"><TextInput label="Token" value={serverForm.token} onChange={(v)=>setServerForm({...serverForm, token:v})} placeholder="Auth token (blank to disable)" /></div>
                <SmallButton onClick={async()=>{ try { if (serverForm.token) await navigator.clipboard.writeText(serverForm.token); } catch {} }} disabled={!serverForm.token}>Copy</SmallButton>
                <SmallButton onClick={regenerateToken} disabled={!serverForm.require_token}>Regenerate</SmallButton>
              </div>
              <div className="flex items-center gap-4 mt-2">
                <label className="inline-flex items-center text-sm select-none">
                  <input type="checkbox" className="mr-2" checked={!!serverForm.persist_disabled} onChange={(e)=>togglePersistence(!!e.target.checked)} disabled={persistBusy} />
                  Disable persistence (always read from profile)
                </label>
                <SmallButton onClick={clearPersistedNow} disabled={!editServerId || clearBusy}>Clear persisted now</SmallButton>
                {(persistBusy || clearBusy) ? <span className="text-xs text-gray-500">Applying…</span> : null}
              </div>
              <label className="inline-flex items-center text-sm select-none">
                <input type="checkbox" className="mr-2" checked={!!serverForm.enabled} onChange={(e)=>setServerForm({...serverForm, enabled: !!e.target.checked})} />
                Enabled
              </label>
              <TextInput label="Notes" value={serverForm.notes} onChange={(v)=>setServerForm({...serverForm, notes:v})} />
              {/* Preferred URL selection and local process settings removed */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SmallButton onClick={() => testServer(editServerId || null)}>Test</SmallButton>
                  <SmallButton onClick={importFromProfile} disabled={!editServerId || importBusy}>Import from profile</SmallButton>
                  <SmallButton onClick={saveServerConfig} disabled={!editServerId || saveCfgBusy}>Save config</SmallButton>
                  <SmallButton onClick={() => loadRecentRpc(serverForm.name)} disabled={!serverForm.name || recentRpcLoading}>Last 5 RPC</SmallButton>
                  {(importBusy || saveCfgBusy) ? <span className="text-xs text-gray-500">Working…</span> : null}
                </div>
                <div className="space-x-2">
                  {editServerId && <SmallButton kind="danger" onClick={() => deleteServer(editServerId)}>Delete</SmallButton>}
                  <SmallButton onClick={beginNew}>Reset</SmallButton>
                  <SmallButton kind="primary" onClick={saveServer}>{editServerId? 'Save' : 'Create'}</SmallButton>
                </div>
              </div>
              {serverForm.name && (
                <div className="mt-3 border rounded">
                  <div className="px-2 py-1 border-b bg-gray-50 text-[11px] text-gray-600 flex items-center justify-between">
                    <div>Recent RPC (last 5)</div>
                    <div className="flex items-center gap-2">
                      {recentRpcLoading ? <span className="text-gray-500">Loading…</span> : null}
                      <SmallButton onClick={() => loadRecentRpc(serverForm.name)} disabled={recentRpcLoading}>Refresh</SmallButton>
                      <SmallButton onClick={() => setRecentRpc([])} disabled={!recentRpc.length}>Clear</SmallButton>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-auto">
                    {(recentRpc || []).slice().reverse().map((it, idx) => (
                      <div key={idx} className="px-2 py-2 border-b last:border-b-0 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-gray-700">
                            <span className="font-mono">{it.method || '—'}</span>
                            {it.id != null ? <span className="text-gray-500"> • id={String(it.id)}</span> : null}
                          </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">{it.ts ? new Date(it.ts).toLocaleString() : ''}</span>
                          <SmallButton onClick={() => setViewer({ title: `RPC ${it.method || ''}`, json: JSON.stringify(it, null, 2) })}>View</SmallButton>
                        </div>
                        </div>
                      </div>
                    ))}
                    {(!recentRpc || recentRpc.length === 0) && (
                      <div className="px-2 py-3 text-[11px] text-gray-500">
                        No RPC calls recorded yet. OpenAI must connect and call `tools/list` first.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Section>
          
          {/* Tools panel for selected server */}
          {editServerId && (
            <Section title="Server Tools">
              <div className="mb-2 text-xs text-gray-600">
                Type: <span className="font-mono">{serverForm.type_id || '—'}</span>
                {serverForm.type_id ? (
                  <span className="ml-2 text-gray-500">({(typeOpts||[]).find(t=>t.value===serverForm.type_id)?.label || 'type'})</span>
                ) : null}
              </div>
              {editing && String(editing.type_id || '') !== String(serverForm.type_id || '') && (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
                  Type was changed locally. Click <span className="font-medium">Save</span>, then <span className="font-medium">Refresh</span> to load tools for the new type.
                </div>
              )}
              {!serverForm.type_id && (
                <div className="text-xs text-gray-500">Select a Type to view and toggle tools for this server.</div>
              )}
              {serverForm.type_id && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-600">
                      {(() => {
                        const s = serverToolsMeta.source;
                        if (s === 'type') return 'Tools from type standard tools';
                        return 'Tools from type standard tools';
                      })()}
                    </div>
                  <div className="space-x-2">
                    <SmallButton onClick={() => loadServerTools(editServerId)} disabled={serverToolsLoading}>{serverToolsLoading? 'Loading…' : 'Refresh'}</SmallButton>
                    <SmallButton
                      kind="primary"
                      onClick={seedTypeToolsFromProfile}
                      disabled={seedBusy || !serverForm.origin_module || !serverForm.origin_profile_id || !serverForm.type_id}
                    >
                      {seedBusy ? 'Seeding…' : 'Seed type tools'}
                    </SmallButton>
                    <SmallButton onClick={() => setTab('types')}>Types</SmallButton>
                  </div>
                  </div>
                  <div className="border rounded">
                    <div className="grid grid-cols-12 px-2 py-1 border-b bg-gray-50 text-[11px] text-gray-600">
                      <div className="col-span-6">Name</div>
                      <div className="col-span-5">Description</div>
                      <div className="col-span-1 text-right">On</div>
                    </div>
                    <div>
                      {(serverTools || []).map((t) => (
                        <div key={t.tool_id || t.name} className="grid grid-cols-12 px-2 py-1 border-b last:border-b-0 text-sm items-center">
                          <div className="col-span-6 font-mono truncate" title={t.name}>{t.name}</div>
                          <div className="col-span-5 text-xs text-gray-600 truncate" title={t.description||''}>{t.description || ''}</div>
                          <div className="col-span-1 text-right flex items-center justify-end gap-2">
                            <input
                              type="checkbox"
                              checked={!!t.enabled}
                              disabled={t.toggleable === false}
                              title={t.toggleable === false ? 'This tool is not in the MCP2 tool catalog yet. Seed type tools (or add it under Types) to enable per-server toggles.' : ''}
                              onChange={async (e)=>{
                              const checked = !!e.target.checked;
                              // Optimistic update
                              setServerTools((arr)=> (arr||[]).map(x=> (x.tool_id ? x.tool_id===t.tool_id : x.name===t.name) ? { ...x, enabled: checked } : x));
                              try {
                                const r = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/tools`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ tool_id: t.tool_id || null, name: t.name, enabled: checked }) });
                                const j = await r.json().catch(()=>({}));
                                if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'toggle_failed');
                                // Reload persisted ON list
                                try { await loadPersisted(editServerId); } catch {}
                              } catch (err) {
                                // Revert on error
                                setServerTools((arr)=> (arr||[]).map(x=> (x.tool_id ? x.tool_id===t.tool_id : x.name===t.name) ? { ...x, enabled: !checked } : x));
                                alert(String(err?.message || err));
                              }
                            }}
                            />
                            <SmallButton
                              kind="secondary"
                              onClick={() => setViewer({
                                title: `Tool definition: ${t.name}`,
                                json: JSON.stringify({
                                  input_schema: t.inputSchema || {},
                                  code: t.code || {},
                                }, null, 2),
                              })}
                            >
                              Def
                            </SmallButton>
                          </div>
                        </div>
                      ))}
                      {(!serverTools || !serverTools.length) && (
                        <div className="px-2 py-2 text-xs text-gray-500">
                          No tools found. Add tools under <span className="font-medium">Types</span>, or seed from the selected Origin Profile.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Resources panel for selected server */}
          {editServerId && (
            <Section title="Server Resources">
              <div className="mb-2 text-xs text-gray-600">Origin Module: <span className="font-mono">{serverForm.origin_module || '—'}</span></div>
              {!serverForm.origin_module && (
                <div className="text-xs text-gray-500">Select an Origin Module and Profile to view and toggle resources.</div>
              )}
              {serverForm.origin_module && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-600">{(() => { const s = serverResourcesMeta.source; return `Resources from ${s==='server' ? 'stored server config' : (s==='profile' ? 'selected profile' : 'module')}` })()}</div>
                    <div className="space-x-2">
                      <SmallButton onClick={() => openEditResource(null)} disabled={!editServerId}>Add</SmallButton>
                      <SmallButton onClick={() => loadServerResources(editServerId)} disabled={serverResourcesLoading}>{serverResourcesLoading? 'Loading…' : 'Refresh'}</SmallButton>
                    </div>
                  </div>
                  <div className="border rounded">
                    <div className="grid grid-cols-12 px-2 py-1 border-b bg-gray-50 text-[11px] text-gray-600">
                      <div className="col-span-5">URI</div>
                      <div className="col-span-4">Name</div>
                      <div className="col-span-2">mimeType</div>
                      <div className="col-span-1 text-right">On</div>
                    </div>
                    <div>
                      {(serverResources || []).map((r) => (
                        <div key={r.uri} className="grid grid-cols-12 px-2 py-1 border-b last:border-b-0 text-sm items-center">
                          <div className="col-span-5 font-mono truncate" title={r.uri}>{r.uri}</div>
                          <div className="col-span-4 text-xs text-gray-600 truncate" title={r.name||''}>{r.name || ''}</div>
                          <div className="col-span-2 text-xs text-gray-600 truncate" title={r.mimeType||''}>{r.mimeType || ''}</div>
                          <div className="col-span-1 text-right flex items-center justify-end gap-2">
                            <input type="checkbox" checked={!!r.enabled} onChange={async (e)=>{
                              const checked = !!e.target.checked;
                              setServerResources((arr)=> (arr||[]).map(x=> x.uri===r.uri ? { ...x, enabled: checked } : x));
                              try {
                                const resp = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/resources`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ uri: r.uri, enabled: checked }) });
                                const jj = await resp.json().catch(()=>({}));
                                if (!resp.ok || jj?.ok===false) throw new Error(jj?.message || jj?.error || 'toggle_failed');
                                try { await loadPersisted(editServerId); } catch {}
                              } catch (err) {
                                setServerResources((arr)=> (arr||[]).map(x=> x.uri===r.uri ? { ...x, enabled: !checked } : x));
                                alert(String(err?.message || err));
                              }
                            }} />
                            <SmallButton onClick={()=>openEditResource(r)}>Edit</SmallButton>
                            <SmallButton onClick={()=>showPersisted('resource', r.uri)}>View</SmallButton>
                            <SmallButton onClick={()=>copyPersisted('resource', r.uri)}>Copy</SmallButton>
                          </div>
                        </div>
                      ))}
                      {(!serverResources || !serverResources.length) && (
                        <div className="px-2 py-2 text-xs text-gray-500">No resources found.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Resource Templates panel for selected server */}
          {editServerId && (
            <Section title="Server Resource Templates">
              <div className="mb-2 text-xs text-gray-600">Origin Module: <span className="font-mono">{serverForm.origin_module || '—'}</span></div>
              {!serverForm.origin_module && (
                <div className="text-xs text-gray-500">Select an Origin Module and Profile to view and toggle resource templates.</div>
              )}
              {serverForm.origin_module && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-gray-600">{(() => { const s = serverTplsMeta.source; return `Templates from ${s==='server' ? 'stored server config' : (s==='profile' ? 'selected profile' : 'module')}` })()}</div>
                    <div className="space-x-2">
                      <SmallButton onClick={() => openEditTemplate(null)} disabled={!editServerId}>Add</SmallButton>
                      <SmallButton onClick={() => loadServerTpls(editServerId)} disabled={serverTplsLoading}>{serverTplsLoading? 'Loading…' : 'Refresh'}</SmallButton>
                    </div>
                  </div>
                  <div className="border rounded">
                    <div className="grid grid-cols-12 px-2 py-1 border-b bg-gray-50 text-[11px] text-gray-600">
                      <div className="col-span-6">Name</div>
                      <div className="col-span-5">Description</div>
                      <div className="col-span-1 text-right">On</div>
                    </div>
                    <div>
                      {(serverTpls || []).map((t) => (
                        <div key={t.name} className="grid grid-cols-12 px-2 py-1 border-b last:border-b-0 text-sm items-center">
                          <div className="col-span-6 font-mono truncate" title={t.name}>{t.name}</div>
                          <div className="col-span-5 text-xs text-gray-600 truncate" title={t.description||''}>{t.description || ''}</div>
                          <div className="col-span-1 text-right flex items-center justify-end gap-2">
                            <input type="checkbox" checked={!!t.enabled} onChange={async (e)=>{
                              const checked = !!e.target.checked;
                              setServerTpls((arr)=> (arr||[]).map(x=> x.name===t.name ? { ...x, enabled: checked } : x));
                              try {
                                const resp = await fetch(`/api/mcp2/servers/${encodeURIComponent(editServerId)}/resource-templates`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ name: t.name, enabled: checked }) });
                                const jj = await resp.json().catch(()=>({}));
                                if (!resp.ok || jj?.ok===false) throw new Error(jj?.message || jj?.error || 'toggle_failed');
                                try { await loadPersisted(editServerId); } catch {}
                              } catch (err) {
                                setServerTpls((arr)=> (arr||[]).map(x=> x.name===t.name ? { ...x, enabled: !checked } : x));
                                alert(String(err?.message || err));
                              }
                            }} />
                            <SmallButton onClick={()=>openEditTemplate(t)}>Edit</SmallButton>
                            <SmallButton onClick={()=>showPersisted('template', t.name)}>View</SmallButton>
                            <SmallButton onClick={()=>copyPersisted('template', t.name)}>Copy</SmallButton>
                          </div>
                        </div>
                      ))}
                      {(!serverTpls || !serverTpls.length) && (
                        <div className="px-2 py-2 text-xs text-gray-500">No resource templates found.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* Embedded inspector for selected server */}
          {editServerId && (
            <div className="mt-3">
              <McpInspectorPanel servers={servers} defaultServerId={editServerId} />
            </div>
          )}
          </div>
        </div>
      )}

      {viewer ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={()=>setViewer(null)}>
          <div className="bg-white rounded shadow-lg max-w-3xl w-full m-4" onClick={(e)=>e.stopPropagation()}>
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <div className="text-sm font-medium">{viewer.title}</div>
              <div className="space-x-2">
                <SmallButton onClick={async()=>{ try { await navigator.clipboard.writeText(viewer.json || ''); alert('Copied JSON'); } catch { alert('Copy failed'); } }}>Copy JSON</SmallButton>
                <SmallButton onClick={()=>setViewer(null)}>Close</SmallButton>
              </div>
            </div>
            <div className="p-3">
              <pre className="text-xs whitespace-pre-wrap">{viewer.json}</pre>
            </div>
          </div>
        </div>
      ) : null}

      <JsonEditModal
        open={!!jsonEditor}
        title={jsonEditor?.title || 'Edit JSON'}
        value={jsonEditor?.value}
        onClose={() => { if (!jsonSaving) setJsonEditor(null); }}
        onSave={jsonEditor?.onSave}
        saving={jsonSaving}
      />

    </div>
  );
}




