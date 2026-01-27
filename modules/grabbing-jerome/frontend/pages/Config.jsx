import React from 'react';
import DomainSelector from '../components/DomainSelector.jsx';
import ExtractionConfigPanel from '../components/ExtractionConfigPanel.jsx';
import useGJState from '../hooks/useGJState.js';

export default function ConfigPage() {
  const ctx = useGJState();
  const { perfMode, domMsg } = ctx;
  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <DomainSelector ctx={ctx} />
      {domMsg && <div className="px-4 pt-2 text-xs text-red-600">{domMsg}</div>}
      <div className={"grabbing-jerome p-4 flex flex-col gap-6 " + (perfMode ? 'grabbing-jerome--perf' : '')}>
        <ExtractionConfigPanel ctx={ctx} />
      </div>
    </div>
  );
}

