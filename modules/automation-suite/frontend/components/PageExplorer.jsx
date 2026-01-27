import React, { useMemo, useState } from "react";

export default function PageExplorer() {
  const [pageUrl, setPageUrl] = useState("");
  const [pageOut, setPageOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const structured = useMemo(() => {
    if (!pageOut || !pageOut.ok) return null;
    const { url, page_type, meta, product, links_sample } = pageOut;
    return { url, page_type, meta, product, links_sample };
  }, [pageOut]);

  const explore = async () => {
    if (!pageUrl) return;
    setBusy(true);
    try {
      const r = await fetch('/api/grabbings/jerome/page/explore', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ url: pageUrl }) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setPageOut({ ok:false, error: j?.message||j?.error||'explore_failed' });
      else setPageOut(j);
    } catch (e) { setPageOut({ ok:false, error: String(e?.message||e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-3 mb-3 border rounded p-3 bg-white">
      <div className="flex items-center justify-between">
        <div className="font-medium">Page Explorer</div>
      </div>
      <div className="mt-2 grid grid-cols-1 md:grid-cols-6 gap-2 items-end text-[11px]">
        <div className="md:col-span-4">
          <label className="block mb-1">Page URL</label>
          <input className="w-full border rounded px-2 py-1" placeholder="https://example.com/page" value={pageUrl} onChange={(e)=> setPageUrl(e.target.value)} />
        </div>
        <div className="md:col-span-2 flex gap-2">
          <button className="px-2 py-1 border rounded" disabled={busy} onClick={explore}>Explore Page</button>
          <button className="px-2 py-1 border rounded" onClick={()=>{ setPageUrl(''); setPageOut(null); }}>Clear</button>
        </div>
      </div>
      {!!(structured) && (
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <button className="px-2 py-1 border rounded" onClick={()=> setShowJson(v=>!v)}>{showJson? 'Hide JSON' : 'Show JSON'}</button>
          <button className="px-2 py-1 border rounded" onClick={async()=>{
            try { await navigator.clipboard.writeText(JSON.stringify(structured, null, 2)); } catch {}
          }}>Copy JSON</button>
          <button className="px-2 py-1 border rounded" onClick={()=>{
            try {
              const blob = new Blob([JSON.stringify(structured, null, 2)], { type: 'application/json' });
              const a = document.createElement('a');
              const u = window.URL.createObjectURL(blob);
              a.href = u;
              const host = (()=>{ try { return new URL(pageOut.url).hostname.replace(/[^a-z0-9.-]/gi,'_'); } catch { return 'page'; } })();
              a.download = `page-explore-${host}.json`;
              document.body.appendChild(a);
              a.click();
              setTimeout(()=>{ try { document.body.removeChild(a); } catch {}; try { window.URL.revokeObjectURL(u); } catch {}; }, 0);
            } catch {}
          }}>Download JSON</button>
        </div>
      )}
      {!!pageOut && (
        <div className="mt-2 border rounded p-2 bg-gray-50">
          {!pageOut.ok && (
            <div className="text-red-600">{pageOut.error||'explore_failed'}</div>
          )}
          {pageOut.ok && (
            <div>
              {showJson && structured && (
                <pre className="text-[11px] whitespace-pre-wrap break-all bg-white border rounded p-2 mb-2 max-h-64 overflow-auto">{JSON.stringify(structured, null, 2)}</pre>
              )}
              <div className="text-gray-700 mb-1">Type: <span className="font-medium">{pageOut.page_type}</span></div>
              <div className="text-gray-700 mb-1">URL: <span className="break-all">{pageOut.url}</span></div>
              {!!(pageOut.debug) && (
                <div className="text-gray-500 mb-1 text-[11px]">Variants: {pageOut.debug.variant_count||0} · Source: {pageOut.debug.variant_source||'none'}{pageOut.debug.handle? ` · Handle: ${pageOut.debug.handle}`: ''}</div>
              )}
              {!!(pageOut.meta||{}).title && (<div className="text-gray-700 mb-1">Title: {pageOut.meta.title}</div>)}
              {!!(pageOut.meta||{}).description && (<div className="text-gray-700 mb-1">Description: {pageOut.meta.description}</div>)}
              {!!(pageOut.meta||{}).canonical && (<div className="text-gray-700 mb-1">Canonical: <span className="break-all">{pageOut.meta.canonical}</span></div>)}
              {pageOut.page_type==='product' && !!pageOut.product && (
                <div className="mt-2">
                  <div className="font-medium">Product</div>
                  <div>Name: {pageOut.product.name||''}</div>
                  <div>Price: {pageOut.product.price||''} {pageOut.product.currency||''}</div>
                  <div>SKU: {pageOut.product.sku||''}</div>
                  {!!(pageOut.product.images||[]).length && (<div>Images: {pageOut.product.images.slice(0,3).map((u,i)=>(<span key={i} className="break-all">{u}{i<Math.min(2,pageOut.product.images.length-1)?', ':''}</span>))}</div>)}
                  {!!(pageOut.product.variants||[]).length && (
                    <div className="mt-2">
                      <div className="font-medium">Variants ({pageOut.product.variants.length})</div>
                      <div className="text-[11px] space-y-0.5">
                        {pageOut.product.variants.map((v,i)=>(
                          <div key={v.id||i} className="break-all">
                            {v.title||''} {v.sku? `· ${v.sku}`:''} {v.price? `· ${v.price}`:''} {v.url? (<a className="text-blue-600 underline" href={v.url} target="_blank" rel="noreferrer">variant</a>): null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!!(pageOut.links_sample||[]).length && (
                <div className="mt-2">
                  <div className="font-medium mb-1">Links (sample)</div>
                  <div className="text-[11px] space-y-0.5">{pageOut.links_sample.slice(0,15).map((u,i)=>(<div key={i} className="break-all">{u}</div>))}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
