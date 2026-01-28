import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../utils/api.js';

function normalizeMonths(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const yr = Number(r.year);
    const mo = Number(r.month);
    const idx = Number.isInteger(mo) ? mo - 1 : -1;
    const key = `${r.item || r.bom_name || 'n/a'}__${yr || 'n/a'}`;
    if (!map.has(key)) {
      map.set(key, {
        supplier: Array.isArray(r.suppliers) && r.suppliers.length ? r.suppliers[0] : '',
        suppliers: Array.isArray(r.suppliers) ? r.suppliers : [],
        item: r.item || r.bom_name || '—',
        reference: r.reference || '',
        description_short: r.description_short || '',
        description: r.description || '',
        year: yr || null,
        months: Array(12).fill(0),
      });
    }
    if (idx >= 0 && idx < 12) {
      const current = Number(map.get(key).months[idx] || 0);
      map.get(key).months[idx] = current + Number(r.units_sold || 0);
    }
  }
  const out = Array.from(map.values()).map((row) => {
    const total = row.months.reduce((acc, v) => acc + Number(v || 0), 0);
    const avg = row.months.length ? total / row.months.length : 0;
    return { ...row, total, avg };
  });
  return out;
}

export default function NeedsPerMonthPanel() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [params, setParams] = useState(null);
  const [filters, setFilters] = useState({
    years: 3,
    states: '2,3,4,5',
    shops: '',
    supplier: '',
    procurement: 'Stocké',
  });
  const [sort, setSort] = useState({ key: 'supplier', dir: 'asc' });
  const [textFilter, setTextFilter] = useState('');

  const grid = useMemo(() => normalizeMonths(rows), [rows]);
  const procurementOptions = useMemo(() => {
    const set = new Set();
    for (const r of rows || []) {
      const v = String(r.procurement_type || '').trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const search = new URLSearchParams();
      if (filters.years) search.set('years', filters.years);
      if (filters.states.trim()) search.set('states', filters.states.trim());
      if (filters.shops.trim()) search.set('shops', filters.shops.trim());
      if (filters.supplier.trim()) search.set('supplier', filters.supplier.trim());
      if (filters.procurement.trim()) search.set('procurement', filters.procurement.trim());
      const res = await api(`/api/supply-planification/needs/monthly?${search.toString()}`);
      setRows(res.rows || []);
      setParams(res.params || null);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <div className="text-xs text-gray-500">Years window (N, N-1...)</div>
          <input
            type="number"
            min={1}
            max={5}
            value={filters.years}
            onChange={(e) => setFilters((f) => ({ ...f, years: Number(e.target.value || 3) }))}
            className="border rounded px-2 py-1 text-sm w-24"
          />
        </div>
        <div>
          <div className="text-xs text-gray-500">Order states (comma)</div>
          <input
            type="text"
            value={filters.states}
            onChange={(e) => setFilters((f) => ({ ...f, states: e.target.value }))}
            className="border rounded px-2 py-1 text-sm w-40"
            placeholder="2,3,4,5"
          />
        </div>
        <div>
          <div className="text-xs text-gray-500">Shop IDs (comma)</div>
          <input
            type="text"
            value={filters.shops}
            onChange={(e) => setFilters((f) => ({ ...f, shops: e.target.value }))}
            className="border rounded px-2 py-1 text-sm w-32"
            placeholder="1,2"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs text-gray-500">Supplier filter</div>
          <input
            type="text"
            value={filters.supplier}
            onChange={(e) => setFilters((f) => ({ ...f, supplier: e.target.value }))}
            className="border rounded px-2 py-1 text-sm w-full"
            placeholder="Sensorex"
          />
        </div>
        <div>
          <div className="text-xs text-gray-500">Procurement</div>
          <select
            value={filters.procurement}
            onChange={(e) => setFilters((f) => ({ ...f, procurement: e.target.value }))}
            className="border rounded px-2 py-1 text-sm w-40"
          >
            <option value="">(all)</option>
            <option value="Stocké">Stocké</option>
            {procurementOptions
              .filter((p) => p !== 'Stocké')
              .map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs text-gray-500">Text filter (supplier/item/ref/desc)</div>
          <input
            type="text"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-full"
            placeholder="Search..."
          />
        </div>
        <button
          type="button"
          onClick={load}
          className="bg-black text-white px-3 py-2 rounded text-sm shadow-sm hover:bg-gray-800 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {params ? (
          <div className="text-xs text-gray-500">
            Start: {params.start_date} · Years: {params.years} · States: {params.states?.join(', ') || '—'} · Shops:{' '}
            {params.shops?.join(', ') || 'all'} · Procurement: {params.procurement_type || filters.procurement || '—'}
          </div>
        ) : null}
      </div>

      {error ? <div className="text-sm text-red-600">Failed: {error}</div> : null}

      <div className="overflow-auto max-h-[70vh] rounded border bg-white shadow-sm">
        <table className="min-w-[1200px] w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="text-xs uppercase text-gray-600">
              {[
                { key: 'supplier', label: 'Supplier', align: 'text-left' },
                { key: 'item', label: 'Item', align: 'text-left' },
                { key: 'reference', label: 'Reference', align: 'text-left' },
                { key: 'description', label: 'Description', align: 'text-left' },
                { key: 'description_short', label: 'Desc. short', align: 'text-left' },
              ].map((col) => (
                <th
                  key={col.key}
                  className={`px-2 py-2 ${col.align} cursor-pointer select-none`}
                  onClick={() =>
                    setSort((prev) =>
                      prev.key === col.key
                        ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                        : { key: col.key, dir: 'asc' }
                    )
                  }
                >
                  {col.label}
                  {sort.key === col.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th className="px-2 py-2 text-center">Year</th>
              {Array.from({ length: 12 }).map((_, idx) => (
                <th key={idx} className="px-2 py-2 text-right">
                  {idx + 1}
                </th>
              ))}
              <th className="px-2 py-2 text-right cursor-pointer select-none" onClick={() => setSort((prev) => ({
                key: 'total',
                dir: prev.key === 'total' && prev.dir === 'asc' ? 'desc' : 'asc',
              }))}>
                Total{sort.key === 'total' ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th className="px-2 py-2 text-right cursor-pointer select-none" onClick={() => setSort((prev) => ({
                key: 'avg',
                dir: prev.key === 'avg' && prev.dir === 'asc' ? 'desc' : 'asc',
              }))}>
                Avg{sort.key === 'avg' ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {(grid
              .filter((row) => {
                const needle = textFilter.trim().toLowerCase();
                if (!needle) return true;
                const hay = [
                  row.supplier,
                  row.item,
                  row.reference,
                  row.description_short,
                ]
                  .map((v) => String(v || '').toLowerCase())
                  .join(' ');
                return hay.includes(needle);
              })
              .sort((a, b) => {
                const dirMul = sort.dir === 'desc' ? -1 : 1;
                const getVal = (row) => {
                  if (sort.key === 'total' || sort.key === 'avg') return Number(row[sort.key] || 0);
                  if (sort.key === 'year') return Number(row.year || 0);
                  return String(row[sort.key] || '');
                };
                const av = getVal(a);
                const bv = getVal(b);
                if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMul;
                return String(av).localeCompare(String(bv)) * dirMul;
              }) || []
            ).map((row, idx) => (
              <tr key={`${row.item}-${row.year}-${idx}`} className={idx % 2 ? 'bg-gray-50' : ''}>
                <td className="px-2 py-2">{row.supplier || '—'}</td>
                <td className="px-2 py-2 font-mono text-xs">{row.item}</td>
                <td className="px-2 py-2 font-mono text-xs">{row.reference || '—'}</td>
                <td className="px-2 py-2">{row.description}</td>
                <td className="px-2 py-2">{row.description_short || '—'}</td>
                <td className="px-2 py-2 text-center">{row.year ?? '—'}</td>
                {row.months.map((v, i) => (
                  <td key={i} className={`px-2 py-2 text-right ${v < 0 ? 'text-red-600' : ''}`}>
                    {Number(v).toLocaleString()}
                  </td>
                ))}
                <td className="px-2 py-2 text-right font-semibold">{row.total.toLocaleString()}</td>
                <td className="px-2 py-2 text-right text-gray-700">{row.avg.toFixed(1)}</td>
              </tr>
            ))}
            {grid.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-center text-gray-500" colSpan={19}>
                  {loading ? 'Loading…' : 'No data for this window.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-gray-500">
        Built from Prestashop orders (`ps_orders.date_add`) keyed on BOM name (`mod_bom_boms.name`). Buckets use Europe/Prague
        time. Use filters above to limit states/shops/suppliers or the year window (N, N-1, N-2).
      </div>
    </div>
  );
}
