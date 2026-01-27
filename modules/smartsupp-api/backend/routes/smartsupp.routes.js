import fs from 'fs';
import path from 'path';

const SM_BASE = 'https://api.smartsupp.com';

function backendDirFromModule() {
  const here = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  // modules/<id>/backend/routes -> ../../.. = modules/<id>, ../../../../ = repo root; then join backend
  const repoRootGuess = path.resolve(here, '../../../../');
  let candidate = path.join(repoRootGuess, 'backend');
  try { if (fs.existsSync(candidate)) return candidate; } catch {}
  // Fallback: if process CWD is already backend/, use it
  try {
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, 'package.json'))) return cwd;
  } catch {}
  return candidate; // last resort
}

function ensureDirs(base) {
  const smartsuppDir = path.join(base, 'uploads', 'smartsupp');
  const smartsuppAssetsDir = path.join(base, 'uploads', 'smartsupp-assets');
  try { fs.mkdirSync(smartsuppDir, { recursive: true }); } catch {}
  try { fs.mkdirSync(smartsuppAssetsDir, { recursive: true }); } catch {}
  return { smartsuppDir, smartsuppAssetsDir };
}

export function registerSmartsuppRoutes(app, ctx = {}) {
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ error: 'unauthorized' }); return null; });
  const pool = ctx.pool;
  const log = (m) => { try { ctx.logToFile?.(`[smartsupp-api] ${m}`); } catch {} };
  const backendDir = backendDirFromModule();
  const { smartsuppDir, smartsuppAssetsDir } = ensureDirs(backendDir);

  // Normalize Smartsupp conversation objects to legacy snake_case structure used previously
  function firstNonNull(...vals) { for (const v of vals) { if (v !== undefined && v !== null) return v; } return null; }
  function normChannel(ch) {
    if (!ch || typeof ch !== 'object') return { type: null, id: null };
    return { type: firstNonNull(ch.type, ch.channelType, ch.kind), id: firstNonNull(ch.id, ch.channelId) };
  }
  function normTags(tags) {
    if (!tags || typeof tags !== 'object') return { type: 'list', data: [], total: 0 };
    const data = Array.isArray(tags.data) ? tags.data : (Array.isArray(tags.items) ? tags.items : []);
    const total = Number(firstNonNull(tags.total, data.length)) || 0;
    const type = String(firstNonNull(tags.type, 'list'));
    return { type, data, total };
  }
  function normLocation(loc) {
    if (!loc || typeof loc !== 'object') return { ip: null, code: null, country: null, city: null };
    return {
      ip: firstNonNull(loc.ip, loc.ip_address, loc.ipAddress),
      code: firstNonNull(loc.code, loc.country_code, loc.countryCode),
      country: firstNonNull(loc.country, loc.country_name, loc.countryName),
      city: firstNonNull(loc.city)
    };
  }
  function normContent(c) {
    if (!c || typeof c !== 'object') return { type: null, text: null, data: null };
    return { type: firstNonNull(c.type), text: firstNonNull(c.text), data: firstNonNull(c.data) };
  }
  function normMessage(m) {
    if (!m || typeof m !== 'object') return null;
    return {
      id: firstNonNull(m.id),
      ext_id: firstNonNull(m.ext_id, m.external_id, m.externalId),
      created_at: firstNonNull(m.created_at, m.createdAt),
      updated_at: firstNonNull(m.updated_at, m.updatedAt),
      type: firstNonNull(m.type),
      sub_type: firstNonNull(m.sub_type, m.subType),
      channel: normChannel(m.channel),
      conversation_id: firstNonNull(m.conversation_id, m.conversationId),
      visitor_id: firstNonNull(m.visitor_id, m.visitorId),
      agent_id: firstNonNull(m.agent_id, m.agentId),
      content: normContent(m.content),
      trigger_id: firstNonNull(m.trigger_id, m.triggerId),
      trigger_name: firstNonNull(m.trigger_name, m.triggerName),
      delivery_to: firstNonNull(m.delivery_to, m.deliveryTo),
      delivery_status: firstNonNull(m.delivery_status, m.deliveryStatus),
      delivered_at: firstNonNull(m.delivered_at, m.deliveredAt),
      is_reply: firstNonNull(m.is_reply),
      is_first_reply: firstNonNull(m.is_first_reply, m.isFirstReply),
      is_offline: firstNonNull(m.is_offline, m.offline),
      is_offline_reply: firstNonNull(m.is_offline_reply, m.isOfflineReply),
      response_time: firstNonNull(m.response_time, m.responseTime),
      attachments: Array.isArray(m.attachments) ? m.attachments : [],
      page_url: firstNonNull(m.page_url, m.pageUrl)
    };
  }
  function normalizeConversation(it) {
    if (!it || typeof it !== 'object') return it;
    const messages = Array.isArray(it.messages) ? it.messages.map(normMessage).filter(Boolean) : [];
    const agentIds = firstNonNull(it.agent_ids, it.agentIds, it.agents);
    const assignedIds = firstNonNull(it.assigned_ids, it.assignedIds);
    return {
      id: firstNonNull(it.id),
      ext_id: firstNonNull(it.ext_id, it.external_id, it.externalId),
      created_at: firstNonNull(it.created_at, it.createdAt),
      updated_at: firstNonNull(it.updated_at, it.updatedAt),
      finished_at: firstNonNull(it.finished_at, it.finishedAt),
      channel: normChannel(it.channel),
      status: firstNonNull(it.status),
      contact_id: firstNonNull(it.contact_id, it.contactId, it.contact?.id),
      visitor_id: firstNonNull(it.visitor_id, it.visitorId),
      agent_ids: Array.isArray(agentIds) ? agentIds : (agentIds ? [agentIds] : []),
      assigned_ids: Array.isArray(assignedIds) ? assignedIds : (assignedIds ? [assignedIds] : []),
      group_id: firstNonNull(it.group_id, it.groupId),
      rating_value: firstNonNull(it.rating_value, it.ratingValue),
      rating_text: firstNonNull(it.rating_text, it.ratingText),
      domain: firstNonNull(it.domain, it.site_domain, it.siteDomain),
      referer: firstNonNull(it.referer, it.referrer),
      is_offline: firstNonNull(it.is_offline, it.offline),
      is_served: firstNonNull(it.is_served, it.served),
      variables: firstNonNull(it.variables, {}),
      tags: normTags(it.tags),
      location: normLocation(it.location),
      messages
    };
  }

  async function hydrateConversations(items, token, { max = 2000, concurrency = 5 } = {}) {
    try {
      if (!Array.isArray(items) || !items.length) return { items, hydrated: 0 };
      const slice = items.slice(0, Math.max(1, Math.min(max, items.length)));
      let hydrated = 0;
      let cursor = 0;
      async function worker() {
        while (cursor < slice.length) {
          const idx = cursor++;
          const it = slice[idx];
          try {
            const id = it && (it.id || it.conversation_id || it.conversationId);
            if (!id) continue;
            const r = await fetch(`${SM_BASE}/v2/conversations/${encodeURIComponent(id)}/messages`, { headers: { 'Authorization': `Bearer ${token}` } });
            const j = await r.json().catch(()=>({}));
            if (!r.ok) continue;
            const arr = Array.isArray(j?.items) ? j.items : (Array.isArray(j?.hits) ? j.hits : (Array.isArray(j) ? j : []));
            it.messages = arr.map(normMessage).filter(Boolean);
            hydrated++;
          } catch {}
        }
      }
      const workers = Array.from({ length: Math.max(1, Math.min(concurrency, slice.length)) }, () => worker());
      await Promise.allSettled(workers);
      return { items, hydrated };
    } catch { return { items, hydrated: 0 }; }
  }

  async function resolveSmartsuppToken(req) {
    const cand = String(req.headers['x-smartsupp-token'] || req.query?.token || req.body?.token || '').trim();
    if (cand) return cand;
    // Try module table first
    try {
      const r = await pool.query(`SELECT api_token FROM mod_smartsupp_api_settings WHERE org_id='org_default' LIMIT 1`);
      const t = r.rowCount ? String(r.rows[0].api_token || '').trim() : '';
      if (t) return t;
    } catch {}
    // Fallback to legacy settings
    try {
      const r = await pool.query(`SELECT value FROM settings WHERE key='SMARTSUPP_API_TOKEN' LIMIT 1`);
      const t = r.rowCount ? String(r.rows[0].value || '').trim() : '';
      if (t) return t;
    } catch {}
    // Env fallback
    const envToken = String(process.env.SMARTSUPP_API_TOKEN || process.env.SMARTSUPP_ACCESS_TOKEN || process.env.SMARTSUPP_TOKEN || '').trim();
    return envToken;
  }

  app.post('/api/smartsupp/conversations', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const token = await resolveSmartsuppToken(req);
    if (!token) return res.status(400).json({ ok:false, error:'missing_token', message:'Set token via module or pass token param.' });
    try {
      const payload = (req.body && typeof req.body === 'object') ? { ...req.body } : {};
      delete payload.token;
      if (!payload.size) payload.size = 50;
      if (!payload.sort) payload.sort = [{ createdAt: 'desc' }];
      const r = await fetch(`${SM_BASE}/v2/conversations/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) return res.status(r.status).json({ ok:false, error:'upstream_error', message: j?.message || j?.error || `http_${r.status}`, data: j });
      const items = Array.isArray(j?.items) ? j.items : (Array.isArray(j?.hits) ? j.hits : (Array.isArray(j) ? j : []));
      return res.json({ ok:true, items, raw: j });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/smartsupp/conversations/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const token = await resolveSmartsuppToken(req);
    if (!token) return res.status(400).json({ ok:false, error:'missing_token' });
    try {
      const id = String(req.params.id||'').trim();
      const r = await fetch(`${SM_BASE}/v2/conversations/${encodeURIComponent(id)}`, { headers: { 'Authorization': `Bearer ${token}` } });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) return res.status(r.status).json({ ok:false, error:'upstream_error', message: j?.message || j?.error || `http_${r.status}`, data: j });
      return res.json({ ok:true, item: j?.data || j });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/smartsupp/conversations/:id/messages', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const token = await resolveSmartsuppToken(req);
    if (!token) return res.status(400).json({ ok:false, error:'missing_token' });
    try {
      const id = String(req.params.id||'').trim();
      const r = await fetch(`${SM_BASE}/v2/conversations/${encodeURIComponent(id)}/messages`, { headers: { 'Authorization': `Bearer ${token}` } });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) return res.status(r.status).json({ ok:false, error:'upstream_error', message: j?.message || j?.error || `http_${r.status}`, data: j });
      const items = Array.isArray(j?.items) ? j.items : (Array.isArray(j?.messages) ? j.messages : (Array.isArray(j) ? j : []));
      return res.json({ ok:true, items, raw: j });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // The remaining endpoints (download/export, files list, assets fetch/serve)
  // are copied as-is from legacy server.js with paths updated to module directories.

  app.get('/api/smartsupp/download', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const token = await resolveSmartsuppToken(req);
    if (!token) return res.status(400).json({ ok:false, error:'missing_token' });
    try {
      const field = String(req.query?.field || 'createdAt');
      const query = (req.query?.q && typeof req.query.q === 'object') ? req.query.q : {};
      const size = Math.max(1, Math.min(500, Number(req.query?.size || 100)));
      const pages = Math.max(1, Math.min(20, Number(req.query?.pages || 1)));
      const format = String(req.query?.format || 'json').toLowerCase();

      const items = [];
      let after = undefined; let usedField = field;
      for (let p = 0; p < pages; p++) {
        const payload = { size, sort: [{ [usedField]: 'desc' }], query, ...(after ? { after } : {}) };
        try { log(`[smartsupp] try field=${usedField} payload=${JSON.stringify(payload)}`); } catch {}
        const r = await fetch(`${SM_BASE}/v2/conversations/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
        const j = await r.json().catch(()=>({}));
        if (!r.ok) {
          const text = j && (j.message || j.error) ? JSON.stringify(j) : '';
          try { log(`[smartsupp] upstream_error status=${r.status} body=${String(text).slice(0,2000)}`); } catch {}
          return res.status(r.status).json({ ok:false, error:'upstream_error', message: j?.message || j?.error || `http_${r.status}`, data: j });
        }
        const arr = Array.isArray(j?.items) ? j.items : (Array.isArray(j?.hits) ? j.hits : (Array.isArray(j) ? j : []));
        const got = arr.length;
        items.push(...arr);
        after = j?.after || undefined;
        try { log(`[smartsupp] field=${usedField} page=${p+1} got=${got} after=${JSON.stringify(j?.after||null)}`); } catch {}
        if (!after || !got) break;
      }

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="smartsupp_conversations_${Date.now()}.csv"`);
        const cols = new Set();
        items.forEach(it => Object.keys(it||{}).forEach(k=>cols.add(k)));
        const headers = Array.from(cols);
        res.write(headers.join(';') + '\n');
        for (const it of items) {
          const row = headers.map(h => JSON.stringify(it?.[h] ?? '').replace(/^"|"$/g,''));
          res.write(row.join(';') + '\n');
        }
        return res.end();
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="smartsupp_conversations_${Date.now()}.json"`);
      return res.end(JSON.stringify({ ok:true, items }));
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/smartsupp/download-range', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const token = await resolveSmartsuppToken(req);
    if (!token) return res.status(400).json({ ok:false, error:'missing_token' });
    try {
      const fromDate = new Date(String(req.query?.from || ''));
      const toDate = new Date(String(req.query?.to || ''));
      if (!(fromDate instanceof Date) || isNaN(fromDate)) return res.status(400).json({ ok:false, error:'bad_request', message:'from invalid'});
      if (!(toDate instanceof Date) || isNaN(toDate)) return res.status(400).json({ ok:false, error:'bad_request', message:'to invalid'});
      // Normalize bounds to inclusive day range in UTC
      const fromIso = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate(), 0, 0, 0, 0)).toISOString();
      const toIso = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate(), 23, 59, 59, 999)).toISOString();
      // User-requested size; upstream generally caps at 50 — auto-cap to keep requests valid
      const requestedSize = Math.max(1, Math.min(10000, Number(req.query?.size || 1000)));
      const size = Math.min(50, requestedSize); // used in payloads to Smartsupp
      const format = String(req.query?.format || 'json').toLowerCase();

      function buildPayloads(field, after) {
        const common = after ? { after } : {};
        // Variant A: filters top-level + sort string value (createdAt: 'desc')
        const vA = { size, sort: [{ [field]: 'desc' }], filters: { range: { [field]: { gte: fromIso, lte: toIso } } }, ...common };
        // Variant B: query.filter + sort string value (object form)
        const vB = { size, sort: [{ [field]: 'desc' }], query: { filter: { range: { [field]: { gte: fromIso, lte: toIso } } } }, ...common };
        // Variant C: query.range + sort string value (object form)
        const vC = { size, sort: [{ [field]: 'desc' }], query: { range: { [field]: { gte: fromIso, lte: toIso } } }, ...common };
        // Variant D: query is array of clauses (range)
        const vD = { size, sort: [{ [field]: 'desc' }], query: [{ range: { [field]: { gte: fromIso, lte: toIso } } }], ...common };
        // Variant E: query is array of clauses (filter+range)
        const vE = { size, sort: [{ [field]: 'desc' }], query: [{ filter: { range: { [field]: { gte: fromIso, lte: toIso } } } }], ...common };
        // Variant F: query array with field/operator/value (separate gte/lte)
        const vF = { size, sort: [{ [field]: 'desc' }], query: [
          { field, operator: 'gte', value: fromIso },
          { field, operator: 'lte', value: toIso }
        ], ...common };
        // Variant G: query array with field/operator:value range object
        const vG = { size, sort: [{ [field]: 'desc' }], query: [
          { field, operator: 'range', value: { gte: fromIso, lte: toIso } }
        ], ...common };
        // Variant H: query array with between + array value
        const vH = { size, sort: [{ [field]: 'desc' }], query: [ { field, operator: 'between', value: [fromIso, toIso] } ], ...common };
        // Variant I: query array with between + object value { from, to }
        const vI = { size, sort: [{ [field]: 'desc' }], query: [ { field, operator: 'between', value: { from: fromIso, to: toIso } } ], ...common };
        // Variant J: query array item with type: 'date'
        const vJ = { size, sort: [{ [field]: 'desc' }], query: [ { type: 'date', field, operator: 'between', value: { from: fromIso, to: toIso } } ], ...common };
        // Variant K: minimal range clause inside array without wrapper keys
        const vK = { size, sort: [{ [field]: 'desc' }], query: [ { [field]: { gte: fromIso, lte: toIso } } ], ...common };
        // Variant L: two simple eq clauses narrowing by day (fallback, may be large)
        // Note: not exact range; included for schema exploration if accepted
        const vL = { size, sort: [{ [field]: 'desc' }], query: [ { field, value: fromIso }, { field, value: toIso } ], ...common };
        return [vA, vB, vC, vD, vE, vF, vG, vH, vI, vJ, vK, vL];
      }

      async function fetchRange(field) {
        const out = [];
        const afterTags = [];
        let after = undefined; let pagesCount = 0; const maxPages = 1000;
        for (;;) {
          if (pagesCount >= maxPages) break; pagesCount++;
          let ok = false, lastErr = null, lastPayload = null, payloadVariant = -1;
          const variants = buildPayloads(field, after);
          for (let i = 0; i < variants.length; i++) {
            const payload = variants[i];
            lastPayload = payload; payloadVariant = i;
            const r = await fetch(`${SM_BASE}/v2/conversations/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify(payload)
            });
            const j = await r.json().catch(()=>({}));
            if (r.ok) {
              const arr = Array.isArray(j?.items) ? j.items : (Array.isArray(j?.hits) ? j.hits : (Array.isArray(j) ? j : []));
              out.push(...arr);
              after = j?.after || undefined;
              afterTags.push(after ? String(after) : '');
              ok = true;
              break;
            } else {
              lastErr = { status: r.status, message: j?.message || j?.error || `http_${r.status}`, data: j, variant: i, payload };
              // Try next variant on 400/422 invalid-style errors; break on auth or server errors
              if (!(r.status === 400 || r.status === 422)) break;
            }
          }
          if (!ok) {
            const err = new Error(lastErr?.message || 'invalid_request');
            err.status = lastErr?.status || 400; err.data = lastErr?.data || null; err.variant = lastErr?.variant; err.payload = lastErr?.payload;
            throw err;
          }
          if (!after) break;
        }
        return { items: out, pagesCount, afterTags };
      }

      // Fallback: scan without server-side filters (unfiltered search), then filter by date locally.
      // Useful when Smartsupp rejects all range variants but still returns data unfiltered.
      async function scanUnfiltered(field) {
        const out = [];
        const afterTags = [];
        let after = undefined; let pagesCount = 0; const maxPages = 50; // defensive cap
        const sizeUnf = Math.max(1, Math.min(50, size));
        const getStamp = (it) => {
          try {
            const v = it?.[field] || it?.created_at || it?.createdAt || it?.updated_at || it?.updatedAt;
            return v ? new Date(v).toISOString() : null;
          } catch { return null; }
        };
        for (;;) {
          if (pagesCount >= maxPages) break; pagesCount++;
          const payload = { size: sizeUnf, sort: [{ [field]: 'desc' }], ...(after ? { after } : {}) };
          const r = await fetch(`${SM_BASE}/v2/conversations/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept':'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
          const j = await r.json().catch(()=>({}));
          if (!r.ok) break;
          const arr = Array.isArray(j?.items) ? j.items : (Array.isArray(j?.hits) ? j.hits : (Array.isArray(j) ? j : []));
          if (!arr.length) break;
          for (const it of arr) {
            const ts = getStamp(it);
            if (ts && ts >= fromIso && ts <= toIso) out.push(it);
            // early exit if we've passed the lower bound
          }
          after = j?.after || undefined;
          afterTags.push(after ? String(after) : '');
          // stop if oldest item on page is older than fromIso
          const last = arr[arr.length - 1];
          const lastTs = getStamp(last);
          if (!after || (lastTs && lastTs < fromIso)) break;
        }
        return { items: out, pagesCount, afterTags };
      }

      let items = [];
      let afterTags = [];
      let pagesCount = 0;
      let usedField = '';
      const fieldsToTry = ['updated_at','created_at','updatedAt','createdAt'];
      let lastErr = null;
      for (const f of fieldsToTry) {
        try {
          const rTry = await fetchRange(f);
          usedField = f; items = rTry.items; afterTags = rTry.afterTags; pagesCount = rTry.pagesCount;
          break;
        } catch (e) {
          lastErr = e;
          // try next for 4xx invalids; abort on other errors
          if (!(e && (e.status === 400 || e.status === 422 || String(e.message||'').toLowerCase().includes('invalid')))) {
            return res.status(e.status||400).json({ ok:false, error:'upstream_error', message: e.message || 'Invalid request', data: e.data || null, debug: { field: f, from: fromIso, to: toIso, size, variant: e.variant, payload: e.payload } });
          }
        }
      }
      if (!usedField) {
        // Last resort: try unfiltered scan using created_at
        try {
          const unf = await scanUnfiltered('created_at');
          usedField = 'created_at'; items = unf.items; afterTags = unf.afterTags; pagesCount = unf.pagesCount;
        } catch (e) {
          return res.status(lastErr?.status||400).json({ ok:false, error:'upstream_error', message: lastErr?.message || 'Invalid request', data: lastErr?.data || null, debug: { field: 'unknown', from: fromIso, to: toIso, size, variant: lastErr?.variant, payload: lastErr?.payload } });
        }
      }
      // If we still got zero items, try unfiltered scan once to recover some results
      if (!items.length) {
        try {
          const unf2 = await scanUnfiltered(usedField || 'created_at');
          items = unf2.items; afterTags = unf2.afterTags; pagesCount = unf2.pagesCount;
        } catch {}
      }

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="smartsupp_conversations_${fromDate.toISOString().slice(0,10)}_${toDate.toISOString().slice(0,10)}.csv"`);
        const cols = new Set(); items.forEach(it => Object.keys(it||{}).forEach(k=>cols.add(k)));
        const headers = Array.from(cols); res.write(headers.join(';') + '\n');
        for (const it of items) { const row = headers.map(h => JSON.stringify(it?.[h] ?? '').replace(/^"|"$/g,'')); res.write(row.join(';') + '\n'); }
        return res.end();
      }
      // Normalize + hydrate to legacy structure, always save to server (restore legacy behavior) and return file metadata
      try {
        const normItems = Array.isArray(items) ? items.map(normalizeConversation) : [];
        // Hydrate messages for each conversation (default on); disable with ?no_hydrate=1
        const doHydrate = !/^(1|true|yes)$/i.test(String(req.query?.no_hydrate || ''));
        let hydratedCount = 0;
        if (doHydrate && normItems.length) {
          const h = await hydrateConversations(normItems, token, { max: 5000, concurrency: 5 });
          hydratedCount = h.hydrated || 0;
        }
        const stamp = Date.now();
        const fromTag = fromDate.toISOString().slice(0,10);
        const toTag = toDate.toISOString().slice(0,10);
        const fname = `smartsupp_conversations_${fromTag}_${toTag}_${stamp}.json`;
        const fpath = path.join(smartsuppDir, fname);
        fs.writeFileSync(fpath, JSON.stringify({ ok:true, items: normItems, pages: pagesCount, after: afterTags }, null, 2));
        const st = fs.statSync(fpath);
        return res.json({
          ok: true,
          file: { name: fname, size: st.size, mtime: st.mtime, url: `/api/smartsupp/file/${encodeURIComponent(fname)}` },
          count: normItems.length,
          pages: pagesCount,
          after: afterTags,
          debug: { field: usedField, from: fromIso, to: toIso, requested_size: requestedSize, used_size: size, hydrated: hydratedCount }
        });
      } catch (e) {
        // Fallback to inline return if file write fails
        const normItems = Array.isArray(items) ? items.map(normalizeConversation) : [];
        return res.json({ ok:true, items: normItems, pages: pagesCount, after: afterTags, debug: { field: usedField, from: fromIso, to: toIso, requested_size: requestedSize, used_size: size }, warn: 'file_save_failed' });
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/smartsupp/range/fetch', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    const token = await resolveSmartsuppToken(req);
    if (!token) return res.status(400).json({ ok:false, error:'missing_token' });
    try {
      const from = new Date(String(req.body?.from || ''));
      const to = new Date(String(req.body?.to || ''));
      if (!(from instanceof Date) || isNaN(from)) return res.status(400).json({ ok:false, error:'bad_request', message:'from invalid'});
      if (!(to instanceof Date) || isNaN(to)) return res.status(400).json({ ok:false, error:'bad_request', message:'to invalid'});
      const fromIso = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0)).toISOString();
      const toIso = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59, 999)).toISOString();
      const requestedSize = Math.max(1, Math.min(10000, Number(req.body?.size || 1000)));
      const sizeReq = Math.min(50, requestedSize);

      function buildPayloads(field, after) {
        const common = after ? { after } : {};
        const vA = { size: sizeReq, sort: [{ [field]: 'desc' }], filters: { range: { [field]: { gte: fromIso, lte: toIso } } }, ...common };
        const vB = { size: sizeReq, sort: [{ [field]: 'desc' }], query: { filter: { range: { [field]: { gte: fromIso, lte: toIso } } } }, ...common };
        const vC = { size: sizeReq, sort: [{ [field]: 'desc' }], query: { range: { [field]: { gte: fromIso, lte: toIso } } }, ...common };
        const vD = { size: sizeReq, sort: [{ [field]: 'desc' }], query: [{ range: { [field]: { gte: fromIso, lte: toIso } } }], ...common };
        const vE = { size: sizeReq, sort: [{ [field]: 'desc' }], query: [{ filter: { range: { [field]: { gte: fromIso, lte: toIso } } } }], ...common };
        const vF = { size: sizeReq, sort: [{ [field]: 'desc' }], query: [ { field, operator: 'gte', value: fromIso }, { field, operator: 'lte', value: toIso } ], ...common };
        const vG = { size: sizeReq, sort: [{ [field]: 'desc' }], query: [ { field, operator: 'range', value: { gte: fromIso, lte: toIso } } ], ...common };
        const vH = { size: sizeReq, sort: [{ [field]: 'desc' }], query: [ { field, operator: 'between', value: [fromIso, toIso] } ], ...common };
        const vI = { size: sizeReq, sort: [{ [field]: 'desc' }], query: [ { field, operator: 'between', value: { from: fromIso, to: toIso } } ], ...common };
        const vJ = { size: sizeReq, sort: [{ [field]: 'desc' }], query: [ { type: 'date', field, operator: 'between', value: { from: fromIso, to: toIso } } ], ...common };
        const vK = { size: sizeReq, sort: [{ [field]: 'desc' }], query: [ { [field]: { gte: fromIso, lte: toIso } } ], ...common };
        return [vA, vB, vC, vD, vE, vF, vG, vH, vI, vJ, vK];
      }

      async function fetchRange(field) {
        const out = [];
        let after = undefined; let pagesCount = 0; const maxPages = 1000;
        for (;;) {
          if (pagesCount >= maxPages) break; pagesCount++;
          let ok = false; let lastErr = null;
          const variants = buildPayloads(field, after);
          for (let i = 0; i < variants.length; i++) {
            const payload = variants[i];
            const r = await fetch(`${SM_BASE}/v2/conversations/search`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(payload) });
            const j = await r.json().catch(()=>({}));
            if (r.ok) {
              const arr = Array.isArray(j?.items) ? j.items : (Array.isArray(j?.hits) ? j.hits : (Array.isArray(j) ? j : []));
              out.push(...arr);
              after = j?.after || undefined;
              ok = true; break;
            } else {
              lastErr = { status: r.status, message: j?.message || j?.error || `http_${r.status}`, data: j };
              if (!(r.status === 400 || r.status === 422)) break;
            }
          }
          if (!ok) {
            const err = new Error(lastErr?.message || 'invalid_request');
            err.status = lastErr?.status || 400; err.data = lastErr?.data || null; throw err;
          }
          if (!after) break;
        }
        return { items: out, pagesCount };
      }

      let usedField = '';
      let items = [];
      const fieldsToTry = ['updated_at','created_at','updatedAt','createdAt'];
      let lastErr = null;
      for (const f of fieldsToTry) {
        try { const r = await fetchRange(f); usedField = f; items = r.items; break; }
        catch (e) {
          lastErr = e;
          if (!(e && (e.status === 400 || e.status === 422 || String(e.message||'').toLowerCase().includes('invalid')))) {
            return res.status(e.status||400).json({ ok:false, error:'upstream_error', message: e.message || 'Invalid request', data: e.data || null });
          }
        }
      }
      if (!usedField) return res.status(lastErr?.status||400).json({ ok:false, error:'upstream_error', message: lastErr?.message || 'Invalid request', data: lastErr?.data || null });

      const stamp = Date.now();
      const fromTag = from.toISOString().slice(0,10); const toTag = to.toISOString().slice(0,10);
      const fname = `smartsupp_conversations_${fromTag}_${toTag}_${stamp}.json`;
      const fpath = path.join(smartsuppDir, fname);
      const normItems = Array.isArray(items) ? items.map(normalizeConversation) : [];
      fs.writeFileSync(fpath, JSON.stringify({ ok:true, items: normItems }, null, 2));
      const st = fs.statSync(fpath);
      return res.json({ ok:true, file: { name: fname, size: st.size, mtime: st.mtime, url: `/api/smartsupp/file/${encodeURIComponent(fname)}` }, count: normItems.length, debug: { requested_size: requestedSize, used_size: sizeReq } });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/smartsupp/files', async (_req, res) => {
    try {
      const all = (fs.readdirSync(smartsuppDir, { withFileTypes: true }) || []).filter(d => d.isFile() && /\.json$/i.test(d.name));
      const items = all.map(d => {
        const name = d.name; const p = path.join(smartsuppDir, name); const st = fs.statSync(p);
        const m = /smartsupp_conversations_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})_/i.exec(name);
        const meta = { name, size: st.size, mtime: st.mtime, url: `/api/smartsupp/file/${encodeURIComponent(name)}` };
        if (m) { meta.from = m[1]; meta.to = m[2]; }
        return meta;
      }).sort((a,b)=> (b.mtime - a.mtime));
      res.json({ ok:true, items });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/smartsupp/file/:name', async (req, res) => {
    try {
      const name = String(req.params.name||'').replace(/[^A-Za-z0-9._\-]/g,'');
      const filePath = path.join(smartsuppDir, name);
      if (!name || !fs.existsSync(filePath)) return res.status(404).json({ ok:false, error:'not_found' });
      res.setHeader('Content-Type', 'application/json');
      const dl = /^(1|true|yes)$/i.test(String(req.query?.download||''));
      if (dl) res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/smartsupp/files/delete', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const names = Array.isArray(req.body?.names) ? req.body.names : [];
      let removed = 0; for (const n of names) { const name = String(n||'').replace(/[^A-Za-z0-9._\-]/g,''); if (!name) continue; const filePath = path.join(smartsuppDir, name); if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); removed++; } catch {} } }
      res.json({ ok:true, removed });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/smartsupp/assets/fetch', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const name = String(req.body?.name || '').replace(/[^A-Za-z0-9._\-]/g,'');
      const group = name.replace(/\.json$/i,'');
      const filePath = path.join(smartsuppDir, name);
      if (!name || !fs.existsSync(filePath)) return res.status(404).json({ ok:false, error:'not_found', message:'JSON not found' });
      const txt = fs.readFileSync(filePath, 'utf8');
      let data = null; try { data = JSON.parse(txt); } catch { data = null; }
      const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);

      let allowedPrefix = String(req.body?.prefix || '').trim();
      const account = String(req.body?.account || '').replace(/[^A-Za-z0-9]/g,'');
      const onlyNew = !!req.body?.only_new;
      // Derive prefix from typical Smartsupp CDN pattern if not provided
      if (!allowedPrefix && account) allowedPrefix = `https://files.smartsuppcdn.com/files/accounts/${account}/uploads`;
      if (!allowedPrefix) allowedPrefix = 'https://files.smartsuppcdn.com/files/accounts/409828/uploads';
      const urlRe = new RegExp(`^${allowedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

      const outDir = path.join(smartsuppAssetsDir, group);
      try { fs.mkdirSync(outDir, { recursive: true }); } catch {}

      const candidates = [];
      for (const it of items) {
        try {
          const arr = Array.isArray(it?.messages) ? it.messages : [];
          for (const m of arr) {
            const atts = Array.isArray(m?.attachments) ? m.attachments : [];
            for (const a of atts) { const url = String(a?.url || '').trim(); if (url && urlRe.test(url)) candidates.push(url); }
          }
        } catch {}
      }

      const results = []; let downloaded = 0, skipped = 0, errors = 0;
      for (const uurl of candidates) {
        const base = path.join(outDir, path.basename(new URL(uurl).pathname));
        let target = base; let i = 2;
        while (fs.existsSync(target)) {
          if (onlyNew) { skipped++; results.push({ url: uurl, file: path.relative(backendDir, target), skipped:true }); target = null; break; }
          const ext = path.extname(base); const stem = base.slice(0, -ext.length);
          target = `${stem}_${i}${ext}`; i++;
        }
        if (!target) continue;
        try {
          const controller = new AbortController(); const timer = setTimeout(()=>{ try{controller.abort();}catch{} }, 30000);
          const r = await fetch(uurl, { signal: controller.signal });
          clearTimeout(timer);
          if (!r.ok) throw new Error(`http_${r.status}`);
          const ct = String(r.headers.get('content-type')||'');
          if (!path.extname(target)) {
            if (/image\/jpeg/i.test(ct)) target += '.jpg';
            else if (/image\/png/i.test(ct)) target += '.png';
            else if (/image\/gif/i.test(ct)) target += '.gif';
            else if (/image\/webp/i.test(ct)) target += '.webp';
          }
          const dest = fs.createWriteStream(target);
          try {
            if (r.body && typeof r.body.pipe === 'function') {
              await new Promise((resolve, reject) => { r.body.pipe(dest); r.body.on('error', reject); dest.on('finish', resolve); dest.on('error', reject); });
            } else if (r.body && typeof r.body.getReader === 'function') {
              const { Readable } = await import('stream');
              const nodeStream = Readable.fromWeb(r.body);
              await new Promise((resolve, reject) => { nodeStream.pipe(dest); nodeStream.on('error', reject); dest.on('finish', resolve); dest.on('error', reject); });
            } else {
              const buf = Buffer.from(await r.arrayBuffer());
              fs.writeFileSync(target, buf);
            }
          } catch (e) { try { dest.close?.(); } catch {} throw e; }
          const st = fs.statSync(target); downloaded++;
          results.push({ url: uurl, file: `/api/smartsupp/asset/${encodeURIComponent(group)}/${encodeURIComponent(path.basename(target))}`, size: st.size });
        } catch (e) {
          errors++; results.push({ url: uurl, error: String(e?.message||e) });
        }
      }
      res.json({ ok:true, group, prefix: allowedPrefix, total_urls: candidates.length, processed: results.length, downloaded, skipped, errors, items: results });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/smartsupp/assets', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const group = String(req.query?.group || '').replace(/[^A-Za-z0-9._\-]/g,'');
      const dir = path.join(smartsuppAssetsDir, group);
      if (!group || !fs.existsSync(dir)) return res.json({ ok:true, items: [] });
      const files = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile());
      const items = files.map(d => { const p = path.join(dir, d.name); const st = fs.statSync(p); return { name: d.name, size: st.size, mtime: st.mtime, url: `/api/smartsupp/asset/${encodeURIComponent(group)}/${encodeURIComponent(d.name)}` }; }).sort((a,b)=> (b.mtime - a.mtime));
      res.json({ ok:true, group, items });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/smartsupp/asset/:group/:name', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const group = String(req.params.group || '').replace(/[^A-Za-z0-9._\-]/g,'');
      const name = String(req.params.name || '').replace(/[^A-Za-z0-9._\-]/g,'');
      const p = path.join(smartsuppAssetsDir, group, name);
      if (!group || !name || !fs.existsSync(p)) return res.status(404).json({ ok:false, error:'not_found' });
      const dl = /^(1|true|yes)$/i.test(String(req.query?.download||''));
      const ct = { jpg: 'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp' }[String(path.extname(p).slice(1)).toLowerCase()] || 'application/octet-stream';
      res.setHeader('Content-Type', ct);
      if (dl) res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      fs.createReadStream(p).pipe(res);
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
