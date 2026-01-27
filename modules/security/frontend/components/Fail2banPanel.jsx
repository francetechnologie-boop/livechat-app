import React from 'react';
import Fail2banAdvisorPanel from './Fail2banAdvisorPanel.jsx';
import Fail2banStatusPanel from './Fail2banStatusPanel.jsx';

function TabButton({ active, children, onClick }) {
  return (
    <button
      className={`px-3 py-1.5 rounded border text-sm ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white hover:bg-gray-50'}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export default function Fail2banPanel({ headers = {} }) {
  const [view, setView] = React.useState('advisor');

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="rounded border bg-white p-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold">Fail2ban</div>
        <div className="flex items-center gap-2">
          <TabButton active={view === 'advisor'} onClick={() => setView('advisor')}>Advisor</TabButton>
          <TabButton active={view === 'status'} onClick={() => setView('status')}>Status</TabButton>
        </div>
      </div>

      {view === 'advisor' ? <Fail2banAdvisorPanel headers={headers} /> : <Fail2banStatusPanel headers={headers} embedded />}
    </div>
  );
}

