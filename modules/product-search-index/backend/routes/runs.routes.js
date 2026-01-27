import { runSearchIndex } from '../services/indexer.service.js';

function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerPsiRunsRoutes(app, ctx = {}, utils = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  const chatLog = utils.chatLog || ((_e,_p)=>{});

  // In-memory runs store
  const RUNS = (globalThis.__psi_runs ||= new Map()); // runId -> { status, createdAt, startedAt?, endedAt?, err?, subs:Set(res) }

  function newRunId() { return Math.random().toString(16).slice(2) + Date.now().toString(36); }

  function withSub(runId, res, onClose) {
    const r = RUNS.get(runId);
    if (!r) return false;
    const set = (r.subs ||= new Set());
    set.add(res);
    res.on('close', () => { try { set.delete(res); } catch {}; try { onClose && onClose(); } catch {} });
    return true;
  }

  function broadcast(runId, obj, eventId) {
    const r = RUNS.get(runId);
    if (!r || !r.subs || !r.subs.size) return;
    for (const res of r.subs) {
      try {
        if (eventId) res.write(`id: ${eventId}\n`);
        res.write('event: message\n');
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      } catch {}
    }
  }

  // Start a run
  app.post('/api/product-search-index/runs', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const runId = newRunId();
      RUNS.set(runId, { status: 'pending', createdAt: Date.now(), subs: new Set(), params: body, orgId });
      chatLog('psi.run.start', { runId, body: { ...body, password: undefined } });

      // Kick off async job; return immediately
      setTimeout(async () => {
        const r = RUNS.get(runId); if (!r) return;
        r.status = 'running'; r.startedAt = Date.now();
        broadcast(runId, { type: 'status', status: 'running', ts: Date.now() });
        try {
          // Stream step pings periodically
          const iv = setInterval(() => broadcast(runId, { type: 'ping', ts: Date.now() }), 10000);
          try {
            const out = await runSearchIndex(ctx, { pool, chatLog }, body, { emit: (ev) => broadcast(runId, ev) });
            r.status = 'done'; r.endedAt = Date.now(); r.result = out;
            broadcast(runId, { type: 'done', ok: true, result: out, ts: Date.now() });
          } catch (e) {
            r.status = 'error'; r.endedAt = Date.now(); r.err = e?.message || String(e);
            chatLog('psi.run.error', { runId, message: r.err });
            broadcast(runId, { type: 'error', ok: false, error: r.err, ts: Date.now() });
          } finally { clearInterval(iv); }
        } catch (e) {
          const r2 = RUNS.get(runId); if (r2) { r2.status = 'error'; r2.err = e?.message || String(e); r2.endedAt = Date.now(); }
          broadcast(runId, { type: 'error', ok: false, error: e?.message || String(e), ts: Date.now() });
        }
      }, 1);

      return res.json({ ok: true, run_id: runId });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'start_failed', message: e?.message || String(e) });
    }
  });

  // Subscribe to run events (SSE)
  app.get('/api/product-search-index/runs/:id/stream', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id || !RUNS.has(id)) return res.status(404).json({ ok:false, error:'not_found' });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}

      const ok = withSub(id, res, () => {});
      if (!ok) return; // closed
      // Send initial status snapshot
      const r = RUNS.get(id);
      if (r) {
        res.write(`event: message\n`);
        res.write(`data: ${JSON.stringify({ type: 'status', status: r.status, ts: Date.now() })}\n\n`);
      }
      // Keepalive
      const iv = setInterval(() => { try { res.write(`: ping ${Date.now()}\n\n`); } catch {} }, 10000);
      req.on('close', () => { clearInterval(iv); try { res.end(); } catch {} });
    } catch (e) {
      try { res.status(500).json({ ok:false, error:'sse_failed', message: e?.message || String(e) }); } catch {}
    }
  });
}
