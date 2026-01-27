import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { attachAdminHeaders } from './utils/adminHeaders.js';
import { loadModuleState, saveModuleState } from '@app-lib/uiState';
import EmailTemplatePreviewFrame from './components/EmailTemplatePreviewFrame.jsx';

function buildHeaders({ orgId, json = false } = {}) {
  const headers = {};
  const cleaned = String(orgId ?? '').trim();
  if (cleaned) headers['X-Org-Id'] = cleaned;
  if (json) headers['Content-Type'] = 'application/json';
  return attachAdminHeaders(headers);
}

function safeJson(resp) {
  return resp.json().catch(() => ({}));
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v.toFixed(2);
}

const EMPTY_LINE = { item_id: null, sku: '', name: '', qty: 1, unit: '', unit_price: '', currency: '' };
const DEFAULT_CONTACTS = {
  company: 'Ivana Gottvaldova',
  contact_name: 'Olivier Michaud',
  address: 'Dobrovodská 21, 370 06 České Budějovice',
  phone: '+420 602 429 381',
  email: 'francetechnologie@gmail.com',
};

function cloneLine(line) {
  return { ...(line || EMPTY_LINE) };
}

function formatDateForInput(date) {
  try {
    const d = new Date(date);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

const IMPORT_HEADER_ALIASES = {
  ponumber: 'po_number',
  ponumberlong: 'po_number_long',
  po_number_long: 'po_number_long',
  poline: 'po_line',
  line: 'po_line',
  dateorder: 'date_order',
  deliverydate: 'delivery_date',
  qty: 'qty',
  quantity: 'qty',
  unitprice: 'unit_price',
  unit_price: 'unit_price',
  currency: 'currency',
  vat_amount: 'vat_rate',
  vat: 'vat_rate',
  taxrate: 'vat_rate',
  vatcurrency: 'vat_currency',
  vendor: 'vendor',
  supplier: 'vendor',
  reference: 'reference',
  descriptionshort: 'description_short',
  description: 'description',
  itemcode: 'item_code',
  status: 'status',
  dateupdate: 'date_update',
  date_update: 'date_update',
  reste: 'rest',
  rest: 'rest',
  qtydelivered: 'qty_delivered',
  qty_delivered: 'qty_delivered',
  qtypartiel: 'qty_partial',
  qty_partiel: 'qty_partial',
  qty_partial: 'qty_partial',
  replan: 'replan_date',
  replan_date: 'replan_date',
  notes: 'notes',
};

function canonicalImportHeader(value) {
  const cleaned = String(value ?? '').toLowerCase().trim();
  if (!cleaned) return '';
  const compact = cleaned.replace(/[^a-z0-9]+/g, '');
  if (!compact) return '';
  return IMPORT_HEADER_ALIASES[compact] || compact;
}

function splitDelimitedText(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cell += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      continue;
    }
    cell += char;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cellValue) => String(cellValue ?? '').trim()));
}

function parseImportRows(text) {
  if (!text) return [];
  const withoutBom = text.replace(/^\uFEFF/, '');
  const sample = withoutBom.slice(0, 256);
  const delimiter = sample.includes('\t') ? '\t' : sample.includes(',') ? ',' : '\t';
  const rows = splitDelimitedText(withoutBom, delimiter);
  if (!rows.length) return [];
  const header = rows[0].map((cell) => canonicalImportHeader(cell));
  const dataRows = rows.slice(1);
  const parsed = dataRows
    .map((row) => {
      const entry = {};
      let hasValue = false;
      header.forEach((key, idx) => {
        if (!key) return;
        const value = row[idx] ?? '';
        entry[key] = value;
        if (String(value).trim()) hasValue = true;
      });
      return hasValue ? entry : null;
    })
    .filter((entry) => entry && (entry.po_number || entry.po_number_long));
  return parsed;
}

function computeDeliveryDateOffset(offsetWeeks = 0, baseDays = 21) {
  const date = new Date();
  const days = baseDays + (offsetWeeks || 0) * 7;
  date.setDate(date.getDate() + days);
  return formatDateForInput(date);
}

