import React from 'react';

export default function RunsPanel({ ctx }) {
  const {
    activeDomain,
    mapType,
    mapVers,
    runs, runsBusy, runsTotal,
    runsLimit, setRunsLimit,
    runsOffset, setRunsOffset,
    reloadRuns,
    selectedRuns, setSelectedRuns,
    runPid, setRunPid,
    autoRuns, setAutoRuns,
    runsRefreshMs, setRunsRefreshMs,
    mysqlProfileId,
    mapText, setRuns,
  } = ctx || {};
  const [resendConc, setResendConc] = React.useState(3);

  return (
    <>
      <div className="mt-3 text-sm font-semibold">Runs</div>
      <div className="text-xs text-gray-600 mb-1">Domain: <span className="font-mono">{activeDomain || '-'}</span></div>
      <div className="flex items-center gap-2 mt-1">
        <label className="text-xs">Limit
          <select className="border rounded px-2 py-1 text-xs ml-1" value={runsLimit} onChange={(e)=>setRunsLimit(Number(e.target.value||20))}>
            {[10,20,50,100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={async ()=>{ if (typeof reloadRuns==='function') await reloadRuns(); }}>Refresh</button>
        <label className="text-xs inline-flex items-center gap-1">
          Concurrency
          <input className="w-12 border rounded px-1 py-0.5 text-xs" type="number" min={1} max={10} value={resendConc} onChange={(e)=>setResendConc(Math.max(1, Math.min(10, Number(e.target.value||3))))} />
        </label>
        <button
          className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
          title={!mysqlProfileId? 'Select a MySQL profile in Step 3' : ''}
          disabled={!Object.keys(selectedRuns||{}).length || runsBusy || !mysqlProfileId}
          onClick={async ()=>{
            const ids = Object.keys(selectedRuns||{}).map(n=>Number(n)||0).filter(n=>n>0);
            if (!ids.length) return;
            if (!mysqlProfileId) { alert('Select a MySQL profile first (Step 3)'); return; }

            const w = window.open('', 'gj_mass_resend', 'width=900,height=600');
            if (!w) { alert('Popup blocked. Please allow popups.'); return; }
            const write = (html)=>{ try { const el=w.document.getElementById('content'); el.innerHTML += html; el.scrollTop = el.scrollHeight; } catch {} };
            const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Mass Resend</title><style>body{font:12px system-ui, sans-serif;padding:10px} .muted{color:#666} .ok{color:#166534} .err{color:#991b1b} pre{white-space:pre-wrap;word-break:break-word}</style></head><body><h3 style=\"margin:0\">Mass Resend (update)</h3><div class=\"muted\">${ids.length} run(s), ${resendConc} parallel</div><div id=\"content\" style=\"border:1px solid #ddd; padding:8px; height:460px; overflow:auto\"></div></body></html>`;
            w.document.open(); w.document.write(shell); w.document.close();
            write(`<div>Starting…</div>`);

            try {
              const lim = Math.max(1, Math.min(10, Number(resendConc||3)));
              const runConcurrent = async (arr, limit, worker) => new Promise((resolve) => {
                let i = 0, active = 0; const n = arr.length;
                const pump = () => {
                  while (active < limit && i < n) {
                    const item = arr[i++]; active++;
                    Promise.resolve(worker(item)).catch(()=>{})
                      .finally(() => { active--; if (i < n) pump(); else if (active===0) resolve(); });
                  }
                };
                pump();
              });
              await runConcurrent(ids, lim, async (id) => {
                try {
                  write(`<div class=\"muted\">Run ${id}: sending…</div>`);
                  const resp = await fetch('/api/grabbing-jerome/transfer/prestashop', {
                    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
                    body: JSON.stringify({ run_id: id, profile_id: mysqlProfileId, write: true, mode: 'upsert' })
                  });
                  let j={}; try { j = await resp.json(); } catch {}
                  if (!resp.ok || j?.ok===false) write(`<div class=\"err\">Run ${id}: failed – ${String(j?.message||j?.error||resp.status)}</div>`);
                  else write(`<div class=\"ok\">Run ${id}: OK (product_id=${j?.product_id ?? ''})</div>`);
                } catch (e) {
                  write(`<div class=\"err\">Run ${id}: error – ${String(e?.message||e)}</div>`);
                }
              });
            } finally {
              try { if (typeof reloadRuns==='function') await reloadRuns(); } catch {}
              write('<div class=\"muted\">Done.</div>');
            }
          }}
        >Resend selected</button>
        <label className="text-xs inline-flex items-center gap-1 ml-2">
          <input type="checkbox" checked={!!autoRuns} onChange={(e)=>setAutoRuns(e.target.checked)} /> Auto refresh
        </label>
        <label className="text-xs inline-flex items-center gap-1">
          every
          <input className="w-14 border rounded px-1 py-0.5 text-xs" type="number" min={2} max={120} value={Math.round((runsRefreshMs||0)/1000)||8} onChange={(e)=>setRunsRefreshMs(Math.max(2000, Number(e.target.value||8)*1000))} />s
        </label>
        <button className="px-3 py-1.5 rounded border bg-white hover:bg-red-50 text-sm disabled:opacity-60" disabled={!Object.keys(selectedRuns||{}).length || runsBusy}
          onClick={async ()=>{
            const ids = Object.keys(selectedRuns||{}).map(n=>Number(n)||0).filter(n=>n>0);
            if (!ids.length) return;
            if (!window.confirm(`Delete ${ids.length} selected run(s)?`)) return;
            try {
              const resp = await fetch('/api/grabbing-jerome/extraction/history/delete', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ ids }) });
              const j = await resp.json();
              if (!resp.ok || j?.ok===false) { alert(String(j?.message||j?.error||'delete_failed')); return; }
            } catch (e) { alert(String(e?.message||e)); return; }
            if (typeof reloadRuns==='function') await reloadRuns();
          }}>Delete selected</button>
      </div>

      <div className="max-h-80 overflow-auto border rounded scroll-smooth" style={{ contentVisibility: 'auto' }}>
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 border-b sticky top-0">
            <tr>
              <th className="px-2 py-1 text-left"><input type="checkbox" checked={(runs||[]).length>0 && (runs||[]).every(x=>selectedRuns?.[x.id])} onChange={(e)=>{
                const on = e.target.checked; const next={}; if (on) { for (const it of (runs||[])) next[it.id]=true; }
                if (typeof setSelectedRuns==='function') setSelectedRuns(next);
              }} /></th>
              <th className="px-2 py-1 text-left">ID</th>
              <th className="px-2 py-1 text-left">URL</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Ext v</th>
              <th className="px-2 py-1 text-left">Map v</th>
              <th className="px-2 py-1 text-left">Product ID</th>
              <th className="px-2 py-1 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {(runs||[]).map(r => (
              <tr key={r.id} className="border-b">
                <td className="px-2 py-1"><input type="checkbox" checked={!!(selectedRuns||{})[r.id]} onChange={(e)=>{
                  const on = e.target.checked; if (typeof setSelectedRuns!=='function') return; setSelectedRuns(prev => { const n={...prev}; if (on) n[r.id]=true; else delete n[r.id]; return n; });
                }} /></td>
                <td className="px-2 py-1">{r.id}</td>
                <td className="px-2 py-1 truncate max-w-[24rem]" title={r.url||''}><a className="text-indigo-600 hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.url||''}</a></td>
                <td className="px-2 py-1">{r.page_type||''}</td>
                <td className="px-2 py-1">{r.version ? `v${r.version}` : ''}</td>
                <td className="px-2 py-1">{(function(){ const v = (mapVers||{})[String(r.page_type||'').toLowerCase()]; return v ? `v${v}` : ''; })()}</td>
                <td className="px-2 py-1">{r.product_id != null ? String(r.product_id) : ''}</td>
                <td className="px-2 py-1 space-x-2">
                  {/* See upsert (preview only; no writes) */}
                  <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={!mysqlProfileId || runsBusy}
                    title={!mysqlProfileId? 'Select a MySQL profile in Step 3' : 'Preview the upsert plan (no write)'}
                    onClick={async ()=>{
                      if (!mysqlProfileId) { alert('Select a MySQL profile first (Step 3)'); return; }
                      try {
                        const pt = r.page_type || mapType;
                        // Load mapping: prefer editor mapText; fallback to saved mapping
                        let mappingObj = null;
                        try { mappingObj = mapText ? JSON.parse(mapText) : null; } catch { mappingObj = null; }
                        if (!mappingObj) {
                          try {
                            const tr = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(pt)}`, { credentials:'include' });
                            const tj = await tr.json();
                            mappingObj = (tr.ok && tj?.ok) ? ((tj.unified && tj.unified.config) || tj.mapping || {}) : {};
                          } catch { mappingObj = {}; }
                        }
                        let w = window.open('', '_blank');
                        if (!w) { alert('Popup blocked'); return; }
                        const safe = (s)=>String(s||'').replace(/[<>]/g, c=>({"<":"&lt;",">":"&gt;"}[c]));
                        const write = (html)=>{ try { w.document.getElementById('content').innerHTML = html; } catch {} };
                        const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>See Upsert (Preview)</title><style>
                          body{font:12px system-ui, sans-serif;padding:10px}
                          .hdr{margin:0 0 8px 0}
                          .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
                          .sec{margin-bottom:12px}
                          .title{font-weight:600;margin:4px 0}
                          .titleBar{display:flex;justify-content:space-between;align-items:center;gap:8px}
                          .copy{font-size:12px;padding:2px 6px;border:1px solid #e5e5e5;border-radius:4px;background:#fff}
                          textarea, pre{width:100%;min-height:260px}
                          pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:4px;padding:8px}
                          textarea{border:1px solid #e5e5e5;border-radius:4px;padding:8px;background:#fff}
                        </style><script>
                          function copy(id){
                            try{var el=document.getElementById(id);var text=el?(el.tagName==='TEXTAREA'?el.value:el.textContent):'';
                              if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).catch(fallback);}else{fallback();}
                              function fallback(){try{var ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}catch(e){}}
                              var btn=document.getElementById('btn_'+id);if(btn){var old=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=old;},1200);} }catch(e){}
                          }
                        </script></head><body><h3 class=\"hdr\">See Upsert (Preview) – Run ${r.id} – ${pt}</h3><div id=\"content\">Starting…</div></body></html>`;
                        w.document.open(); w.document.write(shell); w.document.close();

                        // Preview upsert (no write)
                        let req = { run_id: r.id, profile_id: mysqlProfileId };
                        if (r.product_id != null && Number(r.product_id) > 0) req.product_id = Number(r.product_id);
                        if (mappingObj && typeof mappingObj==='object') req.mapping = mappingObj;
                        // Try to resolve mapping version and include it
                        try {
                          const trv = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(pt)}`, { credentials:'include' });
                          const tvj = await trv.json();
                          const mvNow = Number(tvj?.mapping_version || (tvj?.unified?.version || 0)) || 0;
                          if (mvNow>0) req.mapping_version = mvNow;
                        } catch {}
                        let upResText = '';
                        let sqlBlocksHtml = '';
                        try {
                          const resp = await fetch('/api/grabbing-jerome/transfer/prestashop/preview-tables', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(req) });
                          const j = await resp.json();
                          upResText = JSON.stringify(j, null, 2);
                          try {
                            // Build pseudo-SQL per table (preview from plan)
                            const plan = j && j.plan ? j.plan : {};
                            const esc = (s)=>String(s).replace(/`/g,'``');
                            const escVal = (v)=>{
                              if (v === null || v === undefined) return 'NULL';
                              if (typeof v === 'number') return String(v);
                              if (typeof v === 'boolean') return v ? '1' : '0';
                              return '\''+String(v).replace(/\\/g,'\\\\').replace(/'/g,"\\'")+'\'';
                            };
                            const mkInsertUpsert = (table, row, keyCols=[]) => {
                              const cols = Object.keys(row||{});
                              if (!cols.length) return '';
                              const vals = cols.map(c => escVal(row[c]));
                              const set = cols.filter(c => !keyCols.includes(c)).map(c => '\\`'+esc(c)+'\\`=VALUES(\\`'+esc(c)+'\\`)');
                              return 'INSERT INTO \\`'+esc(table)+'\\` ('+cols.map(c=>'\\`'+esc(c)+'\\`').join(',')+') VALUES ('+vals.join(',')+')'+(set.length? ' ON DUPLICATE KEY UPDATE '+set.join(', '): '')+';';
                            };
                            const blocks = [];
                            if (plan.product && plan.product.table) {
                              const T = String(plan.product.table);
                              const ins = mkInsertUpsert(T, plan.product.insert||{}, ['id_product']);
                              const upd = plan.product.update || {};
                              const updSet = Object.keys(upd).map(c=>'\\`'+esc(c)+'\\`='+escVal(upd[c]));
                              const updSql = updSet.length ? 'UPDATE \\`'+esc(T)+'\\` SET '+updSet.join(', ')+' WHERE \\`id_product\\`='+escVal(plan.product.product_id||0)+';' : '';
                              blocks.push({ name: T, sql: [ins, updSql].filter(Boolean).join('\\n') });
                            }
                            const handleArr = (label, arr, keyCols) => {
                              if (!Array.isArray(arr) || !arr.length) return;
                              const sql = arr.map(it => mkInsertUpsert(String(it.table||label), it.columns||{}, keyCols)).filter(Boolean).join('\\n');
                              if (sql) blocks.push({ name: label, sql });
                            };
                            handleArr('product_shop', plan.product_shop, ['id_product','id_shop']);
                            handleArr('product_lang', plan.product_lang, ['id_product','id_lang','id_shop']);
                            handleArr('stock_available', plan.stock_available, ['id_product','id_product_attribute','id_shop','id_shop_group']);
                            if (plan.extra && typeof plan.extra==='object') {
                              const keys = Object.keys(plan.extra).sort((a,b)=>a.localeCompare(b));
                              for (const k of keys) handleArr(k, plan.extra[k], []);
                            }
                            sqlBlocksHtml = blocks.map((b, idx) => {
                              const id = 'sql_'+idx;
                              const enc = String(b.sql||'').replace(/[<>]/g, c=>({"<":"&lt;", ">":"&gt;"}[c]));
                              return '<details><summary><strong>'+b.name+'</strong></summary><div class=\\\\"titleBar\\\\"><div class=\\\\"title\\\\">'+b.name+' queries</div><button id=\\\\"btn_'+id+'\\\\" class=\\\\"copy\\\\" onclick=\\\\"copy(\''+id+'\')\\\\">Copy SQL</button></div><pre id=\\\\"'+id+'\\\\">'+enc+'</pre></details>';
                            }).join('\\n');
                          } catch {}
                        } catch (e) {
                          upResText = JSON.stringify({ ok:false, error: String(e?.message||e) }, null, 2);
                        }

                        const html = `
                          <div class=\"sec\">
                            <div class=\"title\">Request</div>
                            <div class=\"grid\">
                              <div>
                                <details><summary><div class=\"titleBar\"><div class=\"title\">Mapping config</div><button id=\"btn_upmap\" class=\"copy\" onclick=\"copy('upmap')\">Copy JSON</button></div></summary>
                                  <textarea id=\"upmap\" readonly>${safe(JSON.stringify(mappingObj, null, 2))}</textarea>
                                </details>
                              </div>
                              <div>
                                <details><summary><div class=\"titleBar\"><div class=\"title\">Parameters</div><button id=\"btn_upreq\" class=\"copy\" onclick=\"copy('upreq')\">Copy JSON</button></div></summary>
                                  <pre id=\"upreq\">${safe(JSON.stringify(req, null, 2))}</pre>
                                </details>
                              </div>
                            </div>
                          </div>
                          <div class=\"sec\">
                            <div class=\"title\">Preview</div>
                            <div class=\"grid\">
                              <div style=\"grid-column:1 / span 2\"> 
                                <details><summary><div class=\"titleBar\"><div class=\"title\">Result</div><button id=\"btn_upres\" class=\"copy\" onclick=\"copy('upres')\">Copy JSON</button></div></summary>
                                  <pre id=\"upres\">${safe(upResText)}</pre>
                                </details>
                              </div>
                            </div>
                          </div>
                          <div class=\"sec\">\n                            <div class=\"title\">Queries (preview)</div>\n                            <div>${sqlBlocksHtml || '<div class=\\"text-xs\\">No queries generated.</div>'}</div>\n                          </div>
                        `;
                        write(html);
                      } catch (e) { alert(String(e?.message||e)); }
                    }}>See upsert</button>

                  {/* See JSON popup */}
                  <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={runsBusy} title="See extraction and mapping JSON" onClick={async ()=>{
                    try {
                      const pt = r.page_type || mapType;
                      const rResp = await fetch(`/api/grabbing-jerome/extraction/history/${encodeURIComponent(r.id)}?include=full`, { credentials:'include' });
                      const rJson = await rResp.json();
                      if (!rResp.ok || rJson?.ok===false) { alert(String(rJson?.message||rJson?.error||'load_failed')); return; }
                      const it = rJson.item || rJson;
                      const extractCfg = JSON.stringify(it.config || {}, null, 2);
                      const extractRes = JSON.stringify(it.result || {}, null, 2);
                      const extractVer = Number(r.version || it.version || 0) || 0;
                      const tr = await fetch(`/api/grabbing-jerome/domains/${encodeURIComponent(activeDomain)}/transfert?page_type=${encodeURIComponent(pt)}`, { credentials:'include' });
                      const tj = await tr.json();
                      let mapBase = (tr.ok && tj?.ok) ? (tj.mapping || {}) : {};
                      mapBase = mapBase && typeof mapBase==='object' ? mapBase : {};
                      mapBase.tables = mapBase.tables && typeof mapBase.tables==='object' ? mapBase.tables : {};
                      mapBase.defaults = mapBase.defaults && typeof mapBase.defaults==='object' ? mapBase.defaults : {};
                      const mv = Number(tj?.mapping_version || (tj?.unified?.version || 0)) || 0;
                      const ts = await fetch(`/api/grabbing-jerome/table-settings?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(pt)}`, { credentials:'include' });
                      const tsj = await ts.json();
                      if (ts.ok && tsj?.ok && Array.isArray(tsj.items)) {
                        for (const row of tsj.items) {
                          const t = String(row.table_name||'').trim(); if (!t) continue;
                          mapBase.tables[t] = mapBase.tables[t] && typeof mapBase.tables[t]==='object' ? mapBase.tables[t] : {};
                          if (row.mapping && typeof row.mapping==='object') {
                            const mf = row.mapping.fields && typeof row.mapping.fields==='object' ? row.mapping.fields : {};
                            const md = row.mapping.defaults && typeof row.mapping.defaults==='object' ? row.mapping.defaults : {};
                            mapBase.tables[t].fields = { ...(mapBase.tables[t].fields||{}), ...mf };
                            mapBase.defaults[t] = { ...(mapBase.defaults[t]||{}), ...md };
                          }
                          if (row.settings && typeof row.settings==='object') {
                            mapBase.tables[t].settings = { ...(mapBase.tables[t].settings||{}), ...row.settings };
                          }
                        }
                      }
                      const mappingJson = JSON.stringify(mapBase||{}, null, 2);

                      // Mapping preview/result (requires profile)
                      let mappingPrev = '';
                      try {
                        if (mysqlProfileId) {
                          const body = { run_id: r.id, profile_id: mysqlProfileId };
                          const pr = await fetch('/api/grabbing-jerome/transfer/prestashop/preview-tables', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                          const pj = await pr.json();
                          if (pr.ok && pj) mappingPrev = JSON.stringify(pj, null, 2); else mappingPrev = JSON.stringify({ error: pj?.error||pj?.message||'preview_failed' }, null, 2);
                        } else {
                          mappingPrev = JSON.stringify({ message: 'Select a MySQL profile in Step 3 to preview mapping result.' }, null, 2);
                        }
                      } catch (e) {
                        mappingPrev = JSON.stringify({ error: String(e?.message||e) }, null, 2);
                      }

                      let w = window.open('', '_blank');
                      if (!w) { alert('Popup blocked'); return; }
                      const write = (html)=>{ try { w.document.getElementById('content').innerHTML = html; } catch {} };
                      const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>See JSON</title><style>
                        body{font:12px system-ui, sans-serif;padding:10px}
                        .hdr{margin:0 0 8px 0}
                        .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
                        .sec{margin-bottom:12px}
                        .title{font-weight:600;margin:4px 0}
                        .titleBar{display:flex;justify-content:space-between;align-items:center;gap:8px}
                        .copy{font-size:12px;padding:2px 6px;border:1px solid #e5e5e5;border-radius:4px;background:#fff}
                        textarea, pre{width:100%;min-height:260px}
                        pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:4px;padding:8px}
                        textarea{border:1px solid #e5e5e5;border-radius:4px;padding:8px;background:#fff}
                      </style><script>
                        function copy(id){
                          try{
                            var el=document.getElementById(id);
                            var text=el? (el.tagName==='TEXTAREA'? el.value: el.textContent): '';
                            if(navigator.clipboard && navigator.clipboard.writeText){
                              navigator.clipboard.writeText(text).catch(fallback);
                            } else { fallback(); }
                            function fallback(){ try{ var ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);}catch(e){} }
                            var btn=document.getElementById('btn_'+id); if(btn){ var old=btn.textContent; btn.textContent='Copied'; setTimeout(function(){ btn.textContent=old; },1200); }
                          }catch(e){}
                        }
                      </script></head><body><h3 class=\"hdr\">Run ${r.id} – ${pt} ${extractVer?`(ext v${extractVer})`:''} · mapping v${mv||'?'} </h3><div id=\"content\">Loading…</div></body></html>`;
                      w.document.open(); w.document.write(shell); w.document.close();
                      const safe = (s)=>s.replace(/[<>]/g, c=>({"<":"&lt;",">":"&gt;"}[c]));
                      const html = `
                        <div class=\"sec\">
                          <div class=\"title\">Extraction</div>
                          <div class=\"grid\">
                            <div>
                              <div class=\"titleBar\"><div class=\"title\">Extraction config ${extractVer?`(v${extractVer})`:''}</div><button id=\"btn_cfg\" class=\"copy\" onclick=\"copy('cfg')\">Copy JSON</button></div>
                              <textarea id=\"cfg\" readonly>${safe(extractCfg)}</textarea>
                            </div>
                            <div>
                              <div class=\"titleBar\"><div class=\"title\">Extraction result</div><button id=\"btn_res\" class=\"copy\" onclick=\"copy('res')\">Copy JSON</button></div>
                              <pre id=\"res\">${safe(extractRes)}</pre>
                            </div>
                          </div>
                        </div>
                        <div class=\"sec\">
                          <div class=\"title\">Mapping</div>
                          <div class=\"grid\">
                            <div>
                              <div class=\"titleBar\"><div class=\"title\">Mapping config ${mv?`(v${mv})`:''}</div><button id=\"btn_mapcfg\" class=\"copy\" onclick=\"copy('mapcfg')\">Copy JSON</button></div>
                              <textarea id=\"mapcfg\" readonly>${safe(mappingJson)}</textarea>
                            </div>
                            <div>
                              <div class=\"titleBar\"><div class=\"title\">Mapping result</div><button id=\"btn_mapprev\" class=\"copy\" onclick=\"copy('mapprev')\">Copy JSON</button></div>
                              <pre id=\"mapprev\">${safe(mappingPrev)}</pre>
                            </div>
                          </div>
                        </div>
                      `;
                      write(html);
                    } catch (e) { alert(String(e?.message||e)); }
                  }}>See JSON</button>

                  {/* Resend/update if we already know product_id */}
                  {r.product_id ? (
                    <span className="inline-flex items-center gap-1">
                    <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={!mysqlProfileId || runsBusy} onClick={async ()=>{
                      if (!mysqlProfileId) { alert('Select a MySQL profile first (Step 3)'); return; }
                      let w = window.open('', '_blank');
                      if (!w) { alert('Popup blocked'); return; }
                      const write = (html)=>{ try { w.document.getElementById('content').innerHTML += html; } catch {} };
                      const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Resend (update)</title><style>body{font:12px system-ui, sans-serif;padding:10px} .muted{color:#666} .ok{color:#166534} .err{color:#991b1b}</style></head><body><h3 style=\"margin:0\">Resend (update) – Run ${r.id}</h3><div class=\"muted\">product_id=${r.product_id}</div><div id=\"content\"></div></body></html>`;
                      w.document.open(); w.document.write(shell); w.document.close();
                      write('<div>Starting…</div>');
                      try {
                        let obj = {};
                        try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { write(`<div class=\"err\">Invalid mapping JSON: ${String(e?.message||e)}</div>`); return; }
                        write('<div>Posting to /transfer/prestashop…</div>');
                        const resp = await fetch('/api/grabbing-jerome/transfer/prestashop', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ run_id: r.id, product_id: r.product_id, profile_id: mysqlProfileId, mapping: obj, write: true }) });
                        let j={}; try { j = await resp.json(); } catch {}
                        if (!resp.ok || j?.ok===false) { write(`<div class=\"err\">Failed: ${String(j?.message||j?.error||resp.status)}</div>`); return; }
                        write(`<div class=\"ok\">OK – updated: ${j?.updated? 'yes':'no'}</div>`);
                        write(`<div class=\"muted\">product_id=${j?.product_id || r.product_id}</div>`);
                        if (typeof reloadRuns==='function') await reloadRuns();
                      } catch (e) { write(`<div class=\"err\">Error: ${String(e?.message||e)}</div>`); }
                    }}>Resend (update)</button>
                    <button className="px-2 py-1 rounded border text-xs bg-white" onClick={async ()=>{
                      const w = window.open('', 'gj_progress', 'width=900,height=600');
                      if (!w) { alert('Popup blocked. Please allow popups.'); return; }
                      const write = (html)=>{ try { const el=w.document.getElementById('content'); el.innerHTML += html; el.scrollTop = el.scrollHeight; } catch {} };
                      const shell = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Run ${r.id} – Progress</title><style>body{font:12px system-ui, sans-serif;padding:10px} .muted{color:#666} .ok{color:#166534} .err{color:#991b1b} pre{white-space:pre-wrap;word-break:break-word}</style></head><body><h3 style=\"margin:0\">Run ${r.id} – Progress</h3><div class=\"muted\">product_id=${r.product_id||''}</div><div id=\"content\" style=\"border:1px solid #ddd; padding:8px; height:460px; overflow:auto\"></div><div class=\"muted\">Polling admin endpoints every 1.5s…</div></body></html>`;
                      w.document.open(); w.document.write(shell); w.document.close();
                      let lastErrIds = new Set();
                      let lastLogSet = new Set();
                      const renderErrors = (items=[]) => {
                        for (const it of items) {
                          const key = `${it.id||''}`;
                          if (lastErrIds.has(key)) continue; lastErrIds.add(key);
                          write(`<div><span class=\"muted\">[DB]</span> ${String(it.table_name||'').replace(/^.*\./,'')} · <span class=\"muted\">${String(it.op||'')}</span> · ${String(it.error||'')}</div>`);
                        }
                      };
                      const renderLogs = (lines=[]) => {
                        for (const ln of (lines||[])) { if (lastLogSet.has(ln)) continue; lastLogSet.add(ln); write(`<pre>${ln.replace(/[&<>]/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[s]))}</pre>`); }
                      };
                      let stop = false;
                      const poll = async () => {
                        if (stop) return;
                        try {
                          const qs = new URLSearchParams(); qs.set('run_id', String(r.id)); qs.set('limit','200');
                          const e1 = await fetch(`/api/grabbing-jerome/admin/runs/errors?${qs.toString()}`, { credentials:'include' });
                          const j1 = await e1.json(); if (e1.ok && j1?.ok) renderErrors(j1.items||[]);
                        } catch {}
                        try {
                          const qs2 = new URLSearchParams(); qs2.set('run_id', String(r.id)); qs2.set('lines','800');
                          const e2 = await fetch(`/api/grabbing-jerome/admin/runs/logs?${qs2.toString()}`, { credentials:'include' });
                          const j2 = await e2.json(); if (e2.ok && j2?.ok) renderLogs(j2.items||[]);
                        } catch {}
                        setTimeout(poll, 1500);
                      };
                      poll();
                      const closeWatcher = () => { stop = true; try { w.close(); } catch {} };
                      w.onbeforeunload = () => { stop = true; };
                    }}>Follow progress</button>
                    </span>
                  ) : null}

                  {/* Force update by manual product id if unknown */}
                  {!r.product_id ? (
                    <span className="inline-flex items-center gap-1">
                      <input className="border rounded px-2 py-1 w-24 text-xs" placeholder="Product ID" value={(runPid||{})[r.id]||''} onChange={(e)=>setRunPid(prev=>({ ...prev, [r.id]: e.target.value }))} />
                      <button className="px-2 py-1 rounded border text-xs disabled:opacity-60" disabled={!mysqlProfileId || runsBusy || !((runPid||{})[r.id]||'').trim()} onClick={async ()=>{
                        const pid = Number(((runPid||{})[r.id]||'').trim());
                        if (!Number.isFinite(pid) || pid<=0) { alert('Enter a valid product id'); return; }
                        try {
                          let obj = {};
                          try { obj = mapText ? JSON.parse(mapText) : {}; } catch (e) { alert('Invalid mapping JSON: '+(e?.message||e)); return; }
                          const resp = await fetch('/api/grabbing-jerome/transfer/prestashop', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ run_id: r.id, product_id: pid, profile_id: mysqlProfileId, mapping: obj, write: true }) });
                          const j = await resp.json();
                          if (!resp.ok || j?.ok===false) { alert(String(j?.message||j?.error||'update_failed')); return; }
                          if (typeof setRuns==='function') setRuns(prev => prev.map(it => it.id===r.id ? { ...it, product_id: pid } : it));
                          alert(`Updated product_id=${pid}. ${j?.updated?'[updated]':''}`);
                        } catch (e) { alert(String(e?.message||e)); }
                      }}>Update by ID</button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-2 mt-2">
        <button className="px-3 py-1 rounded border text-xs disabled:opacity-60" disabled={runsOffset<=0 || runsBusy} onClick={async ()=>{
          const newOffset = Math.max(0, (runsOffset||0) - (runsLimit||20));
          if (typeof setRunsOffset==='function') setRunsOffset(newOffset);
          if (!activeDomain) return;
          try {
            const params = new URLSearchParams();
            params.set('domain', activeDomain);
            params.set('limit', String(runsLimit||20));
            params.set('offset', String(newOffset));
            params.set('include', 'full');
            const r = await fetch(`/api/grabbing-jerome/extraction/history?${params.toString()}`, { credentials:'include' });
            const j = await r.json();
            if (r.ok && j?.ok && typeof setRuns==='function') { setRuns(j.items||[]); }
          } catch {}
        }}>Prev</button>
        <button className="px-3 py-1 rounded border text-xs disabled:opacity-60" disabled={(runsOffset||0) + (runs?.length||0) >= (runsTotal||0) || runsBusy} onClick={async ()=>{
          const newOffset = (runsOffset||0) + (runsLimit||20);
          if (typeof setRunsOffset==='function') setRunsOffset(newOffset);
          if (!activeDomain) return;
          try {
            const params = new URLSearchParams();
            params.set('domain', activeDomain);
            params.set('limit', String(runsLimit||20));
            params.set('offset', String(newOffset));
            params.set('include', 'full');
            const r = await fetch(`/api/grabbing-jerome/extraction/history?${params.toString()}`, { credentials:'include' });
            const j = await r.json();
            if (r.ok && j?.ok && typeof setRuns==='function') { setRuns(j.items||[]); }
          } catch {}
        }}>Next</button>
      </div>
    </>
  );
}
