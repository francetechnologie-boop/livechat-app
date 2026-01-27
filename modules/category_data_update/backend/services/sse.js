const channels = new Map(); // runId -> { clients:Set<res> }

function getChannel(runId) {
  const key = String(runId||'');
  if (!channels.has(key)) channels.set(key, { clients: new Set() });
  return channels.get(key);
}

export function emitRunEvent(runId, event, payload = {}) {
  try {
    const ch = getChannel(runId);
    const msg = `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of ch.clients) {
      try { res.write(msg); } catch (e) {}
    }
  } catch (e) {}
}

export function registerSseRoutes(app, ctx = {}, utils = {}) {
  const chatLog = utils?.chatLog || (()=>{});
  app.get('/api/category_data_update/translator-runs/:id/stream', (req, res) => {
    const runId = String(req.params.id || '');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: hello\n` + `data: {"run_id":"${runId}"}\n\n`);
    try { chatLog('cdu_sse_client_connected', { run_id: runId }); } catch (e) {}
    const ch = getChannel(runId);
    ch.clients.add(res);
    const timer = setInterval(() => { try { res.write(`event: ping\n` + `data: {"t":${Date.now()}}\n\n`); } catch (e) {} }, 15000);
    req.on('close', () => { clearInterval(timer); ch.clients.delete(res); try { res.end(); } catch (e) {}; try { chatLog('cdu_sse_client_disconnected', { run_id: runId }); } catch (e) {} });
  });
}
