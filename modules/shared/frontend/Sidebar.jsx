import { useEffect, useRef, useState } from "react";
import { Icons } from "./icons.jsx";
import SidebarTreeInline from "./SidebarTreeInline.jsx";

function initials(input = "") {
  const text = String(input || "").trim();
  if (!text) return "LC";
  const parts = text.split(/\s+/).slice(0, 2);
  if (parts.length === 1 && text.includes("@")) {
    return text[0] ? text[0].toUpperCase() : "LC";
  }
  const letters = parts
    .map((part) => (part ? part[0].toUpperCase() : ""))
    .join("");
  return letters || (text[0] ? text[0].toUpperCase() : "LC");
}

// Simple discovery to check if the DB has any sidebar items (level 0)
async function fetchSidebarPresence() {
  try {
    const res = await fetch('/api/sidebar/tree?level=0', { credentials: 'include' });
    const j = res.ok ? await res.json() : { items: [] };
    return Array.isArray(j.items) && j.items.length > 0;
  } catch { return false; }
}

function mergeSidebar(itemsBase, extensions) {
  try {
  const list = Array.isArray(itemsBase) ? itemsBase.slice() : [];
  const ext = Array.isArray(extensions) ? extensions : [];
  for (const e of ext) {
    if (!e || !e.id) continue;
    let IconComp = IconModules;
    try {
      const alias = {
        logs: 'IconActivity', log: 'IconActivity', activity: 'IconActivity', history: 'IconActivity',
        errors: 'IconBug', error: 'IconBug', bug: 'IconBug',
        security: 'IconShield', shield: 'IconShield',
        settings: 'IconCog', cog: 'IconCog', gear: 'IconCog',
        chat: 'IconMessage', message: 'IconMessage', mail: 'IconMessage',
        db: 'IconDatabase', database: 'IconDatabase',
        users: 'IconUsers', people: 'IconUsers',
        star: 'IconStar', favorite: 'IconStar', fav: 'IconStar',
        link: 'IconLink', external: 'IconLink',
        folder: 'IconFolder', dir: 'IconFolder',
        alert: 'IconAlert', warning: 'IconAlert',
        list: 'IconList', file: 'IconFile', terminal: 'IconTerminal',
      };
      const iconStr = (e && typeof e.icon === 'string') ? e.icon.trim() : '';
      const logoUrl = (e && typeof e.logo === 'string') ? e.logo.trim() : '';
      // Highest priority: explicit logo URL
      if (logoUrl) {
        IconComp = (props) => (<img src={logoUrl} alt="" className="h-5 w-5 object-contain" aria-hidden {...props} />);
      }
      const iconKey = alias[iconStr] || iconStr;
      const isUrl = !logoUrl && ( /^https?:/i.test(iconKey) || iconKey.startsWith('/') || iconKey.startsWith('data:') );
      if (isUrl) {
        const src = iconKey;
        IconComp = (props) => (<img src={src} alt="" className="h-5 w-5 object-contain" aria-hidden {...props} />);
      } else if (!logoUrl && iconKey && iconKey.startsWith('twemoji:')) {
        const hex = (iconKey.split(':')[1] || '').toLowerCase();
        const src = `https://twemoji.maxcdn.com/v/14.0.2/svg/${hex}.svg`;
        IconComp = (props) => (<img src={src} alt="" className="h-5 w-5" aria-hidden {...props} />);
      } else if (!logoUrl && iconKey && Icons && Icons[iconKey]) {
        IconComp = Icons[iconKey];
      } else if (!logoUrl && iconStr && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(iconStr)) {
        const em = iconStr;
        IconComp = () => (<span className="text-base" aria-hidden>{em}</span>);
      }
    } catch {}
    const entry = {
      id: String(e.id),
      label: String(e.label || e.id),
      Icon: IconComp,
      dynamic: true,
      treeParentId: String(e.id),
      // navigation behavior: if hash provided, navigate via hash and force modules tab
      navigateToHash: typeof e.hash === 'string' && e.hash ? e.hash : null,
    };
      const beforeId = e.beforeId || null;
      const afterId = e.afterId || null;
      const index = (typeof e.index === 'number' && e.index >= 0) ? e.index : null;
      if (index != null && index <= list.length) {
        list.splice(index, 0, entry);
        continue;
      }
      const findIndex = (id) => list.findIndex((it) => it.id === id);
      if (beforeId) {
        const i = findIndex(String(beforeId));
        if (i >= 0) { list.splice(i, 0, entry); continue; }
      }
      if (afterId) {
        const i = findIndex(String(afterId));
        if (i >= 0) { list.splice(i + 1, 0, entry); continue; }
      }
      list.push(entry);
    }
    return list;
  } catch {
    return itemsBase;
  }
}

