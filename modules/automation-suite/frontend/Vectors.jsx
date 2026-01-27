import React, { useEffect, useState } from "react";

export default function Vectors() {
  const [bots, setBots] = useState([]);
  const [selectedId, setSelectedId] = useState("__org__");
  const [serverKey, setServerKey] = useState("");
  const [serverKeyLoading, setServerKeyLoading] = useState(false);
  const [serverKeyMsg, setServerKeyMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/automation-suite/chatbots", { credentials: "include" });
        const j = await r.json();
        if (r.ok) setBots(Array.isArray(j) ? j : []);
      } catch {}
      try {
        setServerKeyLoading(true);
        const r = await fetch("/api/admin/openai/key", { credentials: "include" });
        const j = await r.json();
        if (r.ok && j?.ok) setServerKey(j.value || "");
      } catch {}
      finally {
        setServerKeyLoading(false);
      }
    })();
  }, []);

  return (
    <div className="flex-1 flex min-h-0">
      <section className="flex-1 min-h-0 flex flex-col p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-lg font-semibold">OpenAI Vector Stores</div>
            <div className="text-xs text-gray-500">Manage stores and link files (like Prompts UI).</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Credentials:</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">Server key</option>
              <option value="__org__">Organization key</option>
              {(bots || [])
                .filter((b) => b.has_api_key)
                .map((b) => (
                  <option key={b.id_bot} value={b.id_bot}>
                    {b.name || b.id_bot}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {selectedId === "" && (
          <div className="mb-4 p-3 border rounded bg-white">
            <div className="text-sm font-medium mb-2">Server OpenAI API Key</div>
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <input
                type="password"
                value={serverKey}
                onChange={(e) => setServerKey(e.target.value)}
                placeholder="sk-..."
                className="border rounded px-2 py-1 w-full md:w-96"
              />
              <button
                onClick={async () => {
                  setServerKeyMsg("");
                  setServerKeyLoading(true);
                  try {
                    const r = await fetch("/api/admin/openai/key", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ value: serverKey }),
                    });
                    const j = await r.json();
                    if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || r.status);
                    setServerKeyMsg("Saved");
                  } catch (e) {
                    setServerKeyMsg(String(e?.message || e));
                  } finally {
                    setServerKeyLoading(false);
                  }
                }}
                disabled={serverKeyLoading}
                className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:opacity-50"
              >
                {serverKeyLoading ? "Saving." : "Save Key"}
              </button>
              <button
                onClick={async () => {
                  setServerKeyMsg("");
                  setServerKeyLoading(true);
                  try {
                    const r = await fetch("/api/admin/openai/key/clear", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                    });
                    const j = await r.json();
                    if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || r.status);
                    setServerKey("");
                    setServerKeyMsg("Cleared");
                  } catch (e) {
                    setServerKeyMsg(String(e?.message || e));
                  } finally {
                    setServerKeyLoading(false);
                  }
                }}
                disabled={serverKeyLoading}
                className="px-3 py-1.5 rounded border text-sm"
              >
                Clear
              </button>
              {!!serverKeyMsg && (
                <span className="text-xs text-gray-600">{serverKeyMsg}</span>
              )}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              Used when "Server key" is selected.
            </div>
          </div>
        )}

        <OpenAiVectorStores
          botId={selectedId && selectedId !== "__org__" ? selectedId : null}
          orgUse={selectedId === "__org__"}
        />
      </section>
    </div>
  );
}

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(String(reader.result).split(",").pop());
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error || new Error("read_error"));
    reader.readAsDataURL(file);
  });
}

