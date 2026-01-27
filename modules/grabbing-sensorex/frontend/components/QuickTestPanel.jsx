import React from 'react';

export default function QuickTestPanel({ ctx }) {
  const {
    activeDomain,
    exType,
    exText,
    // Optional from ctx for versions list
    exVersions,
    ensureExVersionsFor,
    refreshExVersionsFor,
  } = ctx || {};

  const [urlsText, setUrlsText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [logHtml, setLogHtml] = React.useState('');
  const [last, setLast] = React.useState(null); // { url, ok, result, usedVersion, usedConfig }
  const [history, setHistory] = React.useState(() => {
    try {
      const raw = localStorage.getItem('gs_qt_history');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, 10) : [];
    } catch { return []; }
  });

  const write = (html) => setLogHtml((prev) => prev + html);
  const clear = () => setLogHtml('');
  const escapeHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const saveHistory = (items) => {
    try { localStorage.setItem('gs_qt_history', JSON.stringify(items)); } catch {}
  };

  // Version selector for Quick Test (0 = editor/strict)
  const [qVer, setQVer] = React.useState(() => {
    try { const v = Number(localStorage.getItem('gs_qt_ver') || '0'); return Number.isFinite(v) ? v : 0; } catch { return 0; }
  });
  React.useEffect(() => { try { localStorage.setItem('gs_qt_ver', String(qVer||0)); } catch {} }, [qVer]);

  const parseUrls = (text) => {
    try {
      const raw = String(text || '');
      const parts = raw
        .split(/\r?\n|,|\s+/)
        .map((s) => s.trim())
        .filter((s) => !!s);
      // de-dup and cap to a safe number
      const out = [];
      const seen = new Set();
      for (const p of parts) {
        if (!seen.has(p)) { seen.add(p); out.push(p); }
        if (out.length >= 30) break;
      }
      return out;
    } catch { return []; }
  };

  const run = async () => {
    if (busy) return;
    clear();
    setLast(null);
    let cfg = {};
    try {
      cfg = exText ? JSON.parse(exText) : {};
    } catch (e) {
      write(`<div class=\"text-red-600 text-xs\">Invalid JSON in editor: ${String(e?.message || e)}</div>`);
      return;
    }
    if (!cfg || typeof cfg !== 'object') {
      write('<div class=\"text-red-600 text-xs\">Editor config is empty or invalid.</div>');
      return;
    }
    const list = parseUrls(urlsText);
    if (!list.length) { write('<div class=\"text-xs text-gray-600\">Enter one or more URLs first.</div>'); return; }
    // Update recent history (unique, keep up to 10, newest first)
    try {
      const curr = Array.isArray(history) ? history.slice() : [];
      for (let i = list.length - 1; i >= 0; i--) {
        const u = list[i];
        const ix = curr.indexOf(u);
        if (ix >= 0) curr.splice(ix, 1);
        curr.unshift(u);
      }
      const next = curr.slice(0, 10);
      setHistory(next);
      saveHistory(next);
    } catch {}
    setBusy(true);
    try {
      const conc = 3;
      const out = [];
      let i = 0, active = 0;
      await new Promise((resolve) => {
        const pump = () => {
          while (active < conc && i < list.length) {
            const index = i; const url = list[i++];
            active++;
            (async () => {
              try {
                write(`<div class=\"text-xs text-gray-500\">${url} → extract…</div>`);
                // If a version is selected (>0), use non-strict run with that version. Otherwise use strict with editor config.
                const body = (Number(qVer||0) > 0)
                  ? { url, domain: activeDomain, page_type: exType || 'product', version: Number(qVer||0), strict: false, save: false }
                  : { url, domain: activeDomain, page_type: exType || 'product', config: cfg, strict: true, save: false };
        const qs = new URLSearchParams({ url: body.url, domain: body.domain, page_type: String(body.page_type||'') });
        const r = await fetch(`/api/grabbing-sensorex/extraction/test?${qs.toString()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
                const j = await r.json().catch(()=>({}));
                if (!r.ok || j?.ok === false) {
                  write(`<div class=\"text-red-600 text-xs\">${url}: ${String(j?.message || j?.error || ('HTTP '+r.status))}</div>`);
                  try { out.push({ index, url, ok: false, result: j || null, usedVersion: (j && (j.used_version!=null? j.used_version : null)), usedConfig: null }); } catch {}
                } else {
                  const title = (j && j.result && (j.result.title || (j.result.product && j.result.product.name))) || '';
                  const extra = title ? ` – ${String(title).slice(0, 120)}` : '';
                  const src = j && j.config_source ? ` [source=${String(j.config_source)}]` : '';
                  write(`<div class=\"text-green-700 text-xs\">${url}: OK${extra}${src}</div>`);
                  try { out.push({ index, url, ok: true, result: (j && (j.result!=null ? j.result : j)) || null, usedVersion: (j && (j.used_version!=null? j.used_version : null)), usedConfig: (j && j.used_config != null ? j.used_config : (body && body.strict ? (body.config || null) : null)) }); } catch {}
                }
              } catch (e) {
                write(`<div class=\"text-red-600 text-xs\">${url}: ${String(e?.message || e)}</div>`);
                try { out.push({ index, url, ok: false, result: { error: String(e?.message || e) }, usedVersion: null }); } catch {}
              } finally {
                active--; if (i < list.length) pump(); else if (active === 0) resolve();
              }
            })();
          }
        };
        pump();
      });
      try {
        // Keep only the JSON for the last URL in the input order
        const targetIndex = list.length - 1;
        const pick = out.find(o => o && o.index === targetIndex) || (out.length ? out[out.length - 1] : null);
        setLast(pick || null);
      } catch {}
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel order-0">
      <div className="panel__header flex items-center justify-between">
        <span>Quick Test (Editor Config)</span>
        <div className="text-xs text-gray-500">Paste one or more URLs to test with the current editor config</div>
      </div>
      <div className="panel__body space-y-3">
        <div className="flex items-start gap-3">
          <textarea
            className="border rounded px-2 py-1 text-sm w-full h-24"
            placeholder={`https://${activeDomain || 'domain'}/path\nhttps://${activeDomain || 'domain'}/another`}
            value={urlsText}
            onChange={(e)=>setUrlsText(e.target.value)}
          />
          <button
            className="px-3 py-2 rounded border bg-white hover:bg-gray-50 text-sm disabled:opacity-60"
            disabled={busy}
            onClick={run}
          >{busy ? 'Testing…' : 'Run'}</button>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-gray-600">Version</span>
            <select className="border rounded px-2 py-1 text-xs" value={Number(qVer||0)} onChange={(e)=>setQVer(Number(e.target.value||0))} onFocus={async ()=>{ try { if (typeof refreshExVersionsFor==='function') await refreshExVersionsFor(exType); else if (typeof ensureExVersionsFor==='function') await ensureExVersionsFor(exType); } catch {} }}>
              <option value={0}>[editor]</option>
              {Array.isArray(exVersions) ? exVersions.map(v => (<option key={v.id} value={Number(v.version||0)}>{`v${v.version}`}{v.name?` - ${v.name}`:''}</option>)) : null}
            </select>
          </div>
        </div>
        {history && history.length ? (
          <div className="flex items-center flex-wrap gap-2 text-[11px] text-gray-600">
            <span className="mr-1">Recent:</span>
            {history.map((u, idx) => (
              <button key={idx} className="rounded border px-2 py-0.5 bg-white hover:bg-gray-50" title={u}
                onClick={() => setUrlsText(u)}>{u.length>40 ? (u.slice(0,37)+'…') : u}</button>
            ))}
            <button className="ml-2 text-[11px] underline" onClick={() => { setHistory([]); saveHistory([]); }}>Clear</button>
          </div>
        ) : null}
        <div className="text-[11px] text-gray-500">Runs with strict editor config (when Version = [editor]) or with the selected saved version; does not write to Presta.</div>
        {logHtml ? (
          <div className="rounded border bg-white p-2 text-[12px] leading-5" dangerouslySetInnerHTML={{ __html: logHtml }} />
        ) : null}
        {last ? (
          <div className="rounded border bg-white p-2">
            <div className="text-xs font-semibold mb-2">Last JSON Result</div>
            <div className="px-2 py-1 text-xs flex items-center justify-between bg-gray-50">
              <div className="truncate"><span className={last.ok ? 'text-emerald-600' : 'text-red-600'}>{last.ok ? 'OK' : 'ERR'}</span> — <span className="font-mono" title={last.url}>{last.url}</span> { (last && last.usedVersion != null) ? (<span className="ml-2 text-gray-600">ver: {Number(last.usedVersion||0) > 0 ? `v${last.usedVersion}` : '[editor]'}</span>) : null }</div>
              <button className="ml-2 text-[11px] underline" onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(last.result ?? {}, null, 2)); } catch {} }}>Copy JSON</button>
            </div>
            <pre className="m-0 p-2 text-[12px] overflow-auto max-h-60 whitespace-pre-wrap">{JSON.stringify(last.result ?? {}, null, 2)}</pre>
            {(() => {
              try {
                const spec = last && last.result && last.result.sections ? last.result.sections.technical_specifications_detail : null;
                if (Array.isArray(spec) && spec.length) {
                  return (
                    <div className="mt-2 rounded border bg-white">
                      <div className="px-2 py-1 text-xs bg-gray-50 font-semibold flex items-center justify-between">
                        <span>Technical Specifications</span>
                        <button className="ml-2 text-[11px] underline" onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(spec, null, 2)); } catch {} }}>Copy JSON</button>
                      </div>
                      <div className="max-h-56 overflow-auto">
                        <table className="min-w-full text-[12px]">
                          <thead>
                            <tr className="text-left bg-gray-50">
                              <th className="px-2 py-1 w-40 text-gray-600">Criteria</th>
                              <th className="px-2 py-1 text-gray-600">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {spec.map((row, idx) => (
                              <tr key={idx} className={idx % 2 ? 'bg-white' : 'bg-gray-50/50'}>
                                <td className="px-2 py-1 align-top font-medium text-gray-700 break-words">{String(row?.criteria ?? '')}</td>
                                <td className="px-2 py-1 align-top text-gray-800 break-words">{String(row?.value ?? '')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                }
              } catch {}
              return null;
            })()}

            {(() => {
              try {
                const addl = last && last.result && last.result.sections ? last.result.sections.Additional_information_data : null;
                if (Array.isArray(addl) && addl.length) {
                  return (
                    <div className="mt-2 rounded border bg-white">
                      <div className="px-2 py-1 text-xs bg-gray-50 font-semibold flex items-center justify-between">
                        <span>Additional Information</span>
                        <button className="ml-2 text-[11px] underline" onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(addl, null, 2)); } catch {} }}>Copy JSON</button>
                      </div>
                      <div className="max-h-56 overflow-auto">
                        <table className="min-w-full text-[12px]">
                          <thead>
                            <tr className="text-left bg-gray-50">
                              <th className="px-2 py-1 w-40 text-gray-600">Criteria</th>
                              <th className="px-2 py-1 text-gray-600">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {addl.map((row, idx) => (
                              <tr key={idx} className={idx % 2 ? 'bg-white' : 'bg-gray-50/50'}>
                                <td className="px-2 py-1 align-top font-medium text-gray-700 break-words">{String(row?.criteria ?? row?.name ?? '')}</td>
                                <td className="px-2 py-1 align-top text-gray-800 break-words">{String(row?.value ?? row?.val ?? '')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                }
              } catch {}
              return null;
            })()}
            { (last && last.usedConfig) ? (
              <div className="mt-2 rounded border bg-white">
                <div className="px-2 py-1 text-xs flex items-center justify-between bg-gray-50">
                  <div className="font-semibold">Extraction Config Used</div>
                  <button className="ml-2 text-[11px] underline" onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(last.usedConfig ?? {}, null, 2)); } catch {} }}>Copy JSON</button>
                </div>
                <pre className="m-0 p-2 text-[12px] overflow-auto max-h-48 whitespace-pre-wrap">{JSON.stringify(last.usedConfig ?? {}, null, 2)}</pre>
              </div>
            ) : null }
            { (last && last.result && (Array.isArray(last.result.config_used_keys) || Array.isArray(last.result.notices))) ? (
              <div className="mt-2 rounded border bg-white">
                <div className="px-2 py-1 text-xs bg-gray-50 font-semibold">Config Usage</div>
                {Array.isArray(last.result.config_used_keys) ? (
                  <div className="px-2 py-1 text-[12px]"><span className="font-semibold">Used keys:</span> {last.result.config_used_keys.join(', ') || '—'}</div>
                ) : null}
                {Array.isArray(last.result.notices) && last.result.notices.length ? (
                  <div className="px-2 pb-2 text-[12px]">
                    <div className="font-semibold">Notices:</div>
                    <ul className="list-disc ml-5">
                      {last.result.notices.map((n,i)=>(<li key={i} className="text-[12px] text-gray-700">{n}</li>))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null }

            
          </div>
        ) : null}
        {/* Multi-result list removed by request (keep single JSON only) */}
      </div>
    </div>
  );
}
