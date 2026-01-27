import React, { useMemo, useState } from 'react';

import SettingsPanel from '../components/SettingsPanel.jsx';
import InventoryTablePanel from '../components/InventoryTablePanel.jsx';
import InventoryTransactionsPanel from '../components/InventoryTransactionsPanel.jsx';
import BoardPanel from '../components/BoardPanel.jsx';
import NeedsPerMonthPanel from '../components/NeedsPerMonthPanel.jsx';

const tabs = [
  { id: 'transactions', label: 'Inventory transactions', desc: 'Entrées + Ajustements' },
  { id: 'inventory', label: 'Inventory', desc: 'Edit quantities & coverage' },
  { id: 'needs', label: 'Needs per month', desc: 'Monthly demand snapshot' },
  { id: 'board', label: 'Board', desc: 'Coverage view' },
  { id: 'settings', label: 'Settings', desc: 'Locations & defaults' },
];

export default function SupplyPlanificationMain() {
  const [tab, setTab] = useState('transactions');
  const current = useMemo(() => tabs.find((t) => t.id === tab) || tabs[0], [tab]);

  return (
    <div className="w-full">
      <div className="bg-white border-b shadow-sm">
        <div className="px-4 py-4 flex flex-col gap-3">
          <div>
            <div className="text-xl font-semibold">Supply Planification</div>
            <div className="text-sm text-gray-500 mt-1">
              Track incoming PO lines, apply adjustments, and view the coverage board built from the latest inventory snapshot.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => {
              const active = t.id === current.id;
              return (
                <button
                  key={t.id}
                  className={`px-3 py-2 rounded border text-sm transition ${
                    active ? 'bg-black text-white border-black shadow-sm' : 'bg-gray-50 text-gray-700 hover:bg-white'
                  }`}
                  onClick={() => setTab(t.id)}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className={`text-xs ${active ? 'text-gray-200' : 'text-gray-500'}`}>{t.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {current.id === 'settings' ? <SettingsPanel /> : null}
      {current.id === 'inventory' ? <InventoryTablePanel /> : null}
      {current.id === 'transactions' ? <InventoryTransactionsPanel /> : null}
      {current.id === 'needs' ? <NeedsPerMonthPanel /> : null}
      {current.id === 'board' ? <BoardPanel /> : null}
    </div>
  );
}
