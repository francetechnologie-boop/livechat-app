// Build the payload expected by /api/presta/products/import from a prepared item
// prepared may be either the prepared row itself, or { item: prepared }
export function buildPrestaImportPayloadFromPrepared(prepared, pageUrl = '') {
  try {
    const item = (prepared && prepared.item) ? prepared.item : prepared || {};
    const mapped = item?.mapped || {};
    const meta = item?.meta || {};
    const localImgs = Array.isArray(item?.product_raw?.images_local) ? item.product_raw.images_local : [];
    const imgs = (localImgs.length
      ? localImgs.map(it => (it && (it.download_url || it.url || it.href)) || '').filter(Boolean)
      : (Array.isArray(mapped.images)
          ? mapped.images.map(it => (typeof it === 'string' ? it : (it && it.url) || '')).filter(Boolean)
          : []));
    const url = pageUrl || item?.url || meta?.url || '';
    // Merge variant attributes from raw if missing in mapped
    const mappedVars = Array.isArray(mapped.variants) ? mapped.variants.slice() : [];
    const rawVars = Array.isArray(item?.product_raw?.variants) ? item.product_raw.variants : [];
    if (mappedVars.length && rawVars.length) {
      const byKey = (v) => {
        const id = (v && (v.id != null)) ? String(v.id) : '';
        const sku = (v && v.sku) ? String(v.sku) : '';
        return `${id}#${sku}`;
      };
      const rawMap = new Map(rawVars.map(rv => [byKey(rv), rv]));
      for (const mv of mappedVars) {
        const rv = rawMap.get(byKey(mv));
        if (rv && !mv.attributes && rv.attributes) mv.attributes = rv.attributes;
        if (rv && !mv.url && rv.url) mv.url = rv.url;
        if (rv && !mv.image && rv.image) mv.image = rv.image;
        if (rv && (mv.price == null || (typeof mv.price === 'object' && mv.price.value == null))) {
          // Normalize raw price into number or keep mapped
          const n = Number(String(rv.price||'').replace(',', '.'));
          if (Number.isFinite(n)) mv.price = n;
        }
      }
    }
    // Determine default variant hints
    const defaultVariantId = (item?.product_raw && (item.product_raw.default_variant_id || item.product_raw.default_variant_id === 0)) ? item.product_raw.default_variant_id : undefined;
    const defaultVariantSkuRaw = (item?.product_raw && item.product_raw.default_variant_sku) ? String(item.product_raw.default_variant_sku) : undefined;
    const defaultVariantSku = defaultVariantSkuRaw || (mapped?.sku ? String(mapped.sku) : undefined);
    return {
      page: { url },
      meta: { url, title: item?.title || meta.title || '', image: (imgs && imgs[0]) || meta.og_image || '' },
      product: {
        name: mapped.name || item?.title || meta.title || 'Imported Product',
        description: mapped.description || meta.description || '',
        sku: mapped.sku || '',
        price: mapped.price || 0,
        currency: mapped.currency || '',
        images: imgs,
        variants: mappedVars,
        ...(defaultVariantId != null ? { default_variant_id: defaultVariantId } : {}),
        ...(defaultVariantSku ? { default_variant_sku: defaultVariantSku } : {}),
      }
    };
  } catch {
    return {
      page: { url: pageUrl || '' },
      meta: { url: pageUrl || '', title: '', image: '' },
      product: { name: 'Imported Product', description: '', sku: '', price: 0, currency: '', images: [], variants: [] }
    };
  }
}
