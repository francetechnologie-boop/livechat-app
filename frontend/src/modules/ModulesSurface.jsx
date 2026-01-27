import React, { Suspense } from "react";
import { pushDebugError } from "../components/DebugPanel.jsx";

// Discover module frontends dynamically
const __modulePages = import.meta.glob('@modules/*/frontend/index.{js,jsx,ts,tsx}');
const MODULE_VIEWS = {};
const MODULE_LOADERS = {};
for (const [p, loader] of Object.entries(__modulePages)) {
  try {
    const parts = p.split('/modules/')[1].split('/');
    const modId = parts[0];
    // All modules: keep loader for diagnostics/prefetch and use lazy
    MODULE_LOADERS[modId] = loader;
    MODULE_VIEWS[modId] = React.lazy(async () => {
      try {
        const m = await loader();
        const Cmp = m?.Main || m?.default;
        if (!Cmp) {
          const msg = `Invalid module surface: ${modId}`;
          try { pushDebugError({ source: `module:${modId}`, error: msg }); } catch {}
          return { default: () => (<div className="p-4 text-sm text-red-600">{msg}</div>) };
        }
        return { default: Cmp };
      } catch (e) {
        const errMsg = String(e?.message || e);
        try { pushDebugError({ source: `module:${modId}`, error: errMsg, stack: String(e?.stack || '') }); } catch {}
        return { default: () => (
          <div className="p-4 text-sm text-red-600">
            <div className="font-semibold">Module failed to load: {modId}</div>
            <div className="mt-1 text-xs text-red-700 break-all">{errMsg}</div>
            <button onClick={() => { try { window.location.reload(); } catch {} }} className="mt-2 text-xs underline">Reload</button>
          </div>
        ) };
      }
    });
  } catch {}
}

// Load module manifests to surface titles
const __moduleManifests = import.meta.glob('@modules/*/config.json', { eager: true });
const MODULE_MANIFESTS = {};
for (const [p, mod] of Object.entries(__moduleManifests)) {
  try {
    const parts = p.split('/modules/')[1].split('/');
    const modId = parts[0];
    const cfg = mod?.default || mod;
    if (modId && cfg) MODULE_MANIFESTS[modId] = cfg;
  } catch {}
}

function ErrorBoundary({ children }) {
  return (
    <React.Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading module…</div>}>
      {children}
    </React.Suspense>
  );
}

export default function ModulesSurface({ me, activeModules, modulesLoaded, navTick }) {
  const lastCrumbRef = React.useRef('');
  // Prefetch helper to warm the module chunk (and its vendor dependency) when navigating
  const prefetchModule = React.useCallback(async (modId) => {
    try {
      if (!modId) return;
      // Prefetch any module, including grabbing-sensorex. We ensure React vendor
      // is evaluated first to avoid ESM TDZ during evaluation.
      const seen = (window.__prefetched_modules = window.__prefetched_modules || new Set());
      if (seen.has(modId)) return;
      const loader = MODULE_LOADERS[modId];
      if (typeof loader === 'function') {
        // Ensure React vendor is evaluated before the module chunk to avoid TDZ
        try { await import('react'); } catch {}
        try { await import('react-dom'); } catch {}
        loader().catch(() => {});
        seen.add(modId);
      }
    } catch {}
  }, []);
  const render = () => {
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').filter(Boolean);
      const deepLinked = (parts[0] === 'modules' && parts[1]) || (parts[0] && parts[0] !== 'modules');
      // Normalize module id by stripping any query string that may be appended by deep links
      const rawMod = (parts[0] === 'modules' ? (parts[1] || null) : (parts[0] || null));
      const modId = rawMod ? String(rawMod).split('?')[0] : rawMod;
      // Prefetch the grabbing-sensorex module chunk when navigating there (micro-optimization)
      if (modId === 'grabbing-sensorex') prefetchModule('grabbing-sensorex');
      if (modId && MODULE_VIEWS[modId]) {
        if (modulesLoaded && activeModules && !activeModules.has(modId)) {
          return (
            <div className="p-4 text-sm text-red-600">Module inactive: {modId}</div>
          );
        }
        // Surface breadcrumb from manifest
        try {
          const title = MODULE_MANIFESTS[modId]?.name || modId;
          if (lastCrumbRef.current !== title) {
            lastCrumbRef.current = title;
            window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: [title] }));
          }
        } catch {}
        const ModPage = MODULE_VIEWS[modId];
        const isValid = ModPage && (typeof ModPage === 'function' || typeof ModPage === 'object');
        if (isValid) {
          return (<ErrorBoundary><ModPage key={`${modId}:${navTick}`} /></ErrorBoundary>);
        }
        return (
          <div className="p-4 text-sm text-red-600">Module view is unavailable: {String(modId)}</div>
        );
      }
      if (deepLinked) {
        // Helpful diagnostic if the module entry was not bundled
        const mod = modId || '(unknown)';
        const available = Object.keys(MODULE_VIEWS || {}).sort();
        return (
          <div className="p-4 text-sm text-red-600">
            <div className="font-semibold">Module not found in build: {mod}</div>
            <div className="mt-1 text-xs text-gray-700">Ensure a frontend entry exists at modules/{mod}/frontend/index.(js|jsx|ts|tsx), rebuild the frontend, and redeploy.</div>
            <div className="mt-2 text-xs text-gray-600">Available entries: {available.join(', ') || '—'}</div>
          </div>
        );
      }
      // Default to Module Manager for admins
      if (me?.role === 'admin' && MODULE_VIEWS['module-manager']) {
        const ModPage = MODULE_VIEWS['module-manager'];
        return (
          <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading module manager…</div>}>
            <ModPage key={`module-manager:${navTick}`} />
          </Suspense>
        );
      }
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5 text-sm text-amber-800 shadow-sm">
          Module management is reserved for administrators.
        </div>
      );
    } catch (e) {
      const msg = String(e?.message || e);
      try { pushDebugError({ source: 'modules-surface', error: msg }); } catch {}
      return <div className="p-4 text-sm text-red-600">Failed to render module: {msg}</div>;
    }
  };
  return render();
}
