import React, { useEffect, useState } from 'react';

import { api } from '../utils/api.js';

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return x.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export default function BoardPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [coverageDays, setCoverageDays] = useState(220);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const url = `/api/supply-planification/board?limit=500${q ? `&q=${encodeURIComponent(q)}` : ''}`;
      const r = await api(url);
      setItems(r.items || []);
      setCoverageDays(Number(r.coverage_days || 220));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-semibold">Board</div>
          <div className="text-xs text-gray-500">Latest snapshot per item (coverage: {coverageDays} days).</div>
        </div>
        <div className="flex gap-2 items-center">
          <input
            className="border rounded px-2 py-1 text-sm"
            placeholder="Search item…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' ? load() : null)}
          />
          <button className="px-3 py-1 rounded border text-sm" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
        </div>
      </div>

      {error ? <div className="mb-3 text-sm text-red-600">{error}</div> : null}

      <div className="overflow-auto border rounded">
        <table className="min-w-[1000px] w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2">Supplier</th>
              <th className="text-left p-2">ITEM (supplier ref)</th>
              <th className="text-left p-2">Description</th>
              <th className="text-left p-2">Last inv date</th>
              <th className="text-right p-2">Qty last inv</th>
              <th className="text-right p-2">Estimated inv</th>
              <th className="text-left p-2">Locations</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-t">
                <td className="p-2 whitespace-nowrap">{it.supplier || ''}</td>
                <td className="p-2 whitespace-nowrap font-mono text-xs">{it.supplier_reference || ''}</td>
                <td className="p-2">{it.description_short || ''}</td>
                <td className="p-2 whitespace-nowrap">{it.date_of_last_inventory || ''}</td>
                <td className="p-2 text-right">{fmt(it.qty_last_inventory)}</td>
                <td className="p-2 text-right">{fmt(it.estimated_inventory)}</td>
                <td className="p-2 text-xs">
                  {Array.isArray(it.locations)
                    ? it.locations.map((l) => `${l.location_code}:${fmt(l.qty)}`).join(' · ')
                    : ''}
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan={7}>
                  No items. Set inventory first (Inventory tab).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
