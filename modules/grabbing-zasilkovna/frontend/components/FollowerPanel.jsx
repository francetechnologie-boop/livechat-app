import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function normalizeSortValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (value instanceof Date) return value.getTime();
  if (Object.prototype.toString.call(value) === '[object Date]') return value.getTime();
  return value;
}

const FILTER_KEYS = [
  { key: 'packet', label: 'Packet ID', field: 'packet_id' },
  { key: 'courier_tracking_number', label: 'Courier TN', field: 'courier_tracking_number' },
  { key: 'order_raw', label: 'Order raw', field: 'order_raw' },
  { key: 'id_order', label: 'Order ID', field: 'id_order' },
  { key: 'recipient_name', label: 'Recipient', field: 'recipient_name' },
  { key: 'recipient_surname', label: 'Surname', field: 'recipient_surname' },
  { key: 'phone', label: 'Phone', field: 'phone' },
  { key: 'email', label: 'Email', field: 'email' },
];

const HEADER_COLUMNS = [
  { key: 'packet_id', label: 'Packet' },
  { key: 'courier_tracking_number', label: 'Courier TN' },
  { key: 'order_raw', label: 'Order raw' },
  { key: 'id_order', label: 'Order ID' },
  { key: 'consigned_date', label: 'Consigned' },
  { key: 'recipient_name', label: 'Recipient' },
  { key: 'recipient_surname', label: 'Surname' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'status', label: 'Status' },
  { key: 'tracking_packeta_url', label: 'Packeta' },
  { key: 'tracking_external_url', label: 'External' },
  { key: 'updated_at', label: 'Updated' },
];

