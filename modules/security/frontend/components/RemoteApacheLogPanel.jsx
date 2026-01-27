import React from 'react';

const APACHE_LOG_DIR = '/var/log/apache2';

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function parseApacheTimeMs(line) {
  const m = String(line || '').match(/\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})\]/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2]];
  const year = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const tz = String(m[7] || '');
  if (!Number.isFinite(day) || month == null || !Number.isFinite(year)) return null;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;
  const sign = tz.startsWith('-') ? -1 : 1;
  const tzH = Number(tz.slice(1, 3));
  const tzM = Number(tz.slice(3, 5));
  if (!Number.isFinite(tzH) || !Number.isFinite(tzM)) return null;
  const offsetMinutes = sign * (tzH * 60 + tzM);
  const localMs = Date.UTC(year, month, day, hour, minute, second);
  return localMs - offsetMinutes * 60 * 1000;
}

export default function RemoteApacheLogPanel({ headers }) {
  const [loading, setLoading] = React.useState(false);
  const [content, setContent] = React.useState('');
  const [error, setError] = React.useState('');
  const [configured, setConfigured] = React.useState(true);
  const [hint, setHint] = React.useState('');
  const [src, setSrc] = React.useState('');
  const [connections, setConnections] = React.useState([]);
  const [connectionId, setConnectionId] = React.useState(''); // ''=default/auto
  const [lines, setLines] = React.useState(300);
  const [files, setFiles] = React.useState([]);
  const [file, setFile] = React.useState('');
  const [mode, setMode] = React.useState('tail'); // tail=newest, head=oldest
  const [offset, setOffset] = React.useState(0);
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [autoMs, setAutoMs] = React.useState(10000);
  const [windowMinutes, setWindowMinutes] = React.useState(0);
  const [sortOrder, setSortOrder] = React.useState('time-asc'); // file | time-asc | time-desc
  const [filterText, setFilterText] = React.useState('');
  const [filterRegex, setFilterRegex] = React.useState(false);

  const refreshConnections = React.useCallback(async () => {
    try {
      const r = await fetch('/api/security/remote/connections', { headers });
      const j = await r.json().catch(() => null);
      if (j && j.ok) {
        const list = Array.isArray(j.connections) ? j.connections : [];
        setConnections(list);
        const activeId = j?.active?.connection_id ? String(j.active.connection_id) : '';
        setConnectionId((prev) => (prev ? prev : activeId));
      }
    } catch {}
  }, [headers]);

  const refreshFiles = React.useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (connectionId) qs.set('connection_id', String(connectionId));
      const url = qs.toString() ? `/api/security/remote/apache/files?${qs.toString()}` : '/api/security/remote/apache/files';
      const r = await fetch(url, { headers });
      const j = await r.json().catch(() => null);
      if (j && j.ok) {
        const list = Array.isArray(j.files) ? j.files.map(String) : [];
        setFiles(list);
        setConfigured(j.configured !== false);
        setHint(String(j.hint || ''));
        setSrc(String(j.src || ''));
        setError('');

        const currentFromConfig = String(j?.config?.logPath || '');
        const configuredBasename = currentFromConfig.startsWith(`${APACHE_LOG_DIR}/`)
          ? currentFromConfig.slice(`${APACHE_LOG_DIR}/`.length)
          : '';
        setFile((prev) => {
          if (prev && list.includes(prev)) return prev;
          if (configuredBasename && list.includes(configuredBasename)) return configuredBasename;
          return list[0] || '';
        });
      } else {
        setFiles([]);
        setError(String(j?.message || j?.error || 'Failed to fetch remote files.'));
      }
    } catch {
      setFiles([]);
      setError('Failed to fetch remote files.');
    }
  }, [headers, connectionId]);

  const refresh = React.useCallback(async () => {
    if (!file) {
      setContent('');
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        file: String(file),
        lines: String(lines),
        mode: String(mode || 'tail'),
        offset: String(offset || 0),
      });
      if (connectionId) qs.set('connection_id', String(connectionId));
      const r = await fetch(`/api/security/remote/apache/tail?${qs.toString()}`, { headers });
      const j = await r.json().catch(() => null);
      if (j && j.ok) {
        setContent(String(j.content || ''));
        setConfigured(j.configured !== false);
        setHint(String(j.hint || ''));
        setSrc(String(j.src || ''));
        setError('');
      } else {
        setContent('');
        setError(String(j?.message || j?.error || 'Failed to fetch remote log.'));
      }
    } catch {
      setContent('');
      setError('Failed to fetch remote log.');
    } finally {
      setLoading(false);
    }
  }, [headers, lines, file, mode, offset, connectionId]);

  React.useEffect(() => { refreshConnections(); }, [refreshConnections]);
  React.useEffect(() => { refreshFiles(); }, [refreshFiles]);
  React.useEffect(() => { refresh(); }, [refresh]);

  React.useEffect(() => {
    setOffset(0);
  }, [file, mode, connectionId]);

  React.useEffect(() => {
    if (autoRefresh && (mode !== 'tail' || offset > 0)) setAutoRefresh(false);
  }, [autoRefresh, mode, offset]);

  React.useEffect(() => {
    if (!autoRefresh) return undefined;
    if (mode !== 'tail' || offset > 0) return undefined;
    const id = setInterval(() => {
      if (!loading) refresh();
    }, Math.max(2000, Number(autoMs) || 10000));
    return () => clearInterval(id);
  }, [autoRefresh, autoMs, refresh, loading]);

  const filtered = React.useMemo(() => {
    const rawLines = String(content || '').split('\n');
    const now = Date.now();
    const threshold = windowMinutes > 0 ? now - windowMinutes * 60 * 1000 : null;

    let matcher = null;
    const q = String(filterText || '').trim();
    if (q) {
      if (filterRegex) {
        try { matcher = new RegExp(q, 'i'); } catch { matcher = null; }
      } else {
        const lower = q.toLowerCase();
        matcher = { test: (s) => String(s || '').toLowerCase().includes(lower) };
      }
    }

    const items = [];
    let total = 0;
    for (let i = 0; i < rawLines.length; i += 1) {
      const line = rawLines[i];
      if (!line) continue;
      total += 1;
      const t = parseApacheTimeMs(line);
      if (threshold != null) {
        if (t != null && t < threshold) continue;
      }
      if (matcher && !matcher.test(line)) continue;
      items.push({ i, line, t });
    }

    if (sortOrder === 'file') {
      return { lines: items.map((x) => x.line), total };
    }

    if (sortOrder === 'time-desc') {
      items.sort((a, b) => {
        const av = a.t == null ? Number.NEGATIVE_INFINITY : a.t;
        const bv = b.t == null ? Number.NEGATIVE_INFINITY : b.t;
        if (av === bv) return a.i - b.i;
        return bv - av;
      });
      return { lines: items.map((x) => x.line), total };
    }

    items.sort((a, b) => {
      const av = a.t == null ? Number.POSITIVE_INFINITY : a.t;
      const bv = b.t == null ? Number.POSITIVE_INFINITY : b.t;
      if (av === bv) return a.i - b.i;
      return av - bv;
    });

    return { lines: items.map((x) => x.line), total };
  }, [content, filterText, filterRegex, windowMinutes, sortOrder]);

  return (
    <div className="h-full min-h-0 border rounded bg-white flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold">Remote Apache log</div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            className="border rounded px-2 py-1 text-sm max-w-[260px]"
            title="Remote connection profile (empty = default/auto)"
          >
            <option value="">Default (auto)</option>
            {connections.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.is_default ? '★ ' : ''}{c.name}
              </option>
            ))}
          </select>
          <select
            value={file}
            onChange={(e) => setFile(e.target.value)}
            className="border rounded px-2 py-1 text-sm max-w-[320px]"
            title={file ? `${APACHE_LOG_DIR}/${file}` : 'Select a file'}
          >
            {files.length ? null : <option value="">(no files)</option>}
            {files.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select value={lines} onChange={(e) => setLines(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
            <option value={100}>100 lines</option>
            <option value={300}>300 lines</option>
            <option value={600}>600 lines</option>
            <option value={1000}>1000 lines</option>
            <option value={2000}>2000 lines</option>
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="border rounded px-2 py-1 text-sm" title="Newest (tail) or Oldest (head)">
            <option value="tail">Newest</option>
            <option value="head">Oldest</option>
          </select>
          <button
            className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            onClick={() => setOffset((v) => Math.max(0, Number(v || 0) - Number(lines || 0)))}
            disabled={loading || offset <= 0}
            title={mode === 'tail' ? 'Newer (closer to end of file)' : 'Earlier (closer to start of file)'}
          >
            {mode === 'tail' ? 'Newer' : 'Earlier'}
          </button>
          <button
            className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            onClick={() => setOffset((v) => Math.min(5000000, Number(v || 0) + Number(lines || 0)))}
            disabled={loading}
            title={mode === 'tail' ? 'Older (further back in file)' : 'Later (further into file)'}
          >
            {mode === 'tail' ? 'Older' : 'Later'}
          </button>
          <select value={windowMinutes} onChange={(e) => setWindowMinutes(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
            <option value={0}>All</option>
            <option value={5}>Last 5 min</option>
            <option value={15}>Last 15 min</option>
            <option value={60}>Last 1 hour</option>
            <option value={360}>Last 6 hours</option>
            <option value={1440}>Last 24 hours</option>
          </select>
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="time-asc">Time ↑</option>
            <option value="time-desc">Time ↓</option>
            <option value="file">File order</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              disabled={mode !== 'tail' || offset > 0}
              title={mode !== 'tail' || offset > 0 ? 'Auto-refresh only works on Newest + Offset 0' : 'Auto-refresh'}
            />
            Auto
          </label>
          {src ? <div className="text-xs text-gray-500">src: {src}</div> : null}
          <select
            value={autoMs}
            onChange={(e) => setAutoMs(Number(e.target.value))}
            className="border rounded px-2 py-1 text-sm"
            disabled={!autoRefresh || mode !== 'tail' || offset > 0}
          >
            <option value={3000}>3s</option>
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={30000}>30s</option>
            <option value={60000}>60s</option>
          </select>
          <button
            className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            onClick={refreshFiles}
            disabled={loading}
          >
            Reload files
          </button>
          <button
            className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={filterRegex ? 'Filter (regex)' : 'Filter (text)'}
            className="border rounded px-2 py-1 text-sm w-[280px]"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filterRegex} onChange={(e) => setFilterRegex(e.target.checked)} />
            Regex
          </label>
          <button
            className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            onClick={() => setFilterText('')}
            disabled={!filterText}
          >
            Clear
          </button>
        </div>
        <div className="text-xs text-gray-600">
          {mode === 'tail' ? 'Newest' : 'Oldest'} • Offset {offset} • Showing {filtered.lines.length} / {filtered.total}
        </div>
      </div>
      {!configured ? (
        <div className="px-3 py-2 text-sm text-amber-800 bg-amber-50 border-b border-amber-200">
          {hint || 'Remote log is not configured. Set `SECURITY_LOG_SSH_HOST` (and related env vars) on the backend server or use the Settings tab.'}
        </div>
      ) : null}
      {error ? (
        <div className="px-3 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200">
          {error}
        </div>
      ) : null}
      <div className="flex-1 min-h-0 p-2 overflow-auto font-mono text-[13px] leading-5 bg-black text-green-200">
        <pre className="whitespace-pre-wrap">{filtered.lines.join('\n') || '(empty)'}</pre>
      </div>
    </div>
  );
}
