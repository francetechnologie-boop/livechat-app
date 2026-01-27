import http from 'http';
import https from 'https';

export function registerGrabbingJeromeUrlsRoutes(app, _ctx = {}, utils = {}) {
  const { pool, normDomain, ensureUrlTables, hasUnaccentExt, chatLog } = utils;
  if (!pool || typeof pool.query !== 'function') return;

  const isHttp = (u = '') => /^https?:\/\//i.test(String(u||''));
  const fetchText = (url, timeoutMs = 10000) => new Promise((resolve, reject) => {
    try {
      const client = url.startsWith('https:') ? https : http;
      const req = client.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'LiveChat-Importer/1.0' } }, (res) => {
        if ((res.statusCode || 0) >= 300 && (res.statusCode || 0) < 400 && res.headers.location) {
          try { req.destroy(); } catch {}
          return resolve(fetchText(res.headers.location, timeoutMs));
        }
        if ((res.statusCode || 0) !== 200) return reject(new Error(String(res.statusCode||0)));
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
      req.on('error', reject);
    } catch (e) { reject(e); }
  });
  const extractLocs = (xml = '') => {
    const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
    const out = []; let m;
    while ((m = re.exec(String(xml))) !== null) { const s = String(m[1]||'').trim(); if (s) out.push(s); }
    return out;
  };
  const normalizeAbs = (href, base) => { try { return new URL(href, base).toString(); } catch { return ''; } };
  const canonicalUrl = (u) => {
    try {
      const x = new URL(u);
      x.hash = '';
      x.hostname = String(x.hostname||'').toLowerCase().replace(/^www\./,'');
      if ((x.protocol === 'http:' && x.port === '80') || (x.protocol === 'https:' && x.port === '443')) x.port = '';
      let p = x.pathname || '/'; p = p.replace(/\/+/g,'/'); if (p.length>1) p = p.replace(/\/+$/,''); x.pathname = p;
      const DROP = new Set(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','utm_id','gclid','fbclid','yclid','mc_cid','mc_eid','_hsenc','_hsmi','ref','ref_','referrer','igshid','add-to-cart','add_to_cart']);
      const kept = []; for (const [k,v] of x.searchParams.entries()) { const kk = String(k||'').toLowerCase(); if (DROP.has(kk) || kk.startsWith('utm_')) continue; kept.push([k,v]); }
      kept.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
      const sp = new URLSearchParams(); for (const [k,v] of kept) sp.append(k,v); const qs = sp.toString(); x.search = qs? ('?'+qs): '';
      return x.toString().trim();
    } catch { return String(u||'').split('#')[0].trim(); }
  };
  const sameDomain = (u, d, allowSub=false) => { try { const h = new URL(u).hostname.toLowerCase().replace(/^www\./,''); if (h === d) return true; if (allowSub && h.endsWith('.'+d)) return true; } catch {} return false; };

  // fetch wrapper with timeout to avoid hanging requests
  const fetchWithTimeout = async (url, options = {}, timeoutMs = Number(process.env.GJ_FETCH_TIMEOUT_MS || 15000)) => {
    const ac = new AbortController();
    const to = setTimeout(() => {
      try { ac.abort(); } catch {}
    }, Math.max(1000, timeoutMs|0));
    try {
      // global fetch is available in Node 18+
      return await fetch(url, { ...options, signal: ac.signal });
    } finally {
      clearTimeout(to);
    }
  };

  // Basic helpers for HTML parsing/classification (used by crawler)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms)||0)));
  const extractTitle = (html='') => { const m = String(html||'').match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m && m[1] ? m[1].trim() : ''; };
  const findMeta = (html, name) => { const re = new RegExp(`<meta[^>]+property=["']${name.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'); const m = String(html||'').match(re); return m && m[1] ? m[1].trim() : ''; };
  const hasTag = (html, tag) => new RegExp(`<${tag}[^>]*>`, 'i').test(String(html||''));
  const hasJsonLdType = (html, type) => { try { const arr = String(html||'').match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []; for (const s of arr) { const j = s.replace(/^[\s\S]*?>/,'').replace(/<\/script>[\s\S]*$/,''); const obj = JSON.parse(j); const objs = Array.isArray(obj)? obj: [obj]; for (const o of objs) { const t = (o && (o['@type'] || o.type)); if (t && String(t).toLowerCase().includes(type)) return true; } } } catch {} return false; };
  const classifyPageType = (html, urlStr='') => {
    const og = findMeta(html,'og:type');
    let path = '';
    let search = '';
    try { const u = new URL(String(urlStr||'')); path = (u.pathname||'').toLowerCase(); search = (u.search||'').toLowerCase(); } catch { path = String(urlStr||'').toLowerCase(); search = ''; }
    const hasWooGrid = /<ul[^>]+class=["'][^"']*\bproducts\b[^"']*["'][^>]*>[\s\S]*?<li[^>]+class=["'][^"']*\bproduct\b/i.test(String(html||''));
    // 1) Product: prefer strong signals and avoid product-category false positives
    const isProductOg = /product/.test(String(og||''));
    const isProductJsonLd = hasJsonLdType(html,'product');
    const isProductPath = /\/(product|item)\/(?:[^/]|$)/.test(path); // '/product/' or '/item/' only
    if (isProductOg || isProductJsonLd || isProductPath) return 'product';
    // 2) Category/listing: path/query/UI grid
    const isCategoryPath = /(\/product-category\/|\/category\/|\/categories\/|\/collections?\/|\/catalog\/)/.test(path);
    const isCategoryQuery = /[?&](category|cat|collection|collections|catalog)=/.test(search);
    if (isCategoryPath || isCategoryQuery || hasWooGrid) return 'category';
    // 3) Articles/blog
    if (/article|blog/.test(String(og||'')) || hasTag(html,'article') || /(\/blog\/|\/news\/|\/post\/)/.test(path)) return 'article';
    return 'page';
  };

  // Crawler in-memory progress (shared via globalThis)
  if (!globalThis.__gjCrawlProgress) globalThis.__gjCrawlProgress = new Map();
  function crawlSet(domain, patch) { try { const d=String(domain||'').toLowerCase(); const cur=globalThis.__gjCrawlProgress.get(d)||{}; const next={...cur,...patch,updated_at:new Date().toISOString()}; globalThis.__gjCrawlProgress.set(d,next);} catch {} }
  function crawlGet(domain) { try { return globalThis.__gjCrawlProgress.get(String(domain||'').toLowerCase()) || null; } catch { return null; } }
  function crawlStop(domain) { try { const d=String(domain||'').toLowerCase(); const cur=globalThis.__gjCrawlProgress.get(d)||{}; const next={...cur,request_stop:true,status:'stopping',updated_at:new Date().toISOString()}; globalThis.__gjCrawlProgress.set(d,next); return next; } catch { return null; } }
  function crawlPause(domain, paused) { try { const d=String(domain||'').toLowerCase(); const cur=globalThis.__gjCrawlProgress.get(d)||{}; const next={...cur,request_pause:!!paused,status:(paused?'paused':'running'),updated_at:new Date().toISOString()}; globalThis.__gjCrawlProgress.set(d,next); return next; } catch { return null; } }

  // Scan sitemap index or urlset (no DB write)
  app.get('/api/grabbing-jerome/sitemap/scan', async (req, res) => {
    try {
      const domain = normDomain(req.query?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request' });
      const indexUrl = String(req.query?.index_url || `https://${domain}/sitemap_index.xml`).trim();
      const xml = await fetchText(indexUrl);
      const isIndex = /<sitemapindex\b/i.test(xml);
      const isUrlset = /<urlset\b/i.test(xml);
      const items = extractLocs(xml);
      return res.json({ ok:true, type: isIndex? 'index' : (isUrlset? 'urlset': 'unknown'), items });
    } catch (e) { return res.status(500).json({ ok:false, error:'scan_failed', message: e?.message || String(e) }); }
  });

  // HTML Crawl: discover, classify and upsert URLs
  app.post('/api/grabbing-jerome/crawl', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureUrlTables();
      const domain = normDomain(req.body?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      const start = String(req.body?.start_url || `https://${domain}/`).trim();
      const limit = Math.min(10000, Math.max(1, Number(req.body?.limit || 500)));
      const maxDepth = Math.min(10, Math.max(0, Number(req.body?.depth || 2)));
      const skipExplored = (req.body?.skip_explored === undefined) ? true : !!req.body?.skip_explored;
      const skipExploredHours = Number(req.body?.skip_explored_hours || 0) || 0;
      const ratePerHourRaw = Number(req.body?.rate_per_hour || 50);
      const ratePerHour = Math.max(1, Math.min(3600, Math.floor(ratePerHourRaw||50)));
      const jitterOn = (req.body?.jitter === undefined) ? true : !!req.body?.jitter;
      const baseDelayMs = Math.floor(3600000 / ratePerHour);
      const seedBeyond = !!req.body?.seed_beyond_max_depth;
      const includeSubdomains = !!req.body?.includeSubdomains;
      const debugOn = !!(req.body?.debug || String(process.env.GJ_CRAWL_DEBUG||'').toLowerCase()==='1');

      // Detailed request log
      try {
        chatLog?.('crawl_request', {
          ip: (req.ip || req.headers['x-forwarded-for'] || '').toString(),
          ua: (req.headers && (req.headers['user-agent']||'')).toString().slice(0,128),
          domain,
          start_url: start,
          limit,
          depth: maxDepth,
          skipExplored,
          skipExploredHours,
          rate_per_hour: ratePerHour,
          jitter: jitterOn,
          seed_beyond_max_depth: seedBeyond,
          includeSubdomains,
          debug: debugOn
        });
      } catch {}

      const t0 = Date.now();
      try { chatLog?.('crawl_started', { domain, start_url: start, limit, depth: maxDepth, rate_per_hour: ratePerHour, includeSubdomains, skipExplored, skipExploredHours }); } catch {}

      const visited = new Set();
      let startUrl = canonicalUrl(start);
      if (!/^https?:\/\//i.test(startUrl)) {
        try {
          if (startUrl.startsWith('/')) startUrl = `https://${domain}${startUrl}`;
          else if (startUrl.includes(domain)) startUrl = `https://${startUrl.replace(/^\/*/, '')}`;
          else startUrl = `https://${domain}/`;
          startUrl = canonicalUrl(startUrl);
        } catch (e) { try { if (debugOn) chatLog?.('crawl_fetch_error', { domain, url: can, message: (e && e.message) ? e.message : String(e) }); } catch {} }
      }
      const queue = [{ url: startUrl, depth: 0 }];
      try { chatLog?.('crawl_seeded', { domain, start_url: startUrl, queue: queue.length }); } catch {}
      let fetched = 0, inserted = 0, updated = 0, skippedExplored = 0;

      // reset flags
      crawlSet(domain, { status: 'running', request_stop: false, request_pause: false, domain, fetched: 0, inserted: 0, updated: 0, skipped_explored: 0, limit, depth: maxDepth, includeSubdomains, rate_per_hour: ratePerHour, delay_ms: baseDelayMs, seed_beyond_max_depth: seedBeyond, started_at: new Date().toISOString() });

      let canceled = false;
      while (queue.length && fetched < limit) {
        // cancel/pause
        try {
          const p = crawlGet(domain);
          if (p && p.request_stop) { try { chatLog?.('crawl_cancel_requested', { domain }); } catch {} canceled = true; break; }
          if (p && p.request_pause) {
            crawlSet(domain, { status: 'paused' });
            try { chatLog?.('crawl_paused', { domain }); } catch {}
            while (true) {
              await sleep(500);
              const pp = crawlGet(domain);
              if (pp && pp.request_stop) { canceled = true; break; }
              if (!pp || !pp.request_pause) break;
            }
            if (canceled) break;
            crawlSet(domain, { status: 'running' });
            try { chatLog?.('crawl_resumed', { domain }); } catch {}
          }
        } catch {}
        const { url, depth } = queue.shift();
        const can = canonicalUrl(url);
        if (!isHttp(url) || visited.has(can) || !sameDomain(url, domain, includeSubdomains)) continue;
        visited.add(can);
        try { if (debugOn) chatLog?.('crawl_iter', { domain, url: can, depth, visited: visited.size, queue: queue.length }); } catch {}

        // skip explored logic (with optional seed)
        if (skipExplored) {
          try {
            const r = await pool.query(`select explored from public.mod_grabbing_jerome_domains_url where domain=$1 and lower(trim(both from url))=lower(trim(both from $2)) limit 1`, [domain, can]);
            if (r && r.rowCount) {
              const exploredAt = r.rows[0]?.explored ? new Date(r.rows[0].explored) : null;
              if (exploredAt) {
            const seedLinks = async () => {
              if ((maxDepth > depth) || seedBeyond) {
                try {
                  const r0 = await fetchWithTimeout(url, { method:'GET', redirect:'follow', headers:{ 'user-agent':'Mozilla/5.0 (compatible; LivechatBot/1.0)' } });
                  const ct0 = String(r0.headers.get('content-type')||'');
                  if (r0.ok && /text\/html/i.test(ct0)) {
                    const html0 = await r0.text();
                    const links = [];
                        try {
                          const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi; let m;
                          while ((m = re.exec(html0))) {
                            const href = m[1]||''; if (!href) continue; if (/^(?:mailto:|tel:|javascript:)/i.test(href)) continue;
                            const abs = normalizeAbs(href, url); if (!abs) continue;
                            const canL = canonicalUrl(abs);
                            if (sameDomain(canL, domain, includeSubdomains)) links.push(canL);
                          }
                          const m2 = String(html0||'').match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
                          if (m2 && m2[1]) { const abs = normalizeAbs(m2[1], url); if (abs) { const canC = canonicalUrl(abs); links.push(canC); } }
                        } catch {}
                        const unique = Array.from(new Set(links));
                        for (const l of unique) { if (!visited.has(l)) queue.push({ url: l, depth: depth+1 }); }
                        try { if (debugOn) chatLog?.('crawl_seed_links', { domain, from: url, added: unique.length, depth_next: depth+1, queue: queue.length }); } catch {}
                      }
                    } catch {}
                  }
                };
                if (skipExploredHours <= 0) { try { if (debugOn) chatLog?.('crawl_skip_explored', { domain, url: can, reason: 'ttl_disabled' }); } catch {} await seedLinks(); skippedExplored++; continue; }
                const ageMs = Date.now() - exploredAt.getTime();
                const ttlMs = skipExploredHours * 3600000;
                if (ageMs >= 0 && ageMs < ttlMs) { try { if (debugOn) chatLog?.('crawl_skip_explored', { domain, url: can, age_ms: ageMs, ttl_ms: ttlMs }); } catch {} await seedLinks(); skippedExplored++; continue; }
              }
            }
          } catch {}
        }

        // fetch page
        let html = '';
        try {
          try { if (debugOn) chatLog?.('crawl_fetch_start', { domain, url: can, depth }); } catch {}
          const r = await fetchWithTimeout(url, { method:'GET', redirect:'follow', headers:{ 'user-agent':'Mozilla/5.0 (compatible; LivechatBot/1.0)' } });
          const ct = String(r.headers.get('content-type')||'');
          if (!r.ok || !/text\/html/i.test(ct)) { try { if (debugOn) chatLog?.('crawl_fetch_skip', { domain, url: can, status: r.status || 0, content_type: ct }); } catch {} continue; }
          html = await r.text();
          fetched++;
          if ((fetched % 10) === 1) { try { chatLog?.('crawl_progress', { domain, fetched, visited: visited.size, queue: queue.length }); } catch {} }
          const title = extractTitle(html);
          const page_type = classifyPageType(html, url);
          const at = new Date().toISOString();
          const prev = crawlGet(domain) || {};
          const nextList = Array.isArray(prev.last_list) ? prev.last_list.slice(0,50) : [];
          nextList.unshift({ url, title, page_type, at });
          crawlSet(domain, { last_url: url, last_title: title, last_page_type: page_type, last_at: at, last_list: nextList });
          try { if (debugOn) chatLog?.('crawl_classified', { domain, url: can, page_type, title_len: (title||'').length }); } catch {}
          // upsert URL row
          try {
            const up = await pool.query(
              `insert into public.mod_grabbing_jerome_domains_url (domain,url,type,title,page_type,meta,product,discovered_at, explored)
               values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb, now(), now())
               on conflict (domain, lower(trim(both from url))) do update set title=EXCLUDED.title, type=EXCLUDED.type, page_type=EXCLUDED.page_type, explored=now()`,
              [domain, can, (page_type || 'page'), title || null, page_type || null, JSON.stringify({ fetched: true }), JSON.stringify({})]
            );
            if (up && up.rowCount) updated++; else inserted++;
            try { if (debugOn) chatLog?.('crawl_db_upsert', { domain, url: can, effect: (up && up.rowCount ? 'updated' : 'inserted') }); } catch {}
          } catch {}
          // enqueue links
          try {
            const links = [];
            const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi; let m;
            while ((m = re.exec(html))) {
              const href = m[1]||''; if (!href) continue; if (/^(?:mailto:|tel:|javascript:)/i.test(href)) continue;
              const abs = normalizeAbs(href, url); if (!abs) continue;
              const canL = canonicalUrl(abs);
              if (sameDomain(canL, domain, includeSubdomains)) links.push(canL);
            }
            const m2 = String(html||'').match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
            if (m2 && m2[1]) { const abs = normalizeAbs(m2[1], url); if (abs) { const canC = canonicalUrl(abs); links.push(canC); } }
            const uniq = Array.from(new Set(links));
            for (const l of uniq) { if (!visited.has(l)) queue.push({ url: l, depth: depth+1 }); }
            try { if (debugOn) chatLog?.('crawl_enqueue', { domain, from: can, added: uniq.length, queue: queue.length }); } catch {}
          } catch {}
        } catch {}

        // throttle
        try { let wait = baseDelayMs; if (jitterOn && wait > 0) { const delta = Math.floor(wait * 0.25 * (Math.random() - 0.5) * 2); wait = Math.max(0, wait + delta); } if (wait > 0 && queue.length) { try { if (debugOn) chatLog?.('crawl_throttle_wait', { domain, ms: wait, queue: queue.length }); } catch {} await sleep(wait); } } catch {}
      }

      crawlSet(domain, { status: canceled ? 'canceled' : 'done', fetched, inserted, updated, skipped_explored: skippedExplored, ended_at: new Date().toISOString() });
      const result = { ok:true, domain, canceled, totals: { pages_fetched: fetched, inserted, updated, visited: visited.size } };
      try { chatLog?.('crawl_finished', { domain, canceled, ms: (Date.now()-t0), totals: result.totals }); } catch {}
      return res.json(result);
    } catch (e) { return res.status(500).json({ ok:false, error:'crawl_failed', message: e?.message || String(e) }); }
  });

  app.get('/api/grabbing-jerome/crawl/status', async (req, res) => {
    try {
      const domain = normDomain(req.query?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request' });
      const p = crawlGet(domain);
      try { chatLog?.('crawl_status', { domain, status: (p && p.status) || 'idle', fetched: p?.fetched || 0, inserted: p?.inserted || 0, updated: p?.updated || 0, skipped_explored: p?.skipped_explored || 0 }); } catch {}
      return res.json({ ok:true, domain, progress: p || { status: 'idle' } });
    } catch (e) { return res.status(500).json({ ok:false, error:'status_failed', message: e?.message || String(e) }); }
  });

  app.post('/api/grabbing-jerome/crawl/stop', async (req, res) => {
    try {
      const domain = normDomain(req.body?.domain || req.query?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request' });
      const p = crawlStop(domain);
      try { chatLog?.('crawl_stop_requested', { domain }); } catch {}
      return res.json({ ok:true, domain, progress: p || { status:'stopping' } });
    } catch (e) { return res.status(500).json({ ok:false, error:'stop_failed', message: e?.message || String(e) }); }
  });

  app.post('/api/grabbing-jerome/crawl/pause', async (req, res) => {
    try {
      const domain = normDomain(req.body?.domain || req.query?.domain);
      const paused = (req.body?.pause === undefined) ? true : !!req.body?.pause;
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request' });
      const p = crawlPause(domain, paused);
      try { chatLog?.('crawl_pause_requested', { domain, pause: paused }); } catch {}
      return res.json({ ok:true, domain, progress: p || { status: paused ? 'paused' : 'running' } });
    } catch (e) { return res.status(500).json({ ok:false, error:'pause_failed', message: e?.message || String(e) }); }
  });

  // Seed URLs from sitemap(s) into domains_url
  app.post('/api/grabbing-jerome/sitemap/seed', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const domain = normDomain(body.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request' });
      const indexUrl = String(body.index_url || `https://${domain}/sitemap_index.xml`).trim();
      const xml = await fetchText(indexUrl);
      let childSitemaps = [];
      if (/<sitemapindex\b/i.test(xml)) childSitemaps = extractLocs(xml);
      else if (/<urlset\b/i.test(xml)) childSitemaps = [indexUrl];
      else return res.status(400).json({ ok:false, error:'not_sitemap' });
      let seen=0, inserted=0, skipped=0;
      await ensureUrlTables();
      for (const sm of childSitemaps) {
        if (seen >= 20000) break;
        let x = '';
        try { x = await fetchText(sm); } catch { continue; }
        const urls = extractLocs(x);
        for (const u of urls) {
          if (seen >= 20000) break; seen++;
          if (!sameDomain(u, domain, false)) { skipped++; continue; }
          const can = canonicalUrl(u);
          try {
            const ins = await pool.query(
              `insert into public.mod_grabbing_jerome_domains_url (domain,url,type,title,page_type,meta,product,discovered_at)
               select $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb, now()
               where not exists (select 1 from public.mod_grabbing_jerome_domains_url where domain=$1 and lower(trim(both from url))=lower(trim(both from $2)))`,
              [domain, can, null, null, null, JSON.stringify({ from: 'sitemap' }), JSON.stringify({})]
            );
            inserted += Number(ins.rowCount||0);
          } catch {}
        }
      }
      try { await pool.query(`update public.mod_grabbing_jerome_domains set sitemaps=$2::jsonb, updated_at=now() where domain=$1`, [domain, JSON.stringify({ index_url: indexUrl, items: childSitemaps })]); } catch {}
      return res.json({ ok:true, domain, totals: { seen, inserted, skipped, sitemaps: childSitemaps.length } });
    } catch (e) { return res.status(500).json({ ok:false, error:'seed_failed', message: e?.message || String(e) }); }
  });

  // List discovered URLs (with statement timeout guard)
  app.get('/api/grabbing-jerome/domains/urls', async (req, res) => {
    try {
      const domain = normDomain(req.query?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const q = String(req.query?.q || '').trim().toLowerCase();
      const qUrlOnly = (String(req.query?.url_only || '').toLowerCase() === '1' || String(req.query?.url_only || '').toLowerCase() === 'true');
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const include = String(req.query?.include || '').toLowerCase();
      const includeSubdomains = (String(req.query?.include_subdomains || '').toLowerCase() === '1' || String(req.query?.include_subdomains || '').toLowerCase() === 'true');
      const includeRuns = (String(req.query?.include_runs || '').toLowerCase() === '1' || String(req.query?.include_runs || '').toLowerCase() === 'true');
      const notInRuns = (String(req.query?.not_in_runs || '').toLowerCase() === '1' || String(req.query?.not_in_runs || '').toLowerCase() === 'true');
      const sortByRaw = String(req.query?.sort_by || '').trim().toLowerCase();
      const sortDirRaw = String(req.query?.sort_dir || '').trim().toLowerCase();
      const sortDir = (sortDirRaw === 'asc') ? 'asc' : 'desc';
      await ensureUrlTables();
      const useUnaccent = await hasUnaccentExt();
      const altDomain = domain ? ('www.' + domain.replace(/^www\./,'')) : '';
      const where = ['(lower(trim(both from d.domain)) = lower(trim(both from $1)) OR lower(trim(both from d.domain)) = lower(trim(both from $2)))'];
      const params = [domain, altDomain];
      if (includeSubdomains) {
        where.push(`lower(trim(both from d.domain)) LIKE lower(trim(both from $3))`);
        params.push('%.' + domain.replace(/^www\./,''));
      }
      let i = includeSubdomains ? 4 : 3;
      if (q) {
        if (useUnaccent) {
          if (qUrlOnly) { where.push(`unaccent(trim(both from d.url)) ILIKE unaccent($${i})`); params.push(`%${q}%`); i++; }
          else { where.push(`(unaccent(trim(both from d.url)) ILIKE unaccent($${i}) OR unaccent(trim(both from coalesce(d.title,''))) ILIKE unaccent($${i}))`); params.push(`%${q}%`); i++; }
        } else {
          if (qUrlOnly) { where.push(`trim(both from d.url) ILIKE $${i}`); params.push(`%${q}%`); i++; }
          else { where.push(`(trim(both from d.url) ILIKE $${i} OR trim(both from coalesce(d.title,'')) ILIKE $${i})`); params.push(`%${q}%`); i++; }
        }
      }
      if (pageType) { where.push(`lower(coalesce(d.page_type,'')) = $${i}`); params.push(pageType); i++; }
      if (notInRuns) {
        where.push(`not exists (
          select 1 from public.mod_grabbing_jerome_extraction_runs r
          where regexp_replace(lower(coalesce(r.domain,'')),'^www\\.','') = regexp_replace(lower(coalesce(d.domain,'')),'^www\\.','')
            and lower(trim(both from r.url)) = lower(trim(both from d.url))
        )`);
      }
      const whereSql = 'where ' + where.join(' and ');
      const totalSql = `select count(*)::int as c from public.mod_grabbing_jerome_domains_url d ${whereSql}`;
      const sortMap = { 'explored': 'd.explored', 'discovered_at': 'd.discovered_at', 'page_type': "lower(coalesce(d.page_type,''))", 'type': "lower(coalesce(d.type,''))", 'title': "lower(coalesce(d.title,''))", 'url': 'lower(trim(both from d.url))' };
      const sortExpr = sortMap[sortByRaw] || null;
      const orderSql = sortExpr ? `order by ${sortExpr} ${sortDir} nulls last, d.id desc` : `order by d.explored desc nulls last, d.discovered_at desc nulls last, d.id desc`;
      const selRuns = includeRuns
        ? `,
            (select r.id from public.mod_grabbing_jerome_extraction_runs r
               where regexp_replace(lower(coalesce(r.domain,'')),'^www\\.','') = regexp_replace(lower(coalesce(d.domain,'')),'^www\\.','')
                 and lower(trim(both from r.url)) = lower(trim(both from d.url))
               order by r.created_at desc nulls last, r.id desc limit 1) as run_id,
            (select r.product_id from public.mod_grabbing_jerome_extraction_runs r
               where regexp_replace(lower(coalesce(r.domain,'')),'^www\\.','') = regexp_replace(lower(coalesce(d.domain,'')),'^www\\.','')
                 and lower(trim(both from r.url)) = lower(trim(both from d.url))
               order by r.created_at desc nulls last, r.id desc limit 1) as product_id`
        : '';
      const listSql = `select d.id, d.url, d.type, d.title, d.page_type, d.explored, d.discovered_at${selRuns} from public.mod_grabbing_jerome_domains_url d ${whereSql} ${orderSql} limit $${i} offset $${i+1}`;
      const st = Math.max(100, Number(process.env.GJ_URLS_TIMEOUT_MS || 5000));
      let total = 0; let items = [];
      if (typeof pool.connect === 'function') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch {}
          const tot = await client.query(totalSql, params);
          const lst = await client.query(listSql, [...params, limit, offset]);
          await client.query('COMMIT');
          total = Number(tot.rows?.[0]?.c || 0);
          items = lst.rows || [];
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
          const msg = String(e?.message||e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) {
            return res.status(503).json({ ok:false, error:'db_timeout' });
          }
          throw e;
        } finally { try { client.release(); } catch {} }
      } else {
        // Fallback path: no per-connection control; run best-effort
        try { await pool.query('SET statement_timeout = ' + st); } catch {}
        const tot = await pool.query(totalSql, params);
        const lst = await pool.query(listSql, [...params, limit, offset]);
        total = Number(tot.rows?.[0]?.c || 0);
        items = lst.rows || [];
        try { await pool.query('SET statement_timeout = DEFAULT'); } catch {}
      }
      let summary = null;
      if (include === 'summary') {
        const byType = { product:0, category:0, article:0, page:0, other:0 };
        for (const r of items) { const t = String(r.page_type||'').toLowerCase(); if (byType[t] != null) byType[t]++; else byType.other++; }
        summary = { by_page_type: byType };
      }
      return res.json({ ok:true, total, items, summary });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_urls_failed', message: e?.message || String(e) }); }
  });

  // Add a single URL
  app.post('/api/grabbing-jerome/domains/urls', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const domain = normDomain(body.domain);
      let raw = String(body.url || '').trim();
      const type = String(body.type || '').trim().toLowerCase() || null;
      const pageType = String(body.page_type || '').trim().toLowerCase() || null;
      const includeSubdomains = !!body?.includeSubdomains;
      if (!domain || !raw) return res.status(400).json({ ok:false, error:'bad_request', message:'domain and url required' });
      if (!isHttp(raw)) { raw = raw.startsWith('/') ? `https://${domain}${raw}` : `https://${domain}/${raw}`; }
      const can = canonicalUrl(raw);
      if (!sameDomain(can, domain, includeSubdomains)) return res.status(400).json({ ok:false, error:'out_of_domain' });
      await ensureUrlTables();
      const rIns = await pool.query(
        `insert into public.mod_grabbing_jerome_domains_url(domain,url,type,title,page_type,meta,product,discovered_at)
         select $1,$2,$3,null,$4,$5::jsonb,$6::jsonb, now()
         where not exists (
           select 1 from public.mod_grabbing_jerome_domains_url where domain=$1 and lower(trim(both from url))=lower(trim(both from $2))
         )`,
        [domain, can, type, pageType, JSON.stringify({ added: true }), JSON.stringify({})]
      );
      const inserted = Number(rIns.rowCount||0) > 0;
      return res.json({ ok:true, inserted, existed: !inserted, domain, url: can });
    } catch (e) { return res.status(500).json({ ok:false, error:'add_failed', message: e?.message || String(e) }); }
  });

  // Batch delete discovered URLs by ids (domain-scoped)
  app.delete('/api/grabbing-jerome/domains/urls', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const domain = normDomain(body.domain);
      const ids = Array.isArray(body.ids) ? body.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
      const includeSubs = !!body.include_subdomains || String(body.include_subdomains||'') === '1' || String(body.include_subdomains||'').toLowerCase() === 'true';
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      if (!ids.length) return res.status(400).json({ ok:false, error:'bad_request', message:'ids required' });
      await ensureUrlTables();
      const altDomain = 'www.' + domain.replace(/^www\./,'');
      let sql, params;
      if (includeSubs) {
        // Match exact domain, www.<domain>, or any subdomain that ends with .<domain>
        sql = `delete from public.mod_grabbing_jerome_domains_url
                 where (
                   lower(trim(both from domain)) = lower(trim(both from $1))
                   OR lower(trim(both from domain)) = lower(trim(both from $2))
                   OR lower(trim(both from domain)) like ('%.' || lower(trim(both from $1)))
                 )
                   and id = ANY($3::bigint[])`;
        params = [domain, altDomain, ids];
      } else {
        sql = `delete from public.mod_grabbing_jerome_domains_url
                 where (lower(trim(both from domain)) = lower(trim(both from $1))
                        OR lower(trim(both from domain)) = lower(trim(both from $2)))
                   and id = ANY($3::bigint[])`;
        params = [domain, altDomain, ids];
      }
      const r = await pool.query(sql, params);
      return res.json({ ok:true, deleted: Number(r.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // Reclassify selected URLs by id (fetch each, re-derive page_type/title)
  app.post('/api/grabbing-jerome/domains/urls/reclassify', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const domain = normDomain(body.domain);
      const ids = Array.isArray(body.ids) ? body.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
      const maxConc = Math.min(8, Math.max(1, Number(body.concurrency || 4)));
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      if (!ids.length) return res.status(400).json({ ok:false, error:'bad_request', message:'ids required' });
      await ensureUrlTables();
      const altDomain = 'www.' + domain.replace(/^www\./,'');
      const rows = await pool.query(
        `select id, domain, url from public.mod_grabbing_jerome_domains_url
          where (lower(trim(both from domain)) = lower(trim(both from $1))
                 or lower(trim(both from domain)) = lower(trim(both from $2)))
            and id = any($3::bigint[])`,
        [domain, altDomain, ids]
      );
      const items = Array.isArray(rows?.rows) ? rows.rows : [];
      let updated = 0; let failed = 0;
      const tasks = items.map((it) => async () => {
        const url = String(it.url||'').trim();
        if (!url) { failed++; return; }
        try {
          const r = await fetch(url, { method:'GET', redirect:'follow', headers:{ 'user-agent':'Mozilla/5.0 (compatible; LivechatBot/1.0)' } });
          const ct = String(r.headers.get('content-type')||'');
          if (!r.ok || !/text\/html/i.test(ct)) { failed++; return; }
          const html = await r.text();
          const title = extractTitle(html);
          const page_type = classifyPageType(html, url);
          try { chatLog?.('url_reclass', { id: it.id, page_type, title: (title||'').slice(0,120) }); } catch {}
          await pool.query(
            `update public.mod_grabbing_jerome_domains_url
               set title=$1, type=$2, page_type=$2, explored=now()
             where id=$3`,
            [title || null, page_type || 'page', it.id]
          );
          updated++;
        } catch { failed++; }
      });
      // simple concurrency limiter
      const queue = tasks.slice();
      const workers = Array.from({ length: Math.min(maxConc, tasks.length || 1) }, async () => {
        while (queue.length) { const fn = queue.shift(); if (typeof fn === 'function') { await fn(); } }
      });
      await Promise.all(workers);
      return res.json({ ok:true, requested: ids.length, found: items.length, updated, failed });
    } catch (e) { return res.status(500).json({ ok:false, error:'reclass_failed', message: e?.message || String(e) }); }
  });
}
