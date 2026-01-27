import React, { useEffect, useMemo, useRef, useState } from 'react';

// Minimal, DB-backed sidebar used when modules/shared is not installed.
function initials(input = '') {
  try {
    const t = String(input || '').trim();
    if (!t) return 'LC';
    const parts = t.split(/\s+/).slice(0, 2);
    if (parts.length === 1 && t.includes('@')) return t[0].toUpperCase();
    const s = parts.map(p => (p ? p[0].toUpperCase() : '')).join('');
    return s || (t[0] ? t[0].toUpperCase() : 'LC');
  } catch { return 'LC'; }
}

export function Sidebar({ activeTab, setActiveTab, me, onLogout, onGoProfile }) {
  const RealRef = useRef(null);
  // Try to load a real shared module if present in modules/shared/frontend
  useEffect(() => {
    try {
      const CANDIDATES = {
        ...import.meta.glob('../../../modules/shared/frontend/index.js'),
        ...import.meta.glob('../../../modules/shared/frontend/index.jsx'),
        ...import.meta.glob('../../../modules/shared/frontend/index.ts'),
        ...import.meta.glob('../../../modules/shared/frontend/index.tsx'),
      };
      const keys = Object.keys(CANDIDATES || {});
      if (keys.length) {
        CANDIDATES[keys[0]]().then((mod) => {
          const Cmp = mod && (mod.Sidebar || mod.default);
          if (Cmp) RealRef.current = Cmp;
          try { window.dispatchEvent(new Event('sidebar:reload')); } catch {}
        }).catch(() => {});
      }
    } catch {}
  }, []);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sidebar/tree?level=0', { credentials: 'include' });
      const j = res.ok ? await res.json() : { items: [] };
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch {
      setItems([]);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const onReload = () => { try { load(); } catch {} };
    window.addEventListener('sidebar:reload', onReload);
    return () => window.removeEventListener('sidebar:reload', onReload);
  }, []);

  const open = (hash) => {
    try {
      if (!hash) return;
      let h = String(hash).trim();
      if (!h.startsWith('#')) h = '#' + h;
      // Ensure canonical "#/" prefix (avoid downgrading to '#<id>')
      h = h.replace(/^#(?!\/)/, '#/');
      // Collapse duplicate slashes after '#/'
      h = h.replace(/^#\/+/, '#/');
      if (window.location.hash !== h) window.location.hash = h;
      else {
        try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch { window.dispatchEvent(new Event('hashchange')); }
      }
    } catch {}
  };

  // If a real Sidebar exists, render it
  if (RealRef.current) {
    const Real = RealRef.current;
    return <Real activeTab={activeTab} setActiveTab={setActiveTab} me={me} onLogout={onLogout} onGoProfile={onGoProfile} />;
  }

  const avatar = useMemo(() => {
    const title = (me && (me.name || me.email)) || 'Agent';
    const bg = (me && me.theme_color) || '#2563eb';
    const fg = '#fff';
    return { title, bg, fg, short: initials(title) };
  }, [me]);

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__inner">
        <div className="app-sidebar__profile">
          <button className="app-sidebar__avatar" onClick={() => onGoProfile && onGoProfile()} aria-label="Profile"
            style={{ backgroundColor: avatar.bg, color: avatar.fg }}>{avatar.short}</button>
          <div className="app-sidebar__profile-meta">
            <div className="app-sidebar__profile-name">{(me && me.name) || (me && me.email) || 'Agent'}</div>
            {me ? (
              <button className="app-sidebar__profile-link" onClick={() => onGoProfile && onGoProfile()}>Mon profil</button>
            ) : (
              <a href="#/login" className="app-sidebar__profile-link">Se connecter</a>
            )}
          </div>
          {me && (
            <button className="app-sidebar__logout" title="Déconnexion" onClick={() => onLogout && onLogout()}>⎋</button>
          )}
        </div>
        <div className="app-sidebar__section">
          <div className="app-sidebar__title">Navigation</div>
          {loading ? (
            <div className="px-3 py-2 text-xs text-gray-500">Loading…</div>
          ) : (
            <ul className="app-sidebar__list">
              {items.map(it => {
                const hash = it.hash || '#';
                const iconStr = String(it.icon || '').trim();
                const logoUrl = String(it.logo || '').trim();

                const IconBase = ({ className = '', children, ...props }) => (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-5 w-5 mr-2 ${className}`} aria-hidden {...props}>
                    {children}
                  </svg>
                );
                const Icons = {
                  IconActivity: (p) => (<IconBase {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></IconBase>),
                  IconBug: (p) => (<IconBase {...p}><path d="M8 8v8M16 8v8"/><rect x="8" y="6" width="8" height="12" rx="2"/><path d="M9 4h6"/><path d="M3 13h4"/><path d="M17 13h4"/></IconBase>),
                  IconShield: (p) => (<IconBase {...p}><path d="M12 2l7 4v6c0 5-3 8-7 10-4-2-7-5-7-10V6z"/></IconBase>),
                  IconCog: (p) => (<IconBase {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.27 1.26.7 1.7a2 2 0 1 1-2.83 2.83z"/></IconBase>),
                  IconMessage: (p) => (<IconBase {...p}><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></IconBase>),
                  IconDatabase: (p) => (<IconBase {...p}><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></IconBase>),
                  IconUsers: (p) => (<IconBase {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></IconBase>),
                  IconStar: (p) => (<IconBase {...p}><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9"/></IconBase>),
                  IconLink: (p) => (<IconBase {...p}><path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5"/><path d="M14 11a5 5 0 0 0-7.07 0L5.5 12.43a5 5 0 0 0 7.07 7.07L14 19"/></IconBase>),
                  IconFolder: (p) => (<IconBase {...p}><path d="M3 7h5l2 2h11v9a2 2 0 0 1-2 2H3z"/></IconBase>),
                  IconAlert: (p) => (<IconBase {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></IconBase>),
                  IconList: (p) => (<IconBase {...p}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></IconBase>),
                  IconFile: (p) => (<IconBase {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></IconBase>),
                  IconTerminal: (p) => (<IconBase {...p}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></IconBase>),
                };

                // alias map for human-friendly names
                const ALIAS = {
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

                let iconNode = null;
                if (logoUrl) {
                  iconNode = (<img src={logoUrl} alt="" className="h-5 w-5 object-contain mr-2" aria-hidden />);
                } else if (iconStr) {
                  const keyRaw = iconStr in ALIAS ? ALIAS[iconStr] : iconStr;
                  const key = keyRaw && keyRaw.startsWith('Icon') ? keyRaw : (ALIAS[(keyRaw||'').toLowerCase()] || '');
                  if (/^https?:/i.test(iconStr) || iconStr.startsWith('/') || iconStr.startsWith('data:')) {
                    iconNode = (<img src={iconStr} alt="" className="h-5 w-5 object-contain mr-2" aria-hidden />);
                  } else if (iconStr.startsWith('twemoji:')) {
                    const hex = (iconStr.split(':')[1] || '').toLowerCase();
                    const src = `https://twemoji.maxcdn.com/v/14.0.2/svg/${hex}.svg`;
                    iconNode = (<img src={src} alt="" className="h-5 w-5 mr-2" aria-hidden />);
                  } else if (key && Icons[key]) {
                    const Cmp = Icons[key];
                    iconNode = <Cmp />;
                  } else if (/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(iconStr)) {
                    iconNode = (<span className="h-5 w-5 inline-flex items-center justify-center mr-2 text-base" aria-hidden>{iconStr}</span>);
                  }
                }
                if (!iconNode) iconNode = (<span className="h-5 w-5 inline-block rounded bg-slate-200 mr-2" aria-hidden></span>);

                return (
                  <li key={it.entry_id}>
                    <a href={hash} onClick={(e)=>{ e.preventDefault(); open(hash); }} className={`app-sidebar__link${hash===window.location.hash?' app-sidebar__link--active':''}`}>
                      {iconNode}
                      <span>{it.label || it.entry_id}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

// Lightweight icon registry used by Module Manager; keep empty if unknown
export const Icons = {};

// Stubs to satisfy optional imports in some modules
export function FlagIcon() { return null; }
export function RichEditor(props) {
  const [val, setVal] = useState(props.value || '');
  useEffect(() => { setVal(props.value || ''); }, [props.value]);
  return (
    <textarea className="w-full min-h-[140px] border rounded p-2 text-sm" value={val}
      onChange={(e)=>{ setVal(e.target.value); props.onChange && props.onChange(e.target.value); }} />
  );
}

export default { Sidebar, Icons, FlagIcon, RichEditor };
