import React, { useEffect, useMemo, useRef, useState } from 'react';

function useAdminToken(): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [token, setToken] = useState<string>(() => {
    try { return localStorage.getItem('adminToken') || ''; } catch { return ''; }
  });
  useEffect(() => { try { localStorage.setItem('adminToken', token || ''); } catch {} }, [token]);
  return [token, setToken];
}

export default function Logs2Main() {
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: ['Activity Logs'] })); } catch {}
  }, []);
  const [status, setStatus] = useState<any>({ enabled: true, stdout: false, exists: false, sizeBytes: 0 });
  const [lines, setLines] = useState<number>(200);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [auto, setAuto] = useState<boolean>(true);
  const [adminToken, setAdminToken] = useAdminToken();
  const timerRef = useRef<any>(null);
  const [error, setError] = useState<string>('');
  const [section, setSection] = useState<'system'|'api'|'chat'|'visitors'|'db'>('system');
  const [textFilter, setTextFilter] = useState<string>(() => {
    try { return localStorage.getItem('logs2.textFilter') || ''; } catch { return ''; }
  });
  useEffect(() => { try { localStorage.setItem('logs2.textFilter', textFilter || ''); } catch {} }, [textFilter]);

  const headers = useMemo(() => (
    adminToken ? { 'x-admin-token': adminToken, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
  ), [adminToken]);

  const fetchStatus = async () => {
    try {
      const r = await fetch(`/api/modules/logs2/status`, { headers });
      const j = await r.json();
      setError('');
      if (j && j.ok) setStatus(j);
    } catch { setError('Impossible de récupérer le statut des logs.'); }
  };
  const fetchLogs = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/modules/logs2/tail?lines=${encodeURIComponent(String(lines))}`, { headers });
      const j = await r.json();
      setError('');
      if (j && j.ok) setContent(j.content || '');
    } catch {
      setContent(''); setError('Échec de la récupération des logs.');
    } finally { setLoading(false); }
  };

  const setStdout = async (stdout: boolean) => {
    try {
      await fetch('/api/modules/logs2/stdout', { method: 'POST', headers, body: JSON.stringify({ stdout }) });
      await fetchStatus();
    } catch {}
  };
  const clearLogs = async () => {
    if (!confirm('Effacer le fichier de log ?')) return;
    try {
      await fetch('/api/modules/logs2/clear', { method: 'POST', headers });
      setContent('');
      await fetchStatus();
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    fetchLogs();
  }, []);

  useEffect(() => {
    if (!adminToken) return;
    fetchStatus();
    fetchLogs();
  }, [adminToken]);

  useEffect(() => {
    if (auto) {
      timerRef.current = setInterval(() => { fetchLogs(); }, 1500);
      return () => { clearInterval(timerRef.current); };
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [auto, lines, headers]);

  const filters = useMemo(() => ({
    system: [/^/],
    api: [/\bapi\b/i, /auth/i, /token/i],
    chat: [/socket/i, /chat/i, /dashboard/i],
    visitors: [/visitor/i, /visitors/i, /geo/i, /GEO/, /ip\b/i],
    db: [/\bselect\b/i, /\binsert\b/i, /\bupdate\b/i, /db/i, /schema/i],
  }), []);

  const filteredContent = useMemo(() => {
    if (!content) return '';
    const preds = (filters as any)[section] || [];
    try {
      const rows = content.split(/\r?\n/).filter(Boolean);
      const hasText = (t: string) => (textFilter || '').trim().length > 0 ? t.toLowerCase().includes(textFilter.trim().toLowerCase()) : true;
      const match = (line: string) => (preds.length === 0 || preds.some((re: RegExp) => re.test(line))) && hasText(line);
      return rows.filter(match).reverse().join('\n');
    } catch {
      return content;
    }
  }, [content, section, filters, textFilter]);

  const displayLines = useMemo(() => {
    try {
      return (filteredContent || '').split(/\r?\n/);
    } catch { return []; }
  }, [filteredContent]);

  return (
    <div className="h-full w-full flex">
      <aside className="w-64 border-r bg-white p-4 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Logs</div>
          <div className="space-y-3">
            <label className="flex items-center gap-2 select-none">
              <input type="checkbox" checked={!!status.stdout} onChange={(e) => setStdout(e.target.checked)} />
              Afficher aussi dans la console
            </label>
            <div className="text-xs text-gray-500">Taille: {status.sizeBytes?.toLocaleString?.() || 0} octets</div>
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Admin Token</div>
          <input
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="x-admin-token (optionnel)"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <div className="text-[11px] text-gray-500 mt-1">Laissez vide en local. Nécessaire si ADMIN_TOKEN est défini côté serveur.</div>
        </div>
      </aside>

      <main className="flex-1 min-h-0 p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setSection('system')} className={`px-2 py-1 rounded text-sm border ${section==='system'?'bg-gray-900 text-white border-gray-900':'bg-white text-gray-700 hover:bg-gray-50'}`}>System</button>
          <button onClick={() => setSection('api')} className={`px-2 py-1 rounded text-sm border ${section==='api'?'bg-gray-900 text-white border-gray-900':'bg-white text-gray-700 hover:bg-gray-50'}`}>API/Auth</button>
          <button onClick={() => setSection('chat')} className={`px-2 py-1 rounded text-sm border ${section==='chat'?'bg-gray-900 text-white border-gray-900':'bg-white text-gray-700 hover:bg-gray-50'}`}>Chat/Socket</button>
          <button onClick={() => setSection('visitors')} className={`px-2 py-1 rounded text-sm border ${section==='visitors'?'bg-gray-900 text-white border-gray-900':'bg-white text-gray-700 hover:bg-gray-50'}`}>Visitors/Geo</button>
          <button onClick={() => setSection('db')} className={`px-2 py-1 rounded text-sm border ${section==='db'?'bg-gray-900 text-white border-gray-900':'bg-white text-gray-700 hover:bg-gray-50'}`}>Database</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm text-gray-600">Dernières</label>
          <select value={lines} onChange={(e) => setLines(Number(e.target.value))} className="border rounded px-2 py-1 text-sm">
            <option value={50}>50 lignes</option>
            <option value={100}>100 lignes</option>
            <option value={200}>200 lignes</option>
            <option value={500}>500 lignes</option>
            <option value={1000}>1000 lignes</option>
            <option value={2000}>2000 lignes</option>
            <option value={5000}>5000 lignes</option>
          </select>
          <button className="px-3 py-1.5 rounded border bg-white hover:bg-gray-50 text-sm" onClick={fetchLogs} disabled={loading}>
            {loading ? 'Chargement…' : 'Rafraîchir'}
          </button>
          <label className="ml-2 flex items-center gap-1 text-sm text-gray-700 select-none">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto
          </label>
          <div className="flex items-center gap-1 ml-2">
            <input
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              placeholder="Filtrer (texte contenu)"
              className="border rounded px-2 py-1 text-sm min-w-[220px]"
            />
            {textFilter ? (
              <button
                title="Effacer le filtre"
                className="px-2 py-1 rounded border bg-white hover:bg-gray-50 text-sm"
                onClick={() => setTextFilter('')}
              >
                ×
              </button>
            ) : null}
          </div>
          <button className="ml-2 px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 text-sm shrink-0" onClick={clearLogs}>
            Effacer
          </button>
        </div>
        {error && (
          <div className="px-3 py-2 rounded border border-red-200 bg-red-50 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 border rounded bg-black text-green-200 p-2 overflow-auto font-mono text-[14px] leading-6">
          {displayLines.length ? (
            <div className="space-y-0.5">
              {displayLines.map((ln, idx) => (
                <div key={idx} className="whitespace-pre-wrap">{ln}</div>
              ))}
            </div>
          ) : ' (vide) '}
        </div>
      </main>
    </div>
  );
}
