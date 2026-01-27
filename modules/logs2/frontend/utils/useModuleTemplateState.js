import { useEffect, useState } from "react";

const KEY = "module_template_items";

export function useModuleTemplateState() {
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {}
  }, [items]);

  const addItem = (item) => setItems((prev) => [...prev, { name: String(item?.name || 'Untitled') }]);

  return { items, addItem };
}

