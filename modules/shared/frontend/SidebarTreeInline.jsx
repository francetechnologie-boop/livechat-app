import React, { useEffect, useState, useMemo } from 'react';
import { Icons } from './icons.jsx';

// Small helper to canonicalize and navigate to a hash, and switch the main surface
export function openHash(next, setActiveTab) {
  try {
    if (!next) return;
    let h = String(next).trim();
    if (!h.startsWith('#')) h = '#' + h;
    // Canonicalize leading markers
    h = h.replace(/^#(?!\/)/, '#/');
    h = h.replace(/^#\/+/, '#/');
    // Trim whitespace within segments
    try {
      const raw = h.replace(/^#\/?/, '');
      const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
      h = '#/' + parts.join('/');
    } catch {}
    // Switch to modules surface for any module route
    try {
      const root = h.replace(/^#\/?/, '').split('/')[0];
      if (root && typeof setActiveTab === 'function') setActiveTab('modules');
    } catch {}
    // Apply hash
    const changed = window.location.hash !== h;
    if (changed) {
      try { window.location.hash = h; }
      catch { try { window.history.replaceState(null, '', h); } catch {} }
    }
    // Proactively notify listeners even if the browser swallows the event
    try { window.dispatchEvent(new HashChangeEvent('hashchange')); }
    catch { try { window.dispatchEvent(new Event('hashchange')); } catch {} }
    try { window.dispatchEvent(new CustomEvent('app:navigate', { detail: { hash: h } })); } catch {}
  } catch {}
}

function LogoOrIcon({ icon, logo }) {
  try {
    const logoStr = typeof logo === 'string' ? logo.trim() : '';
    if (logoStr) {
      return <img src={logoStr} alt="" className="h-5 w-5 object-contain" aria-hidden />;
    }
    const iconStr = typeof icon === 'string' ? icon.trim() : '';
    if (!iconStr) {
      return <span className="inline-block h-5 w-5 rounded border border-gray-300 opacity-60" aria-hidden />;
    }
    const alias = {
      logs: 'IconActivity', log: 'IconActivity', activity: 'IconActivity',
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
    const key0 = alias[iconStr] || iconStr;
    const isUrl = /^https?:/i.test(key0) || key0.startsWith('/') || key0.startsWith('data:') || /\.(svg|png|jpg|jpeg|webp|gif)$/i.test(key0);
    if (isUrl) return <img src={key0} alt="" className="h-5 w-5 object-contain" aria-hidden />;
    if (key0.startsWith('twemoji:')) {
      const hex = (key0.split(':')[1] || '').toLowerCase();
      const src = `https://twemoji.maxcdn.com/v/14.0.2/svg/${hex}.svg`;
      return <img src={src} alt="" className="h-5 w-5 object-contain" aria-hidden />;
    }
    if (Icons && Icons[key0]) {
      const C = Icons[key0];
      return <C className="h-5 w-5" aria-hidden />;
    }
    if (/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(iconStr)) {
      return <span className="text-base" aria-hidden>{iconStr}</span>;
    }
  } catch {}
  return <span className="inline-block h-5 w-5 rounded border border-gray-300 opacity-60" aria-hidden />;
}

function Row({ node, level, isActive, expanded, onToggle, onNavigate }) {
  const hasChildren = node && (node.type === 'sous-menu' || !node.hash);
  return (
    <div className={`app-sidebar__item-row ${isActive ? 'is-active' : ''}`}> 
      <button
        type="button"
        className={`app-sidebar__item w-full ${isActive ? 'is-active' : ''}`}
        title={node.label}
        onClick={() => {
          if (node.hash && String(node.hash).trim() !== '') onNavigate(node.hash);
          else onToggle();
        }}
      >
        <span className="mr-2 inline-flex items-center justify-center h-5 w-5">
          <LogoOrIcon icon={node.icon} logo={node.logo} />
        </span>
        <span className="truncate">{node.label}</span>
        {hasChildren && (
          <span className="ml-auto text-[10px] opacity-70" aria-hidden>{expanded ? '▾' : '▸'}</span>
        )}
      </button>
    </div>
  );
}

export default function SidebarTreeInline({ parent = null, level = 0, className = '', setActiveTab }) {
  const [items, setItems] = useState([]);
  const [expanded, setExpanded] = useState({}); // entry_id -> boolean
  const [children, setChildren] = useState({}); // entry_id -> array
  const activeHash = useMemo(() => String(typeof window !== 'undefined' ? window.location.hash || '' : ''), [typeof window !== 'undefined' ? window.location.hash : '']);
  const isActiveHash = (hash) => {
    try {
      if (!hash) return false;
      let a = activeHash.replace(/^#\/?/, '');
      let b = String(hash).replace(/^#\/?/, '');
      return a.split('/')[0] === b.split('/')[0];
    } catch { return false; }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const params = new URLSearchParams();
        params.set('level', String(level));
        if (parent) params.set('parent_entry_id', String(parent));
        const res = await fetch('/api/sidebar/tree?' + params.toString(), { credentials: 'include' });
        const j = res.ok ? await res.json() : { items: [] };
        const arr = Array.isArray(j.items) ? j.items : [];
        // Global-only sidebar: do not apply per-user visibility filtering here.
        setItems(arr);
      } catch { setItems([]); }
    };
    load();
    const onReload = () => { try { load(); setExpanded({}); setChildren({}); } catch {} };
    window.addEventListener('sidebar:reload', onReload);
    const onVis = () => onReload();
    window.addEventListener('app-sidebar-visibility', onVis);
    return () => window.removeEventListener('sidebar:reload', onReload);
  }, [parent, level]);

  const ensureChildren = async (entryId) => {
    if (!entryId) return;
    if (children[entryId]) return;
    try {
      const params = new URLSearchParams();
      params.set('level', String(level + 1));
      params.set('parent_entry_id', String(entryId));
      const res = await fetch('/api/sidebar/tree?' + params.toString(), { credentials: 'include' });
      const j = res.ok ? await res.json() : { items: [] };
      setChildren((p) => ({ ...p, [entryId]: Array.isArray(j.items) ? j.items : [] }));
    } catch {
      setChildren((p) => ({ ...p, [entryId]: [] }));
    }
  };

  if (!items.length) return null;
  return (
    <ul className={`app-sidebar__tree level-${level} ${className}`}>
      {items.map((n) => {
        const exp = !!expanded[n.entry_id];
        const active = isActiveHash(n.hash);
        return (
          <li key={`${level}-${n.entry_id}`}>
            <Row
              node={n}
              level={level}
              isActive={active}
              expanded={exp}
              onToggle={async () => {
                const next = !exp;
                setExpanded((p) => ({ ...p, [n.entry_id]: next }));
                if (next) await ensureChildren(n.entry_id);
                if (!n.hash) {
                  try { setActiveTab && setActiveTab('modules'); } catch {}
                }
              }}
              onNavigate={(h) => openHash(h, setActiveTab)}
            />
            {exp && (
              <SidebarTreeInline
                parent={n.entry_id}
                level={level + 1}
                className="pl-3"
                setActiveTab={setActiveTab}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}






