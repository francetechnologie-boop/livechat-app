import fs from 'fs';
import path from 'path';

function normalizeOpenAIBase(raw) {
  try {
    let b = (raw && String(raw).trim()) || '';
    if (!b) return 'https://api.openai.com/v1';
    if (!/^https?:\/\//i.test(b)) return 'https://api.openai.com/v1';
    try { const u = new URL(b); if (!u.pathname || u.pathname === '/' || u.pathname === '') { u.pathname = '/v1'; b = u.toString().replace(/\/$/, ''); } } catch { return 'https://api.openai.com/v1'; }
    return b.replace(/\/$/, '');
  } catch { return 'https://api.openai.com/v1'; }
}

async function openaiHttp(pathname, { method = 'GET', body, apiKey, baseURL, extraHeaders } = {}, ctx = {}) {
  const key = (apiKey && String(apiKey).trim()) || (ctx?.extras?.getOpenaiApiKey?.() || process.env.OPENAI_API_KEY || '');
  if (!key) { const e = new Error('openai_key_missing'); e.status = 400; throw e; }
  const base = normalizeOpenAIBase(baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  const url = `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`;
  const headers = { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', ...(extraHeaders || {}) };
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(url, init);
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) { const err = new Error(json?.error?.message || json?.message || text || `http_${r.status}`); err.status = r.status; err.details = json || text; throw err; }
  return json;
}

async function uploadFileToOpenAI({ fileName, bytes, apiKey, baseURL }, ctx) {
  const key = (apiKey && String(apiKey).trim()) || (ctx?.extras?.getOpenaiApiKey?.() || process.env.OPENAI_API_KEY || '');
  if (!key) throw Object.assign(new Error('openai_key_missing'), { status: 400 });
  const base = normalizeOpenAIBase(baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  const url = `${base}/files`;
  // Use Node 18+ FormData/Blob
  const fd = new FormData();
  fd.append('purpose', 'assistants');
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  fd.append('file', blob, fileName || 'upload.bin');
  const r = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${key}` }, body: fd });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) { const err = new Error(json?.error?.message || json?.message || text || `http_${r.status}`); err.status = r.status; err.details = json || text; throw err; }
  return json; // { id, ... }
}

export function registerAutomationSuiteVectorRoutes(app, ctx = {}) {
  const pool = ctx?.pool;
  const requireAdmin = ctx?.requireAdmin;
  const backendDir = ctx?.backendDir || process.cwd();

  const appFilesDir = path.join(backendDir, 'app_files');
  function ensureAppFilesDir() { try { fs.mkdirSync(appFilesDir, { recursive: true }); } catch {} }

  // List vector stores (OpenAI)
  app.get('/api/automation-suite/vector-stores', async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 50)));
      const after = req.query?.after ? String(req.query.after) : undefined;
      const json = await openaiHttp('/vector_stores' + (after ? `?limit=${limit}&after=${encodeURIComponent(after)}` : `?limit=${limit}`), { method: 'GET' }, ctx);
      const items = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.items) ? json.items : []);
      const out = { ok: true, items };
      if (Object.prototype.hasOwnProperty.call(json || {}, 'has_more')) out.has_more = !!json.has_more;
      if (Object.prototype.hasOwnProperty.call(json || {}, 'last_id')) out.next_after = json.last_id;
      return res.json(out);
    } catch (e) { return res.status(e?.status || 500).json({ ok:false, error:'openai_error', message: e?.message || String(e) }); }
  });

  // Create vector store (OpenAI) — admin only
  app.post('/api/automation-suite/vector-stores', async (req, res) => {
    if (typeof requireAdmin === 'function' && !requireAdmin(req, res)) return;
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ ok:false, error:'bad_request' });
      const vs = await openaiHttp('/vector_stores', { method:'POST', body: { name } }, ctx);
      return res.status(201).json({ ok:true, item: vs });
    } catch (e) { return res.status(e?.status || 500).json({ ok:false, error:'openai_error', message: e?.message || String(e) }); }
  });

  // List files in a vector store
  app.get('/api/automation-suite/vector-stores/:id/files', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim(); if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const json = await openaiHttp(`/vector_stores/${encodeURIComponent(id)}/files?limit=100`, { method:'GET' }, ctx);
      const items = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.items) ? json.items : []);
      return res.json({ ok:true, items });
    } catch (e) { return res.status(e?.status || 500).json({ ok:false, error:'openai_error', message: e?.message || String(e) }); }
  });

  // Upload/link files to a vector store
  app.post('/api/automation-suite/vector-stores/:id/files', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim(); if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!items.length) return res.status(400).json({ ok:false, error:'bad_request' });
      ensureAppFilesDir();
      const linked = [];
      for (const it of items) {
        let bytes = null; let fileName = String(it.filename || '').trim();
        if (it.content_b64) {
          try { bytes = Buffer.from(String(it.content_b64), 'base64'); } catch {}
          if (!fileName) fileName = 'upload.bin';
        } else if (it.app_file_id) {
          const name = String(it.app_file_id);
          const full = path.join(appFilesDir, name);
          try { bytes = fs.readFileSync(full); if (!fileName) fileName = name; } catch {}
        } else if (it.file_url) {
          const url = String(it.file_url);
          const r = await fetch(url);
          const ab = await r.arrayBuffer();
          bytes = Buffer.from(ab);
          if (!fileName) { try { const u = new URL(url); fileName = path.basename(u.pathname) || 'download.bin'; } catch { fileName = 'download.bin'; } }
        }
        if (!bytes) continue;
        // 1) Upload file
        const up = await uploadFileToOpenAI({ fileName, bytes }, ctx);
        const fileId = up?.id || up?.file?.id || null; if (!fileId) continue;
        // 2) Link to vector store
        try { await openaiHttp(`/vector_stores/${encodeURIComponent(id)}/files`, { method:'POST', body:{ file_id: fileId } }, ctx); linked.push(fileId); } catch {}
      }
      return res.json({ ok:true, linked });
    } catch (e) { return res.status(e?.status || 500).json({ ok:false, error:'openai_error', message: e?.message || String(e) }); }
  });

  // Delete a file from vector store
  app.delete('/api/automation-suite/vector-stores/:id/files/:fileId', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const fid = String(req.params.fileId || '').trim();
      if (!id || !fid) return res.status(400).json({ ok:false, error:'bad_request' });
      await openaiHttp(`/vector_stores/${encodeURIComponent(id)}/files/${encodeURIComponent(fid)}`, { method:'DELETE' }, ctx);
      return res.json({ ok:true });
    } catch (e) { return res.status(e?.status || 500).json({ ok:false, error:'openai_error', message: e?.message || String(e) }); }
  });

  // Minimal app-files listing (filesystem-based)
  app.get('/api/automation-suite/app-files', async (_req, res) => {
    try {
      ensureAppFilesDir();
      const ents = fs.readdirSync(appFilesDir, { withFileTypes:true });
      const items = [];
      for (const ent of ents) {
        if (!ent.isFile()) continue;
        const name = ent.name;
        const full = path.join(appFilesDir, name);
        let st = null; try { st = fs.statSync(full); } catch { continue; }
        items.push({ id: name, name, title: name, size: st.size, mtime: st.mtimeMs, categories: [] });
      }
      return res.json({ ok:true, items, dir: appFilesDir });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Fetch a URL into app-files
  app.post('/api/automation-suite/app-files/fetch', async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!url) return res.status(400).json({ ok:false, error:'bad_request' });
      ensureAppFilesDir();
      const r = await fetch(url);
      if (!r.ok) return res.status(r.status).json({ ok:false, error:'fetch_failed' });
      const ab = await r.arrayBuffer();
      let fileName = null; try { const u = new URL(url); fileName = path.basename(u.pathname) || null; } catch {}
      if (!fileName) fileName = `f_${Date.now()}.bin`;
      const full = path.join(appFilesDir, fileName);
      fs.writeFileSync(full, Buffer.from(ab));
      return res.json({ ok:true, results:[{ name: fileName }] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Validate JSON content of a file
  app.get('/api/automation-suite/app-files/:id/validate-json', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const max = Math.max(1, Math.min(20_000_000, Number(req.query?.max_bytes || 2_000_000)));
      ensureAppFilesDir();
      const full = path.join(appFilesDir, id);
      const st = fs.statSync(full);
      if (st.size > max) return res.json({ ok:true, valid:false, error:'too_large', size: st.size, limit: max });
      const text = fs.readFileSync(full, 'utf8');
      try {
        const obj = JSON.parse(text);
        if (Array.isArray(obj)) return res.json({ ok:true, valid:true, type:'array', length: obj.length });
        if (obj && typeof obj === 'object') return res.json({ ok:true, valid:true, type:'object', keys: Object.keys(obj).length });
        return res.json({ ok:true, valid:true, type: typeof obj });
      } catch (e) {
        // Try to find line/column if available
        return res.json({ ok:true, valid:false, error: e?.message || 'parse_error' });
      }
    } catch { return res.json({ ok:true, valid:false, error:'not_found' }); }
  });

  app.get('/api/app-files/:id/download', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
      ensureAppFilesDir();
      const full = path.join(appFilesDir, id);
      const normalized = path.normalize(full);
      if (!normalized.startsWith(path.normalize(appFilesDir))) return res.status(400).json({ ok:false, error:'bad_request' });
      if (!fs.existsSync(normalized)) return res.status(404).json({ ok:false, error:'not_found' });
      return res.download(normalized, path.basename(normalized));
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: String(e?.message || e) });
    }
  });

  // Minimal categories endpoint (empty set)
  app.get('/api/automation-suite/file-categories', async (_req, res) => {
    return res.json({ ok:true, items: [] });
  });
}
