import React, { useEffect, useMemo, useState, useRef } from "react";
import { RichEditor } from "@shared-modules";
import { Chatbots, Prompts, Vectors, Files } from "./index.js";
// DB Manager surfaces are available as a standalone module. We no longer
// embed them inside Automation Suite to keep the suite focused.
import { loadModuleState, saveModuleState } from "@app-lib/uiState";

function Subnav({ subTab, setSubTab }) {
  const Item = ({ id, label, icon }) => (
    <button
      onClick={() => setSubTab(id)}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors
        ${subTab === id ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'hover:bg-gray-50'}`}
    >
      <span className="text-base w-5 text-center" aria-hidden>{icon}</span>
      <span className="text-sm">{label}</span>
    </button>
  );
  return (
    <aside className="w-64 border-r bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Automation Suite</div>
      <nav className="space-y-1">
        {/* Top items */}
        <Item id="hub" label="Conversation Hub" icon={'\uD83D\uDCAC'} />
        <Item id="chatbots" label="Chatbots" icon="🤖" />
        <Item id="messages" label="Messages de bienvenue" icon="👋" />
        <Item id="prompts" label="Prompts" icon="📝" />
        <Item id="vectors" label="Vector Stores" icon="🧱" />
        <Item id="files" label="Files" icon="📦" />
        {/* MCP2 Server removed from Automation Suite */}
        {/* MCP2 Tools removed from Automation Suite */}
        {/* MCP Designer removed */}
        {/* DB Manager links removed; use the dedicated DB Manager module page. */}
        <div className="text-xs uppercase tracking-wide text-gray-400 mt-4 mb-1">Autres</div>
        {/* Smartsupp API moved to its own module page (#/smartsupp-api). */}
        {/* Cron Management moved to its own module page (#/cron-management). */}
        {/* Grabbing moved to standalone module page (#/grabbing). Nav entry removed. */}
        {/* Google API moved to its own module page (#/google-api). Entry removed here. */}
      </nav>
    </aside>
  );
}

function ConversationHub() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [mapStats, setMapStats] = useState({});
  const load = async () => {
    setLoading(true); setError("");
    try {
      const [botsRes, cfgRes, statsRes] = await Promise.all([
        fetch('/api/automation-suite/chatbots', { credentials:'include' }),
        fetch('/api/automation-suite/conversation-hub', { credentials:'include' }),
        fetch('/api/automation-suite/conversation-hub/stats', { credentials:'include' })
      ]);
      const bots = await botsRes.json();
      const cfg = await cfgRes.json();
      const stats = await statsRes.json();
      setRows(Array.isArray(bots) ? bots : []);
      const ids = (cfg?.ids && Array.isArray(cfg.ids)) ? cfg.ids.map(String) : [];
      setSel(new Set(ids));
      const m = {};
      if (stats && stats.ok && Array.isArray(stats.items)) {
        for (const it of stats.items) m[String(it.id_bot)] = Number(it.count)||0;
      }
      setMapStats(m);
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const toggle = (id, on) => {
    setSel(prev => { const s = new Set(prev); if (on) s.add(id); else s.delete(id); return s; });
  };
  const save = async () => {
    setSaving(true);
    try {
      const ids = Array.from(sel);
      const r = await fetch('/api/automation-suite/conversation-hub', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ ids }) });
      if (!r.ok) { const t = await r.text().catch(()=> ''); throw new Error(t||`http_${r.status}`); }
      alert('Enregistré.');
    } catch (e) { alert('Échec: ' + (e?.message || e)); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between p-4 border-b bg-white">
        <div className="font-semibold">Conversation Hub</div>
        <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 text-sm disabled:opacity-60">{saving?'Enregistrement...':'Enregistrer'}</button>
      </div>
      {loading ? (<div className="p-4 text-sm text-gray-500">Chargement...</div>) : (
        <div className="p-4 overflow-auto">
          {error && <div className="mb-2 text-sm text-red-600">{error}</div>}
          <div className="text-sm text-gray-700 mb-2">Choisissez les chatbots utilisés par le Hub.</div>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">Activer</th>
                <th className="px-3 py-2 text-left">Chatbot</th>
                <th className="px-3 py-2 text-left">Boutique</th>
                <th className="px-3 py-2 text-left">Langue</th>
                <th className="px-3 py-2 text-left">Liens externes</th>
              </tr>
            </thead>
            <tbody>
              {(rows||[]).map(r => {
                const checked = sel.has(String(r.id_bot));
                return (
                  <tr key={r.id_bot} className="border-b">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={checked} onChange={(e)=>toggle(String(r.id_bot), e.target.checked)} />
                    </td>
                    <td className="px-3 py-2">{r.name || r.id_bot}</td>
                    <td className="px-3 py-2">{r.shop_name || '-'}</td>
                    <td className="px-3 py-2">{r.lang_iso || '-'}</td>
                    <td className="px-3 py-2">{mapStats[String(r.id_bot)] ?? 0}</td>
                  </tr>
                );
              })}
              {(!rows||!rows.length) && (
                <tr><td className="px-3 py-6 text-gray-500" colSpan={4}>Aucun chatbot configuré.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MessagesAuto() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [idShop, setIdShop] = useState("");
  const [idLang, setIdLang] = useState("");
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  const [newId, setNewId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const load = async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch('/api/automation-suite/welcome-messages', { credentials:'include' });
      const j = await r.json();
      const arr = Array.isArray(j?.items) ? j.items : [];
      setItems(arr.map(it => ({
        id: it.id,
        id_shop: it.id_shop ?? null,
        id_lang: it.id_lang ?? null,
        title: it.title || '',
        content: it.content || '',
        enabled: it.enabled !== false,
      })));
    } catch (e) { setError(String(e?.message || e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const begin = (id) => {
    const it = items.find(x=>x.id===id);
    setSelected(id);
    setTitle(it?.title || '');
    setContent(it?.content || '');
    setEnabled(it?.enabled !== false);
    setIdShop(it?.id_shop != null ? String(it.id_shop) : '');
    setIdLang(it?.id_lang != null ? String(it.id_lang) : '');
    setTimeout(()=> editorRef.current?.focus?.(), 0);
  };
  const doSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/automation-suite/welcome/${encodeURIComponent(selected)}`, {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        credentials:'include',
        body: JSON.stringify({
          id_shop: String(idShop || '').trim() || null,
          id_lang: String(idLang || '').trim() || null,
          title: title||null,
          content: content||null,
          enabled: !!enabled
        })
      });
      if (!r.ok) throw new Error(await r.text().catch(()=>''));
      await load();
      setSelected(null);
      setTitle(''); setContent('');
      setIdShop(''); setIdLang('');
    } catch (e) { alert('Échec: ' + (e?.message || e)); }
    finally { setSaving(false); }
  };
  const doDelete = async () => {
    if (!selected) return;
    if (!confirm('Supprimer ce message ?')) return;
    try {
      const r = await fetch(`/api/automation-suite/welcome/${encodeURIComponent(selected)}`, { method:'DELETE', credentials:'include' });
      if (!r.ok) throw new Error(await r.text().catch(()=>''));
      await load();
      setSelected(null); setTitle(''); setContent('');
    } catch (e) { alert('Échec de la suppression: ' + (e?.message || e)); }
  };
  return (
    <div className="flex-1 flex min-h-0">
      <aside className="w-80 border-r bg-white flex flex-col min-h-0">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Messages de bienvenue</div>
          </div>
          <div className="flex items-center gap-2">
            <input value={newId} onChange={(e)=>setNewId(e.target.value)} className="flex-1 border rounded px-2 py-1 text-sm" placeholder="Nouvel ID (ex: fr_home)" />
            <button className="px-2 py-1 rounded border text-xs" onClick={()=>{
              const id = String(newId||'').trim(); if (!id) return;
              setSelected(id);
              setTitle('');
              setContent('');
              setEnabled(true);
              setIdShop('');
              setIdLang('');
              setTimeout(()=> editorRef.current?.focus?.(), 0);
            }}>Nouveau</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {loading && <div className="text-xs text-gray-500 p-2">Chargement...</div>}
          {error && <div className="text-xs text-red-600 p-2">{String(error)}</div>}
          {items.map(it => (
            <div key={it.id} className={`p-2 rounded border ${selected===it.id? 'bg-blue-50 border-blue-200':'bg-white hover:bg-gray-50'}`}>
              <button className="w-full text-left" onClick={()=>begin(it.id)}>
                <div className="font-medium text-sm truncate">{it.title || it.id}</div>
                <div className="text-[11px] text-gray-500 truncate">{it.id}</div>
                {(it.id_shop != null || it.id_lang != null) && (
                  <div className="text-[11px] text-gray-400 truncate">
                    {it.id_shop != null ? `shop:${it.id_shop}` : 'shop:—'} {it.id_lang != null ? `lang:${it.id_lang}` : 'lang:—'}
                  </div>
                )}
              </button>
            </div>
          ))}
          {!items.length && !loading && <div className="text-xs text-gray-500 p-2">Aucun message.</div>}
        </div>
      </aside>
      <main className="flex-1 min-h-0 overflow-y-auto">
        {!selected ? (
          <div className="p-6 text-sm text-gray-500">Sélectionnez un message dans la liste.</div>
        ) : (
          <div className="flex flex-col min-h-0">
            <div className="p-4 border-b bg-white flex items-center justify-between">
              <div className="font-medium">Éditer le message</div>
              <div className="flex items-center gap-2">
                <button onClick={doDelete} className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm text-red-700 border-red-200">Supprimer</button>
                <button onClick={doSave} disabled={saving} className="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 text-sm">{saving?'Enregistrement...':'Enregistrer'}</button>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <input id="wmEnabled" type="checkbox" checked={enabled} onChange={(e)=>setEnabled(e.target.checked)} />
                <label htmlFor="wmEnabled" className="text-sm text-gray-700">Activer ce message</label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">id_shop</label>
                  <input value={idShop} onChange={(e)=>setIdShop(e.target.value)} className="w-full border rounded px-3 py-2" placeholder="(ex: 1)" inputMode="numeric" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">id_lang</label>
                  <input value={idLang} onChange={(e)=>setIdLang(e.target.value)} className="w-full border rounded px-3 py-2" placeholder="(ex: 1)" inputMode="numeric" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Titre</label>
                <input value={title} onChange={(e)=>setTitle(e.target.value)} className="w-full border rounded px-3 py-2" placeholder="Titre du message" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Contenu (HTML)</label>
                <RichEditor ref={editorRef} value={content} onChange={(val)=>setContent(val)} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function Automations() {
  const [subTab, setSubTab] = useState(() => {
    try { const st = loadModuleState('automations'); return st.subTab || 'hub'; } catch { return 'hub'; }
  });
  useEffect(() => { try { saveModuleState('automations', { subTab }); } catch {} }, [subTab]);
  // React to restore broadcast to set subTab
  useEffect(() => {
    const onRestore = (e) => {
      try {
        const st = e?.detail?.modules?.automations;
        const next = st?.subTab;
        if (next && next !== subTab) setSubTab(next);
      } catch {}
    };
    window.addEventListener('app-restore', onRestore);
    return () => window.removeEventListener('app-restore', onRestore);
  }, [subTab]);
  // Parse hash to set subTab when landing directly on a deep link (#/automation-suite/<subtab>)
  useEffect(() => {
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').map(decodeURIComponent).filter(Boolean);
      if (parts[0] === 'automation-suite' && parts[1] && parts[1] !== subTab) setSubTab(parts[1]);
    } catch {}
  }, []);
  // Keep hash second segment in sync with subTab (module owns its sub-route)
  useEffect(() => {
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw ? raw.split('/').map(decodeURIComponent).filter(Boolean) : [];
      const nextParts = ['automation-suite', subTab];
      // preserve optional 3rd segment (e.g., selection) only if still relevant
      if (parts[0] === 'automation-suite' && parts[2] && (subTab === 'chatbots')) {
        nextParts.push(parts[2]);
      }
      const nextHash = '#' + '/' + nextParts.join('/');
      if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash);
    } catch {}
  }, [subTab]);
  useEffect(() => {
    const base = ['Automation Suite'];
    let sec = null;
    if (subTab === 'hub') sec = 'Conversation Hub';
    else if (subTab === 'prompts') sec = 'Prompts';
    else if (subTab === 'chatbots') sec = 'Chatbots';
    else if (subTab === 'vectors') sec = 'Vector Stores';
    
    else if (subTab === 'files') sec = 'Files';
    // MCP2 Tools removed
    // MCP Server and MCP Designer removed from Automation Suite.
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: sec ? [...base, sec] : base })); } catch {}
  }, [subTab]);
  return (
    <div className="h-full w-full flex min-h-0">
      <Subnav subTab={subTab} setSubTab={setSubTab} />
      <main className="flex-1 min-h-0 flex flex-col">
        {subTab === 'hub' && <ConversationHub />}
        {subTab === 'messages' && <MessagesAuto />}
        {subTab === 'prompts' && <Prompts />}
        {subTab === 'vectors' && <Vectors />}
        
        {subTab === 'files' && <Files />}
        {subTab === 'chatbots' && <Chatbots />}
        {/* MCP2 Tools removed */}
        {/* MCP Server and MCP Designer removed */}
        {/* DB Manager surfaces are accessible via the DB Manager module route. */}
      </main>
    </div>
  );
}


