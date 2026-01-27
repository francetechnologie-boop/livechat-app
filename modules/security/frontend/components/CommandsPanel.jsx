import React from 'react';

const EMPTY_FORM = { name: '', command: '' };

export default function CommandsPanel({ headers }) {
  const [commands, setCommands] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [runningId, setRunningId] = React.useState(null);
  const [runResultById, setRunResultById] = React.useState({});
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [editId, setEditId] = React.useState(null);
  const [message, setMessage] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/security/commands', { headers });
      const data = await res.json().catch(() => null);
      if (data && data.ok) {
        setCommands(Array.isArray(data.commands) ? data.commands : []);
        setMessage('');
      } else {
        setMessage('Unable to load commands.');
      }
    } catch {
      setMessage('Unable to load commands.');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  React.useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name.trim() || !form.command.trim()) {
      setMessage('Name and command are required.');
      return;
    }
    setSaving(true);
    try {
      const method = editId ? 'PUT' : 'POST';
      const path = editId ? `/api/security/commands/${editId}` : '/api/security/commands';
      const res = await fetch(path, {
        method,
        headers,
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (data && data.ok) {
        setMessage(editId ? 'Command updated.' : 'Command saved.');
        setForm(EMPTY_FORM);
        setEditId(null);
        load();
      } else {
        setMessage('Failed to save command.');
      }
    } catch {
      setMessage('Failed to save command.');
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (command) => {
    try {
      await navigator.clipboard.writeText(command);
      setMessage('Command copied to clipboard.');
    } catch {
      setMessage('Copy not supported (HTTPS required).');
    }
  };

  const run = async (cmd) => {
    if (!cmd?.id) return;
    if (!confirm('Run this command on the configured SSH host?')) return;
    setRunningId(cmd.id);
    setMessage('');
    try {
      const res = await fetch(`/api/security/commands/${cmd.id}/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ timeoutMs: 20000 }),
      });
      const data = await res.json().catch(() => null);
      if (!data || data.ok !== true) throw new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
      setRunResultById((prev) => ({ ...prev, [cmd.id]: data.result }));
      setMessage(data.result?.ok ? 'Command executed.' : 'Command failed (see output).');
    } catch (e) {
      setRunResultById((prev) => ({ ...prev, [cmd.id]: { ok: false, stderr: String(e?.message || e), stdout: '' } }));
      setMessage('Failed to execute command.');
    } finally {
      setRunningId(null);
    }
  };

  const clearResult = (id) => {
    setRunResultById((prev) => {
      const next = { ...(prev || {}) };
      delete next[id];
      return next;
    });
  };

  const startEdit = (cmd) => {
    setForm({ name: cmd.name || '', command: cmd.command || '' });
    setEditId(cmd.id);
    setMessage('');
  };

  const cancelEdit = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setMessage('');
  };

  const remove = async (id) => {
    if (!confirm('Delete this command?')) return;
    try {
      await fetch(`/api/security/commands/${id}`, { method: 'DELETE', headers });
      setMessage('Command deleted.');
      load();
    } catch {
      setMessage('Failed to delete command.');
    }
  };

  return (
    <div className="h-full min-h-0 border rounded bg-white flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Stored VPS commands</div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : editId ? 'Update' : 'Save'}
          </button>
          {editId ? (
            <button
              className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm"
              onClick={cancelEdit}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      <div className="px-3 py-2 text-xs text-gray-600 bg-gray-50 border-b">
        Save reusable commands or sequences per organization. Run executes on the SSH host configured in the Settings tab (don’t include an `ssh ...` prefix; avoid interactive/password prompts).
      </div>
      {message ? (
        <div className="px-3 py-2 text-sm text-gray-700 bg-gray-50 border-b">
          {message}
        </div>
      ) : null}
      <div className="p-3 flex-1 min-h-0 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>Name</span>
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            className="border rounded px-2 py-1 text-sm"
            placeholder="Routine name"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Command</span>
          <textarea
            value={form.command}
            onChange={(e) => setForm((prev) => ({ ...prev, command: e.target.value }))}
            className="border rounded px-2 py-1 text-sm font-mono min-h-[100px]"
            placeholder="e.g., tail -n 200 /var/log/apache2/access_unified_website.log"
          />
        </label>
        <div className="text-xs text-gray-500">Saved commands appear below. Click Copy to bring them to your shell.</div>
        <div className="flex-1 min-h-0 overflow-auto space-y-3">
          {loading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : commands.length ? (
            <div className="space-y-3">
              {commands.map((cmd) => (
                <div key={`cmd-${cmd.id}`} className="p-2 border rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm truncate" title={cmd.name}>{cmd.name || 'Untitled'}</div>
                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 rounded border bg-white text-xs"
                        onClick={() => run(cmd)}
                        disabled={runningId === cmd.id}
                        title="Execute on the configured SSH host"
                      >
                        {runningId === cmd.id ? 'Running…' : 'Run'}
                      </button>
                      <button
                        className="px-2 py-1 rounded border bg-white text-xs"
                        onClick={() => copyToClipboard(cmd.command)}
                      >
                        Copy
                      </button>
                      <button
                        className="px-2 py-1 rounded border bg-white text-xs"
                        onClick={() => startEdit(cmd)}
                      >
                        Edit
                      </button>
                      <button
                        className="px-2 py-1 rounded border bg-white text-xs text-red-600"
                        onClick={() => remove(cmd.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <pre className="whitespace-pre-wrap text-xs font-mono bg-black text-green-200 p-2 rounded">{cmd.command}</pre>
                  {runResultById[cmd.id] ? (
                    <div className="rounded border bg-white overflow-hidden">
                      <div className="px-2 py-1 border-b bg-gray-50 flex items-center justify-between gap-2">
                        <div className="text-xs text-gray-700">
                          Result: <span className={`font-semibold ${runResultById[cmd.id].ok ? 'text-emerald-700' : 'text-red-700'}`}>{runResultById[cmd.id].ok ? 'OK' : 'FAILED'}</span>
                          {runResultById[cmd.id].exitCode != null ? ` (exit ${runResultById[cmd.id].exitCode})` : ''}
                          {runResultById[cmd.id].durationMs != null ? ` · ${runResultById[cmd.id].durationMs}ms` : ''}
                          {(runResultById[cmd.id].stdoutTruncated || runResultById[cmd.id].stderrTruncated) ? ' · output truncated' : ''}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="px-2 py-1 rounded border bg-white text-xs"
                            onClick={() => copyToClipboard([runResultById[cmd.id].stdout, runResultById[cmd.id].stderr].filter(Boolean).join('\n'))}
                          >
                            Copy output
                          </button>
                          <button
                            className="px-2 py-1 rounded border bg-white text-xs"
                            onClick={() => clearResult(cmd.id)}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      {runResultById[cmd.id].hint ? (
                        <div className="px-2 py-1 text-xs text-amber-800 bg-amber-50 border-b">
                          Hint: {runResultById[cmd.id].hint}
                        </div>
                      ) : null}
                      <pre className="whitespace-pre-wrap text-xs font-mono bg-black text-gray-100 p-2 overflow-auto max-h-[260px]">
                        {(runResultById[cmd.id].stdout || '').trim() ? `STDOUT:\n${runResultById[cmd.id].stdout}` : 'STDOUT: (empty)'}
                        {'\n\n'}
                        {(runResultById[cmd.id].stderr || '').trim() ? `STDERR:\n${runResultById[cmd.id].stderr}` : 'STDERR: (empty)'}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">No commands saved yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
