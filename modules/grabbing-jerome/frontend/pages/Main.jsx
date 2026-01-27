import React from 'react';
import DomainSelector from '../components/DomainSelector.jsx';
import ExplorePanel from '../components/ExplorePanel.jsx';
import ExtractionConfigPanel from '../components/ExtractionConfigPanel.jsx';
import PrestaMappingPanel from '../components/PrestaMappingPanel.jsx';
import RunsPanel from '../components/RunsPanel.jsx';
import RunErrorsPanel from '../components/RunErrorsPanel.jsx';
import UpsertSummaryPanel from '../components/UpsertSummaryPanel.jsx';
import TestPanel from '../components/TestPanel.jsx';
import useGJState from '../hooks/useGJState.js';

export default function GrabbingJeromeMain() {
  const ctx = useGJState();
  const { stepOpen, setStepOpen, perfMode, domMsg } = ctx;

  const parseViewFromHash = React.useCallback(() => {
    try {
      const h = String(window.location.hash || '').toLowerCase();
      // Prefer path-style suffixes: #/grabbing-jerome/<view>
      const m2 = h.match(/\/grabbing-jerome\/(explore|config|mapping|tests)/);
      if (m2 && m2[1]) return m2[1];
      // Fallback to query param ?view=
      const m1 = h.match(/[?#&]view=([a-z0-9_-]+)/);
      if (m1 && m1[1]) return m1[1];
    } catch {}
    return 'explore';
  }, []);

  const [view, setView] = React.useState(() => parseViewFromHash());
  React.useEffect(() => {
    const onHash = () => { try { setView(parseViewFromHash()); } catch {} };
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('hashchange', onHash); };
  }, [parseViewFromHash]);

  const setHashView = (v) => {
    try {
      const next = `#/grabbing-jerome/${v}`;
      if (String(window.location.hash||'') !== next) window.location.hash = next;
    } finally {
      setView(v);
    }
  };

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <DomainSelector ctx={ctx} />
      {domMsg && <div className="px-4 pt-2 text-xs text-red-600">{domMsg}</div>}

      {/* Simple step tabs */}
      <div className="px-4 pt-3">
        <div className="inline-flex items-center gap-1 border rounded overflow-hidden bg-white">
          {[
            { id: 'explore', label: 'Step 1 – Explore' },
            { id: 'config', label: 'Step 2 – Extraction Config' },
            { id: 'mapping', label: 'Step 3 – Mapping & Settings' },
            { id: 'tests', label: 'Step 4 – Test + Runs' },
          ].map(t => (
            <button key={t.id}
              onClick={()=>setHashView(t.id)}
              className={"px-3 py-1.5 text-sm border-r last:border-r-0 " + (view===t.id? 'bg-indigo-600 text-white' : 'bg-white hover:bg-gray-50')}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className={"grabbing-jerome p-4 flex flex-col gap-6 " + (perfMode ? 'grabbing-jerome--perf' : '')}>
        {view==='explore' && (
          <ExplorePanel ctx={ctx} />
        )}
        {view==='config' && (
          <ExtractionConfigPanel ctx={ctx} />
        )}
        {view==='mapping' && (
          <PrestaMappingPanel ctx={ctx} />
        )}
        {view==='tests' && (
        <div className="panel order-4">
          <div className="panel__header flex items-center justify-between">
            <span>Step 4: Test Extraction</span>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div>Provide a URL and run with a config</div>
              <button className="px-2 py-1 text-xs border rounded" onClick={()=>setStepOpen(prev => ({ ...prev, 4: !prev[4] }))} aria-expanded={!!stepOpen?.[4]}>{stepOpen?.[4] ? 'Collapse' : 'Expand'}</button>
            </div>
          </div>
          <div className="panel__body space-y-3" style={{ display: stepOpen?.[4] ? undefined : 'none', contentVisibility: 'auto', contain: 'content' }}>
            <TestPanel ctx={ctx} />
            <RunsPanel ctx={ctx} />
            <RunErrorsPanel ctx={ctx} />
            <UpsertSummaryPanel ctx={ctx} />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
