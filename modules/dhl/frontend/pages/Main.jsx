import React from 'react';
import ProfilesPanel from '../components/ProfilesPanel.jsx';
import ShipmentDetailsPanel from '../components/ShipmentDetailsPanel.jsx';

function fmtTs(ts) {
  try {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString();
  } catch { return String(ts || ''); }
}

function Badge({ children, tone = 'gray' }) {
  const cls = {
    gray: 'bg-gray-100 text-gray-800 border-gray-200',
    green: 'bg-green-100 text-green-800 border-green-200',
    red: 'bg-red-100 text-red-800 border-red-200',
    yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
  }[tone] || 'bg-gray-100 text-gray-800 border-gray-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded border ${cls}`}>{children}</span>
  );
}

function EventsList({ events }) {
  const items = Array.isArray(events) ? events : [];
  if (!items.length) return (<div className="text-sm text-gray-500">No events.</div>);
  return (
    <div className="space-y-2">
      {items.slice().reverse().map((ev, idx) => {
        const city = ev?.location?.city || '';
        const cc = ev?.location?.countryCode || '';
        const loc = (city || cc) ? `${city}${city && cc ? ', ' : ''}${cc}` : '';
        return (
          <div key={idx} className="p-2 rounded border bg-white">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-gray-900">{ev?.description || '(no description)'}</div>
              <div className="text-xs text-gray-600 whitespace-nowrap">{fmtTs(ev?.timestamp)}</div>
            </div>
            {loc ? <div className="text-xs text-gray-600 mt-0.5">{loc}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function CustomerCard({ customer }) {
  const c = customer && typeof customer === 'object' ? customer : null;
  if (!c) return null;
  const name = [c.firstname, c.lastname].filter(Boolean).join(' ').trim();
  const company = c.company || '';
  const email = c.email || '';
  if (!name && !company && !email) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-900">Customer</summary>
      <div className="mt-2 p-3 rounded border bg-white">
        {name ? <div className="text-sm text-gray-900"><span className="text-xs text-gray-600">Name</span><div className="font-medium">{name}</div></div> : null}
        {company ? <div className="mt-2 text-sm text-gray-900"><span className="text-xs text-gray-600">Company</span><div className="font-medium">{company}</div></div> : null}
        {email ? <div className="mt-2 text-sm text-gray-900"><span className="text-xs text-gray-600">Email</span><div className="font-mono text-sm break-all">{email}</div></div> : null}
      </div>
    </details>
  );
}

function JsonDetails({ title, data }) {
  const [copied, setCopied] = React.useState(false);
  const txt = React.useMemo(() => {
    try { return JSON.stringify(data, null, 2); } catch { return String(data); }
  }, [data]);
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-900">{title}</summary>
      <div className="mt-2 flex items-center justify-end">
        <button
          className="text-xs underline text-gray-700"
          onClick={async (e) => {
            e.preventDefault();
            try { await navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
          }}
        >
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>
      <pre className="mt-2 p-2 rounded border bg-gray-50 text-[12px] overflow-auto max-h-[420px]">{txt}</pre>
    </details>
  );
}

export default function Main() {
  const [tab, setTab] = React.useState(() => {
    try {
      const sp = new URLSearchParams(String(window.location.hash || '').split('?')[1] || '');
      return sp.get('tab') || 'track';
    } catch { return 'track'; }
  });
  const [me, setMe] = React.useState(null);
  const [orgId, setOrgId] = React.useState('');
  const [trackingNumber, setTrackingNumber] = React.useState('');
  const [language, setLanguage] = React.useState('en');
  const [includeRaw, setIncludeRaw] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  const [orderId, setOrderId] = React.useState('');
  const [dhlProfiles, setDhlProfiles] = React.useState([]);
  const [dhlProfileId, setDhlProfileId] = React.useState('');
  const [dhlProfilesBusy, setDhlProfilesBusy] = React.useState(false);
  const [dhlProfilesError, setDhlProfilesError] = React.useState('');

  React.useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        setMe(j);
        setOrgId(String(j?.org_id || 'org_default'));
      })
      .catch(() => { setMe(null); setOrgId('org_default'); });
  }, []);

  const loadDhlProfiles = React.useCallback(async () => {
    setDhlProfilesBusy(true);
    setDhlProfilesError('');
    try {
      const headers = {};
      if (orgId) headers['X-Org-Id'] = orgId;
      const r = await fetch('/api/dhl/profiles', { credentials: 'include', headers });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message || j?.error || `http_${r.status}`);
      const items = Array.isArray(j?.items) ? j.items : [];
      setDhlProfiles(items);
      try {
        if (!dhlProfileId && items.length) {
          const def = items.find((p) => p?.is_default === true) || items[0];
          if (def?.id != null) setDhlProfileId(String(def.id));
        }
      } catch {}
    } catch (e) {
      setDhlProfiles([]);
      setDhlProfilesError(e?.message || String(e));
    }
    finally { setDhlProfilesBusy(false); }
  }, [orgId, dhlProfileId]);

  React.useEffect(() => { loadDhlProfiles(); }, [loadDhlProfiles]);

  const track = React.useCallback(async (tn) => {
    const v = String(tn || '').trim();
    if (!v) { setResult({ ok: false, error: 'bad_request', message: 'Tracking number required.' }); return; }
    setBusy(true);
    try {
      const sp = new URLSearchParams();
      sp.set('trackingNumber', v);
      if (language) sp.set('language', language);
      if (dhlProfileId) sp.set('dhl_profile_id', dhlProfileId);
      if (includeRaw) sp.set('raw', '1');
      const r = await fetch(`/api/dhl/track?${sp.toString()}`, { credentials: 'include' });
      const j = await r.json().catch(() => null);
      setResult(j || { ok: false, error: 'bad_response' });
    } catch (e) {
      setResult({ ok: false, error: 'network_error', message: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }, [language, dhlProfileId, includeRaw]);

  const trackByOrder = React.useCallback(async () => {
    const id = Number(orderId || 0) || 0;
    if (!id) { setResult({ ok: false, error: 'bad_request', message: 'id_order required.' }); return; }
    if (!dhlProfileId) { setResult({ ok: false, error: 'bad_request', message: 'Select a DHL profile first (it stores API key + MySQL profile).' }); return; }
    setBusy(true);
    try {
      const sp = new URLSearchParams();
      sp.set('id_order', String(id));
      sp.set('dhl_profile_id', String(dhlProfileId));
      if (language) sp.set('language', language);
      if (includeRaw) sp.set('raw', '1');
      const r = await fetch(`/api/dhl/prestashop/order-tracking?${sp.toString()}`, { credentials: 'include' });
      const j = await r.json().catch(() => null);
      setResult(j || { ok: false, error: 'bad_response' });
    } catch (e) {
      setResult({ ok: false, error: 'network_error', message: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }, [orderId, dhlProfileId, language, includeRaw]);

  const displayed = (result && result.tracking && typeof result.tracking === 'object') ? result.tracking : result;
  const ok = displayed?.ok === true;
  const events = displayed?.events || displayed?.shipment?.events || [];
  const customer = result?.prestashop?.customer || null;
  const effectiveTrackingNumber = String(result?.tracking_number || displayed?.tracking_number || displayed?.shipment?.id || '').trim() || '';
  const dhlWebTrackingUrl = effectiveTrackingNumber ? `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encodeURIComponent(effectiveTrackingNumber)}` : '';
  const apiTrackingUrl = effectiveTrackingNumber ? (() => {
    const sp = new URLSearchParams();
    sp.set('trackingNumber', effectiveTrackingNumber);
    if (language) sp.set('language', language);
    if (dhlProfileId) sp.set('dhl_profile_id', dhlProfileId);
    sp.set('raw', '1');
    return `/api/dhl/track?${sp.toString()}`;
  })() : '';

  const setHashTab = (next) => {
    try {
      const base = String(window.location.hash || '#/dhl').split('?')[0] || '#/dhl';
      window.location.hash = `${base}?tab=${encodeURIComponent(next)}`;
    } catch {}
    setTab(next);
  };

  return (
    <div className="p-4 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">DHL Tracking</div>
          <div className="text-xs text-gray-600">Uses Shipment Tracking – Unified (EU production).</div>
          {me?.org_id ? <div className="text-[11px] text-gray-500 mt-0.5">org: <span className="font-mono">{String(me.org_id)}</span></div> : null}
        </div>
        <div className="flex items-center gap-2">
          <button className={`px-2 py-1 rounded border text-sm ${tab === 'track' ? 'bg-black text-white border-black' : 'bg-white text-gray-800'}`} onClick={() => setHashTab('track')}>Tracking</button>
          <button className={`px-2 py-1 rounded border text-sm ${tab === 'profiles' ? 'bg-black text-white border-black' : 'bg-white text-gray-800'}`} onClick={() => setHashTab('profiles')}>Profiles</button>
          <label className="flex items-center gap-2 text-xs text-gray-700 ml-2">
            <input type="checkbox" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} />
            Raw
          </label>
          <label className="text-xs text-gray-700">Language</label>
          <input className="border rounded px-2 py-1 text-sm w-20" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
        </div>
      </div>

      {tab === 'profiles' ? (
        <div className="mt-4">
          <ProfilesPanel orgId={orgId} onProfilesChanged={loadDhlProfiles} />
        </div>
      ) : null}

      {tab !== 'profiles' ? (
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 rounded border bg-gray-50">
          <div className="text-sm font-medium mb-2">Track by number</div>
          <div className="mb-2">
            <select className="w-full border rounded px-2 py-1 text-sm" value={dhlProfileId} onChange={(e) => setDhlProfileId(e.target.value)}>
              <option value="">{dhlProfilesBusy ? 'Loading DHL profiles…' : 'Select DHL profile'}</option>
              {dhlProfiles.map((p) => (
                <option key={p.id} value={String(p.id)}>{p.name || `Profile ${p.id}`}{p.is_default ? ' (default)' : ''}</option>
              ))}
            </select>
            {dhlProfilesError ? <div className="text-xs text-red-700 mt-1 break-words">{dhlProfilesError}</div> : null}
            {!dhlProfilesBusy && !dhlProfilesError && !dhlProfiles.length ? (
              <div className="text-xs text-gray-600 mt-1">Create a DHL profile in the Profiles tab (stores API key + Presta/MySQL profile).</div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded px-2 py-1 text-sm"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="JD0146000068382985"
            />
            <button
              className="px-3 py-1 rounded bg-black text-white text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => track(trackingNumber)}
            >
              Track
            </button>
          </div>
          <div className="mt-2 text-xs text-gray-600">Header `DHL-API-Key` is read server-side (never from browser).</div>
        </div>

        <div className="p-3 rounded border bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Track by Presta order</div>
            <button className="text-xs underline text-gray-700 disabled:opacity-50" disabled={dhlProfilesBusy} onClick={loadDhlProfiles}>Reload profiles</button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2">
            <div className="flex gap-2">
              <input className="flex-1 border rounded px-2 py-1 text-sm" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="id_order (e.g. 19550)" />
            </div>
            <div className="flex gap-2 items-center">
              <button
                className="px-3 py-1 rounded bg-black text-white text-sm disabled:opacity-50"
                disabled={busy}
                onClick={trackByOrder}
              >
                Track
              </button>
            </div>
            <div className="text-xs text-gray-600">
              Uses DHL profile settings (API key + MySQL profile id + prefix) to read Presta tracking and/or search by Presta reference.
            </div>
          </div>
        </div>
      </div>
      ) : null}

      <div className="mt-4 p-3 rounded border bg-white">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Result</div>
          <div className="flex items-center gap-2">
            {displayed?.cached ? <Badge tone="blue">cached</Badge> : null}
            {ok ? (displayed?.delivered ? <Badge tone="green">delivered</Badge> : <Badge tone="yellow">in transit</Badge>) : (displayed ? <Badge tone="red">error</Badge> : <Badge>idle</Badge>)}
          </div>
        </div>

        {!displayed ? (
          <div className="text-sm text-gray-600 mt-2">Enter a tracking number or a Presta order id.</div>
        ) : ok ? (
          <div className="mt-2">
            <div className="text-sm text-gray-900">
              <span className="font-medium">Status:</span> {displayed?.status?.status || '(unknown)'} <span className="text-gray-600">({fmtTs(displayed?.status?.timestamp)})</span>
            </div>
            {effectiveTrackingNumber ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <a className="text-sm underline text-gray-900" href={dhlWebTrackingUrl} target="_blank" rel="noreferrer">Open DHL tracking</a>
                <a className="text-sm underline text-gray-700" href={apiTrackingUrl} target="_blank" rel="noreferrer">Open API JSON</a>
                <span className="text-xs text-gray-600">Tracking: <span className="font-mono">{effectiveTrackingNumber}</span></span>
              </div>
            ) : null}
            {result?.tracking_number ? (
              <div className="text-xs text-gray-600 mt-1">Tracking number: <span className="font-mono">{result.tracking_number}</span></div>
            ) : null}
            <div className="mt-3">
              <div className="text-sm font-medium mb-2">Events</div>
              <EventsList events={events} />
            </div>
            <ShipmentDetailsPanel shipment={displayed?.shipment} />
            <CustomerCard customer={customer} />
            {displayed?.raw ? <JsonDetails title="Raw shipment payload (DHL API)" data={displayed.raw} /> : null}
          </div>
        ) : (
          <div className="mt-2 text-sm text-red-700">
            <div className="font-medium">{displayed?.error || 'Error'}</div>
            {displayed?.message ? <div className="text-xs mt-1 break-words">{String(displayed.message)}</div> : null}
            {result?.tracking_number ? <div className="text-xs mt-1">Tracking number: <span className="font-mono">{result.tracking_number}</span></div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
