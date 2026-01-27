import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function EmailRelanceSmsPreviewModal({
  open,
  title,
  meta,
  to,
  fromLabel,
  text,
  busy,
  error,
  onChangeText,
  onGenerate,
  onSend,
  onClose,
}) {
  const [localText, setLocalText] = useState('');

  useEffect(() => {
    if (!open) return;
    setLocalText(String(text || ''));
  }, [open, text]);

  // Lock background scroll while the modal is open.
  useEffect(() => {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const chars = String(localText || '').trim().length;

  const node = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-4xl bg-white rounded-lg shadow-lg border overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold truncate">{title || 'SMS'}</div>
            {meta ? <div className="text-xs text-gray-500 truncate">{meta}</div> : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onGenerate ? (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                onClick={onGenerate}
                disabled={busy}
              >
                {busy ? '…' : 'Regénérer'}
              </button>
            ) : null}
            {onSend ? (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => onSend({ text: localText })}
                disabled={busy || !String(localText || '').trim()}
              >
                {busy ? 'Envoi…' : 'Envoyer'}
              </button>
            ) : null}
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={() => {
                try { onChangeText?.(String(localText || '')); } catch {}
                onClose?.();
              }}
              disabled={busy}
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b">
          {error ? <div className="text-sm text-red-600 mb-2">{error}</div> : null}
          <div className="text-[11px] text-gray-600">
            {to ? `To: ${to}` : 'To: —'}
            {fromLabel ? ` · From: ${fromLabel}` : ''}
            {` · ${chars} chars`}
          </div>
        </div>

        <div className="p-3">
          <textarea
            className="w-full h-[260px] rounded border px-2 py-2 text-[12px] font-mono"
            value={String(localText || '')}
            onChange={(e) => {
              const v = e.target.value;
              setLocalText(v);
              try { onChangeText?.(v); } catch {}
            }}
            placeholder="[shop] ..."
          />
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}

