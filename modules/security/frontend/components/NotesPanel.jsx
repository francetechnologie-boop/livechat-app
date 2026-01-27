import React from 'react';

function titleForTab(tab) {
  switch (tab) {
    case 'uptime-kuma': return 'Notes: Uptime Kuma';
    case 'ufw': return 'Notes: UFW';
    case 'fail2ban': return 'Notes: Fail2ban';
    case 'cloudflare': return 'Notes: Cloudflare';
    case 'goaccess': return 'Notes: GoAccess';
    case 'remote-log': return 'Notes: Remote log';
    case 'settings': return 'Notes: Settings';
    case 'commands': return 'Notes: VPS Commands';
    case 'cockpit': return 'Notes: Cockpit';
    default: return 'Notes';
  }
}

export default function NotesPanel({ tab, headers }) {
  const [note, setNote] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    if (!tab) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/security/notes/${encodeURIComponent(tab)}`, { headers });
      const j = await r.json().catch(() => null);
      if (j && j.ok) {
        setNote(String(j.note || ''));
        setError('');
      } else {
        setError('Failed to load notes.');
      }
    } catch {
      setError('Failed to load notes.');
    } finally {
      setLoading(false);
    }
  }, [tab, headers]);

  React.useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!tab) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/security/notes/${encodeURIComponent(tab)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ note }),
      });
      const j = await r.json().catch(() => null);
      if (j && j.ok) {
        setNote(String(j.note || ''));
        setError('');
      } else {
        setError('Failed to save notes.');
      }
    } catch {
      setError('Failed to save notes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full min-h-0 border rounded bg-white flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <div className="text-sm font-semibold">{titleForTab(tab)}</div>
        <button
          className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
          onClick={save}
          disabled={saving || loading}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200">
          {error}
        </div>
      ) : null}
      <div className="p-3 flex-1 min-h-0">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={loading ? 'Loading…' : 'Write notes here…'}
          className="w-full h-full min-h-[220px] border rounded p-2 text-sm font-mono resize-none"
        />
      </div>
    </div>
  );
}
