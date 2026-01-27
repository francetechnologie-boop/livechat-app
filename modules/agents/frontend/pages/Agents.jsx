import React, { useEffect, useMemo, useState } from 'react';
import Preferences from './AgentSettings.jsx';
import Organization from './Organization.jsx';
import Users from './Users.jsx';
import Roles from './Roles.jsx';
import Members from './Members.jsx';

function SectionLink({ label, hash, desc }) {
  return (
    <button
      type="button"
      onClick={() => {
        try {
          let next = String(hash || '').trim();
          if (!next.startsWith('#')) next = '#' + next;
          next = next.replace(/^#(?!\/)/, '#/');
          if (window.location.hash !== next) {
            window.location.hash = next;
          } else {
            try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch { try { window.dispatchEvent(new Event('hashchange')); } catch {} }
          }
        } catch {}
      }}
      className="w-full text-left rounded border border-slate-200 bg-white p-4 hover:bg-slate-50"
    >
      <div className="text-sm font-semibold">{label}</div>
      {desc && <div className="text-xs text-slate-500 mt-0.5">{desc}</div>}
    </button>
  );
}

export default function Agents() {
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? String(window.location.hash || '') : ''));
  useEffect(() => {
    const onHash = () => { try { setHash(String(window.location.hash || '')); } catch {} };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const route = useMemo(() => {
    try {
      const raw = String(hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').filter(Boolean);
      // Expect patterns: #/agents, #/agents/<section>
      if (parts[0] !== 'agents') return { key: 'home', parts };
      const sub = parts[1] || 'home';
      return { key: sub, parts };
    } catch { return { key: 'home', parts: [] }; }
  }, [hash]);

  useEffect(() => {
    try {
      const title = route.key === 'home'
        ? 'Users & Organization'
        : {
            preferences: 'Preferences',
            organization: 'Organization',
            users: 'Users',
            roles: 'Roles & Permissions',
            members: 'Members (RBAC)'
          }[route.key] || 'Users & Organization';
      window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Agents', title] }));
    } catch {}
  }, [route.key]);

  if (route.key === 'preferences') return <Preferences />;
  if (route.key === 'organization') return <Organization />;
  if (route.key === 'users') return <Users />;
  if (route.key === 'roles') return <Roles />;
  if (route.key === 'members') return <Members />;

  return (
    <div className="p-4 space-y-4">
      <div className="panel">
        <div className="panel__header">Users &amp; Organization</div>
        <div className="panel__body space-y-3">
          <SectionLink label="Preferences" hash="#/agents/preferences" desc="Language, themes and notifications." />
          <SectionLink label="Organization" hash="#/agents/organization" desc="Organization settings." />
          <SectionLink label="Users" hash="#/agents/users" desc="Invite and manage team members." />
          <SectionLink label="Roles & Permissions" hash="#/agents/roles" desc="Define roles and access policies." />
          <SectionLink label="Members (RBAC)" hash="#/agents/members" desc="Attach users to roles and scopes." />
        </div>
      </div>
    </div>
  );
}
