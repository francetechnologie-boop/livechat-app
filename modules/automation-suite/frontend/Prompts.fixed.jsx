import React, { useEffect, useMemo, useState } from "react";

function Field({ label, children, hint }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-600">{label}</div>
      <div>{children}</div>
      {hint ? <div className="text-[11px] text-gray-500">{hint}</div> : null}
    </div>
  );
}

export default function Prompts() {
  const API_BASE = useMemo(() => {
    try {
      if (typeof window !== 'undefined' && window && window.location) {
        const p = window.location.pathname || '';
        if (p.startsWith('/mcp-dev-prestashop/')) return '/mcp/mcp-dev-prestashop';
        if (p.startsWith('/mcp/')) return '/mcp';
      }
    } catch {}
    return '/api';
  }, []);
  // Two-pane editor state
  const [note] = useState('Local Prompt repository — reusable across chatbots.');
  const [bots, setBots] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [form, setForm] = useState({ name:'', dev_message:'', openai_api_key:'', prompt_id:'', prompt_version:'', vector_store_id:'', messages: [], tools: { file_search:false, code_interpreter:false, function:false, web_search:false } });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assigned, setAssigned] = useState([]); // chatbot_ids
  const [assignSel, setAssignSel] = useState({}); // id_bot -> boolean
  const [testMsg, setTestMsg] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testOut, setTestOut] = useState('');
  const [testReq, setTestReq] = useState('');

  // Organization OpenAI key presence (display-only)
  const [orgHasKey, setOrgHasKey] = useState(false);
  useEffect(() => {
    (async () => {
      try { const r = await fetch('/api/orgs/me', { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok && j.item) setOrgHasKey(!!j.item.has_key); } catch {}
    })();
  }, []);

  // MCP servers association (per prompt)
  const [srvList, setSrvList] = useState([]);
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvAssigned, setSrvAssigned] = useState([]); // array of mcp_server_id
  const [srvSel, setSrvSel] = useState({}); // id -> boolean
  const [srvAssignBusy, setSrvAssignBusy] = useState(false);
  const [srvLinked, setSrvLinked] = useState([]);
  const [srvLinkedBusy, setSrvLinkedBusy] = useState(false);
  // Link a saved MCP server to this prompt
  const [srvLinkSel, setSrvLinkSel] = useState('');
  const [srvLinkBusy, setSrvLinkBusy] = useState(false);
  // Upload to a linked MCP server
  const [srvUploadTarget, setSrvUploadTarget] = useState('');

  const [srvUploadMsg, setSrvUploadMsg] = useState('');
  // Upload selection/state for linked MCP server uploads
  const [srvUploadFiles, setSrvUploadFiles] = useState([]);
  const [srvUploading, setSrvUploading] = useState(false);
  // Files per linked server
  const [srvFiles, setSrvFiles] = useState({}); // { [serverId]: { loading, files, error } }
  const [srvAllowed, setSrvAllowed] = useState({}); // { [serverId]: Set(toolNames) }
  const [srvTransport, setSrvTransport] = useState({}); // { [serverId]: 'sse' | 'stream' }
  // Whether to call legacy admin endpoints to fetch tokens when a server token is missing
  const [useAdminTokenFallback, setUseAdminTokenFallback] = useState(() => {
    try { return localStorage.getItem('useAdminMcpTokenFallback') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { if (useAdminTokenFallback) localStorage.setItem('useAdminMcpTokenFallback','1'); else localStorage.removeItem('useAdminMcpTokenFallback'); } catch {}
  }, [useAdminTokenFallback]);
  const copy = async (text) => { try { await navigator.clipboard.writeText(String(text || '')); } catch {} };
  const formatBytes = (b) => {
    const n = Number(b || 0);
    if (!isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    const units = ['KB','MB','GB','TB'];
    let v = n; let i = -1; do { v /= 1024; i++; } while (v >= 1024 && i < units.length-1);
    return `${v.toFixed(1)} ${units[i]}`;
  };
  const formatIso = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return ''; } };
  const serverPathForKind = (kind) => (String(kind||'').toLowerCase()==='dev' ? '/mcp-dev' : '/mcp');
  const buildServerUrl = (s, path) => {
    const base = (s?.http_base && /^https?:\/\//i.test(s.http_base)) ? s.http_base.replace(/\/$/, '') : '';
    return base ? `${base}${path}` : path;
  };
  const getServerToken = (s) => {
    try { const saved = (srvList || []).find(x => x.id === s.id); return saved?.token || ''; } catch { return ''; }
  };
  const loadFilesForServer = async (s) => {
    if (!s || !s.id) return;
    setSrvFiles((m)=>({ ...m, [s.id]: { ...(m[s.id]||{}), loading:true, error:'' } }));
    try {
      const kind = String(s.kind || '').toLowerCase();
      if (kind === 'dev-prestashop') {
        setSrvFiles((m)=>({ ...m, [s.id]: { loading:false, files:[], error:'Files not supported for PrestaShop dev' } }));
        return;
      }
      const basePath = serverPathForKind(kind);
      const urlPath = `${basePath}/files?limit=50`;
      let token = getServerToken(s);
      if (useAdminTokenFallback && !token) {
        try {
          const url = kind === 'dev' ? '/api/admin/mcp-dev/token' : '/api/admin/mcp/token';
          const rTok = await fetch(url, { credentials:'include' });
          const jTok = await rTok.json();
          if (rTok.ok && jTok?.ok != null) token = jTok.token || '';
        } catch {}
      }
      let url = buildServerUrl(s, urlPath);
      const sep = url.includes('?') ? '&' : '?';
      if (token) url = `${url}${sep}token=${encodeURIComponent(token)}`;
      let creds = 'include';
      try { const uo = new URL(url, window.location.href); if (uo.origin !== window.location.origin) creds = 'omit'; } catch {}
      const r = await fetch(url, { credentials: creds });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || `http_${r.status}`);
      const files = Array.isArray(j.files) ? j.files : [];
      setSrvFiles((m)=>({ ...m, [s.id]: { loading:false, files, error:'' } }));
    } catch (e) {
      setSrvFiles((m)=>({ ...m, [s.id]: { loading:false, files:(m[s.id]?.files||[]), error: String(e?.message || e) } }));
    }
  };
  const downloadUrlFor = (s, fileId) => {
    const kind = String(s.kind || '').toLowerCase();
    const basePath = serverPathForKind(kind);
    const token = getServerToken(s);
    let url = buildServerUrl(s, `${basePath}/file/${encodeURIComponent(fileId)}/download`);
    if (token) url += (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
    return url;
  };

  // Load chatbots and prompt list
  const loadBots = async () => {
    try { const r = await fetch(`${API_BASE}/automations/chatbots`, { credentials:'include' }); const j = await r.json(); setBots(Array.isArray(j) ? j : []); } catch {}
  };
  const loadPrompts = async () => {
    setLoadingList(true);
    try { const r = await fetch(`${API_BASE}/prompt-configs`, { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok) setItems(Array.isArray(j.items)? j.items: []); } catch {}
    finally { setLoadingList(false); }
  };
  const loadServers = async () => {
    setSrvLoading(true);
    try {
      const r = await fetch(`/api/mcp-servers`, { credentials: 'include' });
      const j = await r.json();
      setSrvList(r.ok && j?.ok ? (Array.isArray(j.items) ? j.items : []) : []);
    } catch { setSrvList([]); }
    finally { setSrvLoading(false); }
  };
  useEffect(()=>{ loadBots(); loadPrompts(); loadServers(); }, []);
  // Auto-load linked MCP servers when a prompt is selected
  useEffect(() => {
    (async () => {
      if (!selectedId) { setSrvLinked([]); setSrvAllowed({}); setSrvTransport({}); return; }
      try {
        setSrvLinkedBusy(true);
        const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials:'include' });
        const j = await r.json();
        const list = r.ok && j?.ok ? (Array.isArray(j.servers) ? j.servers : []) : [];
        setSrvLinked(list);
        const map = {}; const tmap = {};
        list.forEach(s=>{ const def = Array.isArray(s.allowed_tools) ? s.allowed_tools : (Array.isArray(s.tools)? s.tools.map(t=>t.name): []); map[s.id] = new Set(def); const pref = (s.options && typeof s.options==='object' && s.options.server_url_pref==='stream') ? 'stream' : 'sse'; tmap[s.id] = pref; });
        setSrvAllowed(map); setSrvTransport(tmap);
      } catch { setSrvLinked([]); }
      finally { setSrvLinkedBusy(false); }
    })();
  }, [selectedId]);
  // Compute available MCP servers (not yet linked to this prompt)
  const availableServers = useMemo(() => {
    try {
      const linkedIds = new Set((srvLinked || []).map(s => s && s.id));
      return (srvList || []).filter(sv => sv && !linkedIds.has(sv.id));
    } catch { return srvList || []; }
  }, [srvList, srvLinked]);

  const linkServer = async (id) => {
    if (!selectedId || !id) return;
    setSrvLinkBusy(true);
    try {
      const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/assign`, {
        method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ server_ids: [id] })
      });
      if (!r.ok) {
        try { const j = await r.json(); alert(j?.message || j?.error || 'Link failed'); } catch { alert('Link failed'); }
      }
      try {
        setSrvLinkedBusy(true);
        const rr = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials:'include' });
        const jj = await rr.json();
        const list = rr.ok && jj?.ok ? (Array.isArray(jj.servers) ? jj.servers : []) : [];
        setSrvLinked(list);
      } catch { setSrvLinked([]); } finally { setSrvLinkedBusy(false); }
    } catch (e) { alert(String(e?.message || e)); } finally { setSrvLinkBusy(false); }
  };
  const pick = async (id) => {
    setSelectedId(id);
    if (!id) { setForm({ name:'', dev_message:'', openai_api_key:'', prompt_id:'', prompt_version:'', vector_store_id:'', tools:{ file_search:false, code_interpreter:false, function:false, web_search:false } }); setAssigned([]); setAssignSel({}); return; }
    try {
      const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(id)}`, { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) {
        const it = j.item;
        setForm({
          name: it.name||'',
          dev_message: it.dev_message||'',
          openai_api_key: it.openai_api_key||'',
          prompt_id: it.prompt_id||'',
          prompt_version: it.prompt_version||'',
          vector_store_id: it.vector_store_id||'',
          messages: Array.isArray(it.messages)? it.messages: [],
          tools: {
            file_search: !!(it.tools && it.tools.file_search),
            code_interpreter: !!(it.tools && it.tools.code_interpreter),
            function: !!(it.tools && it.tools.function),
            web_search: !!(it.tools && it.tools.web_search),
          },
        });
      }
    } catch {}
    try {
      const r2 = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(id)}/chatbots`, { credentials:'include' });
      const j2 = await r2.json();
      if (r2.ok && j2?.ok) { setAssigned(Array.isArray(j2.chatbot_ids)? j2.chatbot_ids: []); const map={}; (j2.chatbot_ids||[]).forEach(x=>map[x]=true); setAssignSel(map); }
    } catch {}
    // Load associated MCP servers
    try {
      const r3 = await fetch(`/api/prompt-configs/${encodeURIComponent(id)}/mcp-servers`, { credentials:'include' });
      const j3 = await r3.json();
      if (r3.ok && j3?.ok) {
        const list = Array.isArray(j3.servers) ? j3.servers : [];
        setSrvLinked(list);
        const ids = list.map(s => s.id);
        setSrvAssigned(ids);
        const smap = {}; ids.forEach(x => smap[x] = true); setSrvSel(smap);
      } else { setSrvLinked([]); setSrvAssigned([]); setSrvSel({}); }
    } catch { setSrvLinked([]); setSrvAssigned([]); setSrvSel({}); }
  };
  const createNew = async () => {
    const name = prompt('Prompt name');
    if (!name) return;
    try {
      const r = await fetch(`${API_BASE}/prompt-configs`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ name }) });
      const j = await r.json();
      if (r.ok && j?.ok) { await loadPrompts(); pick(j.item.id); }
      else alert('Create failed');
    } catch (e) { alert('Create failed: ' + (e?.message || e)); }
  };
  const saveServerAssignments = async () => {
    if (!selectedId) { alert('Select a prompt first'); return; }
    setSrvAssignBusy(true);
    try {
      const want = Object.entries(srvSel).filter(([,v])=>!!v).map(([k])=>k);
      const curr = new Set(srvAssigned);
      const add = want.filter(id=>!curr.has(id));
      const rem = srvAssigned.filter(id=>!want.includes(id));
      if (add.length) await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/assign`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ server_ids: add }) });
      if (rem.length) await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/unassign`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ server_ids: rem }) });
      setSrvAssigned(want);
      // reload linked details
      try {
        setSrvLinkedBusy(true);
        const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials:'include' });
        const j = await r.json();
        setSrvLinked(r.ok && j?.ok ? (Array.isArray(j.servers) ? j.servers : []) : []);
      } catch { setSrvLinked([]); }
      finally { setSrvLinkedBusy(false); }
    } catch (e) { alert('Save failed: ' + (e?.message || e)); }
    finally { setSrvAssignBusy(false); }
  };
  const savePrompt = async () => {
    if (!selectedId) { alert('Select a prompt first'); return; }
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.message || j?.error || 'save_failed');
      await loadPrompts();
    } catch (e) { alert('Save failed: ' + (e?.message || e)); }
    finally { setSaving(false); }
  };
  const addMsg = () => setForm(f => ({ ...f, messages: [ ...(Array.isArray(f.messages)? f.messages: []), { role:'user', content:'' } ] }));
  const updateMsg = (idx, patch) => setForm(f => {
    const arr = Array.isArray(f.messages)? [...f.messages]: [];
    arr[idx] = { ...(arr[idx]||{ role:'user', content:'' }), ...patch };
    return { ...f, messages: arr };
  });
  const removeMsg = (idx) => setForm(f => {
    const arr = Array.isArray(f.messages)? [...f.messages]: [];
    arr.splice(idx,1);
    return { ...f, messages: arr };
  });
  const moveMsg = (idx, dir) => setForm(f => {
    const arr = Array.isArray(f.messages)? [...f.messages]: [];
    const j = idx + dir; if (j<0 || j>=arr.length) return f;
    const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
    return { ...f, messages: arr };
  });
  const copyOpenAIJson = async () => {
    const payload = { developer_message: form.dev_message || '', messages: Array.isArray(form.messages)? form.messages: [], tools: form.tools || {} };
    try { await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); alert('Copied.'); } catch { alert('Copy failed'); }
  };
  const deletePrompt = async () => {
    if (!selectedId) return; if (!confirm('Delete this prompt?')) return;
    setDeleting(true);
    try { const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}`, { method:'DELETE', credentials:'include' }); if (!r.ok) throw new Error('delete_failed'); setSelectedId(''); await loadPrompts(); }
    catch (e) { alert('Delete failed: ' + (e?.message || e)); }
    finally { setDeleting(false); }
  };
  const saveAssignments = async () => {
    if (!selectedId) { alert('Select a prompt first'); return; }
    setAssignBusy(true);
    try {
      const want = Object.entries(assignSel).filter(([,v])=>!!v).map(([k])=>k);
      const curr = new Set(assigned);
      const add = want.filter(id=>!curr.has(id));
      const rem = assigned.filter(id=>!want.includes(id));
      if (add.length) await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/assign`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ chatbot_ids: add }) });
      if (rem.length) await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/unassign`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ chatbot_ids: rem }) });
      setAssigned(want);
    } catch (e) { alert('Assign failed: ' + (e?.message || e)); }
    finally { setAssignBusy(false); }
  };

  const testThisPrompt = async () => {
    if (!selectedId) { alert('Select a prompt first'); return; }
    if (!testMsg.trim()) { alert('Enter a message'); return; }
    setTestBusy(true); setTestOut(''); setTestReq('');
    try {
      const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/test`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ input: testMsg }) });
      const j = await r.json();
      if (r.ok && j?.ok) {
        setTestOut(j.text || JSON.stringify(j));
        try { setTestReq(JSON.stringify(j.request_body || j.request || {}, null, 2)); } catch { setTestReq(''); }
      } else {
        setTestOut(j?.message || j?.error || 'test_failed');
        try { setTestReq(JSON.stringify(j.request_body || j.request || {}, null, 2)); } catch { setTestReq(''); }
      }
    } catch (e) { setTestOut(String(e?.message || e)); }
    finally { setTestBusy(false); }
  };

  // Preview helpers
  const previewObj = useMemo(() => {
    const toolsMap = form.tools || {};
    const messages = Array.isArray(form.messages) ? form.messages : [];
    return {
      instructions: form.dev_message || '',
      seed_messages: messages,
      tools: toolsMap,
      input: '<user input>'
    };
  }, [form.dev_message, form.messages, form.tools]);
  const approxTokens = useMemo(() => {
    const messages = Array.isArray(form.messages) ? form.messages : [];
    const chars = (form.dev_message || '').length + messages.reduce((n,m)=> n + (m?.content||'').length + (m?.role||'').length, 0);
    return Math.max(1, Math.ceil(chars / 4)) + messages.length + 10;
  }, [form.dev_message, form.messages]);
  const copyPreview = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(previewObj, null, 2)); alert('Preview copied'); } catch { alert('Copy failed'); }
  };

  // MCP status panel
  const [mcp, setMcp] = useState(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpMain, setMcpMain] = useState(null);
  const [mcpMainBusy, setMcpMainBusy] = useState(false);
  const [mcpToken, setMcpToken] = useState('');
  const [vecBusy, setVecBusy] = useState(false);
  const [vecMsg, setVecMsg] = useState('');
  const [vecFiles, setVecFiles] = useState([]);
  const [vecLoading, setVecLoading] = useState(false);
  const [vecError, setVecError] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read_failed'));
      reader.onload = () => {
        try {
          const res = String(reader.result || '');
          const comma = res.indexOf(',');
          resolve(comma >= 0 ? res.slice(comma + 1) : res);
        } catch (e) { reject(e); }
      };
      reader.readAsDataURL(file);
    } catch (e) { reject(e); }
  });
  const loadMcp = async () => {
    setMcpBusy(true);
    try { const r = await fetch(`${API_BASE}/local-prompts/mcp/dev-prestashop`, { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok) setMcp(j); else setMcp(null); }
    catch { setMcp(null); }
    finally { setMcpBusy(false); }
  };
  const loadMcpMain = async () => {
    setMcpMainBusy(true);
    try {
      const r = await fetch(`/mcp/status`, { credentials:'include' });
      const j = await r.json();
      setMcpMain(r.ok && j?.ok ? j : null);
    } catch { setMcpMain(null); }
    finally { setMcpMainBusy(false); }
  };
  const loadMcpToken = async () => {
    try {
      const r = await fetch(`/api/admin/mcp/token`, { credentials:'include' });
      const j = await r.json();
      setMcpToken(r.ok && j?.ok ? (j.token || '') : '');
    } catch { setMcpToken(''); }
  };
  useEffect(()=>{ loadMcp(); loadMcpMain(); loadMcpToken(); }, []);

  // Vector stores list for linking
  const [vecPickLoading, setVecPickLoading] = useState(false);
  const [vecPickError, setVecPickError] = useState('');
  const [vecPickList, setVecPickList] = useState([]);
  const linkedVectorIds = useMemo(() => {
    try {
      const set = new Set();
      const arr = Array.isArray(form.vector_store_ids) ? form.vector_store_ids : [];
      for (const id of arr) { const s=String(id||'').trim(); if (s) set.add(s); }
      const single = String(form.vector_store_id||'').trim(); if (single) set.add(single);
      return Array.from(set);
    } catch { return []; }
  }, [form.vector_store_ids, form.vector_store_id]);
  const loadVectorStores = async () => {
    setVecPickLoading(true); setVecPickError('');
    try {
      const r = await fetch(`/api/vector-stores?limit=100&org=me`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || r.status);
      setVecPickList(Array.isArray(j.items)? j.items: []);
    } catch (e) { setVecPickError(String(e?.message||e)); }
    finally { setVecPickLoading(false); }
  };
  useEffect(()=>{ loadVectorStores(); }, []);
  const linkSelectedVector = async (id) => {
    if (!selectedId || !id) return;
    try {
      const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/vector-stores/link`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ id }) });
      const j = await r.json();
      if (r.ok && j?.ok) setForm(f=>({ ...f, vector_store_ids: Array.isArray(j.vector_store_ids)? j.vector_store_ids: (Array.isArray(f.vector_store_ids)? f.vector_store_ids: []).concat(id) }));
      else alert(j?.message || j?.error || 'Link failed');
    } catch (e) { alert(String(e?.message||e)); }
  };
  const unlinkVectorStoreId = async (idToRemove) => {
    if (!selectedId || !idToRemove) return;
    try {
      const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/vector-stores/unlink`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ id: idToRemove }) });
      const j = await r.json();
      if (r.ok && j?.ok) setForm(f=>({ ...f, vector_store_ids: Array.isArray(j.vector_store_ids)? j.vector_store_ids: (Array.isArray(f.vector_store_ids)? f.vector_store_ids.filter(x=>x!==idToRemove):[]) }));
      else alert(j?.message || j?.error || 'Unlink failed');
    } catch (e) { alert(String(e?.message||e)); }
  };

  const loadVectorInfo = async () => {
    if (!selectedId) { setVecFiles([]); return; }
    setVecLoading(true); setVecError('');
    try {
      const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/vector-store`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || r.status);
      const files = Array.isArray(j?.files) ? j.files : [];
      setVecFiles(files);
      if (j?.vector_store_id && j.vector_store_id !== (form.vector_store_id||'')) {
        setForm(f=>({ ...f, vector_store_id: j.vector_store_id }));
      }
    } catch (e) { setVecError(String(e?.message || e)); }
    finally { setVecLoading(false); }
  };
  useEffect(() => { loadVectorInfo(); }, [selectedId]);
  // Also populate vector_store_ids for the linked list UI
  useEffect(() => {
    const run = async () => {
      if (!selectedId) return;
      try {
        const r = await fetch(`${API_BASE}/prompt-configs/${encodeURIComponent(selectedId)}/vector-store`, { credentials:'include' });
        const j = await r.json();
        if (r.ok && j?.ok && Array.isArray(j.vector_store_ids)) {
          setForm(f=>({ ...f, vector_store_ids: j.vector_store_ids }));
        }
      } catch {}
    };
    run();
  }, [selectedId]);
  useEffect(() => { if (selectedId) loadVectorInfo(); }, [form.vector_store_id]);
  // MCP upload selection/state
  const [mcpUploadFiles, setMcpUploadFiles] = useState([]);
  const [mcpUploading, setMcpUploading] = useState(false);

  const uploadToMcp = async () => {
    if (!mcpUploadFiles.length) { alert('Choose files first.'); return; }
    if (!mcpToken) { alert('MCP token missing. See Admin → Development to set one.'); return; }
    setMcpUploading(true); setUploadMsg('');
    try {
      let uploaded = 0;
      for (const f of mcpUploadFiles) {
        const b64 = await fileToBase64(f);
        const body = { filename: f.name, content_base64: b64, content_type: f.type || 'application/octet-stream' };
        const r = await fetch(`/mcp/files/base64?token=${encodeURIComponent(mcpToken)}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
        const j = await r.json();
        if (r.ok && j?.ok) uploaded++; else throw new Error(j?.message || j?.error || 'upload_failed');
      }
      setUploadMsg(`Uploaded ${uploaded} file(s) to MCP`);
      setMcpUploadFiles([]);
    } catch (e) { setUploadMsg(String(e?.message || e)); }
    finally { setMcpUploading(false); }
  };
  // Vector link UI state (mirrors MCP UI)
  const [vecLinkSel, setVecLinkSel] = useState('');

  // Old per-chatbot local editor removed (use repository + assignments)

  return (
    <div className="h-full w-full flex min-h-0">
      {/* Left: list */}
      <aside className="w-72 border-r bg-white p-3 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Prompts</div>
          <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={createNew}>New</button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-area">
          {loadingList && <div className="text-xs text-gray-500 p-2">Chargement…</div>}
          {(items || []).map((it) => (
            <button key={it.id} onClick={()=>pick(it.id)} className={`w-full text-left px-3 py-2 rounded mb-1 hover:bg-gray-50 ${selectedId===it.id?'bg-blue-50':''}`}>
              <div className="font-medium text-sm">{it.name}</div>
              <div className="text-[11px] text-gray-500">{it.id}</div>
            </button>
          ))}
          {!items?.length && !loadingList && <div className="text-xs text-gray-500 p-2">Aucun.</div>}
        </div>
      </aside>

      {/* Right: editor */}
      <main className="flex-1 p-4 min-h-0 overflow-y-auto scroll-area">
        <div className="text-lg font-semibold mb-2">Prompt configuration</div>
        <div className="p-3 border rounded bg-amber-50 text-[13px] text-amber-800 mb-3">{note}</div>

        {!selectedId && <div className="text-sm text-gray-500">Select a prompt on the left, or click New.</div>}
        {selectedId && (
          <div className="space-y-4 max-w-3xl">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{form.name || 'Sans nom'}</div>
              <div className="flex items-center gap-2">
                <button className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" onClick={savePrompt} disabled={saving}>{saving?'Saving…':'Save'}</button>
                <button className="text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-60" onClick={deletePrompt} disabled={deleting}>Delete</button>
              </div>
            </div>

            <div className="space-y-3">
              <Field label="Prompts name"><input className="w-full border rounded px-3 py-2" value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})} /></Field>
              <Field label="OpenAI API Key (serveur)"><input className="w-full border rounded px-3 py-2" value={form.openai_api_key||''} onChange={(e)=>setForm({...form, openai_api_key:e.target.value})} placeholder="sk-..." /></Field>
              <div className="text-[11px] text-gray-600 -mt-2">Organization key: {orgHasKey ? 'set' : 'not set'}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Prompt ID (Responses)"><input className="w-full border rounded px-3 py-2" value={form.prompt_id||''} onChange={(e)=>setForm({...form, prompt_id:e.target.value})} placeholder="pmpt_..." /></Field>
                <Field label="Prompt version"><input className="w-full border rounded px-3 py-2" value={form.prompt_version||''} onChange={(e)=>setForm({...form, prompt_version:e.target.value})} placeholder="1" /></Field>
              </div>
              <Field label="Developer message"><textarea className="w-full border rounded px-3 py-2" rows={5} value={form.dev_message||''} onChange={(e)=>setForm({...form, dev_message:e.target.value})} placeholder="You are a helpful assistant..." /></Field>
              <div className="space-y-2">
                <div className="text-xs text-gray-600">Prompt messages (few‑shot)</div>
                <div className="space-y-2">
                  {(Array.isArray(form.messages) ? form.messages : []).map((m, idx) => (
                    <div key={idx} className="p-2 border rounded bg-gray-50">
                      <div className="flex items-center gap-2 mb-1">
                        <select className="border rounded px-2 py-1 text-sm" value={m.role||'user'} onChange={(e)=>updateMsg(idx,{ role:e.target.value })}>
                          <option value="system">system</option>
                          <option value="user">user</option>
                          <option value="assistant">assistant</option>
                        </select>
                        <div className="flex-1" />
                        <button className="text-xs px-2 py-0.5 rounded border bg-white hover:bg-gray-100" onClick={()=>moveMsg(idx,-1)} disabled={idx===0}>↑</button>
                        <button className="text-xs px-2 py-0.5 rounded border bg-white hover:bg-gray-100" onClick={()=>moveMsg(idx,1)} disabled={idx===(form.messages.length-1)}>↓</button>
                        <button className="text-xs px-2 py-0.5 rounded border bg-white hover:bg-gray-100 text-red-700" onClick={()=>removeMsg(idx)}>Remove</button>
                      </div>
                      <textarea className="w-full border rounded px-2 py-1 text-sm" rows={3} value={m.content||''} onChange={(e)=>updateMsg(idx,{ content:e.target.value })} placeholder="Example message content..." />
                    </div>
                  ))}
                  {!form.messages?.length && <div className="text-[11px] text-gray-500">No messages. Add few‑shot examples below.</div>}
                </div>
                <div className="flex items-center gap-2">
                  <button className="text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50" onClick={addMsg}>Add message</button>
                  <button className="text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50" onClick={copyOpenAIJson}>Copy OpenAI UI JSON</button>
                </div>
              </div>
              {/* Tools section removed */}
            </div>

            {/* Test this prompt (moved above Function) */}
            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-2">Test this prompt</div>
              <textarea className="w-full border rounded px-3 py-2" rows={4} value={testMsg} onChange={(e)=>setTestMsg(e.target.value)} placeholder="Write a test message..." />
              <div className="mt-2 flex items-center gap-2">
                <button className="text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60" onClick={testThisPrompt} disabled={testBusy || !testMsg.trim() || !selectedId}>{testBusy?'Testing.':'Test'}</button>
                <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>{ setTestOut(''); setTestReq(''); }}>Clear</button>
              </div>
              {!!testOut && <pre className="mt-2 text-sm bg-gray-50 border rounded p-2 whitespace-pre-wrap max-h-64 overflow-auto">{testOut}</pre>}
              {!!testReq && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium">OpenAI Request (effective)</div>
                    <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>navigator.clipboard.writeText(testReq)}>Copy</button>
                  </div>
                  <pre className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap max-h-64 overflow-auto">{testReq}</pre>
                </div>
              )}
            </div>


            {/* Summary */}
            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-1">Summary</div>
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block mb-2">OpenAI API is not ready yet, you need to make set from OpenAI UI</div>
              <div className="text-sm space-y-2">
                {/* MCP Servers */}
                {Array.isArray(srvLinked) && srvLinked.length > 0 && (
                  <div>
                    <div className="text-xs font-medium mb-1">Associated MCP Servers</div>
                    <div className="space-y-1">
                      {srvLinked.map((s)=>{
                        const pref = (srvTransport?.[s.id]||((s.options&&s.options.server_url_pref)==='stream'?'stream':'sse'));
                        const url = pref==='stream' ? (s.stream_url||'') : (s.sse_url||'');
                        return (
                          <div key={s.id} className="text-[12px]">
                            <span className="font-medium mr-1">{s.name||s.id}</span>
                            <code className="px-1 py-0.5 bg-gray-50 border rounded mr-1">{pref.toUpperCase()}</code>
                            <code className="px-1 py-0.5 bg-gray-50 border rounded mr-1 break-all">{url||'(no URL)'}</code>
                            {s.token && <><code className="px-1 py-0.5 bg-gray-50 border rounded mr-1">{s.token}</code><button className="text-[11px] px-1 py-0.5 border rounded" onClick={()=>navigator.clipboard.writeText(s.token)}>Copy token</button></>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* File Search */}
                {form?.tools?.file_search && (
                  <div>
                    <div className="text-xs font-medium mb-1">File Search</div>
                    <div className="text-[12px] space-y-1">
                      {linkedVectorIds.length ? linkedVectorIds.map(id=>{
                        const v=(vecPickList||[]).find(x=>x.id===id); const name=v?.name||id;
                        return (
                          <div key={id}>
                            <span className="mr-2">{name}</span>
                            <code className="px-1 py-0.5 bg-gray-50 border rounded mr-1">{id}</code>
                            <button className="text-[11px] px-1 py-0.5 border rounded" onClick={()=>navigator.clipboard.writeText(id)}>Copy ID</button>
                          </div>
                        );
                      }) : (<div className="text-gray-500">No linked vector stores.</div>)}
                    </div>
                  </div>
                )}
                {/* Web Search */}
                {form?.tools?.web_search && (
                  <div>
                    <div className="text-xs font-medium mb-1">Web Search</div>
                    <div className="text-[12px] space-y-1">
                      {(Array.isArray(form.tools?.web_search_allowed_domains)? form.tools.web_search_allowed_domains: []).map((d)=>(
                        <div key={d} className="flex items-center gap-2"><code className="px-1 py-0.5 bg-gray-50 border rounded">{d}</code><button className="text-[11px] px-1 py-0.5 border rounded" onClick={()=>navigator.clipboard.writeText(d)}>Copy</button></div>
                      ))}
                      {!(Array.isArray(form.tools?.web_search_allowed_domains) && form.tools.web_search_allowed_domains.length) && (
                        <div className="text-gray-500">No domains; unrestricted.</div>
                      )}
                    </div>
                  </div>
                )}
                {/* Code Interpreter */}
                {form?.tools?.code_interpreter && (
                  <div><div className="text-xs font-medium">Code interpreter</div><div className="text-[12px]">Enabled</div></div>
                )}
                {/* Image Generation */}
                {form?.tools?.image_generation && (
                  <div><div className="text-xs font-medium">Image Generation</div><div className="text-[12px]">Enabled</div></div>
                )}
              </div>
            </div>            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-2">Associated MCP Servers (linked)</div>
              <div className="text-xs text-gray-600 mb-2">Servers linked to this prompt. Click a row to expand details.</div>
              <div className="flex items-center gap-2 mb-2">
                <button className="text-xs px-2 py-1 rounded border" onClick={async()=>{ if (!selectedId) return; try { setSrvLinkedBusy(true); const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials:'include' }); const j = await r.json(); const list = r.ok && j?.ok ? (Array.isArray(j.servers) ? j.servers : []) : []; setSrvLinked(list);
                  // initialize allowed map and transport preference
                  const map = {}; const tmap = {};
                  list.forEach(s=>{ const def = Array.isArray(s.allowed_tools) ? s.allowed_tools : (Array.isArray(s.tools)? s.tools.map(t=>t.name): []); map[s.id] = new Set(def); const pref = (s.options && typeof s.options==='object' && s.options.server_url_pref==='stream') ? 'stream' : 'sse'; tmap[s.id] = pref; }); setSrvAllowed(map); setSrvTransport(tmap);
                } catch { setSrvLinked([]); } finally { setSrvLinkedBusy(false); } }}>Refresh</button>
                {srvLinkedBusy && <span className="text-[11px] text-gray-600">Loading…</span>}
              </div>
              {/* Link a server */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <select className="border rounded px-2 py-1 text-sm min-w-[220px]" value={srvLinkSel} onChange={(e)=>setSrvLinkSel(e.target.value)}>
                  <option value="">Select server to link…</option>
                  {srvList
                    .filter(sv => !(srvLinked || []).some(ls => ls.id === sv.id))
                    .map(sv => (
                      <option key={sv.id} value={sv.id}>{sv.name || sv.id} {sv.kind ? `(${sv.kind})` : ''}</option>
                    ))}
                </select>
                <button className="text-xs px-2 py-1 rounded border disabled:opacity-60" disabled={!srvLinkSel || srvLinkBusy || !selectedId} onClick={async()=>{
                  if (!selectedId || !srvLinkSel) return;
                  setSrvLinkBusy(true);
                  try {
                    const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/assign`, {
                      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ server_ids: [srvLinkSel] })
                    });
                    if (!r.ok) {
                      try { const j = await r.json(); alert(j?.message || j?.error || 'Link failed'); } catch { alert('Link failed'); }
                    }
                    // Refresh linked list
                    try {
                      setSrvLinkedBusy(true);
                      const rr = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials:'include' });
                      const jj = await rr.json();
                      const list = rr.ok && jj?.ok ? (Array.isArray(jj.servers) ? jj.servers : []) : [];
                      setSrvLinked(list);
                      const map = {}; list.forEach(sv=>{ const def = Array.isArray(sv.allowed_tools) ? sv.allowed_tools : (Array.isArray(sv.tools)? sv.tools.map(t=>t.name): []); map[sv.id] = new Set(def); }); setSrvAllowed(map);
                    } catch { setSrvLinked([]); }
                    finally { setSrvLinkedBusy(false); }
                    setSrvLinkSel('');
                  } catch (e) {
                    alert(String(e?.message || e));
                  } finally { setSrvLinkBusy(false); }
                }}>{srvLinkBusy ? 'Linking…' : 'Link'}</button>
              </div>
              {(!srvLinked || !srvLinked.length) && (
                <div className="text-sm text-gray-500">No linked MCP servers.</div>
              )}
              {!!(srvLinked && srvLinked.length) && (
                <div className="border rounded bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2">Name</th>
                        <th className="text-left px-3 py-2">Group</th>
                        <th className="text-left px-3 py-2">Server Type</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-right px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {srvLinked.map((s, idx) => (
                        <React.Fragment key={s.id}>
                          <tr className="border-t hover:bg-gray-50 cursor-pointer" onClick={()=>{
                            setSrvFiles(m=>({ ...m, [`exp_${s.id}`]: !m[`exp_${s.id}`] }));
                            // Initialize allowed map and transport for this server if missing
                            setSrvAllowed(prev => {
                              if (prev && prev[s.id]) return prev;
                              const def = Array.isArray(s.allowed_tools) ? s.allowed_tools : (Array.isArray(s.tools)? s.tools.map(t=>t.name): []);
                              return { ...(prev||{}), [s.id]: new Set(def) };
                            });
                            setSrvTransport(prev => {
                              if (prev && prev[s.id]) return prev;
                              const pref = (s.options && typeof s.options==='object' && s.options.server_url_pref==='stream') ? 'stream' : 'sse';
                              return { ...(prev||{}), [s.id]: pref };
                            });
                          }}>
                            <td className="px-3 py-2">{s.name || s.id}</td>
                            <td className="px-3 py-2">{s.group_name || '-'}</td>
                            <td className="px-3 py-2">{s.server_type || s.kind || '-'}</td>
                            <td className="px-3 py-2">{s.enabled ? 'Enabled' : 'Disabled'}</td>
                            <td className="px-3 py-2 text-right" onClick={(e)=>e.stopPropagation()}>
                              <button className="text-[11px] px-2 py-0.5 border rounded text-red-700 hover:bg-red-50"
                                onClick={async()=>{
                                  if (!selectedId) return;
                                  if (!confirm(`Unlink ${s.name || s.id} from this prompt?`)) return;
                                  try {
                                    await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers/unassign`, {
                                      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
                                      body: JSON.stringify({ server_ids: [s.id] })
                                    });
                                  } catch {}
                                  // Refresh linked list
                                  try {
                                    setSrvLinkedBusy(true);
                                    const r = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials:'include' });
                                    const j = await r.json();
                                    const list = r.ok && j?.ok ? (Array.isArray(j.servers) ? j.servers : []) : [];
                                    setSrvLinked(list);
                                    const map = {}; list.forEach(s=>{ const def = Array.isArray(s.allowed_tools) ? s.allowed_tools : (Array.isArray(s.tools)? s.tools.map(t=>t.name): []); map[s.id] = new Set(def); }); setSrvAllowed(map);
                                  } catch { setSrvLinked([]); } finally { setSrvLinkedBusy(false); }
                                }}>Unlink</button>
                            </td>
                          </tr>
                          { (srvFiles[`exp_${s.id}`]) && (
                            <tr className="bg-gray-50">
                              <td colSpan={5} className="px-4 py-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <div>
                                    <div className="text-xs text-gray-600 mb-1">Streamable HTTP (Inspector)</div>
                                    <div className="flex items-center gap-2">
                                      <code className="flex-1 text-xs bg-white border rounded px-2 py-1 break-all">{s.stream_url || '-'}</code>
                                      <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=>copy(s.stream_url||'')}>Copy</button>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-gray-600 mb-1">SSE URL (OpenAI Responses server_url)</div>
                                    <div className="flex items-center gap-2">
                                      <code className="flex-1 text-xs bg-white border rounded px-2 py-1 break-all">{s.sse_url || '-'}</code>
                                      <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=>copy(s.sse_url||'')}>Copy</button>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-gray-600 mb-1">Token</div>
                                    <div className="flex items-center gap-2">
                                      <code className="flex-1 text-xs bg-white border rounded px-2 py-1 break-all">{s.token || '(none)'}</code>
                                      <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=>copy(s.token||'')}>Copy</button>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-gray-600 mb-1">OpenAI Responses URL</div>
                                    <div className="flex items-center gap-3 text-sm">
                                      <label className="inline-flex items-center gap-1"><input type="radio" name={`tx_${s.id}`} checked={(srvTransport?.[s.id]||'sse')==='sse'} onChange={()=>setSrvTransport(m=>({ ...(m||{}), [s.id]:'sse' }))} /> SSE (server_url)</label>
                                      <label className="inline-flex items-center gap-1"><input type="radio" name={`tx_${s.id}`} checked={(srvTransport?.[s.id]||'sse')==='stream'} onChange={()=>setSrvTransport(m=>({ ...(m||{}), [s.id]:'stream' }))} /> Streamable HTTP</label>
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-gray-600 mb-1">Tools</div>
                                    <div className="text-xs bg-white border rounded p-2 max-h-40 overflow-auto space-y-1">
                                      {(Array.isArray(s.tools) && s.tools.length)
                                        ? s.tools.map((t)=>{
                                            const sid = s.id; const set = srvAllowed[sid] || new Set(); const on = set.has(t.name);
                                            return (
                                              <label key={t.name} className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                  <input type="checkbox" checked={on} onChange={(e)=>{
                                                    setSrvAllowed((prev)=>{ const copyMap={...prev}; const curr=new Set(copyMap[sid]||[]); if (e.target.checked) curr.add(t.name); else curr.delete(t.name); copyMap[sid]=curr; return copyMap; });
                                                  }} />
                                                  <code className="px-1">{t.name}</code>
                                                </div>
                                                <span className="text-[11px] text-gray-500 flex-1">{t.description||''}</span>
                                              </label>
                                            );
                                          })
                                        : (<div className="text-gray-500">(none)</div>)}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                      <button className="text-[11px] px-2 py-0.5 border rounded" onClick={async()=>{
                                        try {
                                          const names = Array.from(srvAllowed[s.id] || []);
                                          // Merge with current options to preserve other fields
                                          const opts = (s.options && typeof s.options==='object') ? s.options : {};
                                          const body = { options: { ...opts, allowed_tools: names, server_url_pref: (srvTransport?.[s.id]||'sse') } };
                                          const r = await fetch(`/api/mcp-servers/${encodeURIComponent(s.id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                                          const j = await r.json().catch(()=>({}));
                                          if (!r.ok || j?.ok === false) alert(j?.message || j?.error || 'Save failed');
                                          else {
                                            // Refresh the linked list to reflect saved allowed_tools
                                            try {
                                              setSrvLinkedBusy(true);
                                              const rr = await fetch(`/api/prompt-configs/${encodeURIComponent(selectedId)}/mcp-servers`, { credentials:'include' });
                                              const jj = await rr.json();
                                              const list = rr.ok && jj?.ok ? (Array.isArray(jj.servers) ? jj.servers : []) : [];
                                              setSrvLinked(list);
                                              const map = {}; const tmap = {};
                                              list.forEach(sv=>{ const def = Array.isArray(sv.allowed_tools) ? sv.allowed_tools : (Array.isArray(sv.tools)? sv.tools.map(t=>t.name): []); map[sv.id] = new Set(def); tmap[sv.id] = (sv.options && typeof sv.options==='object' && sv.options.server_url_pref) ? (sv.options.server_url_pref === 'stream' ? 'stream' : 'sse') : 'sse'; }); setSrvAllowed(map); setSrvTransport(tmap);
                                            } catch { }
                                            finally { setSrvLinkedBusy(false); }
                                          }
                                        } catch (e) { alert(String(e?.message||e)); }
                                      }}>Save settings</button>
                                      <span className="text-[11px] text-gray-500">Applied server-wide</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>                </div>)}
                <div className="mt-3">
                  <div className="text-xs font-medium mb-1">Available MCP Servers</div>
                  <div className="border rounded bg-white">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-3 py-2">Name</th>
                          <th className="text-left px-3 py-2">Group</th>
                          <th className="text-left px-3 py-2">Type</th>
                          <th className="text-left px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(!availableServers || !availableServers.length) ? (
                          <tr>
                            <td className="px-3 py-2 text-sm text-gray-500" colSpan={4}>No available servers.</td>
                          </tr>
                        ) : (
                          availableServers.map(s => (
                            <tr key={s.id}>
                              <td className="px-3 py-2">{s.name || s.id}</td>
                              <td className="px-3 py-2">{s.group_name || s.group || '-'}</td>
                              <td className="px-3 py-2">{s.kind || 'custom'}</td>
                              <td className="px-3 py-2">
                                <button className="text-xs px-2 py-1 border rounded" onClick={()=>linkServer(s.id)}>Link</button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                
            </div>

            {/* Linked MCP Servers (this prompt) — removed */}
            {false && (
            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-2">Linked MCP Servers (this prompt)</div>
              <div className="text-xs text-gray-600 mb-2">Choose which saved MCP servers are associated to this prompt. Use the MCP Servers tab to add/edit servers.</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                {srvLoading && (<div className="text-xs text-gray-500">Loading servers…</div>)}
                {!srvLoading && srvList.map(s => (
                  <label key={s.id} className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!srvSel[s.id]} onChange={(e)=>setSrvSel(m=>({ ...m, [s.id]: e.target.checked }))} />
                    <span>{s.name || s.id} <span className="text-[11px] text-gray-500">({s.kind || 'custom'})</span></span>
                  </label>
                ))}
                {!srvLoading && !srvList?.length && (
                  <div className="text-xs text-gray-500">No saved MCP servers.</div>
                )}
              </div>
              <div className="flex items-center justify-end mt-2">
                <button className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" onClick={saveServerAssignments} disabled={srvAssignBusy || !selectedId}>{srvAssignBusy?'Saving…':'Save links'}</button>
              </div>
              {/* Upload controls (within linked servers section) */}
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs text-gray-600 mb-1">Upload files to a linked MCP server</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Target server</div>
                    <select className="border rounded px-2 py-1 text-sm w-full" value={srvUploadTarget} onChange={(e)=>{ setSrvUploadTarget(e.target.value); setSrvUploadMsg(''); }}>
                      <option value="">Select…</option>
                      {srvLinked.map(s => (
                        <option key={s.id} value={s.id}>
                          {(s.name || s.id)} {s.kind ? `(${s.kind})` : ''}
                        </option>
                      ))}
                    </select>
                    <div className="text-[11px] text-gray-500 mt-1">Supported kinds: main (/mcp) and dev (/mcp-dev). PrestaShop dev does not support direct file uploads.</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Files</div>
                    <input type="file" multiple onChange={(e)=>setSrvUploadFiles(Array.from(e.target.files || []))} className="text-sm" />
                    <div className="mt-2 flex items-center gap-2">
                      <button className="text-xs px-2 py-1 rounded border" disabled={!srvUploadTarget || !srvUploadFiles.length || srvUploading} onClick={async()=>{
                        if (!srvUploadTarget || !srvUploadFiles.length) return;
                        setSrvUploading(true); setSrvUploadMsg('');
                        try {
                          const s = srvLinked.find(x => x.id === srvUploadTarget);
                          if (!s) throw new Error('server_not_found');
                          const kind = (s.kind || '').toLowerCase();
                          if (kind === 'dev-prestashop') throw new Error('upload_not_supported_for_prestashop');
                          const pathBase64 = kind === 'dev' ? '/mcp-dev/files/base64' : '/mcp/files/base64';
                          const pathStream = kind === 'dev' ? '/mcp-dev/files/upload' : '/mcp/files/upload';
                          const saved = srvList.find(x => x.id === s.id);
                          let token = saved?.token || '';
                          if (useAdminTokenFallback && !token) {
                            try {
                              const url = kind === 'dev' ? '/api/admin/mcp-dev/token' : '/api/admin/mcp/token';
                              const rTok = await fetch(url, { credentials:'include' });
                              const jTok = await rTok.json();
                              if (rTok.ok && jTok?.ok != null) token = jTok.token || '';
                            } catch {}
                          }
                          let urlBase64 = pathBase64;
                          let urlStream = pathStream;
                          if (s.http_base && /^https?:\/\//i.test(s.http_base)) {
                            const base = s.http_base.replace(/\/$/, '');
                            urlBase64 = `${base}${pathBase64}`;
                            urlStream = `${base}${pathStream}`;
                          }
                          let uploaded = 0;
                          for (const f of srvUploadFiles) {
                            const large = f.size && f.size > (8 * 1024 * 1024);
                            if (large) {
                              const sep = urlStream.includes('?') ? '&' : '?';
                              const u = `${urlStream}${sep}filename=${encodeURIComponent(f.name)}&content_type=${encodeURIComponent(f.type||'application/octet-stream')}${token?`&token=${encodeURIComponent(token)}`:''}`;
                              let creds = 'include';
                              try { const uo = new URL(u, window.location.href); if (uo.origin !== window.location.origin) creds = 'omit'; } catch {}
                              const r = await fetch(u, { method:'POST', headers:{ 'Content-Type': f.type || 'application/octet-stream' }, credentials: creds, body: f });
                              const j = await r.json().catch(()=>({}));
                              if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || `upload_failed_${r.status}`);
                              uploaded++;
                            } else {
                              const b64 = await fileToBase64(f);
                              const body = { filename: f.name, content_base64: b64, content_type: f.type || 'application/octet-stream' };
                              const sep = urlBase64.includes('?') ? '&' : '?';
                              const u = token ? `${urlBase64}${sep}token=${encodeURIComponent(token)}` : urlBase64;
                              let creds = 'include';
                              try { const uo = new URL(u, window.location.href); if (uo.origin !== window.location.origin) creds = 'omit'; } catch {}
                              const r = await fetch(u, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials: creds, body: JSON.stringify(body) });
                              const j = await r.json().catch(()=>({}));
                              if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || `upload_failed_${r.status}`);
                              uploaded++;
                            }
                          }
                          setSrvUploadMsg(`Uploaded ${uploaded} file(s)`);
                          setSrvUploadFiles([]);
                        } catch (e) { setSrvUploadMsg(String(e?.message || e)); }
                        finally { setSrvUploading(false); }
                      }}> {srvUploading ? 'Uploading…' : 'Upload'} </button>
                      {!!srvUploadMsg && <span className="text-[11px] text-gray-600">{srvUploadMsg}</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* File Search (Vector Store) */}
            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-2">Associated Vector Stores (linked)</div>
              <div className="flex items-center gap-2 mb-3">
                <button className="text-xs px-3 py-1 rounded-full border" onClick={loadVectorStores}>Refresh</button>
              </div>
              <div className="mb-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!(form.tools && form.tools.file_search)} onChange={(e)=>setForm(f=>({ ...f, tools: { ...(f.tools||{}), file_search: !!e.target.checked } }))} />
                  <span>Enable File Search</span>
                </label>
              </div>
              {Array.isArray(form.vector_store_ids) && form.vector_store_ids.length > 0 ? (
                <div className="border rounded bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2">Name</th>
                        <th className="text-left px-3 py-2">ID</th>
                        <th className="text-right px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.vector_store_ids.map((id)=>{
                        const v=(vecPickList||[]).find(x=>x.id===id) || { id, name:id };
                        return (
                          <tr key={id} className="border-t">
                            <td className="px-3 py-2">{v.name || id}</td>
                            <td className="px-3 py-2 font-mono">{id}</td>
                            <td className="px-3 py-2 text-right">
                              <button className="text-[11px] px-3 py-0.5 border rounded-full" onClick={()=>navigator.clipboard.writeText(id)}>Copy ID</button>
                              <button className="ml-2 text-[11px] px-3 py-0.5 border rounded-full text-red-700 hover:bg-red-50" onClick={()=>unlinkVectorStoreId(id)}>Unlink</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-gray-500">No linked vector stores.</div>
              )}

              {/* Available Vector Stores */}
              <div className="mt-3">
                <div className="text-xs font-medium mb-1">Available Vector Stores</div>
                <div className="border rounded bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2">Name</th>
                        <th className="text-left px-3 py-2">ID</th>
                        <th className="text-left px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const linked = new Set(Array.isArray(form.vector_store_ids)? form.vector_store_ids: []);
                        const avail = (vecPickList||[]).filter(v => v && !linked.has(v.id));
                        if (!avail.length) return (
                          <tr><td className="px-3 py-2 text-sm text-gray-500" colSpan={3}>No available vector stores.</td></tr>
                        );
                        return avail.map(v => (
                          <tr key={v.id} className="border-t">
                            <td className="px-3 py-2">{v.name || v.id}</td>
                            <td className="px-3 py-2 font-mono">{v.id}</td>
                            <td className="px-3 py-2">
                              <button className="text-xs px-3 py-1 border rounded-full" onClick={()=>linkSelectedVector(v.id)}>Link</button>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="font-medium mb-2 mt-4">File Search</div>
              <div className="mb-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!(form.tools && form.tools.file_search)}
                    onChange={(e)=>setForm(f=>({ ...f, tools: { ...(f.tools||{}), file_search: !!e.target.checked } }))}
                  />
                  <span>Enable File Search</span>
                </label>
              </div>
              </div>

            {/* Function (TODO) */}
            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-1">Function</div>
              <div className="text-xs text-gray-500">(à faire)</div>
            </div>

            {/* Web Search */}
            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-1">Web Search</div>
              <div className="mb-1">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!(form.tools && form.tools.web_search)}
                    onChange={(e)=>setForm(f=>({ ...f, tools: { ...(f.tools||{}), web_search: !!e.target.checked } }))}
                  />
                  <span>Enable Web Search</span>
                </label>
              </div>
              <div className="text-xs text-gray-500">Toggle on to allow the model to use web_search.</div>
            </div>

            {/* Code interpreter (TODO) */}
            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-1">Code interpreter</div>
              <div className="text-xs text-gray-500">(à faire)</div>
            </div>

            {/* Image Generation (TODO) */}
            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-1">Image Generation</div>
              <div className="text-xs text-gray-500">(à faire)</div>
            </div>

            {/* Custom (TODO) */}
            <div className="p-3 border rounded bg-white">
              <div className="font-medium mb-1">Custom</div>
              <div className="text-xs text-gray-500">(à faire)</div>
            </div>

            {/* Assigned chatbots section removed */}

            <div className="p-3 border rounded bg-white">
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium">Preview (Request Payload)</div>
                <div className="text-[11px] text-gray-600">~{approxTokens} tokens (approx)</div>
              </div>
              <pre className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap max-h-64 overflow-auto">{JSON.stringify(previewObj, null, 2)}</pre>
              <div className="flex items-center justify-end mt-2">
                <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={copyPreview}>Copy preview</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
