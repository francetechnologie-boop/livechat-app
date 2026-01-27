import React from 'react';

export default function CollapsibleCard({ title, defaultOpen = false, children, actions = null }) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <div className="border rounded mb-4">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 border-b rounded-t"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-medium">{title}</span>
        <span className="ml-auto">{actions}</span>
      </button>
      {open && (
        <div className="p-4">
          {children}
        </div>
      )}
    </div>
  );
}

