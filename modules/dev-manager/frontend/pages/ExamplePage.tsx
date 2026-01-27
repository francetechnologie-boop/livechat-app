import React, { useEffect, useState } from "react";
import ExampleComponent from "../components/ExampleComponent.tsx";
import { toTitleCase } from "../utils/example.utils.ts";

export default function ExamplePage() {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Dev Manager'] })); } catch {}
    // Load example items from the module's own API namespace
    (async () => {
      try {
        const res = await fetch('/api/dev-manager/examples', { credentials: 'include' });
        const j = await res.json();
        if (Array.isArray(j?.items)) setItems(j.items as string[]);
      } catch {}
    })();
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-white">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dev Manager</h1>
          <p className="text-sm text-gray-500">Independent module with namespaced API and UI.</p>
        </div>
        <button
          onClick={() => setItems((prev) => [...prev, toTitleCase(`sample ${prev.length + 1}`)])}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-blue-700"
        >
          Add Sample
        </button>
      </header>

      <main className="p-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((name, idx) => (
          <ExampleComponent key={idx} title={name} subtitle="Example item" />
        ))}
        {!items.length && (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-gray-600">
            No items yet. Click "Add Sample" to create one.
          </div>
        )}
      </main>
    </div>
  );
}
