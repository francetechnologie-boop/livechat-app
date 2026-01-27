import React, { useEffect, useMemo, useState } from 'react';

export default function HomeAssistant() {
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [cfgMsg, setCfgMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const [states, setStates] = useState([]);
  const [filter, setFilter] = useState('');
  const [svcBusy, setSvcBusy] = useState(false);
  const [svcMsg, setSvcMsg] = useState('');

  const loadConfig = async () => {
    try {
      const r = await fetch('/api/admin/ha/config', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) { setBaseUrl(j.base_url || ''); setCfgMsg(''); }
      else setCfgMsg(j?.message || j?.error || 'Load failed');
    } catch (e) { setCfgMsg(String(e?.message || e)); }
  };
  useEffect(() => { loadConfig(); }, []);

  const saveConfig = async () => {
    setBusy(true); setCfgMsg('');
    try {
      const r = await fetch('/api/admin/ha/config', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ base_url: baseUrl, token }) });
      const j = await r.json();
      if (r.ok && j?.ok) setCfgMsg('Saved.'); else setCfgMsg(j?.message || j?.error || 'Save failed');
    } catch (e) { setCfgMsg(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const loadStates = async () => {
    setBusy(true); setSvcMsg('');
    try {
      const r = await fetch('/api/ha/states', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setStates(Array.isArray(j.states) ? j.states : []);
      else setSvcMsg(j?.message || j?.error || 'Failed to load states');
    } catch (e) { setSvcMsg(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const filteredStates = useMemo(() => {
    const q = (filter || '').toLowerCase();
    if (!q) return states;
    return states.filter(s => String(s.entity_id||'').toLowerCase().includes(q) || String(s.attributes?.friendly_name||'').toLowerCase().includes(q));
  }, [states, filter]);

  const callService = async (entityId, action = 'toggle') => {
    setSvcBusy(true); setSvcMsg('');
    try {
      const domain = String(entityId || '').split('.')[0] || 'homeassistant';
      const r = await fetch(`/api/ha/services/${encodeURIComponent(domain)}/${encodeURIComponent(action)}`, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ entity_id: entityId }) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) setSvcMsg(j?.message || j?.error || 'Service failed'); else setSvcMsg('OK');
    } catch (e) { setSvcMsg(String(e?.message || e)); }
    finally { setSvcBusy(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="p-3 border rounded bg-white">
        <div className="font-medium mb-2">Home Assistant - Configuration</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <div className="text-xs mb-1">Base URL</div>
            <input className="border rounded px-2 py-1 w-full" placeholder="https://ha.example.com" value={baseUrl} onChange={(e)=>setBaseUrl(e.target.value)} />
          </div>
          <div>
            <div className="text-xs mb-1">Long-Lived Access Token</div>
            <input type="password" className="border rounded px-2 py-1 w-full" placeholder="eyJ0eXAiOi..." value={token} onChange={(e)=>setToken(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <button className="px-3 py-1 rounded border" onClick={saveConfig} disabled={busy}>{busy ? 'Saving.' : 'Save'}</button>
            <button className="px-3 py-1 rounded border" onClick={loadConfig} disabled={busy}>{busy ? '...' : 'Reload'}</button>
          </div>
        </div>
        {cfgMsg && <div className="text-xs text-gray-600 mt-2">{cfgMsg}</div>}
      </div>

      <div className="p-3 border rounded bg-white">
        <div className="font-medium mb-2">Entities</div>
        <div className="flex items-end gap-2 mb-2">
          <input className="border rounded px-2 py-1 min-w-[260px]" placeholder="Search entity_id or name..." value={filter} onChange={(e)=>setFilter(e.target.value)} />
          <button className="px-3 py-1 rounded border" onClick={loadStates} disabled={busy}>{busy ? 'Loading.' : 'Refresh'}</button>
          {svcMsg && <span className="text-xs text-gray-600">{svcMsg}</span>}
        </div>
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1 pr-2">Entity</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">State</th>
                <th className="py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStates.map(s => (
                <tr key={s.entity_id} className="border-b last:border-b-0">
                  <td className="py-1 pr-2 font-mono text-xs">{s.entity_id}</td>
                  <td className="py-1 pr-2">{s.attributes?.friendly_name || ''}</td>
                  <td className="py-1 pr-2">{s.state}</td>
                  <td className="py-1">
                    <div className="flex items-center gap-2">
                      <button className="text-xs px-2 py-0.5 rounded border" onClick={()=>callService(s.entity_id, 'toggle')} disabled={svcBusy}>Toggle</button>
                      <button className="text-xs px-2 py-0.5 rounded border" onClick={()=>callService(s.entity_id, 'turn_on')} disabled={svcBusy}>On</button>
                      <button className="text-xs px-2 py-0.5 rounded border" onClick={()=>callService(s.entity_id, 'turn_off')} disabled={svcBusy}>Off</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredStates.length && (
                <tr><td className="py-2 text-gray-500" colSpan={4}>No entities</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