function OpenAiVectorStores({ botId, orgUse }) {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [after, setAfter] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createMsg, setCreateMsg] = useState("");
  const [selectedStore, setSelectedStore] = useState(null);
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [picked, setPicked] = useState([]);
  const [fileUrl, setFileUrl] = useState("");
  const [appFiles, setAppFiles] = useState([]);
  const [appFilesLoading, setAppFilesLoading] = useState(false);
  const [appFilesError, setAppFilesError] = useState("");
  const [fileQuery, setFileQuery] = useState("");

  const load = async (reset = false) => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams();
      if (botId) q.set("id_bot", botId);
      if (!botId && orgUse) q.set("org", "me");
      q.set("limit", "50");
      if (!reset && after) q.set("after", after);
      const r = await fetch(`/api/automation-suite/vector-stores?${q.toString()}`, {
        credentials: "include",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(String(j?.message || j?.error || r.status));
      const items = Array.isArray(j?.items) ? j.items : [];
      if (reset) {
        setStores(items);
        if (!selectedStore && items.length) setSelectedStore(items[0]);
      } else {
        setStores((prev) => [...prev, ...items]);
      }
      setHasMore(!!j?.has_more);
      if (j?.next_after) setAfter(String(j.next_after));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setStores([]);
    setAfter("");
    setHasMore(false);
    setSelectedStore(null);
    load(true);
  }, [botId]);

  const reloadFiles = async () => {
    if (!selectedStore) return;
    setFilesLoading(true);
    setFilesError("");
    try {
      const q = new URLSearchParams();
      if (botId) q.set("id_bot", botId);
      if (!botId && orgUse) q.set("org", "me");
      const r = await fetch(
        `/api/automation-suite/vector-stores/${encodeURIComponent(selectedStore.id)}/files?${q.toString()}`,
        { credentials: "include" }
      );
      const j = await r.json();
      if (!r.ok) throw new Error(String(j?.message || j?.error || r.status));
      setFiles(Array.isArray(j?.items) ? j.items : []);
    } catch (e) {
      setFilesError(String(e?.message || e));
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    if (selectedStore) reloadFiles();
  }, [selectedStore]);

  const loadAppFiles = async () => {
    setAppFilesLoading(true); setAppFilesError("");
    try {
      const r = await fetch('/api/automation-suite/app-files', { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      setAppFiles(Array.isArray(j?.items)? j.items: []);
    } catch (e) { setAppFilesError(String(e?.message || e)); }
    finally { setAppFilesLoading(false); }
  };
  useEffect(() => { if (selectedStore) loadAppFiles(); }, [selectedStore]);

  const attachAppFile = async (fid) => {
    if (!fid || !selectedStore) return;
    setUploading(true);
    try {
      const body = { items: [{ app_file_id: fid }] };
      if (botId) body.id_bot = botId; else if (orgUse) body.org_id = '__me__';
      const r = await fetch(`/api/automation-suite/vector-stores/${encodeURIComponent(selectedStore.id)}/files`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      await reloadFiles();
    } catch (e) { alert(String(e?.message || e)); }
    finally { setUploading(false); }
  };

  const uploadToStore = async () => {
    if (!selectedStore) return;
    if (!picked.length && !fileUrl.trim()) return;
    setUploading(true);
    try {
      const items = [];
      for (const f of picked) {
        const b64 = await fileToB64(f);
        items.push({ filename: f.name, content_b64: b64 });
      }
      if (!picked.length && fileUrl.trim()) items.push({ file_url: fileUrl.trim() });
      const body = { items };
      if (botId) body.id_bot = botId;
      if (!botId && orgUse) body.org_id = "__me__";
      const r = await fetch(`/api/automation-suite/vector-stores/${encodeURIComponent(selectedStore.id)}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j?.ok === false) throw new Error(String(j?.message || j?.error || r.status));
      setPicked([]);
      setFileUrl("");
      await reloadFiles();
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setUploading(false);
    }
  };

  const onCreate = async () => {
    const name = (createName || "").trim();
    if (!name) return;
    setCreating(true);
    setCreateMsg("");
    try {
      const body = { name };
      if (botId) body.id_bot = botId;
      if (!botId && orgUse) body.org_id = "__me__";
      const r = await fetch("/api/automation-suite/vector-stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(String(j?.message || j?.error || r.status));
      setCreateMsg(`Created: ${j?.item?.id || ""}`);
      setCreateName("");
      if (j?.item) {
        setStores((prev) => [j.item, ...prev]);
        setSelectedStore(j.item);
      }
    } catch (e) {
      setCreateMsg(`Failed: ${String(e?.message || e)}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex min-h-[500px]">
        <aside className="w-72 border-r flex flex-col">
          <div className="p-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Vector Stores</div>
            <div className="flex items-center gap-2">
              <button className="text-xs underline" onClick={() => load(true)} disabled={loading}>
                Refresh
              </button>
            </div>
          </div>
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2">
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="New store name"
                className="border rounded px-2 py-1 text-sm flex-1"
              />
              <button
                onClick={onCreate}
                disabled={creating || !createName.trim()}
                className="px-2 py-1 rounded bg-emerald-600 text-white text-xs disabled:opacity-50"
              >
                New
              </button>
            </div>
            {!!createMsg && (
              <div className="text-[11px] text-gray-600 mt-1">{createMsg}</div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2">
            {error ? (
              <div className="text-xs text-red-600 px-1">{String(error)}</div>
            ) : null}
            <div className="space-y-1">
              {(stores || []).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedStore(s)}
                  className={`w-full text-left rounded border px-2 py-2 ${
                    selectedStore && selectedStore.id === s.id
                      ? "bg-emerald-50 border-emerald-300"
                      : "bg-white"
                  }`}
                >
                  <div className="text-sm truncate">{s.name || "(unnamed)"}</div>
                  <div className="text-[11px] text-gray-500 font-mono break-all">{s.id}</div>
                </button>
              ))}
              {(!stores || !stores.length) && !loading && (
                <div className="text-xs text-gray-500 px-2 py-4">No vector stores.</div>
              )}
            </div>
          </div>
          <div className="p-2">
            {hasMore && (
              <button
                onClick={() => load(false)}
                disabled={loading}
                className="px-2 py-1 rounded border text-xs"
              >
                {loading ? "Loading." : "Load More"}
              </button>
            )}
          </div>
        </aside>
        <section className="flex-1 p-4 min-h-0 flex flex-col">
          {selectedStore ? (
            <>
              <div className="mb-3">
                <div className="text-lg font-semibold">{selectedStore.name || "(unnamed)"}</div>
                <div className="text-xs text-gray-500 font-mono break-all">{selectedStore.id}</div>
              </div>
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="file"
                  multiple
                  onChange={(e) => setPicked(Array.from(e.target.files || []))}
                />
                <input
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  placeholder="Or paste a File URL (http(s) or /api/app-files/:id/download)"
                  className="border rounded px-2 py-1 flex-1"
                />
                <button
                  onClick={uploadToStore}
                  disabled={uploading || (!picked.length && !fileUrl.trim())}
                  className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
                >
                  {uploading ? "Uploading." : "Link Files"}
                </button>
                <button
                  onClick={() => reloadFiles()}
                  className="px-2 py-1 rounded border text-xs"
                >
                  Refresh
                </button>
              </div>
              {filesError && (
                <div className="text-xs text-red-600 mb-2">{String(filesError)}</div>
              )}
              <div className="overflow-auto border rounded min-h-0">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Name</th>
                      <th className="text-left px-3 py-2">Size</th>
                      <th className="text-left px-3 py-2">File ID</th>
                      <th className="text-left px-3 py-2">Created</th>
                      <th className="text-left px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(files || []).map((f) => {
                      const sz = typeof f.size_bytes === 'number' ? (f.size_bytes < 1024 ? `${f.size_bytes} B` : f.size_bytes < 1024*1024 ? `${(f.size_bytes/1024).toFixed(1)} KB` : `${(f.size_bytes/1024/1024).toFixed(1)} MB`) : '';
                      return (
                        <tr key={f.id} className="border-b">
                          <td className="px-3 py-2 text-xs">{f.filename || ''}</td>
                          <td className="px-3 py-2 text-xs">{sz}</td>
                          <td className="px-3 py-2 font-mono text-xs">{f.id}</td>
                          <td className="px-3 py-2 text-xs">{f.created_at ? new Date(f.created_at * 1000).toLocaleString() : ''}</td>
                          <td className="px-3 py-2 text-xs">
                            <button className="px-2 py-0.5 rounded border" onClick={async()=>{ try { const q=new URLSearchParams(); if (botId) q.set('id_bot', botId); else if (orgUse) q.set('org','me'); const r = await fetch(`/api/automation-suite/vector-stores/${encodeURIComponent(selectedStore.id)}/files/${encodeURIComponent(f.id)}?${q.toString()}`, { method:'DELETE', credentials:'include' }); const j = await r.json(); if (!r.ok || j?.ok===false) throw new Error(j?.message||j?.error||r.status); await reloadFiles(); } catch(e){ alert(String(e?.message||e)); } }}>Unlink</button>
                          </td>
                        </tr>
                      );
                    })}
                    {(!files || !files.length) && !filesLoading && (
                      <tr>
                        <td className="px-3 py-3 text-sm text-gray-500" colSpan={5}>
                          No files linked.
                        </td>
                      </tr>
                    )}
                    {filesLoading && (
                      <tr>
                        <td className="px-3 py-3 text-sm text-gray-500" colSpan={5}>
                          Loading.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">Choose from uploaded files</div>
                  <div className="flex items-center gap-2">
                    <input value={fileQuery} onChange={(e)=>setFileQuery(e.target.value)} placeholder="Search..." className="border rounded px-2 py-1 text-sm" />
                    <button onClick={loadAppFiles} className="px-2 py-1 rounded border text-xs">Refresh</button>
                  </div>
                </div>
                {appFilesError && <div className="text-xs text-red-600 mb-2">{String(appFilesError)}</div>}
                <div className="overflow-auto border rounded max-h-72">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Name</th>
                        <th className="text-left px-3 py-2">Size</th>
                        <th className="text-left px-3 py-2">Modified</th>
                        <th className="text-left px-3 py-2">Categories</th>
                        <th className="text-left px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((appFiles||[]).filter(f => {
                        const q=(fileQuery||'').toLowerCase();
                        if (!q) return true;
                        const cats = Array.isArray(f.categories)? f.categories.map(c=>String(c.name||'')).join(' ') : '';
                        const s=((f.title||'')+' '+(f.name||'')+' '+cats).toLowerCase();
                        return s.includes(q);
                      })).map(f => (
                        <tr key={f.id} className="border-b">
                          <td className="px-3 py-2 text-xs">{f.title||f.name}</td>
                          <td className="px-3 py-2 text-xs">{typeof f.size==='number'? (f.size<1024? `${f.size} B` : f.size<1024*1024? `${(f.size/1024).toFixed(1)} KB` : `${(f.size/1024/1024).toFixed(1)} MB`) : ''}</td>
                          <td className="px-3 py-2 text-xs">{f.mtime ? new Date(f.mtime).toLocaleString() : ''}</td>
                          <td className="px-3 py-2 text-xs">
                            <div className="flex flex-wrap gap-1">
                              {(Array.isArray(f.categories)? f.categories: []).map(c => (
                                <span key={c.id} className="px-1 py-0.5 text-[11px] rounded bg-gray-100 border text-gray-700">{c.name}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs"><button disabled={uploading} onClick={()=>attachAppFile(f.id)} className="px-2 py-0.5 rounded border">Link</button></td>
                        </tr>
                      ))}
                      {(!appFiles||!appFiles.length) && !appFilesLoading && (
                        <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={5}>No uploaded files.</td></tr>
                      )}
                      {appFilesLoading && (
                        <tr><td className="px-3 py-3 text-sm text-gray-500" colSpan={5}>Loading.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-500">
              Select a vector store from the list.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

