import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadModuleState, saveModuleState } from '@app-lib/uiState';
import { markdownToHtmlSafe } from '../../../frontend/utils/rich.js';
import CompanyChatTabsManager, { CompanyChatTabsBar } from './components/CompanyChatTabsManager.jsx';

export default function CompanyChat() {
  // Breadcrumb: base only
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Company Chat'] })); } catch {}
  }, []);
  const [cfg, setCfg] = useState({ model: '', prompt_id: '', prompt_version: '', prompt_cfg_id: '', api_key: '' });
  // Saved selection summary (chatbot → prompt → MCP servers)
  const [selSummary, setSelSummary] = useState([]);
  const [selSummaryBusy, setSelSummaryBusy] = useState(false);
  const [selSummaryErr, setSelSummaryErr] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewDump, setPreviewDump] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  function buildEffectivePayloadFromSelection() {
    const list = Array.isArray(selSummary) ? selSummary : [];
    // Union MCP servers across all selected chatbots
    const byName = new Map();
    let anyWebSearch = false;
    let modelEff = '';
    let remotePromptId = '';
    for (const it of list) {
      if (!modelEff && it?.model) modelEff = it.model;
      if (!remotePromptId && it?.remotePromptId) remotePromptId = it.remotePromptId;
      if (it?.promptTools?.web_search) anyWebSearch = true;
      const sv = Array.isArray(it?.servers) ? it.servers : [];
      for (const s of sv) {
        const name = String(s?.name || '').trim(); if (!name) continue;
        if (!byName.has(name)) byName.set(name, s);
      }
    }
    const tools = [];
    for (const s of byName.values()) {
      const allowed = Array.isArray(s.allowedNames) && s.allowedNames.length ? s.allowedNames
        : (Array.isArray(s.toolNames) ? s.toolNames : []);
      tools.push({
        type: 'mcp', server_label: s.name, server_url: s.url,
        require_approval: 'never', authorization: '<set on server>', allowed_tools: allowed,
      });
    }
    if (anyWebSearch) tools.push({ type: 'web_search' });
    const payload = {
      tools,
      model: modelEff || (cfg && cfg.model) || 'gpt-5',
      ...(remotePromptId ? { prompt: { id: remotePromptId } } : {}),
      input: (input || '').trim() || '<your message here>',
    };
    return payload;
  }
  const refreshPreview = async () => {
    setPreviewBusy(true);
    try { setPreviewDump(JSON.stringify(buildEffectivePayloadFromSelection(), null, 2)); }
    catch { setPreviewDump(''); }
    finally { setPreviewBusy(false); }
  };
  const copyEffectivePreview = async () => {
    try { await copy(JSON.stringify(buildEffectivePayloadFromSelection(), null, 2)); } catch {}
  };
  // Company Chat — selectable chatbots
  const [allBots, setAllBots] = useState([]);
  // Question types as tabs (each tab maps to a prompt profile)
  const [tabs, setTabs] = useState([]);
  const [tabsBusy, setTabsBusy] = useState(false);
  const [tabsErr, setTabsErr] = useState('');
  const [activeTabId, setActiveTabId] = useState(() => {
    try {
      const st = loadModuleState('company-chat');
      return st.activeTabId || localStorage.getItem('cc_active_tab_id') || '';
    } catch { return ''; }
  });
  const effectiveBotIds = useMemo(() => {
    try {
      const activeTab = (Array.isArray(tabs) ? tabs : []).find((t) => String(t.id) === String(activeTabId)) || null;
      const tabBots = Array.isArray(activeTab?.chatbot_ids) ? activeTab.chatbot_ids.map(String).filter(Boolean) : [];
      return tabBots;
    } catch {
      return [];
    }
  }, [tabs, activeTabId]);
  const [transport, setTransport] = useState(() => {
    try { const st = loadModuleState('company-chat'); return st.transport || localStorage.getItem('cc_transport') || 'mcp'; } catch { return 'mcp'; }
  });
  const [approval, setApproval] = useState(() => {
    try { const st = loadModuleState('company-chat'); return st.approval || localStorage.getItem('cc_approval') || 'never'; } catch { return 'never'; }
  });
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', content: string, meta?: any }
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(() => {
    try { const st = loadModuleState('company-chat'); return st.sessionId || localStorage.getItem('cc_last_session_id') || ''; } catch { return ''; }
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reqDump, setReqDump] = useState('');
  const [toolOutDump, setToolOutDump] = useState('');
  const [respDump, setRespDump] = useState('');
  // Bottom panels: tabbed (one open at a time)
  const [activePanel, setActivePanel] = useState(() => {
    try { const st = loadModuleState('company-chat'); return String(st.activePanel || ''); } catch { return ''; }
  });
  const bottomRef = useRef(null);

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(String(text || '')); } catch {}
  };

  useEffect(() => { try { saveModuleState('company-chat', { activePanel }); } catch {} }, [activePanel]);

  // Signed MCP link helpers
  const signedCache = useRef({});
  function extractMcpDownloads(txt = '') {
    const out = [];
    try {
      const re = /(\/mcp(?:-dev)?\/file\/([A-Za-z0-9._-]+)\/download)/g;
      let m;
      while ((m = re.exec(String(txt)))) {
        const path = m[1];
        const id = m[2];
        const kind = path.startsWith('/mcp-dev') ? 'dev' : 'prod';
        out.push({ path, id, kind });
      }
    } catch {}
    return out;
  }
  async function signLink(kind, id) {
    const key = `${kind}:${id}`;
    if (signedCache.current[key]) return signedCache.current[key];
    const url = kind === 'dev' ? '/api/mcp-dev/file/signed-url' : '/api/mcp/file/signed-url';
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ id }) });
    const j = await r.json();
    if (r.ok && j?.ok && j?.url) { signedCache.current[key] = j.url; return j.url; }
    throw new Error(j?.message || j?.error || 'sign_failed');
  }
  const openSigned = async (kind, id) => { try { const u = await signLink(kind, id); window.open(u, '_blank', 'noopener'); } catch {} };
  const copySigned = async (kind, id) => { try { const u = await signLink(kind, id); await copy(u); } catch {} };

  const formatTimestamp = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return '';
    }
  };
  const needTimestamp = (prevIso, currIso) => {
    if (!currIso) return false;
    if (!prevIso) return true;
    try {
      const a = new Date(prevIso).getTime();
      const b = new Date(currIso).getTime();
      if (!isFinite(a) || !isFinite(b)) return true;
      const dayA = new Date(prevIso).toDateString();
      const dayB = new Date(currIso).toDateString();
      if (dayA !== dayB) return true;
      return (b - a) > 10 * 60 * 1000; // 10 minutes
    } catch { return true; }
  };
  // (feedback removed by request)

  // Server-side OpenAI debug (like Development.jsx)
  const [dbgOpenAI, setDbgOpenAI] = useState('');
  const [dbgBusy, setDbgBusy] = useState(false);
  const [promptRepo, setPromptRepo] = useState([]);
  const loadOpenaiDebug = async () => {
    try {
      setDbgBusy(true);
      const r = await fetch('/api/admin/openai/debug', { credentials: 'include' });
      const j = await r.json();
      setDbgOpenAI(JSON.stringify(j, null, 2));
    } catch (e) {
      setDbgOpenAI(String(e?.message || e));
    } finally {
      setDbgBusy(false);
    }
  };
  const loadPromptRepo = async () => {
    try {
      const r = await fetch('/api/company-chat/prompt-configs?limit=200', { credentials: 'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setPromptRepo(Array.isArray(j.items) ? j.items : []);
    } catch {}
  };

  const loadCfg = async () => {
    try {
      const r = await fetch('/api/company-chat/config', { credentials: 'include' });
      const j = await r.json();
      if (r.ok && j?.ok) {
        setCfg({ model: j.model||'', prompt_id: j.prompt_id||'', prompt_version: j.prompt_version||'', prompt_cfg_id: j.prompt_cfg_id||'', api_key: j.api_key||'' });
        if (j.approval) { setApproval(j.approval); try { localStorage.setItem('cc_approval', j.approval); saveModuleState('company-chat', { approval: j.approval }); } catch {} }
      }
    } catch {}
  };
  const loadBots = async () => {
    try {
      const r = await fetch('/api/company-chat/chatbots', { credentials: 'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setAllBots(Array.isArray(j.items) ? j.items : []);
    } catch {}
  };
  const loadTabs = async () => {
    setTabsBusy(true); setTabsErr('');
    try {
      const r = await fetch('/api/company-chat/tabs', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || String(r.status));
      const list = Array.isArray(j.tabs) ? j.tabs : [];
      setTabs(list);
      const current = (() => {
        try { return activeTabId || localStorage.getItem('cc_active_tab_id') || ''; } catch { return activeTabId || ''; }
      })();
      const found = current && list.some((t) => String(t.id) === String(current));
      if (found) setActiveTabId(String(current));
      else if (list.length) setActiveTabId(String(list[0].id));
      else setActiveTabId('');
    } catch (e) {
      setTabsErr(String(e?.message || e));
      setTabs([]);
    } finally { setTabsBusy(false); }
  };

  const addTab = async () => {
    setTabsBusy(true); setTabsErr('');
    try {
      const r = await fetch('/api/company-chat/tabs/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ title: 'New tab' }) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || String(r.status));
      await loadTabs();
      if (j?.id) setActiveTabId(String(j.id));
    } catch (e) {
      setTabsErr(String(e?.message || e));
    } finally { setTabsBusy(false); }
  };

  const updateTab = async (id, patch, opts = {}) => {
    const tabId = String(id || '').trim();
    if (!tabId) return;
    const optimistic = !!opts.optimistic;
    if (optimistic) {
      setTabs((prev) => (Array.isArray(prev) ? prev.map((t) => (String(t.id) === tabId ? { ...t, ...patch } : t)) : prev));
      return;
    }
    const r = await fetch(`/api/company-chat/tabs/${encodeURIComponent(tabId)}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(patch || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || String(r.status));
    await loadTabs();
  };

  const deleteTab = async (id) => {
    const tabId = String(id || '').trim();
    if (!tabId) return;
    setTabsBusy(true); setTabsErr('');
    try {
      const r = await fetch(`/api/company-chat/tabs/${encodeURIComponent(tabId)}`, { method: 'DELETE', credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || String(r.status));
      await loadTabs();
    } catch (e) {
      setTabsErr(String(e?.message || e));
    } finally { setTabsBusy(false); }
  };

  useEffect(()=>{ loadCfg(); loadBots(); loadPromptRepo(); loadTabs(); }, []);
  // Keep summary in sync with selection
  useEffect(()=>{ try { buildSelectionSummary(effectiveBotIds); } catch {} }, [effectiveBotIds]);
  const SESSIONS_LIMIT = 10;
  const loadSessions = async (tabIdOverride) => {
    try {
      const tabId = tabIdOverride !== undefined ? tabIdOverride : activeTabId;
      const qs = new URLSearchParams();
      qs.set('limit', String(SESSIONS_LIMIT));
      if (tabId) qs.set('tab_id', String(tabId));
      const r = await fetch(`/api/company-chat/sessions?${qs.toString()}`);
      const j = await r.json();
      if (r.ok && j?.ok) {
        const list = Array.isArray(j.sessions) ? j.sessions : [];
        setSessions(list);
        const key = tabId ? `cc_last_session_id_${tabId}` : 'cc_last_session_id';
        let preferred = '';
        try { preferred = localStorage.getItem(key) || ''; } catch {}
        if (!preferred && sessionId) preferred = sessionId;
        const exists = preferred && list.some((s) => String(s.session_id) === String(preferred));
        const sid = exists ? preferred : (list.length ? list[0].session_id : '');
        if (!sid) {
          if (sessionId) setSessionId('');
        } else if (sid !== sessionId) {
          setSessionId(sid);
          try { localStorage.setItem(key, sid); } catch {}
          await loadMessages(sid);
        }
      }
    } catch {}
  };
  const loadMessages = async (sid) => {
    try {
      const r = await fetch(`/api/company-chat/sessions/${encodeURIComponent(sid)}/messages`);
      const j = await r.json();
      if (r.ok && j?.ok) {
        const arr = Array.isArray(j.messages)
          ? j.messages.map(m => ({
              role: m.role,
              content: m.content,
              created: m.created_at,
              meta: m.response_id ? { response_id: m.response_id } : undefined,
            }))
          : [];
        setMessages(arr);
      }
    } catch {}
  };
  useEffect(() => {
    // Switching tabs resets the conversation and loads tab-scoped sessions.
    try { setMessages([]); setReqDump(''); setToolOutDump(''); setRespDump(''); } catch {}
    loadSessions(activeTabId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);
  // Persist last selected session (tab-scoped)
  useEffect(()=>{ try { if (activeTabId && sessionId) { localStorage.setItem(`cc_last_session_id_${activeTabId}`, sessionId); saveModuleState('company-chat', { sessionId }); } } catch {} }, [activeTabId, sessionId]);

  // Persist transport and approval when changed
  useEffect(()=>{ try { saveModuleState('company-chat', { transport }); } catch {} }, [transport]);
  useEffect(()=>{ try { saveModuleState('company-chat', { approval }); } catch {} }, [approval]);
  useEffect(()=>{ try { if (activeTabId) localStorage.setItem('cc_active_tab_id', activeTabId); saveModuleState('company-chat', { activeTabId }); } catch {} }, [activeTabId]);

  // React to restore broadcast
  useEffect(() => {
    const onRestore = (e) => {
      try {
        const m = e?.detail?.modules?.['company-chat'] || {};
        if (m.sessionId) setSessionId(m.sessionId);
        if (m.activeTabId) setActiveTabId(m.activeTabId);
        if (typeof m.transport === 'string') setTransport(m.transport);
        if (typeof m.approval === 'string') setApproval(m.approval);
        if (typeof m.activePanel === 'string') setActivePanel(m.activePanel);
      } catch {}
    };
    window.addEventListener('app-restore', onRestore);
    return () => window.removeEventListener('app-restore', onRestore);
  }, []);

  async function buildSelectionSummary(ids) {
    setSelSummaryBusy(true); setSelSummaryErr('');
    try {
      const idSet = new Set(Array.isArray(ids) ? ids.map(String) : []);
      if (!idSet.size) { setSelSummary([]); return; }
      // Ensure we have the latest bots list
      let bots = allBots;
      if (!Array.isArray(bots) || !bots.length) {
        const rb = await fetch('/api/company-chat/chatbots', { credentials: 'include' });
        const jb = await rb.json();
        bots = (rb.ok && jb?.ok && Array.isArray(jb.items)) ? jb.items : [];
      }
      // Check server-level OpenAI key presence (admin)
      let serverKeySet = false;
      try {
        const rk = await fetch('/api/admin/openai/key', { credentials: 'include' });
        const jk = await rk.json();
        if (rk.ok && jk?.ok) serverKeySet = !!jk.value;
      } catch {}
      const picked = bots.filter(b => idSet.has(String(b.id_bot)));
      const out = [];
      for (const b of picked) {
        const botId = String(b.id_bot);
        const botName = b.name || botId;
        const promptId = String(b.prompt_config_id || b.local_prompt_id || '').trim();
        let promptName = '';
        let promptTools = { file_search:false, code_interpreter:false, web_search:false };
        let promptModel = '';
        let remotePromptId = '';
        let remotePromptVersion = '';
        let vectorStoreId = '';
        // Determine OpenAI key precedence: chatbot > prompt > server
        const keyFromBot = !!(b.has_api_key);
        let keyFromPrompt = false;
        let keySource = keyFromBot ? 'chatbot' : (serverKeySet ? 'server' : '');
        if (promptId) {
          try {
            const rp = await fetch(`/api/company-chat/prompt-configs/${encodeURIComponent(promptId)}`, { credentials:'include' });
            const jp = await rp.json();
            if (rp.ok && jp?.ok && jp?.item) {
              promptName = jp.item.name || '';
              keyFromPrompt = !!(jp.item.has_api_key || (jp.item.openai_api_key && jp.item.openai_api_key !== '__set__'));
              promptModel = String(jp.item.model || '').trim();
              try {
                const t = jp.item.tools;
                let tools = t;
                if (typeof tools === 'string') { tools = JSON.parse(tools); }
                if (tools && typeof tools === 'object') {
                  promptTools = {
                    file_search: !!tools.file_search,
                    code_interpreter: !!tools.code_interpreter,
                    web_search: !!tools.web_search,
                  };
                }
              } catch {}
              if (jp.item.vector_store_id) vectorStoreId = String(jp.item.vector_store_id);
              if (jp.item.prompt_id) remotePromptId = String(jp.item.prompt_id);
              if (jp.item.prompt_version) remotePromptVersion = String(jp.item.prompt_version);
            }
          } catch {}
        }
        if (!keyFromBot && keyFromPrompt) keySource = 'prompt';
        out.push({ botId, botName, model: (promptModel || b.model || ''), keySource, promptId, promptName, remotePromptId, remotePromptVersion, promptTools, vectorStoreId, servers: [] });
      }
      setSelSummary(out);
    } catch (e) {
      setSelSummaryErr(String(e?.message || e));
    } finally { setSelSummaryBusy(false); }
  }

  const savePresta = async () => {
    setPrestaBusy(true); setPrestaMsg('');
    try {
      const body = { base: presta.base };
      if (presta.api_key && presta.api_key !== '__set__') body.api_key = presta.api_key;
      const r = await fetch('/api/company-chat/prestashop/config', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) setPrestaMsg(j?.message || j?.error || 'Save failed'); else setPrestaMsg('Saved');
    } catch (e) { setPrestaMsg(String(e?.message || e)); } finally { setPrestaBusy(false); }
  };

  const testPresta = async () => {
    setPrestaTestBusy(true); setPrestaTestMsg('');
    try {
      const body = { base: presta.base };
      if (presta.api_key && presta.api_key !== '__set__') body.api_key = presta.api_key;
      const r = await fetch('/api/company-chat/prestashop/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json().catch(()=>({}));
      if (r.ok && j?.ok) {
        const via = j?.via || j?.content_type || 'ok';
        setPrestaTestMsg(`OK (${via}) in ${j?.ms||'?'}ms`);
      } else {
        const msg = j?.message || j?.error || `${r.status}`;
        setPrestaTestMsg(`Failed: ${msg}`);
      }
    } catch (e) {
      setPrestaTestMsg(`Failed: ${String(e?.message || e)}`);
    } finally { setPrestaTestBusy(false); }
  };

  const newSession = () => {
    setSessionId('');
    setMessages([]);
    setReqDump('');
    setToolOutDump('');
    try { if (activeTabId) localStorage.removeItem(`cc_last_session_id_${activeTabId}`); } catch {}
  };

  useEffect(() => {
    try { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); } catch {}
  }, [messages]);
  // When busy or an error appears, keep the user informed and in view
  useEffect(() => {
    try { if (busy || error) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); } catch {}
  }, [busy, error]);

  const send = async () => {
    const text = input.trim(); if (!text) return;
    setInput(''); setError('');
    const msgs = [...messages, { role:'user', content: text, created: new Date().toISOString() }]; setMessages(msgs);
    setBusy(true);
    try {
      const styleHint = "Write answers in the user's language. Keep them concise and friendly. Format details as clean Markdown with short bullet lists and bold labels (e.g., **Visitor ID:** value). Avoid code blocks and disclaimers.";
      const activeTab = (Array.isArray(tabs) ? tabs : []).find((t) => String(t.id) === String(activeTabId)) || null;
      const firstSel = Array.isArray(selSummary) && selSummary.length ? selSummary[0] : null;
      const promptCfgIdForSend = (activeTab && activeTab.prompt_config_id) || (firstSel && firstSel.promptId) || (cfg && cfg.prompt_cfg_id) || '';
      const body = { messages: msgs, transport, requireApproval: approval, instructions: styleHint, chatbot_ids: effectiveBotIds, tab_id: activeTabId || undefined };
      if (promptCfgIdForSend) body.prompt_cfg_id = promptCfgIdForSend;
      if (sessionId) body.sessionId = sessionId;
      const r = await fetch('/api/company-chat/respond', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) { setError(j?.message || j?.error || 'Request failed'); } else {
        const t = j?.text || '';
        if (j?.sessionId) setSessionId(j.sessionId);
        // Derive MCP servers used for this reply (labels)
        let servers = [];
        try {
          const tools = Array.isArray(j?.request_body?.tools)
            ? j.request_body.tools
            : (Array.isArray(j?.request?.tools) ? j.request.tools : []);
          if (Array.isArray(tools)) {
            for (const t of tools) {
              if (t && t.type === 'mcp') {
                const label = t.server_label || (()=>{
                  try { const u = String(t.server_url||''); const m = /\/mcp\/([^/]+)\//.exec(u); return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; }
                })();
                if (label) servers.push(label);
              }
            }
          }
        } catch {}
        const meta = { request: j?.request || null, transport, servers };
        try { if (j?.response_id || j?.raw?.id) meta.response_id = j.response_id || j.raw.id; } catch {}
        setMessages(m => [...m, { role:'assistant', content: t, meta, created: new Date().toISOString() }]);
        // Capture per-request payload and tool outputs
        try {
          const reqBody = j?.request_body || null;
          const reqDebug = j?.request || null;
          if (reqBody || reqDebug) {
            try { setReqDump(JSON.stringify(reqBody || reqDebug, null, 2)); } catch { setReqDump(''); }
            try {
              const outs = Array.isArray((reqDebug||{}).tool_outputs) ? reqDebug.tool_outputs : [];
              if (outs.length) {
                const last = outs[outs.length - 1];
                const rawOut = last?.output;
                let pretty = '';
                if (typeof rawOut === 'string') {
                  try { const parsed = JSON.parse(rawOut); pretty = JSON.stringify(parsed, null, 2); }
                  catch { pretty = rawOut; }
                } else if (rawOut != null) {
                  pretty = JSON.stringify(rawOut, null, 2);
                }
                setToolOutDump(pretty);
              } else { setToolOutDump(''); }
            } catch { setToolOutDump(''); }
          } else { setReqDump(''); setToolOutDump(''); }
        } catch {}
        // Capture OpenAI response JSON (includes response id)
        try {
          const raw = j?.raw || (j?.response_id ? { id: j.response_id } : null);
          if (raw) setRespDump(JSON.stringify(raw, null, 2)); else setRespDump('');
        } catch { setRespDump(''); }
        loadSessions();
      }
    } catch (e) { setError(String(e?.message || e)); } finally { setBusy(false); }
  };

  return (
    <div className="w-full grid grid-rows-[auto_auto]">
      {/* Sessions + Conversation (fixed height to keep columns equal) */}
      <div className="min-h-0 h-[75vh] bg-gray-50 grid grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
        {/* Conversation (left) */}
        <div className="min-h-0 grid grid-rows-[auto_minmax(0,1fr)_auto] h-full">
          {/* Sticky micro-header */}
          <div className="sticky top-0 z-10 bg-gray-50/80 backdrop-blur border-b px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-gray-700">Conversation</div>
              <div className="text-[11px] text-gray-500 truncate">
                {(() => {
                  const t = (Array.isArray(tabs) ? tabs : []).find((x) => String(x.id) === String(activeTabId));
                  if (!t) return '';
                  const botIds = Array.isArray(t.chatbot_ids) ? t.chatbot_ids.map(String).filter(Boolean) : [];
                  if (botIds.length) return `Chatbot: ${botIds.join(', ')}`;
                  return t.prompt_config_id ? `Prompt: ${t.prompt_config_id}` : 'No chatbot/prompt selected';
                })()}
              </div>
            </div>
            <CompanyChatTabsBar
              tabs={tabs}
              activeId={activeTabId}
              onSelect={(id) => setActiveTabId(id)}
              onAdd={addTab}
            />
          </div>
          <div className="min-h-0 h-full overflow-y-auto scroll-area">
            <div className="p-3 pb-1 space-y-0.5 max-w-none">
          {messages.map((m, idx) => {
            const isUser = m.role === 'user';
            const boxCls = "inline-block max-w-[80%] rounded-lg px-3 py-2 text-[13px] leading-6 shadow-sm ";
            // Ensure user bubble is always visible even if gradient utilities are purged
            const roleCls = isUser
              ? 'bg-blue-50 text-gray-900 border border-blue-100'
              : 'bg-green-50 text-gray-900 border border-green-100';
            const tryJson = (txt) => { try { return JSON.parse(txt); } catch { return null; } };
            const langLabel = (iso) => {
              const map = { en:'English', fr:'French', es:'Spanish', de:'German', it:'Italian', pt:'Portuguese', nl:'Dutch' };
              const name = map[String(iso||'').toLowerCase()] || String(iso||'').toUpperCase();
              return `${name} (${iso})`;
            };
            const renderVisitorCard = (val) => {
              const arr = Array.isArray(val) ? val : (val && typeof val==='object' ? [val] : null);
              if (!arr || !arr.length) return null;
              const v = arr[0];
              if (!v || (!v.visitor_id && !v.id)) return null;
              const shop = v.shop_name || v.shop || '';
              const lang = v.lang_iso || v.language || '';
              const lastSeen = v.last_seen ? new Date(v.last_seen) : null;
              const lastAction = v.last_action || '';
              const convo = v.conversation_status || '';
              return (
                <div className="text-sm text-gray-800">
                  <div className="mb-2">The last visitor is from the shop <span className="font-medium">{shop || 'unknown'}</span>. Here are the details:</div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><span className="font-medium">Visitor ID:</span> {v.visitor_id || v.id}</li>
                    {lang ? (<li><span className="font-medium">Language:</span> {langLabel(lang)}</li>) : null}
                    {lastSeen ? (<li><span className="font-medium">Last Seen:</span> {lastSeen.toUTCString()}</li>) : null}
                    {lastAction ? (<li><span className="font-medium">Last Action:</span> {lastAction}</li>) : null}
                    {convo ? (<li><span className="font-medium">Conversation Status:</span> {convo.replace(/_/g,' ')}</li>) : null}
                  </ul>
                </div>
              );
            };
            const content = String(m.content || '');
            const parsed = !isUser ? tryJson(content) : null;
            const asVisitor = !isUser ? renderVisitorCard(parsed) : null;
            const toolCalls = !isUser && m?.meta?.request?.tool_calls ? m.meta.request.tool_calls : [];
            const prev = idx>0 ? messages[idx-1]?.created : null;
            const nowIso = m.created || null;
            return (
              <div key={idx} className={'text-left group'}>
                {needTimestamp(prev, nowIso) && (
                  <div className="text-center text-[11px] text-gray-400 my-2">{formatTimestamp(nowIso)}</div>
                )}
                <div className={'flex justify-start items-start gap-3'} style={{ marginTop: '3px' }}>
                {/* Assistant avatar (left) */}
                {!isUser && (
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[11px] font-medium text-gray-600 select-none">AI</div>
                )}
                {false && !isUser && Array.isArray(toolCalls) && toolCalls.length > 0 && (
                  <div className="inline-block max-w-[80%] mb-1 text-xs text-gray-600">
                    <div className="flex items-center gap-1 text-gray-500">
                      <span>steam</span>
                      <span className="opacity-60">List tools</span>
                    </div>
                    <div className="border-l-2 pl-2 mt-1 space-y-1">
                      {toolCalls.map((c, i) => (
                        <div key={i}>
                          <div className="text-[11px] text-gray-700">
                            <span className="inline-block border rounded px-1 py-0.5 bg-white border-gray-300">{c.name || 'tool'}</span>
                          </div>
                          {c?.arguments && (
                            <pre className="text-[11px] bg-gray-50 border rounded p-2 whitespace-pre-wrap overflow-auto">{JSON.stringify(c.arguments, null, 2)}</pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div
                  className={boxCls + roleCls + (isUser ? '' : ' prose max-w-none') }
                  style={isUser ? { backgroundColor: '#b5d0f3ff', borderColor: '#DBEAFE', color: '#111827' } : undefined}
                >
                  {asVisitor
                    ? asVisitor
                    : (isUser
                        ? (content || '')
                        : (<div dangerouslySetInnerHTML={{ __html: markdownToHtmlSafe(content || '') }} />))}
                </div>
                {!isUser && Array.isArray(m?.meta?.servers) && m.meta.servers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.meta.servers.map((s, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 border rounded bg-gray-50 text-gray-600">{s}</span>
                    ))}
                  </div>
                )}
                {/* Optional user avatar placeholder on right (hidden for now) */}
                {false && isUser && (
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-[11px] font-medium text-indigo-700 select-none">ME</div>
                )}
                {/* Hover actions (assistant only) */}
                {!isUser && (
                  <div className={'mt-3 opacity-0 group-hover:opacity-100 transition text-xs text-gray-500 flex items-center gap-2'}>
                    <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>copy(content)}>Copy</button>
                    <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>setMessages(list => list.filter((_,i)=>i!==idx))}>Delete</button>
                  </div>
                )}
                {/* MCP signed link helpers */}
                {!isUser && (()=>{ const links = extractMcpDownloads(content); return links.length ? (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {links.map((ln, i) => (
                      <div key={i} className="text-xs text-gray-600 border rounded px-2 py-1 bg-gray-50 flex items-center gap-2">
                        <code className="text-[11px] break-all">{ln.path}</code>
                        <button className="px-1.5 py-0.5 border rounded bg-white" onClick={()=>openSigned(ln.kind, ln.id)}>Ouvrir</button>
                        <button className="px-1.5 py-0.5 border rounded bg-white" onClick={()=>copySigned(ln.kind, ln.id)}>Copier lien signé</button>
                      </div>
                    ))}
                  </div>
                ) : null; })()}
                </div>
              </div>
            );
          })}
          {!messages.length && (
            <div className="text-xs text-gray-500">Start by typing a message below.</div>
          )}
          {busy && (
            <div className="mt-2 text-xs text-gray-600 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
              <span>AI is looking for information…</span>
            </div>
          )}
          {!!error && (
            <div className="mt-2 text-xs text-red-600">
              Error: {error}
            </div>
          )}
          <div ref={bottomRef} />
          {false && reqDump && (
            <div>
              <div className="text-[11px] text-gray-500">OpenAI request payload</div>
              <pre className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap mt-1 max-h-64 overflow-auto">{reqDump}</pre>
            </div>
          )}
          {false && toolOutDump && (
            <div>
              <div className="text-[11px] text-gray-500">Tool outputs (last)</div>
              <pre className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap mt-1 max-h-64 overflow-auto">{toolOutDump}</pre>
            </div>
          )}
          </div>
          </div>
          

          <div className="border-t p-1 bg-white sticky bottom-0 z-10">
            <div className="w-full border rounded-2xl bg-white px-2 py-1.5 flex items-end gap-2">
              <textarea
                rows={2}
                className="flex-1 min-w-0 w-full border-0 outline-none px-2 py-1 rounded-xl text-[13px] resize-none leading-6 min-h-[52px] bg-transparent"
                placeholder="Type a message..."
                value={input}
                onChange={(e)=>setInput(e.target.value)}
                onKeyDown={(e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } }}
              />
              <button
                className="h-8 px-3 rounded-xl bg-indigo-600 text-white text-[13px] disabled:opacity-60 shrink-0"
                onClick={send}
                disabled={busy || !input.trim()}
              >
                {busy?'Sending...':'Send'}
              </button>
            </div>
          </div>
        </div>
        {/* Sessions list (right) */}
        <div className="border-l min-h-0 h-full grid grid-rows-[auto_minmax(0,1fr)]">
          <div className="px-3 py-1.5 flex items-center justify-between">
            <div className="font-medium">Sessions</div>
            <div className="flex items-center gap-2">
              <button className="text-xs px-2 py-0.5 border rounded" onClick={loadSessions}>Refresh</button>
              <button className="text-xs px-2 py-0.5 border rounded" onClick={newSession}>New</button>
            </div>
          </div>
          <div className="min-h-0 overflow-y-scroll scroll-area px-3 pb-12 space-y-1.5">
            {sessions.map(s => (
              <div key={s.session_id} className={"w-full text-left text-sm rounded px-2 py-0.5 border flex items-center justify-between gap-2 " + (sessionId===s.session_id ? 'bg-blue-50 border-blue-200' : 'border-gray-200')}>
                <button className="text-left flex-1 min-w-0" onClick={async()=>{ setSessionId(s.session_id); await loadMessages(s.session_id); }}>
                  <div className="font-medium truncate">{s.session_id.slice(0,8)}…</div>
                  <div className="text-xs text-gray-500 truncate">{new Date(s.last_seen).toLocaleString()} • {s.message_count} msgs</div>
                </button>
                <button
                  className="text-[11px] px-2 py-0.5 border rounded bg-white whitespace-nowrap"
                  title="Delete session"
                  onClick={async (e)=>{
                    e.stopPropagation();
                    try {
                      const ok = window.confirm('Delete this session?');
                      if (!ok) return;
                      const r = await fetch(`/api/company-chat/sessions/${encodeURIComponent(s.session_id)}`, { method:'DELETE' });
                      if (r.ok) {
                        if (sessionId === s.session_id) { setSessionId(''); setMessages([]); }
                        await loadSessions();
                      }
                    } catch {}
                  }}
                >Delete</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom panels (restored) */}
      <div className="border-t bg-white mt-1">
        <div className="p-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-700">
          <div className="mr-2">Panels:</div>
          {[
            ['settings', 'Settings'],
            ['debug', 'Server debug'],
            ['request', 'OpenAI request'],
            ['response', 'Response JSON'],
            ['sessions', 'Sessions'],
          ].map(([id, label]) => {
            const active = activePanel === id;
            return (
              <button
                key={id}
                className={`px-2 py-0.5 border rounded ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-gray-50 border-gray-200'}`}
                onClick={() => setActivePanel((prev) => (prev === id ? '' : id))}
              >
                {label}
              </button>
            );
          })}
        </div>

        {activePanel === 'settings' && (
          <div className="p-3 border-t">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Tabs</div>
              <button className="text-xs px-2 py-0.5 border rounded bg-white" onClick={loadBots}>Refresh chatbots</button>
            </div>
            <div className="mb-3">
              <CompanyChatTabsManager
                tabs={tabs}
                activeId={activeTabId}
                promptOptions={promptRepo}
                chatbotOptions={allBots}
                busy={tabsBusy}
                error={tabsErr}
                onAdd={addTab}
                onSelect={setActiveTabId}
                onUpdate={updateTab}
                onDelete={deleteTab}
              />
            </div>
          </div>
        )}

        {activePanel === 'debug' && (
          <div className="p-3 border-t">
            <div className="text-[11px] text-gray-500 flex items-center gap-2">
              <span>Server debug (OpenAI)</span>
              <button className="text-xs px-2 py-0.5 border rounded" onClick={loadOpenaiDebug} disabled={dbgBusy}>{dbgBusy ? 'Loading.' : 'Refresh'}</button>
              <button className="text-xs px-2 py-0.5 border rounded" onClick={()=>copy(dbgOpenAI)}>Copy</button>
            </div>
            {dbgOpenAI && (
              <pre className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap mt-1 max-h-64 overflow-auto">{dbgOpenAI}</pre>
            )}
          </div>
        )}

        {activePanel === 'request' && (
          <div className="p-3 border-t">
            <div className="text-[11px] text-gray-500 flex items-center gap-2">
              <span>OpenAI request payload</span>
              <button className="text-xs px-2 py-0.5 border rounded" onClick={()=>copy(reqDump)}>Copy</button>
            </div>
            <pre className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap mt-1 max-h-64 overflow-auto">{reqDump || '(empty)'}</pre>
            {toolOutDump && (
              <div className="mt-2">
                <div className="text-[11px] text-gray-500 flex items-center gap-2">
                  <span>Tool outputs (last)</span>
                  <button className="text-xs px-2 py-0.5 border rounded" onClick={()=>copy(toolOutDump)}>Copy</button>
                </div>
                <pre className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap mt-1 max-h-64 overflow-auto">{toolOutDump}</pre>
              </div>
            )}
          </div>
        )}

        {activePanel === 'response' && (
          <div className="p-3 border-t">
            <div className="text-[11px] text-gray-500">OpenAI response (raw)</div>
            <pre className="text-xs bg-gray-50 border rounded p-2 whitespace-pre-wrap mt-1 max-h-64 overflow-auto">{respDump || '(empty)'}</pre>
          </div>
        )}

        {activePanel === 'sessions' && (
          <div className="p-3 border-t">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">Sessions</div>
              <div className="flex items-center gap-2">
                <button className="text-xs px-2 py-0.5 border rounded" onClick={loadSessions}>Refresh</button>
                <button className="text-xs px-2 py-0.5 border rounded" onClick={newSession}>New session</button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {sessions.map(s => (
                <button key={s.session_id} className={`w-full text-left text-sm rounded px-2 py-1 border ${sessionId===s.session_id?'bg-blue-50 border-blue-200':'border-gray-200'}`} onClick={async()=>{ setSessionId(s.session_id); await loadMessages(s.session_id); }}>
                  <div className="font-medium">{s.session_id.slice(0,8)}…</div>
                  <div className="text-xs text-gray-500">{new Date(s.last_seen).toLocaleString()} · {s.message_count} msgs</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
