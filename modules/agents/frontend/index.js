// Frontend entry for agents module (AGENTS.md structure)
// Export top-level surfaces used by the app router
export { default as Main } from "./pages/Agents.jsx";
export { default } from "./pages/Agents.jsx"; // provide default export as safety for loaders
export { default as Settings } from "./pages/AgentSettings.jsx";
// Login is now app-level (frontend/pages/login). No module export.
