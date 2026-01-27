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

export default function Fail2banStatusPanel({ headers = {}, embedded = false }) {
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [items, setItems] = React.useState([]);
  const [expanded, setExpanded] = React.useState({});
  const [includeIps, setIncludeIps] = React.useState(false);

  const fetchJson = React.useMemo(() => {
    return async (url) => {
      const r = await fetch(url, { credentials: 'include', headers: { ...(headers || {}) } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      return j;
    };
  }, [headers]);

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      const qs = new URLSearchParams();
      if (includeIps) qs.set('include_ips', '1');
      const j = await fetchJson(`/api/security/fail2ban/jails?${qs.toString()}`);
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      setItems([]);
      setMessage(pickErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeIps]);

  const toggle = (jail) => setExpanded((p) => ({ ...p, [jail]: !p[jail] }));

  return (
    <div className={`${embedded ? '' : 'rounded border'} bg-white ${embedded ? '' : 'p-3'} space-y-3`}>
      {!embedded ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Fail2ban Status</div>
            <div className="text-xs text-gray-500">Shows jails and banned counts.</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 flex items-center gap-2">
              <input type="checkbox" checked={includeIps} onChange={(e) => setIncludeIps(e.target.checked)} />
              include IPs (truncated)
            </label>
            <button
              className="px-3 py-1.5 rounded border text-sm bg-gray-50 hover:bg-gray-100"
              onClick={load}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <label className="text-xs text-gray-600 flex items-center gap-2">
            <input type="checkbox" checked={includeIps} onChange={(e) => setIncludeIps(e.target.checked)} />
            include IPs (truncated)
          </label>
          <button
            className="px-3 py-1.5 rounded border text-sm bg-gray-50 hover:bg-gray-100"
            onClick={load}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      )}

      {message ? <div className="text-sm text-red-700">{message}</div> : null}
      {!message && !loading && !items.length ? (
        <div className="text-xs text-gray-500">
          If this is a remote VPS, configure SSH in the <span className="font-semibold">Settings</span> tab (ssh_host / ssh_user / ssh_key_path).
        </div>
      ) : null}

      <div className="rounded border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">Jail</th>
              <th className="text-right px-3 py-2">Currently banned</th>
              <th className="text-right px-3 py-2">Total banned</th>
              <th className="text-right px-3 py-2">Currently failed</th>
              <th className="text-right px-3 py-2">Total failed</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((it) => (
                <React.Fragment key={it.jail}>
                  <tr
                    className="border-t hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggle(it.jail)}
                    title="Click to expand"
                  >
                    <td className="px-3 py-2 font-medium">{it.jail}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(it.currently_banned)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(it.total_banned)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(it.currently_failed)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(it.total_failed)}</td>
                  </tr>
                  {expanded[it.jail] ? (
                    <tr className="border-t bg-white">
                      <td className="px-3 py-2 text-xs text-gray-600" colSpan={5}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <div className="font-semibold text-gray-700">Files</div>
                            <div className="mt-1 font-mono text-[11px] whitespace-pre-wrap">
                              {Array.isArray(it.file_list) && it.file_list.length ? it.file_list.join('\n') : '—'}
                            </div>
                          </div>
                          <div>
                            <div className="font-semibold text-gray-700">Banned IPs</div>
                            <div className="mt-1 font-mono text-[11px] whitespace-pre-wrap">
                              {Array.isArray(it.banned_ips) && it.banned_ips.length ? it.banned_ips.join('\n') : '—'}
                              {it.banned_ips_truncated ? '\n[truncated]' : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))
            ) : (
              <tr className="border-t">
                <td className="px-3 py-6 text-gray-500" colSpan={5}>
                  {loading ? 'Loading…' : 'No jails found (or fail2ban is not installed).'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

