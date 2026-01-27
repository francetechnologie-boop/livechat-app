import React, { Suspense } from 'react';

// Page wrapper for the Gateway module so '#/gateway' is always available.
// Use a static import to avoid top-level await in environments that don't support it.
import * as GatewayMod from '@modules/gateway/frontend/index.jsx';

const GatewaySurface = GatewayMod.Main || GatewayMod.default || null;

export default function GatewayPage() {
  if (!GatewaySurface) {
    return (
      <div className="p-4 text-sm text-red-600">
        <div className="font-semibold">Gateway UI not bundled</div>
        <div className="mt-1 text-xs text-red-700">Rebuild the frontend to include modules/gateway/frontend/index.jsx and reload.</div>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading…</div>}>
      <GatewaySurface />
    </Suspense>
  );
}
