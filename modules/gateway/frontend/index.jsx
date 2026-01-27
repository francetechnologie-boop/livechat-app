import React from 'react';

function useAdminFetch() {
  return React.useCallback(async (path, init = {}) => {
    const t = (() => { try { return localStorage.getItem('ADMIN_TOKEN') || localStorage.getItem('admin_token') || ''; } catch { return ''; } })();
    const url = new URL(path, window.location.origin);
    if (t) url.searchParams.set('admin_token', t);
    const headers = { ...(init.headers || {}) };
    if (t) headers['x-admin-token'] = t;
    return fetch(url.toString(), { ...init, headers, credentials: 'include' });
  }, []);
}

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center">
      <div className="col-span-12 md:col-span-3 text-xs text-gray-600">{label}</div>
      <div className="col-span-12 md:col-span-9">{children}</div>
    </div>
  );
}

function GatewayPage() {
  const fetchApi = useAdminFetch();
  const [msg, setMsg] = React.useState('');
  const [status, setStatus] = React.useState(null);
  const [conf, setConf] = React.useState(null);
  const [baseUrl, setBaseUrl] = React.useState('');
  const [token, setToken] = React.useState('');
  const [lines, setLines] = React.useState([]);
  const [defaultSub, setDefaultSub] = React.useState(null);
  const [editMsisdn, setEditMsisdn] = React.useState({});
  const [conn, setConn] = React.useState({
    socket_connected: false,
    socket_count: 0,
    device_socket_connected: false,
    device_socket_count: 0,
    temp_socket_count: 0,
    socket_since: null,
    last_activity_at: null,
  });
  const [prestaProfiles, setPrestaProfiles] = React.useState([]);
  const [prestaProfileId, setPrestaProfileId] = React.useState('');
  const [prestaPrefix, setPrestaPrefix] = React.useState('ps_');
  const [prestaShops, setPrestaShops] = React.useState([]);
  const [shopSubMap, setShopSubMap] = React.useState({});
  const [shopMapMsg, setShopMapMsg] = React.useState('');
  const [shopMapBusy, setShopMapBusy] = React.useState(false);
  const [shopFilter, setShopFilter] = React.useState('');
  const [lineTestBusy, setLineTestBusy] = React.useState({});
  const [lineTestMsg, setLineTestMsg] = React.useState({});
  const TEST_PHONE_NUMBER = '+420731217483';
  const TEST_PHONE_MESSAGE = 'Phone lines TEST ';

  const loadPing = React.useCallback(async ()=>{
    try { const r = await fetch('/api/gateway/ping', { credentials:'include' }); const j = await r.json(); setStatus(j); } catch { setStatus({ ok:false }); }
  }, []);
  const loadConfig = React.useCallback(async ()=>{
    setMsg('');
    try {
      const r = await fetchApi('/api/admin/gateway/config');
      const j = await r.json();
      if (r.ok && j && j.ok) {
        setConf(j);
        setBaseUrl((j && j.base_url) || '');
      } else setMsg((j && (j.message||j.error)) || 'Load failed');
    }
    catch (e) { setMsg(String(e && e.message ? e.message : e)); }
  }, [fetchApi]);

  React.useEffect(()=>{ loadPing(); loadConfig(); }, [loadPing, loadConfig]);

  const loadLines = React.useCallback(async ()=>{
    try {
      const r = await fetchApi('/api/admin/gateway/lines');
      const j = await r.json();
      if (r.ok && j && j.ok) {
        setLines(Array.isArray(j.items) ? j.items : []);
        setDefaultSub(j.default_subscription_id ?? null);
      }
    } catch {}
  }, [fetchApi]);
  React.useEffect(()=>{ loadLines(); }, [loadLines]);

  const loadPrestaProfiles = React.useCallback(async () => {
    try {
      const r = await fetchApi('/api/db-mysql/profiles');
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && j.ok) {
        const items = Array.isArray(j.items) ? j.items : [];
        setPrestaProfiles(items);
      }
    } catch {}
  }, [fetchApi]);

  const loadShopSubscriptionMap = React.useCallback(async () => {
    try {
      const r = await fetchApi('/api/admin/gateway/shop-subscriptions');
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && j.ok) {
        setShopSubMap((j && j.mapping) || {});
        const pid = j?.prestashop?.profile_id;
        const pref = j?.prestashop?.prefix;
        if (pid != null && pid !== '') setPrestaProfileId(String(pid));
        if (pref) setPrestaPrefix(String(pref));
      }
    } catch {}
  }, [fetchApi]);

  const savePrestaSettings = async () => {
    setShopMapMsg('');
    setShopMapBusy(true);
    try {
      const pid = (prestaProfileId || '').trim();
      const body = {
        prestashop_profile_id: pid ? Number(pid) : null,
        prestashop_prefix: (prestaPrefix || 'ps_').trim(),
      };
      const r = await fetchApi('/api/admin/gateway/shop-subscriptions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && j.ok) {
        setShopSubMap(j.mapping || {});
        setShopMapMsg('Saved.');
      } else {
        setShopMapMsg((j && (j.message || j.error)) || 'Save failed');
      }
    } catch (e) {
      setShopMapMsg(String(e?.message || e));
    } finally {
      setShopMapBusy(false);
      setTimeout(() => setShopMapMsg(''), 1600);
    }
  };

  const loadPrestaShops = async () => {
    setShopMapMsg('');
    setShopMapBusy(true);
    try {
      const pid = (prestaProfileId || '').trim();
      if (!pid) { setShopMapMsg('Select a MySQL profile first.'); return; }
      const q = new URLSearchParams({ profile_id: pid, prefix: (prestaPrefix || 'ps_').trim() || 'ps_' });
      const r = await fetchApi(`/api/admin/gateway/prestashop/shops?${q.toString()}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && j.ok) {
        setPrestaShops(Array.isArray(j.items) ? j.items : []);
        setShopMapMsg(`Loaded shops: ${(j.items && j.items.length) || 0}`);
      } else {
        setPrestaShops([]);
        setShopMapMsg((j && (j.message || j.error)) || 'Load failed');
      }
    } catch (e) {
      setPrestaShops([]);
      setShopMapMsg(String(e?.message || e));
    } finally {
      setShopMapBusy(false);
      setTimeout(() => setShopMapMsg(''), 1600);
    }
  };

  const setShopSubscription = async (idShop, subId) => {
    setShopMapBusy(true);
    try {
      const body = { id_shop: idShop, subscription_id: subId ? Number(subId) : null };
      const r = await fetchApi('/api/admin/gateway/shop-subscriptions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j && j.ok) {
        setShopSubMap(j.mapping || {});
      } else {
        setShopMapMsg((j && (j.message || j.error)) || 'Save failed');
      }
    } catch (e) {
      setShopMapMsg(String(e?.message || e));
    } finally {
      setShopMapBusy(false);
    }
  };

  React.useEffect(()=>{ loadPrestaProfiles(); loadShopSubscriptionMap(); }, [loadPrestaProfiles, loadShopSubscriptionMap]);

  const setDefaultLine = async (subId) => {
    try {
      const r = await fetchApi('/api/admin/gateway/lines/default', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ subscription_id: subId }) });
      const j = await r.json();
      if (r.ok && j && j.ok) setDefaultSub(j.subscription_id);
    } catch {}
  };
  const loadConn = React.useCallback(async ()=>{
    try { const r = await fetchApi('/api/admin/gateway/status'); const j = await r.json(); if (r.ok && j) setConn(j); } catch {}
  }, [fetchApi]);
  React.useEffect(()=>{ loadConn(); const t = setInterval(loadConn, 5000); return () => clearInterval(t); }, [loadConn]);
  // Helper to report lines via HTTP using DB token (for test only)
  const reportLinesTest = async (subset = null) => {
    setMsg('');
    try {
      // Get token (admin-only reveal)
      let tok = (token || '').trim();
      if (!tok) {
        try { const r = await fetchApi('/api/admin/gateway/config?reveal=1'); const j = await r.json(); if (r.ok && j && j.ok && j.token) tok = j.token; } catch {}
      }
      if (!tok) { setMsg('Missing gateway token in DB'); return; }
      // Build payload from current lines or subset
      let arr = Array.isArray(subset) ? subset : (Array.isArray(lines) ? lines : []);
      if (!arr.length) {
        // Fall back to selected subscription from Test Center
        const subSel = (tSub || '').trim();
        if (!subSel) { setMsg('No lines to report'); return; }
        arr = [{ subscription_id: Number(subSel), sim_slot: 0, carrier: 'TEST', display_name: 'Browser', msisdn: '' }];
      }
      const body = {
        device_id: 'browser-test',
        lines: arr.map(x => ({ subscription_id: x.subscription_id, sim_slot: x.sim_slot ?? 0, carrier: x.carrier || null, display_name: x.display_name || null, msisdn: x.msisdn || null }))
      };
      const r = await fetch('/api/gateway/lines', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${tok}` }, body: JSON.stringify(body) });
      const j = await r.json();
      if (r.ok && j && j.ok) { setMsg(`Lines updated (${j.updated||0})`); await loadLines(); }
      else setMsg((j && (j.message||j.error)) || `HTTP_${r.status}`);
    } catch (e) { setMsg(String(e?.message||e)); }
  };
  const testPing = async ()=>{
    setMsg('');
    try {
      const doPing = async () => {
        const r = await fetchApi('/api/admin/gateway/test', { method:'POST' });
        const j = await r.json();
        return { ok: !!(r.ok && j && j.ok), error: (j && (j.error||'')) || (!r.ok && String(r.status)) || '', raw: j };
      };
      // First attempt
      let res = await doPing();
      if (res.ok) { setMsg('Ping OK'); await loadConn(); return; }
      if (String(res.error).includes('no_device')) {
        setMsg('Ping failed: no_device (no Android device connected).');
        await loadConn();
        return;
      }
      if (String(res.error).includes('no_client')) {
        // Auto-spawn a temporary client using the DB token, then retry once
        const ok = await ensureTempClient();
        if (!ok) { setMsg('Ping failed: no_client (temp client unavailable)'); await loadConn(); return; }
        await new Promise((r)=>setTimeout(r, 400));
        res = await doPing();
        if (res.ok) setMsg('Ping OK (via temp client)');
        else setMsg(`Ping failed: ${String(res.error||'unknown')}`);
        await loadConn();
        return;
      }
      setMsg(`Ping failed: ${String(res.error||'unknown')}`);
      await loadConn();
    } catch (e) { setMsg(String(e?.message || e)); }
  };

  // Optional: spawn a temporary in-browser Socket.IO client using the DB token
  const tempClientRef = React.useRef(null);
  const ensureTempClient = async () => {
    try {
      const already = tempClientRef.current && tempClientRef.current.connected;
      if (already) return true;
      // Try state token first; otherwise reveal from DB
      let tok = (token || '').trim();
      if (!tok) {
        try {
          const r = await fetchApi('/api/admin/gateway/config?reveal=1');
          const j = await r.json();
          if (r.ok && j && j.ok && j.token) tok = j.token;
        } catch {}
      }
      const origin = (() => {
        try {
          const raw = String((baseUrl || (conf && conf.base_url) || '').trim() || '');
          if (raw) return new URL(raw).origin;
        } catch {}
        return window.location.origin;
      })();
      if (!tok || !origin) { setMsg('Missing origin or token'); return false; }
      const { io } = await import('https://cdn.socket.io/4.7.5/socket.io.esm.min.js');
      const url = origin.replace(/\/$/, '') + '/gateway';
      const s = io(url, { path:'/socket', transports:['websocket'], query:{ token: tok, client: 'admin_temp' } });
      // Minimal handlers so admin tests succeed even with only the temp client connected
      s.on('server:ping', (...args) => {
        const ack = args[args.length - 1];
        if (typeof ack === 'function') ack({ ok:true, pong:true, ts: Date.now() });
      });
      await new Promise((resolve) => { s.on('connect', resolve); s.on('connect_error', () => resolve()); setTimeout(resolve, 2000); });
      tempClientRef.current = s;
      try { window.__gwTmp = s; } catch {}
      return !!s.connected;
    } catch (e) { setMsg(String(e?.message||e)); return false; }
  };
  const disconnectTempClient = async () => { try { tempClientRef.current?.disconnect(); } catch {} finally { tempClientRef.current = null; } };
  React.useEffect(() => { return () => { disconnectTempClient(); }; }, []);

  // Auto-connect a temporary client using the DB token if no client is connected
  const autoClientAttemptedRef = React.useRef(false);
  React.useEffect(() => {
    try {
      if (!conn || conn.socket_connected) return;
      if (autoClientAttemptedRef.current) return;
      autoClientAttemptedRef.current = true;
      (async () => { const ok = await ensureTempClient(); if (ok) { try { setMsg('Temp client connected'); } catch {} } await loadConn(); })();
    } catch {}
  }, [conn && conn.socket_connected]);

  // Test Center state + helpers
  const [tTo, setTTo] = React.useState('');
  const [tMsg, setTMsg] = React.useState('Hello from Gateway test');
  const [tSub, setTSub] = React.useState('');
  const [tOut, setTOut] = React.useState('');
  const [logs, setLogs] = React.useState([]);
  const loadLogs = React.useCallback(async ()=>{
    try { const r = await fetchApi('/api/admin/gateway/logs'); const j = await r.json(); if (r.ok && j && j.ok && Array.isArray(j.items)) setLogs(j.items); } catch {}
  }, [fetchApi]);
  React.useEffect(()=>{ loadLogs(); const t = setInterval(loadLogs, 5000); return () => clearInterval(t); }, [loadLogs]);
  const clearLogs = async ()=>{ try { await fetchApi('/api/admin/gateway/logs/clear', { method:'POST' }); await loadLogs(); } catch {} };
  const json = (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v) } };
  const postJson = async (url, body) => {
    const r = await fetchApi(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body||{}) });
    const text = await r.text(); let j; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw:text } }
    return { ok: r.ok, status: r.status, body: j };
  };
  const sendSmsViaSocket = async () => {
    setTOut('');
    try {
      const subSel = (tSub||'').trim();
      if (!subSel) { setTOut('Select a Subscription first'); return; }
      const payload = { to: (tTo||'').trim(), message: (tMsg||'').trim(), subscription_id: Number(subSel) };
    const r = await postJson('/api/admin/gateway/sms/send', payload);
    setTOut(json(r));
    await loadConn();
  } catch (e) { setTOut(String(e?.message||e)); }
  };
  const placeCallViaSocket = async () => {
    setTOut('');
    try {
      const subSel = (tSub||'').trim();
      if (!subSel) { setTOut('Select a Subscription first'); return; }
      const payload = { to: (tTo||'').trim(), subscription_id: Number(subSel) };
      const r = await postJson('/api/admin/gateway/call/make', payload);
      setTOut(json(r));
      await loadConn();
    } catch (e) { setTOut(String(e?.message||e)); }
  };
  const simulateIncomingSms = async () => {
    setTOut('');
    const body = { from: (tTo||'').trim() || '+33000000000', to: '', message: (tMsg||'').trim() };
    const r = await postJson('/api/gateway/sms/incoming', body);
    setTOut(json(r));
  };
  const simulateSmsStatus = async () => {
    setTOut('');
    const body = { message_id: 'test-1', status: 'delivered', error: null };
    const r = await postJson('/api/gateway/sms/status', body);
    setTOut(json(r));
  };
  const simulateCall = async () => {
    setTOut('');
    const body = { from: (tTo||'').trim() || '+33000000000', to: '', kind: 'incoming', when: Date.now() };
    const r = await postJson('/api/gateway/calls', body);
    setTOut(json(r));
  };

  const setLineBusyFor = (subId, value) => {
    try { setLineTestBusy((prev) => ({ ...(prev || {}), [String(subId)]: !!value })); } catch {}
  };
  const setLineMsgFor = (subId, value) => {
    try { setLineTestMsg((prev) => ({ ...(prev || {}), [String(subId)]: String(value || '') })); } catch {}
  };
  const testSmsForLine = async (subId) => {
    const sid = Number(subId);
    if (!Number.isFinite(sid) || sid <= 0) return;
    setLineBusyFor(sid, true);
    setLineMsgFor(sid, '');
    try {
      const payload = { to: TEST_PHONE_NUMBER, message: TEST_PHONE_MESSAGE, subscription_id: sid };
      const r = await postJson('/api/admin/gateway/sms/send', payload);
      if (r.ok && r.body && r.body.ok) {
        setLineMsgFor(sid, `OK${r.body.message_id ? ` · message_id: ${r.body.message_id}` : ''}`);
      } else {
        const err = String((r.body && (r.body.error || r.body.message)) || `HTTP_${r.status}`);
        if (err === 'no_device') setLineMsgFor(sid, 'ERR no_device (Android gateway not connected)');
        else if (err === 'loopback_client') setLineMsgFor(sid, 'ERR loopback_client (browser temp client)');
        else setLineMsgFor(sid, `ERR ${err}`);
      }
    } catch (e) {
      setLineMsgFor(sid, `ERR ${String(e?.message || e)}`);
    } finally {
      setLineBusyFor(sid, false);
      try { setTimeout(() => setLineMsgFor(sid, ''), 6000); } catch {}
    }
  };

  // Preselect subscription from phone lines (prefer defaultSub)
  React.useEffect(() => {
    try {
      if (!Array.isArray(lines) || !lines.length) return;
      if ((tSub||'').trim()) return;
      const chosen = (defaultSub != null ? String(defaultSub) : '') || String(lines[0]?.subscription_id || '');
      if (chosen) setTSub(chosen);
    } catch {}
  }, [lines, defaultSub]);

  const kotlinSnippet = React.useMemo(() => {
    try {
      const base = String((baseUrl || (conf && conf.base_url) || '').trim() || 'https://chat.piscinesondespro.fr').replace(/\/$/, '');
      const tok = (token || (conf && conf.token) || '').trim() || 'REPLACE_WITH_SECURE_TOKEN';
      return `package com.livechat.gateway.core\n\nobject Config {\n    const val BASE_URL = "${base}"\n    const val SOCKET_URL = BASE_URL\n    const val SOCKET_PATH = "/socket"\n    const val SOCKET_NAMESPACE = "/gateway"\n\n    // Gateway HTTP endpoints (namespaced)\n    const val API_SMS_INCOMING = "$BASE_URL/api/gateway/sms/incoming"\n    const val API_SMS_STATUS   = "$BASE_URL/api/gateway/sms/status"\n    const val API_CALL_LOG     = "$BASE_URL/api/gateway/calls"\n\n    // For testing only — prefer loading from secure storage at runtime\n    const val GATEWAY_TOKEN = "${tok}"\n    const val NOTIF_CHANNEL_ID = "gateway"\n}`;
    } catch { return '' }
  }, [baseUrl, conf, token]);

  const copyText = async (text) => { try { await navigator.clipboard.writeText(String(text||'')); setMsg('Copied'); setTimeout(()=>setMsg(''), 800); } catch {} };
  const saveMsisdn = async (subId) => {
    try {
      const msisdn = (editMsisdn[subId] || '').trim();
      const r = await fetchApi('/api/admin/gateway/lines/set_msisdn', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ subscription_id: subId, msisdn }) });
      const j = await r.json();
      if (r.ok && j && j.ok) loadLines();
    } catch {}
  };

  const doGenerate = async ()=>{
    setMsg('');
    try { const r = await fetchApi('/api/admin/gateway/token/regenerate', { method:'POST' }); const j = await r.json(); if (r.ok && j && j.ok) { setToken(j.token||''); setMsg('Token regenerated'); loadConfig(); } else setMsg((j && (j.message||j.error)) || 'Failed'); }
    catch (e) { setMsg(String(e && e.message ? e.message : e)); }
  };
  const doSaveBase = async ()=>{
    setMsg('');
    try {
      const body = { base_url: String(baseUrl||'').trim() };
      const r = await fetchApi('/api/admin/gateway/base-url', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const j = await r.json();
      if (r.ok && j && j.ok) { setMsg('Base URL saved'); loadConfig(); }
      else setMsg((j && (j.message||j.error)) || 'Save failed');
    } catch (e) { setMsg(String(e?.message || e)); }
  };
  const doSave = async ()=>{
    setMsg('');
    try { const body = { token }; const r = await fetchApi('/api/admin/gateway/token', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); const j = await r.json(); if (r.ok && j && j.ok) { setMsg('Saved'); loadConfig(); } else setMsg((j && (j.message||j.error)) || 'Save failed'); }
    catch (e) { setMsg(String(e && e.message ? e.message : e)); }
  };

  return (
    <div className="p-4">
      <div className="panel max-w-3xl">
        <div className="panel__header flex items-center justify-between">
          <div>Gateway</div>
          <div className="text-xs text-gray-600">{status && status.ok ? 'Online' : 'Offline'}</div>
        </div>
        <div className="panel__body space-y-3">
          {msg && <div className="text-xs text-emerald-700">{msg}</div>}
          <Field label="Base URL">
            <div className="flex items-center gap-2">
              <input className="border rounded px-2 py-1 w-full" placeholder="https://chat.example.com" value={baseUrl} onChange={(e)=>setBaseUrl(e.target.value)} />
              <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={doSaveBase}>Save</button>
            </div>
            <div className="text-[11px] text-gray-600 mt-1">Source: {(conf && conf.source) || 'n/a'}</div>
          </Field>
          <Field label="Endpoints">
            <div className="text-xs">
              <div>SMS incoming: <code>{(conf && conf.endpoints && conf.endpoints.sms_incoming) || '—'}</code></div>
              <div>SMS status: <code>{(conf && conf.endpoints && conf.endpoints.sms_status) || '—'}</code></div>
              <div>Calls: <code>{(conf && conf.endpoints && conf.endpoints.calls) || '—'}</code></div>
            </div>
          </Field>
          <Field label="Token">
            <div className="flex items-center gap-2">
              <input className="border rounded px-2 py-1 w-full" placeholder="Gateway token" value={token} onChange={(e)=>setToken(e.target.value)} />
              <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={doSave}>Save</button>
              <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={doGenerate}>Regenerate</button>
            </div>
            <div className="text-[11px] text-gray-600 mt-1">Current: {conf && conf.has_token ? 'present' : 'missing'}</div>
          </Field>
          <div className="text-xs text-gray-600">Set the token in your Android gateway app and use the Socket.IO namespace <code>/gateway</code> with ?token=…</div>
          <div className="text-xs text-gray-600">If you see "Unexpected token &lt;", set an admin token in this browser: open DevTools &gt; Console and run <code>localStorage.setItem('ADMIN_TOKEN', 'YOUR_ADMIN_TOKEN')</code>, then reload.</div>
        </div>
      </div>

      <div className="panel max-w-5xl mt-4">
        <div className="panel__header">Phone lines</div>
        <div className="panel__body">
          <div className="mb-3 text-xs text-gray-600 flex items-center gap-3">
            <span>
              Gateway device:{' '}
              {(conn.device_socket_connected ?? conn.socket_connected) ? 'Connected' : 'Disconnected'} ({conn.device_socket_count || 0})
              {conn.temp_socket_count ? ` · temp: ${conn.temp_socket_count}` : ''}
            </span>
            <button className="text-xs px-2 py-0.5 border rounded" onClick={loadConn}>Refresh</button>
            <button className="text-xs px-2 py-0.5 border rounded" onClick={testPing}>Test ping</button>
            <button className="text-xs px-2 py-0.5 border rounded" title="Report current lines via HTTP using DB token (test)" onClick={()=>reportLinesTest()}>Mark Online (test)</button>
          </div>
          <div className="text-xs text-gray-600 mb-2">Lines reported by the Android gateway (subscription, SIM slot, carrier, MSISDN).</div>
          <div className="overflow-auto">
            <table className="table-auto text-sm min-w-[980px]">
              <thead>
                <tr className="text-left">
                  <th className="px-2 py-1">Subscription</th>
                  <th className="px-2 py-1">SIM slot</th>
                  <th className="px-2 py-1">Carrier</th>
                  <th className="px-2 py-1">Display</th>
                  <th className="px-2 py-1">MSISDN</th>
                  <th className="px-2 py-1">Last seen</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Default</th>
                  <th className="px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((li) => {
                  const seenTs = li.last_seen ? Date.parse(li.last_seen) : 0;
                  const recent = seenTs && (Date.now() - seenTs) < 60_000;
                  const deviceConnected = !!(conn.device_socket_connected ?? conn.socket_connected);
                  const online = deviceConnected && recent;
                  return (
                    <tr key={li.id} className="border-t">
                      <td className="px-2 py-1">{li.subscription_id ?? ''}</td>
                      <td className="px-2 py-1">{li.sim_slot ?? ''}</td>
                      <td className="px-2 py-1">{li.carrier || ''}</td>
                      <td className="px-2 py-1">{li.display_name || ''}</td>
                      <td className="px-2 py-1">
                        <input className="input w-48 border rounded px-2 py-1" placeholder={li.msisdn || '+33...'} value={editMsisdn[li.subscription_id] ?? (li.msisdn || '')} onChange={(e)=>setEditMsisdn((prev)=>({ ...prev, [li.subscription_id]: e.target.value }))} />
                      </td>
                      <td className="px-2 py-1">{li.last_seen ? new Date(li.last_seen).toLocaleString() : ''}</td>
                      <td className="px-2 py-1">
                        {online ? (
                          <span className="inline-flex items-center gap-1 text-green-700 text-xs" title="Socket.IO device connected + recent /api/gateway/lines report">
                            <span className="inline-block h-2 w-2 rounded-full bg-green-600" /> Online
                          </span>
                        ) : deviceConnected ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 text-xs" title="Socket.IO device connected, but phone lines were not reported recently via /api/gateway/lines">
                            <span className="inline-block h-2 w-2 rounded-full bg-amber-600" /> Connected (stale)
                          </span>
                        ) : recent ? (
                          <span className="inline-flex items-center gap-1 text-gray-600 text-xs" title="Phone lines were reported recently, but Socket.IO device is currently disconnected">
                            <span className="inline-block h-2 w-2 rounded-full bg-gray-500" /> Stale (socket down)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-gray-500 text-xs" title="No Socket.IO device and no recent /api/gateway/lines report">
                            <span className="inline-block h-2 w-2 rounded-full bg-gray-400" /> Offline
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {defaultSub === li.subscription_id ? (
                          <span className="text-green-700 text-xs">Default</span>
                        ) : (
                          <button className="text-xs px-2 py-0.5 border rounded" onClick={() => setDefaultLine(li.subscription_id)}>Set default</button>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-2">
                          <button className="text-xs px-2 py-0.5 border rounded" onClick={() => saveMsisdn(li.subscription_id)}>Save</button>
                          <button
                            className="text-xs px-2 py-0.5 border rounded"
                            onClick={() => testSmsForLine(li.subscription_id)}
                            disabled={!!(lineTestBusy && lineTestBusy[String(li.subscription_id)])}
                            title={`Send test SMS to ${TEST_PHONE_NUMBER}`}
                          >
                            {lineTestBusy && lineTestBusy[String(li.subscription_id)] ? 'Testing…' : 'Test SMS'}
                          </button>
                        </div>
                        {!!(lineTestMsg && lineTestMsg[String(li.subscription_id)]) && (
                          <div className="text-[11px] text-gray-600 mt-1">{lineTestMsg[String(li.subscription_id)]}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!lines.length && (
                  <tr><td className="px-2 py-2 text-gray-500" colSpan={9}>No lines reported yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel max-w-5xl mt-4">
        <div className="panel__header">Shop → Subscription</div>
        <div className="panel__body space-y-3">
          <div className="text-xs text-gray-600">Associate each PrestaShop <code>id_shop</code> with a Gateway <code>subscription_id</code> (SMS line).</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <div className="text-xs text-gray-600 mb-1">MySQL profile</div>
              <select className="border rounded px-2 py-1 w-full bg-white" value={prestaProfileId} onChange={(e)=>setPrestaProfileId(e.target.value)} disabled={shopMapBusy}>
                <option value="">— Select profile —</option>
                {(prestaProfiles || []).map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name ? `${p.name} (#${p.id})` : `Profile #${p.id}`}</option>
                ))}
              </select>
              <div className="text-[11px] text-gray-500 mt-1">Profiles from <code>/api/db-mysql/profiles</code>.</div>
            </div>
            <div>
              <div className="text-xs text-gray-600 mb-1">Table prefix</div>
              <input className="border rounded px-2 py-1 w-full" value={prestaPrefix} onChange={(e)=>setPrestaPrefix(e.target.value)} disabled={shopMapBusy} placeholder="ps_" />
            </div>
            <div className="flex gap-2">
              <button className="text-xs px-2 py-1 border rounded" onClick={savePrestaSettings} disabled={shopMapBusy}>Save</button>
              <button className="text-xs px-2 py-1 border rounded" onClick={loadPrestaShops} disabled={shopMapBusy || !(prestaProfileId||'').trim()}>Load shops</button>
            </div>
          </div>
          {shopMapMsg ? <div className="text-xs text-gray-700">{shopMapMsg}</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
            <div>
              <div className="text-xs text-gray-600 mb-1">Filter</div>
              <input className="border rounded px-2 py-1 w-full" placeholder="id_shop, name…" value={shopFilter} onChange={(e)=>setShopFilter(e.target.value)} />
            </div>
            <div className="text-xs text-gray-500">
              Tip: make sure your Android gateway reported lines above so subscriptions exist.
            </div>
          </div>

          <div className="overflow-auto">
            <table className="table-auto text-sm min-w-[980px]">
              <thead>
                <tr className="text-left">
                  <th className="px-2 py-1">id_shop</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Active</th>
                  <th className="px-2 py-1">Subscription</th>
                </tr>
              </thead>
              <tbody>
                {(prestaShops || [])
                  .filter((s) => {
                    const f = String(shopFilter || '').trim().toLowerCase();
                    if (!f) return true;
                    const hay = `${s.id_shop||''} ${s.name||''}`.toLowerCase();
                    return hay.includes(f);
                  })
                  .map((s) => {
                    const idShop = s.id_shop;
                    const selected = shopSubMap && shopSubMap[String(idShop)] != null ? String(shopSubMap[String(idShop)]) : '';
                    return (
                      <tr key={String(idShop)} className="border-t">
                        <td className="px-2 py-1">{idShop}</td>
                        <td className="px-2 py-1">{s.name || ''}</td>
                        <td className="px-2 py-1">{s.active == null ? '' : (Number(s.active) ? 'Yes' : 'No')}</td>
                        <td className="px-2 py-1">
                          <select
                            className="border rounded px-2 py-1 bg-white min-w-[380px]"
                            value={selected}
                            onChange={(e)=>setShopSubscription(idShop, e.target.value || null)}
                            disabled={shopMapBusy}
                          >
                            <option value="">— None —</option>
                            {(lines || []).map((li) => {
                              const v = String(li.subscription_id);
                              const label = [
                                `sub:${v}`,
                                (li.sim_slot!=null ? `SIM${li.sim_slot}` : ''),
                                (li.carrier||''),
                                (li.display_name||''),
                                (li.msisdn ? `(${li.msisdn})` : '')
                              ].filter(Boolean).join(' · ');
                              return <option key={v} value={v}>{label}</option>;
                            })}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                {!prestaShops.length && (
                  <tr><td className="px-2 py-2 text-gray-500" colSpan={4}>No shops loaded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel max-w-5xl mt-4">
        <div className="panel__header flex items-center justify-between">
          <div>Android Config (Kotlin)</div>
          <div className="text-xs text-gray-500">Read‑only example</div>
        </div>
        <div className="panel__body space-y-2">
          <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto"><code>{kotlinSnippet}</code></pre>
          <div className="flex items-center gap-2">
            <button className="text-xs px-2 py-1 border rounded" onClick={()=>copyText(kotlinSnippet)}>Copy</button>
            <div className="text-[11px] text-gray-600">Token shows what you entered/generated here; prefer loading it securely at runtime.</div>
          </div>
        </div>
      </div>

      <div className="panel max-w-5xl mt-4">
        <div className="panel__header">Test Center (SMS / Calls)</div>
        <div className="panel__body space-y-3 text-sm">
          <div className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-12 md:col-span-3 text-xs text-gray-600">Phone / To</div>
            <div className="col-span-12 md:col-span-9">
              <input className="border rounded px-2 py-1 w-full" placeholder="+33..." value={tTo} onChange={(e)=>setTTo(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-12 md:col-span-3 text-xs text-gray-600">Message</div>
            <div className="col-span-12 md:col-span-9">
              <input className="border rounded px-2 py-1 w-full" value={tMsg} onChange={(e)=>setTMsg(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-12 md:col-span-3 text-xs text-gray-600">Subscription</div>
            <div className="col-span-12 md:col-span-9">
              {(!lines || !lines.length) ? (
                <div className="text-xs text-gray-500">No phone lines reported yet. Connect your device and Refresh above.</div>
              ) : (
                <select className="border rounded px-2 py-1 w-full" value={tSub} onChange={(e)=>setTSub(e.target.value)}>
                  {lines.map((li) => {
                    const v = String(li.subscription_id);
                    const label = [
                      `sub:${v}`,
                      (li.sim_slot!=null ? `SIM${li.sim_slot}` : ''),
                      (li.carrier||''),
                      (li.display_name||''),
                      (li.msisdn ? `(${li.msisdn})` : '')
                    ].filter(Boolean).join(' · ');
                    return <option key={v} value={v}>{label}</option>;
                  })}
                </select>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button className="text-xs px-2 py-1 border rounded" title="Use Socket.IO to emit sms:send via temp client" onClick={sendSmsViaSocket} disabled={!lines || !lines.length || !(tSub||'').trim()}>Send SMS (socket)</button>
            <button className="text-xs px-2 py-1 border rounded" title="Use Socket.IO to emit call:make via connected device" onClick={placeCallViaSocket} disabled={!lines || !lines.length || !(tSub||'').trim()}>Place call (socket)</button>
            <button className="text-xs px-2 py-1 border rounded" title="HTTP /api/gateway/sms/incoming" onClick={simulateIncomingSms}>Simulate incoming SMS (HTTP)</button>
            <button className="text-xs px-2 py-1 border rounded" title="HTTP /api/gateway/sms/status" onClick={simulateSmsStatus}>Simulate SMS status (HTTP)</button>
            <button className="text-xs px-2 py-1 border rounded" title="HTTP /api/gateway/calls" onClick={simulateCall}>Simulate call (HTTP)</button>
          </div>
          <div className="text-[11px] text-gray-600">Note: HTTP test endpoints are minimal and return ok. Socket test uses the DB token via a temporary client in this browser.</div>
          {tOut && (
            <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto"><code>{tOut}</code></pre>
          )}
        </div>
      </div>

      <div className="panel max-w-5xl mt-4">
        <div className="panel__header flex items-center justify-between">
          <div>Recent Gateway Logs</div>
          <div className="flex items-center gap-2">
            <button className="text-xs px-2 py-1 border rounded" onClick={loadLogs}>Refresh</button>
            <button className="text-xs px-2 py-1 border rounded" onClick={clearLogs}>Clear</button>
          </div>
        </div>
        <div className="panel__body overflow-auto">
          <table className="table-auto text-xs min-w-[980px]">
            <thead>
              <tr className="text-left">
                <th className="px-2 py-1">When</th>
                <th className="px-2 py-1">Kind</th>
                <th className="px-2 py-1">To/From</th>
                <th className="px-2 py-1">Sub</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((e) => {
                const when = e.when ? new Date(e.when).toLocaleString() : '';
                const ok = e.ok === true;
                const status = ok ? 'OK' : (e.error || e.status || '');
                const tf = e.to || e.from || '';
                const details = e.message || (e.ack ? JSON.stringify(e.ack) : '') || (e.payload ? JSON.stringify(e.payload) : '') || '';
                return (
                  <tr key={e.id} className="border-t">
                    <td className="px-2 py-1 whitespace-nowrap">{when}</td>
                    <td className="px-2 py-1">{e.kind || ''}</td>
                    <td className="px-2 py-1">{tf}</td>
                    <td className="px-2 py-1">{e.subscription_id ?? ''}</td>
                    <td className="px-2 py-1">{status}</td>
                    <td className="px-2 py-1 break-all max-w-[560px]">{details}</td>
                  </tr>
                );
              })}
              {!logs.length && (
                <tr><td className="px-2 py-2 text-gray-500" colSpan={6}>No logs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default GatewayPage;
export function Main() { return <GatewayPage />; }
export function Settings() { return <GatewayPage />; }
