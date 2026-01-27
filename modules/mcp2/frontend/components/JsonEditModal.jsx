import React, { useEffect, useMemo, useState } from 'react';

function safeStringify(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return ''; }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

export default function JsonEditModal({ open, title, value, placeholder, onClose, onSave, saving }) {
  const initial = useMemo(() => {
    if (typeof value === 'string') return value;
    return safeStringify(value ?? {});
  }, [value]);
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');

  // Keep in sync when modal opens for a different item
  useEffect(() => {
    if (open) { setText(initial); setErr(''); }
  }, [open, initial]);

  if (!open) return null;

  const parsed = safeParse(text);
  const canSave = parsed != null && !saving;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => onClose?.()}>
      <div className="bg-white rounded shadow-lg max-w-3xl w-full m-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <div className="font-medium text-sm">{title || 'Edit JSON'}</div>
          <button className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" onClick={() => onClose?.()} disabled={saving}>
            Close
          </button>
        </div>
        <div className="p-3 space-y-2">
          <textarea
            className="w-full border rounded px-2 py-2 text-xs font-mono"
            rows={16}
            value={text}
            placeholder={placeholder || '{ }'}
            onChange={(e) => { setText(e.target.value); setErr(''); }}
          />
          {!parsed && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              Invalid JSON
            </div>
          )}
          {!!err && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              {err}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-gray-500">
              {parsed ? 'Valid JSON' : 'Fix JSON to enable save'}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={() => { try { navigator.clipboard.writeText(text); } catch {} }}
                disabled={saving}
              >
                Copy
              </button>
              <button
                className="text-xs px-2 py-1 rounded border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                disabled={!canSave}
                onClick={async () => {
                  try {
                    if (!parsed) return;
                    await onSave?.(parsed);
                  } catch (e) {
                    setErr(String(e?.message || e));
                  }
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
