import React from 'react';

export default function UfwPanel({ headers }) {
  const [loading, setLoading] = React.useState(false);
  const [output, setOutput] = React.useState('');
  const [error, setError] = React.useState('');

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/security/ufw/status', { headers });
      const j = await r.json().catch(() => null);
      if (j && j.ok) {
        setOutput(String(j.output || ''));
        setError('');
      } else {
        setOutput('');
        setError(String(j?.message || j?.error || 'Failed to fetch UFW status.'));
      }
    } catch {
      setOutput('');
      setError('Failed to fetch UFW status.');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  React.useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="h-full min-h-0 border rounded bg-white flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <div className="text-sm font-semibold">UFW status</div>
        <button
          className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {error ? (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200">
          {error}
        </div>
      ) : null}
      <div className="flex-1 min-h-0 p-2 overflow-auto font-mono text-[13px] leading-5 bg-black text-green-200">
        <pre className="whitespace-pre-wrap">{output || '(empty)'}</pre>
      </div>
    </div>
  );
}

