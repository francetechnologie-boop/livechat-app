import React, { useEffect, useMemo, useState } from "react";
import { loadModuleState, saveModuleState } from "@app-lib/uiState";
// MCP components removed


function Field({ label, children }) {
  return (
    <div className="grid grid-cols-12 gap-3 items-center">
      <div className="col-span-12 md:col-span-3 text-xs text-gray-600">{label}</div>
      <div className="col-span-12 md:col-span-9">{children}</div>
    </div>
  );
}

export default function Chatbots() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => {
    try { const st = loadModuleState('automations.chatbots'); return st.selected ?? null; } catch { return null; }
  }); // id_bot
  const [form, setForm] = useState({});
  const [idEdit, setIdEdit] = useState('');
  const [repo, setRepo] = useState([]);
  const [welcomeRepo, setWelcomeRepo] = useState([]);
  const [selectedWelcomeId, setSelectedWelcomeId] = useState('');
  const selectedPrompt = useMemo(() => {
    try { return (repo || []).find(p => p.id === (form?.prompt_config_id || '')) || null; } catch { return null; }
  }, [repo, form?.prompt_config_id]);
  // MCP server + tools
  const [servers, setServers] = useState([]);
  const [serverTools, setServerTools] = useState([]);
  const [serverToolsMsg, setServerToolsMsg] = useState('');
  const [testing, setTesting] = useState(false);
  const [savingMcp, setSavingMcp] = useState(false);
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [testReq, setTestReq] = useState("");
  const [testConv, setTestConv] = useState([]);
  const [testRespId, setTestRespId] = useState("");
  const [testOpenReqId, setTestOpenReqId] = useState("");
  const [testHist, setTestHist] = useState([]);
  // simplified UI (no MCP sections)

  const load = () => {
    setLoading(true);
    setError("");
    fetch("/api/automation-suite/chatbots")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  };
  const loadRepo = async () => {
    try { const r = await fetch('/api/automation-suite/prompt-configs', { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok) setRepo(Array.isArray(j.items)? j.items: []); } catch {}
  };
  const loadWelcomeRepo = async () => {
    try {
      // backend has a welcome_message table; list basic fields
      const r = await fetch('/api/automation-suite/welcome-messages', { credentials: 'include' });
      const j = await r.json().catch(()=>({}));
      if (r.ok && j && Array.isArray(j.items)) setWelcomeRepo(j.items);
    } catch {}
  };
  const loadServers = async () => {
    try { const r = await fetch('/api/mcp-servers', { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok) setServers(Array.isArray(j.items)? j.items: []); } catch {}
  };

  const saveMcp = async () => {
    if (!selected) return;
    setSavingMcp(true);
    const body = {
      mcp_enabled: !!form.mcp_enabled,
      mcp_tools: (Array.isArray(form.mcp_tools) && form.mcp_tools.length) ? form.mcp_tools : null,
      mcp_server_name: form.mcp_server_name || null,
      // Web search flag is part of MCP-related capabilities in this UI
      web_search_enabled: !!form.web_search_enabled,
    };
    try {
      const res = await fetch(`/api/automation-suite/chatbots/${selected}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) { load(); return; }
      const t = await res.text().catch(()=>'');
      console.error('save MCP failed', res.status, t);
      alert("Échec de l'enregistrement (MCP).");
    } catch (e) {
      console.error('save MCP failed', e);
      alert("Échec de l'enregistrement (MCP).");
    } finally { setSavingMcp(false); }
  };
  useEffect(() => { load(); loadRepo(); loadWelcomeRepo(); loadServers(); }, []);
  // When rows are loaded and a selection exists (e.g., restored from state), hydrate form and ID
  useEffect(() => {
    if (!selected) return;
    const r = (rows || []).find((x) => x.id_bot === selected);
    if (!r) return;
    setIdEdit(selected || '');
    setForm({
      id_shop: r?.id_shop != null ? String(r.id_shop) : "",
      id_lang: r?.id_lang != null ? String(r.id_lang) : "",
      enabled: !!r?.enabled,
      name: r?.name || "",
      welcome_message: r?.welcome_message || "",
      welcome_message_id: r?.welcome_message_id || "",
      bot_behavior: r?.bot_behavior || 'manual',
      mcp_enabled: !!r?.mcp_enabled,
      mcp_tools: Array.isArray(r?.mcp_tools) ? r.mcp_tools : [],
      mcp_server_name: r?.mcp_server_name || '',
      web_search_enabled: !!r?.web_search_enabled,
      local_prompt_id: r?.local_prompt_id || "",
      prompt_config_id: r?.prompt_config_id || r?.local_prompt_id || "",
    });
  }, [rows, selected]);
  // Persist selection
  useEffect(() => { try { saveModuleState('automations.chatbots', { selected }); } catch {} }, [selected]);
  // React to restore broadcast
  useEffect(() => {
    const onRestore = (e) => {
      try {
        const id = e?.detail?.modules?.['automations.chatbots']?.selected;
        if (id != null) setSelected(id);
      } catch {}
    };
    window.addEventListener('app-restore', onRestore);
    return () => window.removeEventListener('app-restore', onRestore);
  }, []);
  // Update breadcrumb based on selection state
  useEffect(() => {
    const base = ['Automation Suite', 'Chatbots'];
    const trail = selected ? [...base, 'Configuration'] : base;
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: trail })); } catch {}
  }, [selected]);
  useEffect(() => {
    const id = form?.prompt_config_id || '';
    if (!id) return;
    if ((repo || []).some(p => p.id === id)) return;
    (async () => {
      try { const r = await fetch(`/api/automation-suite/prompt-configs/${encodeURIComponent(id)}`, { credentials:'include' }); const j = await r.json(); if (r.ok && j?.ok && j?.item) setRepo(prev => [j.item, ...prev]); } catch {}
    })();
  }, [form?.prompt_config_id, repo]);

  const onPick = (id) => {
    const r = (rows || []).find((x) => x.id_bot === id);
    setSelected(id);
    setIdEdit(id || '');
    setForm({
      id_shop: r?.id_shop != null ? String(r.id_shop) : "",
      id_lang: r?.id_lang != null ? String(r.id_lang) : "",
      enabled: !!r?.enabled,
      name: r?.name || "",
      welcome_message: r?.welcome_message || "",
      welcome_message_id: r?.welcome_message_id || "",
      bot_behavior: r?.bot_behavior || 'manual',
      mcp_enabled: !!r?.mcp_enabled,
      mcp_tools: Array.isArray(r?.mcp_tools) ? r.mcp_tools : [],
      mcp_server_name: r?.mcp_server_name || '',
      web_search_enabled: !!r?.web_search_enabled,
      local_prompt_id: r?.local_prompt_id || "",
      prompt_config_id: r?.prompt_config_id || r?.local_prompt_id || "",
    });
    // Fetch full row to populate instructions and any new fields
    // Load extra fields no longer needed; skipped
  };

  // Derived selected server from form.mcp_server_name
  const selectedServer = useMemo(() => {
    try {
      const name = form?.mcp_server_name || '';
      if (!name) return null;
      return (servers || []).find((s) => s?.name === name) || null;
    } catch { return null; }
  }, [servers, form?.mcp_server_name]);

  // Load tools from the selected server (Streamable HTTP list)
  const loadToolsFromServer = async () => {
    try {
      setServerToolsMsg('');
      setServerTools([]);
      const sv = selectedServer;
      if (!sv) { setServerToolsMsg('Sélectionnez un serveur'); return; }
      const name = encodeURIComponent(sv.name);
      const qp = sv.token ? `?token=${encodeURIComponent(sv.token)}` : '';
      const url = `/api/mcp2/transport/${name}/message${qp}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: 'list', method: 'tools/list', params: {} }),
      });
      const j = await r.json().catch(() => ({}));
      const list = (j?.result?.tools && Array.isArray(j.result.tools)) ? j.result.tools : [];
      setServerTools(list);
      if (!list.length) setServerToolsMsg('Aucun outil (ou non autorisé)');
    } catch (e) {
      setServerToolsMsg(String(e?.message || e));
    }
  };

  // Toggle a tool for the current bot's allowlist
  const toggleBotTool = (name, on) => {
    setForm((f) => {
      const arr = Array.isArray(f.mcp_tools) ? f.mcp_tools.slice() : [];
      const s = new Set(arr);
      if (on) s.add(name); else s.delete(name);
      return { ...f, mcp_tools: Array.from(s) };
    });
  };

  const save = async () => {
    if (!selected) return;
    let targetId = selected;
    const desiredId = String(idEdit || '').trim();
    if (desiredId && desiredId !== selected) {
      try {
        const r = await fetch(`/api/automation-suite/chatbots/${encodeURIComponent(selected)}/rename`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ new_id_bot: desiredId, cascade_files: true })
        });
        if (!r.ok) {
          const t = await r.text().catch(()=> '');
          throw new Error(t || `http_${r.status}`);
        }
        targetId = desiredId;
        setSelected(targetId);
        await load();
      } catch (e) {
        alert(`Échec du renommage: ${e?.message || e}`);
        return;
      }
    }
    const body = {
      id_shop: String(form.id_shop || '').trim() || null,
      id_lang: String(form.id_lang || '').trim() || null,
      enabled: !!form.enabled,
      name: form.name || null,
      welcome_message: (form.welcome_message ?? '').length ? form.welcome_message : null,
      welcome_message_id: form.welcome_message_id || null,
      bot_behavior: form.bot_behavior || 'manual',
      prompt_config_id: form.prompt_config_id || null,
      local_prompt_id: null,
    };
    try {
      let res = await fetch(`/api/automation-suite/chatbots/${encodeURIComponent(targetId)}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) { load(); return; }
      const errText = await res.text().catch(()=>'');
      // Fallback: ensure row exists, then retry, then create
      if (res.status === 404 || res.status === 400) {
        try { await fetch('/api/automation-suite/chatbots/sync', { method: 'POST', credentials: 'include' }); } catch {}
        // Retry PATCH once after sync
        res = await fetch(`/api/automation-suite/chatbots/${encodeURIComponent(targetId)}/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (res.ok) { load(); return; }
        const row = (rows || []).find((x) => x.id_bot === targetId);
        if (row && row.shop_name && row.lang_iso) {
          const create = {
            id_bot: targetId,
            id_shop: String(form.id_shop || '').trim() || null,
            id_lang: String(form.id_lang || '').trim() || null,
            shop_name: row.shop_name,
            lang_iso: row.lang_iso,
            enabled: !!body.enabled,
            name: body.name,
            welcome_message: body.welcome_message || null,
            welcome_message_id: body.welcome_message_id || null,
            bot_behavior: body.bot_behavior,
            prompt_config_id: body.prompt_config_id || null,
          };
          const r2 = await fetch(`/api/automation-suite/chatbots`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: 'include',
            body: JSON.stringify(create),
          });
          if (r2.ok) { load(); return; }
          const t2 = await r2.text().catch(()=>'');
          console.error('create chatbot failed', r2.status, t2);
        }
      }
      console.error('patch chatbot failed', res.status, errText);
      throw new Error("save_failed");
    } catch (e) {
      console.error('save chatbot failed', e);
      alert('Échec de l\'enregistrement.');
    }
  };

  const syncAll = async () => {
    await fetch("/api/automation-suite/chatbots/sync", { method: "POST" });
    load();
  };

  const doTest = async () => {
    if (!selected || !testInput.trim()) return;
    setTesting(true);
    setTestOutput(""); setTestReq(""); setTestConv([]); setTestRespId(""); setTestOpenReqId("");
    try {
      const r = await fetch(`/api/automation-suite/chatbots/${selected}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: testInput, history: testHist }),
      }).then((x) => x.json());
      setTestOutput(r?.text || JSON.stringify(r));
      try { setTestReq(JSON.stringify(r?.request_body || r?.request || {}, null, 2)); } catch { setTestReq(""); }
      try { setTestConv(Array.isArray(r?.conversation) ? r.conversation : []); } catch { setTestConv([]); }
      setTestRespId(r?.response_id || "");
      setTestOpenReqId(r?.openai_request_id || "");
      const next = [...testHist, { role: 'user', content: testInput }];
      if (r?.text) next.push({ role: 'assistant', content: r.text });
      setTestHist(next);
    } catch (e) {
      setTestOutput(String(e.message || e));
    } finally {
      setTesting(false);
    }
  };

  const removeBot = async () => {
    if (!selected) return;
    const id = selected;
    if (!confirm('Supprimer ce chatbot ? Cette action est définitive.')) return;
    try {
      const r = await fetch(`/api/automation-suite/chatbots/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
      const text = await r.text().catch(()=> '');
      if (!r.ok) throw new Error(text || `http_${r.status}`);
      setRows((prev)=> (prev || []).filter(x => x.id_bot !== id));
      setSelected(null);
    } catch (e) {
      alert(`Échec de la suppression: ${e?.message || e}`);
    }
  };
  return (
    <div className="h-full w-full flex min-h-0">
      {/* Left: list */}
      <aside className="w-72 border-r bg-white p-3 flex flex-col">
        <div className="relative flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Chatbots</div>
          <div className="flex items-center gap-2">
            <CreateBot onCreated={(id)=>{ load(); setSelected(id); }} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scroll-area">
          {loading && <div className="text-xs text-gray-500 p-2">Chargement.</div>}
          {error && <div className="text-xs text-red-600 p-2">{error}</div>}
          {(rows || []).map((r) => (
            <button key={r.id_bot} onClick={() => onPick(r.id_bot)} className={`w-full text-left px-3 py-2 rounded mb-1 hover:bg-gray-50 ${selected === r.id_bot ? 'bg-blue-50' : ''}`}>
              <div className="font-medium text-sm">{r.name || `${r.shop_name} / ${r.lang_iso}`}</div>
              <div className="text-[11px] text-gray-500">{r.id_bot}</div>
              {(r?.id_shop != null || r?.id_lang != null) && (
                <div className="text-[11px] text-gray-400">
                  {r?.id_shop != null ? `shop:${r.id_shop}` : 'shop:—'} {r?.id_lang != null ? `lang:${r.id_lang}` : 'lang:—'}
                </div>
              )}
            </button>
          ))}
          {!rows?.length && !loading && (
            <div className="text-xs text-gray-500 p-2">Aucun.</div>
          )}
        </div>
      </aside>

      {/* Right: editor */}
      <main className="flex-1 p-4 min-h-0 overflow-y-auto scroll-area">
        {!selected && (
          <div className="text-sm text-gray-500">Choisissez un chatbot à gauche.</div>
        )}
        {selected && (
          <div className="space-y-4 max-w-3xl">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Configuration</div>
              <div className="flex items-center gap-2">
                <button className="text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50 text-red-700 border-red-200" onClick={removeBot}>Supprimer</button>
                <button className="text-xs px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700" onClick={save}>Enregistrer</button>
              </div>
            </div>

            {/* ID from chatbot_config.id_bot (renamed on save) */}
            <Field label="ID (id_bot)">
              <div className="space-y-1">
                <input className="w-full border rounded px-3 py-2 text-sm" value={idEdit} onChange={(e)=>setIdEdit(e.target.value)} />
                <div className="text-[11px] text-gray-500">Changer l'ID puis cliquer sur Enregistrer.</div>
              </div>
            </Field>

            <Field label="Presta IDs">
              <div className="grid grid-cols-2 gap-2">
                <input className="w-full border rounded px-3 py-2" value={form.id_shop || ""} onChange={(e) => setForm({ ...form, id_shop: e.target.value })} placeholder="id_shop (ex: 1)" inputMode="numeric" />
                <input className="w-full border rounded px-3 py-2" value={form.id_lang || ""} onChange={(e) => setForm({ ...form, id_lang: e.target.value })} placeholder="id_lang (ex: 1)" inputMode="numeric" />
              </div>
            </Field>

            <Field label="Nom (optionnel)">
              <input className="w-full border rounded px-3 py-2" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>

            <Field label="Comportement du chatbot">
              <select
                className="border rounded px-2 py-1"
                value={form.bot_behavior || 'manual'}
                onChange={(e) => setForm({ ...form, bot_behavior: e.target.value })}
              >
                <option value="manual">Proposer sur demande</option>
                <option value="auto_draft">Proposition automatique</option>
                <option value="auto_reply">Réponse automatique</option>
              </select>
            </Field>

            <Field label="Message de bienvenue prédéfini">
              <div className="space-y-2">
                <select className="w-full border rounded px-3 py-2" value={form.welcome_message_id || ''} onChange={(e)=>setForm({...form, welcome_message_id: e.target.value})}>
                  <option value="">Aucun</option>
                  {welcomeRepo.map((w)=>(
                    <option key={(w.id_message || w.id || '').toString()} value={(w.id_message || w.id || '').toString()}>{w.title || w.name || (w.id_message || w.id)}</option>
                  ))}
                </select>
                {/* Preview the selected welcome message content (read-only) */}
                <div className="border rounded p-2 bg-gray-50 text-sm max-h-40 overflow-auto">
                  {(() => {
                    try {
                      const w = welcomeRepo.find((x)=> String(x.id_message || x.id || '') === String(form.welcome_message_id || ''));
                      if (!w) return <span className="text-gray-500">Aucun message sélectionné.</span>;
                      const title = w.title || w.name || '';
                      const content = (w.content || w.message || '').toString();
                      return (
                        <div>
                          {title ? <div className="font-medium mb-1">{title}</div> : null}
                          {content ? <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: content }} /> : <div className="text-gray-500">(Sans contenu)</div>}
                        </div>
                      );
                    } catch { return <span className="text-gray-500">Aucun message sélectionné.</span>; }
                  })()}
                </div>
              </div>
            </Field>

            <div className="space-y-1">
              <div className="text-xs text-gray-600">Local Prompt (repository)</div>
              <div className="text-[11px] text-gray-500">Assigned prompt: {selectedPrompt ? selectedPrompt.name : (form?.prompt_config_id ? `${form.prompt_config_id} (loading...)` : 'None')}</div>
              <select className="w-full border rounded px-3 py-2" value={form.prompt_config_id || ""} onChange={(e)=>setForm({...form, prompt_config_id:e.target.value})}>
                <option value="">None</option>
                {repo.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="mt-6 p-3 border rounded bg-white">
              <div className="font-medium mb-2">Test (Responses API)</div>
              <textarea
                className="w-full border rounded px-3 py-2"
                rows={4}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Votre question"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  className="text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                  onClick={doTest}
                  disabled={testing || !testInput.trim()}
                >
                  {testing ? 'Envoi...' : 'Envoyer'}
                </button>
              </div>
              {testOutput && (
                <div className="mt-3 text-sm border rounded bg-gray-50 p-2 whitespace-pre-wrap">{testOutput}</div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function CreateBot({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ shop_name: '', lang_iso: '', name: '', id_shop: '', id_lang: '' });
  const canCreate = f.shop_name.trim() && f.lang_iso.trim();
  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const body = {
        shop_name: f.shop_name.trim(),
        lang_iso: f.lang_iso.trim(),
        name: f.name || null,
        id_shop: String(f.id_shop || '').trim() || null,
        id_lang: String(f.id_lang || '').trim() || null,
      };
      const r = await fetch('/api/automation-suite/chatbots', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const text = await r.text().catch(()=> '');
      const j = text ? (()=>{ try { return JSON.parse(text); } catch { return null; } })() : null;
      if (!r.ok) throw new Error(j?.error || j?.message || text || 'create_failed');
      setOpen(false);
      setF({ shop_name: '', lang_iso: '', name: '', id_shop: '', id_lang: '' });
      onCreated?.(j.id_bot);
    } catch (e) {
      alert('Create failed: ' + (e?.message || e));
    } finally { setBusy(false); }
  };
  if (!open) return (
    <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setOpen(true)}>New</button>
  );
  return (
    <div className="absolute z-50 bg-white border rounded shadow p-3 w-[320px] right-0 top-full mt-2">
      <div className="font-medium text-sm mb-2">New Chatbot</div>
      <div className="space-y-2 text-sm">
        <div>
          <div className="text-xs text-gray-600">Shop name</div>
          <input className="w-full border rounded px-2 py-1" value={f.shop_name} onChange={(e)=>setF({...f, shop_name:e.target.value})} placeholder="My shop" />
        </div>
        <div>
          <div className="text-xs text-gray-600">Lang ISO</div>
          <input className="w-full border rounded px-2 py-1" value={f.lang_iso} onChange={(e)=>setF({...f, lang_iso:e.target.value})} placeholder="fr" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-xs text-gray-600">id_shop (optional)</div>
            <input className="w-full border rounded px-2 py-1" value={f.id_shop} onChange={(e)=>setF({...f, id_shop:e.target.value})} placeholder="1" inputMode="numeric" />
          </div>
          <div>
            <div className="text-xs text-gray-600">id_lang (optional)</div>
            <input className="w-full border rounded px-2 py-1" value={f.id_lang} onChange={(e)=>setF({...f, id_lang:e.target.value})} placeholder="1" inputMode="numeric" />
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-600">Name (optional)</div>
          <input className="w-full border rounded px-2 py-1" value={f.name} onChange={(e)=>setF({...f, name:e.target.value})} />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setOpen(false)} disabled={busy}>Cancel</button>
          <button className="text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" onClick={create} disabled={busy || !canCreate}>{busy?'Creating...':'Create'}</button>
        </div>
      </div>
    </div>
  );
}
