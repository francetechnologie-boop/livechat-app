import React, { Suspense } from 'react';

// Lazy-resolve the company-chat module if it exists on disk; otherwise show a fallback
// Use the Vite alias so it works outside the frontend/ root as well
const FRONTENDS = {
  ...import.meta.glob('@modules/company-chat/frontend/index.{js,jsx,ts,tsx}')
};

const LazyCompanyChat = React.lazy(async () => {
  try {
    const keys = Object.keys(FRONTENDS || {});
    if (!keys.length) return { default: () => <div className="p-4 text-sm">Module not installed: company-chat</div> };
    const mod = await FRONTENDS[keys[0]]();
    const Cmp = mod?.Main || mod?.default;
    return { default: Cmp || (() => <div className="p-4 text-sm text-red-600">Invalid module surface</div>) };
  } catch {
    return { default: () => <div className="p-4 text-sm text-red-600">Module load failed: company-chat</div> };
  }
});

export default function CompanyChatPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading…</div>}>
      <LazyCompanyChat />
    </Suspense>
  );
}
