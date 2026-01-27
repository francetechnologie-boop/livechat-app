// Ensure both JS and TS entrypoints expose the same symbols
// Named exports used by the main app router
export { default as Main } from "./pages/Logs.tsx";
export { default as Settings } from "./pages/Settings.jsx";

// Default export for router compatibility
export { default } from "./pages/Logs.tsx";

// Backwards-compatible aliases kept for legacy references
export { default as ModuleTemplate } from "./pages/ModuleTemplate.jsx";
export { default as ModuleTemplateSettings } from "./pages/Settings.jsx";
