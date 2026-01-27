import React, { useEffect, useMemo, useRef, useState } from "react";

export default function McpTester({ botId, preferSubdomain = true }) {
  const [wsUrl, setWsUrl] = useState("");
  const [connected, setConnected] = useState(false);
  const [log, setLog] = useState([]);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState(null);
  const wsRef = useRef(null);
  const idRef = useRef(1);

  useEffect(() => {
    try {
      const host = window.location.hostname || "";
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      let base;
      if (preferSubdomain && /^chat\./i.test(host)) {
        base = `${proto}//${host.replace(/^chat\./i, 'mcp.')}/mcp/ws`;
      } else {
        const h = window.location.host;
        base = `${proto}//${h}/mcp/ws`;
      }
      const url = botId ? `${base}/bot/${encodeURIComponent(botId)}` : base;
      setWsUrl(url);
    } catch {}
  }, [botId, preferSubdomain]);

  const append = (line) => setLog((x) => [...x, line].slice(-500));

  const connect = () => {
    if (!wsUrl) return;
    try { wsRef.current?.close(); } catch {}
    const ws = new WebSocket(wsUrl, ["vnd.mcp+json", "mcp", "jsonrpc"]);
    wsRef.current = ws;
    ws.onopen = () => { setConnected(true); append(`OPEN ${wsUrl}`); send({ method: "tools/list" }); };
    ws.onclose = (e) => { setConnected(false); append(`CLOSE ${e.code} ${e.reason || ''}`); };
    ws.onerror = () => append("ERR");
    ws.onmessage = (e) => append(`MSG ${e.data}`);
  };

  const disconnect = () => { try { wsRef.current?.close(); } catch {}; };

  const send = ({ method, params }) => {
    const ws = wsRef.current; if (!ws || ws.readyState !== 1) return;
    const id = idRef.current++;
    const frame = { jsonrpc: "2.0", id, method, params };
    ws.send(JSON.stringify(frame));
  };

  const doSearch = () => {
    if (!query.trim()) return;
    send({ method: 'tools/call', params: { name: 'search_documents', arguments: { query, limit: 10 } } });
  };

  // Derive HTTP base (for /mcp/* REST endpoints) from wsUrl
  const httpBase = useMemo(() => {
    try {
      if (!wsUrl) return "";
      const u = new URL(wsUrl);
      const scheme = (u.protocol === 'wss:') ? 'https:' : 'http:';
      return `${scheme}//${u.host}/mcp`;
    } catch { return ""; }
  }, [wsUrl]);

  const listFiles = async () => {
    try {
      if (!httpBase) throw new Error('httpBase not resolved');
      const url = botId ? `${httpBase}/files?bot_id=${encodeURIComponent(botId)}` : `${httpBase}/files`;
      const res = await fetch(url); // no credentials to avoid CORS issues
      const j = await res.json();
      append(`FILES ${JSON.stringify(j)}`);
    } catch (e) {
      append(`FILES_ERR ${e?.message || e}`);
    }
  };

  const upload = async () => {
    try {
      if (!file) return;
      if (!httpBase) throw new Error('httpBase not resolved');
      if (file.size > 20 * 1024 * 1024) { append('UPLOAD_ERR file too large (>20MB)'); return; }
      setUploading(true);
      // Use FileReader data URL to avoid call stack limits for large files
      const base64 = await new Promise((resolve, reject) => {
        try {
          const fr = new FileReader();
          fr.onerror = () => reject(new Error('read_failed'));
          fr.onload = () => {
            try {
              const dataUrl = String(fr.result || '');
              const idx = dataUrl.indexOf('base64,');
              resolve(idx >= 0 ? dataUrl.slice(idx + 7) : '');
            } catch (e) { reject(e); }
          };
          fr.readAsDataURL(file);
        } catch (e) { reject(e); }
      });
      const body = {
        filename: file.name,
        content_base64: base64,
        content_type: file.type || 'application/octet-stream',
      };
      if (botId) body.bot_id = botId;
      const res = await fetch(`${httpBase}/files/base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.message || 'upload_failed');
      append(`UPLOAD ${JSON.stringify(j)}`);
      setFile(null);
      try { await listFiles(); } catch {}
    } catch (e) {
      append(`UPLOAD_ERR ${e?.message || e}`);
    } finally { setUploading(false); }
  };

  return (
    <div className="mt-4 p-3 border rounded bg-white">
      <div className="font-medium mb-2">MCP Tester</div>
      <div className="text-xs text-gray-600 mb-2 break-all">WS: {wsUrl || '(resolving...)'}</div>
      <div className="flex items-center gap-2 mb-2">
        {!connected ? (
          <button className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700" onClick={connect}>Connect</button>
        ) : (
          <button className="text-xs px-3 py-1 rounded bg-gray-700 text-white hover:bg-gray-800" onClick={disconnect}>Disconnect</button>
        )}
        <button className="text-xs px-3 py-1 rounded border" onClick={() => send({ method: 'tools/list' })} disabled={!connected}>tools/list</button>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="search_documents: query" value={query} onChange={(e)=>setQuery(e.target.value)} />
        <button className="text-xs px-3 py-1 rounded border" onClick={doSearch} disabled={!connected || !query.trim()}>Search</button>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <input type="file" className="text-xs" onChange={(e)=>setFile(e.target.files?.[0] || null)} />
        <button className="text-xs px-3 py-1 rounded border" onClick={upload} disabled={!httpBase || !file || uploading}>{uploading ? 'Uploading…' : 'Upload'}</button>
        <button className="text-xs px-3 py-1 rounded border" onClick={listFiles} disabled={!httpBase}>List files</button>
      </div>
      <pre className="text-xs bg-gray-50 border rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">{log.join("\n")}</pre>
    </div>
  );
}
