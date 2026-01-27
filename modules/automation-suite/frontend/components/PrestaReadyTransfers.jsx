import React, { useEffect, useMemo, useState } from "react";
import { buildPrestaImportPayloadFromPrepared } from "../utils/prestaPayload.js";
import PrestaTransferActions from "./PrestaTransferActions.jsx";

export default function PrestaReadyTransfers({ activeDomain, onChangeDomain } = {}) {
  const [domains, setDomains] = useState([]);
  const [domain, setDomain] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(200);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastAction, setLastAction] = useState("");
  const [auto, setAuto] = useState(false);
  const [autoMs, setAutoMs] = useState(15000);
  // Auto re-send product after a successful send
  const [autoResend, setAutoResend] = useState(true);
  // Preview resend images
  const [imgPreviewOpen, setImgPreviewOpen] = useState(false);
  const [imgPreviewList, setImgPreviewList] = useState([]);
  const [imgPreviewRow, setImgPreviewRow] = useState(null);
  const [imgPreviewMsg, setImgPreviewMsg] = useState("");
  const [imgSending, setImgSending] = useState(false);
  const [imgPreviewResults, setImgPreviewResults] = useState([]);
  const [imgPreviewPreflight, setImgPreviewPreflight] = useState([]);
  const [imgCustom, setImgCustom] = useState('');
  const [transferLog, setTransferLog] = useState(null);
  const [imagesCreated, setImagesCreated] = useState([]);
  // Active Presta profile (for visibility in Transfers UI)
  const [activeProfile, setActiveProfile] = useState('');

  const canPrev = offset > 0;
  const canNext = offset + limit < total;
  const rangeLabel = total > 0 ? `${offset+1}-${Math.min(offset+limit,total)} / ${total}` : `0-0 / 0`;

  const loadDomains = async () => {
    try {
      const r = await fetch('/api/grabbings/jerome/domains', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setDomains(Array.isArray(j.items)? j.items: []);
    } catch {}
  };
  useEffect(()=>{ loadDomains(); },[]);
  useEffect(() => {
    if (typeof activeDomain === 'string') setDomain(activeDomain || '');
  }, [activeDomain]);

  // Load active Presta DB profile name for display
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/presta-db/profiles', { credentials:'include' });
        const j = await r.json();
        if (r.ok && j && j.ok !== false) setActiveProfile(String(j.active||''));
      } catch {}
    })();
  }, []);

  const loadReady = async (d, off=0) => {
    if (!d) return;
    setBusy(true); setMsg('');
    try {
      const u = `/api/grabbings/jerome/domains/ready-transfers?domain=${encodeURIComponent(d)}&limit=${limit}&offset=${off}`;
      const r = await fetch(u, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setMsg(j?.message||j?.error||'list_failed'); setItems([]); setTotal(0); }
      else { setItems(Array.isArray(j.items)? j.items: []); setTotal(Number(j.total||0)); setOffset(off); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (domain) loadReady(domain, 0); }, [domain, limit]);
  useEffect(() => {
    if (!auto || !domain) return;
    const ms = Math.max(3000, Math.min(120000, Number(autoMs||15000)));
    const id = setInterval(() => { loadReady(domain, offset); }, ms);
    return () => clearInterval(id);
  }, [auto, autoMs, domain, offset, limit]);

  // Persist autoResend preference
  useEffect(() => {
    try {
      const v = localStorage.getItem('presta_auto_resend_after_send');
      if (v === '0') setAutoResend(false);
      else if (v === '1') setAutoResend(true);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('presta_auto_resend_after_send', autoResend ? '1' : '0'); } catch {}
  }, [autoResend]);

  // Copy all queries from the current transfer log
  const copyQueries = async () => {
    try {
      const qs = Array.isArray(transferLog?.queries) ? transferLog.queries : [];
      if (!qs.length) return;
      const lines = [];
      qs.forEach((q, idx) => {
        const n = idx + 1;
        lines.push(`Q${n}: ${String(q?.sql || '')}`);
        const params = Array.isArray(q?.params) ? q.params : [];
        lines.push(`P${n}: ` + JSON.stringify(params));
        lines.push('');
      });
      const text = lines.join('\n');
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch {}
        try { document.body.removeChild(ta); } catch {}
      }
      setLastAction('Copied queries');
    } catch {}
  };

  // Copy helpers for Warm / Error entries from the transfer log
  const copyWarm = async () => {
    try {
      const warm = Array.isArray(transferLog?.warm) ? transferLog.warm : [];
      if (!warm.length) return;
      const lines = ['Warm:'];
      for (const w of warm) lines.push(typeof w === 'string' ? w : JSON.stringify(w));
      const text = lines.join('\n');
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch {}
        try { document.body.removeChild(ta); } catch {}
      }
      setLastAction('Copied warm');
    } catch {}
  };
  const copyError = async () => {
    try {
      const errs = Array.isArray(transferLog?.error) ? transferLog.error : [];
      if (!errs.length) return;
      const lines = ['Error:'];
      for (const e of errs) lines.push(typeof e === 'string' ? e : JSON.stringify(e));
      const text = lines.join('\n');
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch {}
        try { document.body.removeChild(ta); } catch {}
      }
      setLastAction('Copied errors');
    } catch {}
  };
  const copyWarmError = async () => {
    try {
      const warm = Array.isArray(transferLog?.warm) ? transferLog.warm : [];
      const errs = Array.isArray(transferLog?.error) ? transferLog.error : [];
      if (!warm.length && !errs.length) return;
      const lines = [];
      if (warm.length) {
        lines.push('Warm:');
        for (const w of warm) lines.push(typeof w === 'string' ? w : JSON.stringify(w));
        lines.push('');
      }
      if (errs.length) {
        lines.push('Error:');
        for (const e of errs) lines.push(typeof e === 'string' ? e : JSON.stringify(e));
        lines.push('');
      }
      const text = lines.join('\n');
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch {}
        try { document.body.removeChild(ta); } catch {}
      }
      setLastAction('Copied warm/error');
    } catch {}
  };

  const sendOne = async (row) => {
    if (!domain || !row?.url) return;
    // Clear previous debug and results before a new transfer
    setTransferLog(null);
    setImagesCreated([]);
    setBusy(true); setMsg(''); setLastAction('Running…');
    try {
      // STRICT CREATE: insert new product only (no upsert fallback)
      const infoUrl = `/api/grabbings/jerome/domains/url/ready?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(row.url)}`;
      const r1 = await fetch(infoUrl, { credentials:'include' });
      const j1 = await r1.json();
      if (!r1.ok || j1?.ok===false) throw new Error(j1?.message||j1?.error||'ready_fetch_failed');
      const item = j1.item || {};
      const data = buildPrestaImportPayloadFromPrepared(item, row.url);
      const rImp = await fetch('/api/presta/products/import?debug=1', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ data, debug: true }) });
      const j2 = await rImp.json();
      if (!rImp.ok || j2?.ok===false) {
        try { await fetch('/api/grabbings/jerome/domains/url/ready/status', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain, url: row.url, status:'failed', notes: String(j2?.message||j2?.error||`HTTP_${rImp.status}`) }) }); } catch {}
        throw new Error(j2?.message||j2?.error||'import_failed');
      }
      try { if (j2.debug_log) setTransferLog(j2.debug_log); setImagesCreated(Array.isArray(j2.images_created)? j2.images_created: []); } catch {}
      const idp = (j2?.id_product != null) ? Number(j2.id_product) : null;
      try { await fetch('/api/grabbings/jerome/domains/url/ready/status', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain, url: row.url, status:'transferred', id_product: idp, notes: idp ? `id_product=${idp}` : 'transferred' }) }); } catch {}
      setLastAction(idp ? ('Done Imported as #' + idp) : 'Done');
      // Optionally chain a product re-send (upsert) to normalize combinations/visibility
      let resendOk = false;
      if (autoResend && idp) {
        try {
          const rRe = await fetch('/api/presta/products/resend?debug=1', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials:'include',
            body: JSON.stringify({ domain, url: row.url, id_product: idp, debug: true })
          });
          const jRe = await rRe.json();
          if (rRe.ok && jRe?.ok !== false) {
            resendOk = true;
            try { if (jRe.debug_log) setTransferLog(jRe.debug_log); } catch {}
          }
        } catch {}
      }
      if (idp) { if (autoResend) setLastAction(resendOk ? ('Done Imported #' + idp + ' + Re-sent') : ('Done Imported as #' + idp)); else setLastAction('Done Imported as #' + idp); }
      await loadReady(domain, offset);
    } catch (e) {
      setMsg(String(e?.message||e));
    } finally { setBusy(false); }
  };

  const resendImages = async (row) => {
    if (!domain || !row?.url) return;
    setImgPreviewMsg(''); setImgPreviewOpen(true); setImgPreviewRow(row); setImgPreviewList([]); setImgPreviewResults([]); setImgPreviewPreflight([]);
    try {
      // 1) Read prepared row
      const infoUrl = `/api/grabbings/jerome/domains/url/ready?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(row.url)}`;
      const r1 = await fetch(infoUrl, { credentials:'include' });
      const j1 = await r1.json();
      let list = [];
      if (r1.ok && j1?.ok) {
        const it = j1.item || {};
        const locals = Array.isArray(it?.product_raw?.images_local) ? it.product_raw.images_local : [];
        if (locals.length) list = locals.map(x => (x && (x.download_url || x.url || x.href)) || '').filter(Boolean);
        if (!list.length && Array.isArray(it?.product_raw?.images)) list = it.product_raw.images.map(u=>String(u||'')).filter(Boolean);
        if (!list.length && Array.isArray(it?.mapped?.images)) list = it.mapped.images.map(x => (typeof x === 'string'? x : (x && x.url) || '')).filter(Boolean);
      }
      // 2) Fallback to stored snapshot
      if (!list.length) {
        try {
          const us = `/api/grabbings/jerome/domains/url/stored?domain=${encodeURIComponent(domain)}&url=${encodeURIComponent(row.url)}`;
          const rs = await fetch(us, { credentials:'include' });
          const js = await rs.json();
          if (rs.ok && js?.ok) {
            const data = js.item?.result_json || {};
            const locals = Array.isArray(data?.product?.images_local) ? data.product.images_local : [];
            if (locals.length) list = locals.map(x => (x && (x.download_url || x.url || x.href)) || '').filter(Boolean);
            if (!list.length && data?.meta?.og_image) list = [String(data.meta.og_image)];
          }
        } catch {}
      }
      setImgPreviewList(list);
      // 3) Preflight (respect custom overrides if present)
      try {
        const custom = (typeof imgCustom === 'string')
          ? imgCustom.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)
          : [];
        const pfBody = custom.length
          ? { id_product: row.id_product || undefined, images: custom }
          : { domain, url: row.url, id_product: row.id_product || undefined };
        const rpf = await fetch('/api/presta/products/images/resend/preflight', {
          method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
          body: JSON.stringify(pfBody)
        });
        const jpf = await rpf.json();
        if (rpf.ok && jpf?.ok) setImgPreviewPreflight(Array.isArray(jpf.items)? jpf.items: []);
      } catch {}
      if (!list.length) setImgPreviewMsg('No images found (prepared row and snapshot empty).');
    } catch (e) { setImgPreviewMsg(String(e?.message||e)); }
  };

  const resendProduct = async (row) => {
    if (!domain || !row?.url) return;
    setTransferLog(null);
    setImagesCreated([]);
    setBusy(true); setMsg(''); setLastAction('Running…');
    try {
      const r = await fetch('/api/presta/products/resend?debug=1', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials:'include',
        body: JSON.stringify({ domain, url: row.url, id_product: row.id_product || undefined, debug: true })
      });
      const j = await r.json();
      if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
      setLastAction(`Done · Product ${j.action} (id #${j.id_product})`);
      try { if (j.debug_log) setTransferLog(j.debug_log); } catch {}
      await loadReady(domain, offset);
    } catch (e) {
      setMsg(String(e?.message||e)); setLastAction('Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <div className="mt-1 grid grid-cols-1 md:grid-cols-6 gap-2 items-end text-[11px]">
        <div className="md:col-span-3">
          <label className="block mb-1">Domain</label>
          <select className="w-full border rounded px-2 py-1" value={typeof activeDomain === 'string' ? (activeDomain || '') : domain} onChange={(e)=> (onChangeDomain? onChangeDomain(e.target.value): setDomain(e.target.value))}>
            <option value="">-- select domain --</option>
            {domains.map(d => (<option key={d.domain} value={d.domain}>{d.domain}</option>))}
          </select>
        </div>
        <div className="md:col-span-3 flex items-center gap-2">
          <label>Page size</label>
          <input type="number" className="border rounded px-1 py-0.5 w-20" value={limit} onChange={(e)=> setLimit(Math.max(10, Math.min(1000, Number(e.target.value||200))))} />
          <button className="px-2 py-1 border rounded" disabled={!canPrev || busy} onClick={()=> loadReady(domain, Math.max(0, offset - limit))}>Prev</button>
          <button className="px-2 py-1 border rounded" disabled={!canNext || busy} onClick={()=> loadReady(domain, offset + limit)}>Next</button>
          <div className="text-gray-500">{rangeLabel}</div>
          <button className="px-2 py-1 border rounded" disabled={!domain || busy} onClick={()=> loadReady(domain, offset)}>Refresh</button>
          <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={auto} onChange={(e)=> setAuto(e.target.checked)} /> Autoload</label>
          <input type="number" className="border rounded px-1 py-0.5 w-24" title="Interval (ms)" value={autoMs} onChange={(e)=> setAutoMs(Number(e.target.value||15000))} />
          <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={autoResend} onChange={(e)=> setAutoResend(e.target.checked)} /> Auto re-send after send</label>
          <div className="ml-auto text-gray-600" title="Active Presta DB profile">Profile: <span className="text-gray-800">{activeProfile || '-'}</span></div>
        </div>
      </div>
      {!!lastAction && <div className="text-[11px] text-gray-700">Status: {lastAction}</div>}
      {!!msg && <div className="text-[11px] text-red-600">{msg}</div>}
      <div className="overflow-auto border rounded bg-gray-50">
        <table className="min-w-full text-[11px]">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="text-left px-2 py-1 border-b">Prepared</th>
              <th className="text-left px-2 py-1 border-b">ID</th>
              <th className="text-left px-2 py-1 border-b">URL</th>
              <th className="text-left px-2 py-1 border-b">Title</th>
              <th className="text-left px-2 py-1 border-b">Type</th>
              <th className="text-left px-2 py-1 border-b">Imgs</th>
              <th className="text-left px-2 py-1 border-b">Config Ver</th>
              <th className="text-left px-2 py-1 border-b">Status</th>
              <th className="text-left px-2 py-1 border-b">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className="border-b last:border-0">
                <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{row.prepared_at? new Date(row.prepared_at).toLocaleString(): ''}</td>
                <td className="px-2 py-1 text-gray-700 whitespace-nowrap">{row.id_product || '-'}</td>
                <td className="px-2 py-1 max-w-[420px]"><a className="text-blue-600 underline break-all" href={row.url} target="_blank" rel="noreferrer">{row.url}</a></td>
                <td className="px-2 py-1 text-gray-700 max-w-[320px] truncate" title={row.title||''}>{row.title || '-'}</td>
                <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{row.page_type||''}</td>
                <td className="px-2 py-1 text-gray-600 whitespace-nowrap">
                  <span title="mapped images">{typeof row.mapped_images === 'number' ? row.mapped_images : '-'}</span>
                  {typeof row.local_images === 'number' && (
                    <span className="text-gray-500 ml-1" title="local images">({row.local_images})</span>
                  )}
                </td>
                <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{row.config_transfert_version != null ? `v${row.config_transfert_version}` : '-'}</td>
                <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{row.status||''}</td>
                <td className="px-2 py-1 whitespace-nowrap text-right">
                  <PrestaTransferActions
                    domain={domain}
                    row={row}
                    busy={busy}
                    onSend={sendOne}
                    onResend={resendProduct}
                    onResendImages={resendImages}
                  />
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={6} className="px-2 py-1 text-gray-500">No prepared items for this domain.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {imgPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={()=> setImgPreviewOpen(false)} />
          <div className="relative bg-white border rounded shadow-lg max-w-3xl w-[95vw] max-h-[80vh] overflow-auto p-3 text-[11px]">
            <div className="flex items-center justify-between">
              <div className="font-medium">Images to re-send ({imgPreviewList.length})</div>
              <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=> setImgPreviewOpen(false)}>Close</button>
            </div>
            {!!imgPreviewMsg && <div className="text-red-600 mt-1">{imgPreviewMsg}</div>}
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-2">
                <div className="font-medium">Preview</div>
                <div className="flex flex-wrap gap-2">
                  {imgPreviewList.slice(0,24).map((u,i)=> (
                    <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-16 h-16 object-cover rounded border" onError={(e)=>{ try{ e.currentTarget.style.display='none'; }catch{} }} /></a>
                  ))}
                </div>
              </div>
              <div>
                <div className="font-medium">URLs / Files</div>
                <div className="max-h-48 overflow-auto border rounded bg-gray-50 p-1">
                  {imgPreviewList.map((u,i)=>(<div key={i} className="break-all">{u}</div>))}
                </div>
                <div className="mt-2">
                  <div className="font-medium">Custom sources (optional)</div>
                  <textarea
                    className="w-full border rounded p-1 h-20"
                    placeholder="One path/URL per line (e.g., /root/livechat-app/backend/uploads/grabbing-jerome/NAME.jpg or http(s)://...)"
                    value={imgCustom}
                    onChange={(e)=> setImgCustom(e.target.value)}
                  />
                </div>
                {!!imgPreviewPreflight.length && (
                  <div className="mt-2">
                    <div className="font-medium">Preflight</div>
                    <div className="max-h-48 overflow-auto border rounded bg-gray-50 p-1 text-[10px]">
                      {imgPreviewPreflight.map((r,i)=> (
                        <div key={i} className="break-all">
                          <span className={(r.local_exists || r.source_type==='remote')? 'text-green-700':'text-red-700'}>
                            {(r.local_exists || r.source_type==='remote')? 'READY':'MISSING'}
                          </span>
                          {`  idx=${r.idx} id_image=${r.id_image||''}  srcType=${r.source_type}  local=${r.local_exists? 'yes':'no'}`}
                          {r.dest? `  dest=${r.dest}`: ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!!imgPreviewResults.length && (
                  <div className="mt-2">
                    <div className="font-medium">Write Results</div>
                    <div className="max-h-48 overflow-auto border rounded bg-gray-50 p-1 text-[10px]">
                      {imgPreviewResults.map((r,i)=> (
                        <div key={i} className="break-all">
                          <span className={r.ok? 'text-green-700':'text-red-700'}>{r.ok? 'OK':'FAIL'}</span>
                          {`  id_image=${r.id_image||''}  size=${r.size||0}  dest=${r.dest||''}`}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                className="px-2 py-0.5 border rounded bg-indigo-600 text-white disabled:opacity-60"
                disabled={imgSending || !imgPreviewRow || !domain}
                onClick={async()=>{
                  if (!imgPreviewRow) return;
                  setImgSending(true); setImgPreviewMsg('');
                  try {
                    const custom = imgCustom.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
                    const body = custom.length
                      ? { id_product: imgPreviewRow.id_product || undefined, images: custom }
                      : { domain, url: imgPreviewRow.url, id_product: imgPreviewRow.id_product || undefined };
                    const r = await fetch('/api/presta/products/images/resend?debug=1', {
                      method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
                      body: JSON.stringify({ ...body, debug: true })
                    });
                    const j = await r.json();
                    if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
                  setLastAction(`Re-sent ${j.images} image(s) (updated ${j.updated}, inserted ${j.inserted})`);
                  setImgPreviewResults(Array.isArray(j.results)? j.results: []);
                  try { if (j.debug_log) setTransferLog(j.debug_log); } catch {}
                  await loadReady(domain, offset);
                  } catch (e) { setImgPreviewMsg(String(e?.message||e)); }
                  finally { setImgSending(false); }
                }}
              >{imgSending? 'Sending…' : 'Send now'}</button>
            </div>
          </div>
        </div>
      )}
      {!!imagesCreated.length && (
        <div className="mt-2 border rounded p-2 bg-white text-[11px]">
          <div className="font-medium mb-1">Images (IDs)</div>
          <div className="max-h-40 overflow-auto">
            {imagesCreated.map((it,i)=> (
              <div key={i} className="flex items-center gap-2">
                <span className="text-gray-700">id_image={it.id_image}</span>
                <span className="text-gray-500">pos={it.position}</span>
                <span className="text-gray-500">cover={Number(it.cover)===1? 'yes':'no'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Transfer debug log */}
      <div className="mt-2 border rounded p-3 bg-white">
        <div className="font-medium mb-1">Transfer Log (debug)</div>
        {!transferLog && (
          <div className="text-[11px] text-gray-500">No debug log yet. Use Send/Re-send actions to populate.</div>
        )}
        {!!transferLog && (
          <div className="space-y-2">
            <div className="text-[11px] text-gray-700"><span className="font-medium">Tables:</span> {(Array.isArray(transferLog.tables)? transferLog.tables: []).join(', ') || '-'}</div>
            <div>
              <div className="text-[11px] font-medium">Data summary</div>
              <pre className="text-[10px] bg-gray-50 border rounded p-2 overflow-auto max-h-48">{JSON.stringify(transferLog.data||{}, null, 2)}</pre>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-medium">Queries</div>
                <button className="px-2 py-0.5 border rounded text-[10px]" onClick={copyQueries} disabled={!Array.isArray(transferLog?.queries) || !transferLog.queries.length}>Copy</button>
              </div>
              <div className="max-h-56 overflow-auto border rounded bg-gray-50 p-2 text-[10px]">
                {(Array.isArray(transferLog.queries)? transferLog.queries: []).map((q,i)=> {
                  const ok = q && q.ok === true && !q.err;
                  const err = q && q.err;
                  return (
                    <div key={i} className="mb-2">
                      <div className="text-gray-500">Q{i+1}</div>
                      <div className={(err? 'text-red-700':'') + (!err && ok? ' text-green-700':' text-gray-700') + ' break-words'}>{q.sql}</div>
                      <div className="text-gray-600 break-words">P{i+1}: {Array.isArray(q.params)? JSON.stringify(q.params): '[]'}</div>
                      {ok && !err && (<div className="text-green-700">OK</div>)}
                      {err && (<div className="text-red-700">{String(err)}</div>)}
                    </div>
                  );
                })}
                {(!transferLog.queries || !transferLog.queries.length) && (<div className="text-gray-500">No queries captured.</div>)}
              </div>
            </div>
            {((Array.isArray(transferLog.warm) && transferLog.warm.length > 0) || (Array.isArray(transferLog.error) && transferLog.error.length > 0)) && (
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-medium">Warm / Error</div>
                  <div className="flex items-center gap-2">
                    <button className="px-2 py-0.5 border rounded text-[10px]" onClick={copyWarm} disabled={!Array.isArray(transferLog?.warm) || !transferLog.warm.length}>Copy Warm</button>
                    <button className="px-2 py-0.5 border rounded text-[10px]" onClick={copyError} disabled={!Array.isArray(transferLog?.error) || !transferLog.error.length}>Copy Error</button>
                    <button className="px-2 py-0.5 border rounded text-[10px]" onClick={copyWarmError} disabled={(!Array.isArray(transferLog?.warm) || !transferLog.warm.length) && (!Array.isArray(transferLog?.error) || !transferLog.error.length)}>Copy Both</button>
                  </div>
                </div>
                <div className="max-h-56 overflow-auto border rounded bg-gray-50 p-2 text-[10px] space-y-2">
                  {Array.isArray(transferLog.warm) && transferLog.warm.length > 0 && (
                    <div>
                      <div className="text-[11px] font-medium text-amber-700">Warm</div>
                      <ul className="list-disc pl-4 text-amber-800">
                        {transferLog.warm.map((w, i) => (
                          <li key={i} className="break-words">{typeof w === 'string' ? w : JSON.stringify(w)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(transferLog.error) && transferLog.error.length > 0 && (
                    <div>
                      <div className="text-[11px] font-medium text-red-700">Error</div>
                      <ul className="list-disc pl-4 text-red-800">
                        {transferLog.error.map((e, i) => (
                          <li key={i} className="break-words">{typeof e === 'string' ? e : JSON.stringify(e)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

