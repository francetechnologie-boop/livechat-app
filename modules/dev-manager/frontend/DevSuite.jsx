import React, { useEffect, useState } from 'react';
import { loadModuleState, saveModuleState } from '@app-lib/uiState';
import DevTracker from './DevTracker.jsx';
import DevProjects from './DevProjects.jsx';

function Subnav({ subTab, setSubTab }) {
  const Item = ({ id, label, icon }) => (
    <button
      onClick={() => setSubTab(id)}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
        subTab === id ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-gray-50'
      }`}
    >
      <span className="text-base w-5 text-center" aria-hidden>{icon}</span>
      <span className="text-sm">{label}</span>
    </button>
  );
  return (
    <aside className="w-64 border-r bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">🧪 Development</div>
      <nav className="space-y-1">
        <Item id="projects" label="Gestion des projets" icon="📁" />
        <Item id="kanban" label="Kanban" icon="📋" />
        <Item id="summary" label="Résumé" icon="🧾" />
        <Item id="tech" label="Points techniques" icon="🧠" />
      </nav>
    </aside>
  );
}

export default function DevSuite() {
  const [subTab, setSubTab] = useState(() => {
    try {
      const st = loadModuleState('development');
      return st.subTab || 'kanban';
    } catch {
      return 'kanban';
    }
  });
  useEffect(() => {
    try {
      const allowed = new Set(['projects', 'kanban', 'summary', 'tech']);
      if (!allowed.has(subTab)) setSubTab('kanban');
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { saveModuleState('development', { subTab }); } catch {}
  }, [subTab]);

  useEffect(() => {
    const onRestore = (e) => {
      try {
        const tab = e?.detail?.modules?.['development']?.subTab;
        if (tab) setSubTab(tab);
      } catch {}
    };
    window.addEventListener('app-restore', onRestore);
    return () => window.removeEventListener('app-restore', onRestore);
  }, []);

  useEffect(() => {
    const base = ['Development'];
    let sec = null;
    if (subTab === 'projects') sec = 'Gestion des projets';
    else if (subTab === 'kanban') sec = 'Kanban';
    else if (subTab === 'summary') sec = 'Résumé';
    else if (subTab === 'tech') sec = 'Points techniques';
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: sec ? [...base, sec] : base })); } catch {}
  }, [subTab]);

  return (
    <div className="h-full w-full flex min-h-0">
      <Subnav subTab={subTab} setSubTab={setSubTab} />
      <main className="flex-1 min-h-0 flex flex-col">
        {subTab === 'projects' && <DevProjects />}
        {subTab === 'kanban' && <DevTracker forceTab="kanban" hideTabSwitcher />}
        {subTab === 'summary' && <DevTracker forceTab="summary" hideTabSwitcher />}
        {subTab === 'tech' && <DevTracker forceTab="tech" hideTabSwitcher />}
      </main>
    </div>
  );
}
