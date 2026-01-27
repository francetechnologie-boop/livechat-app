import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function EmailRelanceSmsDraftModal({
  open,
  title,
  meta,
  to,
  fromLabel,
  initialText,
  busy,
  error,
  onClose,
  onSave,
  onGenerate,
  onSend,
}) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!open) return;
    setText(String(initialText || ''));
  }, [open, initialText]);

  // Lock background scroll while the modal is open.
  useEffect(() => {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const node = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-3xl bg-white rounded-lg shadow-lg border overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold truncate">{title || 'SMS'}</div>
            {meta ? <div className="text-xs text-gray-500 truncate">{meta}</div> : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onGenerate ? (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-blue-600 text-white hover:bg-blue-700"
                onClick={onGenerate}
                disabled={busy}
              >
                {busy ? '…' : 'Générer'}
              </button>
            ) : null}
            {onSend ? (
              <button
                type="button"
                className="text-xs px-2 py-1 rounded border bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => onSend(text)}
                disabled={busy || !String(text || '').trim()}
              >
                {busy ? 'Envoi…' : 'Envoyer'}
              </button>
            ) : null}
            <button
              type="button"
              className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              onClick={() => {
                try { if (onSave) onSave(text); } catch {}
                onClose();
              }}
              disabled={busy}
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-gray-500 mb-1">À</div>
              <input className="w-full rounded border px-2 py-1 bg-gray-50" value={String(to || '')} readOnly />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Ligne</div>
              <input className="w-full rounded border px-2 py-1 bg-gray-50" value={String(fromLabel || '')} readOnly />
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Message</div>
            <textarea
              className="w-full h-[220px] rounded border px-2 py-2 text-[12px] font-mono"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="[shop] ..."
            />
            <div className="mt-1 text-[11px] text-gray-500">
              {`${String(text || '').trim().length} chars`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return node;
  return createPortal(node, document.body);
}
