export { default as DraftBanner } from "./DraftBanner.jsx";
export { default as FlagIcon } from "./FlagIcon.jsx";
export { default as RichEditor } from "./RichEditor.jsx";
export { default as Sidebar } from "./Sidebar.jsx";
export { default as SidebarTree } from "./SidebarTree.jsx";
export { Icons } from "./icons.jsx";

// Optional: provide a no-op module surface so navigating to "#/shared"
// (if ever present due to misconfiguration) does not trigger an
// "Invalid module surface" warning. This has no impact on normal usage
// where this package is consumed as a library via named exports.
export function Main() { return null; }
export default Main;
