import React, { useEffect, useMemo, useState } from 'react';

export default function Development() {
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('mcp_dev_token') || '');
  const [serverBase, setServerBase] = useState(() => localStorage.getItem('mcp_dev_base') || window.location.origin);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMsg, setAdminMsg] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [wsBusy, setWsBusy] = useState(false);
  const [wsResult, setWsResult] = useState('');
  const [toolBusy, setToolBusy] = useState(false);
  const [toolList, setToolList] = useState([]);
  const [toolName, setToolName] = useState('');
  const [toolArgs, setToolArgs] = useState('{}');
  const [toolOut, setToolOut] = useState('');
  
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiMsg, setOpenaiMsg] = useState('');
  const [openaiModel, setOpenaiModel] = useState(() => {
    try { return localStorage.getItem('openai_responses_model') || ''; } catch { return ''; }
  });
  const [useTools, setUseTools] = useState(() => {
    try {
      const v = localStorage.getItem('openai_use_tools');
      return v == null ? true : v === '1';
    } catch { return true; }
  });
  const [promptId, setPromptId] = useState('');
  const [promptVer, setPromptVer] = useState('');
  const [chatIn, setChatIn] = useState('');
  const [chatOut, setChatOut] = useState('');
  const [chatRequest, setChatRequest] = useState('');
  const [chatToolOutputs, setChatToolOutputs] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [forceTools, setForceTools] = useState(() => { try { return localStorage.getItem('dev_force_tools') === '1'; } catch { return false; } });
  const [jsonOnly, setJsonOnly] = useState(() => { try { return localStorage.getItem('dev_json_only') === '1'; } catch { return false; } });
  const [note, setNote] = useState(() => {
    try { return localStorage.getItem('dev_panel_note') || ''; } catch { return ''; }
  });
  const [toolTransport, setToolTransport] = useState(() => { try { return localStorage.getItem('dev_tool_transport') || 'function'; } catch { return 'function'; } });
  const [toolApproval, setToolApproval] = useState(() => { try { return localStorage.getItem('dev_tool_approval') || 'always'; } catch { return 'always'; } });

  const [chatToolName, setChatToolName] = useState('');
  const [chatToolArgs, setChatToolArgs] = useState('');
  const [chatToolList, setChatToolList] = useState([]);
  const loadChatTools = async () => {
    try {
      const base = serverBase.replace(/\/$/, '');
      const url = `${base}/mcp-dev/actions/tools`;
      let creds = 'include';
      try { const u = new URL(url, window.location.href); if (u.origin !== window.location.origin) creds = 'omit'; } catch {}
      const r = await fetch(url, { credentials: creds });
      const j = await r.json();
      setChatToolList(Array.isArray(j?.tools) ? j.tools : []);
    } catch { setChatToolList([]); }
  };

  const [dbgOpenAI, setDbgOpenAI] = useState('');
  const [dbgBusy, setDbgBusy] = useState(false);
  const loadOpenaiDebug = async () => {
    try {
      setDbgBusy(true);
      const r = await fetch('/api/admin/openai/debug', { credentials: 'include' });
      const j = await r.json();
      setDbgOpenAI(JSON.stringify(j, null, 2));
    } catch (e) { setDbgOpenAI(String(e?.message || e)); } finally { setDbgBusy(false); }
  };

  const [dbUrl, setDbUrl] = useState('');
  const [dbSsl, setDbSsl] = useState('false');
  const [dbBusy, setDbBusy] = useState(false);
  const [dbMsg, setDbMsg] = useState('');
  const [dbTestBusy, setDbTestBusy] = useState(false);
  const [dbTestMsg, setDbTestMsg] = useState('');
  
  const statusUrl = useMemo(() => `${serverBase.replace(/\/$/, '')}/mcp-dev/status`, [serverBase]);
  const filesUrl = useMemo(() => {
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${serverBase.replace(/\/$/, '')}/mcp-dev/files${qs}`;
  }, [serverBase, token]);

  const loadStatus = async () => {
    try {
      setBusy(true);
      let creds = 'include';
      try { const u = new URL(statusUrl, window.location.href); if (u.origin !== window.location.origin) creds = 'omit'; } catch {}
      const res = await fetch(statusUrl, { credentials: creds });
      const j = await res.json();
      setStatus(j);
      try { if (j && typeof j.token === 'string') { setToken(j.token); onSavePrefs(); } } catch {}
    } catch { setStatus(null); }
    finally { setBusy(false); }
  };

  const loadFiles = async () => {
    try {
      const res = await fetch(filesUrl);
      const j = await res.json();
      setFiles(Array.isArray(j?.files) ? j.files : []);
    } catch { setFiles([]); }
  };

  const onSavePrefs = () => {
    try {
      localStorage.setItem('mcp_dev_base', serverBase || '');
      localStorage.setItem('mcp_dev_token', token || '');
    } catch {}
  };

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Development'] })); } catch {}
  }, []);

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBase]);

  return (
    <div className="h-full w-full flex">
      <aside className="w-64 border-r bg-white p-4 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">MCP Dev Server</div>
          <label className="block text-xs text-gray-600">
            Base URL
            <input className="mt-1 w-full border rounded px-2 py-1 text-sm" value={serverBase} onChange={(e)=> setServerBase(e.target.value)} placeholder="http://localhost:3000" />
          </label>
          <label className="mt-2 block text-xs text-gray-600">
            Token (optional)
            <input className="mt-1 w-full border rounded px-2 py-1 text-sm" value={token} onChange={(e)=> setToken(e.target.value)} placeholder="token" />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <button className="px-2 py-1 rounded border text-xs" onClick={()=>{ onSavePrefs(); loadStatus(); }}>Refresh</button>
            <button className="px-2 py-1 rounded border text-xs" onClick={()=>{ onSavePrefs(); loadFiles(); }}>List files</button>
          </div>
          <div className="mt-2 text-xs text-gray-500">Status: {busy ? 'Loading…' : (status ? 'Online' : 'Offline')}</div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Admin Token</div>
          <input value={adminToken} onChange={(e)=> setAdminToken(e.target.value)} placeholder="x-admin-token" className="w-full border rounded px-2 py-1 text-sm" />
          <div className="mt-2 flex items-center gap-2">
            <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={adminBusy} onClick={async()=>{
              try {
                setAdminBusy(true);
                const r = await fetch('/api/admin/openai/set', { method:'POST', headers:{ 'Content-Type':'application/json', 'x-admin-token': adminToken }, body: JSON.stringify({ key: openaiKey || '' }) });
                const j = await r.json();
                setAdminMsg(j?.ok ? 'Saved' : (j?.error || 'Failed'));
              } catch (e) { setAdminMsg(String(e?.message || e)); }
              finally { setAdminBusy(false); }
            }}>Save OpenAI key</button>
            <input value={openaiKey} onChange={(e)=> setOpenaiKey(e.target.value)} placeholder="sk-…" className="border rounded px-2 py-1 text-sm" />
            <span className="text-xs text-gray-500">{adminMsg}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={dbgBusy} onClick={loadOpenaiDebug}>Inspect OpenAI server</button>
          </div>
          {!!dbgOpenAI && (
            <pre className="mt-2 text-[11px] whitespace-pre-wrap bg-gray-50 rounded border p-2 max-h-48 overflow-auto">{dbgOpenAI}</pre>
          )}
        </div>
      </aside>

      <main className="flex-1 min-h-0 p-3 flex flex-col gap-3">
        <section className="rounded border bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Upload a file</div>
          <div className="flex items-center gap-2">
            <input type="file" onChange={async (e)=> {
              try {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                setUploading(true); setUploadMsg('');
                const buf = await f.arrayBuffer();
                const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                const qs = token ? `?token=${encodeURIComponent(token)}` : '';
                const url = `${serverBase.replace(/\/$/, '')}/mcp-dev/upload${qs}`;
                const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f.name, content_base64: b64 }) });
                const j = await r.json();
                setUploadMsg(j?.ok ? 'Uploaded' : (j?.error || 'Failed'));
              } catch (e) { setUploadMsg(String(e?.message || e)); }
              finally { setUploading(false); }
            }} />
            <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={uploading} onClick={loadFiles}>Refresh list</button>
            <span className="text-xs text-gray-500">{uploadMsg}</span>
          </div>
          {!!files?.length && (
            <ul className="mt-2 text-sm list-disc pl-5">
              {files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded border bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">WebSocket test</div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={wsBusy} onClick={async()=>{
              setWsBusy(true); setWsResult('');
              try {
                const base = serverBase.replace(/\/$/, '');
                const url = `${base.replace(/^http/,'ws')}/mcp-dev/ws` + (token ? `?token=${encodeURIComponent(token)}` : '');
                const ws = new WebSocket(url);
                ws.onopen = () => ws.send('hello');
                ws.onmessage = (ev) => { setWsResult(String(ev?.data||'')); try { ws.close(); } catch {} };
                ws.onerror = () => { try { ws.close(); } catch {} };
              } catch (e) { setWsResult(String(e?.message || e)); }
              finally { setWsBusy(false); }
            }}>Ping</button>
            <span className="text-xs text-gray-500">{wsResult}</span>
          </div>
        </section>

        <section className="rounded border bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Call tool (server)</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select className="border rounded px-2 py-1 text-sm" value={toolName} onChange={(e)=> setToolName(e.target.value)}>
              <option value="">—</option>
              {toolList.map((t) => (
                <option key={t?.name} value={t?.name}>{t?.name}</option>
              ))}
            </select>
            <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={toolBusy} onClick={loadChatTools}>List tools</button>
            <input className="border rounded px-2 py-1 text-sm flex-1" placeholder='{"foo": "bar"}' value={toolArgs} onChange={(e)=> setToolArgs(e.target.value)} />
            <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={toolBusy || !toolName} onClick={async()=>{
              try {
                setToolBusy(true); setToolOut('');
                const r = await fetch('/mcp-dev/actions/tools/call', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: toolName, args: toolArgs }) });
                const j = await r.json();
                setToolOut(JSON.stringify(j, null, 2));
              } catch (e) { setToolOut(String(e?.message || e)); }
              finally { setToolBusy(false); }
            }}>Call</button>
          </div>
          {!!toolOut && (<pre className="mt-2 text-[11px] whitespace-pre-wrap bg-gray-50 rounded border p-2 max-h-48 overflow-auto">{toolOut}</pre>)}
        </section>

        <section className="rounded border bg-white p-3">
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">OpenAI Responses (server)</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="text-xs text-gray-600">
              Model
              <select className="mt-1 w-full border rounded px-2 py-1 text-sm" value={openaiModel} onChange={(e)=>{ const v=e.target.value; setOpenaiModel(v); try { localStorage.setItem('openai_responses_model', v || ''); } catch {} }}>
                <option value="">(default)</option>
                <option value="gpt-5-chat-latest">gpt-5-chat-latest</option>
                <option value="gpt-5-2025-08-07">gpt-5-2025-08-07</option>
                <option value="gpt-5-mini-2025-08-07">gpt-5-mini-2025-08-07</option>
                <option value="gpt-5-nano-2025-08-07">gpt-5-nano-2025-08-07</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4.1">gpt-4.1</option>
                <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                <option value="o4">o4</option>
                <option value="o4-mini">o4-mini</option>
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Optional: Tool name
              <input className="mt-1 w-full border rounded px-2 py-1 text-sm" value={chatToolName} onChange={(e)=> setChatToolName(e.target.value)} placeholder="list_recent_visitors" />
            </label>
            <label className="text-xs text-gray-600">
              Optional: Tool args (JSON)
              <input className="mt-1 w-full border rounded px-2 py-1 text-sm" value={chatToolArgs} onChange={(e)=> setChatToolArgs(e.target.value)} placeholder='{"limit": 5}' />
            </label>
          </div>
          <div className="flex gap-2 items-end">
            <textarea className="border rounded px-2 py-1 w-full" rows={3} placeholder="Chat with your prompt..." value={chatIn} onChange={(e)=>setChatIn(e.target.value)} />
            <button className="px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-60" disabled={chatBusy || !chatIn.trim()} onClick={async()=>{
              const endpoint = useTools ? '/messages/tools' : '/messages';
              const payload = { content: chatIn };
              if (openaiModel) payload.model = openaiModel;
              if (useTools && forceTools) payload.forceTools = true;
              if (useTools && jsonOnly) payload.jsonOnly = true;
              if (useTools && chatToolName) {
                payload.toolChoiceName = chatToolName;
                if (chatToolArgs && chatToolArgs.trim()) payload.toolArgs = chatToolArgs;
              }
              if (useTools && toolTransport === 'mcp') { payload.transport = 'mcp'; payload.requireApproval = toolApproval; }
              let requestDump = '';
              try { requestDump = JSON.stringify({ endpoint, payload }, null, 2); } catch {}
              try {
                setChatBusy(true);
                setChatOut('');
                setChatRequest(requestDump);
                const r = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                const j = await r.json();
                if (j?.request) {
                  try { requestDump = JSON.stringify(j.request, null, 2); } catch {}
                  try {
                    const outs = Array.isArray(j.request.tool_outputs) ? j.request.tool_outputs : [];
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
                      setChatToolOutputs(pretty);
                    } else {
                      setChatToolOutputs('');
                    }
                  } catch { setChatToolOutputs(''); }
                }
                setChatRequest(requestDump);
                if (!r.ok) {
                  const err = (j?.message ? j.message : '') + (j?.error ? ` (${j.error})` : '');
                  setChatOut(err || 'Request failed');
                } else {
                  setChatOut(j?.content || j?.text || JSON.stringify(j));
                }
              } catch (e) {
                setChatOut(String(e?.message || e));
              } finally {
                setChatBusy(false);
              }
            }}>{chatBusy ? 'Sending…' : 'Send'}</button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <label className="text-xs flex items-center gap-2">
              <input type="checkbox" checked={useTools} onChange={(e)=>{ const v = e.target.checked; setUseTools(v); try { localStorage.setItem('openai_use_tools', v ? '1' : '0'); } catch {} }} />
              Use MCP tools (DEV)
            </label>
            <span className="text-[11px] text-gray-500">Active les outils MCP (get_visitor, list_recent_visitors, …) via OpenAI Responses.</span>
            {useTools && (
              <label className="text-xs flex items-center gap-2 ml-4">
                <input type="checkbox" checked={forceTools} onChange={(e)=>{ const v = e.target.checked; setForceTools(v); try { localStorage.setItem('dev_force_tools', v ? '1' : '0'); } catch {} }} />
                Force obvious tool calls (visitor_id / last visitor)
              </label>
            )}
            {useTools && (
              <label className="text-xs flex items-center gap-2 ml-4">
                <input type="checkbox" checked={jsonOnly} onChange={(e)=>{ const v = e.target.checked; setJsonOnly(v); try { localStorage.setItem('dev_json_only', v ? '1' : '0'); } catch {} }} />
                Return JSON only (tool output)
              </label>
            )}
          </div>
          {!!chatRequest && (<pre className="mt-2 text-[11px] whitespace-pre-wrap bg-gray-50 rounded border p-2 max-h-48 overflow-auto">{chatRequest}</pre>)}
          {!!chatToolOutputs && (<pre className="mt-2 text-[11px] whitespace-pre-wrap bg-gray-50 rounded border p-2 max-h-48 overflow-auto">{chatToolOutputs}</pre>)}
          {!!chatOut && (<pre className="mt-2 text-[11px] whitespace-pre-wrap bg-gray-50 rounded border p-2 max-h-48 overflow-auto">{chatOut}</pre>)}
        </section>
      </main>
    </div>
  );
}

