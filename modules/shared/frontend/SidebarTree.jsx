import React, { useEffect, useState } from 'react';

export default function SidebarTree({ parent, level = 1, className = '', onSelect }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const load = async () => {
      try {
        const params = new URLSearchParams();
        params.set('level', String(level));
        if (parent) params.set('parent_entry_id', parent);
        const res = await fetch('/api/sidebar/tree?' + params.toString(), { credentials: 'include' });
        const j = res.ok ? await res.json() : { items: [] };
        setItems(Array.isArray(j.items) ? j.items : []);
      } catch { setItems([]); }
    };
    load();
  }, [parent, level]);

  if (!items.length) return null;
  return (
    <ul className={`space-y-0.5 ${className}`}>
      {items.map((n) => (
        <li key={`${level}-${n.entry_id}`}>
          <button
            className="app-sidebar__flyout-item"
            onClick={() => onSelect && onSelect(n)}
            title={n.label}
          >
            {n.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
