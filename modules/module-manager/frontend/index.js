// Export a stable wrapper that lazy‑loads the heavy implementation.
import ModuleManager from "./Wrapper.jsx";
export { ModuleManager };
export { default as Main } from "./Wrapper.jsx";
export default ModuleManager;

// Fallback: ensure a global symbol exists for any legacy references
try {
  if (typeof window !== "undefined") {
    window.ModuleManager = window.ModuleManager || ModuleManager;
  }
} catch {}
