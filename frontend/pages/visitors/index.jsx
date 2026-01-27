import React, { Suspense } from 'react';

// Visitor surfaces may come from 'visitor-list' or 'conversation-list'
const FRONTENDS = {
  ...import.meta.glob('../../modules/visitor-list/frontend/index.{js,jsx,ts,tsx}'),
  ...import.meta.glob('../../modules/conversation-list/frontend/index.{js,jsx,ts,tsx}'),
};

const LazyVisitors = React.lazy(async () => {
  try {
    const keys = Object.keys(FRONTENDS || {});
    if (!keys.length) return { default: () => <div className="p-4 text-sm">Module not installed: visitor-list</div> };
    const mod = await FRONTENDS[keys[0]]();
    const Cmp = mod?.Main || mod?.default;
    return { default: Cmp || (() => <div className="p-4 text-sm text-red-600">Invalid module surface</div>) };
  } catch {
    return { default: () => <div className="p-4 text-sm text-red-600">Module load failed</div> };
  }
});

export default function VisitorsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading…</div>}>
      <LazyVisitors />
    </Suspense>
  );
}