function IconBase({ className = "", children, ...props }) {
  const combined = ["h-5 w-5", className].filter(Boolean).join(" ");
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={combined}
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

function IconModules(props) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </IconBase>
  );
}

export default function Sidebar({ activeTab, setActiveTab, me, onLogout, onGoProfile }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const [hasTree, setHasTree] = useState(false);

  useEffect(() => {
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // Load dynamic sidebar entries from DB (admin only); fallback to static JSON
  useEffect(() => {
    const load = async () => { setHasTree(await fetchSidebarPresence()); };
    load();
    const onReload = () => load();
    window.addEventListener('sidebar:reload', onReload);
    return () => window.removeEventListener('sidebar:reload', onReload);
  }, [me]);

  // Auto-width for the sidebar: widen to fit the longest label (within sane caps)
  useEffect(() => {
    let raf = 0; let obs = null; let resizeTimer = null;
    const applyWidth = () => {
      try {
        const aside = document.querySelector('.app-sidebar');
        if (!aside) return;
        const labels = aside.querySelectorAll('.app-sidebar__item .truncate');
        let maxText = 0;
        labels.forEach((el) => { try { maxText = Math.max(maxText, el.scrollWidth || 0); } catch {} });
        const pad = 64; // account for icon + paddings
        const minPx = 152; // baseline 9.5rem
        const vwCap = Math.max(220, Math.floor(window.innerWidth * 0.4));
        const hardCap = 480; // absolute maximum
        const target = Math.min(hardCap, vwCap, Math.max(minPx, Math.ceil(maxText + pad)));
        const root = document.documentElement;
        const cur = getComputedStyle(root).getPropertyValue('--sidebar-width').trim();
        const curPx = cur.endsWith('rem') ? (parseFloat(cur) * 16) : (cur.endsWith('px') ? parseFloat(cur) : NaN);
        if (!Number.isFinite(curPx) || Math.abs(curPx - target) > 2) {
          root.style.setProperty('--sidebar-width', `${target}px`);
        }
      } catch {}
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(applyWidth); };
    schedule();
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(schedule, 100); };
    window.addEventListener('resize', onResize);
    try {
      const nav = document.querySelector('.app-sidebar__nav');
      if (nav && 'MutationObserver' in window) {
        obs = new MutationObserver(() => schedule());
        obs.observe(nav, { childList: true, subtree: true, characterData: true });
      }
    } catch {}
    const onReload = () => schedule();
    const onNavigate = () => schedule();
    window.addEventListener('sidebar:reload', onReload);
    window.addEventListener('app:navigate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
    return () => {
      cancelAnimationFrame(raf);
      if (obs) try { obs.disconnect(); } catch {}
      window.removeEventListener('resize', onResize);
      window.removeEventListener('sidebar:reload', onReload);
      window.removeEventListener('app:navigate', onNavigate);
      window.removeEventListener('hashchange', onNavigate);
    };
  }, []);

  // No per-user visibility: sidebar is globally managed by Module Manager
  const [flyoutFor, setFlyoutFor] = useState(null); // kept for legacy handlers

  const handleSelect = async (item) => {
    const id = typeof item === 'string' ? item : (item && item.id);
    // If the entry provides a direct hash, navigate via hash and open the modules surface
    try {
      const rawHash = (item && typeof item.hash === 'string') ? item.hash.trim() : '';
      if (rawHash) {
        let next = String(rawHash).trim();
        if (!next.startsWith('#')) next = '#' + next;
        next = next.replace(/^#(?!\/)/, '#/');
        next = next.replace(/^#\/+/, '#/');
        try {
          const root0 = next.replace(/^#\/?/, '').split('/')[0];
          // Normalize legacy alias
          if (root0 === 'agent') next = '#/agents';
        } catch {}
        // When navigating via hash, ensure the main surface is the modules view to render module pages
        try {
          const parts = next.replace(/^#\/?/, '').split('/');
          const root = parts[0];
          const known = new Set([  ]);
          if (known.has(root)) setActiveTab(root);
          else setActiveTab('modules');
        } catch { setActiveTab('modules'); }
        if (window.location.hash !== next) {
          try { window.location.hash = next; }
          catch { try { window.history.replaceState(null, '', next); } catch {} }
        } else {
          try { window.dispatchEvent(new HashChangeEvent('hashchange')); }
          catch { try { window.dispatchEvent(new Event('hashchange')); } catch {} }
        }
        setFlyoutFor(null);
        return;
      }
    } catch {}
    if (id === "settings") {
      // Route to Agents module which now owns Users & Organization
      try {
        const next = '#/agents';
        if (window.location.hash !== next) {
          try { window.location.hash = next; }
          catch { try { window.history.replaceState(null, '', next); } catch {} }
        } else {
          try { window.dispatchEvent(new HashChangeEvent('hashchange')); }
          catch { try { window.dispatchEvent(new Event('hashchange')); } catch {} }
        }
      } catch {}
      setActiveTab('modules');
      onGoProfile?.();
      return;
    }
    // Dynamic entries can embed a hash routing; find extension and apply (DB or static)
    try {
      const candidates = Array.isArray(dbExtensions)
        ? dbExtensions.map((e) => ({ id: e.id, hash: e.hash }))
        : [];
      const ext = candidates.find((e) => e && e.id === id && e.hash);
      if (ext) {
        // If this entry also has children in the tree, prefer opening the cascade menu.
        try {
          const params = new URLSearchParams();
          params.set('level', '1');
          if (item && item.treeParentId) params.set('parent_entry_id', item.treeParentId);
          // Global sidebar: do not scope by org_id; Module Manager serves a shared tree
          const res = await fetch('/api/sidebar/tree?' + params.toString());
          if (res.ok) {
            const j = await res.json();
            const hasChildren = Array.isArray(j.items) && j.items.length > 0;
            if (hasChildren) {
              setActiveTab('modules');
              setFlyoutFor(item.treeParentId);
              return;
            }
          }
        } catch {}
        // No children: navigate only if a non-empty hash is configured
        const hashStr = (typeof ext.hash === 'string') ? ext.hash.trim() : '';
        if (!hashStr) return; // nothing to navigate to
        let next = String(hashStr).trim();
        if (!next.startsWith('#')) next = '#' + next;
        next = next.replace(/^#(?!\/)/, '#/');
        next = next.replace(/^#\/+/, '#/');
        try {
          const root0 = next.replace(/^#\/?/, '').split('/')[0];
          if (root0 === 'agent') next = '#/agents';
        } catch {}
        try {
          const parts = next.replace(/^#\/?/, '').split('/');
          const root = parts[0];
          const known = new Set([  ]);
          if (known.has(root)) setActiveTab(root);
          else setActiveTab('modules');
        } catch {}
        if (window.location.hash !== next) {
          try { window.location.hash = next; }
          catch { try { window.history.replaceState(null, '', next); } catch {} }
        } else {
          try { window.dispatchEvent(new HashChangeEvent('hashchange')); }
          catch { try { window.dispatchEvent(new Event('hashchange')); } catch {} }
        }
        setFlyoutFor(null);
        return;
      }
    } catch {}
    // If this is a dynamic entry without hash, open flyout cascade menu
    if (item && typeof item === 'object' && item.dynamic && item.treeParentId) {
      setActiveTab('modules');
      setFlyoutFor(item.treeParentId);
      return;
    }
    setFlyoutFor(null);
    setActiveTab(id);
    if (id === "agent") onGoProfile?.();
  };

  // Always render sidebar; when empty, show only brand + profile
  return (
    <>
      <aside className="app-sidebar">
      <div className="app-sidebar__brand">
        <div className="app-sidebar__logo">LC</div>
        <span className="app-sidebar__brand-text">Livechat</span>
      </div>

      <nav className="app-sidebar__nav">
        {/* Standard, inline, collapsible tree rendering from DB */}
        {hasTree ? (<SidebarTreeInline level={0} setActiveTab={setActiveTab} />) : null}
      </nav>

      <div className="app-sidebar__profile" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="app-sidebar__profile-btn"
          title={me?.name || me?.email || "Profile"}
          aria-label="Profile menu"
        >
          {me ? initials(me.name || me.email) : "LC"}
        </button>
        {open && (
          <div className="app-sidebar__dropdown">
            <div>
              <div className="font-semibold leading-5">{me?.name || me?.email || "Profile"}</div>
              {me?.email && <div className="mt-1 text-xs text-slate-500 break-all">{me.email}</div>}
            </div>
            <button onClick={() => { setOpen(false); try { if (window.location.hash !== '#/agents') window.history.replaceState(null, '', '#/agents'); } catch {}; setActiveTab('modules'); onGoProfile?.(); }}>Profile</button>
            <button onClick={() => { setOpen(false); try { if (window.location.hash !== '#/agents') window.history.replaceState(null, '', '#/agents'); } catch {}; setActiveTab('modules'); }}>Notifications</button>
            <button className="danger" onClick={() => { setOpen(false); onLogout?.(); }}>Sign out</button>
          </div>
        )}
      </div>
    </aside>
      {open && <div className="app-sidebar__overlay" onClick={() => setOpen(false)} aria-hidden="true" />}
      {flyoutFor && (
        <>
        <div className="app-sidebar__flyout-overlay" onClick={()=>setFlyoutFor(null)} aria-hidden="true" />
        <div className="app-sidebar__flyout overflow-y-auto">
          <div className="px-3 py-2 text-xs text-slate-500">Menu</div>
          <SidebarTree
            parent={flyoutFor}
            level={1}
            className="px-2"
            onSelect={(node) => {
              try {
                if (!node) return;
                if (node.hash && String(node.hash).trim() !== '') {
                  setFlyoutFor(null);
                  let next = String(node.hash || '').trim();
                  if (!next.startsWith('#')) next = '#' + next;
                  next = next.replace(/^#(?!\/)/, '#/');
                  next = next.replace(/^#\/+/, '#/');
                  try {
                    const root0 = next.replace(/^#\/?/, '').split('/')[0];
                    if (root0 === 'agent') next = '#/agents';
                  } catch {}
                  try {
                    const parts = next.replace(/^#\/?/, '').split('/');
                    const root = parts[0];
                    const known = new Set([  ]);
                    if (known.has(root)) setActiveTab(root);
                    else setActiveTab('modules');
                  } catch {}
                  if (window.location.hash !== next) {
                    try { window.location.hash = next; }
                    catch { try { window.history.replaceState(null, '', next); } catch {} }
                  } else {
                    try { window.dispatchEvent(new HashChangeEvent('hashchange')); }
                    catch { try { window.dispatchEvent(new Event('hashchange')); } catch {} }
                  }
                } else {
                  // No hash -> treat as nested submenu; drill down
                  setActiveTab('modules');
                  setFlyoutFor(node.entry_id);
                }
              } catch {}
            }}
          />
        </div>
        </>
      )}
    </>
  );
}
