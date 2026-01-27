import React, { useEffect, useMemo, useState, Suspense } from 'react';

// Try to reuse Tools module UI if installed; otherwise show a minimal config UI
const toolsGoogleGlob = import.meta && import.meta.glob ? import.meta.glob('../../tools/frontend/GoogleApi.jsx') : {};
const LazyToolsGoogle = React.lazy(async () => {
  try {
    const keys = Object.keys(toolsGoogleGlob || {});
    if (keys.length) {
      const mod = await toolsGoogleGlob[keys[0]]();
      const Cmp = mod?.default;
      return { default: Cmp || (() => React.createElement('div', { className:'p-4 text-sm text-red-600' }, 'Invalid Tools.GoogleApi export')) };
    }
  } catch {}
  // Fallback component will render below
  return { default: () => React.createElement('div') };
});

function FallbackGoogleApiUI() {
  const [cfg, setCfg] = useState({ client_id: '', client_secret: '', redirect_uri: '', scopes: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState({ googleapis: false, loading: true });
  const [authUrl, setAuthUrl] = useState('');
  const [oauth, setOauth] = useState({ connected: false, loading: true, lastError: '' });
  const [adminToken, setAdminToken] = useState(() => { try { return localStorage.getItem('ADMIN_TOKEN') || localStorage.getItem('admin_token') || ''; } catch { return ''; } });

  const fetchApi = async (path, init = {}) => {
    const t = (adminToken || '').trim();
    const url = new URL(path, window.location.origin);
    if (t) url.searchParams.set('admin_token', t);
    const headers = { ...(init.headers || {}) };
    if (t) headers['x-admin-token'] = t;
    return fetch(url.toString(), { ...init, headers, credentials: 'include' });
  };

  const parseScopes = (s) => {
    const str = String(s || '').trim();
    if (!str) return [];
    return str.split(/[\s,]+/).filter(Boolean);
  };

  const scopesAsString = useMemo(() => {
    const s = cfg.scopes;
    if (Array.isArray(s)) return s.join(' ');
    return String(s || '');
  }, [cfg.scopes]);

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/google-api/status', { credentials: 'include' });
      const j = await r.json();
      setStatus({ googleapis: !!j?.dependency?.googleapis, loading: false });
    } catch { setStatus({ googleapis: false, loading: false }); }
  };
  const loadOauthDebug = async () => {
    try {
      const r = await fetch('/api/google-api/oauth/debug', { credentials: 'include' });
      const j = await r.json().catch(()=>null);
      setOauth({ connected: !!j?.connected, loading: false, lastError: j?.last_error || '' });
    } catch { setOauth({ connected:false, loading:false, lastError:'' }); }
  };

  const loadConfig = async () => {
    setLoading(true); setMsg('');
    try {
      const r = await fetchApi('/api/google-api/config');
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        const c = j.config || {};
        setCfg({
          client_id: c.client_id || '',
          client_secret: '',
          redirect_uri: c.redirect_uri || '',
          scopes: Array.isArray(c.scopes) ? c.scopes : '',
        });
      } else {
        setMsg(j?.message || j?.error || 'Load failed');
      }
    } catch (e) { setMsg(String(e?.message || e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadStatus(); loadConfig(); loadOauthDebug(); }, []);
  useEffect(() => {
    const onMsg = (e) => { try { if (e?.data?.kind === 'oauth_ok') loadOauthDebug(); } catch {} };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const saveConfig = async () => {
    setSaving(true); setMsg(''); setAuthUrl('');
    try {
      const body = {
        client_id: cfg.client_id || '',
        client_secret: cfg.client_secret || '',
        redirect_uri: cfg.redirect_uri || '',
        scopes: parseScopes(scopesAsString),
      };
      const r = await fetchApi('/api/google-api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) setMsg('Saved'); else setMsg(j?.message || j?.error || 'Save failed');
    } catch (e) { setMsg(String(e?.message || e)); }
    finally { setSaving(false); }
  };

  const getAuthUrl = async () => {
    setMsg(''); setAuthUrl('');
    try {
      const r = await fetchApi('/api/google-api/auth-url');
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && j.url) setAuthUrl(j.url);
      else setMsg(j?.message || j?.error || 'Cannot build auth URL');
    } catch (e) { setMsg(String(e?.message || e)); }
  };
  const doConnect = async () => {
    try {
      const r = await fetchApi('/api/google-api/auth-url');
      const j = await r.json().catch(()=>null);
      if (r.ok && j?.ok && j.url) {
        window.open(j.url, 'google-oauth', 'width=600,height=700');
      } else {
        setMsg(j?.message || j?.error || 'Cannot open OAuth');
      }
    } catch (e) { setMsg(String(e?.message||e)); }
  };
  const testGmail = async () => {
    setMsg('');
    try {
      const r = await fetchApi('/api/google-api/oauth/gmail');
      const j = await r.json().catch(()=>null);
      setMsg(r.ok && j?.ok ? `Gmail OK — ${Array.isArray(j.labels)?j.labels.length:0} label(s)` : `Gmail erreur: ${j?.message||j?.error||r.status}`);
    } catch (e) { setMsg(String(e?.message||e)); }
  };
  const testDrive = async () => {
    setMsg('');
    try {
      const r = await fetchApi('/api/google-api/oauth/drive');
      const j = await r.json().catch(()=>null);
      setMsg(r.ok && j?.ok ? `Drive OK — ${j.count||0} fichier(s)` : `Drive erreur: ${j?.message||j?.error||r.status}`);
    } catch (e) { setMsg(String(e?.message||e)); }
  };
  const testCalendar = async () => {
    setMsg('');
    try {
      const r = await fetchApi('/api/google-api/oauth/calendar');
      const j = await r.json().catch(()=>null);
      setMsg(r.ok && j?.ok ? `Calendar OK — ${j.count||0} évènement(s)` : `Calendar erreur: ${j?.message||j?.error||r.status}`);
    } catch (e) { setMsg(String(e?.message||e)); }
  };

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div className="p-4 border-b bg-white font-semibold">Google API</div>
      <div className="p-4 space-y-4">
        <div className="text-xs text-gray-600">
          {status.loading ? 'Checking server dependencies…' : (
            status.googleapis ? (
              <span className="text-green-700">googleapis installed on server</span>
            ) : (
              <span className="text-amber-700">googleapis not installed on server — some features disabled</span>
            )
          )}
        </div>
        <div className="panel max-w-3xl">
          <div className="panel__header">Admin access</div>
          <div className="panel__body space-y-2">
            <div className="grid grid-cols-12 gap-3 items-center">
              <div className="col-span-12 md:col-span-3 text-xs text-gray-600">Admin token</div>
              <div className="col-span-12 md:col-span-9 flex items-center gap-2">
                <input className="w-full border rounded px-3 py-2" value={adminToken} onChange={(e)=>setAdminToken(e.target.value)} placeholder="x-admin-token" />
                <button className="btn" onClick={()=>{ try { localStorage.setItem('ADMIN_TOKEN', adminToken||''); localStorage.setItem('admin_token', adminToken||''); } catch {}; setMsg('Admin token saved locally'); setTimeout(()=>setMsg(''),1500); }}>Save</button>
              </div>
            </div>
          </div>
        </div>

        <div className="panel max-w-3xl">
          <div className="panel__header">OAuth configuration</div>
          <div className="panel__body space-y-3">
            <div className="grid grid-cols-12 gap-3 items-center">
              <div className="col-span-12 md:col-span-3 text-xs text-gray-600">Client ID</div>
              <div className="col-span-12 md:col-span-9">
                <input className="w-full border rounded px-3 py-2" value={cfg.client_id} onChange={(e)=>setCfg({ ...cfg, client_id:e.target.value })} placeholder="xxxxxxxx.apps.googleusercontent.com" />
              </div>
            </div>
            <div className="grid grid-cols-12 gap-3 items-center">
              <div className="col-span-12 md:col-span-3 text-xs text-gray-600">Client secret</div>
              <div className="col-span-12 md:col-span-9">
                <input type="password" className="w-full border rounded px-3 py-2" value={cfg.client_secret} onChange={(e)=>setCfg({ ...cfg, client_secret:e.target.value })} placeholder="********" />
              </div>
            </div>
            <div className="grid grid-cols-12 gap-3 items-center">
              <div className="col-span-12 md:col-span-3 text-xs text-gray-600">Redirect URI</div>
              <div className="col-span-12 md:col-span-9">
                <input className="w-full border rounded px-3 py-2" value={cfg.redirect_uri} onChange={(e)=>setCfg({ ...cfg, redirect_uri:e.target.value })} placeholder="https://<host>/api/google-api/oauth2/callback" />
              </div>
            </div>
            <div className="grid grid-cols-12 gap-3 items-center">
              <div className="col-span-12 md:col-span-3 text-xs text-gray-600">Scopes</div>
              <div className="col-span-12 md:col-span-9">
                <input className="w-full border rounded px-3 py-2" value={scopesAsString} onChange={(e)=>setCfg({ ...cfg, scopes:e.target.value })} placeholder="space or comma separated" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button className="btn btn--primary" disabled={saving} onClick={saveConfig}>Save</button>
              <button className="btn" onClick={loadConfig}>Reload</button>
              <button className="btn" onClick={getAuthUrl}>Generate auth URL</button>
              {authUrl && (
                <a className="btn btn--success" href={authUrl} target="_blank" rel="noreferrer">Open auth</a>
              )}
            </div>
            {msg && <div className="text-xs text-amber-700">{msg}</div>}
          </div>
        </div>

        <div className="panel max-w-3xl">
          <div className="panel__header">Connexion OAuth</div>
          <div className="panel__body space-y-2">
            <div className="text-xs text-gray-600">
              {oauth.loading ? 'Vérification…' : (oauth.connected ? <span className="text-green-700">Connecté</span> : <span className="text-amber-700">Non connecté</span>)}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn--primary" onClick={doConnect}>Se connecter</button>
              <button className="btn" onClick={testGmail}>Test Gmail</button>
              <button className="btn" onClick={testDrive}>Test Drive</button>
              <button className="btn" onClick={testCalendar}>Test Calendar</button>
            </div>
          </div>
        </div>

        <Mcp2SourcesPanel />
      </div>
    </div>
  );
}

function Mcp2SourcesPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  useEffect(() => {
    const load = async () => {
      setLoading(true); setMsg('');
      try {
        const r = await fetch('/api/google-api/mcp2/sources', { credentials: 'include' });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'load_failed');
        setItems(Array.isArray(j.items) ? j.items : []);
      } catch (e) { setMsg(String(e?.message || e)); }
      setLoading(false);
    };
    load();
  }, []);
  return (
    <div className="panel max-w-4xl">
      <div className="panel__header">MCP2 Sources (Gmail/Google)</div>
      <div className="panel__body">
        {msg && <div className="text-xs text-red-600 mb-2">{msg}</div>}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Module</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">HTTP</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stream/SSE</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr><td className="px-3 py-2 text-sm text-gray-500" colSpan={5}>Loading…</td></tr>
              ) : items.length ? items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-2 text-sm text-gray-900">{it.name || it.id}</td>
                  <td className="px-3 py-2 text-sm text-gray-900">{
                    (()=>{ try { const o = typeof it.options === 'string' ? JSON.parse(it.options) : (it.options||{}); return o.origin_module || o.module || (it.type_code || '—'); } catch { return it.type_code || '—'; } })()
                  }</td>
                  <td className="px-3 py-2 text-xs break-all">{it.http_base || '—'}</td>
                  <td className="px-3 py-2 text-xs break-all">
                    <div>{it.stream_url || '—'}</div>
                    <div>{it.sse_url || '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-xs space-x-2">
                    <button className="rounded bg-blue-600 text-white px-2 py-1" onClick={()=>{ try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }}>Open OAuth</button>
                    <button className="rounded bg-gray-700 text-white px-2 py-1" onClick={async ()=>{
                      setTestMsg('');
                      try {
                        const r = await fetch('/api/google-api/oauth/gmail', { credentials: 'include' });
                        const j = await r.json().catch(()=>null);
                        if (!r.ok || !j?.ok) throw new Error(j?.message || j?.error || `HTTP_${r.status}`);
                        setTestMsg(`Gmail OK — ${Array.isArray(j.labels)?j.labels.length:0} label(s)`);
                      } catch (e) { setTestMsg(String(e?.message || e)); }
                    }}>Test Gmail</button>
                  </td>
                </tr>
              )) : (
                <tr><td className="px-3 py-2 text-sm text-gray-500" colSpan={5}>No sources found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {testMsg && <div className="mt-2 text-xs text-gray-700">{testMsg}</div>}
      </div>
    </div>
  );
}

function GoogleApiMain() {
  // If Tools.GoogleApi exists, prefer it; otherwise, show fallback UI
  const hasToolsGoogle = Object.keys(toolsGoogleGlob || {}).length > 0;
  return (
    <Suspense fallback={<div className="p-4 text-sm">Loading…</div>}>
      {hasToolsGoogle ? <LazyToolsGoogle /> : <FallbackGoogleApiUI />}
    </Suspense>
  );
}

export default GoogleApiMain;
export { GoogleApiMain as Main };
