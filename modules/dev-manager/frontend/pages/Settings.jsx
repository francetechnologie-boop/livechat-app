import { useEffect, useState } from "react";

export default function ModuleTemplateSettings() {
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Module Template', 'Settings'] })); } catch {}
  }, []);

  const [enabled, setEnabled] = useState(true);
  const [title, setTitle] = useState('Module Template');

  return (
    <div className="h-full overflow-y-auto bg-white">
      <header className="border-b px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-900">Module Template • Settings</h1>
        <p className="text-sm text-gray-500">Configure frontend options for this module.</p>
      </header>
      <main className="p-6 space-y-4">
        <label className="block text-sm text-gray-700">
          Title
          <input
            className="mt-1 w-full rounded border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <div className="text-xs text-gray-500">(Demo-only state; persist to backend as needed.)</div>
      </main>
    </div>
  );
}

