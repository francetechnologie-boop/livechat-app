import React from 'react';
import TabNav from '../components/TabNav.jsx';
import NotesPanel from '../components/NotesPanel.jsx';
import IframePanel from '../components/IframePanel.jsx';
import UfwPanel from '../components/UfwPanel.jsx';
import Fail2banPanel from '../components/Fail2banPanel.jsx';
import RemoteApacheLogPanel from '../components/RemoteApacheLogPanel.jsx';
import ConnectionSettingsPanel from '../components/ConnectionSettingsPanel.jsx';
import CommandsPanel from '../components/CommandsPanel.jsx';
import GoAccessPanel from '../components/GoAccessPanel.jsx';

const TABS = [
  { id: 'uptime-kuma', label: 'Uptime Kuma' },
  { id: 'ufw', label: 'UFW' },
  { id: 'fail2ban', label: 'Fail2ban' },
  { id: 'cloudflare', label: 'Cloudflare' },
  { id: 'goaccess', label: 'GoAccess' },
  { id: 'remote-log', label: 'Remote Apache log' },
  { id: 'settings', label: 'Settings' },
  { id: 'commands', label: 'VPS Commands' },
  { id: 'cockpit', label: 'Cockpit' },
];

const DEFAULT_URLS = {
  'uptime-kuma': 'http://185.97.146.187:3002/dashboard',
  cloudflare: 'https://dash.cloudflare.com/',
  cockpit: 'https://185.97.146.187:9090/metrics',
};

export default function SecurityPage() {
  const [tab, setTab] = React.useState('uptime-kuma');
  const [adminToken, setAdminToken] = React.useState(() => {
    try { return localStorage.getItem('adminToken') || ''; } catch { return ''; }
  });
  React.useEffect(() => { try { localStorage.setItem('adminToken', adminToken || ''); } catch {} }, [adminToken]);
  React.useEffect(() => { try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Security'] })); } catch {} }, []);

  const headers = React.useMemo(() => (
    adminToken ? { 'x-admin-token': adminToken, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
  ), [adminToken]);

  const renderMain = () => {
    if (tab === 'uptime-kuma') {
      return (
        <IframePanel
          title="Uptime Kuma"
          url={DEFAULT_URLS['uptime-kuma']}
          hint="If the iframe is blocked (mixed content / X-Frame-Options), use “Open” to view it in a new tab."
        />
      );
    }
    if (tab === 'ufw') {
      return <UfwPanel headers={headers} />;
    }
    if (tab === 'fail2ban') {
      return <Fail2banPanel headers={headers} />;
    }
    if (tab === 'cloudflare') {
      return (
        <IframePanel
          title="Cloudflare"
          url={DEFAULT_URLS.cloudflare}
          hint="Cloudflare may block iframe embedding; use “Open” if needed."
        />
      );
    }
    if (tab === 'goaccess') {
      return <GoAccessPanel headers={headers} />;
    }
    if (tab === 'remote-log') {
      return <RemoteApacheLogPanel headers={headers} />;
    }
    if (tab === 'settings') {
      return <ConnectionSettingsPanel headers={headers} />;
    }
    if (tab === 'commands') {
      return <CommandsPanel headers={headers} />;
    }
    if (tab === 'cockpit') {
      return (
        <IframePanel
          title="Cockpit Metrics"
          url={DEFAULT_URLS.cockpit}
          hint="Metrics panel may enforce HTTPS; use “Open” if the iframe is blocked."
        />
      );
    }
    return null;
  };

  return (
    <div className="w-full h-full p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-lg font-semibold">Security</div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">Admin token</label>
          <input
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="x-admin-token (optional)"
            className="border rounded px-2 py-1 text-sm w-[260px]"
          />
        </div>
      </div>

      <TabNav tabs={TABS} value={tab} onChange={setTab} />

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="xl:col-span-2 min-h-0">
          {renderMain()}
        </div>

        <div className="min-h-0">
          <NotesPanel tab={tab} headers={headers} />
        </div>
      </div>
    </div>
  );
}
