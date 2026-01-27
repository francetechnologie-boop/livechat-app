import React, { Suspense } from 'react';

// Optional DB manager if present
const FRONTENDS = {
  ...import.meta.glob('../../modules/db-manager/frontend/index.{js,jsx,ts,tsx}'),
};

const LazyDb = React.lazy(async () => {
  try {
    const keys = Object.keys(FRONTENDS || {});
    if (!keys.length) return { default: () => <div className="p-4 text-sm">Module not installed: db-manager</div> };
    const mod = await FRONTENDS[keys[0]]();
    const Cmp = mod?.Main || mod?.default;
    return { default: Cmp || (() => <div className="p-4 text-sm text-red-600">Invalid module surface</div>) };
  } catch {
    return { default: () => <div className="p-4 text-sm text-red-600">Module load failed</div> };
  }
});

export default function DbPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading…</div>}>
      <LazyDb />
    </Suspense>
  );
}
