// Normalizer for result_json -> mapped structure for Presta transfers
function parsePrice(input) {
  try {
    if (input == null) return null;
    if (typeof input === 'number') return { value: input, currency: '' };
    const s = String(input).trim();
    if (!s) return null;
    const m = s.match(/([0-9]+(?:[\.,][0-9]+)?)\s*([A-Za-z]{3}|€|\$|Kč|zł|lei)?/);
    if (!m) return { value: Number(s.replace(/[^0-9\.\-]/g, '')) || null, currency: '' };
    const raw = m[1] || '';
    const val = Number(raw.replace(',', '.'));
    const curr = (m[2] || '').trim();
    return { value: Number.isFinite(val) ? val : null, currency: curr };
  } catch { return null; }
}

function mapProductForPresta(meta = {}, product = {}) {
  try {
    const out = { name: '', sku: '', price: null, currency: '', images: [], documents: [], description: '', variants: [] };
    out.name = String(product.name || meta.title || '').trim();
    out.sku = String(product.sku || product.reference || '').trim();
    const p = parsePrice(product.price);
    out.price = p ? p.value : null;
    out.currency = String(product.currency || (p ? p.currency : '') || '').trim();
    try { for (const it of (product.images || [])) { if (!it) continue; const url = typeof it === 'string' ? it : (it.url || it.src || it.href || ''); if (String(url || '').trim()) out.images.push({ url, alt: it.alt || it.title || '', position: it.position || it.index || null }); } } catch {}
    try {
      const docs = [];
      for (const d of (product.documents || product.docs || [])) { if (!d) continue; const url = d.url || d.href || d.download_url || ''; const label = d.text || d.label || ''; const file = d.file || ''; if (String(url || '').trim()) docs.push({ url, label, file, download_url: d.download_url || url }); }
      for (const it of (product.content || [])) { if (it && it.type === 'document' && (it.href || it.download_url)) { docs.push({ url: it.href || it.download_url, label: it.label || it.text || '', file: it.file || '', download_url: it.download_url || it.href }); } }
      out.documents = docs;
    } catch {}
    out.description = String(product.description || meta.description || meta.text_sample || '').trim();
    try { const vars = []; for (const v of (product.variants || [])) { if (!v) continue; const pv = parsePrice(v.price); vars.push({ id: v.id || null, sku: String(v.sku || '').trim(), title: v.title || '', price: pv, image: v.image || '' }); } out.variants = vars; } catch {}
    return out;
  } catch { return { name: '', sku: '', price: null, currency: '', images: [], documents: [], description: '', variants: [] }; }
}

export { mapProductForPresta };
