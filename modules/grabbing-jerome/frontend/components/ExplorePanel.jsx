import React from 'react';
import UrlsPanel from './UrlsPanel.jsx';

export default function ExplorePanel(props) {
  // Support ctx-based usage to minimize Main.jsx. Fallback to explicit props for compatibility.
  const ctx = props?.ctx;
  const activeDomain = ctx ? (ctx.activeDomain || '') : (props.activeDomain || '');
  const perfMode = ctx ? !!ctx.perfMode : !!props.perfMode;
  const setPerfMode = ctx ? (ctx.setPerfMode || (()=>{})) : (props.setPerfMode || (()=>{}));
  const open = ctx ? !!(ctx.stepOpen?.[1]) : (props.open ?? true);
  const onToggle = ctx
    ? (() => { if (ctx.setStepOpen) ctx.setStepOpen(prev => ({ ...(prev||{}), 1: !prev?.[1] })); })
    : (props.onToggle || (()=>{}));
  const [expBusy, setExpBusy] = React.useState(false);
  const [expMsg, setExpMsg] = React.useState('');
  const [limit, setLimit] = React.useState(50);
  const [depth, setDepth] = React.useState(2);
  const [startUrl, setStartUrl] = React.useState('');
  const [includeSubdomains, setIncludeSubdomains] = React.useState(false);
  const [rateHour, setRateHour] = React.useState(50);
  const [rateJitter, setRateJitter] = React.useState(true);
  const [seedBeyond, setSeedBeyond] = React.useState(false);
  const [skipCrawled, setSkipCrawled] = React.useState(true);
  const [reCrawlHours, setReCrawlHours] = React.useState(0); // 0 = never re-crawl
  const [headlessSeed, setHeadlessSeed] = React.useState(() => { try { return localStorage.getItem('gj_headless_seed') === '1'; } catch { return false; } });
  React.useEffect(() => { try { localStorage.setItem('gj_headless_seed', headlessSeed ? '1' : '0'); } catch {} }, [headlessSeed]);

  const [crawlProg, setCrawlProg] = React.useState(null); // { status,fetched,inserted,updated }
  const crawlTimerRef = React.useRef(null);
  const [crawlList, setCrawlList] = React.useState([]); // last 10 crawled

  const [smUrl, setSmUrl] = React.useState('');
  const [smBusy, setSmBusy] = React.useState(false);
  const [smItems, setSmItems] = React.useState([]);

  React.useEffect(() => {
    if (activeDomain) setSmUrl(`https://${activeDomain}/sitemap_index.xml`);
  }, [activeDomain]);

  return (
    <div className="panel order-1">
      <div className="panel__header flex items-center justify-between">
        <span>Step 1: Explore Website (No sitemaps)</span>
        <div className="flex items-center gap-3">
          <label className="text-xs inline-flex items-center gap-1" title="Reduces visual effects (blur/shadow) for smoother scrolling on this page.">
            <input type="checkbox" checked={perfMode} onChange={(e)=>setPerfMode(!!e.target.checked)} /> Performance mode
          </label>
          <div className="text-xs text-gray-500">HTML crawl to classify pages</div>
          <button className="px-2 py-1 text-xs border rounded" onClick={onToggle} aria-expanded={!!open}>{open ? 'Collapse' : 'Expand'}</button>
        </div>
      </div>
      <div className="panel__body space-y-3" style={{ display: open ? undefined : 'none', contentVisibility: 'auto', contain: 'content' }}>
        {expMsg && <div className="text-xs text-blue-700">{expMsg}</div>}
        <div className="flex items-center gap-2">
          <div className="text-sm">Domain:</div>
          <div className="text-sm font-mono">{activeDomain || '-'}</div>
          <div className="ml-4 text-sm">Start URL</div>
          <input value={startUrl} onChange={(e)=>setStartUrl(e.target.value)} placeholder={`https://${activeDomain||'domain'}/`} className="border rounded px-2 py-1 text-sm w-64" />
          <div className="ml-4 text-sm">Depth</div>
          <input type="number" min={0} max={10} value={depth} onChange={(e)=>setDepth(Number(e.target.value||0))} className="border rounded px-2 py-1 text-sm w-20" />
          <div className="ml-2 text-sm">Limit</div>
          <input type="number" min={1} max={10000} value={limit} onChange={(e)=>setLimit(Number(e.target.value||0))} className="border rounded px-2 py-1 text-sm w-24" />
          <label className="ml-2 text-xs inline-flex items-center gap-1"><input type="checkbox" checked={includeSubdomains} onChange={(e)=>setIncludeSubdomains(e.target.checked)} /> include subdomains</label>
          <label className="ml-2 text-xs inline-flex items-center gap-1"><input type="checkbox" checked={skipCrawled} onChange={(e)=>setSkipCrawled(!!e.target.checked)} /> Skip crawled</label>
          <label className="ml-2 text-xs inline-flex items-center gap-1" title="Use Playwright (headless Chromium) to extract links when static HTML has none. Slower; use only when needed."><input type="checkbox" checked={headlessSeed} onChange={(e)=>setHeadlessSeed(!!e.target.checked)} /> Use headless seeding</label>
          <div className="ml-2 text-xs inline-flex items-center gap-1">Re-crawl if older than
            <input type="number" min={0} max={720} value={reCrawlHours} onChange={(e)=>setReCrawlHours(Number(e.target.value||0))} className="border rounded px-2 py-1 text-xs w-20" />h
          </div>
          <div className="ml-4 text-sm">Max/hour</div>
          <input type="number" min={1} max={3600} value={rateHour} onChange={(e)=>setRateHour(Number(e.target.value||50))} className="border rounded px-2 py-1 text-sm w-24" />
          <label className="ml-2 text-xs inline-flex items-center gap-1"><input type="checkbox" checked={rateJitter} onChange={(e)=>setRateJitter(!!e.target.checked)} /> jitter</label>
          <label className="ml-2 text-xs inline-flex items-center gap-1" title="When skipping a page, still parse it to enqueue its children even if at max depth."><input type="checkbox" checked={seedBeyond} onChange={(e)=>setSeedBeyond(!!e.target.checked)} /> Seed beyond depth</label>
          <button className="ml-auto px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            disabled={expBusy || !activeDomain}
            onClick={async ()=>{
              if (!activeDomain) { setExpMsg('Select a domain first'); return; }
              setExpMsg(''); setExpBusy(true);
              try { if (crawlTimerRef.current) clearInterval(crawlTimerRef.current); } catch {}
              setCrawlProg({ status: 'running', fetched: 0, inserted: 0, updated: 0 });
              // start polling progress immediately
              crawlTimerRef.current = setInterval(async () => {
                try {
                  const r = await fetch(`/api/grabbing-jerome/crawl/status?domain=${encodeURIComponent(activeDomain)}`, { credentials:'include' });
                  const j = await r.json();
                  if (r.ok && j?.ok) { setCrawlProg(j.progress||null); setCrawlList(Array.isArray(j?.progress?.last_list)? j.progress.last_list: []); }
                } catch {}
              }, 1500);
              try {
                const body = { domain: activeDomain, limit, depth, rate_per_hour: rateHour, jitter: rateJitter, skip_explored: skipCrawled, skip_explored_hours: reCrawlHours, seed_beyond_max_depth: seedBeyond };
                if (headlessSeed) body.headless_seed = true;
                if (startUrl && startUrl.trim()) body.start_url = startUrl.trim();
                if (includeSubdomains) body.includeSubdomains = true;
                const r = await fetch('/api/grabbing-jerome/crawl', { method:'POST', headers: {'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                const j = await r.json();
                if (!r.ok || j?.ok===false) { setExpMsg(j?.message||j?.error||'crawl_failed'); }
                else {
                  setExpMsg(`Fetched: ${j?.totals?.pages_fetched||0}, inserted: ${j?.totals?.inserted||0}, updated: ${j?.totals?.updated||0}`);
                  try { window.dispatchEvent(new CustomEvent('gj:urls:refresh')); } catch {}
                }
              } catch (e) { setExpMsg(String(e?.message||e)); }
              finally {
                try { if (crawlTimerRef.current) { clearInterval(crawlTimerRef.current); crawlTimerRef.current = null; } } catch {}
                setExpBusy(false);
              }
            }}>{expBusy? 'Crawling…' : 'Start'}</button>
        </div>

        {crawlProg && (crawlProg.status==='running' || crawlProg.status==='stopping' || crawlProg.status==='paused') && (
          <div className="flex flex-col border rounded p-2 mt-1">
            <div className="text-xs text-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {(() => { const total = Number(crawlProg.limit||limit||1); const pct = Math.min(100, Math.round(((crawlProg.fetched||0)/total)*100)); return (
                  <div className="w-40 h-2 bg-gray-200 rounded overflow-hidden" title={`${pct}%`}>
                    <div className="h-full bg-indigo-500" style={{ width: pct+"%" }} />
                  </div>
                ); })()}
                <div>
                  {crawlProg.status==='stopping' ? 'Stopping… ' : (crawlProg.status==='paused' ? 'Paused · ' : 'Running… ')}f {crawlProg.fetched||0} / {crawlProg.limit||limit||0} · ins {crawlProg.inserted||0} · upd {crawlProg.updated||0} · skip {crawlProg.skipped_explored||0}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {crawlProg.status==='running' && (
                  <button className="px-2 py-0.5 rounded border text-xs" onClick={async ()=>{
                    try {
                      const r = await fetch('/api/grabbing-jerome/crawl/pause', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: activeDomain, pause: true }) });
                      const j = await r.json();
                      if (r.ok && j?.ok) setCrawlProg(j.progress||{ status:'paused' });
                    } catch {}
                  }}>Pause</button>
                )}
                {crawlProg.status==='paused' && (
                  <button className="px-2 py-0.5 rounded border text-xs" onClick={async ()=>{
                    try {
                      const r = await fetch('/api/grabbing-jerome/crawl/pause', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: activeDomain, pause: false }) });
                      const j = await r.json();
                      if (r.ok && j?.ok) setCrawlProg(j.progress||{ status:'running' });
                    } catch {}
                  }}>Resume</button>
                )}
                <button className="px-2 py-0.5 rounded border text-xs" onClick={async ()=>{
                  try {
                    const r = await fetch('/api/grabbing-jerome/crawl/stop', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: activeDomain }) });
                    const j = await r.json();
                    if (!r.ok || j?.ok===false) alert(j?.message||j?.error||'stop_failed');
                    else setCrawlProg(j.progress||{ status:'stopping' });
                  } catch (e) { alert(String(e?.message||e)); }
                }}>Stop</button>
              </div>
            </div>
            {crawlProg && crawlProg.last_url && (
              <div className="text-xs text-gray-600 ml-2 mt-1">
                Last: <a className="text-indigo-600 hover:underline" href={crawlProg.last_url} target="_blank" rel="noreferrer">{(crawlProg.last_title||crawlProg.last_url||'').slice(0,96)}</a>
                {crawlProg.last_page_type ? <> <span className="ml-1 text-gray-400">[{crawlProg.last_page_type}]</span></> : null}
              </div>
            )}
            <div className="flex items-center gap-2 ml-2 mt-1">
              <button className="px-2 py-0.5 rounded border text-xs" onClick={async ()=>{
                try {
                  const r = await fetch(`/api/grabbing-jerome/crawl/status?domain=${encodeURIComponent(activeDomain)}`, { credentials:'include' });
                  const j = await r.json();
                  if (r.ok && j?.ok) { setCrawlProg(j.progress||null); setCrawlList(Array.isArray(j?.progress?.last_list)? j.progress.last_list: []); }
                  else alert(j?.message||j?.error||'status_failed');
                } catch (e) { alert(String(e?.message||e)); }
              }}>Check status</button>
            </div>
            {Array.isArray(crawlList) && crawlList.length>0 && (
              <div className="mt-1 text-xs text-gray-700 ml-2">
                <div className="mb-1 text-gray-600">Last 10 crawled:</div>
                <ul className="list-disc ml-5 space-y-0.5">
                  {crawlList.map((it, idx) => (
                    <li key={idx}>
                      <a className="text-indigo-600 hover:underline" href={it.url} target="_blank" rel="noreferrer">{(it.title||it.url||'').slice(0,96)}</a>
                      {it.page_type ? <span className="ml-1 text-gray-400">[{it.page_type}]</span> : null}
                      {it.at ? <span className="ml-1 text-gray-400">{it.at}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Sitemap tools */}
        <div className="mt-3 p-2 border rounded">
          <div className="text-sm font-semibold mb-1">Sitemap</div>
          <div className="flex items-center gap-2 text-sm">
            <div>Index URL</div>
            <input className="border rounded px-2 py-1 w-[28rem]" value={smUrl} onChange={(e)=>setSmUrl(e.target.value)} />
            <button className="px-2 py-1 rounded border text-xs" disabled={!smUrl || smBusy} onClick={async ()=>{
              setSmBusy(true); setSmItems([]);
              try {
                const params = new URLSearchParams();
                if (activeDomain) params.set('domain', activeDomain);
                if (smUrl) params.set('index_url', smUrl);
                const r = await fetch(`/api/grabbing-jerome/sitemap/scan?${params.toString()}`, { credentials:'include' });
                const j = await r.json();
                if (!r.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||r.status));
                setSmItems(Array.isArray(j.items)? j.items: []);
              } catch (e) { alert(String(e?.message||e)); }
              finally { setSmBusy(false); }
            }}>Scan</button>
            <button className="px-2 py-1 rounded border text-xs" disabled={!smUrl || smBusy} onClick={async ()=>{
              setSmBusy(true);
              try {
                const r = await fetch('/api/grabbing-jerome/sitemap/seed', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: activeDomain, index_url: smUrl }) });
                const j = await r.json();
                if (!r.ok || j?.ok===false) throw new Error(String(j?.message||j?.error||r.status));
                alert(`Seeded: inserted ${j?.totals?.inserted||0} of ${j?.totals?.seen||0}`);
              } catch (e) { alert(String(e?.message||e)); }
              finally { setSmBusy(false); }
            }}>Seed from sitemap</button>
          </div>
          {Array.isArray(smItems) && smItems.length>0 && (
            <div className="mt-2 text-xs text-gray-600">
              {smItems.length} item(s): {smItems.slice(0,5).map(it => `${it.count ?? '?'} → ${it.url}`).join(' · ')}{smItems.length>5?' …':''}
            </div>
          )}
        </div>

        {/* Discovered URLs list included in Step 1 */}
        <UrlsPanel activeDomain={activeDomain} embedded />
      </div>
    </div>
  );
}
