import React, { useEffect, useMemo, useState } from 'react';

import { api } from '../utils/api.js';

function todayIso() {
  try {
    return new Date().toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function fmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return x.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export default function InventoryTablePanel() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fItem, setFItem] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fProcurement, setFProcurement] = useState('Stocké');
  const [sort, setSort] = useState('item_ref');
  const [dir, setDir] = useState('asc');
  const [snapshotDate, setSnapshotDate] = useState(todayIso());
  const [locations, setLocations] = useState(['default']);
  const [items, setItems] = useState([]);
  const [baseline, setBaseline] = useState(new Map()); // item_ref -> { loc -> value }

  const procurementOptions = useMemo(() => {
    const set = new Set();
    for (const it of items) {
      const v = String(it.procurement_type || '').trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const qSupplier = String(fSupplier || '').trim().toLowerCase();
    const qItem = String(fItem || '').trim().toLowerCase();
    const qDesc = String(fDesc || '').trim().toLowerCase();
    const qProc = String(fProcurement || '').trim();
    const out = (items || []).filter((it) => {
      if (qSupplier && !String(it.supplier || '').toLowerCase().includes(qSupplier)) return false;
      if (qItem && !String(it.item_ref || '').toLowerCase().includes(qItem)) return false;
      if (qDesc && !String(it.description_short || '').toLowerCase().includes(qDesc)) return false;
      if (qProc && String(it.procurement_type || '').trim() !== qProc) return false;
      return true;
    });

    const dirMul = dir === 'desc' ? -1 : 1;
    const get = (it) => {
      if (sort === 'supplier') return String(it.supplier || '');
      if (sort === 'procurement_type') return String(it.procurement_type || '');
      if (sort === 'description_short') return String(it.description_short || '');
      if (sort === 'date_of_last_inventory') return String(it.date_of_last_inventory || '');
      if (sort === 'qty_total') return Number(it.qty_total || 0);
      return String(it.item_ref || '');
    };
    out.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMul;
      return String(av).localeCompare(String(bv)) * dirMul;
    });
    return out;
  }, [items, fSupplier, fItem, fDesc, fProcurement, sort, dir]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const url = `/api/supply-planification/inventory/items?limit=5000${q ? `&q=${encodeURIComponent(q)}` : ''}`;
      const r = await api(url);
      setLocations(Array.isArray(r.locations) && r.locations.length ? r.locations : ['default']);
      setItems(Array.isArray(r.items) ? r.items : []);
      const nextBaseline = new Map();
      for (const it of (r.items || [])) {
        nextBaseline.set(it.item_ref, { ...(it.qty_by_location || {}) });
      }
      setBaseline(nextBaseline);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  function toggleSort(col) {
    if (sort === col) setDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(col);
      setDir('asc');
    }
  }

  function setCell(itemRef, loc, value) {
    setItems((prev) =>
      prev.map((it) => {
        if (it.item_ref !== itemRef) return it;
        const next = { ...it, qty_by_location: { ...(it.qty_by_location || {}) } };
        next.qty_by_location[loc] = value;
        return next;
      })
    );
  }

  function computeChanges() {
    const changes = [];
    for (const it of items) {
      const base = baseline.get(it.item_ref) || {};
      const nextByLoc = it.qty_by_location || {};
      let changed = false;
      const payloadByLoc = {};
      for (const loc of locations) {
        if (nextByLoc[loc] === undefined) continue;
        const raw = String(nextByLoc[loc] ?? '').trim();
        const baseRaw = String(base[loc] ?? '').trim();
        if (raw !== baseRaw) {
          changed = true;
        }
        payloadByLoc[loc] = raw;
      }
      if (changed) changes.push({ item_ref: it.item_ref, qty_by_location: payloadByLoc });
    }
    return changes;
  }

  async function save() {
    const changes = computeChanges();
    if (!changes.length) return;
    setSaving(true);
    setError('');
    try {
      await api('/api/supply-planification/inventory/items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot_date: snapshotDate, items: changes }),
      });
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-semibold">Inventory</div>
          <div className="text-xs text-gray-500">Edit quantities; saving creates a new snapshot batch.</div>
        </div>
        <div className="flex gap-2 items-center">
          <input
            className="border rounded px-2 py-1 text-sm"
            placeholder="Search item…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' ? load() : null)}
          />
          <input className="border rounded px-2 py-1 text-sm" type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} />
          <button className="px-3 py-1 rounded border text-sm" onClick={load} disabled={loading || saving}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <button className="px-3 py-1 rounded bg-black text-white text-sm" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error ? <div className="mb-3 text-sm text-red-600">{error}</div> : null}

      <div className="overflow-auto border rounded">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                <button className="font-semibold" onClick={() => toggleSort('supplier')}>
                  Supplier {sort === 'supplier' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </button>
                <input className="mt-1 w-full border rounded px-2 py-1 text-xs" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)} placeholder="filter…" />
              </th>
              <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                <button className="font-semibold" onClick={() => toggleSort('item_ref')}>
                  ITEM {sort === 'item_ref' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </button>
                <input className="mt-1 w-full border rounded px-2 py-1 text-xs" value={fItem} onChange={(e) => setFItem(e.target.value)} placeholder="filter…" />
              </th>
              <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                <button className="font-semibold" onClick={() => toggleSort('description_short')}>
                  Description {sort === 'description_short' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </button>
                <input className="mt-1 w-full border rounded px-2 py-1 text-xs" value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="filter…" />
              </th>
              <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                <button className="font-semibold" onClick={() => toggleSort('procurement_type')}>
                  Procurement {sort === 'procurement_type' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </button>
                <select className="mt-1 w-full border rounded px-2 py-1 text-xs" value={fProcurement} onChange={(e) => setFProcurement(e.target.value)}>
                  <option value="">(all)</option>
                  <option value="Stocké">Stocké</option>
                  <option value="Acheté sur commande">Acheté sur commande</option>
                  {procurementOptions
                    .filter((v) => v !== 'Acheté sur commande' && v !== 'Stocké')
                    .map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                </select>
              </th>
              <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                <button className="font-semibold" onClick={() => toggleSort('date_of_last_inventory')}>
                  Last inv date {sort === 'date_of_last_inventory' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </button>
              </th>
              <th className="text-right p-2 sticky top-0 z-10 bg-gray-50">
                <button className="font-semibold" onClick={() => toggleSort('qty_total')}>
                  Total {sort === 'qty_total' ? (dir === 'asc' ? '▲' : '▼') : ''}
                </button>
              </th>
              {locations.map((loc) => (
                <th key={loc} className="text-right p-2 sticky top-0 z-10 bg-gray-50">
                  {loc}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => (
              <tr key={it.item_ref} className="border-t">
                <td className="p-2 whitespace-nowrap">{it.supplier || ''}</td>
                <td className="p-2 whitespace-nowrap font-mono text-xs">{it.item_ref}</td>
                <td className="p-2">{it.description_short || ''}</td>
                <td className="p-2 whitespace-nowrap">{it.procurement_type || ''}</td>
                <td className="p-2 whitespace-nowrap">{it.date_of_last_inventory || ''}</td>
                <td className="p-2 text-right">{fmt(it.qty_total)}</td>
                {locations.map((loc) => (
                  <td key={loc} className="p-2 text-right">
                    <input
                      className="w-24 border rounded px-2 py-1 text-sm text-right"
                      value={(it.qty_by_location && it.qty_by_location[loc] != null) ? String(it.qty_by_location[loc]) : ''}
                      onChange={(e) => setCell(it.item_ref, loc, e.target.value)}
                      placeholder="—"
                    />
                  </td>
                ))}
              </tr>
            ))}
            {!filtered.length ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan={6 + locations.length}>
                  No items.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
