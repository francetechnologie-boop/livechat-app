import React, { useEffect, useMemo, useState } from 'react';
import JsonEditModal from './JsonEditModal.jsx';

function normalizeTypes(types) {
  const list = Array.isArray(types) ? types : [];
  return list
    .map((t) => ({ id: String(t?.id || '').trim(), label: String(t?.name || t?.code || t?.id || '').trim() }))
    .filter((t) => t.id);
}

function byLowerName(a, b) {
  try { return String(a?.name || '').toLowerCase().localeCompare(String(b?.name || '').toLowerCase()); } catch { return 0; }
}

export default function TypeToolsPanel({ types }) {
  const typeOptions = useMemo(() => normalizeTypes(types), [types]);
  const [typeId, setTypeId] = useState(typeOptions[0]?.id || '');
  const selectedType = useMemo(() => (Array.isArray(types) ? types : []).find((t) => String(t?.id || '').trim() === String(typeId || '').trim()) || null, [types, typeId]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [typeTools, setTypeTools] = useState([]);

  const [jsonEditor, setJsonEditor] = useState(null); // { title, value, onSave }
  const [jsonSaving, setJsonSaving] = useState(false);

  useEffect(() => {
    if (!typeId && typeOptions.length) setTypeId(typeOptions[0].id);
  }, [typeId, typeOptions]);

  const loadTypeTools = async (tid) => {
    if (!tid) { setTypeTools([]); return; }
    try {
      const r = await fetch(`/api/mcp2/types/${encodeURIComponent(tid)}/tools`, { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'load_failed');
      setTypeTools(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setTypeTools([]);
      setErr(String(e?.message || e));
    }
  };

  const refresh = async () => {
    setBusy(true);
    setErr('');
    try {
      await loadTypeTools(typeId);
    } finally {
      setBusy(false);
    }
  };

  const linkFromCatalog = async () => {
    if (!typeId) return;
    setBusy(true);
    setErr('');
    try {
      const suggested = String(selectedType?.tool_prefix || '').trim() || String(selectedType?.code || '').trim();
      const prefixes = window.prompt('Tool prefixes to link from mod_mcp2_tool (comma-separated).\n\nExamples:\n- psdb\n- psdb, psapi\n\nLeave empty to use type.tool_prefix (or type.code).', suggested);
      const payload = {};
      if (prefixes != null && String(prefixes).trim()) payload.prefixes = String(prefixes);
      const r = await fetch(`/api/mcp2/types/${encodeURIComponent(typeId)}/link-tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'link_failed');
      await loadTypeTools(typeId);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [typeId]);

  const createAndLink = () => {
    if (!typeId) return;
    setJsonEditor({
      title: 'Create tool (for this type)',
      value: {
        tool_id: '',
        name: '',
        description: '',
        input_schema: { type: 'object' },
        code: {},
        version: 1,
      },
      onSave: async (next) => {
        const nm = String(next?.name || '').trim();
        if (!nm) throw new Error('name is required');
        setJsonSaving(true);
        try {
          const r = await fetch(`/api/mcp2/types/${encodeURIComponent(typeId)}/tools`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ tool: next }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'save_failed');
          await loadTypeTools(typeId);
        } finally {
          setJsonSaving(false);
          setJsonEditor(null);
        }
      },
    });
  };

  const editTool = (it) => {
    const toolId = String(it?.tool_id || '').trim();
    const t = it?.tool || {};
    setJsonEditor({
      title: `Edit tool: ${t.name || toolId || ''}`,
      value: {
        tool_id: toolId,
        name: t.name || '',
        description: t.description || '',
        input_schema: t.input_schema || { type: 'object' },
        code: t.code || {},
        version: t.version || 1,
      },
      onSave: async (next) => {
        const id = String(next?.tool_id || '').trim();
        if (!id) throw new Error('tool_id is required');
        const nm = String(next?.name || '').trim();
        if (!nm) throw new Error('name is required');
        setJsonSaving(true);
        try {
          const payload = { ...next };
          delete payload.tool_id;
          const r = await fetch(`/api/mcp2/types/${encodeURIComponent(typeId)}/tools/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || 'save_failed');
          await loadTypeTools(typeId);
        } finally {
          setJsonSaving(false);
          setJsonEditor(null);
        }
      },
    });
  };

  const unlink = async (toolId) => {
    if (!typeId || !toolId) return;
    const ok = window.confirm('Remove this tool from the type?');
    if (!ok) return;
    setBusy(true);
    setErr('');
    try {
      await fetch(`/api/mcp2/types/${encodeURIComponent(typeId)}/tools/${encodeURIComponent(toolId)}`, { method: 'DELETE', credentials: 'include' });
      await loadTypeTools(typeId);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const items = useMemo(() => {
    const arr = Array.isArray(typeTools) ? typeTools : [];
    return arr
      .map((x) => ({
        tool_id: String(x?.tool_id || '').trim(),
        tool: x?.tool || null,
      }))
      .filter((x) => x.tool_id && x.tool)
      .map((x) => {
        const name = String(x?.tool?.name || '').trim() || x.tool_id;
        return { ...x, tool: { ...(x.tool || {}), name } };
      })
      .sort((a, b) => byLowerName(a.tool, b.tool));
  }, [typeTools]);

  return (
    <div className="border rounded bg-white">
      <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Type standard tools</div>
        <div className="flex items-center gap-2">
          <button className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" onClick={refresh} disabled={busy}>
            {busy ? 'Loading…' : 'Refresh'}
          </button>
          <button className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" onClick={linkFromCatalog} disabled={busy || !typeId}>
            Auto-link from catalog
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <label className="block text-sm">
          <div className="text-xs text-gray-600">Type</div>
          <select className="mt-1 w-full border rounded px-2 py-1 bg-white text-sm" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">Select a type</option>
            {typeOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>

        {!!err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err}</div>}

        <div className="border rounded">
          <div className="px-2 py-1 border-b bg-gray-50 text-[11px] text-gray-600 flex items-center justify-between">
            <div>Tools ({items.length})</div>
            <div className="flex items-center gap-2">
              <button className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" onClick={createAndLink} disabled={!typeId}>
                + New tool
              </button>
            </div>
          </div>
          <div className="max-h-56 overflow-auto">
            {items.map((it) => (
              <div key={it.tool_id} className="px-2 py-2 border-b last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-mono truncate" title={it.tool?.name || ''}>{it.tool?.name || ''}</div>
                    <div className="text-[11px] text-gray-600 truncate">{it.tool?.description || ''}</div>
                    <div className="text-[10px] text-gray-500 truncate">id: <span className="font-mono">{it.tool_id}</span></div>
                    {String(it.tool?.name || '').trim() === it.tool_id && (
                      <div className="text-[10px] text-amber-700 truncate">Missing tool name (showing `tool_id`). Click Edit to set a proper name.</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" onClick={() => editTool(it)}>
                      Edit
                    </button>
                    <button className="text-[11px] px-2 py-0.5 rounded border border-gray-300 text-red-700 hover:bg-red-50" onClick={() => unlink(it.tool_id)}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {!items.length && (
              <div className="px-2 py-3 text-xs text-gray-500">No tools linked to this type.</div>
            )}
          </div>
        </div>
      </div>

      <JsonEditModal
        open={!!jsonEditor}
        title={jsonEditor?.title || 'Edit JSON'}
        value={jsonEditor?.value}
        onClose={() => { if (!jsonSaving) setJsonEditor(null); }}
        onSave={jsonEditor?.onSave}
        saving={jsonSaving}
      />
    </div>
  );
}
