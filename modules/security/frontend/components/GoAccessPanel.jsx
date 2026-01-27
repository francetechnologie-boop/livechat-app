import React from 'react';
import IframePanel from './IframePanel.jsx';

function normalizeUrl(url) {
  const v = String(url || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) return '';
  return v;
}

export default function GoAccessPanel({ headers }) {
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [items, setItems] = React.useState([]);

  const [selectedId, setSelectedId] = React.useState(null);
  const selected = React.useMemo(() => items.find((x) => String(x.id) === String(selectedId)) || null, [items, selectedId]);

  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [editId, setEditId] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/security/goaccess/dashboards', { headers });
      const j = await r.json().catch(() => null);
      if (j && j.ok) {
        const list = Array.isArray(j.items) ? j.items : [];
        setItems(list);
        setError('');
        setSelectedId((prev) => {
          if (prev && list.some((x) => String(x.id) === String(prev))) return prev;
          return list[0] ? list[0].id : null;
        });
      } else {
        setItems([]);
        setError(String(j?.message || j?.error || 'Failed to load dashboards.'));
      }
    } catch {
      setItems([]);
      setError('Failed to load dashboards.');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  React.useEffect(() => { load(); }, [load]);

  const startAdd = () => {
    setEditId(null);
    setName('');
    setUrl('');
    setError('');
  };

  const startEdit = (item) => {
    setEditId(item?.id ?? null);
    setName(String(item?.name || ''));
    setUrl(String(item?.url || ''));
    setError('');
  };

  const save = async () => {
    const n = String(name || '').trim();
    const u = normalizeUrl(url);
    if (!n) { setError('Name is required.'); return; }
    if (!u) { setError('URL must start with http:// or https://'); return; }

    setSaving(true);
    try {
      const method = editId ? 'PUT' : 'POST';
      const path = editId ? `/api/security/goaccess/dashboards/${encodeURIComponent(String(editId))}` : '/api/security/goaccess/dashboards';
      const r = await fetch(path, { method, headers, body: JSON.stringify({ name: n, url: u }) });
      const j = await r.json().catch(() => null);
      if (j && j.ok) {
        setError('');
        setEditId(null);
        setName('');
        setUrl('');
        await load();
        if (j.item && j.item.id) setSelectedId(j.item.id);
      } else {
        setError(String(j?.message || j?.error || 'Save failed.'));
      }
    } catch {
      setError('Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!id) return;
    if (!window.confirm('Delete this dashboard link?')) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/security/goaccess/dashboards/${encodeURIComponent(String(id))}`, { method: 'DELETE', headers });
      const j = await r.json().catch(() => null);
      if (j && j.ok) {
        setError('');
        await load();
      } else {
        setError(String(j?.message || j?.error || 'Delete failed.'));
      }
    } catch {
      setError('Delete failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full min-h-0 border rounded bg-white flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold">GoAccess dashboards</div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={load} disabled={loading || saving}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={startAdd} disabled={saving}>
            Add
          </button>
        </div>
      </div>

      {error ? (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200">{error}</div>
      ) : null}

      <div className="px-3 py-2 border-b bg-gray-50">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
          <div>
            <div className="text-xs text-gray-600 mb-1">{editId ? 'Edit name' : 'Name'}</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" placeholder="e.g. Main access log" />
          </div>
          <div className="md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">{editId ? 'Edit URL' : 'URL'}</div>
            <input value={url} onChange={(e) => setUrl(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" placeholder="https://your-domain/goaccess/" />
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : (editId ? 'Save' : 'Create')}
          </button>
          {editId ? (
            <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={startAdd} disabled={saving}>
              Cancel
            </button>
          ) : null}
          <div className="text-xs text-gray-500">Tip: if iframe is blocked, use Open.</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-3 gap-3 p-3">
        <div className="xl:col-span-1 min-h-0 border rounded bg-white overflow-auto">
          <div className="px-3 py-2 border-b text-xs text-gray-600">
            {items.length} dashboards
          </div>
          <div className="divide-y">
            {items.map((it) => {
              const active = String(it.id) === String(selectedId);
              return (
                <div key={it.id} className={`px-3 py-2 ${active ? 'bg-blue-50' : ''}`}>
                  <button
                    className="text-left w-full"
                    onClick={() => setSelectedId(it.id)}
                    title={String(it.url || '')}
                  >
                    <div className="text-sm font-medium">{String(it.name || '')}</div>
                    <div className="text-xs text-gray-600 break-all">{String(it.url || '')}</div>
                  </button>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <a
                      className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
                      href={String(it.url || '#')}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                    <button
                      className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs"
                      onClick={() => startEdit(it)}
                      disabled={saving}
                    >
                      Edit
                    </button>
                    <button
                      className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-xs text-red-700"
                      onClick={() => remove(it.id)}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
            {!items.length ? (
              <div className="px-3 py-3 text-sm text-gray-600">
                No dashboards yet. Add one above.
              </div>
            ) : null}
          </div>
        </div>

        <div className="xl:col-span-2 min-h-0">
          {selected && selected.url ? (
            <IframePanel
              title={String(selected.name || 'GoAccess')}
              url={String(selected.url || '')}
              hint="If the iframe is blocked (X-Frame-Options / CSP), use “Open”."
            />
          ) : (
            <div className="h-full min-h-0 border rounded bg-white flex items-center justify-center text-sm text-gray-600">
              Select a dashboard to preview.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
