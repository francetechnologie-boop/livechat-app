import React, { useCallback, useEffect, useMemo, useState } from 'react';

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

function formatDateYMD(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }
  return raw;
}

function SectionPanel({ label, isOpen, onToggle, headerActions, children }) {
  return (
    <div className="border rounded">
      <div className="p-3 border-b bg-gray-50 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1 text-sm font-semibold text-left"
          onClick={onToggle}
          aria-expanded={isOpen}
        >
          <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          <span>{label}</span>
        </button>
        {headerActions}
      </div>
      {isOpen && children}
    </div>
  );
}

export default function InventoryTransactionsPanel() {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [sectionOpen, setSectionOpen] = useState({
    entries: true,
    adjustments: true,
    recentEntries: true,
    recentAdjustments: true,
  });

  const [locations, setLocations] = useState(['default']);
  const [snapshotDate, setSnapshotDate] = useState(todayIso());

  // Entrées (PO lines)
  const [poQ, setPoQ] = useState('');
  const [poLines, setPoLines] = useState([]);
  const [poLoading, setPoLoading] = useState(false);
  const [entryLoc, setEntryLoc] = useState('default');
  const [poSort, setPoSort] = useState('delivery_date');
  const [poDir, setPoDir] = useState('asc');
  const [poFilter, setPoFilter] = useState({
    po_number: '',
    supplier_name: '',
    item_sku: '',
    status: '',
    delivery_date: '',
  });

  // Ajustements
  const [adjQ, setAdjQ] = useState('');
  const [itemOptions, setItemOptions] = useState([]);
  const [adjItem, setAdjItem] = useState('');
  const [adjLoc, setAdjLoc] = useState('default');
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const [history, setHistory] = useState({ entry: [], adjustment: [] });

  const toggleSection = useCallback((key) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  async function loadLocations() {
    try {
      const s = await api('/api/supply-planification/settings');
      const locs = Array.isArray(s?.settings?.locations) ? s.settings.locations.filter(Boolean) : [];
      const next = locs.length ? locs : ['default'];
      setLocations(next);
      setEntryLoc((prev) => (next.includes(prev) ? prev : next[0]));
      setAdjLoc((prev) => (next.includes(prev) ? prev : next[0]));
    } catch {}
  }

  async function loadPoLines() {
    setPoLoading(true);
    setError('');
    try {
      const url = `/api/supply-planification/inventory/po-lines?limit=200${poQ ? `&q=${encodeURIComponent(poQ)}` : ''}`;
      const r = await api(url);
      setPoLines(r.items || []);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setPoLoading(false);
    }
  }

  function togglePoSort(col) {
    if (poSort === col) setPoDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setPoSort(col);
      setPoDir('asc');
    }
  }

  const poLinesFiltered = useMemo(() => {
    const fPo = String(poFilter.po_number || '').trim().toLowerCase();
    const fSup = String(poFilter.supplier_name || '').trim().toLowerCase();
    const fSku = String(poFilter.item_sku || '').trim().toLowerCase();
    const fSt = String(poFilter.status || '').trim().toLowerCase();
    const fDel = String(poFilter.delivery_date || '').trim().toLowerCase();

    const out = (poLines || []).filter((l) => {
      if (fPo && !String(l.po_number || '').toLowerCase().includes(fPo)) return false;
      if (fSup && !String(l.supplier_name || '').toLowerCase().includes(fSup)) return false;
      if (fSku && !String(l.item_sku || '').toLowerCase().includes(fSku)) return false;
      if (fSt && !String(l.status || '').toLowerCase().includes(fSt)) return false;
      if (fDel && !String(l.delivery_date || l.po_date || '').toLowerCase().includes(fDel)) return false;
      return true;
    });

    const dirMul = poDir === 'desc' ? -1 : 1;
    const get = (l) => {
      if (poSort === 'po_number') return String(l.po_number || '');
      if (poSort === 'supplier_name') return String(l.supplier_name || '');
      if (poSort === 'item_sku') return String(l.item_sku || '');
      if (poSort === 'status') return String(l.status || '');
      if (poSort === 'rest') return Number(l.rest || 0);
      if (poSort === 'delivery_date') return String(l.delivery_date || l.po_date || '');
      return String(l.po_number || '');
    };
    out.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      const aEmpty = av == null || av === '';
      const bEmpty = bv == null || bv === '';

      // Always put empty dates/values last (especially for Delivery).
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dirMul;
      return String(av).localeCompare(String(bv)) * dirMul;
    });
    return out;
  }, [poLines, poFilter, poSort, poDir]);

  async function loadItemOptions(q) {
    try {
      const url = `/api/supply-planification/inventory/item-refs?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`;
      const r = await api(url);
      setItemOptions(r.items || []);
    } catch {}
  }

  async function loadHistory() {
    try {
      const [e, a] = await Promise.all([
        api('/api/supply-planification/inventory/transactions?kind=entry&limit=50'),
        api('/api/supply-planification/inventory/transactions?kind=adjustment&limit=50'),
      ]);
      setHistory({ entry: e.items || [], adjustment: a.items || [] });
    } catch {}
  }

  const itemDatalist = useMemo(() => {
    return (itemOptions || []).map((it) => ({ value: it.item_ref, label: `${it.item_ref} — ${it.description_short || ''}`.trim() }));
  }, [itemOptions]);

  async function addEntryFromPoLine(line) {
    setSaving(true);
    setError('');
    try {
      const qty = Number(String(line._add_qty || '').replace(/\s+/g, '').replace(',', '.'));
      if (!Number.isFinite(qty) || qty === 0) throw new Error('Invalid qty');
      await api('/api/supply-planification/inventory/transactions/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot_date: snapshotDate,
          lines: [{ po_line_id: line.po_line_id, qty, location_code: entryLoc }],
        }),
      });
      await loadHistory();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function addAdjustment() {
    setSaving(true);
    setError('');
    try {
      const item_ref = String(adjItem || '').trim();
      if (!item_ref) throw new Error('Missing item');
      const qty_delta = Number(String(adjQty || '').replace(/\s+/g, '').replace(',', '.'));
      if (!Number.isFinite(qty_delta) || qty_delta === 0) throw new Error('Invalid qty');
      await api('/api/supply-planification/inventory/transactions/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot_date: snapshotDate,
          items: [{ item_ref, qty_delta, location_code: adjLoc, reason: adjReason || null }],
        }),
      });
      setAdjQty('');
      setAdjReason('');
      await loadHistory();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadLocations();
    loadPoLines();
    loadHistory();
  }, []);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-semibold">Inventory transactions</div>
          <div className="text-xs text-gray-500">Entrées (from PO lines) + Ajustements (manual +/-). Each action creates a new inventory snapshot batch.</div>
        </div>
        <div className="flex gap-2 items-center">
          <input className="border rounded px-2 py-1 text-sm" type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} />
          <button className="px-3 py-1 rounded border text-sm" onClick={() => { loadPoLines(); loadHistory(); }} disabled={saving}>
            Reload
          </button>
        </div>
      </div>

      {error ? <div className="mb-3 text-sm text-red-600">{error}</div> : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionPanel
          label="1) Entrées (PO lines)"
          isOpen={sectionOpen.entries}
          onToggle={() => toggleSection('entries')}
          headerActions={
            <select className="ml-auto border rounded px-2 py-1 text-sm" value={entryLoc} onChange={(e) => setEntryLoc(e.target.value)}>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          }
        >
          <div className="p-3 flex gap-2 items-center">
            <input
              className="border rounded px-2 py-1 text-sm flex-1"
              placeholder="Search PO / item…"
              value={poQ}
              onChange={(e) => setPoQ(e.target.value)}
              onKeyDown={(e) => (e.key === 'Enter' ? loadPoLines() : null)}
            />
            <button className="px-3 py-1 rounded border text-sm" onClick={loadPoLines} disabled={poLoading || saving}>
              {poLoading ? 'Loading…' : 'Search'}
            </button>
          </div>
          <div className="overflow-auto">
            <table className="min-w-[820px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                    <button className="font-semibold" onClick={() => togglePoSort('po_number')}>
                      PO {poSort === 'po_number' ? (poDir === 'asc' ? '▲' : '▼') : ''}
                    </button>
                    <input
                      className="mt-1 w-full border rounded px-2 py-1 text-xs"
                      value={poFilter.po_number}
                      onChange={(e) => setPoFilter((p) => ({ ...p, po_number: e.target.value }))}
                      placeholder="filter…"
                    />
                  </th>
                  <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                    <button className="font-semibold" onClick={() => togglePoSort('supplier_name')}>
                      Supplier {poSort === 'supplier_name' ? (poDir === 'asc' ? '▲' : '▼') : ''}
                    </button>
                    <input
                      className="mt-1 w-full border rounded px-2 py-1 text-xs"
                      value={poFilter.supplier_name}
                      onChange={(e) => setPoFilter((p) => ({ ...p, supplier_name: e.target.value }))}
                      placeholder="filter…"
                    />
                  </th>
                  <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                    <button className="font-semibold" onClick={() => togglePoSort('item_sku')}>
                      Item {poSort === 'item_sku' ? (poDir === 'asc' ? '▲' : '▼') : ''}
                    </button>
                    <input
                      className="mt-1 w-full border rounded px-2 py-1 text-xs"
                      value={poFilter.item_sku}
                      onChange={(e) => setPoFilter((p) => ({ ...p, item_sku: e.target.value }))}
                      placeholder="filter…"
                    />
                  </th>
                  <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                    <button className="font-semibold" onClick={() => togglePoSort('delivery_date')}>
                      Delivery {poSort === 'delivery_date' ? (poDir === 'asc' ? '▲' : '▼') : ''}
                    </button>
                    <input
                      className="mt-1 w-full border rounded px-2 py-1 text-xs"
                      value={poFilter.delivery_date}
                      onChange={(e) => setPoFilter((p) => ({ ...p, delivery_date: e.target.value }))}
                      placeholder="YYYY-MM-DD…"
                    />
                  </th>
                  <th className="text-right p-2 sticky top-0 z-10 bg-gray-50">
                    <button className="font-semibold" onClick={() => togglePoSort('rest')}>
                      Rest {poSort === 'rest' ? (poDir === 'asc' ? '▲' : '▼') : ''}
                    </button>
                  </th>
                  <th className="text-left p-2 sticky top-0 z-10 bg-gray-50">
                    <button className="font-semibold" onClick={() => togglePoSort('status')}>
                      Status {poSort === 'status' ? (poDir === 'asc' ? '▲' : '▼') : ''}
                    </button>
                    <input
                      className="mt-1 w-full border rounded px-2 py-1 text-xs"
                      value={poFilter.status}
                      onChange={(e) => setPoFilter((p) => ({ ...p, status: e.target.value }))}
                      placeholder="filter…"
                    />
                  </th>
                  <th className="text-right p-2 sticky top-0 z-10 bg-gray-50">Add qty</th>
                  <th className="text-right p-2 sticky top-0 z-10 bg-gray-50"></th>
                </tr>
              </thead>
              <tbody>
                {poLinesFiltered.map((l) => (
                  <tr key={l.po_line_id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{l.po_number || ''}</td>
                    <td className="p-2 whitespace-nowrap">{l.supplier_name || ''}</td>
                    <td className="p-2">
                      <div className="font-mono text-xs">{l.item_sku || ''}</div>
                      <div className="text-xs text-gray-600">{l.item_name || ''}</div>
                    </td>
                    <td className="p-2 whitespace-nowrap">{formatDateYMD(l.delivery_date || l.po_date)}</td>
                    <td className="p-2 text-right">{fmt(l.rest)}</td>
                    <td className="p-2 whitespace-nowrap">{l.status || ''}</td>
                    <td className="p-2 text-right">
                      <input
                        className="w-24 border rounded px-2 py-1 text-sm text-right"
                        defaultValue={l.rest != null ? String(l.rest) : ''}
                        onChange={(e) => {
                          l._add_qty = e.target.value;
                        }}
                      />
                    </td>
                    <td className="p-2 text-right">
                      <button className="px-2 py-1 rounded bg-black text-white text-xs" onClick={() => addEntryFromPoLine(l)} disabled={saving}>
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
                {!poLines.length ? (
                  <tr>
                    <td className="p-3 text-gray-500" colSpan={8}>
                      No PO lines.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionPanel>

        <SectionPanel
          label="2) Ajustements (+ / -)"
          isOpen={sectionOpen.adjustments}
          onToggle={() => toggleSection('adjustments')}
          headerActions={
            <select className="ml-auto border rounded px-2 py-1 text-sm" value={adjLoc} onChange={(e) => setAdjLoc(e.target.value)}>
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          }
        >
          <div className="p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            <div className="md:col-span-3">
              <label className="text-xs text-gray-600">Item</label>
              <input
                className="w-full border rounded px-2 py-1 text-sm font-mono"
                list="sp-item-refs"
                value={adjItem}
                onChange={(e) => {
                  setAdjItem(e.target.value);
                  if (String(e.target.value).length >= 2) loadItemOptions(e.target.value);
                }}
                placeholder="IT-000019…"
              />
              <datalist id="sp-item-refs">
                {itemDatalist.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="md:col-span-1">
              <label className="text-xs text-gray-600">Qty delta</label>
              <input className="w-full border rounded px-2 py-1 text-sm text-right" value={adjQty} onChange={(e) => setAdjQty(e.target.value)} placeholder="+10 / -5" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-600">Reason</label>
              <input className="w-full border rounded px-2 py-1 text-sm" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="broken, audit, …" />
            </div>
            <div className="md:col-span-6 flex justify-end">
              <button className="px-3 py-1 rounded bg-black text-white text-sm" onClick={addAdjustment} disabled={saving}>
                Apply adjustment
              </button>
            </div>
          </div>
        </SectionPanel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <SectionPanel
          label="Recent entries"
          isOpen={sectionOpen.recentEntries}
          onToggle={() => toggleSection('recentEntries')}
        >
          <div className="overflow-auto">
            <table className="min-w-[700px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">When</th>
                  <th className="text-left p-2">Item</th>
                  <th className="text-left p-2">Loc</th>
                  <th className="text-right p-2">Qty</th>
                  <th className="text-left p-2">PO</th>
                </tr>
              </thead>
              <tbody>
                {(history.entry || []).map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2 whitespace-nowrap text-xs">{String(t.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                    <td className="p-2 font-mono text-xs">{t.item_ref}</td>
                    <td className="p-2 text-xs">{t.location_code}</td>
                    <td className="p-2 text-right">{fmt(t.qty_delta)}</td>
                    <td className="p-2 text-xs">{t.source_po_line_id ? `line#${t.source_po_line_id}` : ''}</td>
                  </tr>
                ))}
                {!history.entry?.length ? (
                  <tr>
                    <td className="p-3 text-gray-500" colSpan={5}>
                      No entries.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionPanel>

        <SectionPanel
          label="Recent adjustments"
          isOpen={sectionOpen.recentAdjustments}
          onToggle={() => toggleSection('recentAdjustments')}
        >
          <div className="overflow-auto">
            <table className="min-w-[700px] w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-2">When</th>
                  <th className="text-left p-2">Item</th>
                  <th className="text-left p-2">Loc</th>
                  <th className="text-right p-2">Qty</th>
                  <th className="text-left p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {(history.adjustment || []).map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2 whitespace-nowrap text-xs">{String(t.created_at || '').slice(0, 19).replace('T', ' ')}</td>
                    <td className="p-2 font-mono text-xs">{t.item_ref}</td>
                    <td className="p-2 text-xs">{t.location_code}</td>
                    <td className="p-2 text-right">{fmt(t.qty_delta)}</td>
                    <td className="p-2 text-xs">{t.reason || ''}</td>
                  </tr>
                ))}
                {!history.adjustment?.length ? (
                  <tr>
                    <td className="p-3 text-gray-500" colSpan={5}>
                      No adjustments.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionPanel>
      </div>
    </div>
  );
}
