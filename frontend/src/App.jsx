import React, { useEffect, useMemo, useState, useRef } from "react";

// Use the real shared module for the production sidebar
import { Sidebar } from "@shared-modules";
// No direct module imports: modules render via MODULE_VIEWS; pages via PAGES.
import { Suspense } from "react";
import DebugPanel, { DebugBanner, BuildMismatchBanner, installGlobalErrorCapture, pushDebugError } from "./components/DebugPanel.jsx";

// Modules rendering surface is decoupled into a separate component
import ModulesSurface from "./modules/ModulesSurface.jsx";

// Early theme bootstrap (pre-render): apply last saved theme from localStorage to avoid
// a flash of the default palette and ensure persistence even if /api/auth/me is slow.
try {
  const raw = localStorage.getItem('agentTheme');
  if (raw) {
    const j = JSON.parse(raw);
    const hex1 = typeof j?.theme_color === 'string' ? j.theme_color : null;
    const hex2 = typeof j?.theme_color2 === 'string' ? j.theme_color2 : null;
    const el = document.documentElement;
    const toRgb = (h) => { const s=h.replace('#',''); const n=parseInt(s.length===3?s.split('').map(c=>c+c).join(''):s,16); return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 }; };
    const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    const shade=(rgb,f)=>({ r:clamp(Math.round(rgb.r*f),0,255), g:clamp(Math.round(rgb.g*f),0,255), b:clamp(Math.round(rgb.b*f),0,255) });
    const toCss=(c)=>`rgb(${c.r} ${c.g} ${c.b})`;
    if (hex1) {
      const rgb = toRgb(hex1); const rgb700 = shade(rgb,0.8);
      el.style.setProperty('--brand-600', toCss(rgb));
      el.style.setProperty('--brand-700', toCss(rgb700));
      el.style.setProperty('--brand-50', `color-mix(in srgb, ${toCss(rgb)} 10%, white)`);
      el.style.setProperty('--brand-100', `color-mix(in srgb, ${toCss(rgb)} 18%, white)`);
      el.style.setProperty('--brand-200', `color-mix(in srgb, ${toCss(rgb)} 28%, white)`);
    }
    if (hex2) {
      const rgb = toRgb(hex2); const rgb700 = shade(rgb,0.8);
      el.style.setProperty('--brand2-600', toCss(rgb));
      el.style.setProperty('--brand2-700', toCss(rgb700));
      el.style.setProperty('--brand2-50', `color-mix(in srgb, ${toCss(rgb)} 10%, white)`);
      el.style.setProperty('--brand2-100', `color-mix(in srgb, ${toCss(rgb)} 18%, white)`);
    }
  }
} catch {}

// Removed inline module loaders to keep App shell decoupled from module code.

// Discover top-level pages from /pages/<pageId>/index.* (relative to frontend/src -> ../pages)
const __appPages = import.meta.glob('../pages/*/index.{js,jsx,ts,tsx}');
const PAGES = {};
for (const [p, loader] of Object.entries(__appPages)) {
  try {
    const parts = p.split('/pages/')[1].split('/');
    const pageId = parts[0];
    PAGES[pageId] = React.lazy(async () => {
      try {
        const m = await loader();
        const Cmp = m?.default || m?.Main;
        if (!Cmp) {
          const msg = `Page not found: ${pageId}`;
          try { pushDebugError({ source: `page:${pageId}`, error: msg }); } catch {}
          return { default: () => (<div className="p-4 text-sm text-red-600">{msg}</div>) };
        }
        return { default: Cmp };
      } catch (e) {
        const errMsg = String(e?.message || e);
        try { pushDebugError({ source: `page:${pageId}`, error: errMsg, stack: String(e?.stack || '') }); } catch {}
        return { default: () => (
          <div className="p-4 text-sm text-red-600">
            <div className="font-semibold">Page failed to load: {pageId}</div>
            <div className="mt-1 text-xs text-red-700 break-all">{errMsg}</div>
            <button onClick={() => { try { window.location.reload(); } catch {} }} className="mt-2 text-xs underline">Reload</button>
          </div>
        ) };
      }
    });
  } catch {}
}
// Dynamic modules are loaded via MODULE_VIEWS below; avoid hardcoded module imports.

class DebugBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    try {
      console.error('[DebugBoundary]', this.props.name || 'boundary', error, info?.componentStack);
      try { pushDebugError({ source: this.props.name || 'boundary', error: String(error?.message || error), stack: String(info?.componentStack || ''), when: Date.now() }); } catch {}
    } catch {}
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-sm text-red-600">
          {this.props.name || 'Component'} error. See console for details.
        </div>
      );
    }
    return this.props.children;
  }
}
// DbManager is rendered via a dynamic page wrapper (pages/db/index.jsx)

// Single socket instance
import { socket } from "./lib/socket";
import { loadUIState, saveUIState, setCurrentAgentId, getDeviceId, installUIStateFlush, flushUIStateNow, loadModuleState, saveModuleState } from "@app-lib/uiState";

// Removed static TAB_META; titles/descriptions are sourced dynamically
// from breadcrumbs, module manifests, or derived from the route.

