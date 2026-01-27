import React, { Suspense } from 'react';

// Prefer 'home-assistant' module if present, otherwise fallback to 'tools'
const FRONTENDS = {
  ...import.meta.glob('../../modules/home-assistant/frontend/index.{js,jsx,ts,tsx}'),
  ...import.meta.glob('../../modules/tools/frontend/index.{js,jsx,ts,tsx}'),
};

const LazyTools = React.lazy(async () => {
  try {
    const keys = Object.keys(FRONTENDS || {});
    if (!keys.length) return { default: () => <div className="p-4 text-sm">Module not installed: home-assistant/tools</div> };
    const mod = await FRONTENDS[keys[0]]();
    const Cmp = mod?.Main || mod?.default;
    return { default: Cmp || (() => <div className="p-4 text-sm text-red-600">Invalid module surface</div>) };
  } catch {
    return { default: () => <div className="p-4 text-sm text-red-600">Module load failed</div> };
  }
});

export default function ToolsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading…</div>}>
      <LazyTools />
    </Suspense>
  );
}
