import React from 'react';

const DEFAULT_TARGETS = [
  { key: 'item_code', label: 'Item code' },
  { key: 'supplier_item_code', label: 'Supplier item code' },
  { key: 'catalog_price', label: 'Catalog (raw)' },
  { key: 'price', label: 'Price (raw)' },
  { key: 'discount', label: 'Discount' },
  { key: 'net', label: 'Net cost' },
  { key: 'currency', label: 'Currency' },
  { key: 'moq', label: 'MOQ' },
  { key: 'lead_time_days', label: 'Lead time (days)' },
  { key: 'effective_at', label: 'Effective at (date)' },
  { key: 'name', label: 'Name' },
  { key: 'reference', label: 'Reference' },
  { key: 'description', label: 'Description' },
  { key: 'description_short', label: 'Description (short)' },
  { key: 'unit', label: 'Unit' },
];

export default function VendorImportPanel({ orgId }) {
  const [vendor, setVendor] = React.useState('');
  const [supplierId, setSupplierId] = React.useState('');
  const [text, setText] = React.useState('');
  const [mode, setMode] = React.useState('auto');
  const [delimiter, setDelimiter] = React.useState('auto');
  const [decimalComma, setDecimalComma] = React.useState(false);
  const [map, setMap] = React.useState({});
  const [defaultCurrency, setDefaultCurrency] = React.useState('');
  const [sheetUrl, setSheetUrl] = React.useState('');
  const [sheetRange, setSheetRange] = React.useState('A:Z');
  const [priceMode, setPriceMode] = React.useState(() => {
    try { return localStorage.getItem('bomVendorPriceMode') || 'raw'; } catch { return 'raw'; }
  }); // net | discounted | raw
  const [preview, setPreview] = React.useState(null);
  const [stageRes, setStageRes] = React.useState(null);
  const [processRes, setProcessRes] = React.useState(null);
  const [staged, setStaged] = React.useState([]);
  const hasCatalogPrice = React.useMemo(() => {
    try { return Array.isArray(staged) && staged.some(r => Object.prototype.hasOwnProperty.call(r || {}, 'catalog_price')); } catch { return false; }
  }, [staged]);
  const [suppliers, setSuppliers] = React.useState([]);
  const headers = orgId ? { 'x-org-id': orgId } : {};

  React.useEffect(() => {
    try { localStorage.setItem('bomVendorPriceMode', priceMode); } catch {}
  }, [priceMode]);

  function setMapField(k, v) { setMap(prev => ({ ...prev, [k]: v })); }

  async function doPreview() {
    setPreview(null); setProcessRes(null); setStageRes(null);
    const body = {
      text,
      vendor: vendor || undefined,
      supplier_id: supplierId ? Number(supplierId) : undefined,
      mode: mode === 'auto' ? undefined : mode,
      delimiter: delimiter === 'auto' ? undefined : delimiter,
      decimalComma,
      map,
      defaultCurrency: defaultCurrency || undefined,
      priceMode,
    };
    const res = await fetch('/api/bom/import/vendors/preview', { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
    const j = await res.json(); setPreview(j);
  }

  async function doStage() {
    setStageRes(null); setProcessRes(null);
    const body = {
      text,
      vendor: vendor || undefined,
      supplier_id: supplierId ? Number(supplierId) : undefined,
      org_id: orgId || undefined,
      mode: mode === 'auto' ? undefined : mode,
      delimiter: delimiter === 'auto' ? undefined : delimiter,
      decimalComma,
      map,
      defaultCurrency: defaultCurrency || undefined,
      priceMode,
    };
    const res = await fetch('/api/bom/import/vendors/stage', { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
    const j = await res.json(); setStageRes(j); if (j.ok) loadStaged();
  }

  async function loadStaged() {
    const params = new URLSearchParams();
    params.set('status', 'pending');
    if (vendor) params.set('vendor', vendor);
    if (supplierId) params.set('supplier_id', supplierId);
    const res = await fetch(`/api/bom/import/vendors?${params}`, { headers });
    const j = await res.json(); if (j.ok) setStaged(j.items || []);
  }

  async function doProcess(dryRun = false) {
    setProcessRes(null);
    const body = { vendor: vendor || undefined, supplier_id: supplierId ? Number(supplierId) : undefined, org_id: orgId || undefined, dry_run: !!dryRun };
    const res = await fetch('/api/bom/import/vendors/process', { method:'POST', headers: { 'Content-Type':'application/json', ...headers }, body: JSON.stringify(body) });
    const j = await res.json(); setProcessRes(j); if (j.ok && !dryRun) loadStaged();
  }

  React.useEffect(()=>{ (async ()=>{
    try { const res = await fetch(`/api/bom/suppliers?limit=2000`, { headers }); const j = await res.json(); if (j.ok) setSuppliers(j.items || []); } catch {}
  })(); }, [orgId]);

  function handleFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setText(String(reader.result || '')); };
    reader.readAsText(f);
  }

  return (
    <div className="border rounded p-4">
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <select className="border rounded px-2 py-1" value={supplierId} onChange={(e)=>setSupplierId(e.target.value)}>
          <option value="">Select supplier</option>
          {suppliers.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
        <input className="border rounded px-2 py-1" placeholder="Vendor name (optional)" value={vendor} onChange={(e)=>setVendor(e.target.value)} />
        <select className="border rounded px-2 py-1" value={mode} onChange={(e)=>setMode(e.target.value)}>
          <option value="auto">Mode: auto</option>
          <option value="csv">CSV</option>
          <option value="tsv">TSV</option>
        </select>
        <select className="border rounded px-2 py-1" value={delimiter} onChange={(e)=>setDelimiter(e.target.value)}>
          <option value="auto">Delimiter: auto</option>
          <option value=",">Comma ,</option>
          <option value=";">Semicolon ;</option>
          <option value="\t">Tab \t</option>
        </select>
        <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={decimalComma} onChange={(e)=>setDecimalComma(e.target.checked)} /> decimal comma</label>
        <select className="border rounded px-2 py-1" value={priceMode} onChange={(e)=>setPriceMode(e.target.value)}>
          <option value="net">Price = Net cost</option>
          <option value="discounted">Price = Raw × (1 − Discount)</option>
          <option value="raw">Price = Raw</option>
        </select>
        <input className="border rounded px-2 py-1 w-28" placeholder="Default curr." value={defaultCurrency} onChange={(e)=>setDefaultCurrency(e.target.value)} />
        <button className="border rounded px-3 py-1" onClick={doPreview}>Preview</button>
        <button className="border rounded px-3 py-1" onClick={doStage}>Stage</button>
        <button className="border rounded px-3 py-1" onClick={()=>loadStaged()}>Load staged</button>
        <button className="border rounded px-3 py-1" onClick={()=>doProcess(true)}>Dry-run process</button>
        <button className="border rounded px-3 py-1" onClick={()=>doProcess(false)}>Process</button>
      </div>

      <div className="mb-3">
        <div className="flex items-center gap-2 mb-2">
          <input type="file" accept=".csv,.tsv,.txt" onChange={handleFile} />
          <button className="border rounded px-2 py-1" onClick={()=>setText('')}>Clear</button>
        </div>
        <textarea className="border rounded w-full h-40 p-2 font-mono" placeholder="Paste CSV/TSV here or upload a file above" value={text} onChange={(e)=>setText(e.target.value)} />
      </div>

      <div className="mb-3">
        <div className="font-medium mb-1">Field mapping</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: '200px 1fr' }}>
          {DEFAULT_TARGETS.map(t => (
            <React.Fragment key={t.key}>
              <label className="text-sm self-center">{t.label}</label>
              <input className="border rounded px-2 py-1" placeholder={`CSV header or =constant for ${t.label}`} value={map[t.key] || ''} onChange={(e)=>setMapField(t.key, e.target.value)} />
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <div className="font-medium mb-1">Load from Google Sheet</div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <input className="border rounded px-2 py-1 w-96" placeholder="Spreadsheet URL or ID" value={sheetUrl} onChange={(e)=>setSheetUrl(e.target.value)} />
          <input className="border rounded px-2 py-1 w-40" placeholder="Range (e.g., A:Z or Sheet1!A1:H)" value={sheetRange} onChange={(e)=>setSheetRange(e.target.value)} />
          <button className="border rounded px-3 py-1" onClick={async ()=>{
            try {
              const p = new URLSearchParams();
              if (sheetUrl) p.set('url', sheetUrl); else return;
              if (sheetRange) p.set('range', sheetRange);
              const res = await fetch(`/api/google-api/sheets/values.csv?${p.toString()}`);
              const txt = await res.text();
              if (txt) setText(txt);
            } catch {}
          }}>Load from Google</button>
        </div>
      </div>

      {preview && (
        <div className="mb-3 border rounded p-2">
          <div className="text-sm mb-2">Preview: {preview.ok ? `${preview.count} rows parsed` : `Error: ${preview.error || ''}`}</div>
          {preview.sample && preview.sample.length > 0 && (
            <div className="max-h-40 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-50">
                  <th className="p-1 text-left">#</th>
                  {DEFAULT_TARGETS.map(t => (<th key={t.key} className="p-1 text-left">{t.label}</th>))}
                </tr></thead>
                <tbody>
                  {preview.sample.map((r,i)=> (
                    <tr key={i} className="border-t">
                      <td className="p-1">{r.row_number}</td>
                      {DEFAULT_TARGETS.map(t => (<td key={t.key} className="p-1">{String(r.mapped?.[t.key] ?? '')}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {stageRes && (
        <div className="mb-3 text-sm">Stage result: {stageRes.ok ? `staged=${stageRes.staged}, skipped=${stageRes.skipped}` : `Error: ${stageRes.error}`}</div>
      )}

      {processRes && (
        <div className="mb-3 text-sm">Process result: {processRes.ok ? `processed=${processRes.processed}, createdItems=${processRes.createdItems}, linkedVendors=${processRes.linkedVendors}, addedPrices=${processRes.addedPrices}, errors=${processRes.errors}` : `Error: ${processRes.error}`}</div>
      )}

      {staged.length > 0 && (
        <div className="border rounded p-2">
          <div className="text-sm mb-2">Staged rows (pending): {staged.length}</div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50">
                <th className="p-1 text-left">ID</th>
                <th className="p-1 text-left">Item</th>
                <th className="p-1 text-left">Supplier</th>
                <th className="p-1 text-left">Vendor code</th>
                {hasCatalogPrice && <th className="p-1 text-left">Catalog (raw)</th>}
                <th className="p-1 text-left">Price</th>
                <th className="p-1 text-left">Curr.</th>
                <th className="p-1 text-left">MOQ</th>
                <th className="p-1 text-left">Lead</th>
                <th className="p-1 text-left">Date</th>
                <th className="p-1 text-left">Name</th>
                <th className="p-1 text-left">Description</th>
              </tr></thead>
              <tbody>
                {staged.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="p-1">{r.id}</td>
                    <td className="p-1">{r.item_code || ''}</td>
                    <td className="p-1">{r.supplier_name || ''}</td>
                    <td className="p-1">{r.supplier_item_code || ''}</td>
                    {hasCatalogPrice && <td className="p-1">{r.catalog_price ?? ''}</td>}
                    <td className="p-1">{r.price ?? ''}</td>
                    <td className="p-1">{r.currency || ''}</td>
                    <td className="p-1">{r.moq ?? ''}</td>
                    <td className="p-1">{r.lead_time_days ?? ''}</td>
                    <td className="p-1">{r.effective_at ? String(r.effective_at).slice(0, 10) : ''}</td>
                    <td className="p-1">{r.name || ''}</td>
                    <td className="p-1">{r.description || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
