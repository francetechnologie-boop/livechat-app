import { useEffect, useMemo, useState } from 'react';
import TransactionsPanel from '../components/TransactionsPanel.jsx';
import ConfigPanel from '../components/ConfigPanel.jsx';
import SyncPanel from '../components/SyncPanel.jsx';
import BalancesPanel from '../components/BalancesPanel.jsx';

export default function StripeApi() {
  const [tab, setTab] = useState('transactions');
  const [orgId, setOrgId] = useState('');

  const headers = useMemo(() => {
    const h = {};
    const cleaned = String(orgId || '').trim();
    if (cleaned) h['X-Org-Id'] = cleaned;
    return h;
  }, [orgId]);

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Stripe API'] })); } catch {}
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-white">
      <header className="border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Stripe API</h1>
            <p className="text-sm text-gray-500">Transactions + configuration (multiple API keys).</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-700">
              Org ID (optionnel)
              <input
                className="ml-2 w-24 rounded border border-gray-200 px-2 py-1 text-sm"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                placeholder="1"
              />
            </label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className={`rounded px-3 py-1.5 text-sm ${tab === 'transactions' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}
            onClick={() => setTab('transactions')}
          >
            Transactions
          </button>
          <button
            className={`rounded px-3 py-1.5 text-sm ${tab === 'config' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}
            onClick={() => setTab('config')}
          >
            Configuration
          </button>
          <button
            className={`rounded px-3 py-1.5 text-sm ${tab === 'sync' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}
            onClick={() => setTab('sync')}
          >
            Sync & Backfill
          </button>
          <button
            className={`rounded px-3 py-1.5 text-sm ${tab === 'balances' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}
            onClick={() => setTab('balances')}
          >
            Balances
          </button>
        </div>
      </header>

      <main className="p-6">
        {tab === 'transactions' ? (
          <TransactionsPanel headers={headers} />
        ) : tab === 'config' ? (
          <ConfigPanel headers={headers} />
        ) : tab === 'sync' ? (
          <SyncPanel headers={headers} />
        ) : (
          <BalancesPanel headers={headers} />
        )}
      </main>
    </div>
  );
}
