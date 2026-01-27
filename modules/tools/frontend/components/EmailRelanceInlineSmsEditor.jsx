import React from 'react';

export default function EmailRelanceInlineSmsEditor({
  title,
  to,
  fromLabel,
  text,
  msg,
  busy,
  onChangeText,
  onGenerate,
  onSend,
  onClose,
}) {
  const chars = String(text || '').trim().length;
  return (
    <div className="p-3 bg-white border rounded">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{title || 'SMS'}</div>
          <div className="text-[11px] text-gray-500">
            {to ? `To: ${to}` : 'To: —'}
            {fromLabel ? ` · From: ${fromLabel}` : ''}
            {` · ${chars} chars`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
            onClick={onGenerate}
            disabled={busy}
          >
            {busy ? '…' : 'Regénérer'}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={onSend}
            disabled={busy || !String(text || '').trim()}
          >
            {busy ? '…' : 'Send SMS'}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
            onClick={onClose}
            disabled={busy}
          >
            Fermer
          </button>
        </div>
      </div>

      {msg ? <div className="mt-2 text-[12px] text-gray-700">{msg}</div> : null}

      <div className="mt-2">
        <textarea
          className="w-full h-[160px] rounded border px-2 py-2 text-[12px] font-mono"
          value={String(text || '')}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder="[shop] ..."
        />
      </div>
    </div>
  );
}

