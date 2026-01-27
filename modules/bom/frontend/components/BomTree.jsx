import React from 'react';

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers });
  const j = await res.json();
  if (!res.ok || !j.ok) throw new Error(j?.message || j?.error || `HTTP_${res.status}`);
  return j;
}

async function findBomIdByName(name, headers) {
  const params = new URLSearchParams();
  params.set('q', name);
  const j = await fetchJson(`/api/bom/boms?${params}`, headers);
  const found = (j.items || []).find(b => String(b.name).toLowerCase().trim() === String(name).toLowerCase().trim());
  return found ? found.id : null;
}

function Node({ node, headers, depth = 0, maxDepth = 6 }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [children, setChildren] = React.useState([]);
  const [childBomId, setChildBomId] = React.useState(null);

  async function loadChildren() {
    if (loading || children.length || depth >= maxDepth) return;
    setLoading(true);
    try {
      // Resolve BOM by item SKU (BOM name == SKU)
      const bid = await findBomIdByName(node.sku, headers);
      setChildBomId(bid);
      if (!bid) return; // leaf
      const j = await fetchJson(`/api/bom/boms/${bid}/explode?depth=1&aggregate=0`, headers);
      const items = (j.lines || []).map(l => ({ sku: l.sku, name: l.name, description_short: l.description_short, quantity: l.qty, unit_price: l.unit_price, currency: l.currency }));
      setChildren(items);
    } catch {}
    finally { setLoading(false); }
  }

  const toggle = async () => {
    if (!open && children.length === 0) await loadChildren();
    setOpen(o => !o);
  };

  return (
    <div style={{ marginLeft: depth * 12 }}>
      <div className="flex items-center gap-2 py-0.5">
        {childBomId ? (
          <button className="border rounded px-1 text-xs" onClick={toggle}>{open ? '▾' : '▸'}</button>
        ) : (
          <span className="inline-block w-4" />
        )}
        <span className="text-xs text-gray-600">{node.qty != null ? `x${node.qty}` : ''}</span>
        <span className="font-mono text-sm">{node.sku}</span>
        <span className="text-sm">— {node.name || ''}</span>
        {node.description_short && <span className="text-xs text-gray-600">· {node.description_short}</span>}
        {node.unit_price != null && <span className="text-xs text-blue-700">· {node.unit_price} {node.currency || ''}</span>}
        {loading && <span className="text-xs text-gray-500">loading…</span>}
      </div>
      {open && children.length > 0 && (
        <div>
          {children.map((c, idx) => (
            <Node key={`${node.sku}_${idx}`} node={{ sku: c.sku, name: c.name, qty: c.quantity, description_short: c.description_short, unit_price: c.unit_price, currency: c.currency }} headers={headers} depth={depth+1} maxDepth={maxDepth} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BomTree({ orgId, bomId, maxDepth = 6 }) {
  const headers = orgId ? { 'x-org-id': orgId } : {};
  const [rootItems, setRootItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [totals, setTotals] = React.useState([]);
  const [totalPrice, setTotalPrice] = React.useState(null);
  const [totalCurrency, setTotalCurrency] = React.useState(null);

  React.useEffect(() => { (async () => {
    if (!bomId) { setRootItems([]); return; }
    setLoading(true);
    try {
      const j = await fetchJson(`/api/bom/boms/${bomId}/explode?depth=1&aggregate=0`, headers);
      const items = (j.lines || []).map(l => ({ sku: l.sku, name: l.name, description_short: l.description_short, quantity: l.qty, unit_price: l.unit_price, currency: l.currency }));
      setRootItems(items);
    } catch { setRootItems([]); }
    finally { setLoading(false); }
  })(); }, [bomId, orgId]);

  if (!bomId) return null;
  return (
    <div className="border rounded p-2">
      <div className="text-sm mb-2 flex items-center gap-2">
        <span>Tree view (lazy, expand sub-assemblies)</span>
        <button className="border rounded px-2 py-0.5 text-xs" onClick={async ()=>{
          try {
            const j = await fetchJson(`/api/bom/boms/${bomId}/explode?depth=${encodeURIComponent(maxDepth)}&aggregate=1`, headers);
            setTotals(j.totals_by_currency || []);
            setTotalPrice(j.total_price ?? null);
            setTotalCurrency(j.total_currency ?? null);
          } catch {}
        }}>Compute total</button>
        {totalPrice != null && <span className="text-xs text-blue-700">Total: {totalPrice} {totalCurrency || ''}</span>}
        {(!totalPrice && totals.length > 1) && <span className="text-xs text-blue-700">Totals: {totals.map(t=>`${t.total} ${t.currency}`).join(' · ')}</span>}
      </div>
      {loading ? <div className="text-xs text-gray-500">Loading…</div> : (
        <div>
          {rootItems.map((it, idx) => (
            <Node key={idx} node={{ sku: it.sku, name: it.name, qty: it.quantity, description_short: it.description_short, unit_price: it.unit_price, currency: it.currency }} headers={headers} depth={0} maxDepth={maxDepth} />
          ))}
        </div>
      )}
    </div>
  );
}
