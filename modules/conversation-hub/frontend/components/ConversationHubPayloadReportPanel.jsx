import React, { useEffect, useMemo, useState } from 'react';

function fmtTs(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function safeJson(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function SmallButton({ kind = 'secondary', disabled, onClick, children, title }) {
  const isPrimary = kind === 'primary';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={[
        'text-xs px-2 py-1 rounded border',
        isPrimary ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700' : 'bg-white hover:bg-gray-50',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export default function ConversationHubPayloadReportPanel({ visitorId }) {
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState({ received: [], sent: [], messages: [] });
  const [selectedKey, setSelectedKey] = useState('');
  const [showMessages, setShowMessages] = useState(true);
  const [copyMsg, setCopyMsg] = useState('');
  const [clearing, setClearing] = useState(false);

  const items = useMemo(() => {
    const received = Array.isArray(report.received) ? report.received : [];
    const sent = Array.isArray(report.sent) ? report.sent : [];
    const messages = Array.isArray(report.messages) ? report.messages : [];
    return { received, sent, messages };
  }, [report]);

  const selectedItem = useMemo(() => {
    const all = [
      ...items.received.map((x) => ({ ...x, _dir: 'received' })),
      ...items.sent.map((x) => ({ ...x, _dir: 'sent' })),
      ...items.messages.map((x) => ({ ...x, _dir: 'messages' })),
    ];
    return all.find((x) => String(x._key) === String(selectedKey)) || null;
  }, [items, selectedKey]);

  const load = async () => {
    if (!visitorId) {
      setReport({ received: [], sent: [], messages: [] });
      setSelectedKey('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const url = `/api/conversation-hub/payload-report?visitorId=${encodeURIComponent(visitorId)}&limit=${encodeURIComponent(String(limit))}`;
      const msgUrl = `/api/conversation-hub/conversations/${encodeURIComponent(visitorId)}/messages?limit=${encodeURIComponent(String(Math.max(10, Math.min(2000, limit))))}`;
      const [r, rm] = await Promise.all([
        fetch(url, { credentials: 'include' }),
        showMessages ? fetch(msgUrl, { credentials: 'include' }) : Promise.resolve(null),
      ]);
      const data = await r.json().catch(() => ({}));
      const msgData = rm ? await rm.json().catch(() => ([])) : [];
      if (!r.ok || data?.ok === false) throw new Error(data?.error || 'load_failed');

      const norm = (arr, dir) =>
        (Array.isArray(arr) ? arr : []).map((it, idx) => {
          const id = it?.id != null ? String(it.id) : `${dir}_${idx}_${it?.created_at || it?.createdAt || ''}`;
          return {
            ...it,
            created_at: it?.created_at || it?.createdAt || null,
            _key: id,
          };
        });
      const normMsg = (arr) =>
        (Array.isArray(arr) ? arr : []).map((it, idx) => {
          const id = it?.id != null ? String(it.id) : `msg_${idx}_${it?.created_at || it?.createdAt || ''}`;
          return {
            ...it,
            created_at: it?.created_at || it?.createdAt || null,
            _key: id,
          };
        });
      const next = {
        received: norm(data.received, 'received'),
        sent: norm(data.sent, 'sent'),
        messages: showMessages ? normMsg(msgData) : [],
      };
      setReport(next);
      setSelectedKey((prev) => prev || next.received?.[0]?._key || next.sent?.[0]?._key || next.messages?.[0]?._key || '');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitorId, limit, showMessages]);

  const copySelected = async () => {
    try {
      if (!selectedItem) return;
      const text = safeJson(selectedItem.payload ?? selectedItem);
      await navigator.clipboard.writeText(text);
      setCopyMsg('Copied.');
      setTimeout(() => setCopyMsg(''), 1200);
    } catch {}
  };

  const clearAllPayload = async () => {
    if (clearing) return;
    if (!window.confirm('Clear ALL payload log entries? This is irreversible.')) return;
    if (!window.confirm('Last check: continue?')) return;
    setClearing(true);
    setError('');
    try {
      const r = await fetch('/api/conversation-hub/admin/payload-log/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'clear_failed');
      await load();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="p-4 flex flex-col" style={{ minHeight: 0, height: '100%' }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="font-semibold">Payload report</div>
        <div className="flex items-center gap-2">
          <SmallButton
            disabled={loading || clearing}
            onClick={clearAllPayload}
            title="Admin: clear all payload log entries"
          >
            {clearing ? 'Clearing…' : 'Clear all payload'}
          </SmallButton>
          <label className="text-xs text-gray-600 flex items-center gap-2">
            <input type="checkbox" checked={showMessages} onChange={(e) => setShowMessages(e.target.checked)} />
            Include messages
          </label>
          <label className="text-xs text-gray-600 flex items-center gap-2">
            Limit
            <input
              type="number"
              min={10}
              max={2000}
              value={limit}
              onChange={(e) => setLimit(Math.max(10, Math.min(2000, Number(e.target.value || 200))))}
              className="border rounded px-2 py-1 w-24 text-xs"
            />
          </label>
          <SmallButton onClick={load} disabled={loading || !visitorId} title="Reload payloads">
            Reload
          </SmallButton>
          <SmallButton onClick={copySelected} disabled={!selectedItem} title="Copy selected payload">
            Copy
          </SmallButton>
        </div>
      </div>

      <div className="text-xs text-gray-600 mb-3">
        <div className="font-medium text-gray-700 mb-1">Payloads sent (storefront → livechat-app)</div>
        <div className="grid gap-1">
          <div><span className="font-mono">visitor_hello</span> — on socket connect</div>
          <div><span className="font-mono">visitor_online</span> — on connect (and optional heartbeat)</div>
          <div><span className="font-mono">visitor_context</span> — after context is built (shop/lang/customer/cart)</div>
          <div><span className="font-mono">visitor_change_page</span> — when URL changes (SPA navigation)</div>
          <div><span className="font-mono">chat_opened</span> / <span className="font-mono">chat_started</span> — when the storefront chat is opened / started</div>
          <div><span className="font-mono">chat_message</span> — when the visitor sends a message</div>
        </div>
      </div>

      {!visitorId && <div className="text-sm text-gray-600">Select a conversation to see payloads.</div>}
      {!!error && <div className="text-sm text-red-600">{error}</div>}

      <div className={`grid gap-3 ${showMessages ? 'md:grid-cols-3' : 'md:grid-cols-2'}`} style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <div className="rounded border bg-white flex flex-col" style={{ minHeight: 0 }}>
          <div className="px-3 py-2 border-b font-medium">Payload received from website</div>
          <div className="p-2 space-y-1" style={{ overflowY: 'auto', minHeight: 0 }}>
            {loading && <div className="text-sm text-gray-600">Loading…</div>}
            {!loading && items.received.length === 0 && <div className="text-sm text-gray-600">No items.</div>}
            {items.received.map((it) => (
              <button
                key={it._key}
                type="button"
                onClick={() => setSelectedKey(it._key)}
                className={[
                  'w-full text-left text-xs rounded border px-2 py-1',
                  selectedKey === it._key ? 'bg-indigo-50 border-indigo-200' : 'bg-white hover:bg-gray-50',
                ].join(' ')}
                title="Click to view details"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{it.event || 'event'}</span>
                  <span className="text-gray-500">{fmtTs(it.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded border bg-white flex flex-col" style={{ minHeight: 0 }}>
          <div className="px-3 py-2 border-b font-medium">Payload sent to website</div>
          <div className="p-2 space-y-1" style={{ overflowY: 'auto', minHeight: 0 }}>
            {loading && <div className="text-sm text-gray-600">Loading…</div>}
            {!loading && items.sent.length === 0 && <div className="text-sm text-gray-600">No items.</div>}
            {items.sent.map((it) => (
              <button
                key={it._key}
                type="button"
                onClick={() => setSelectedKey(it._key)}
                className={[
                  'w-full text-left text-xs rounded border px-2 py-1',
                  selectedKey === it._key ? 'bg-indigo-50 border-indigo-200' : 'bg-white hover:bg-gray-50',
                ].join(' ')}
                title="Click to view details"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{it.event || 'event'}</span>
                  <span className="text-gray-500">{fmtTs(it.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {showMessages ? (
          <div className="rounded border bg-white flex flex-col" style={{ minHeight: 0 }}>
            <div className="px-3 py-2 border-b font-medium">All messages</div>
            <div className="p-2 space-y-1" style={{ overflowY: 'auto', minHeight: 0 }}>
              {loading && <div className="text-sm text-gray-600">Loading…</div>}
              {!loading && items.messages.length === 0 && <div className="text-sm text-gray-600">No items.</div>}
              {items.messages.map((it) => (
                <button
                  key={it._key}
                  type="button"
                  onClick={() => setSelectedKey(it._key)}
                  className={[
                    'w-full text-left text-xs rounded border px-2 py-1',
                    selectedKey === it._key ? 'bg-indigo-50 border-indigo-200' : 'bg-white hover:bg-gray-50',
                  ].join(' ')}
                  title="Click to view details"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{it.sender || it.from || 'message'}</span>
                    <span className="text-gray-500">{fmtTs(it.created_at)}</span>
                  </div>
                  <div className="text-gray-600 truncate">
                    {String(it.content || it.message || it.text || '').slice(0, 120) || '—'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 rounded border bg-white" style={{ overflow: 'hidden' }}>
        <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
          <div className="font-medium">Selected payload</div>
          <div className="flex items-center gap-2">
            {copyMsg ? <span className="text-xs text-emerald-700">{copyMsg}</span> : null}
            <SmallButton onClick={copySelected} disabled={!selectedItem} title="Copy selected payload">
              Copy
            </SmallButton>
          </div>
        </div>
        <pre className="p-3 text-xs whitespace-pre-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
          {selectedItem ? safeJson(selectedItem.payload ?? selectedItem) : 'Select an item above.'}
        </pre>
      </div>
    </div>
  );
}
