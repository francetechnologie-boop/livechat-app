import React from "react";

function KBMain() {
  try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Knowledge Base'] })); } catch {}
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold">Knowledge Base</h2>
      <p className="mt-1 text-sm text-gray-600">Module placeholder. Add pages under modules/knowledge-base/frontend/.</p>
    </div>
  );
}

export default KBMain;
export const Main = KBMain;
export const Settings = KBMain;