export default function FollowerPanel({
  configs = [],
  selected = '',
  setSelected = () => {},
  onRunAll,
  runBusy = false,
  runMsg = '',
  runResult = null,
}) {
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('id_order');
  const [sortDir, setSortDir] = useState('desc');
  const [copiedUrl, setCopiedUrl] = useState('');
  const copyTimer = useRef(null);
  const [columnFilters, setColumnFilters] = useState({
    packet: '',
    courier_tracking_number: '',
    order_raw: '',
    id_order: '',
    recipient_name: '',
    recipient_surname: '',
    phone: '',
    email: '',
  });

  const loadRows = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (onlyMissing) params.set('only_missing', '1');
      const resp = await fetch(`/api/grabbing-zasilkovna/tracking/latest?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) throw new Error(data?.message || data?.error || 'refresh_failed');
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (err) {
      setError(err?.message || 'Failed to load packets.');
    } finally {
      setBusy(false);
    }
  }, [onlyMissing]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (runResult) {
      loadRows();
    }
  }, [runResult, loadRows]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      return FILTER_KEYS.every(({ key, field }) => {
        const filterValue = String(columnFilters[key] || '').trim().toLowerCase();
        if (!filterValue) return true;
        const cellValue = String(row[field] || '').toLowerCase();
        return cellValue.includes(filterValue);
      });
    });
  }, [rows, columnFilters]);

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    list.sort((a, b) => {
      const rawA = normalizeSortValue(a[sortKey]);
      const rawB = normalizeSortValue(b[sortKey]);
      let result = 0;
      if (typeof rawA === 'number' && typeof rawB === 'number') {
        result = rawA - rawB;
      } else {
        result = String(rawA || '').localeCompare(String(rawB || ''));
      }
      if (sortDir === 'asc') return result;
      return -result;
    });
    return list;
  }, [filteredRows, sortKey, sortDir]);

  const missingCount = useMemo(() => sortedRows.filter((row) => !row.tracking_external_url).length, [sortedRows]);

  const copyToClipboard = useCallback(async (value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand?.('copy');
      document.body.removeChild(textarea);
    }
    setCopiedUrl(value);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedUrl(''), 1800);
  }, []);

  const formatDateTime = useCallback((value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Europe/Prague',
    }).format(date);
  }, []);

  const handleFilterChange = useCallback((key, value) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleHeaderSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  return (
    <div className="panel">
      <div className="panel__header">Packet follower</div>
      <div className="panel__body space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col text-xs text-gray-600">
            <label className="font-semibold">Config</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">-- Select config --</option>
              {configs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.id} — {config.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => onRunAll?.()}
            disabled={runBusy || !selected}
            className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-60"
          >
            {runBusy ? 'Running steps 1‑4…' : 'Run steps 1‑4'}
          </button>
          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(event) => setOnlyMissing(!!event.target.checked)}
            />
            Only missing tracking links
          </label>
          <button
            type="button"
            onClick={loadRows}
            disabled={busy}
            className="px-3 py-1 rounded border text-sm disabled:opacity-60"
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {(runMsg || runResult) && (
          <div className="text-xs text-gray-700 space-y-1">
            {runMsg && <div className="text-sm text-red-600">{runMsg}</div>}
            {runResult && runResult.import && (
              <div>
                All-in-one: total={runResult.import.total || 0} inserted={runResult.import.inserted || 0} updated={runResult.import.updated || 0} failed={runResult.import.failed || 0}
                {runResult.tracking ? (
                  <span>
                    {' '}
                    | tracking packeta={runResult.tracking.updated_packeta || 0} external={runResult.tracking.updated_external || 0}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        )}
        {error && <div className="text-xs text-red-600">{error}</div>}
        {missingCount > 0 && (
          <div className="text-xs text-red-600 font-semibold">
            {missingCount} packet{missingCount === 1 ? '' : 's'} missing external links.
          </div>
        )}
        <div
          className="overflow-auto max-h-[360px] border rounded"
          style={{ scrollbarGutter: 'stable' }}
        >
          {sortedRows.length === 0 ? (
            <div className="p-3 text-xs text-gray-500">{busy ? 'Loading packets…' : 'No packets found.'}</div>
          ) : (
            <table className="w-full text-[11px] border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-gray-600">
                  {HEADER_COLUMNS.map((column) => (
                    <th key={column.key} className="px-2 py-1 border-b border-gray-200">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left text-[11px] uppercase tracking-wide text-gray-500"
                        onClick={() => handleHeaderSort(column.key)}
                      >
                        <span className="font-semibold">{column.label}</span>
                        {sortKey === column.key && (
                          <span className="text-[10px] text-gray-400">
                            {sortDir === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
                <tr className="text-left text-gray-500 text-[10px]">
                  {HEADER_COLUMNS.map((column) => {
                    const filterDef = FILTER_KEYS.find((f) => f.field === column.key);
                    return (
                      <th key={`filter-${column.key}`} className="px-2 py-1 border-b border-gray-200">
                        {filterDef ? (
                          <input
                            type="search"
                            placeholder="Filter"
                            value={columnFilters[filterDef.key]}
                            onChange={(event) => handleFilterChange(filterDef.key, event.target.value)}
                            className="w-full border rounded px-2 py-1 text-[10px]"
                          />
                        ) : (
                          <span className="text-transparent">—</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={`${row.packet_id || row.order_raw}-${row.updated_at || ''}`} className="odd:bg-gray-50">
                    <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{row.packet_id || '-'}</td>
                    <td className="px-2 py-1 border-b border-gray-100 font-mono break-all">{row.courier_tracking_number || '-'}</td>
                    <td className="px-2 py-1 border-b border-gray-100 break-words">{row.order_raw || '-'}</td>
                    <td className="px-2 py-1 border-b border-gray-100 break-words">{row.id_order || '-'}</td>
                    <td className="px-2 py-1 border-b border-gray-100 break-words">{formatDateTime(row.consigned_date)}</td>
                    <td className="px-2 py-1 border-b border-gray-100 break-words">{row.recipient_name || '-'}</td>
                    <td className="px-2 py-1 border-b border-gray-100 break-words">{row.recipient_surname || '-'}</td>
                    <td className="px-2 py-1 border-b border-gray-100 break-words">{row.phone || '-'}</td>
                    <td className="px-2 py-1 border-b border-gray-100 break-words">{row.email || '-'}</td>
                    <td className="px-2 py-1 border-b border-gray-100">{row.status || '-'}</td>
                    <td className="px-2 py-1 border-b border-gray-100">
                      {row.tracking_packeta_url ? (
                        <a
                          className="text-indigo-600 hover:text-indigo-700 break-all inline-block"
                          href={row.tracking_packeta_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-red-600 font-semibold">Missing</span>
                      )}
                    </td>
                    <td className="px-2 py-1 border-b border-gray-100">
                      {row.tracking_external_url ? (
                        <div className="flex items-center gap-2">
                          <a
                            className="text-indigo-600 hover:text-indigo-700 break-all inline-block"
                            href={row.tracking_external_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View
                          </a>
                          <button
                            type="button"
                            className="px-1.5 py-0.5 border rounded text-[10px]"
                            onClick={() => copyToClipboard(row.tracking_external_url)}
                          >
                            Copy
                          </button>
                        </div>
                      ) : (
                        <span className="text-red-600 font-semibold">Missing</span>
                      )}
                    </td>
                    <td className="px-2 py-1 border-b border-gray-100 font-mono">
                      {formatDateTime(row.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="text-xs text-gray-500">
          Showing {sortedRows.length} packet{sortedRows.length === 1 ? '' : 's'} from the last three months. Packeta/external links and the status are refreshed from the tracking API.
          {copiedUrl && <span className="ml-2 text-green-600">Copied</span>}
        </div>
      </div>
    </div>
  );
}
