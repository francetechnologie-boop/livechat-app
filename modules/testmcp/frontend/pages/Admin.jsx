import React, { useEffect, useRef, useState } from 'react';

export default function TestMcpAdmin() {
  const [items, setItems] = useState([]);
  const [connected, setConnected] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const streamRef = useRef(null);
  const [events, setEvents] = useState([]);
  const [sseConnected, setSseConnected] = useState(false);
  const sseRef = useRef(null);
  const [tools, setTools] = useState([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [adminToken, setAdminToken] = useState(() => {
    try { return localStorage.getItem('testmcp_admin_token') || ''; } catch { return ''; }
  });
  const [addTool, setAddTool] = useState({ name: '', description: '' });
  const [toast, setToast] = useState(null);

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Test MCP'] })); } catch {}
  }, []);

  const openStream = async () => {
    if (streamRef.current) return;
    try {
      // Use NDJSON path for local viewer; Inspector uses SSE on /api/testmcp/stream
      const url = `${window.location.origin}/testmcp/ndjson`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.body) return;
      setConnected(true);
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      streamRef.current = { cancel: () => reader.cancel().catch(()=>{}) };
      (async function pump() {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 1);
              if (!line) continue;
              try { const j = JSON.parse(line); setItems((prev) => [j, ...prev].slice(0, 200)); } catch {}
            }
          }
        } catch {}
        setConnected(false);
        streamRef.current = null;
      })();
    } catch {}
  };

  // SSE subscribe controls
  const openEvents = () => {
    if (sseRef.current) return;
    try {
      const url = `${window.location.origin}/api/testmcp/events`;
      const es = new EventSource(url, { withCredentials: true });
      sseRef.current = es;
      setSseConnected(true);
      es.onmessage = (ev) => {
        try { const j = JSON.parse(ev.data); setEvents((prev)=> [j, ...prev].slice(0,200)); } catch {}
      };
      es.onerror = () => { try { es.close(); } catch {}; sseRef.current = null; setSseConnected(false); };
    } catch {}
  };
  const stopEvents = () => { try { sseRef.current?.close?.(); } catch {}; sseRef.current = null; setSseConnected(false); };

  const sendMessage = async (payload) => {
    setSendBusy(true);
    try {
      const r = await fetch('/api/testmcp/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      await r.json().catch(()=>({}));
    } catch {}
    setSendBusy(false);
  };

  const notify = (text, type='info') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadTools = async () => {
    setToolsLoading(true);
    try {
      const headers = {};
      if (adminToken) headers['x-admin-token'] = adminToken;
      const r = await fetch('/api/testmcp/tools', { headers, credentials: 'include' });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setTools(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setTools([]);
      // Show gentle hint; route is admin-protected
      notify('Failed to load tools (admin token?)', 'error');
    } finally {
      setToolsLoading(false);
    }
  };

  useEffect(() => { loadTools(); /* eslint-disable-next-line */ }, []);

  const saveAdminToken = () => {
    try { localStorage.setItem('testmcp_admin_token', adminToken || ''); } catch {}
    loadTools();
    notify('Token saved');
  };

  const notifyChanged = async () => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (adminToken) headers['x-admin-token'] = adminToken;
      const r = await fetch('/api/testmcp/tools/notify-changed', { method:'POST', headers, credentials:'include', body: '{}' });
      if (!r.ok) throw new Error(String(r.status));
      notify('Notified tools/list_changed');
    } catch {
      notify('Notify failed (admin token?)', 'error');
    }
  };

  const submitAddTool = async (e) => {
    e?.preventDefault?.();
    if (!addTool.name.trim()) { notify('Name required', 'error'); return; }
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (adminToken) headers['x-admin-token'] = adminToken;
      const r = await fetch('/api/testmcp/tools', {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify({ name: addTool.name.trim(), description: addTool.description || '' })
      });
      if (!r.ok) throw new Error(String(r.status));
      setAddTool({ name: '', description: '' });
      notify('Tool saved');
      loadTools();
    } catch {
      notify('Save failed (admin token?)', 'error');
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Test MCP</h2>
      <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center', marginBottom:8 }}>
        <div>Streamable HTTP (Inspector/OpenAI): <code>{window.location.origin}/api/testmcp/stream</code></div>
        <button onClick={async()=>{ try{ await navigator.clipboard.writeText(`${window.location.origin}/api/testmcp/stream`);}catch{}}}>Copy</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center', marginBottom:8 }}>
        <div>SSE events (subscribe-only): <code>{window.location.origin}/api/testmcp/events</code></div>
        <button onClick={async()=>{ try{ await navigator.clipboard.writeText(`${window.location.origin}/api/testmcp/events`);}catch{}}}>Copy</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8, alignItems:'center', marginBottom:12 }}>
        <div>NDJSON (viewer): <code>{window.location.origin}/testmcp/ndjson</code></div>
        <button onClick={async()=>{ try{ await navigator.clipboard.writeText(`${window.location.origin}/testmcp/ndjson`);}catch{}}}>Copy</button>
      </div>
      {toast && (
        <div style={{ margin: '8px 0', padding: '8px 12px', borderRadius: 6, background: toast.type==='error'?'#3b0d0d':'#0f2e14', color: toast.type==='error'?'#ffb3b3':'#b6f7c1' }}>{toast.text}</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {!connected && <button onClick={openStream}>Start Stream</button>}
        {connected && <span>Stream connected.</span>}
        {!sseConnected && <button onClick={openEvents}>Start SSE</button>}
        {sseConnected && (<><span>SSE connected.</span> <button onClick={stopEvents}>Stop SSE</button></>)}
        <button disabled={sendBusy} onClick={()=>sendMessage({ id: Date.now(), method: 'tools/list', params: {} })}>List Tools</button>
        <button disabled={sendBusy} onClick={()=>sendMessage({ id: Date.now(), method: 'tools/call', params: { name: 'ping' } })}>Call ping</button>
        <button disabled={sendBusy} onClick={()=>sendMessage({ id: Date.now(), method: 'tools/call', params: { name: 'time.now' } })}>Call time.now</button>
        <button disabled={sendBusy} onClick={()=>sendMessage({ id: Date.now(), method: 'tools/call', params: { name: 'random.int', arguments: { min: 1, max: 10 } } })}>Call random.int</button>
        <button disabled={sendBusy} onClick={()=>sendMessage({ id: Date.now(), method: 'tools/call', params: { name: 'echo', arguments: { text: 'Hello MCP' } } })}>Call echo</button>
      </div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>Recent stream items (latest first):</div>
      <pre style={{ background: '#111', color: '#0f0', padding: 12, borderRadius: 6, maxHeight: 260, overflow: 'auto' }}>
        {items.map((it, i) => (
          <div key={i}>{JSON.stringify(it)}</div>
        ))}
      </pre>

      {/* Admin card: token, tools list, notify button, add tool */}
      <div style={{ marginTop: 16, padding: 12, border: '1px solid #333', borderRadius: 8, background: '#161616' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <strong>Admin</strong>
          <span style={{ fontSize: 12, opacity: 0.7 }}>(needed to manage tools)</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <input value={adminToken} onChange={e=>setAdminToken(e.target.value)} placeholder="Admin token" style={{ flex: 1, padding: 6, borderRadius: 6, border: '1px solid #333', background: '#0f0f0f', color: '#fff' }} />
          <button onClick={saveAdminToken}>Save & Refresh</button>
          <button onClick={notifyChanged}>Notify tools changed</button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Tools</strong>
            <button onClick={loadTools} disabled={toolsLoading}>{toolsLoading ? 'Loading…' : 'Refresh'}</button>
          </div>
          <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #222', borderRadius: 6 }}>
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr><th style={{ textAlign: 'left', padding: '6px 8px' }}>Name</th><th style={{ textAlign: 'left', padding: '6px 8px' }}>Description</th></tr>
              </thead>
              <tbody>
                {tools.map((t, idx) => (
                  <tr key={idx}>
                    <td style={{ padding: '6px 8px' }}>{t.name}</td>
                    <td style={{ padding: '6px 8px', opacity: 0.8 }}>{t.description || ''}</td>
                  </tr>
                ))}
                {!tools.length && (
                  <tr><td colSpan={2} style={{ padding: '8px', opacity: 0.6 }}>No tools</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <form onSubmit={submitAddTool} style={{ display: 'flex', gap: 8 }}>
          <input value={addTool.name} onChange={e=>setAddTool(v=>({ ...v, name: e.target.value }))} placeholder="Tool name" style={{ flex: 1, padding: 6, borderRadius: 6, border: '1px solid #333', background: '#0f0f0f', color: '#fff' }} />
          <input value={addTool.description} onChange={e=>setAddTool(v=>({ ...v, description: e.target.value }))} placeholder="Description" style={{ flex: 2, padding: 6, borderRadius: 6, border: '1px solid #333', background: '#0f0f0f', color: '#fff' }} />
          <button type="submit">Add / Update</button>
        </form>
      </div>
    </div>
  );
}








