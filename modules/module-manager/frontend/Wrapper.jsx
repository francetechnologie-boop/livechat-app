import React, { useEffect, useState } from "react";

// Lightweight wrapper to load the real ModuleManager lazily and
// provide a stable exported symbol for the bundler/runtime.
export default function ModuleManager(props) {
  const [Impl, setImpl] = useState(null);
  useEffect(() => {
    let mounted = true;
    import("./ModuleManager.jsx")
      .then((m) => {
        const C = m?.default || m?.ModuleManager || m;
        try {
          console.debug('[ModuleManager] impl loaded', { keys: Object.keys(m || {}), type: typeof C });
          if (typeof window !== 'undefined') {
            window.__ModuleManagerImpl = C;
          }
        } catch {}
        const Safe =
          typeof C === 'function'
            ? C
            : () => (
                <div className="p-4 text-sm text-red-600">
                  Module Manager: invalid export (got {String(typeof C)}). Check
                  build and exports.
                </div>
              );
        if (mounted) setImpl(() => Safe);
      })
      .catch((err) => {
        console.error('[ModuleManager] load error', err);
        if (mounted)
          setImpl(
            () =>
              () => (
                <div className="p-4 text-sm text-red-600">
                  Module Manager: load error
                </div>
              )
          );
      });
    return () => { mounted = false; };
  }, []);

  if (!Impl)
    return (
      <div className="p-4 text-sm text-gray-500">
        Chargement du Module Manager…
      </div>
    );
  return <Impl {...props} />;
}