export default function App() {
  const [me, setMe] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const audioCtxRef = useRef(null);
  const audioReadyRef = useRef(false);
  const lastNotifyAtRef = useRef(0);
  const visitorInfoRef = useRef({});
  const [notifyPerm, setNotifyPerm] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [messages, setMessages] = useState([]);
  const [dbUnavailable, setDbUnavailable] = useState(false);
  // Determine if sidebar has DB items; hide nav/topbar when empty
  const [hasSidebar, setHasSidebar] = useState(null); // null = unknown, boolean after fetch
  const [selectedVisitor, setSelectedVisitor] = useState(null);
  const [activeTab, setActiveTab] = useState('');
  const [navTick, setNavTick] = useState(0);
  const [activeModules, setActiveModules] = useState(new Set());
  const [modulesLoaded, setModulesLoaded] = useState(false);
  // Global runtime error capture (idempotent)
  useEffect(() => { try { installGlobalErrorCapture(); } catch {} }, []);

  // Seed active tab early from current hash to avoid "Select a page" flash on module reloads
  useEffect(() => {
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').filter(Boolean);
      const deepLinked = (parts[0] === 'modules' && parts[1]) || (parts[0] && !PAGES[parts[0]]);
      if (deepLinked) setActiveTab('modules');
    } catch {}
  }, []);

  // Load active modules (used to guard dynamic renders and data fetches)
  useEffect(() => {
    if (!me) { setActiveModules(new Set()); setModulesLoaded(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/modules', { credentials: 'include' });
        if (!res.ok) { if (!cancelled) setModulesLoaded(false); return; }
        const j = await res.json();
        const list = Array.isArray(j.modules) ? j.modules : [];
        const set = new Set(list.filter(m => m && (m.active === true || m.active === 1)).map(m => String(m.id || m.name || '').trim()).filter(Boolean));
        set.add('module-manager');
        if (!cancelled) { setActiveModules(set); setModulesLoaded(true); }
      } catch {
        if (!cancelled) setModulesLoaded(false);
      }
    })();
    return () => { cancelled = true };
  }, [me]);

  // Check DB health periodically and surface an alert when unavailable
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch('/api/health/db', { credentials: 'include', cache: 'no-store' });
        if (!r.ok) throw new Error('db_unavailable');
        const j = await r.json().catch(()=>({}));
        const ok = !!(j && j.ok && j.db);
        if (!cancelled) setDbUnavailable(!ok);
        if (!ok) { try { pushDebugError({ source: 'db_health', error: 'Database unavailable' }); } catch {} }
      } catch (e) {
        if (!cancelled) setDbUnavailable(true);
        try { pushDebugError({ source: 'db_health', error: 'Database unavailable', stack: String(e?.message||e) }); } catch {}
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Helper: current top-level hash root (e.g., 'conversation-hub', 'visitors', 'modules')
  const getHashRoot = () => {
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      return raw.split('/').filter(Boolean)[0] || '';
    } catch { return ''; }
  };

  // Minimal built-in login fallback in case the pages/login surface is not available
  function FallbackLogin() {
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [err, setErr] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const submit = async (e) => {
      e?.preventDefault?.(); setErr(''); setBusy(true);
      try {
        const r = await fetch('/api/auth/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ email, password }) });
        if (!r.ok) throw new Error((await r.json().catch(()=>({error:'login_failed'}))).error || 'login_failed');
        // Verify session and jump to module manager
        try {
          const meRes = await fetch('/api/auth/me', { credentials:'include' });
          if (meRes.ok) {
            try { if (window.location.hash !== '#/module-manager') window.history.replaceState(null, '', '#/module-manager'); } catch {}
            try { window.location.reload(); } catch {}
            return;
          }
        } catch {}
        try { window.location.reload(); } catch {}
      } catch (e) { setErr(String(e?.message || e)); } finally { setBusy(false); }
    };
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow">
          <div className="login-panel__logo mb-3">LC</div>
          <div className="text-lg font-semibold mb-4">Se connecter</div>
          <label className="block text-sm text-gray-700 mb-1">Email</label>
          <input type="email" className="border rounded px-3 py-2 w-full mb-3" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <label className="block text-sm text-gray-700 mb-1">Mot de passe</label>
          <input type="password" className="border rounded px-3 py-2 w-full mb-4" value={password} onChange={(e)=>setPassword(e.target.value)} />
          {err && <div className="text-xs text-red-600 mb-3">{err}</div>}
          <button type="submit" disabled={busy} className="w-full rounded bg-[color:var(--brand-600)] px-3 py-2 text-white hover:bg-[color:var(--brand-700)]">
            {busy ? '...' : 'Connexion'}
          </button>
        </form>
      </div>
    );
  }

  // Probe sidebar once on mount
  useEffect(() => {
    // Normalize legacy '#/agent' to '#/agents' immediately on mount
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const root = raw.split('/')[0] || '';
      if (root === 'agent') {
        const fixed = '#/agents';
        if (window.location.hash !== fixed) {
          window.history.replaceState(null, '', fixed);
        }
      }
    } catch {}

    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set('t', String(Date.now()));
        const res = await fetch('/api/sidebar/tree?' + params.toString(), { credentials: 'include' });
        if (!cancelled && res.ok) {
          const j = await res.json();
          setHasSidebar(Array.isArray(j.items) && j.items.length > 0);
        } else if (!cancelled) {
          setHasSidebar(false);
        }
      } catch {
        if (!cancelled) setHasSidebar(false);
      }
    })();
    return () => { cancelled = true };
  }, []);

  // After we know sidebar presence, seed initial active tab
  useEffect(() => {
    if (hasSidebar === null) return; // not decided yet
    if (hasSidebar === false) {
      // Sidebar empty: show Modules surface but do not clobber an existing deep link (e.g., '#/logs2')
      try {
        const raw = String(window.location.hash || '').replace(/^#\/?/, '');
        if (!raw) {
          if (window.location.hash !== '#/module-manager') window.history.replaceState(null, '', '#/module-manager');
        }
      } catch {}
      setActiveTab('modules');
      return;
    }
    try {
      // Prefer bootstrap seed; ignore localStorage to avoid stale tabs for guests
      const predicted = sessionStorage.getItem('app_initial_tab');
      const next = predicted || 'login';
      setActiveTab(next);
    } catch { setActiveTab('login'); }
  }, [hasSidebar]);

  // Ensure hash navigation opens the right main tab (e.g., #/modules/<id>)
  useEffect(() => {
    if (!hasSidebar) return; // do not force tabs when sidebar is empty
    const applyFromHash = () => {
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').filter(Boolean);
      let root = parts[0] || '';
      // Alias old Conversations tab to the new Conversation Hub module
      if (root === 'conversations') {
        const fixed = '#/conversation-hub';
        if (window.location.hash !== fixed) {
          window.history.replaceState(null, '', fixed);
        }
        root = 'modules';
      } else if (root === 'agent') {
        // Normalize legacy '#/agent' to '#/agents' (module route)
        const fixed = '#/agents';
        if (window.location.hash !== fixed) {
          window.history.replaceState(null, '', fixed);
        }
        root = 'modules';
      }
      // Treat any unknown root (not a top-level Page) as a module deep link.
      const known = new Set(['modules', ...Object.keys(PAGES)]);
      if (!known.has(root) && root) {
        setActiveTab('modules');
        return;
      }
      if (known.has(root)) setActiveTab(root);
      else setActiveTab('modules');
    } catch {}
    };
    applyFromHash();
    const onHash = () => { applyFromHash(); try { setNavTick((t) => t + 1); } catch {} };
    const onNavigate = () => { applyFromHash(); try { setNavTick((t) => t + 1); } catch {} };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('app:navigate', onNavigate);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('app:navigate', onNavigate);
    };
  }, [hasSidebar]);
  useEffect(() => {
    try { localStorage.setItem('app_active_tab', activeTab); } catch {}
    // Also persist per-agent tab selection when authenticated
    try {
      if (me && me.id != null) { saveUIState(me.id, { activeTab }); flushUIStateNow(me.id); }
    } catch {}
  }, [activeTab, me]);
  // Clear breadcrumb on main tab change; child views will set specific trails
  useEffect(() => {
    setBreadcrumb([]);
  }, [activeTab]);

  // Listen for breadcrumb change events from child views
  useEffect(() => {
    const onCrumb = (e) => {
      try {
        const trail = e?.detail;
        if (!trail) { setBreadcrumb([]); return; }
        const arr = Array.isArray(trail) ? trail.filter(Boolean).map(String) : [String(trail)];
        setBreadcrumb(arr);
      } catch {}
    };
    window.addEventListener('app-breadcrumb', onCrumb);
    return () => window.removeEventListener('app-breadcrumb', onCrumb);
  }, []);

  // Keep URL hash minimally in sync (#/<tab>). When viewing modules, never rewrite the hash
  // so that direct module routes like #/<module_id> remain intact.
  useEffect(() => {
    try {
      // If not authenticated, pin hash to '#/login' and avoid any other rewrites
      if (!me) {
        const raw = String(window.location.hash || '').replace(/^#\/?/, '');
        if (!raw || /^login(\/|$)?/i.test(raw)) {
          if (window.location.hash !== '#/login') {
            try { window.history.replaceState(null, '', '#/login'); } catch {}
          }
        }
        return;
      }
      // Do not rewrite hash while on modules surface; preserve deep links like #/<module_id>
      if (activeTab === 'modules') return;

      // Preserve deep routes for tabs that include additional path segments (e.g. '#/tools/Email').
      // If the current hash already starts with the active tab and has extra segments, keep it.
      try {
        const raw = String(window.location.hash || '').replace(/^#\/?/, '');
        if (raw) {
          const root = raw.split('/')[0] || '';
          if (root === activeTab) {
            const rest = raw.slice(root.length);
            // Keep '#/<tab>/...' and '#/<tab>?...' intact.
            if (rest.startsWith('/') || rest.startsWith('?')) return;
          }
        }
      } catch {}

      let segments = [activeTab];
      const nextHash = '#' + (segments.length ? ('/' + segments.join('/')) : '');
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
    } catch {}
  }, [activeTab, breadcrumb]);

  // Persist and restore per-tab scroll position across reloads
  useEffect(() => {
    const key = (t) => `__scroll_${t}`;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        try { sessionStorage.setItem(key(activeTab), String(window.scrollY || window.pageYOffset || 0)); } catch {}
        ticking = false;
      });
    };
    // Restore when tab is set/mounted
    try {
      const raw = sessionStorage.getItem(key(activeTab));
      const y = raw != null ? Number(raw) : 0;
      if (!Number.isNaN(y)) window.scrollTo(0, Math.max(0, y));
    } catch {}
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [activeTab]);
  const [isSocketReady, setIsSocketReady] = useState(socket.connected);

  const [visitorInfo, setVisitorInfo] = useState({});
  const [visitsByVisitor, setVisitsByVisitor] = useState({});
  const [conversations, setConversations] = useState([]);
  const [recentVisitors, setRecentVisitors] = useState([]);
  const restoreStateRef = useRef(null);
  const desiredTabRef = useRef(null);

  // Respond to hash changes (deep link navigation)
  useEffect(() => {
    const onHash = () => {
      try {
        // If unauthenticated, always pin to login and stop processing
        if (!me) {
          if (window.location.hash !== '#/login') {
            try { window.history.replaceState(null, '', '#/login'); } catch {}
          }
          if (activeTab !== 'login') setActiveTab('login');
          return;
        }
        // Normalize legacy hashes like "#modules/..." -> "#/modules/..."
        // No legacy hash normalization; routes are handled dynamically.

        const raw = String(window.location.hash || '').replace(/^#\/?/, '');
        const parts = raw.split('/').map(decodeURIComponent).filter(Boolean);
        const next = parts[0];
        if (!next) return;
        const known = new Set([ 'modules', ...Object.keys(PAGES) ]);
        if (known.has(next)) {
          if (next !== activeTab) setActiveTab(next);
        } else {
          // Treat unknown top-level as a module id alias: "#/logs2" -> "#/modules/logs2"
          // Also supports legacy "#logs2" (without slash) due to the regex above.
          const modId = next;
          if (modId) {
            if (activeTab !== 'modules') setActiveTab('modules');
            // Persist last module route for auto-restore after auth
            try { if (me && me.id != null) { saveModuleState('modules', { subModule: modId, path: parts.slice(1) }, me.id); flushUIStateNow(me.id); } } catch {}
            const detail = { modules: { modules: { subModule: modId, path: parts.slice(1) } } };
            try { window.dispatchEvent(new CustomEvent('app-restore', { detail })); } catch {}
            return;
          }
        }
        // Support deep-links for Modules sub-pages like #/modules/logs2
        if (next === 'modules') {
          if (activeTab !== 'modules') setActiveTab('modules');
          const modId = parts[1] || null;
          // Persist last module route (submodule + optional path)
          try { if (modId && me && me.id != null) { saveModuleState('modules', { subModule: modId, path: parts.slice(2) }, me.id); flushUIStateNow(me.id); } } catch {}
          const detail = { modules: { modules: { subModule: modId, path: parts.slice(2) } } };
          try { window.dispatchEvent(new CustomEvent('app-restore', { detail })); } catch {}
        }
      } catch {}
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [activeTab]);

  // Restore last UI state (per-agent) after authentication
  useEffect(() => {
    if (!me || !me.id) return;
    // 0) Apply one-shot tab from login prediction immediately
    try {
      const pred = sessionStorage.getItem('app_initial_tab');
      if (pred && pred !== activeTab) setActiveTab(pred);
      try {
        const sub = sessionStorage.getItem("app_initial_automations_subtab");
        if (pred === "automations" && sub) {
          window.dispatchEvent(new CustomEvent("app-restore", { detail: { modules: { automations: { subTab: sub } } } }));
        }
      } catch {}
      // Also auto-restore last module route if present in saved UI state,
      // but only when there is no explicit deep link in the current URL.
      try {
        // Detect an explicit deep link (e.g., '#/gateway' or '#/modules/gateway')
        let hasDeepLink = false;
        try {
          const rawHash = String(window.location.hash || '').replace(/^#\/?/, '');
          const segs = rawHash.split('/').filter(Boolean);
          if (segs.length) {
            // Treat any explicit hash as intent, including page routes like '#/gateway'
            hasDeepLink = (segs[0] === 'modules' ? !!segs[1] : true);
          }
        } catch {}
        const stLocal = loadUIState(me.id) || {};
        const last = stLocal && stLocal.modules && stLocal.modules.modules ? stLocal.modules.modules : null;
        if (!hasDeepLink && last && last.subModule) {
          if (activeTab !== 'modules') setActiveTab('modules');
          const pathArr = Array.isArray(last.path) ? last.path : [];
          // Ensure URL reflects the desired module so reloads land on the module page
          try {
            const segs = [last.subModule, ...pathArr].map(encodeURIComponent).join('/');
            const desiredHash = `#/${segs}`;
            if (window.location.hash !== desiredHash) {
              window.history.replaceState(null, '', desiredHash);
            }
          } catch {}
          const detail = { modules: { modules: { subModule: last.subModule, path: pathArr } } };
          window.dispatchEvent(new CustomEvent('app-restore', { detail }));
        }
      } catch {}
    } catch {}
      try {
        const stLocal = loadUIState(me.id) || {};
        const stServer = (me && me.ui_state && typeof me.ui_state === 'object') ? me.ui_state : {};
        const mergedModules = { ...(stServer.modules || {}), ...(stLocal.modules || {}) };
        let st = { ...stServer, ...stLocal, modules: mergedModules };
        if (stServer && typeof stServer === 'object') {
          // Sidebar visibility/settings are centrally managed by Module Manager (DB-backed).
          // Ignore any legacy per-agent sidebar preferences present in ui_state.
          if (stServer.agent_sections && typeof stServer.agent_sections === 'object') st.agent_sections = stServer.agent_sections;
        }
        // Persist merged state locally
        try { saveUIState(me.id, st); } catch {}
        const adminOnly = new Set(["modules", "ha"]);
        const desiredTab = st.activeTab || 'modules';
        // Do not override an explicit deep link (e.g., '#/gateway') on reload
        let hasDeepLinkNow = false;
        try {
          const rawHashNow = String(window.location.hash || '').replace(/^#\/?/, '');
          const segs = rawHashNow.split('/').filter(Boolean);
          hasDeepLinkNow = segs.length > 0;
        } catch {}
        restoreStateRef.current = st;
        desiredTabRef.current = desiredTab;
        if (desiredTab && !hasDeepLinkNow) {
          const allowed = adminOnly.has(desiredTab) ? (me.role === 'admin') : true;
          if (allowed && desiredTab !== activeTab) setActiveTab(desiredTab);
        }
        if (st.selectedVisitor) setSelectedVisitor(st.selectedVisitor);
      } catch {}
  }, [me]);

  // Fire app-restore once the desired activeTab is actually mounted
  useEffect(() => {
    try {
      if (!me || !desiredTabRef.current || !restoreStateRef.current) return;
      if (activeTab === desiredTabRef.current) {
        window.dispatchEvent(new CustomEvent('app-restore', { detail: restoreStateRef.current }));
        // Prevent duplicate re-broadcasts
        restoreStateRef.current = null;
        desiredTabRef.current = null;
        try { sessionStorage.removeItem('app_initial_tab'); } catch {}
      }
    } catch {}
  }, [activeTab, me]);

  // Apply theme from user preferences
  const applyTheme = (hex = '#9bb5edff') => {
    try {
      const el = document.documentElement;
      const toRgb = (h) => { const s=h.replace('#',''); const n=parseInt(s.length===3?s.split('').map(c=>c+c).join(''):s,16); return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 }; };
      const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
      const shade=(rgb,f)=>({ r:clamp(Math.round(rgb.r*f),0,255), g:clamp(Math.round(rgb.g*f),0,255), b:clamp(Math.round(rgb.b*f),0,255) });
      const rgb = toRgb(hex); const rgb700 = shade(rgb,0.8); const toCss=(c)=>`rgb(${c.r} ${c.g} ${c.b})`;
      el.style.setProperty('--brand-600', toCss(rgb));
      el.style.setProperty('--brand-700', toCss(rgb700));
      el.style.setProperty('--brand-50', `color-mix(in srgb, ${toCss(rgb)} 10%, white)`);
      el.style.setProperty('--brand-100', `color-mix(in srgb, ${toCss(rgb)} 18%, white)`);
      el.style.setProperty('--brand-200', `color-mix(in srgb, ${toCss(rgb)} 28%, white)`);
    } catch {}
  };
  const applyTheme2 = (hex = '#92e6dfff') => {
    try {
      const el = document.documentElement;
      const toRgb = (h) => { const s=h.replace('#',''); const n=parseInt(s.length===3?s.split('').map(c=>c+c).join(''):s,16); return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 }; };
      const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
      const shade=(rgb,f)=>({ r:clamp(Math.round(rgb.r*f),0,255), g:clamp(Math.round(rgb.g*f),0,255), b:clamp(Math.round(rgb.b*f),0,255) });
      const rgb = toRgb(hex); const rgb700 = shade(rgb,0.8); const toCss=(c)=>`rgb(${c.r} ${c.g} ${c.b})`;
      el.style.setProperty('--brand2-600', toCss(rgb));
      el.style.setProperty('--brand2-700', toCss(rgb700));
      el.style.setProperty('--brand2-50', `color-mix(in srgb, ${toCss(rgb)} 10%, white)`);
      el.style.setProperty('--brand2-100', `color-mix(in srgb, ${toCss(rgb)} 18%, white)`);
    } catch {}
  };

  // Whenever user loads/changes, apply theme colors
  useEffect(() => {
    if (me) {
      let c1 = me.theme_color || null;
      let c2 = me.theme_color2 || null;
      try {
        if (!c1 || !c2) {
          const raw = localStorage.getItem('agentTheme');
          if (raw) {
            const j = JSON.parse(raw);
            if (!c1 && typeof j?.theme_color === 'string') c1 = j.theme_color;
            if (!c2 && typeof j?.theme_color2 === 'string') c2 = j.theme_color2;
          }
        }
      } catch {}
      if (!c1) c1 = '#2563eb';
      if (!c2) c2 = '#0d9488';
      applyTheme(c1);
      applyTheme2(c2);
      try { localStorage.setItem('agentTheme', JSON.stringify({ theme_color: c1, theme_color2: c2 })); } catch {}
    }
  }, [me]);

  // Load current session
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => setMe(j))
      .catch(() => setMe(null))
      .finally(() => setAuthLoaded(true));
  }, []);

  // Keep current agent id available for module-level persistence
  useEffect(() => {
    try { setCurrentAgentId(me && me.id != null ? me.id : null); } catch {}
    if (me && me.id != null) {
      try { installUIStateFlush(me.id); } catch {}
    }
  }, [me]);

  // After successful authentication, if the URL is still '#/login',
  // restore the initial deep link when available; otherwise go to Module Manager.
  useEffect(() => {
    try {
      if (authLoaded && me) {
        const hash = String(window.location.hash || '');
        if (/^#\/?login(\/|$)?/i.test(hash)) {
          let target = '#/module-manager';
          try {
            const seed = sessionStorage.getItem('app_initial_tab');
            if (seed && seed !== 'login') target = `#/${seed}`;
          } catch {}
          if (hash !== target) {
            window.history.replaceState(null, '', target);
          }
          setActiveTab('modules');
        }
      }
    } catch {}
  }, [authLoaded, me]);

  // When unauthenticated, ensure any visitor-specific state is cleared so
  // effects that depend on it do not attempt API calls.
  useEffect(() => {
    if (!me) {
      try { setSelectedVisitor(null); } catch {}
    }
  }, [me]);

  // Safety: ensure were in agents room even if lib/socket changed
  useEffect(() => {
    const onConnect = () => {
      setIsSocketReady(true);
      if (me) socket.emit("agent_hello");
    };
    const onDisconnect = () => setIsSocketReady(false);
    if (socket.connected) onConnect();
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [me]);

  // â Realtime messages for the dashboard
  useEffect(() => {
    const onDash = (data) => {
      if (!data.timestamp) data.timestamp = Date.now();
      setMessages((prev) => [...prev, data]);
    };
    socket.off("dashboard_message", onDash);
    socket.on("dashboard_message", onDash);
    return () => socket.off("dashboard_message", onDash);
  }, []); // previously listening to 'chat_message' - that's for the visitor side, not agents. :contentReference[oaicite:0]{index=0}

  // Auto-focus latest conversation in chat panel on incoming visitor messages
  useEffect(() => {
    const onDashSelect = (data) => {
      if (data?.visitorId && data?.from !== "agent") {
        setSelectedVisitor(data.visitorId);
      }
    };
    socket.on("dashboard_message", onDashSelect);
    return () => socket.off("dashboard_message", onDashSelect);
  }, []);

  // Desktop notification + sound on new visitor messages
  useEffect(() => {
    const getCfg = () => {
      try {
        const raw = localStorage.getItem('agentNotify');
        if (!raw) return null;
        return JSON.parse(raw);
      } catch { return null; }
    };

    // Prepare audio context; resume on first user interaction for autoplay policies
    const ensureAudio = async () => {
      try {
        if (!audioCtxRef.current) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx) audioCtxRef.current = new Ctx();
        }
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          await audioCtxRef.current.resume();
        }
        audioReadyRef.current = !!audioCtxRef.current && audioCtxRef.current.state === 'running';
      } catch {}
    };
    const onUserInteract = () => { ensureAudio(); };
    window.addEventListener('click', onUserInteract, { once: true });
    window.addEventListener('keydown', onUserInteract, { once: true });

    const beep = async () => {
      try {
        await ensureAudio();
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        const cfg = getCfg() || { allowSound: true, soundType: 'beep_high', duration: 0.9, volume: 0.25 };
        if (!cfg.allowSound) return;
        const g = ctx.createGain();
        const vol = Math.max(0.05, Math.min(1, Number(cfg.volume ?? 0.25)));
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.02);
        g.connect(ctx.destination);
        const dur = Math.max(0.15, Math.min(3, Number(cfg.duration ?? 0.9)));
        const makeOsc = (type, freq, start, stop) => {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = freq;
          o.connect(g);
          o.start(ctx.currentTime + start);
          o.stop(ctx.currentTime + stop);
        };
        const type = cfg.soundType || 'beep_high';
        if (type === 'double_beep') {
          makeOsc('sine', 1400, 0, 0.18);
          makeOsc('sine', 1600, 0.22, 0.22 + Math.min(0.6, dur));
        } else if (type === 'square_chime') {
          makeOsc('square', 900, 0, Math.min(0.6, dur * 0.5));
          makeOsc('square', 600, Math.min(0.35, dur * 0.4), Math.min(1.2, dur));
        } else if (type === 'ping_up') {
          makeOsc('sine', 900, 0, Math.min(0.5, dur * 0.45));
          makeOsc('sine', 1500, Math.min(0.35, dur * 0.5), dur);
        } else if (type === 'ping_down') {
          makeOsc('sine', 1600, 0, Math.min(0.5, dur * 0.45));
          makeOsc('sine', 900, Math.min(0.35, dur * 0.5), dur);
        } else if (type === 'triangle_bell') {
          makeOsc('triangle', 1200, 0, Math.min(0.6, dur * 0.6));
          makeOsc('triangle', 800, Math.min(0.4, dur * 0.5), dur);
        } else if (type === 'chirp_sweep') {
          const steps = 6;
          for (let i = 0; i < steps; i++) {
            const f = 900 + i * 150;
            const s = (i * dur) / steps;
            const e = ((i + 1) * dur) / steps;
            makeOsc('sawtooth', f, s, e);
          }
        } else if (type === 'beep_low') {
          makeOsc('sine', 700, 0, dur);
        } else {
          makeOsc('sine', 1600, 0, dur);
        }
      } catch {}
    };

    const canNotify = async () => {
      if (!('Notification' in window)) return false;
      let perm = Notification.permission;
      if (perm === 'granted') return true;
      if (perm === 'default') {
        try { perm = await Notification.requestPermission(); setNotifyPerm(perm); } catch {}
        return perm === 'granted';
      }
      return false;
    };

    const showNotify = async (title, body) => {
      try {
        const cfg = getCfg() || { allowText: true };
        if (!cfg.allowText) return;
        const ok = await canNotify();
        if (!ok) return;
        const n = new Notification(title, { body, silent: true });
        n.onclick = () => window.focus();
      } catch {}
    };

    const onDashNotify = async (data) => {
      if (!data || data.from === 'agent') return;
      const now = Date.now();
      // Throttle to avoid spam bursts
      if (now - (lastNotifyAtRef.current || 0) < 700) return;
      lastNotifyAtRef.current = now;
      const vid = data.visitorId || '';
      const info = (typeof vid === 'string' ? visitorInfoRef.current[vid] : null) || {};
      const who = info.customer_email || info.customer_firstname || info.customer_lastname ? `${(info.customer_firstname||'').trim()} ${(info.customer_lastname||'').trim()}`.trim() : `Visiteur ${String(vid).slice(0,6)}`;
      const text = String(data.message || '').slice(0, 140);
      await showNotify(`Nouveau message â ${who}`, text);
      beep();
    };

    socket.on('dashboard_message', onDashNotify);
    return () => {
      socket.off('dashboard_message', onDashNotify);
      window.removeEventListener('click', onUserInteract);
      window.removeEventListener('keydown', onUserInteract);
    };
  }, []);

  // Realtime visitor updates (page change, cart, login, etc.)
  useEffect(() => {
    const onVu = (data) => {
      if (!data || !data.visitorId) return;
      const vid = data.visitorId;
      const patch = { ...data };
      if (!patch.page_url && patch.page_url_last) patch.page_url = patch.page_url_last;

      // Merge latest info for this visitor
      setVisitorInfo((prev) => ({
        ...prev,
        [vid]: { ...(prev[vid] || {}), ...patch },
      }));

      // If the selected visitor changed page/context, refresh recent visits list
      const hasVisitHints = (
        patch.page_url ||
        patch.page_url_last ||
        patch.title ||
        patch.referrer ||
        patch.utm_source || patch.utm_medium || patch.utm_campaign || patch.utm_term || patch.utm_content
      );
      if (selectedVisitor === vid && hasVisitHints) {
        fetch(`/api/visitors/${vid}/visits?limit=50`)
          .then((r) => (r.ok ? r.json() : []))
          .then((rows) => setVisitsByVisitor((prev) => ({ ...prev, [vid]: rows })))
          .catch(() => {});
      }
    };
    socket.off("visitor_update", onVu);
    socket.on("visitor_update", onVu);
    return () => socket.off("visitor_update", onVu);
  }, [selectedVisitor]);

  // (Optional) These endpoints donât exist in your backend yet; okay to keep or remove
  useEffect(() => {
    if (!me) return;
    const root = getHashRoot();
    // Only fetch when relevant modules are in use and active
    const allowConvos = activeModules.has('conversation-hub');
    const allowVisitors = activeModules.has('visitor-list');
    if ((root !== 'conversation-hub' && root !== 'visitors') || (!allowConvos && !allowVisitors)) return;
    // Get latest conversation per visitor (all time)
    fetch("/api/conversations?limit=500&days=0")
      .then((r) => (r.ok ? r.json() : []))
      .then(setConversations)
      .catch(() => {});

    // Also fetch recent visitors to populate the list even if no messages recently
    fetch("/api/visitors/recent")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setRecentVisitors(rows.map((v) => v.visitor_id)))
      .catch(() => {});
  }, [me, activeModules]);
  useEffect(() => {
    if (!me || !messages.length) return;
    const root = getHashRoot();
    if (root !== 'conversation-hub' || !activeModules.has('conversation-hub')) return;
    const t = setTimeout(() => {
      fetch("/api/conversations?limit=500&days=0")
        .then((r) => (r.ok ? r.json() : []))
        .then(setConversations)
        .catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [messages, me, activeModules]);

  // Keep visitorInfo in a ref for notification handler
  useEffect(() => {
    visitorInfoRef.current = visitorInfo;
  }, [visitorInfo]);

  // Pull DB conversation when a visitor is selected (optional)
  const mergeDbMessages = (_visitorId, rows) => {
    setMessages((prev) => {
      const DEDUP_MS = Number(import.meta.env.VITE_MERGE_DEDUP_MS || 10000);
      const seenDbIds = new Set(prev.filter((m) => m._dbid).map((m) => m._dbid));
      const sig = (m) => {
        const ts = Number(m.timestamp || 0);
        const bucket = DEDUP_MS > 0 ? Math.floor(ts / Math.max(1, DEDUP_MS)) : ts;
        return `${m.visitorId}|${m.from}|${(m.message || '').trim()}|${bucket}`;
      };
      const existing = new Set(prev.map(sig));

      const mapped = rows
        .filter((r) => !seenDbIds.has(r.id))
        .map((r) => {
          const ts = Date.parse(r.created_at) || Date.now();
          const senderRaw = (r.sender || r.from || '').toLowerCase();
          const from = senderRaw || (r.agent_id ? 'agent' : '');
          return {
            _dbid: r.id,
            visitorId: r.visitor_id,
            from,
            sender: r.sender || null,
            agentId: r.agent_id ?? null,
            message: r.content,
            content: r.content ?? null,
            html: r.content_html || null,
            content_html: r.content_html || null,
            timestamp: ts,
          };
        })
        .filter((m) => !existing.has(sig(m)));

      return mapped.length ? [...prev, ...mapped] : prev;
    });
  };

  useEffect(() => {
    if (!me || !selectedVisitor) return;
    const root = getHashRoot();
    if (root !== 'conversation-hub' || !activeModules.has('conversation-hub')) return;

    fetch(`/api/visitors/${selectedVisitor}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (!info) return;
        const mapped = { ...info };
        if (!mapped.page_url && mapped.page_url_last) mapped.page_url = mapped.page_url_last;
        setVisitorInfo((prev) => ({
          ...prev,
          [selectedVisitor]: { ...(prev[selectedVisitor] || {}), ...mapped },
        }));
      })
      .catch(() => {});

    fetch(`/api/visitors/${selectedVisitor}/visits?limit=50`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setVisitsByVisitor((prev) => ({ ...prev, [selectedVisitor]: rows }));
        if (rows && rows.length) {
          const first = rows[0];
          setVisitorInfo((prev) => {
            const cur = prev[selectedVisitor] || {};
            return {
              ...prev,
              [selectedVisitor]: {
                ...cur,
                origin: cur.origin || first.origin || null,
                page_url: cur.page_url || first.page_url || null,
                title: cur.title || first.title || null,
                referrer: cur.referrer || first.referrer || cur.referrer || null,
              },
            };
          });
        }
      })
      .catch(() => {});

    fetch(`/api/conversations/${selectedVisitor}/messages?limit=500`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => mergeDbMessages(selectedVisitor, rows))
      .catch(() => {});
  }, [selectedVisitor, me, activeModules]);

  // Derived visitor IDs (from messages + any server lists you add later)
  const visitors = useMemo(() => {
    const fromConvos = new Set(conversations.map((c) => c.visitor_id));
    const fromMsgs = new Set(messages.map((m) => m.visitorId).filter(Boolean));
    const fromInfo = new Set(Object.keys(visitorInfo));
    const fromRecent = new Set(recentVisitors);
    return Array.from(new Set([...fromConvos, ...fromMsgs, ...fromInfo, ...fromRecent]));
  }, [conversations, messages, visitorInfo, recentVisitors]);

  // Auto-select the most recent visitor if none is selected yet
  useEffect(() => {
    if (!me) return;
    const root = getHashRoot();
    if (root !== 'conversation-hub' || !activeModules.has('conversation-hub')) return;
    if (!selectedVisitor && visitors.length) {
      setSelectedVisitor((prev) => prev || visitors[0]);
    }
  }, [visitors, selectedVisitor, me, activeModules]);

  // Persist selected visitor per-agent so we can restore exact screen
  useEffect(() => {
    if (!me || !me.id) return;
    try { saveUIState(me.id, { selectedVisitor }); flushUIStateNow(me.id); } catch {}
  }, [selectedVisitor, me]);

  const dashboardMetrics = useMemo(() => {
    const now = Date.now();
    const horizon = 60 * 60 * 1000;
    const recentMessages = messages.filter((m) => {
      if (!m || typeof m !== "object" || !m.timestamp) return false;
      return now - m.timestamp < horizon;
    }).length;
    return [
      { label: "Tracked visitors", value: visitors.length },
      { label: "Open conversations", value: conversations.length },
      { label: "Messages (1h)", value: recentMessages },
    ];
  }, [visitors, conversations, messages]);

  // Send agent message (send plain text; backend builds safe HTML)
  const sendAgentMessage = (text) => {
    if (!selectedVisitor || !`${text}`.trim()) return;
    let agentLang = null;
    try {
      const raw = localStorage.getItem('agentProfile');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && obj.preferredLang) agentLang = obj.preferredLang;
      }
    } catch {}
    socket.emit("chat_message", {
      visitorId: selectedVisitor,
      from: "agent",
      message: `${text}`,
      timestamp: Date.now(),
      agent_lang: agentLang || undefined,
    });
  };

  useEffect(() => {
    if (window.twemoji) window.twemoji.parse(document.body, { folder: "svg", ext: ".svg" });
  });

  const toTitle = (s = '') => String(s).split('-').map(w => (w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  const currentTitle = (() => {
    if (Array.isArray(breadcrumb) && breadcrumb.length) return breadcrumb[0];
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').filter(Boolean);
      // If hash points to a module (unknown top-level page), use its id as title
      if (parts[0] && !PAGES[parts[0]]) return toTitle(parts[0]);
    } catch {}
    return toTitle(activeTab || '');
  })();
  const greetingName = (() => {
    if (me?.name) {
      const trimmed = me.name.trim();
      if (trimmed) return trimmed.split(/\s+/)[0];
    }
    if (me?.email) {
      const trimmed = me.email.trim();
      if (trimmed) return trimmed.split("@")[0];
    }
    return "Agent";
  })();

  const formatMetricValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "0";
    return numeric.toLocaleString();
  };

  const renderPanel = (children, options = {}) => {
    const { scrollable = false, className = "", bodyClassName = "", fill = true } = options;
    const outerClass = ["panel", fill ? "h-full" : "h-auto", className].filter(Boolean).join(" ");
    const bodyClass = ["panel__body", scrollable ? "panel__body--scroll" : "", bodyClassName].filter(Boolean).join(" ");
    return (
      <div className={outerClass}>
        <div className={bodyClass}>{children}</div>
      </div>
    );
  };

  const renderMain = () => {
    // No hardcoded module surfaces here; handled via MODULE_VIEWS
    // Special-case only when no page exists for '#/gateway'
    try {
      const hasGatewayPage = !!PAGES['gateway'];
      if (!hasGatewayPage) {
        const raw = String(window.location.hash || '').replace(/^#\/?/, '');
        const parts = raw.split('/').filter(Boolean);
        const isGatewayLink = (parts[0] === 'gateway') || (parts[0] === 'modules' && parts[1] === 'gateway');
        if (isGatewayLink) {
          return renderPanel(
            <ModulesSurface me={me} activeModules={activeModules} modulesLoaded={modulesLoaded} navTick={navTick} />,
            { scrollable: true }
          );
        }
      }
    } catch {}
    if (activeTab === "modules") {
      // Delegate module rendering to decoupled surface
      return renderPanel(
        <ModulesSurface me={me} activeModules={activeModules} modulesLoaded={modulesLoaded} navTick={navTick} />,
        { scrollable: true }
      );
    }
    // DB page is provided via PAGES['db']
  // Render app pages at #/<pageId>
  if (PAGES[activeTab]) {
    const Page = PAGES[activeTab];
    return renderPanel(
      <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading…</div>}>
        <Page />
      </Suspense>,
      { scrollable: true }
    );
  }
    // Fallback: if URL points to a module, delegate to ModulesSurface even if activeTab
    // isn’t set yet (prevents "Select a page…" on reload of deep-linked modules)
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').filter(Boolean);
      const deepLinked = (parts[0] === 'modules' && parts[1]) || (parts[0] && !PAGES[parts[0]]);
      if (deepLinked) {
        return renderPanel(
          <ModulesSurface me={me} activeModules={activeModules} modulesLoaded={modulesLoaded} navTick={navTick} />,
          { scrollable: true }
        );
      }
    } catch {}
    // Fallback: try to render Module Manager for admins, else show a gentle hint
    try {
      if (me?.role === 'admin' && MODULE_VIEWS['module-manager']) {
        const ModPage = MODULE_VIEWS['module-manager'];
        const isValid = ModPage && (typeof ModPage === 'function' || typeof ModPage === 'object');
        if (isValid) {
          return renderPanel(
            <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading module manager…</div>}>
              <ModPage key={`module-manager:${navTick}`} />
            </Suspense>,
            { scrollable: true }
          );
        }
      }
    } catch {}
    return (<div className="p-4 text-sm text-gray-600">Select a page from the sidebar.</div>);
  };

  if (!authLoaded) return null;
  if (!me) {
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      // Preserve deep link if present; only force '#/login' when empty or already login
      if (!raw || /^login(\/|$)?/i.test(raw)) {
        if (window.location.hash !== '#/login') {
          window.history.replaceState(null, '', '#/login');
        }
      }
    } catch {}
    const Page = PAGES['login'];
    const isValid = Page && (typeof Page === 'function' || typeof Page === 'object');
    if (isValid) {
      return (
        <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading…</div>}>
          <Page />
        </Suspense>
      );
    }
    // Safe fallback if pages/login could not be resolved or is invalid
    return <FallbackLogin />;
  }

  // Detect when Module Manager is the active module/page to enable perf CSS tweaks
  const isModuleManagerRoute = (() => {
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').filter(Boolean);
      if (!parts.length) return false;
      if (parts[0] === 'modules') return parts[1] === 'module-manager';
      return parts[0] === 'module-manager';
    } catch { return false; }
  })();

  return (
    <DebugBoundary name="app">
      <DebugBanner />
      {dbUnavailable && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="mx-auto max-w-screen-2xl bg-red-50 text-red-700 border-b border-red-200 px-4 py-2 text-sm flex items-center gap-3">
            <span className="inline-flex h-2 w-2 rounded-full bg-red-600" aria-hidden></span>
            <span>Base de données indisponible. Certaines fonctionnalités peuvent être limitées.</span>
          </div>
        </div>
      )}
    <div className={`app-shell ${isModuleManagerRoute ? 'perf-no-backdrop' : ''}`}>
      {notifyPerm !== "granted" && notifyPerm !== "unsupported" && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/95 px-4 py-2 text-sm text-slate-700 shadow-lg">
          <span>Enable desktop notifications</span>
          <button
            className="rounded-full bg-[color:var(--brand-600)] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[color:var(--brand-700)]"
            onClick={async () => {
              try {
                if ("Notification" in window) {
                  const perm = await Notification.requestPermission();
                  setNotifyPerm(perm);
                }
              } catch {}
            }}
          >
            Enable
          </button>
        </div>
      )}
      {/* Always render Sidebar; it will self-decide to show only brand/profile when empty */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        me={me}
        onLogout={async () => {
            try { if (me && me.id != null) await flushUIStateNow(me.id); } catch {}
            try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
            // Clear any persisted tab state so guests don't bounce to old tabs
            try { sessionStorage.removeItem('app_initial_tab'); } catch {}
            try { sessionStorage.removeItem('app_initial_automations_subtab'); } catch {}
            try { localStorage.removeItem('app_active_tab'); } catch {}
            // Force guest to login route immediately
            try {
              if (window.location.hash !== '#/login') {
                window.location.replace('#/login');
              }
            } catch {}
            setMe(null);
          }}
        onGoProfile={() => {
            try {
              const target = '#/agents';
              if (window.location.hash !== target) window.history.replaceState(null, '', target);
            } catch {}
            setActiveTab('modules');
          }}
      />

      <div className={`app-shell__main ${activeTab === 'company-chat' ? 'app-shell__main--tight' : ''}`} role="main">
        {hasSidebar ? (
        <header className={`app-topbar app-topbar--compact`}>
          <div className="app-topbar__copy">
            <div className="app-topbar__eyebrow">{(breadcrumb && breadcrumb.length ? breadcrumb : [currentTitle]).join(' > ')}</div>
          </div>
          <div className="app-topbar__aside">
            {me && me.role === 'admin' && (
              <span className="mr-2 inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 text-[10px] font-medium" title={`Signed in as ${me.email || ''}`}>
                Signed in as {me.email || ''}
              </span>
            )}
            <span className={`status-pill ${isSocketReady ? "status-pill--online" : "status-pill--offline"}`}>
              {isSocketReady ? "Online" : "Offline"}
            </span>
          </div>
        </header>
        ) : null}

        <main className={`app-shell__body ${activeTab === 'company-chat' ? 'app-shell__body--tight' : ''}`}>{renderMain()}</main>
      </div>
      <BuildMismatchBanner />
      <DebugPanel />
    </div>
    </DebugBoundary>
  );
}

