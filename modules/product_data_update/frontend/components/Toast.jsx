import React from 'react';

export default function Toast({ open, type = 'info', message = '', onClose, duration = 3500 }) {
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { try { onClose && onClose(); } catch {} }, duration);
    return () => clearTimeout(t);
  }, [open, duration, onClose]);
  if (!open || !message) return null;
  const cls = type === 'error'
    ? 'bg-red-600 text-white'
    : type === 'success'
    ? 'bg-green-600 text-white'
    : 'bg-gray-800 text-white';
  return (
    <div className="fixed top-4 right-4 z-[1000]">
      <div className={`${cls} rounded shadow-lg px-3 py-2 text-sm max-w-[380px] flex items-start gap-2`} role="status" aria-live="polite">
        <span className="inline-block mt-[2px]">{message}</span>
        <button className="ml-auto text-white/80 hover:text-white text-xs" onClick={onClose} aria-label="Close">×</button>
      </div>
    </div>
  );
}

