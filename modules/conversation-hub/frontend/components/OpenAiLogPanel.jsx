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

export default function OpenAiLogPanel({ visitorId }) {
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [copyMsg, setCopyMsg] = useState('');

  const selected = useMemo(() => {
    const id = String(selectedId || '');
    return (Array.isArray(items) ? items : []).find((x) => String(x.id) === id) || null;
  }, [items, selectedId]);

  const load = async () => {
    if (!visitorId) {
      setItems([]);
      setSelectedId('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const url = `/api/conversation-hub/openai-log?visitorId=${encodeURIComponent(visitorId)}&limit=${encodeURIComponent(String(limit))}`;
      const r = await fetch(url, { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || `HTTP ${r.status}`);
      const arr = Array.isArray(j.items) ? j.items : [];
      setItems(arr);
      setSelectedId((prev) => prev || (arr[0]?.id != null ? String(arr[0].id) : ''));
    } catch (e) {
      setError(e?.message || String(e));
      setItems([]);
      setSelectedId('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitorId, limit]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      setCopyMsg('Copied.');
      setTimeout(() => setCopyMsg(''), 1200);
    } catch {
      setCopyMsg('Copy failed (HTTPS required).');
      setTimeout(() => setCopyMsg(''), 2000);
    }
  };

  const combinedJson = useMemo(() => {
    if (!selected) return '';
    return safeJson({
      id: selected.id,
      visitor_id: selected.visitor_id,
      id_bot: selected.id_bot,
      prompt_config_id: selected.prompt_config_id,
      created_at: selected.created_at,
      request: selected.request,
      response: selected.response,
    });
  }, [selected]);

  return (
    <div className="p-4 flex flex-col" style={{ minHeight: 0, height: '100%' }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="font-semibold">OpenAI logs</div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 flex items-center gap-2">
            Limit
            <input
              type="number"
              min={10}
              max={1000}
              value={limit}
              onChange={(e) => setLimit(Math.max(10, Math.min(1000, Number(e.target.value || 200))))}
              className="border rounded px-2 py-1 w-24 text-xs"
            />
          </label>
          <SmallButton onClick={load} disabled={loading || !visitorId} title="Reload logs">Reload</SmallButton>
          <SmallButton onClick={() => copy(combinedJson)} disabled={!selected} title="Copy selected log">Copy</SmallButton>
          {copyMsg ? <span className="text-xs text-emerald-700">{copyMsg}</span> : null}
        </div>
      </div>

      {!visitorId && <div className="text-sm text-gray-600">Select a conversation to see OpenAI logs.</div>}
      {!!error && <div className="text-sm text-red-600">{error}</div>}

      <div className="grid gap-3 md:grid-cols-2" style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        <div className="rounded border bg-white flex flex-col" style={{ minHeight: 0 }}>
          <div className="px-3 py-2 border-b font-medium">Entries</div>
          <div className="p-2 space-y-1" style={{ overflowY: 'auto', minHeight: 0 }}>
            {loading && <div className="text-sm text-gray-600">Loading…</div>}
            {!loading && items.length === 0 && <div className="text-sm text-gray-600">No items.</div>}
            {items.map((it) => {
              const ok = it?.response && (it.response.ok === true || it.response.ok === false) ? it.response.ok : null;
              const ms = it?.response?.ms != null ? Number(it.response.ms) : null;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSelectedId(String(it.id))}
                  className={[
                    'w-full text-left text-xs rounded border px-2 py-1',
                    String(selectedId) === String(it.id) ? 'bg-indigo-50 border-indigo-200' : 'bg-white hover:bg-gray-50',
                  ].join(' ')}
                  title="Click to view details"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{it.id_bot || 'chatbot'}</span>
                    <span className="text-gray-500">{fmtTs(it.created_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="text-gray-600 truncate">{it.prompt_config_id ? `prompt: ${it.prompt_config_id}` : 'prompt: —'}</span>
                    <span className={`font-semibold ${ok === true ? 'text-emerald-700' : ok === false ? 'text-red-700' : 'text-gray-500'}`}>
                      {ok === true ? 'OK' : ok === false ? 'ERR' : '—'}{ms != null && Number.isFinite(ms) ? ` · ${ms}ms` : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded border bg-white flex flex-col" style={{ minHeight: 0 }}>
          <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
            <div className="font-medium">Selected entry</div>
            <div className="flex items-center gap-2">
              <SmallButton onClick={() => copy(safeJson(selected?.request ?? null))} disabled={!selected} title="Copy request JSON">Copy request</SmallButton>
              <SmallButton onClick={() => copy(safeJson(selected?.response ?? null))} disabled={!selected} title="Copy response JSON">Copy response</SmallButton>
            </div>
          </div>
          <pre className="p-3 text-xs whitespace-pre-wrap" style={{ overflow: 'auto', minHeight: 0 }}>
            {selected ? combinedJson : 'Select an entry.'}
          </pre>
        </div>
      </div>
    </div>
  );
}