function toOrgInt(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export default function PurchaseOrder() {
  const [orgId, setOrgId] = useState(() => {
    try { return loadModuleState('tools_purchase_order')?.orgId ?? ''; } catch { return ''; }
  });

  const [deliveryOffsetWeeks, setDeliveryOffsetWeeks] = useState(() => {
    try {
      const saved = loadModuleState('tools_purchase_order')?.deliveryOffsetWeeks;
      const n = Number(saved);
      if (!Number.isFinite(n)) return 0;
      return Math.max(-1, Math.min(1, Math.trunc(n)));
    } catch {
      return 0;
    }
  });

  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [supplierItems, setSupplierItems] = useState([]);
  const [supplier, setSupplier] = useState(null);
  const [supplierContacts, setSupplierContacts] = useState([]);
  const [toEmail, setToEmail] = useState('');
  const [supplierCatalog, setSupplierCatalog] = useState([]);
  const [supplierCatalogLoading, setSupplierCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');

  const [ourInfo, setOurInfo] = useState(() => {
    try {
      return loadModuleState('tools_purchase_order')?.ourInfo || DEFAULT_CONTACTS;
    } catch {
      return DEFAULT_CONTACTS;
    }
  });

  const [lines, setLines] = useState(() => {
    try {
      const saved = loadModuleState('tools_purchase_order')?.lines;
      if (Array.isArray(saved) && saved.length) return saved;
    } catch {}
    return [cloneLine(EMPTY_LINE)];
  });

  const defaultDeliveryDate = useMemo(() => computeDeliveryDateOffset(deliveryOffsetWeeks), [deliveryOffsetWeeks]);

  const [itemSearchByIdx, setItemSearchByIdx] = useState({});
  const [itemResultsByIdx, setItemResultsByIdx] = useState({});
  const [itemLoadingByIdx, setItemLoadingByIdx] = useState({});

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState(null);

  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [draftResult, setDraftResult] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const [historyImportLoading, setHistoryImportLoading] = useState(false);
  const [historyImportResult, setHistoryImportResult] = useState(null);
  const [historyImportError, setHistoryImportError] = useState('');

  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [statusDrafts, setStatusDrafts] = useState({});
  const [statusSaving, setStatusSaving] = useState({});
  const [orderDeleting, setOrderDeleting] = useState({});
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [orderLinesMap, setOrderLinesMap] = useState({});
  const [orderLineLoading, setOrderLineLoading] = useState({});
  const [lineHistory, setLineHistory] = useState({});
  const [lineHistoryLoading, setLineHistoryLoading] = useState({});
  const [lineHistoryOpen, setLineHistoryOpen] = useState({});
  const [lineSaving, setLineSaving] = useState({});
  const [lineSaveNotice, setLineSaveNotice] = useState({});
  const lineSaveTimersRef = useRef({});
  const LINE_STATUS_OPTIONS = ['Waiting order confirmation', 'On going', 'Partially Delivered', 'Delivered', 'Canceled'];
  const [activeSection, setActiveSection] = useState('create');
  const STATUS_OPTIONS = ['draft', 'drafted', 'ordered', 'received', 'canceled'];
  const [visibleLimit, setVisibleLimit] = useState(50);
  const displayLimit = Math.max(1, Math.min(200, Number(visibleLimit) || 50));
  const [lineList, setLineList] = useState([]);
  const [lineListLoading, setLineListLoading] = useState(false);
  const [lineListError, setLineListError] = useState('');
  const [lineListQuery, setLineListQuery] = useState('');
  const [lineListLimit, setLineListLimit] = useState(800);
  const lineListQueryRef = useRef(lineListQuery);
  const [columnFilters, setColumnFilters] = useState({
    poNumber: '',
    itemRef: '',
    status: '',
  });
  const [sortField, setSortField] = useState('po_number');
  const [sortDir, setSortDir] = useState('desc');
  const [onlyActiveStatuses, setOnlyActiveStatuses] = useState(true);

  useEffect(() => {
    lineListQueryRef.current = lineListQuery;
  }, [lineListQuery]);

  useEffect(() => {
    try {
      saveModuleState('tools_purchase_order', { orgId, ourInfo, lines, deliveryOffsetWeeks });
    } catch {}
  }, [orgId, ourInfo, lines, deliveryOffsetWeeks]);

  useEffect(() => {
    return () => {
      try {
        const timers = lineSaveTimersRef.current || {};
        Object.values(timers).forEach((id) => {
          try {
            clearTimeout(id);
          } catch {}
        });
      } catch {}
    };
  }, []);

  const flashLineSaveNotice = useCallback((lineId, { ok, message }) => {
    if (!lineId) return;
    try {
      const currentTimers = lineSaveTimersRef.current || {};
      if (currentTimers[lineId]) {
        try {
          clearTimeout(currentTimers[lineId]);
        } catch {}
      }
      setLineSaveNotice((prev) => ({
        ...prev,
        [lineId]: { ok: !!ok, message: String(message || ''), at: Date.now() },
      }));
      currentTimers[lineId] = setTimeout(() => {
        setLineSaveNotice((prev) => {
          if (!prev[lineId]) return prev;
          const next = { ...prev };
          delete next[lineId];
          return next;
        });
        try {
          delete lineSaveTimersRef.current?.[lineId];
        } catch {}
      }, 2200);
      lineSaveTimersRef.current = currentTimers;
    } catch {}
  }, []);

  const fetchSuppliers = useCallback(async (queryValue = '') => {
    setSupplierLoading(true);
    try {
      const qs = new URLSearchParams();
      const cleaned = String(queryValue || '').trim();
      if (cleaned) qs.set('q', cleaned);
      qs.set('limit', '30');
      const resp = await fetch(`/api/bom/suppliers?${qs.toString()}`, {
        credentials: 'include',
        headers: buildHeaders({ orgId }),
      });
      const data = await safeJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setSupplierItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setSupplierItems([]);
    } finally {
      setSupplierLoading(false);
    }
  }, [orgId, displayLimit]);

  const searchSuppliers = useCallback(() => fetchSuppliers(supplierQuery), [fetchSuppliers, supplierQuery]);

  const loadSupplierItems = useCallback(
    async (supplierId, query = '') => {
      if (!supplierId) {
        setSupplierCatalog([]);
        return;
      }
      setSupplierCatalogLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set('supplier_id', String(supplierId));
        qs.set('limit', '50');
        qs.set('with_price', '1');
        if (String(query || '').trim()) qs.set('q', String(query || '').trim());
        const resp = await fetch(`/api/bom/items?${qs.toString()}`, {
          credentials: 'include',
          headers: buildHeaders({ orgId }),
        });
        const data = await safeJson(resp);
        if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
        setSupplierCatalog(Array.isArray(data.items) ? data.items : []);
      } catch {
        setSupplierCatalog([]);
      } finally {
        setSupplierCatalogLoading(false);
      }
    },
    [orgId]
  );

  const searchCatalogItems = useCallback(() => {
    if (!supplier?.id) return;
    loadSupplierItems(supplier.id, catalogSearch);
  }, [supplier, catalogSearch, loadSupplierItems]);

  const selectSupplier = useCallback(
    async (s) => {
      setSupplier(s || null);
      setSupplierContacts([]);
      setToEmail(String(s?.email || '').trim());
      if (!s?.id) {
        setSupplierCatalog([]);
        return;
      }
      try {
        const resp = await fetch(`/api/bom/suppliers/${Number(s.id)}/contacts`, { credentials: 'include', headers: buildHeaders({ orgId }) });
        const data = await safeJson(resp);
        if (resp.ok && data?.ok) {
          const contacts = Array.isArray(data.items) ? data.items : [];
          setSupplierContacts(contacts);
          const primary = contacts.find((c) => c?.is_primary && c?.email) || contacts.find((c) => c?.email);
          if (primary?.email) setToEmail(String(primary.email).trim());
        }
      } catch {}
      setCatalogSearch('');
      loadSupplierItems(s.id);
    },
    [orgId]
  );

  const adjustDeliveryOffset = (delta) => {
    setDeliveryOffsetWeeks((prev) => Math.max(-1, Math.min(1, prev + delta)));
  };

  const addLine = () => setLines((prev) => [...prev, { ...cloneLine(EMPTY_LINE), delivery_date: defaultDeliveryDate }]);
  const addCatalogLine = (item) => {
    setLines((prev) => [
      ...prev,
      {
        ...cloneLine(EMPTY_LINE),
        item_id: item?.id ?? null,
        sku: String(item?.sku || ''),
        name: String(item?.name || ''),
        unit: String(item?.uom || item?.unit || ''),
        currency: item?.vendor_price_currency || supplier?.currency || '',
        unit_price: item?.vendor_price != null ? item.vendor_price : '',
        reference: item?.reference || '',
        description_short: item?.description_short || '',
        description: item?.description || '',
        delivery_date: defaultDeliveryDate,
      },
    ]);
  };
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));
  const updateLine = (idx, patch) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const searchItems = useCallback(
    async (idx) => {
      const q = String(itemSearchByIdx[idx] || '').trim();
      if (!q) return;
      setItemLoadingByIdx((m) => ({ ...m, [idx]: true }));
      try {
        const qs = new URLSearchParams();
        qs.set('q', q);
        qs.set('limit', '20');
        const resp = await fetch(`/api/bom/items?${qs.toString()}`, { credentials: 'include', headers: buildHeaders({ orgId }) });
        const data = await safeJson(resp);
        if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
        setItemResultsByIdx((m) => ({ ...m, [idx]: Array.isArray(data.items) ? data.items : [] }));
      } catch {
        setItemResultsByIdx((m) => ({ ...m, [idx]: [] }));
      } finally {
        setItemLoadingByIdx((m) => ({ ...m, [idx]: false }));
      }
    },
    [itemSearchByIdx, orgId]
  );

  const pickItem = (idx, item) => {
    updateLine(idx, {
      item_id: item?.id ?? null,
      sku: String(item?.sku || ''),
      name: String(item?.name || ''),
      unit: String(item?.uom || item?.unit || ''),
      currency: String(item?.currency || ''),
    });
    setItemResultsByIdx((m) => ({ ...m, [idx]: [] }));
  };

  const payload = useMemo(() => {
    return {
      org_id: toOrgInt(orgId),
      supplier_id: supplier?.id ?? null,
      to_email: toEmail || null,
      supplier_snapshot: supplier || null,
      our_info: ourInfo,
      lines: lines
        .map((l) => ({
          item_id: l.item_id ?? null,
          sku: String(l.sku || ''),
          name: String(l.name || ''),
          qty: l.qty ?? 0,
          unit: String(l.unit || ''),
          unit_price: l.unit_price === '' || l.unit_price == null ? null : Number(l.unit_price),
          currency: String(l.currency || ''),
          delivery_date: l.delivery_date ? String(l.delivery_date) : null,
        }))
        .filter((l) => (l.item_id || l.sku || l.name) && Number(l.qty) > 0),
    };
  }, [lines, orgId, ourInfo, supplier, toEmail]);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const qs = new URLSearchParams();
      if (orgId.trim()) qs.set('org_id', orgId.trim());
      const safeLimit = displayLimit;
      qs.set('limit', String(safeLimit));
      const resp = await fetch(`/api/tools/purchase-orders?${qs.toString()}`, { credentials: 'include', headers: buildHeaders({ orgId }) });
      const data = await safeJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      const items = Array.isArray(data.items) ? data.items : [];
      setRecent(items);
      setStatusDrafts(items.reduce((acc, item) => {
        acc[item.id] = item.status || 'draft';
        return acc;
      }, {}));
    } catch {
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, [orgId, displayLimit]);

  const loadLinesForOrder = useCallback(async (orderId) => {
    if (!orderId) return;
    setSelectedOrderId(orderId);
    setOrderLinesMap((prev) => ({ ...prev, [orderId]: prev[orderId] || [] }));
    setOrderLineLoading((prev) => ({ ...prev, [orderId]: true }));
    try {
      const resp = await fetch(`/api/tools/purchase-orders/${orderId}`, { credentials: 'include', headers: buildHeaders({ orgId }) });
      const data = await safeJson(resp);
      if (resp.ok && data?.ok) {
        setOrderLinesMap((prev) => ({ ...prev, [orderId]: Array.isArray(data.lines) ? data.lines : [] }));
      } else {
        setOrderLinesMap((prev) => ({ ...prev, [orderId]: [] }));
      }
    } catch {
      setOrderLinesMap((prev) => ({ ...prev, [orderId]: [] }));
    } finally {
      setOrderLineLoading((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  }, [orgId]);

  const loadLineList = useCallback(async (searchQuery) => {
    setLineListLoading(true);
    setLineListError('');
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timerId = controller
      ? setTimeout(() => {
          try { controller.abort(); } catch {}
        }, 12000)
      : null;
    try {
      const limitValue = Math.max(5, Math.min(2000, Number(lineListLimit) || 800));
      const params = new URLSearchParams();
      params.set('limit', String(limitValue));
      const queryValue = searchQuery ?? lineListQueryRef.current ?? '';
      if (String(queryValue || '').trim()) {
        params.set('q', String(queryValue).trim());
      }
      const resp = await fetch(`/api/tools/purchase-orders/lines?${params.toString()}`, {
        credentials: 'include',
        headers: buildHeaders({ orgId }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const data = await safeJson(resp);
      if (!resp.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      }
      const normalized = (Array.isArray(data.lines) ? data.lines : []).map((row) => ({
        ...row,
        id: Number(row.line_id ?? row.id ?? 0),
      }));
      setLineList(normalized);
      setOrderLinesMap((prev) => {
        const next = { ...prev };
        normalized.forEach((line) => {
          const orderId = line.order_id;
          if (!orderId) return;
          const bucket = (next[orderId] || []).filter((existing) => existing.id !== line.id);
          bucket.push(line);
          bucket.sort((a, b) => (Number(a.line_no ?? 0) - Number(b.line_no ?? 0)));
          next[orderId] = bucket;
        });
        return next;
      });
    } catch (e) {
      setLineList([]);
      const msg = String(e?.name || '').toLowerCase() === 'aborterror'
        ? 'Request timed out (12s) – server did not respond.'
        : String(e?.message || e || 'Load failed');
      setLineListError(msg);
    } finally {
      if (timerId) {
        try { clearTimeout(timerId); } catch {}
      }
      setLineListLoading(false);
    }
  }, [lineListLimit, orgId]);

  const fetchLineHistory = useCallback(async (lineId) => {
    if (!lineId) return;
    setLineHistoryLoading((prev) => ({ ...prev, [lineId]: true }));
    try {
      const resp = await fetch(`/api/tools/purchase-orders/lines/${lineId}/history`, {
        credentials: 'include',
        headers: buildHeaders({ orgId }),
      });
      const data = await safeJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setLineHistory((prev) => ({ ...prev, [lineId]: { data: Array.isArray(data.history) ? data.history : [] } }));
    } catch (e) {
      setLineHistory((prev) => ({ ...prev, [lineId]: { error: String(e?.message || e) } }));
    } finally {
      setLineHistoryLoading((prev) => {
        const clone = { ...prev };
        delete clone[lineId];
        return clone;
      });
    }
  }, [orgId]);

  const toggleLineHistory = useCallback(
    (lineId) => {
      setLineHistoryOpen((prev) => {
        const nextState = !prev[lineId];
        if (nextState && !lineHistory[lineId]?.data && !lineHistoryLoading[lineId]) {
          fetchLineHistory(lineId);
        }
        return { ...prev, [lineId]: nextState };
      });
    },
    [fetchLineHistory, lineHistory, lineHistoryLoading]
  );

  const handleImportFile = useCallback(
    async (file) => {
      if (!file) return;
      setImportError('');
      setImportResult(null);
      setImportLoading(true);
      try {
        const text = await file.text();
        const rows = parseImportRows(text);
        if (!rows.length) throw new Error('No importable rows were detected.');
        const resp = await fetch('/api/tools/purchase-orders/import', {
          method: 'POST',
          credentials: 'include',
          headers: buildHeaders({ orgId, json: true }),
          body: JSON.stringify({ rows, org_id: orgId }),
        });
        const data = await safeJson(resp);
        if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || 'Import failed.');
        setImportResult(data);
        loadRecent();
      } catch (e) {
        setImportError(String(e?.message || e));
      } finally {
        setImportLoading(false);
      }
    },
    [orgId, loadRecent]
  );

  const handleImportChange = useCallback(
    (event) => {
      const file = event.target?.files?.[0];
      if (file) {
        handleImportFile(file);
      }
      event.target.value = '';
    },
    [handleImportFile]
  );

  const normalizeHistoryImportEntry = useCallback((entry) => {
    if (!entry) return null;
    const poNumber = String(entry.po_number_long || entry.po_number || '').trim();
    if (!poNumber) return null;
    return {
      po_number: entry.po_number,
      po_number_long: entry.po_number_long,
      po_line: entry.po_line,
      status: entry.status,
      date_update: entry.date_update,
      rest: entry.rest,
      qty_partial: entry.qty_partial ?? entry.qty_partiel,
      qty_delivered: entry.qty_delivered,
      replan: entry.replan ?? entry.replan_date,
      notes: entry.notes,
    };
  }, []);

  const handleHistoryImportFile = useCallback(
    async (file) => {
      if (!file) return;
      setHistoryImportError('');
      setHistoryImportResult(null);
      setHistoryImportLoading(true);
      try {
        const text = await file.text();
        const rows = parseImportRows(text);
        if (!rows.length) throw new Error('No importable history rows were detected.');
        const normalized = rows.map(normalizeHistoryImportEntry).filter((entry) => entry);
        if (!normalized.length) throw new Error('No history rows contain a PO number and line number.');
        const resp = await fetch('/api/tools/purchase-orders/import-history', {
          method: 'POST',
          credentials: 'include',
          headers: buildHeaders({ orgId, json: true }),
          body: JSON.stringify({ rows: normalized, org_id: orgId }),
        });
        const data = await safeJson(resp);
        if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || 'History import failed.');
        setHistoryImportResult(data);
      } catch (e) {
        setHistoryImportError(String(e?.message || e));
      } finally {
        setHistoryImportLoading(false);
      }
    },
    [normalizeHistoryImportEntry, orgId]
  );

  const handleHistoryImportChange = useCallback(
    (event) => {
      const file = event.target?.files?.[0];
      if (file) {
        handleHistoryImportFile(file);
        event.target.value = '';
      }
    },
    [handleHistoryImportFile]
  );

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  useEffect(() => {
    if (activeSection === 'history') {
      loadRecent();
    }
  }, [activeSection, loadRecent]);

  useEffect(() => {
    fetchSuppliers('');
  }, [fetchSuppliers, orgId]);

  useEffect(() => {
    if (supplier?.id) {
      setCatalogSearch('');
      loadSupplierItems(supplier.id);
    } else {
      setSupplierCatalog([]);
    }
  }, [supplier, loadSupplierItems]);

  useEffect(() => {
    if (activeSection === 'lines') {
      loadLineList();
    }
  }, [activeSection, loadLineList]);

  const filteredLineList = useMemo(() => {
    const normalizedFilters = {
      poNumber: String(columnFilters.poNumber || '').toLowerCase().trim(),
      itemRef: String(columnFilters.itemRef || '').toLowerCase().trim(),
      status: String(columnFilters.status || '').toLowerCase().trim(),
    };
    const activeStatuses = new Set(['waiting order confirmation', 'partially delivered', 'on going']);
    let list = lineList.slice();
    if (normalizedFilters.poNumber) {
      list = list.filter((line) => String(line.po_number || '').toLowerCase().includes(normalizedFilters.poNumber));
    }
    if (normalizedFilters.itemRef) {
      list = list.filter((line) => {
        const combined = `${line.item_sku || ''} ${line.item_name || ''} ${line.reference || ''}`.toLowerCase();
        return combined.includes(normalizedFilters.itemRef);
      });
    }
    if (normalizedFilters.status) {
      list = list.filter((line) => String(line.status || '').toLowerCase().includes(normalizedFilters.status));
    }
    if (onlyActiveStatuses) {
      list = list.filter((line) => activeStatuses.has(String(line.status || '').toLowerCase()));
    }
    if (sortField) {
      list.sort((a, b) => {
        const aValue = String(a[sortField] ?? '').toLowerCase();
        const bValue = String(b[sortField] ?? '').toLowerCase();
        if (aValue === bValue) return 0;
        const result = aValue < bValue ? -1 : 1;
        return sortDir === 'asc' ? result : -result;
      });
    }
    return list;
  }, [columnFilters, lineList, sortField, sortDir]);

  const makeSorter = useCallback(
    (field) => {
      setSortField((prev) => {
        if (prev === field) {
          setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
          return prev;
        }
        setSortDir('asc');
        return field;
      });
    },
    []
  );

  const doPreview = async () => {
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);
    try {
      const resp = await fetch('/api/tools/purchase-orders/preview', {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders({ orgId, json: true }),
        body: JSON.stringify(payload),
      });
      const data = await safeJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setPreview(data.preview || null);
    } catch (e) {
      setPreviewError(String(e?.message || e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const doDraft = async () => {
    setDraftLoading(true);
    setDraftError('');
    setDraftResult(null);
    try {
      const resp = await fetch('/api/tools/purchase-orders/draft', {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders({ orgId, json: true }),
        body: JSON.stringify(payload),
      });
      const data = await safeJson(resp);
      if (!resp.ok || !data?.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      setDraftResult(data);
      setPreview(data.preview || null);
      loadRecent();
    } catch (e) {
      setDraftError(String(e?.message || e));
    } finally {
      setDraftLoading(false);
    }
  };

  const saveOrderLine = async (orderId, line, overrides = null) => {
    if (!line?.id) return;
    const payload = {
      status: line.status,
      qty_delivered: line.qty_delivered,
      delivery_date: line.delivery_date,
    };
    if (overrides && typeof overrides === 'object') {
      Object.assign(payload, overrides);
    }
    let success = false;
    setLineSaving((prev) => ({ ...prev, [line.id]: true }));
    try {
      const resp = await fetch(`/api/tools/purchase-orders/lines/${line.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: buildHeaders({ orgId, json: true }),
        body: JSON.stringify(payload),
      });
      const data = await safeJson(resp);
      if (resp.ok && data?.ok) {
        setOrderLinesMap((prev) => {
          const current = prev[orderId] || [];
          return {
            ...prev,
            [orderId]: current.map((item) => (item.id === line.id ? { ...item, ...data.line } : item)),
          };
        });
        setLineList((prev) => prev.map((item) => (item.id === line.id ? { ...item, ...data.line } : item)));
        flashLineSaveNotice(line.id, { ok: true, message: 'OK, saved' });
        success = true;
      } else {
        flashLineSaveNotice(line.id, {
          ok: false,
          message: data?.message || data?.error || `Save failed (HTTP ${resp.status})`,
        });
      }
    } catch (e) {
      flashLineSaveNotice(line.id, { ok: false, message: String(e?.message || e || 'Save failed') });
    }
    finally {
      setLineSaving((prev) => {
        const clone = { ...prev };
        delete clone[line.id];
        return clone;
      });
      if (!success) {
        setOrderLinesMap((prev) => {
          const current = prev[orderId] || [];
          return {
            ...prev,
            [orderId]: current.map((item) => (item.id === line.id ? { ...item, status: line.status } : item)),
          };
        });
      }
    }
  };

  const updateOrderLineField = useCallback((orderId, lineId, field, value) => {
    setOrderLinesMap((prev) => {
      const current = prev[orderId] || [];
      const updated = current.map((item) => {
        if (item.id !== lineId) return item;
        const next = { ...item, [field]: value };
        if (field === 'qty_delivered') {
          const qty = Number(item.quantity || 0);
          const delivered = Number(value || 0);
          next.rest = Math.max(0, qty - delivered);
        }
        return next;
      });
      return { ...prev, [orderId]: updated };
    });
  }, []);

  const updateLineListEntry = useCallback((lineId, field, value) => {
    setLineList((prev) =>
      prev.map((item) => {
        if (item.id !== lineId) return item;
        const next = { ...item, [field]: value };
        if (field === 'qty_delivered') {
          const qty = Number(item.quantity ?? 0);
          const delivered = Number(value ?? 0);
          next.rest = Math.max(0, qty - delivered);
        }
        return next;
      })
    );
  }, []);

  const totals = useMemo(() => {
    const sum = lines.reduce((acc, l) => {
      const qty = Number(l.qty);
      const price = Number(l.unit_price);
      if (!Number.isFinite(qty) || !Number.isFinite(price)) return acc;
      return acc + qty * price;
    }, 0);
    return { total: sum };
  }, [lines]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          className={`px-3 py-1 rounded text-xs border ${
            activeSection === 'create' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'
          }`}
          onClick={() => setActiveSection('create')}
        >
          Create purchase order
        </button>
        <button
          type="button"
          className={`px-3 py-1 rounded text-xs border ${
            activeSection === 'history' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'
          }`}
          onClick={() => setActiveSection('history')}
        >
          Purchase order history
        </button>
        <button
          type="button"
          className={`px-3 py-1 rounded text-xs border ${
            activeSection === 'lines' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'
          }`}
          onClick={() => setActiveSection('lines')}
        >
          Purchase order lines
        </button>
        <button
          type="button"
          className={`px-3 py-1 rounded text-xs border ${
            activeSection === 'historyImport' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600'
          }`}
          onClick={() => setActiveSection('historyImport')}
        >
          History import
        </button>
      </div>
      {activeSection === 'create' && (
        <div className="panel">
        <div className="panel__header">Purchase Order</div>
        <div className="panel__body space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Org ID (X-Org-Id, optionnel)</label>
              <input className="w-full border rounded px-2 py-1 text-sm" value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="ex: 1" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Supplier (from BOM)</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  value={supplierQuery}
                  onChange={(e) => setSupplierQuery(e.target.value)}
                  placeholder="Search supplier…"
                />
                <button
                  type="button"
                  className="px-3 py-1 rounded border bg-white hover:bg-gray-50 text-sm"
                  onClick={searchSuppliers}
                  disabled={supplierLoading}
                >
                  {supplierLoading ? '…' : 'Search'}
                </button>
              </div>
              <select
                className="w-full mt-2 border rounded px-2 py-1 text-sm bg-white"
                value={supplier?.id ? String(supplier.id) : ''}
                onChange={(e) => {
                  const selectedId = Number(e.target.value);
                  const next = supplierItems.find((s) => Number(s.id) === selectedId);
                  selectSupplier(next || null);
                }}
                disabled={supplierLoading}
              >
                <option value="">(select supplier)</option>
                {supplierItems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {!supplierItems.length && (
                <div className="mt-1 text-[11px] text-gray-500">Use search to refresh the supplier list.</div>
              )}
              {supplier && (
                <div className="mt-2 text-xs text-gray-700">
                  <div className="font-medium">{supplier.name}</div>
                  <div>{[supplier.street_address, supplier.city, supplier.zip, supplier.country].filter(Boolean).join(', ')}</div>
                  <div className="mt-2">
                    <label className="block text-[11px] text-gray-600 mb-1">From (email)</label>
                    <input
                      className="border rounded px-2 py-1 text-sm w-full"
                      value={ourInfo.email}
                      onChange={(e) => setOurInfo((s) => ({ ...s, email: e.target.value }))}
                      placeholder="you@company.com"
                    />
                  </div>
                  <div className="mt-2">
                    <label className="block text-[11px] text-gray-600 mb-1">To (email)</label>
                    <select className="border rounded px-2 py-1 text-sm w-full" value={toEmail} onChange={(e) => setToEmail(e.target.value)}>
                      {toEmail && <option value={toEmail}>{toEmail}</option>}
                      {supplier.email && supplier.email !== toEmail && <option value={supplier.email}>{supplier.email}</option>}
                      {supplierContacts
                        .filter((c) => c?.email)
                        .map((c) => (
                          <option key={c.id} value={c.email}>
                            {c.email} {c.name ? `(${c.name})` : ''}
                          </option>
                        ))}
                      {!toEmail && <option value="">(select)</option>}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          {supplier && (
            <>
              {supplierCatalogLoading && (
                <div className="text-xs text-gray-500 px-2">Loading supplier catalog…</div>
              )}
              <div className="border rounded p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-2 flex flex-col gap-1">
                  <span>Lines (supplier catalog)</span>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="flex-1 border rounded px-2 py-1 text-xs"
                      placeholder="Search catalog…"
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                    />
                    <button
                      type="button"
                      className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
                      onClick={searchCatalogItems}
                      disabled={!supplier?.id}
                    >
                      Search
                    </button>
                  </div>
                </div>
                {supplierCatalog.length === 0 ? (
                  <div className="text-xs text-gray-500">No catalog items found yet.</div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-auto">
                    {supplierCatalog.map((item, index) => (
                      <div key={item.id ?? item.sku ?? index} className="flex flex-col gap-1 border-b last:border-b-0 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{item.sku || item.name}</div>
                        <div className="text-xs text-gray-600">
                          {item.uom || item.unit || 'pcs'} · {item.name}
                        </div>
                        {item.reference && (
                          <div className="text-[11px] text-gray-500 mt-1">
                            <span className="font-semibold">Ref:</span> {item.reference}
                          </div>
                        )}
                        {item.description_short && (
                          <div className="text-[11px] text-gray-500 mt-1">{item.description_short}</div>
                        )}
                        {item.description && (
                          <div className="text-[11px] text-gray-500 mt-1">{item.description}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">Price</div>
                        <div className="text-sm font-semibold">
                          {item.vendor_price != null ? `${item.vendor_price} ${item.vendor_price_currency || ''}` : 'N/A'}
                        </div>
                        <button
                          type="button"
                          className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs mt-2"
                          onClick={() => addCatalogLine(item)}
                        >
                          Add line
                        </button>
                      </div>
                    </div>
                    {item.attributes && typeof item.attributes === 'object' && (
                      <div className="text-[11px] text-gray-500">{JSON.stringify(item.attributes)}</div>
                    )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border rounded p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Your contact information</div>
              <div className="grid grid-cols-1 gap-2">
                <input
                  className="border rounded px-2 py-1 text-sm"
                  placeholder="Company"
                  value={ourInfo.company}
                  onChange={(e) => setOurInfo((s) => ({ ...s, company: e.target.value }))}
                />
                <input
                  className="border rounded px-2 py-1 text-sm"
                  placeholder="Contact name"
                  value={ourInfo.contact_name}
                  onChange={(e) => setOurInfo((s) => ({ ...s, contact_name: e.target.value }))}
                />
                <input
                  className="border rounded px-2 py-1 text-sm"
                  placeholder="Address"
                  value={ourInfo.address}
                  onChange={(e) => setOurInfo((s) => ({ ...s, address: e.target.value }))}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    className="border rounded px-2 py-1 text-sm"
                    placeholder="Phone"
                    value={ourInfo.phone}
                    onChange={(e) => setOurInfo((s) => ({ ...s, phone: e.target.value }))}
                  />
                  <input
                    className="border rounded px-2 py-1 text-sm"
                    placeholder="Email"
                    value={ourInfo.email}
                    onChange={(e) => setOurInfo((s) => ({ ...s, email: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            <div className="border rounded p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Lines</div>
              <div className="flex flex-wrap gap-2 items-center mb-3 text-xs text-gray-500">
                <span>Default delivery: {defaultDeliveryDate}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
                    onClick={() => adjustDeliveryOffset(-1)}
                    disabled={deliveryOffsetWeeks <= -1}
                  >
                    -1 week
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
                    onClick={() => adjustDeliveryOffset(1)}
                    disabled={deliveryOffsetWeeks >= 1}
                  >
                    +1 week
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {lines.map((l, idx) => (
                  <div key={idx} className="border rounded p-2">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div className="md:col-span-2">
                        <div className="flex gap-2">
                          <input
                            className="flex-1 border rounded px-2 py-1 text-sm"
                            placeholder="Search item (BOM)…"
                            value={itemSearchByIdx[idx] ?? ''}
                            onChange={(e) => setItemSearchByIdx((m) => ({ ...m, [idx]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-sm"
                            onClick={() => searchItems(idx)}
                            disabled={!!itemLoadingByIdx[idx]}
                          >
                            {itemLoadingByIdx[idx] ? '…' : 'Find'}
                          </button>
                          <button type="button" className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-sm" onClick={() => removeLine(idx)} disabled={lines.length <= 1}>
                            Remove
                          </button>
                        </div>
                        {itemResultsByIdx[idx]?.length > 0 && (
                          <div className="mt-2 border rounded max-h-48 overflow-auto bg-white">
                            {itemResultsByIdx[idx].map((it) => (
                              <button
                                key={it.id}
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
                                onClick={() => pickItem(idx, it)}
                              >
                                <div className="text-sm font-medium">{it.sku}</div>
                                <div className="text-xs text-gray-600">{it.name}</div>
                              </button>
                            ))}
                          </div>
                        )}
                        {(l.sku || l.name) && (
                          <div className="mt-2 text-xs text-gray-700">
                            <div className="font-medium">{l.sku}</div>
                            <div>{l.name}</div>
                          </div>
                        )}
                      </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] text-gray-600 mb-1">Qty</label>
                        <input
                          className="w-full border rounded px-2 py-1 text-sm"
                          type="number"
                          min="0"
                          step="1"
                          value={l.qty}
                          onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                        />
                      </div>
                        <div>
                          <label className="block text-[11px] text-gray-600 mb-1">Unit</label>
                          <input className="w-full border rounded px-2 py-1 text-sm" value={l.unit} onChange={(e) => updateLine(idx, { unit: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-[11px] text-gray-600 mb-1">Unit price</label>
                        <input
                          className="w-full border rounded px-2 py-1 text-sm"
                          value={l.unit_price}
                          onChange={(e) => updateLine(idx, { unit_price: e.target.value })}
                          placeholder="ex: 12.44"
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="block text-[11px] text-gray-600 mb-1">Delivery date</label>
                      <input
                        type="date"
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={l.delivery_date || defaultDeliveryDate}
                        onChange={(e) => updateLine(idx, { delivery_date: e.target.value })}
                      />
                    </div>
                  </div>
                    <div className="mt-2 text-xs text-gray-600">
                      Line total: {formatMoney(Number(l.qty) * Number(l.unit_price))} {l.currency || supplier?.currency || ''}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button type="button" className="px-3 py-1 rounded border bg-white hover:bg-gray-50 text-sm" onClick={addLine}>
                    Add line
                  </button>
                  <div className="text-xs text-gray-600">Subtotal: {formatMoney(totals.total)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm" onClick={doPreview} disabled={previewLoading}>
              {previewLoading ? 'Preview…' : 'Preview email'}
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm"
              onClick={doDraft}
              disabled={draftLoading || !supplier?.id || !toEmail || payload.lines.length === 0}
              title={!toEmail ? 'Select a supplier email (To)' : undefined}
            >
              {draftLoading ? 'Creating draft…' : 'Create Gmail draft'}
            </button>
            {(previewError || draftError) && <div className="text-xs text-red-600">{previewError || draftError}</div>}
            {draftResult?.order?.po_number && (
              <div className="text-xs text-green-700">
                Draft created: <span className="font-medium">{draftResult.order.po_number}</span>
              </div>
            )}
          </div>

          {preview?.html && (
            <div className="border rounded p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Email preview</div>
              <EmailTemplatePreviewFrame html={preview.html} title="po_preview" height={520} />
            </div>
          )}
          </div>
        </div>
      )}

      {activeSection === 'history' && (
        <div className="panel">
        <div className="panel__header flex items-center justify-between">
          <span>Recent purchase orders</span>
          <button type="button" className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={loadRecent} disabled={recentLoading}>
            {recentLoading ? '…' : 'Refresh'}
          </button>
        </div>
        <div className="panel__body">
          <div className="overflow-y-auto max-h-[520px]">
            <table className="min-w-full text-sm border">
              <thead className="bg-gray-50 text-[11px] uppercase text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-left border-r">Date</th>
                  <th className="px-2 py-2 text-left border-r">PO #</th>
                  <th className="px-2 py-2 text-left border-r">Supplier</th>
                  <th className="px-2 py-2 text-left border-r">To</th>
                  <th className="px-2 py-2 text-left border-r">Lines</th>
                  <th className="px-2 py-2 text-left border-r">Status</th>
                  <th className="px-2 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-3 text-center text-xs text-gray-500">
                      {recentLoading ? 'Loading…' : 'No orders yet.'}
                    </td>
                  </tr>
                )}
                {recent.map((r) => (
                  <Fragment key={r.id}>
                    <tr className={`border-t ${selectedOrderId === r.id ? 'bg-blue-50' : ''}`}>
                      <td className="px-2 py-1 text-xs text-gray-600">{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                      <td className="px-2 py-1 text-xs font-medium">{r.po_number || ''}</td>
                      <td className="px-2 py-1 text-xs">{r.supplier_name || ''}</td>
                      <td className="px-2 py-1 text-xs">{r.to_email || ''}</td>
                      <td className="px-2 py-1 text-xs text-center">
                        <button
                          type="button"
                          className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-[11px]"
                          onClick={() => loadLinesForOrder(r.id)}
                        >
                          View lines
                        </button>
                      </td>
                      <td className="px-2 py-1 text-xs">
                        <div className="flex gap-2 items-center">
                          <select
                            className="border rounded px-2 py-1 text-[11px]"
                            value={statusDrafts[r.id] || r.status || 'draft'}
                            onChange={(e) => setStatusDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          >
                            {STATUS_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-[11px]"
                            disabled={statusSaving[r.id]}
                            onClick={async () => {
                              if (!statusDrafts[r.id] || statusDrafts[r.id] === r.status) return;
                              const next = statusDrafts[r.id];
                              let success = false;
                              setStatusSaving((prev) => ({ ...prev, [r.id]: true }));
                              try {
                                const resp = await fetch(`/api/tools/purchase-orders/${r.id}/status`, {
                                  method: 'PATCH',
                                  credentials: 'include',
                                  headers: buildHeaders({ orgId, json: true }),
                                  body: JSON.stringify({ status: next }),
                                });
                                const data = await resp.json().catch(() => ({}));
                                if (resp.ok && data?.ok) {
                                  setRecent((prev) => prev.map((entry) => (entry.id === r.id ? { ...entry, status: next } : entry)));
                                  success = true;
                                }
                              } catch {}
                              finally {
                                setStatusSaving((prev) => {
                                  const clone = { ...prev };
                                  delete clone[r.id];
                                  return clone;
                                });
                                if (!success) {
                                  setStatusDrafts((prev) => ({ ...prev, [r.id]: r.status || 'draft' }));
                                }
                              }
                            }}
                          >
                            {statusSaving[r.id] ? 'Saving…' : 'Update'}
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          className="px-2 py-1 rounded border bg-white hover:bg-red-50 text-[11px] text-red-700 border-red-300"
                          disabled={orderDeleting[r.id]}
                          onClick={async () => {
                            if (!window.confirm(`Delete order ${r.po_number || ''}? This will remove the order and its lines.`)) return;
                            setOrderDeleting((prev) => ({ ...prev, [r.id]: true }));
                            try {
                              const resp = await fetch(`/api/tools/purchase-orders/${r.id}`, {
                                method: 'DELETE',
                                credentials: 'include',
                                headers: buildHeaders({ orgId }),
                              });
                              const data = await resp.json().catch(() => ({}));
                              if (resp.ok && data?.ok) {
                                setRecent((prev) => prev.filter((o) => o.id !== r.id));
                                setOrderLinesMap((prev) => {
                                  const clone = { ...prev };
                                  delete clone[r.id];
                                  return clone;
                                });
                                setStatusDrafts((prev) => {
                                  const clone = { ...prev };
                                  delete clone[r.id];
                                  return clone;
                                });
                                setStatusSaving((prev) => {
                                  const clone = { ...prev };
                                  delete clone[r.id];
                                  return clone;
                                });
                              }
                            } catch (err) {
                              // ignore error, keep UI unchanged
                            } finally {
                              setOrderDeleting((prev) => {
                                const clone = { ...prev };
                                delete clone[r.id];
                                return clone;
                              });
                            }
                          }}
                        >
                          {orderDeleting[r.id] ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                    {orderLinesMap[r.id] && (
                      <tr>
                        <td colSpan={7} className="px-0 py-0">
                          <div className="border border-t-0 rounded-b bg-white">
                            <div className="flex items-center justify-between px-3 py-1 text-[11px] text-gray-700 border-b">
                              <span>
                                Lines ({orderLinesMap[r.id].length})
                                {orderLineLoading[r.id] && <span className="ml-2 text-gray-500">(loading…)</span>}
                              </span>
                              <button
                                type="button"
                                className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-[11px]"
                                onClick={() => loadLinesForOrder(r.id)}
                                disabled={!!orderLineLoading[r.id]}
                              >
                                Reload lines
                              </button>
                            </div>
                            {orderLineLoading[r.id] ? (
                              <div className="px-3 py-2 text-xs text-gray-500">Loading lines…</div>
                            ) : orderLinesMap[r.id].length === 0 ? (
                              <div className="px-3 py-2 text-xs text-gray-500">No lines yet for this order.</div>
                            ) : (
                              <div className="max-h-72 overflow-auto">
                                <table className="w-full text-[11px]">
                                  <thead className="bg-gray-50 uppercase text-gray-600">
                                    <tr>
                                      <th className="px-2 py-1 text-left border-r">Item/Ref</th>
                                      <th className="px-2 py-1 text-left border-r">Description</th>
                                      <th className="px-2 py-1 text-right border-r">Qty</th>
                                      <th className="px-2 py-1 text-right border-r">Delivered</th>
                                      <th className="px-2 py-1 text-right border-r">Rest</th>
                                      <th className="px-2 py-1 text-right border-r">Price</th>
                                      <th className="px-2 py-1 text-center border-r">Delivery</th>
                                      <th className="px-2 py-1 text-center border-r">Status</th>
                                      <th className="px-2 py-1 text-center">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {orderLinesMap[r.id].map((line) => {
                                      const qty = Number(line.quantity ?? 0);
                                      const delivered = Number(line.qty_delivered ?? 0);
                                      const restValue = Number.isFinite(Number(line.rest)) ? Number(line.rest) : Math.max(0, qty - delivered);
                                      const historyOpen = !!lineHistoryOpen[line.id];
                                      const historyEntries = lineHistory[line.id]?.data || [];
                                      const historyError = lineHistory[line.id]?.error;
                                      return (
                                        <Fragment key={line.id}>
                                          <tr className="border-t">
                                            <td className="px-2 py-1 border-r">
                                              <div className="font-semibold">{line.item_code || line.sku || '—'}</div>
                                              <div className="text-[11px] text-gray-500">{line.reference || '—'}</div>
                                            </td>
                                            <td className="px-2 py-1 text-[11px] text-gray-700 border-r">
                                              <div>{line.description_short || line.description || '—'}</div>
                                            </td>
                                            <td className="px-2 py-1 text-right border-r">{qty || '—'}</td>
                                            <td className="px-2 py-1 text-right border-r">
                                              <input
                                                type="number"
                                                min="0"
                                                className="w-full border rounded px-1 py-1 text-[11px]"
                                                value={line.qty_delivered ?? ''}
                                                onChange={(e) => updateOrderLineField(r.id, line.id, 'qty_delivered', Number(e.target.value))}
                                              />
                                            </td>
                                            <td className="px-2 py-1 text-right border-r">{restValue}</td>
                                            <td className="px-2 py-1 text-right border-r">
                                              {line.unit_price != null
                                                ? `${formatMoney(line.unit_price)} ${line.currency || line.currency_code || ''}`
                                                : '—'}
                                            </td>
                                            <td className="px-2 py-1 text-center border-r">
                                              <input
                                                type="date"
                                                className="border rounded px-1 py-1 text-[11px]"
                                                value={line.delivery_date ? formatDateForInput(line.delivery_date) : ''}
                                                onChange={(e) => updateOrderLineField(r.id, line.id, 'delivery_date', e.target.value)}
                                              />
                                              <button
                                                type="button"
                                                className="mt-1 text-[11px] text-blue-600 underline hover:text-blue-800"
                                                onClick={() => {
                                                  const next = { ...line, delivery_date: defaultDeliveryDate };
                                                  updateOrderLineField(r.id, line.id, 'delivery_date', defaultDeliveryDate);
                                                  saveOrderLine(r.id, next, { replan_date: defaultDeliveryDate, notes: 'replan' });
                                                }}
                                              >
                                                Replan
                                              </button>
                                            </td>
                                            <td className="px-2 py-1 text-center border-r">
                                              <select
                                                className="border rounded px-1 py-1 text-[11px]"
                                                value={line.status || LINE_STATUS_OPTIONS[0]}
                                                onChange={(e) => updateOrderLineField(r.id, line.id, 'status', e.target.value)}
                                              >
                                                {LINE_STATUS_OPTIONS.map((option) => (
                                                  <option key={option} value={option}>
                                                    {option}
                                                  </option>
                                                ))}
                                              </select>
                                            </td>
                                            <td className="px-2 py-1 text-center">
                                              <div className="flex flex-col gap-1">
                                                <button
                                                  type="button"
                                                  className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-[11px]"
                                                  onClick={() => saveOrderLine(r.id, line)}
                                                  disabled={lineSaving[line.id]}
                                                >
                                                  {lineSaving[line.id] ? 'Saving…' : 'Save'}
                                                </button>
                                                {lineSaveNotice[line.id]?.message && (
                                                  <div className={`text-[10px] ${lineSaveNotice[line.id].ok ? 'text-green-700' : 'text-red-600'}`}>
                                                    {lineSaveNotice[line.id].message}
                                                  </div>
                                                )}
                                                <button
                                                  type="button"
                                                  className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-[11px]"
                                                  onClick={() => toggleLineHistory(line.id)}
                                                >
                                                  {historyOpen ? 'Hide history' : 'History'}
                                                </button>
                                              </div>
                                            </td>
                                          </tr>
                                          {historyOpen && (
                                            <tr>
                                              <td colSpan={9} className="px-3 py-2 bg-gray-50">
                                                {lineHistoryLoading[line.id] ? (
                                                  <div className="text-xs text-gray-500">Loading history…</div>
                                                ) : historyError ? (
                                                  <div className="text-xs text-red-600">{historyError}</div>
                                                ) : historyEntries.length === 0 ? (
                                                  <div className="text-xs text-gray-500">No history recorded for this line.</div>
                                                ) : (
                                                  <div className="space-y-1 text-[11px] text-gray-600">
                                                    {historyEntries.map((entry, idx) => (
                                                      <div key={`${line.id}-${idx}`} className="rounded border bg-white px-2 py-1">
                                                        <div className="flex justify-between gap-2 text-[11px] font-semibold text-gray-800">
                                                          <span>{entry.status || '—'}</span>
                                                          <span className="text-gray-500">{entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}</span>
                                                        </div>
                                                        <div className="text-[10px] text-gray-500">
                                                          {entry.notes ? `${entry.notes} · ` : ''}
                                                          Qty delivered: {entry.qty_delivered ?? '-'} · Rest: {entry.rest ?? '-'}
                                                          {entry.qty_partial != null ? ` · Qty partial: ${entry.qty_partial}` : ''}
                                                          {entry.replan_date ? ` · Replan: ${entry.replan_date}` : ''}
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                )}
                                              </td>
                                            </tr>
                                          )}
                                        </Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between text-[11px] text-gray-600 gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                onClick={() => setVisibleLimit((prev) => Math.min(prev + 50, 200))}
              >
                Load 50 more
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded border bg-white hover:bg-gray-50"
                onClick={() => setVisibleLimit(50)}
              >
                Show last 50
              </button>
            </div>
            <span>Showing up to {displayLimit} recent purchase orders (scroll inside the table over the last 50+ rows).</span>
          </div>
          <div className="mt-4 border rounded p-3 bg-gray-50 space-y-3 text-[11px] text-gray-600">
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-wide text-xs text-gray-500">Import history</span>
              <label className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-50 text-gray-700 cursor-pointer">
                <input type="file" accept=".tsv,.csv,.txt" className="hidden" onChange={handleImportChange} />
                {importLoading ? 'Importing…' : 'Upload file'}
              </label>
            </div>
            <div className="space-y-1 text-gray-500">
              <p>Upload a TSV/CSV with columns such as <code>po_number</code>, <code>po_line</code>, <code>item_code</code>, <code>description</code>, <code>qty</code>, <code>unit_price</code>, and <code>delivery_date</code>. The client parses the file and ships the rows to the backend.</p>
              <p>You can also run <code>modules/tools/db/imports/import_historical_purchase_orders.sql</code> if you prefer importing from psql.</p>
            </div>
            {importError && <div className="text-xs text-red-600">{importError}</div>}
            {importResult && (
              <div className="text-xs text-green-700">
                Imported {(importResult.imported_orders ?? 0)} order{(importResult.imported_orders ?? 0) === 1 ? '' : 's'} and {(importResult.imported_lines ?? 0)} line{(importResult.imported_lines ?? 0) === 1 ? '' : 's'}.
              </div>
            )}
          </div>
        </div>
        </div>
      )}
      {activeSection === 'lines' && (
        <div className="panel">
          <div className="panel__header flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <span>Purchase order lines</span>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="flex gap-2">
                <input
                  className="border rounded px-2 py-1 text-xs"
                  placeholder="Search by PO number, item, reference…"
                  value={lineListQuery}
                  onChange={(e) => setLineListQuery(e.target.value)}
                />
                <button
                  type="button"
                  className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
                  onClick={() => loadLineList(lineListQuery)}
                  disabled={lineListLoading}
                >
                  Search
                </button>
              </div>
              <button
                type="button"
                className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
                onClick={() => loadLineList()}
                disabled={lineListLoading}
              >
                {lineListLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          </div>
          <div className="panel__body space-y-3">
            {lineListError ? (
              <div className="text-xs text-red-600">
                Failed to load lines: {lineListError}. If this says unauthorized, ensure you are logged in as admin (or set `ADMIN_TOKEN` in localStorage).
              </div>
            ) : null}
            <div className="text-[11px] text-gray-600 flex flex-wrap gap-2">
              <span>
                Showing {lineList.length} line{lineList.length === 1 ? '' : 's'} (sorted by PO # desc).
              </span>
              <span className="text-gray-500">Scroll inside the table below to see more data.</span>
            </div>
            <div className="flex flex-wrap items-end gap-3 text-[11px] text-gray-700">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase text-gray-500">PO #</span>
                <input
                  type="text"
                  className="border rounded px-2 py-1 text-[11px]"
                  placeholder="Filter PO"
                  value={columnFilters.poNumber}
                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, poNumber: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase text-gray-500">Item / Ref</span>
                <input
                  type="text"
                  className="border rounded px-2 py-1 text-[11px]"
                  placeholder="Item or ref"
                  value={columnFilters.itemRef}
                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, itemRef: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase text-gray-500">Status</span>
                <input
                  type="text"
                  className="border rounded px-2 py-1 text-[11px]"
                  placeholder="Status"
                  value={columnFilters.status}
                  onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={onlyActiveStatuses}
                  onChange={(e) => setOnlyActiveStatuses(e.target.checked)}
                />
                <span className="text-[10px] uppercase text-gray-500">Only active statuses (Waiting / On going / Partially Delivered)</span>
              </label>
              <button
                type="button"
                className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
                onClick={() => setColumnFilters({ poNumber: '', itemRef: '', status: '' })}
                disabled={
                  !columnFilters.poNumber && !columnFilters.itemRef && !columnFilters.status
                }
              >
                Clear filters
              </button>
            </div>
            <div className="overflow-auto max-h-[520px] rounded border">
              {lineListLoading ? (
                <div className="px-3 py-3 text-xs text-gray-500">Loading lines…</div>
              ) : lineList.length === 0 ? (
                <div className="px-3 py-3 text-xs text-gray-500">No purchase order lines found.</div>
              ) : (
                <table className="min-w-full text-[11px] border-collapse">
                  <thead className="bg-gray-50 text-gray-600 uppercase sticky top-0 z-10">
                    <tr>
                      <th
                        className="px-2 py-2 text-left border-b border-gray-200 cursor-pointer"
                        onClick={() => makeSorter('po_number')}
                      >
                        PO #
                        {sortField === 'po_number' && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                      </th>
                      <th
                        className="px-2 py-2 text-right border-b border-gray-200 cursor-pointer"
                        onClick={() => makeSorter('line_no')}
                      >
                        Line
                        {sortField === 'line_no' && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                      </th>
                      <th
                        className="px-2 py-2 text-left border-b border-gray-200 cursor-pointer"
                        onClick={() => makeSorter('item_sku')}
                      >
                        Item / Ref
                        {sortField === 'item_sku' && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                      </th>
                      <th className="px-2 py-2 text-left border-b border-gray-200">Description</th>
                      <th className="px-2 py-2 text-right border-b border-gray-200">Qty</th>
                      <th className="px-2 py-2 text-right border-b border-gray-200">Delivered</th>
                      <th className="px-2 py-2 text-right border-b border-gray-200">Rest</th>
                      <th className="px-2 py-2 text-right border-b border-gray-200">Unit price</th>
                      <th className="px-2 py-2 text-center border-b border-gray-200">Delivery</th>
                      <th
                        className="px-2 py-2 text-center border-b border-gray-200 cursor-pointer"
                        onClick={() => makeSorter('status')}
                      >
                        Status
                        {sortField === 'status' && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                      </th>
                      <th className="px-2 py-2 text-center border-b border-gray-200">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLineList.map((line) => {
                      const delivered = Number(line.qty_delivered ?? 0);
                      const quantity = Number(line.quantity ?? 0);
                      const restValue = Number.isFinite(Number(line.rest ?? null))
                        ? Number(line.rest)
                        : Math.max(0, quantity - delivered);
                      const historyOpen = !!lineHistoryOpen[line.id];
                      const historyEntries = lineHistory[line.id]?.data || [];
                      const historyError = lineHistory[line.id]?.error;
                      return (
                        <Fragment key={`line-${line.id}`}>
                          <tr className="border-t border-gray-200">
                            <td className="px-2 py-1">
                              <div className="text-xs font-semibold">{line.po_number || '—'}</div>
                              <div className="text-[10px] text-gray-500">Order {line.order_id || '—'}</div>
                            </td>
                            <td className="px-2 py-1 text-right">{line.line_no ?? '—'}</td>
                            <td className="px-2 py-1">
                              <div className="font-semibold">{line.item_sku || line.item_name || '—'}</div>
                              <div className="text-[10px] text-gray-500">{line.reference || '—'}</div>
                            </td>
                            <td className="px-2 py-1 text-[10px] text-gray-700">
                              {line.description_short || line.description || '—'}
                            </td>
                            <td className="px-2 py-1 text-right">{quantity || '—'}</td>
                            <td className="px-2 py-1 text-right">
                              <input
                                type="number"
                                min="0"
                                className="w-20 border rounded px-1 py-1 text-[11px]"
                                value={line.qty_delivered ?? ''}
                                onChange={(e) => {
                                  const nextValue = e.target.value === '' ? '' : Number(e.target.value);
                                  updateLineListEntry(line.id, 'qty_delivered', nextValue);
                                }}
                              />
                            </td>
                            <td className="px-2 py-1 text-right">{restValue}</td>
                            <td className="px-2 py-1 text-right">
                              {line.unit_price != null ? `${formatMoney(line.unit_price)} ${line.currency || ''}` : '—'}
                            </td>
                            <td className="px-2 py-1 text-center space-y-1">
                              <input
                                type="date"
                                className="border rounded px-1 py-1 text-[11px] w-full"
                                value={line.delivery_date ? formatDateForInput(line.delivery_date) : ''}
                                onChange={(e) => updateLineListEntry(line.id, 'delivery_date', e.target.value)}
                              />
                                <button
                                  type="button"
                                  className="text-[10px] text-blue-600 hover:text-blue-800 underline"
                                  onClick={() => {
                                    if (!line.order_id) return;
                                    const next = { ...line, delivery_date: defaultDeliveryDate };
                                    updateLineListEntry(line.id, 'delivery_date', defaultDeliveryDate);
                                    saveOrderLine(line.order_id, next, { replan_date: defaultDeliveryDate, notes: 'replan' });
                                  }}
                                >
                                  Replan
                                </button>
                            </td>
                            <td className="px-2 py-1 text-center">
                              <select
                                className="border rounded px-1 py-1 text-[11px]"
                                value={line.status || LINE_STATUS_OPTIONS[0]}
                                onChange={(e) => updateLineListEntry(line.id, 'status', e.target.value)}
                              >
                                {LINE_STATUS_OPTIONS.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-1 text-center space-y-1">
                              <button
                                type="button"
                                className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-[11px]"
                                onClick={() => saveOrderLine(line.order_id, line)}
                                disabled={!line.order_id || lineSaving[line.id]}
                              >
                                {lineSaving[line.id] ? 'Saving…' : 'Save'}
                              </button>
                              {lineSaveNotice[line.id]?.message && (
                                <div className={`text-[10px] ${lineSaveNotice[line.id].ok ? 'text-green-700' : 'text-red-600'}`}>
                                  {lineSaveNotice[line.id].message}
                                </div>
                              )}
                              <button
                                type="button"
                                className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-[11px]"
                                onClick={() => toggleLineHistory(line.id)}
                              >
                                {historyOpen ? 'Hide history' : 'History'}
                              </button>
                            </td>
                          </tr>
                          {historyOpen && (
                            <tr>
                              <td colSpan={11} className="px-3 py-2 bg-gray-50">
                                {lineHistoryLoading[line.id] ? (
                                  <div className="text-xs text-gray-500">Loading history…</div>
                                ) : historyError ? (
                                  <div className="text-xs text-red-600">{historyError}</div>
                                ) : historyEntries.length === 0 ? (
                                  <div className="text-xs text-gray-500">No history recorded for this line.</div>
                                ) : (
                                  <div className="space-y-1 text-[11px] text-gray-600">
                                    {historyEntries.map((entry, idx) => (
                                      <div key={`${line.id}-${idx}`} className="rounded border bg-white px-2 py-1">
                                        <div className="flex justify-between gap-2 text-[11px] font-semibold text-gray-800">
                                          <span>{entry.status || '—'}</span>
                                          <span className="text-gray-500">
                                            {entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}
                                          </span>
                                        </div>
                                        <div className="text-[10px] text-gray-500">
                                          {entry.notes ? `${entry.notes} · ` : ''}
                                          Qty delivered: {entry.qty_delivered ?? '-'} · Rest: {entry.rest ?? '-'}
                                          {entry.qty_partial != null ? ` · Qty partial: ${entry.qty_partial}` : ''}
                                          {entry.replan_date ? ` · Replan: ${entry.replan_date}` : ''}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      {activeSection === 'historyImport' && (
        <div className="panel">
          <div className="panel__header">
            Import order line history
          </div>
          <div className="panel__body space-y-3">
            <div className="space-y-1 text-sm text-gray-600">
              <p>Upload a TSV/CSV containing the status history for each line. Required columns include <code>po_number</code> (or <code>po_number_long</code>), <code>po_line</code>, <code>status</code>, and <code>date_update</code>; optional columns such as <code>reste</code>, <code>Qty Partiel</code>, <code>qty_delivered</code>, <code>replan</code>, and <code>notes</code> are also supported.</p>
              <p>The script <code>modules/tools/db/imports/import_order_line_status_history.sql</code> performs the same import inside psql if you prefer a server-side run.</p>
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-1 rounded border bg-white hover:bg-gray-50 text-xs cursor-pointer">
              <input type="file" accept=".tsv,.csv,.txt" className="hidden" onChange={handleHistoryImportChange} />
              {historyImportLoading ? 'Importing history…' : 'Upload history file'}
            </label>
            {historyImportError && <div className="text-xs text-red-600">{historyImportError}</div>}
            {historyImportResult && (
              <div className="text-xs text-green-700 space-y-1">
                <div>Imported {historyImportResult.imported_rows ?? 0} history entr{(historyImportResult.imported_rows ?? 0) === 1 ? 'y' : 'ies'}.</div>
                <div>Updated {historyImportResult.updated_lines ?? 0} line{(historyImportResult.updated_lines ?? 0) === 1 ? '' : 's'}.</div>
                {(historyImportResult.skipped_orders || historyImportResult.skipped_lines) && (
                  <div>
                    Skipped {historyImportResult.skipped_orders ?? 0} order{(historyImportResult.skipped_orders ?? 0) === 1 ? '' : 's'} and {historyImportResult.skipped_lines ?? 0} line{(historyImportResult.skipped_lines ?? 0) === 1 ? '' : 's'} due to missing references.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
