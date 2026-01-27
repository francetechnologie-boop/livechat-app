import { useEffect, useMemo, useState } from 'react';
import TransactionsPanel from '../components/TransactionsPanel.jsx';
import ConfigurationPanel from '../components/ConfigurationPanel.jsx';
import SyncBackfillPanel from '../components/SyncBackfillPanel.jsx';
import BalancesPanel from '../components/BalancesPanel.jsx';

export default function Main() {
  const [tab, setTab] = useState('transactions');
  const [orgId, setOrgId] = useState('');
  const [adminToken, setAdminToken] = useState(() => {
    try { return localStorage.getItem('ADMIN_TOKEN') || localStorage.getItem('admin_token') || ''; } catch { return ''; }
  });

  const headers = useMemo(() => {
    const h = {};
    const cleaned = String(orgId || '').trim();
    if (cleaned) h['X-Org-Id'] = cleaned;
    const tok = String(adminToken || '').trim();
    if (tok) h['x-admin-token'] = tok;
    return h;
  }, [orgId, adminToken]);

  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['FIO Banka'] })); } catch {}
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-white">
      <header className="border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">FIO Banka</h1>
            <p className="text-sm text-gray-500">Transactions + configuration + sync/backfill.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-700">
              Org ID (optionnel)
              <input
                className="ml-2 w-24 rounded border border-gray-200 px-2 py-1 text-sm"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                placeholder="1"
              />
            </label>
            <label className="text-sm text-gray-700">
              x-admin-token
              <input
                className="ml-2 w-64 rounded border border-gray-200 px-2 py-1 text-sm"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder="optional (required if ADMIN_TOKEN is set on server)"
              />
            </label>
            <button
              className="rounded bg-white px-3 py-2 text-sm text-gray-800 ring-1 ring-gray-200"
              onClick={() => {
                try {
                  localStorage.setItem('ADMIN_TOKEN', adminToken || '');
                  localStorage.setItem('admin_token', adminToken || '');
                } catch {}
              }}
              type="button"
            >
              Save token
            </button>
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
            Sync &amp; Backfill
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
          <TransactionsPanel headers={headers} orgId={orgId} />
        ) : tab === 'config' ? (
          <ConfigurationPanel headers={headers} orgId={orgId} />
        ) : tab === 'sync' ? (
          <SyncBackfillPanel headers={headers} orgId={orgId} />
        ) : (
          <BalancesPanel headers={headers} orgId={orgId} />
        )}
      </main>
    </div>
  );
}
