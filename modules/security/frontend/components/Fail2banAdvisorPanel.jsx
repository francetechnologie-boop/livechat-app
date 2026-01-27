import React from 'react';

function pickErrorMessage(e) {
  try {
    return String(e?.message || e || '').trim() || 'Error';
  } catch {
    return 'Error';
  }
}

function formatNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

function formatStatusCodes(map) {
  if (!map || typeof map !== 'object') return '—';
  const entries = Object.entries(map)
    .filter(([k, v]) => k && Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 6);
  if (!entries.length) return '—';
  return entries.map(([k, v]) => `${k}:${v}`).join('  ');
}

function SnippetBox({ title, path, value, onCopy }) {
  return (
    <div className="rounded border bg-white overflow-hidden">
      <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          {path ? <div className="text-xs text-gray-500 font-mono truncate">{path}</div> : null}
        </div>
        <button
          className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm"
          onClick={onCopy}
          disabled={!value}
        >
          Copy
        </button>
      </div>
      <textarea
        className="w-full p-3 font-mono text-[12px] min-h-[180px] outline-none"
        readOnly
        value={value || ''}
      />
    </div>
  );
}

export default function Fail2banAdvisorPanel({ headers = {} }) {
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [analysis, setAnalysis] = React.useState(null);
  const [fromMinutes, setFromMinutes] = React.useState(1440);
  const [lines, setLines] = React.useState(20000);

  const load = React.useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const qs = new URLSearchParams();
      qs.set('fromMinutes', String(fromMinutes));
      qs.set('lines', String(lines));
      const r = await fetch(`/api/security/fail2ban/analyze?${qs.toString()}`, { credentials: 'include', headers });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      setAnalysis(j);
    } catch (e) {
      setAnalysis(null);
      setMessage(pickErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [fromMinutes, lines, headers]);

  React.useEffect(() => { load().catch(() => {}); }, [load]);

  const copyText = async (text, okMsg) => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      setMessage(okMsg || 'Copied to clipboard.');
    } catch {
      setMessage('Copy not supported (HTTPS required).');
    }
  };

  const top = Array.isArray(analysis?.topOffenders) && analysis.topOffenders.length ? analysis.topOffenders[0] : null;
  const filterFileName = analysis?.recommendedFail2ban?.filterFileName || 'unified-website.conf';
  const filterConf = analysis?.recommendedFail2ban?.filterConf || '';
  const jailLocal = analysis?.recommendedFail2ban?.jailLocal || '';
  const commands = Array.isArray(analysis?.recommendedFail2ban?.commands) ? analysis.recommendedFail2ban.commands : [];
  const testCommand = analysis?.recommendedFail2ban?.testCommand || '';

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      <div className="rounded border bg-white p-3 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Fail2ban Advisor</div>
            <div className="text-xs text-gray-500">
              Analyzes <span className="font-mono">access_unified_website.log</span> (via SSH) and generates a filter + jail snippet.
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-600 flex items-center gap-2">
              Range
              <select
                className="border rounded px-2 py-1 text-sm"
                value={fromMinutes}
                onChange={(e) => setFromMinutes(Number(e.target.value))}
                disabled={loading}
              >
                <option value={60}>Last 1h</option>
                <option value={1440}>Last 24h</option>
                <option value={10080}>Last 7d</option>
              </select>
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-2">
              Lines
              <select
                className="border rounded px-2 py-1 text-sm"
                value={lines}
                onChange={(e) => setLines(Number(e.target.value))}
                disabled={loading}
              >
                <option value={5000}>5k</option>
                <option value={20000}>20k</option>
                <option value={100000}>100k</option>
              </select>
            </label>
            <button
              className="px-3 py-1.5 rounded border text-sm bg-gray-50 hover:bg-gray-100 disabled:opacity-60"
              onClick={load}
              disabled={loading}
            >
              {loading ? 'Analyzing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {message ? (
          <div className={`px-2 py-1 text-sm rounded ${message.toLowerCase().includes('failed') || message.toLowerCase().includes('error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
            {message}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-500">Total requests</div>
            <div className="text-xl font-semibold">{formatNumber(analysis?.totalRequests)}</div>
            <div className="text-xs text-gray-500">{analysis?.timeRange || '—'}</div>
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-500">Unique IPs</div>
            <div className="text-xl font-semibold">{formatNumber(analysis?.uniqueIPs)}</div>
            <div className="text-xs text-gray-500">IPs seen</div>
          </div>
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-xs text-gray-500">Top offender</div>
            <div className="text-sm font-semibold font-mono truncate">{top?.ip || '—'}</div>
            <div className="text-xs text-gray-500">{top ? `${formatNumber(top.count)} requests` : '—'}</div>
          </div>
        </div>
      </div>

      <div className="rounded border bg-white p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Log analysis summary</div>
            <div className="text-xs text-gray-500">Top IPs, status codes, and burst patterns.</div>
          </div>
        </div>

        <div className="rounded border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">IP</th>
                <th className="text-right px-3 py-2">Requests</th>
                <th className="text-right px-3 py-2">Max / minute</th>
                <th className="text-left px-3 py-2">Top paths</th>
                <th className="text-left px-3 py-2">Status codes</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(analysis?.topOffenders) && analysis.topOffenders.length ? (
                analysis.topOffenders.slice(0, 20).map((it) => (
                  <tr key={it.ip} className="border-t">
                    <td className="px-3 py-2 font-mono text-[12px]">{it.ip}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(it.count)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(it.burstMaxPerMinute)}</td>
                    <td className="px-3 py-2 text-[12px] font-mono whitespace-pre-wrap">{Array.isArray(it.paths) && it.paths.length ? it.paths.join('\n') : '—'}</td>
                    <td className="px-3 py-2 text-[12px] font-mono">{formatStatusCodes(it.statusCodes)}</td>
                  </tr>
                ))
              ) : (
                <tr className="border-t">
                  <td className="px-3 py-6 text-gray-500" colSpan={5}>
                    {loading ? 'Analyzing…' : 'No data yet. Check Security → Settings (SSH + log path).'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded border bg-white p-3 space-y-3">
        <div>
          <div className="text-sm font-semibold">Detected suspicious patterns</div>
          <div className="text-xs text-gray-500">Common scan paths, auth failures, and suspicious user-agents.</div>
        </div>
        <div className="rounded border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Pattern</th>
                <th className="text-right px-3 py-2">Count</th>
                <th className="text-left px-3 py-2">Samples</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(analysis?.suspiciousPatterns) && analysis.suspiciousPatterns.length ? (
                analysis.suspiciousPatterns.slice(0, 20).map((p) => (
                  <tr key={p.pattern} className="border-t">
                    <td className="px-3 py-2">{p.pattern}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(p.count)}</td>
                    <td className="px-3 py-2 text-[12px] font-mono whitespace-pre-wrap">
                      {Array.isArray(p.samplePaths) && p.samplePaths.length ? p.samplePaths.join('\n') : '—'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t">
                  <td className="px-3 py-6 text-gray-500" colSpan={3}>
                    {loading ? 'Analyzing…' : 'No patterns detected in the selected range.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded border bg-white p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Recommended Fail2ban configuration</div>
            <div className="text-xs text-gray-500">Ready-to-copy filter + jail config, plus commands to enable and test.</div>
          </div>
          <div className="flex items-center gap-2">
            {testCommand ? (
              <button
                className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm"
                onClick={() => copyText(testCommand, 'Test command copied.')}
              >
                Copy test command
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <SnippetBox
            title="Filter"
            path={`/etc/fail2ban/filter.d/${filterFileName}`}
            value={filterConf}
            onCopy={() => copyText(filterConf, 'Filter copied.')}
          />
          <SnippetBox
            title="Jail"
            path="/etc/fail2ban/jail.local"
            value={jailLocal}
            onCopy={() => copyText(jailLocal, 'Jail config copied.')}
          />
        </div>

        <div className="rounded border bg-gray-50 p-3">
          <div className="text-sm font-semibold">Commands</div>
          <div className="text-xs text-gray-500">Run on the target VPS (Debian/Ubuntu).</div>
          <div className="mt-2 space-y-2">
            {commands.length ? (
              <div className="font-mono text-[12px] whitespace-pre-wrap">
                {commands.join('\n')}
              </div>
            ) : (
              <div className="text-xs text-gray-500">—</div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm"
                onClick={() => copyText(commands.join('\n'), 'Commands copied.')}
                disabled={!commands.length}
              >
                Copy commands
              </button>
              {testCommand ? (
                <div className="text-xs text-gray-600">
                  Test with: <span className="font-mono">{testCommand}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

