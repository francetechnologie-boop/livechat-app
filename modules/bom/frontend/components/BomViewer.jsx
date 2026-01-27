import React from 'react';
import BomTree from './BomTree.jsx';

export default function BomViewer({ orgId }) {
  const [boms, setBoms] = React.useState([]);
  const [bomId, setBomId] = React.useState('');
  const [q, setQ] = React.useState('');
  const [depth, setDepth] = React.useState(1);
  const [lines, setLines] = React.useState([]);
  const [aggregate, setAggregate] = React.useState([]);
  const [showTree, setShowTree] = React.useState(false);
  const headers = orgId ? { 'x-org-id': orgId } : {};

  React.useEffect(() => { (async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const res = await fetch(`/api/bom/boms?${params.toString()}`, { headers });
    const j = await res.json();
    if (j.ok) {
      const items = j.items || [];
      setBoms(items);
      // If current selection is not in the new list, clear selection
      if (items.length && bomId && !items.some(b => String(b.id) === String(bomId))) setBomId('');
    }
  })(); }, [orgId, q]);

  async function runExplode() {
    if (!bomId) return;
    const res = await fetch(`/api/bom/boms/${bomId}/explode?depth=${encodeURIComponent(depth)}&aggregate=1`, { headers });
    const j = await res.json(); if (j.ok) { setLines(j.lines || []); setAggregate(j.aggregate || []); }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <input className="border rounded px-2 py-1" placeholder="Search BOM by name..." value={q} onChange={(e)=>setQ(e.target.value)} />
        <select className="border rounded px-2 py-1" value={bomId} onChange={(e)=>setBomId(e.target.value)}>
          <option value="">Select BOM</option>
          {boms.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
        </select>
        <label className="text-sm">Depth</label>
        <input className="border rounded px-2 py-1 w-16" type="number" min="1" max="8" value={depth} onChange={(e)=>setDepth(Number(e.target.value)||1)} />
        <button className="border rounded px-3 py-1" onClick={runExplode}>Explode</button>
        <button className="border rounded px-3 py-1" onClick={()=>setShowTree(s=>!s)}>{showTree ? 'Hide tree' : 'Show tree'}</button>
      </div>

      {showTree && bomId && (
        <div className="mb-4"><BomTree orgId={orgId} bomId={bomId} maxDepth={depth} /></div>
      )}

      {aggregate.length > 0 && (
        <div className="mb-4">
          <div className="font-medium mb-1">Aggregate</div>
          <div className="max-h-48 overflow-auto border rounded">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50"><th className="text-left p-2">SKU</th><th className="text-left p-2">Name</th><th className="text-left p-2">Quantity</th></tr></thead>
              <tbody>
                {aggregate.map(a => (
                  <tr key={a.sku} className="border-t">
                    <td className="p-2">{a.sku}</td>
                    <td className="p-2">{a.name}</td>
                    <td className="p-2">{a.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lines.length > 0 && (
        <div>
          <div className="font-medium mb-1">Lines</div>
          <div className="max-h-60 overflow-auto border rounded">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50"><th className="text-left p-2">Lvl</th><th className="text-left p-2">SKU</th><th className="text-left p-2">Name</th><th className="text-left p-2">Qty</th><th className="text-left p-2">Ext Qty</th></tr></thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-2">{l.lvl}</td>
                    <td className="p-2">{l.sku}</td>
                    <td className="p-2">{l.name}</td>
                    <td className="p-2">{l.qty}</td>
                    <td className="p-2">{l.ext_qty}</td>
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
