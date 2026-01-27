(() => {
  const $ = (sel) => document.querySelector(sel);
  const wsUrlEl = $('#wsUrl');
  const tokenEl = $('#token');
  const connectBtn = $('#connectBtn');
  const disconnectBtn = $('#disconnectBtn');
  const btnToolsList = $('#btnToolsList');
  const methodEl = $('#method');
  const idEl = $('#id');
  const paramsEl = $('#params');
  const sendBtn = $('#sendBtn');
  const logEl = $('#log');

  /** @type {WebSocket|null} */
  let ws = null;

  const log = (type, msg) => {
    const time = new Date().toISOString().replace('T', ' ').replace('Z', 'Z');
    const line = `[${time}] ${type.toUpperCase()} ${msg}`;
    logEl.textContent += (logEl.textContent ? "\n" : "") + line;
    logEl.scrollTop = logEl.scrollHeight;
  };

  const buildUrlWithToken = () => {
    try {
      const raw = (wsUrlEl.value || '').trim();
      const token = (tokenEl.value || '').trim();
      if (!raw) return '';
      const u = new URL(raw);
      if (token) {
        // Do not duplicate token param if already set
        if (!u.searchParams.has('token')) u.searchParams.set('token', token);
      }
      return u.toString();
    } catch (e) {
      return (wsUrlEl.value || '').trim();
    }
  };

  const setUiState = (connected) => {
    connectBtn.disabled = connected;
    disconnectBtn.disabled = !connected;
    btnToolsList.disabled = !connected;
    sendBtn.disabled = !connected;
    wsUrlEl.disabled = connected;
    tokenEl.disabled = connected;
  };

  setUiState(false);

  connectBtn.addEventListener('click', () => {
    const url = buildUrlWithToken();
    if (!url) return;
    try { if (ws) { ws.close(); ws = null; } } catch {}
    log('info', `Connecting to ${url}`);
    try {
      ws = new WebSocket(url, ["vnd.mcp+json", "mcp", "jsonrpc"]);
    } catch (e) {
      log('err', `Failed to create WebSocket: ${e?.message || e}`);
      return;
    }
    ws.onopen = () => { log('ok', 'OPEN'); setUiState(true); sendToolsList(); };
    ws.onclose = (ev) => { log('info', `CLOSE code=${ev.code} reason=${ev.reason || ''}`); setUiState(false); };
    ws.onerror = () => { log('err', 'WS error'); };
    ws.onmessage = (ev) => { log('msg', ev.data); };
  });

  disconnectBtn.addEventListener('click', () => {
    try { if (ws) ws.close(1000, 'bye'); } catch {}
  });

  const sendJsonRpc = (id, method, params) => {
    if (!ws || ws.readyState !== 1) return;
    const frame = { jsonrpc: '2.0', id, method };
    if (params !== undefined && params !== null) frame.params = params;
    const txt = JSON.stringify(frame);
    ws.send(txt);
    log('send', txt);
  };

  const sendToolsList = () => {
    const id = Number(idEl.value || 1) || 1;
    sendJsonRpc(id, 'tools/list', undefined);
    idEl.value = String(id + 1);
  };

  btnToolsList.addEventListener('click', sendToolsList);

  sendBtn.addEventListener('click', () => {
    const id = Number(idEl.value || 1) || 1;
    const method = (methodEl.value || '').trim();
    let params = undefined;
    const raw = (paramsEl.value || '').trim();
    if (raw) {
      try { params = JSON.parse(raw); }
      catch (e) { log('err', `Params JSON parse error: ${e?.message || e}`); return; }
    }
    if (!method) { log('err', 'Method required'); return; }
    sendJsonRpc(id, method, params);
    idEl.value = String(id + 1);
  });
})();

