import PrestaDbConnection from "./PrestaDbConnection";
/* AI-GUIDE (Livechat App)
Context: React 18. Task: Add a minimal card to edit per-domain transfer config (config_transfert) with history, similar to Domain Config Maker.

MUST:
- Keep unrelated code intact; minimal diff
- Use existing endpoints added in backend
*/
import React, { useEffect, useState } from "react";

export default function TransferConfigMaker({ activeDomain, onChangeDomain } = {}) {
  const [domains, setDomains] = useState([]);
  const [domain, setDomain] = useState("");
  const [type, setType] = useState("product");
  const [editor, setEditor] = useState("{\n  \"rules\": {}\n}");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [hist, setHist] = useState([]);
  const [version, setVersion] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  const adminHeaders = () => {
    const h = {};
    try {
      const t = localStorage.getItem('ADMIN_TOKEN') || localStorage.getItem('admin_token') || '';
      if (t) h['X-Admin-Token'] = t;
    } catch {}
    return h;
  };

  const autoFixJson = (text = '') => {
    try {
      let t = String(text || '');
      // Strip BOM
      if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
      // Normalize smart quotes → straight
      t = t
        .replace(/[\u2018\u2019\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201F]/g, '"');
      // Remove // line comments
      t = t.replace(/^\s*\/\/.*$/gm, '');
      // Remove /* */ block comments
      t = t.replace(/\/\*[\s\S]*?\*\//g, '');
      // Remove trailing commas before } or ]
      t = t.replace(/,\s*([}\]])/g, '$1');
      return t;
    } catch { return text; }
  };

  const parseJsonWithDetails = (text) => {
    // First try raw
    try { return { obj: JSON.parse(text || '{}'), fixed: false, text }; }
    catch (e1) {
      // Try auto-fix then parse
      const fixedText = autoFixJson(text);
      if (fixedText !== text) {
        try { return { obj: JSON.parse(fixedText || '{}'), fixed: true, text: fixedText }; }
        catch (e2) { /* fallthrough to detailed error using original */ }
      }
      try {
        const m = String(e1?.message || '').match(/position\s+(\d+)/i);
        const pos = m ? Number(m[1]) : -1;
        if (pos >= 0) {
          let line = 1, col = 1;
          for (let i = 0; i < (text||'').length && i < pos; i++) { if (text[i] === '\n') { line++; col = 1; } else { col++; } }
          throw new Error(`Invalid JSON at ${line}:${col} (pos ${pos})`);
        }
      } catch {}
      throw new Error('Invalid JSON');
    }
  };

  const loadDomains = async () => {
    try {
      const r = await fetch('/api/grabbings/jerome/domains', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setDomains(Array.isArray(j.items)? j.items: []);
    } catch {}
  };
  useEffect(()=>{ loadDomains(); }, []);
  useEffect(()=>{ if (typeof activeDomain === 'string') setDomain(activeDomain||''); }, [activeDomain]);

  const loadCurrent = async (d, t) => {
    if (!d) return; if (!t) t = 'product';
    setBusy(true); setMsg("");
    try {
      const u = `/api/grabbings/jerome/domains/config-transfert?domain=${encodeURIComponent(d)}&type=${encodeURIComponent(t)}`;
      const r = await fetch(u, { credentials:'include', headers: adminHeaders() });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'load_failed');
      else { setEditor(JSON.stringify(j.config||{}, null, 2)); setVersion(j?.version ?? null); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };
  useEffect(()=>{ if (domain) { loadCurrent(domain, type); loadHistory(domain, type); } }, [domain, type]);

  const saveCurrent = async () => {
    if (!domain) { setMsg('Select a domain'); return; }
    setBusy(true); setMsg("");
    try {
      let cfg = {};
      try {
        const r = parseJsonWithDetails(editor);
        cfg = r.obj;
        if (r.fixed && typeof r.text === 'string' && r.text !== editor) {
          setEditor(r.text);
          setMsg('Auto-fixed JSON (quotes/comments/trailing commas removed).');
        }
      }
      catch (e) { setMsg(String(e?.message||e)); setBusy(false); return; }
      const r = await fetch('/api/grabbings/jerome/domains/config-transfert', {
        method:'POST', headers:{ 'Content-Type':'application/json', ...adminHeaders() }, credentials:'include',
        body: JSON.stringify({ domain, type, config: cfg })
      });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'save_failed');
      else { setMsg('Saved.'); setVersion(j?.version ?? version); await loadHistory(domain, type); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const loadHistory = async (d, t) => {
    if (!d) return; if (!t) t = 'product';
    setMsg('');
    try {
      const u = `/api/grabbings/jerome/domains/config-transfert/history?domain=${encodeURIComponent(d)}&type=${encodeURIComponent(t)}`;
      const r = await fetch(u, { credentials:'include', headers: adminHeaders() });
      const j = await r.json();
      if (r.ok && j?.ok) setHist(Array.isArray(j.items)? j.items: []);
    } catch {}
  };

  const revertHistory = async (id) => {
    if (!domain || !id) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch('/api/grabbings/jerome/domains/config-transfert/revert', {
        method:'POST', headers:{ 'Content-Type':'application/json', ...adminHeaders() }, credentials:'include',
        body: JSON.stringify({ domain, type, id })
      });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'revert_failed');
      else { setMsg('Reverted.'); setVersion(j?.version ?? version); await loadCurrent(domain, type); await loadHistory(domain, type); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const deleteHistory = async (id) => {
    if (!id) return; if (!window.confirm('Delete this history entry?')) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/grabbings/jerome/domains/config-transfert/history/${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include', headers: adminHeaders() });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||('HTTP_'+r.status));
      else setHist(prev => (prev||[]).filter(x => x.id !== id));
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mb-3 border rounded p-3 bg-white">
      <div className="flex items-center justify-between">
        <div className="font-medium">Transfer Config (Presta mapping)</div>
        <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=> setCollapsed(v=>!v)}>{collapsed? 'Expand':'Collapse'}</button>
      </div>
      <div className={collapsed? 'hidden': ''}>
        {!!msg && <div className="text-[11px] text-red-600 mt-1">{msg}</div>}
        <div className="mt-2 grid grid-cols-1 md:grid-cols-6 gap-2 items-end text-[11px]">
          <div className="md:col-span-3">
            <label className="block mb-1">Domain</label>
            <select className="w-full border rounded px-2 py-1" value={typeof activeDomain === 'string' ? (activeDomain || '') : domain} onChange={(e)=> (onChangeDomain? onChangeDomain(e.target.value): setDomain(e.target.value))}>
              <option value="">-- select domain --</option>
              {domains.map(d => (<option key={d.domain} value={d.domain}>{d.domain}</option>))}
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="block mb-1">Type</label>
            <select className="w-full border rounded px-2 py-1" value={type} onChange={(e)=> setType(e.target.value)}>
              <option value="product">product</option>
              <option value="category">category</option>
              <option value="page">page</option>
            </select>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-gray-600">Version: {version != null ? `v${version}` : '-'}</div>
        <div className="mt-2">
          <label className="block mb-1">JSON</label>
          <textarea className="w-full border rounded p-2 font-mono text-[11px] min-h-[220px]" value={editor} onChange={(e)=> setEditor(e.target.value)} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button className="px-2 py-1 border rounded" disabled={busy || !domain} onClick={saveCurrent}>Save</button>
          <button className="px-2 py-1 border rounded" disabled={busy || !domain} onClick={()=> loadCurrent(domain, type)}>Reload</button>
        </div>
        <div className="mt-3">
          <div className="font-medium mb-1">History</div>
          <div className="max-h-48 overflow-auto border rounded bg-gray-50">
            <table className="min-w-full text-[11px]">
              <thead className="bg-gray-100 text-gray-700">
                <tr>
                  <th className="text-left px-2 py-1 border-b">Saved</th>
                  <th className="text-left px-2 py-1 border-b">Version</th>
                  <th className="text-left px-2 py-1 border-b">Actions</th>
                </tr>
              </thead>
              <tbody>
                {hist.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-2 py-1 whitespace-nowrap text-gray-600">{row.saved_at? new Date(row.saved_at).toLocaleString(): ''}</td>
                    <td className="px-2 py-1 text-gray-700 whitespace-nowrap">{row.version != null ? `v${row.version}` : '-'}</td>
                    <td className="px-2 py-1 whitespace-nowrap space-x-1">
                      <button className="px-2 py-0.5 border rounded" disabled={busy} title="Revert to this version" onClick={()=> revertHistory(row.id)}>Revert</button>
                      <button className="px-2 py-0.5 border rounded" disabled={busy} title="Delete this entry" onClick={()=> deleteHistory(row.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {!hist.length && (
                  <tr><td className="px-2 py-1 text-gray-500" colSpan={3}>No history yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
export function PrestaDbConnectionPanel(){
  return (
    <div className="mt-3"><PrestaDbConnection /></div>
  );
}

