import React from 'react';

export default function ExtractionConfigPanel(props) {
  // Accept a ctx prop to minimize prop plumbing from Main.jsx; fallback to explicit props for compatibility
  const ctx = props?.ctx;
  const activeDomain = ctx ? (ctx.activeDomain || '') : (props.activeDomain || '');
  const exType = ctx ? (ctx.exType) : props.exType;
  const setExType = ctx ? (ctx.setExType || (()=>{})) : (props.setExType || (()=>{}));
  const exBusy = ctx ? !!ctx.exBusy : !!props.exBusy;
  const setExBusy = ctx ? (ctx.setExBusy || (()=>{})) : (props.setExBusy || (()=>{}));
  const exMsg = ctx ? (ctx.exMsg || '') : (props.exMsg || '');
  const setExMsg = ctx ? (ctx.setExMsg || (()=>{})) : (props.setExMsg || (()=>{}));
  const exText = ctx ? (ctx.exText || '') : (props.exText || '');
  const setExText = ctx ? (ctx.setExText || (()=>{})) : (props.setExText || (()=>{}));
  const exVersions = ctx ? (ctx.exVersions || []) : (props.exVersions || []);
  const setExVersions = ctx ? (ctx.setExVersions || (()=>{})) : (props.setExVersions || (()=>{}));
  const exSelVer = ctx ? (ctx.exSelVer || 0) : (props.exSelVer || 0);
  const setExSelVer = ctx ? (ctx.setExSelVer || (()=>{})) : (props.setExSelVer || (()=>{}));
  const exCopyMsg = ctx ? (ctx.exCopyMsg || '') : (props.exCopyMsg || '');
  const setExCopyMsg = ctx ? (ctx.setExCopyMsg || (()=>{})) : (props.setExCopyMsg || (()=>{}));
  const open = ctx ? !!(ctx.stepOpen?.[2]) : (props.open ?? true);
  const onToggle = ctx
    ? (() => { if (ctx.setStepOpen) ctx.setStepOpen(prev => ({ ...(prev||{}), 2: !prev?.[2] })); })
    : (props.onToggle || (()=>{}));
  const copyToClipboard = ctx ? (ctx.copyToClipboard || (async ()=>{})) : (props.copyToClipboard || (async ()=>{}));
  return (
    <div className="panel order-2">
      <div className="panel__header flex items-center justify-between">
        <span>Step 2: Extraction Configuration</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">Domain: <span className="font-mono">{activeDomain || '-'}</span></span>
          <span className="text-xs text-gray-600">Type: <span className="font-mono">{String(exType||'').toLowerCase()||'-'}</span></span>
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={async ()=>{
            if (!activeDomain) { setExMsg('Select a domain'); return; }
            setExBusy(true); setExMsg('');
            try {
              const r = await fetch(`/api/grabbing-sensorex/extraction/tools?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(exType)}&limit=50`, { credentials:'include' });
              const j = await r.json();
              if (r.ok && j?.ok) { setExVersions(Array.isArray(j.items)? j.items: []); }
              else setExMsg(j?.message||j?.error||'list_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>Refresh</button>
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={async ()=>{
            if (!activeDomain) { setExMsg('Select a domain'); return; }
            setExBusy(true); setExMsg(''); setExSelVer(0);
            try {
              const r = await fetch(`/api/grabbing-sensorex/extraction/tools/latest?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(exType)}`, { credentials:'include' });
              const j = await r.json();
              if (r.ok && j?.ok) { setExSelVer(Number(j.item?.version||0)); setExText(JSON.stringify(j.item?.config||{}, null, 2)); }
              else setExMsg(j?.message||j?.error||'latest_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>Load Latest</button>
          <button className="px-2 py-1 text-xs border rounded" onClick={onToggle} aria-expanded={!!open}>{open ? 'Collapse' : 'Expand'}</button>
        </div>
      </div>
      <div className="panel__body space-y-2" style={{ display: open ? undefined : 'none' }}>
        {exMsg && <div className="text-xs text-blue-700">{exMsg}</div>}
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Editor</div>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 rounded border text-xs"
              title="Insert a WooCommerce product extraction template (Sensorex-friendly)"
              onClick={()=>{
              const tpl = {
                  source: "woocommerce",
                  request: {
                    headers: {
                      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                      "Accept-Language": "en-US,en;q=0.9"
                    }
                  },
                  meta: {
                    title: [
                      "meta[property='og:title']@content",
                      "meta[name='twitter:title']@content",
                      "title"
                    ],
                    description: [
                      "meta[name='description']@content",
                      "meta[property='og:description']@content"
                    ]
                  },
                  images: {
                    limit: 24,
                    sources: [
                      ".woocommerce-product-gallery__wrapper a[href]@href",
                      "figure.woocommerce-product-gallery__image a[href]@href",
                      ".woocommerce-product-gallery__image img[data-large_image]@data-large_image",
                      ".woocommerce-product-gallery__image img[src]@src",
                      ".wp-post-image[src]@src",
                      "meta[property='og:image:secure_url']@content",
                      "meta[property='og:image']@content",
                      "link[rel='image_src']@href"
                    ],
                    download: true,
                    exclude_regex: [
                      "^(?:data:image)",
                      "%3Csvg",
                      "(?:^|[\\/._-])(logo|favicon|sprite|badge|placeholder|loading)(?:[\\/._-]|$)"
                    ]
                  },
                  json_ld: {
                    enabled: true,
                    selector: "script[type='application/ld+json']",
                    prefer_types: ["Product"],
                    map: {
                      mpn: "@.mpn",
                      name: "@.name",
                      brand: "@.brand.name||@.brand",
                      images: "@.image[].url||@.image[]||@.image",
                      description: "@.description",
                      "offers.price": "@.offers.price||@.offers[0].price||@.offers.lowPrice",
                      "offers.priceCurrency": "@.offers.priceCurrency||@.offers[0].priceCurrency||@.offers.priceCurrency"
                    }
                  },
                  product: {
                    sku: {
                      prefer: [
                        ".product_meta .sku",
                        "span.sku",
                        "meta[property='product:retailer_item_id']@content",
                        "meta[property='og:sku']@content"
                      ]
                    },
                    name: {
                      prefer: [
                        "meta[property='og:title']@content",
                        "meta[name='twitter:title']@content",
                        "h1.product_title",
                        ".product .entry-title",
                        ".summary .product_title"
                      ]
                    },
                    price: {
                      prefer: [
                        "meta[property='product:price:amount']@content",
                        ".summary .price .amount"
                      ],
                      normalize_cents_when_gt: 9999
                    },
                    category: {
                      prefer: [
                        "nav.woocommerce-breadcrumb a:nth-last-child(2)",
                        ".product_meta .posted_in a",
                        "a[href*='/product-category/']:last-child"
                      ]
                    },
                    currency: {
                      prefer: ["meta[property='product:price:currency']@content"],
                      default: "USD"
                    },
                    variant_skus: {
                      map: "@[].sku",
                      parse: "json",
                      unique: true,
                      selector: "form.variations_form@data-product_variations"
                    },
                    variants_items: {
                      map: "@[].{sku:@.sku,variation_id:@.variation_id,price:@.display_price,price_html:@.price_html,in_stock:@.is_in_stock,purchasable:@.is_purchasable,image_url:@.image.full_src||@.image.url||@.image.src,attributes:@.attributes}",
                      parse: "json",
                      selector: "form.variations_form@data-product_variations"
                    },
                    description_html: {
                      prefer: [
                        ".woocommerce-product-details__short-description",
                        "#tab-description",
                        ".woocommerce-Tabs-panel--description",
                        ".product .entry-content",
                        ".et_pb_text_inner"
                      ]
                    }
                  },
                  attributes: {
                    rows: ".woocommerce-product-attributes tr",
                    name: ".woocommerce-product-attributes-item__label",
                    value: ".woocommerce-product-attributes-item__value"
                  },
                  // Sections are extracted in backend with support for Divi accordions.
                  // Each entry may be a selector list or a toggle descriptor:
                  // { toggles: ".et_pb_accordion .et_pb_toggle", title: ".et_pb_toggle_title", content: ".et_pb_toggle_content", where: "Product Information" }
                  sections: {
                    product_information: {
                      toggles: ".et_pb_accordion .et_pb_toggle",
                      title: ".et_pb_toggle_title",
                      content: ".et_pb_toggle_content",
                      where: "Product Information"
                    },
                    parameters_applications: {
                      toggles: ".et_pb_accordion .et_pb_toggle",
                      title: ".et_pb_toggle_title",
                      content: ".et_pb_toggle_content",
                      // Match both “Parameters & Applications” and variants
                      where: "Parameters|Application"
                    },
                    technical_specifications: {
                      toggles: ".et_pb_accordion .et_pb_toggle",
                      title: ".et_pb_toggle_title",
                      content: ".et_pb_toggle_content",
                      where: "Technical Specification|Technical Specifications"
                    },
                    additional_information: {
                      toggles: ".et_pb_accordion .et_pb_toggle",
                      title: ".et_pb_toggle_title",
                      content: ".et_pb_toggle_content",
                      where: "Additional Information"
                    },
                    // Fallbacks when the site uses Woo tabs instead of Divi accordion
                    product_information_fallback: [
                      ".woocommerce-product-details__short-description",
                      "#tab-description",
                      ".woocommerce-Tabs-panel--description"
                    ],
                    technical_specification_fallback: [
                      ".woocommerce-product-attributes",
                      ".woocommerce-Tabs-panel--additional_information",
                      "#tab-additional_information"
                    ]
                  },
                  documents: {
                    download: true,
                    include_regex: ["\\.(?:pdf|docx?|xlsx?|zip)$"]
                  }
                };
                try { setExText(JSON.stringify(tpl, null, 2)); setExMsg('Inserted WooCommerce template'); } catch { setExMsg('Failed to insert template'); }
              }}
            >Insert WooCommerce template</button>
            <button className="px-2 py-1 rounded border text-xs" onClick={async ()=>{ await copyToClipboard(exText, setExCopyMsg); }}>Copy JSON</button>
            {exCopyMsg && <span className="text-xs text-gray-500">{exCopyMsg}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div>Versions:</div>
          <select value={exSelVer} onChange={(e)=>setExSelVer(Number(e.target.value||0))} className="border rounded px-2 py-1 text-xs">
            <option value={0}>[new version]</option>
            {(exVersions||[]).map(v => (
              <option key={v.id} value={v.version}>{v.version} {v.name?`- ${v.name}`:''}</option>
            ))}
          </select>
          <button className="px-2 py-1 rounded border text-xs" disabled={!exSelVer || exBusy} onClick={async ()=>{
            if (!activeDomain || !exSelVer) return;
            setExBusy(true); setExMsg('');
            try {
              const r = await fetch(`/api/grabbing-sensorex/extraction/tools/get?domain=${encodeURIComponent(activeDomain)}&page_type=${encodeURIComponent(exType)}&version=${encodeURIComponent(String(exSelVer))}`, { credentials:'include' });
              const j = await r.json();
              if (r.ok && j?.ok) { setExText(JSON.stringify(j.item?.config||{}, null, 2)); }
              else setExMsg(j?.message||j?.error||'load_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>Load</button>
          <button className="px-2 py-1 rounded border text-xs" disabled={!exSelVer || exBusy} onClick={async ()=>{
            if (!activeDomain || !exSelVer) return; setExBusy(true); setExMsg('');
            try {
              const r = await fetch('/api/grabbing-sensorex/extraction/tools', { method:'DELETE', headers: {'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: activeDomain, page_type: exType, version: exSelVer }) });
              const j = await r.json();
              if (r.ok && j?.ok) { setExMsg(`Deleted v${exSelVer}`); setExSelVer(0); }
              else setExMsg(j?.message||j?.error||'delete_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>Delete</button>
        </div>
        <textarea value={exText} onChange={(e)=>setExText(e.target.value)} className="w-full h-56 border rounded p-2 font-mono text-xs" placeholder={'{\n  "mappings": { }\n}'} />
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60" disabled={exBusy || !activeDomain} onClick={async ()=>{
            setExBusy(true); setExMsg('');
            try {
              let cfg = {};
              try { cfg = exText ? JSON.parse(exText) : {}; } catch (e) { setExMsg('Invalid JSON: '+(e?.message||e)); setExBusy(false); return; }
              // Always create a new version on save
              const body = { domain: activeDomain, page_type: exType, config: cfg };
              const r = await fetch('/api/grabbing-sensorex/extraction/tools', { method:'POST', headers: {'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
              const j = await r.json();
              if (r.ok && j?.ok) { setExMsg(`Saved v${j.item?.version||exSelVer||''}`); setExSelVer(Number(j.item?.version||exSelVer||0)); }
              else setExMsg(j?.message||j?.error||'save_failed');
            } catch (e) { setExMsg(String(e?.message||e)); }
            finally { setExBusy(false); }
          }}>{'Save new version'}</button>
        </div>
      </div>
    </div>
  );
}
