import React, { useCallback, useEffect, useState } from 'react';
import StatusPanel from '../components/StatusPanel.jsx';
import TrackingPanel from '../components/TrackingPanel.jsx';
import FollowerPanel from '../components/FollowerPanel.jsx';
import Config from './Config.jsx';

const PANEL_IDS = {
  follower: 'follower',
  steps: 'steps',
  configs: 'configs',
};

const PANEL_LABELS = [
  { id: PANEL_IDS.follower, label: 'Packet follower' },
  { id: PANEL_IDS.steps, label: 'Steps' },
  { id: PANEL_IDS.configs, label: 'Configs' },
];

function fileInfo(result) {
  const file = result?.file || result?.file?.file;
  if (!file) return null;
  return (
    <div className="text-xs text-gray-600">
      Saved:
      <a
        className="text-indigo-600 hover:underline mx-1"
        href={file.download_url || '#'}
        target="_blank"
        rel="noreferrer"
      >
        {file.name || '(unknown file)'}
      </a>
      ({file.size || 0} bytes)
    </div>
  );
}

export default function Main() {
  const [activePanel, setActivePanel] = useState(PANEL_IDS.follower);
  const [configs, setConfigs] = useState([]);
  const [selected, setSelected] = useState('');
  const [configError, setConfigError] = useState('');
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [debug, setDebug] = useState(false);
  const [useDirectUrl, setUseDirectUrl] = useState(false);
  const [directUrl, setDirectUrl] = useState('');
  const [cookie, setCookie] = useState('');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');
  const [downloadRes, setDownloadRes] = useState(null);
  const [latestFiles, setLatestFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [orgId, setOrgId] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importRes, setImportRes] = useState(null);
  const [importFirstOnly, setImportFirstOnly] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [runMsg, setRunMsg] = useState('');
  const [runRes, setRunRes] = useState(null);

  const handleConfigList = useCallback((items = []) => {
    setConfigs(items);
    setSelected((prev) => {
      if (prev && items.some((item) => item.id === prev)) return prev;
      return items[0]?.id || '';
    });
  }, []);

  const loadConfigs = useCallback(async () => {
    setLoadingConfigs(true);
    setConfigError('');
    try {
      const resp = await fetch('/api/grabbing-zasilkovna/configs', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) throw new Error(data?.message || data?.error || `http_${resp.status}`);
      handleConfigList(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setConfigError(error?.message || 'Failed to load configs.');
    } finally {
      setLoadingConfigs(false);
    }
  }, [handleConfigList]);

  const loadLatest = useCallback(async () => {
    try {
      const resp = await fetch('/api/grabbing-zasilkovna/latest', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setLatestFiles(items);
        setSelectedFile((prev) => (prev ? prev : items[0]?.name || ''));
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadConfigs();
    loadLatest();
  }, [loadConfigs, loadLatest]);

  const handleDownload = async () => {
    if (!selected) {
      setDownloadMsg('Select a config first.');
      return;
    }
    setDownloadBusy(true);
    setDownloadMsg('');
    setDownloadRes(null);
    try {
      const url = `/api/grabbing-zasilkovna/download/using-config/${encodeURIComponent(selected)}`;
      const body = { debug };
      if (useDirectUrl && directUrl.trim()) {
        body.url = directUrl.trim();
        if (cookie.trim()) body.headers = { Cookie: cookie.trim() };
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) throw new Error(data?.message || data?.error || 'download_failed');
      setDownloadRes(data);
      await loadLatest();
    } catch (error) {
      setDownloadMsg(error?.message || 'Download failed.');
    } finally {
      setDownloadBusy(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      setImportMsg('Select a CSV file to import.');
      return;
    }
    setImportBusy(true);
    setImportMsg('');
    setImportRes(null);
    try {
      const body = { name: selectedFile };
      if (orgId.trim()) body.org_id = orgId.trim();
      if (importFirstOnly) body.limit = 1;
      const resp = await fetch('/api/grabbing-zasilkovna/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) throw new Error(data?.message || data?.error || 'import_failed');
      setImportRes(data);
      await loadLatest();
    } catch (error) {
      setImportMsg(error?.message || 'Import failed.');
    } finally {
      setImportBusy(false);
    }
  };

  const handleRunAll = async () => {
    if (!selected) {
      setRunMsg('Select a config first.');
      return;
    }
    setRunBusy(true);
    setRunMsg('');
    setRunRes(null);
    try {
      const url = `/api/grabbing-zasilkovna/download-and-import/${encodeURIComponent(selected)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ debug }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) throw new Error(data?.message || data?.error || 'run_failed');
      setRunRes(data);
      await loadLatest();
    } catch (error) {
      setRunMsg(error?.message || 'Run failed.');
    } finally {
      setRunBusy(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        {PANEL_LABELS.map((panel) => (
          <button
            key={panel.id}
            type="button"
            className={`px-4 py-1.5 rounded text-sm border transition ${
              activePanel === panel.id
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
            onClick={() => setActivePanel(panel.id)}
          >
            {panel.label}
          </button>
        ))}
      </div>

      {configError && <div className="text-sm text-red-600">{configError}</div>}
      {loadingConfigs && <div className="text-xs text-gray-500">Loading configs…</div>}

      {activePanel === PANEL_IDS.follower && (
        <FollowerPanel
          configs={configs}
          selected={selected}
          setSelected={setSelected}
          onRunAll={handleRunAll}
          runBusy={runBusy}
          runMsg={runMsg}
          runResult={runRes}
        />
      )}

      {activePanel === PANEL_IDS.steps && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <button
                type="button"
                onClick={handleRunAll}
                disabled={runBusy || !selected}
                className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60"
              >
                {runBusy ? 'Running steps 1‑4…' : 'Run steps 1‑4'}
              </button>
            </div>
            <div className="space-y-1 text-xs">
              {runMsg && <div className="text-sm text-red-600">{runMsg}</div>}
              {runRes && (
                <div className="text-gray-700">
                  All‑in‑one:
                  {` total=${runRes.import?.total || 0} inserted=${runRes.import?.inserted || 0} updated=${runRes.import?.updated || 0} failed=${runRes.import?.failed || 0}`}
                  {runRes.tracking
                    ? ` | tracking packeta=${runRes.tracking.updated_packeta || 0} external=${runRes.tracking.updated_external || 0}`
                    : ''}
                </div>
              )}
            </div>
          </div>
          <div className="panel">
            <div className="panel__header">Step 1 — Download CSV</div>
            <div className="panel__body space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-600">Config</label>
                  <select
                    className="w-full border rounded px-2 py-1 text-sm"
                    value={selected}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    <option value="">-- Select config --</option>
                    {configs.map((config) => (
                      <option key={config.id} value={config.id}>
                        {config.id} — {config.name}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={debug} onChange={(event) => setDebug(!!event.target.checked)} />
                  Debug (slower, shows steps)
                </label>
              </div>
              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={useDirectUrl} onChange={(event) => setUseDirectUrl(!!event.target.checked)} />
                  Use direct CSV URL (no Playwright)
                </label>
                {useDirectUrl && (
                  <div className="space-y-2">
                    <input
                      className="w-full border rounded px-2 py-1 text-sm"
                      placeholder="https://example.com/export.csv"
                      value={directUrl}
                      onChange={(event) => setDirectUrl(event.target.value)}
                    />
                    <input
                      className="w-full border rounded px-2 py-1 text-sm"
                      placeholder="Cookie=..."
                      value={cookie}
                      onChange={(event) => setCookie(event.target.value)}
                    />
                    <div className="text-xs text-gray-500">
                      Provide a valid CSV export URL and optional Cookie header captured from an authenticated session.
                    </div>
                  </div>
                )}
              </div>
              {downloadMsg && <div className="text-sm text-red-600">{downloadMsg}</div>}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloadBusy || !selected}
                  className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-60"
                >
                  {downloadBusy ? 'Downloading…' : 'Download CSV'}
                </button>
                <button
                  type="button"
                  onClick={loadLatest}
                  disabled={downloadBusy}
                  className="px-3 py-1.5 rounded border text-sm disabled:opacity-60"
                >
                  Refresh files
                </button>
              </div>
              {downloadRes && fileInfo(downloadRes)}
            </div>
          </div>

          <div className="panel">
            <div className="panel__header">Step 2 — Import CSV into DB</div>
            <div className="panel__body space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-600">Select file</label>
                  <select
                    className="w-full border rounded px-2 py-1 text-sm"
                    value={selectedFile}
                    onChange={(event) => setSelectedFile(event.target.value)}
                  >
                    <option value="">-- Choose file --</option>
                    {latestFiles.map((file) => (
                      <option key={file.name} value={file.name}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600">org_id (optional)</label>
                  <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    placeholder="e.g. org-123"
                    value={orgId}
                    onChange={(event) => setOrgId(event.target.value)}
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={importFirstOnly} onChange={(event) => setImportFirstOnly(!!event.target.checked)} />
                  Only first row (debug)
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importBusy || !selectedFile}
                  className="px-3 py-1.5 rounded bg-green-600 text-white text-sm disabled:opacity-60"
                >
                  {importBusy ? 'Importing…' : 'Import Selected'}
                </button>
              </div>
              {importMsg && <div className="text-sm text-red-600">{importMsg}</div>}
              {importRes && (
                <div className="text-xs text-gray-700">
                  Import: total={importRes.total || 0} inserted={importRes.inserted || 0} updated={importRes.updated || 0} failed={importRes.failed || 0}
                </div>
              )}
            </div>
          </div>

          <TrackingPanel configs={configs} selected={selected} setSelected={setSelected} />
          <StatusPanel configs={configs} selected={selected} setSelected={setSelected} />
        </div>
      )}

      {activePanel === PANEL_IDS.configs && (
        <div className="panel">
          <div className="panel__header">Configuration</div>
          <div className="panel__body">
            <Config onRefresh={handleConfigList} />
          </div>
        </div>
      )}
    </div>
  );
}
