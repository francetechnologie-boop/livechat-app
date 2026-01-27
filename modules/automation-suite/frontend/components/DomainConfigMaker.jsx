/* AI-GUIDE (Livechat App)
Context: React 18. Task: Change Domain input to choose-only (no typing).

MUST:
- Keep unrelated code intact; minimal diff
- Update label to reflect choose-only behavior

MUST NOT:
- Introduce new libraries or change API contracts
*/
import React, { useEffect, useState } from "react";

export default function DomainConfigMaker({ activeDomain, onChangeDomain } = {}) {
  const [domains, setDomains] = useState([]);
  const [domain, setDomain] = useState("");
  const [editor, setEditor] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [hist, setHist] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [testUrl, setTestUrl] = useState("");
  const [testUrlHist, setTestUrlHist] = useState([]);
  const [testBusy, setTestBusy] = useState(false);
  const [testOut, setTestOut] = useState(null);
  const [currVersion, setCurrVersion] = useState(null);
  const [note, setNote] = useState("");

  // Helpers: image src sanitization and collapsible text rendering
  const sanitizeImageSrc = (src) => {
    try {
      if (!src) return '';
      const s = String(src).trim();
      if (!s) return '';
      // ignore bare svg marker without payload
      if (/^data:image\/svg\+xml;?utf8?$/i.test(s)) return '';
      // decode percent-encoded inline svg accidentally in URL path
      if (/^https?:\/\/.+%3Csvg/i.test(s)) {
        try { return decodeURIComponent(s.match(/%3Csvg[\s\S]*/i)?.[0] || ''); } catch {}
      }
      return s;
    } catch { return ''; }
  };
  const CollapsibleText = ({ value }) => {
    const [open, setOpen] = useState(false);
    try {
      const text = String(value ?? '');
      const tooLong = text.length > 200;
      const shown = open || !tooLong ? text : text.slice(0, 200) + '…';
      return (
        <div>
          <div className="whitespace-pre-wrap break-words max-h-40 overflow-auto">{shown}</div>
          {tooLong && (
            <button className="mt-1 text-blue-600 underline" onClick={()=> setOpen(v=>!v)}>{open? 'Show less':'Show more'}</button>
          )}
        </div>
      );
    } catch { return <span className="text-gray-500">-</span>; }
  };

  const MaybeImagePreview = ({ url }) => {
    try {
      const s = String(url || '');
      const isImg = /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(s);
      const src = isImg ? sanitizeImageSrc(s) : '';
      if (!src) return <span className="break-all text-gray-700 text-[11px]">{s}</span>;
      return (
        <div className="flex items-center gap-2">
          <a href={src} target="_blank" rel="noreferrer" title={src}>
            <img
              src={src}
              alt=""
              className="w-16 h-16 object-cover rounded border"
              onError={(e)=>{ try{ e.currentTarget.outerHTML = `<a href=\"${src}\" target=\"_blank\" rel=\"noreferrer\" class=\"inline-block\"><span class=\"px-2 py-1 border rounded text-[10px] bg-gray-50 inline-block max-w-[12rem] truncate\">open</span></a>`; }catch{} }}
            />
          </a>
          <a className="text-blue-600 underline break-all" href={src} target="_blank" rel="noreferrer">{s}</a>
        </div>
      );
    } catch { return <span className="break-all text-gray-700 text-[11px]">{String(url||'')}</span>; }
  };

  const loadDomains = async () => {
    try {
      const r = await fetch('/api/grabbings/jerome/domains', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setDomains(Array.isArray(j.items)? j.items: []);
    } catch {}
  };
  useEffect(()=>{ loadDomains(); }, []);
  // Sync controlled domain from props if provided
  useEffect(() => {
    if (typeof activeDomain === 'string') {
      setDomain(activeDomain || '');
    }
  }, [activeDomain]);

  // Persist last 20 tested URLs per selected domain
  const TEST_HIST_KEY = 'dcm_test_urls_v1';
  const readHistStore = () => {
    try {
      const raw = localStorage.getItem(TEST_HIST_KEY) || '{}';
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  };
  const writeHistStore = (obj) => {
    try { localStorage.setItem(TEST_HIST_KEY, JSON.stringify(obj || {})); } catch {}
  };
  const loadTestUrlHistory = (d) => {
    if (!d) { setTestUrlHist([]); return; }
    try {
      const store = readHistStore();
      const arr = Array.isArray(store[d]) ? store[d] : [];
      setTestUrlHist(arr.slice(0, 20));
    } catch {
      setTestUrlHist([]);
    }
  };
  // Try server first; fallback to local mirror
  const rememberTestUrl = async (d, url) => {
    if (!d || !url) return;
    try {
      try {
        await fetch('/api/grabbings/jerome/domains/test-history', { method:'POST', headers:{ 'Content-Type':'application/json', ...adminHeaders() }, credentials:'include', body: JSON.stringify({ domain:d, url }) });
      } catch {}
      const store = readHistStore();
      const cur = Array.isArray(store[d]) ? store[d] : [];
      const next = [url, ...cur.filter(u => u !== url)].slice(0, 20);
      store[d] = next;
      writeHistStore(store);
      if (d === domain) setTestUrlHist(next);
    } catch {}
  };
  const loadServerHistory = async (d) => {
    if (!d) { setTestUrlHist([]); return; }
    try {
      const r = await fetch(`/api/grabbings/jerome/domains/test-history?domain=${encodeURIComponent(d)}`, { credentials:'include', headers: adminHeaders() });
      const j = await r.json();
      if (r.ok && j?.ok) {
        const urls = (Array.isArray(j.items)? j.items: []).map(x=>x.url).filter(Boolean).slice(0,20);
        setTestUrlHist(urls);
        const store = readHistStore();
        store[d] = urls; writeHistStore(store);
        return;
      }
    } catch {}
    loadTestUrlHistory(d);
  };
  useEffect(() => { loadServerHistory(domain); }, [domain]);

  const clearTestUrlHistory = async () => {
    if (!domain) return;
    try {
      try { await fetch('/api/grabbings/jerome/domains/test-history', { method:'DELETE', headers:{ 'Content-Type':'application/json', ...adminHeaders() }, credentials:'include', body: JSON.stringify({ domain }) }); } catch {}
      const store = readHistStore();
      delete store[domain];
      writeHistStore(store);
      setTestUrlHist([]);
    } catch {}
  };

  const adminHeaders = () => {
    const h = {};
    try {
      const t = localStorage.getItem('ADMIN_TOKEN') || localStorage.getItem('admin_token') || '';
      if (t) h['X-Admin-Token'] = t;
    } catch {}
    return h;
  };

  const loadCurrent = async (d) => {
    if (!d) return;
    setMsg(''); setBusy(true);
    try {
      const r = await fetch(`/api/grabbings/jerome/domains/config?domain=${encodeURIComponent(d)}`, { credentials:'include', headers: adminHeaders() });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'load_failed');
      else {
        setEditor(String(j.config_text || JSON.stringify(j.config||{}, null, 2)));
        try { setCurrVersion((j && (j.version !== undefined)) ? (Number(j.version)||null) : null); } catch { setCurrVersion(null); }
      }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  // Persist current editor text per domain so other views (Domain URLs) can preview with the same JSON
  useEffect(() => {
    try {
      if (!domain) return;
      const KEY = 'jerome_dcm_editor_by_domain';
      const raw = localStorage.getItem(KEY) || '{}';
      const map = JSON.parse(raw || '{}');
      map[domain] = editor || '';
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch {}
  }, [domain, editor]);

  const dcmAutoFixJson = (text = '') => {
    try {
      let t = String(text || '');
      if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
      t = t
        .replace(/[\u2018\u2019\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201F]/g, '"');
      t = t.replace(/^\s*\/\/.*$/gm, '');
      t = t.replace(/\/\*[\s\S]*?\*\//g, '');
      t = t.replace(/,\s*([}\]])/g, '$1');
      return t;
    } catch { return text; }
  };

  const parseJsonWithDetails = (text) => {
    try { return { obj: JSON.parse(text || '{}'), fixed: false, text }; }
    catch (e1) {
      const fixedText = dcmAutoFixJson(text);
      if (fixedText !== text) {
        try { return { obj: JSON.parse(fixedText || '{}'), fixed: true, text: fixedText }; }
        catch (e2) {}
      }
      try {
        const m = String(e1?.message || '').match(/position\s+(\d+)/i);
        const pos = m ? Number(m[1]) : -1;
        if (pos >= 0) {
          let line = 1, col = 1;
          for (let i = 0; i < (text||'').length && i < pos; i++) {
            if (text[i] === '\n') { line++; col = 1; } else { col++; }
          }
          throw new Error(`Invalid JSON at ${line}:${col} (pos ${pos})`);
        }
      } catch {}
      throw new Error('Invalid JSON');
    }
  };

  const saveCurrent = async () => {
    if (!domain) { setMsg('Select a domain'); return; }
    setMsg(''); setBusy(true);
    try {
      let cfg = {};
      try {
        const r = parseJsonWithDetails(editor);
        cfg = r.obj;
        if (r.fixed && typeof r.text === 'string' && r.text !== editor) {
          setEditor(r.text);
          setMsg('Auto-fixed JSON (quotes/comments/trailing commas removed).');
        }
      }
      catch (e) { setMsg(String(e?.message||e)); setBusy(false); return; }
      const body = { domain, config_text: editor };
      try { if (note && note.trim()) body.note = note.trim(); } catch {}
      try { body.config = cfg; } catch {}
      const r = await fetch('/api/grabbings/jerome/domains/config', { method:'POST', headers:{ 'Content-Type':'application/json', ...adminHeaders() }, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'save_failed');
      else {
        const flags = [];
        if (j?.db_ok === false) flags.push('db');
        if (j?.hist_ok === false) flags.push('history');
        setMsg(flags.length? `Saved (warning: ${flags.join('+')} not persisted)`: 'Saved.');
        try { if (j && (j.version !== undefined)) setCurrVersion(Number(j.version)||null); } catch {}
        // Reload history and current from server so editor reflects the active version
        await loadHistory(domain);
        await loadCurrent(domain);
        await loadDomains();
      }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const loadHistory = async (d) => {
    if (!d) return; setMsg('');
    try {
      const r = await fetch(`/api/grabbings/jerome/domains/config/history?domain=${encodeURIComponent(d)}`, { credentials:'include', headers: adminHeaders() });
      const j = await r.json();
      if (r.ok && j?.ok) setHist(Array.isArray(j.items)? j.items: []);
    } catch {}
  };

  // Bulk delete history helpers
  const [delIds, setDelIds] = useState("");
  const [beforeVersion, setBeforeVersion] = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [keepLast, setKeepLast] = useState("");
  const bulkDelete = async (payload) => {
    if (!domain) return; setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/grabbings/jerome/domains/config/history/delete', { method:'POST', headers:{ 'Content-Type':'application/json', ...adminHeaders() }, credentials:'include', body: JSON.stringify({ domain, ...payload }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||'bulk_delete_failed');
      else { setMsg(`Deleted ${j.deleted||0} entr${(j.deleted||0)===1?'y':'ies'}`); await loadHistory(domain); }
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };
  const runBulkDelete = () => {
    const payload = {};
    if (delIds.trim()) {
      const ids = delIds.split(',').map(s=>Number(s.trim())).filter(n=>Number.isFinite(n)&&n>0);
      if (!ids.length) { setMsg('IDs list is invalid'); return; }
      payload.ids = ids;
    } else if (beforeVersion.trim()) {
      const v = Number(beforeVersion.trim()); if (!Number.isFinite(v)||v<=0) { setMsg('before_version invalid'); return; } payload.before_version = v;
    } else if (beforeDate.trim()) {
      payload.before_date = beforeDate.trim();
    } else if (keepLast.trim()) {
      const k = Number(keepLast.trim()); if (!Number.isFinite(k)||k<=0) { setMsg('keep_last invalid'); return; } payload.keep_last = k;
    } else { setMsg('Provide ids, before_version, before_date, or keep_last'); return; }
    bulkDelete(payload);
  };

  const deleteHistory = async (id) => {
    if (!id) return; if (!window.confirm('Delete this history entry?')) return;
    setMsg(''); setBusy(true);
    try {
      const r = await fetch(`/api/grabbings/jerome/domains/config/history/${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include', headers: adminHeaders() });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||('HTTP_'+r.status));
      else setHist(prev => (prev||[]).filter(x => x.id !== id));
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setBusy(false); }
  };

  const testConfig = async (useEditor = true) => {
    if (!testUrl || !/^https?:\/\//i.test(testUrl)) { setMsg('Enter a valid test URL'); return; }
    setMsg(''); setTestBusy(true); setTestOut(null);
    try {
      // remember tested URL for selected domain
      if (domain) rememberTestUrl(domain, testUrl);
      let body = { url: testUrl, debug: true, preview: true };
      if (useEditor) {
        try {
          const r = parseJsonWithDetails(editor);
          if (r.fixed && typeof r.text === 'string' && r.text !== editor) {
            setEditor(r.text);
            setMsg('Auto-fixed JSON (quotes/comments/trailing commas removed).');
          }
          body.config_override = r.obj;
        } catch (e) { setMsg(String(e?.message||e)); setTestBusy(false); return; }
      }
      const r = await fetch('/api/grabbings/jerome/page/explore', { method:'POST', headers:{ 'Content-Type':'application/json', ...adminHeaders() }, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) setMsg(j?.message||j?.error||('HTTP_'+r.status));
      else setTestOut(j);
    } catch (e) { setMsg(String(e?.message||e)); }
    finally { setTestBusy(false); }
  };

  const docName = (d) => {
    try { const u = new URL(String(d?.url || d?.href || '')); const p=u.pathname||''; const base=p.split('/').filter(Boolean).pop()||''; return base || (d?.text || d?.label || ''); }
    catch { try { const s=String(d?.url||d?.href||''); return s.split('/').pop() || (d?.text || d?.label || ''); } catch { return d?.text || d?.label || ''; } }
  };

  return (
    <div id="jerome-domain-config-maker" className="mt-4 space-y-2 border rounded p-3 bg-white">
      <div className="flex items-center justify-between">
        <div className="font-medium">Domain Config Maker {domain ? (<span className="ml-2 text-[11px] text-gray-600">Current: v{currVersion ?? '-'}</span>) : null}</div>
        <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=> setCollapsed(v=>!v)}>
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      <div className={collapsed ? 'hidden' : ''}>
        {!!msg && (
          <div
            role="alert"
            aria-live="polite"
            className={`text-[11px] ${/invalid|failed|unauthorized|forbidden|bad_|http_/i.test(String(msg)) ? 'text-red-600' : 'text-green-700'}`}
          >
            {msg}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end text-[11px]">
          <div className="md:col-span-2">
            <div className="text-gray-600">Domain (choose)</div>
            <select
              className="w-full border rounded px-2 py-1"
              value={typeof activeDomain === 'string' ? (activeDomain || '') : domain}
              onChange={async (e)=>{ const dom=e.target.value.trim(); (onChangeDomain? onChangeDomain(dom): setDomain(dom)); setEditor(''); setHist([]); setCurrVersion(null); if (dom) { await loadCurrent(dom); await loadHistory(dom); } }}
            >
              <option value="">— Select a domain —</option>
              {(domains||[]).map(d => (
                <option key={d.domain} value={d.domain}>{d.domain}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4 flex items-center gap-2">
            <input className="px-2 py-1 border rounded flex-1" placeholder="Note (for history)" value={note} onChange={(e)=> setNote(e.target.value)} />
            <button className="px-2 py-1 border rounded" disabled={!domain || busy} onClick={()=> loadCurrent(domain)}>Load current</button>
            <button className="px-2 py-1 rounded bg-indigo-600 text-white disabled:opacity-60" disabled={!domain || busy} onClick={saveCurrent}>Save</button>
            <button className="px-2 py-1 border rounded" disabled={!domain || busy} onClick={()=> loadHistory(domain)}>Refresh history</button>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] text-gray-700 mb-1">Config (JSON)</div>
            <textarea className="w-full h-60 border rounded font-mono text-[11px] p-2" value={editor} onChange={(e)=> setEditor(e.target.value)} placeholder={"{\n  \"classify\": { ... }\n}"} />
            <div className="mt-2 text-[11px] flex items-center gap-2 flex-wrap">
              <input list="dcm-test-urls" className="border rounded px-2 py-1 flex-1 min-w-[240px]" placeholder="https://example.com/product/..." value={testUrl} onChange={(e)=> setTestUrl(e.target.value)} />
              <datalist id="dcm-test-urls">
                {(testUrlHist||[]).map((u, i) => (<option key={i} value={u} />))}
              </datalist>
              <a
                className="px-2 py-1 border rounded inline-block text-center"
                href={/^https?:\/\//i.test(testUrl) ? testUrl : undefined}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e)=>{ if (!/^https?:\/\//i.test(testUrl)) e.preventDefault(); }}
                title="Open URL in a new window"
              >Open</a>
              <button className="px-2 py-1 border rounded" title="Clear recent URLs for this domain" onClick={clearTestUrlHistory} disabled={!domain || (testUrlHist||[]).length===0}>Clear history</button>
              <button className="px-2 py-1 border rounded" disabled={testBusy || !testUrl} onClick={()=>testConfig(false)}>{testBusy? 'Testing…':'Test current (no save)'}</button>
              <button className="px-2 py-1 border rounded" disabled={testBusy || !testUrl} onClick={()=>testConfig(true)}>{testBusy? 'Testing…':'Test editor (no save)'}</button>
            </div>
            {/* Clickable recent URLs dropdown (simple popover list) */}
            {(testUrlHist||[]).length>0 && (
              <div className="mt-1 text-[11px] max-h-28 overflow-auto border rounded bg-white divide-y">
                {(testUrlHist||[]).map((u,i)=>(
                  <button key={i} type="button" className="w-full text-left px-2 py-1 hover:bg-gray-50 truncate" title={u} onClick={()=> setTestUrl(u)}>
                    {u}
                  </button>
                ))}
              </div>
            )}
            {/* Test Result moved below the 2-column grid to use full width */}
          </div>
          <div>
            <div className="text-[11px] text-gray-700 mb-1">History</div>
            <div className="max-h-60 overflow-auto border rounded bg-gray-50">
              {Array.isArray(hist) && hist.length > 0 ? (
                hist.map(h => (
                  <div key={h.id} className="px-2 py-1 border-b last:border-0 flex items-center gap-2">
                    <div className="flex-1 text-gray-700 whitespace-nowrap">
                      <span className="inline-block bg-white border rounded px-1.5 py-0.5 text-[11px] mr-2">v{h?.version ?? '-'}</span>
                      {h.saved_at? new Date(h.saved_at).toLocaleString(): ''}
                      {h.note ? (<span className="ml-2 text-gray-500">— {h.note}</span>) : null}
                    </div>
                    <button className="px-2 py-0.5 border rounded" title={`Load v${h?.version ?? ''} into editor`} onClick={()=> setEditor(JSON.stringify(h.config||{}, null, 2))}>Load</button>
                    <button className="px-2 py-0.5 border rounded" title="Delete this entry" onClick={()=> deleteHistory(h.id)}>Delete</button>
                  </div>
                ))
              ) : (
                <div className="px-2 py-1 text-gray-500">No history.</div>
              )}
            </div>
            {/* Bulk delete */}
            <div className="mt-2 p-2 border rounded bg-white">
              <div className="text-[11px] text-gray-700 mb-1">Bulk delete</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <input className="border rounded px-2 py-1" placeholder="IDs: 101,102" value={delIds} onChange={(e)=>setDelIds(e.target.value)} />
                <input className="border rounded px-2 py-1" placeholder="before_version (e.g., 40)" value={beforeVersion} onChange={(e)=>setBeforeVersion(e.target.value)} />
                <input className="border rounded px-2 py-1" placeholder="before_date (ISO)" value={beforeDate} onChange={(e)=>setBeforeDate(e.target.value)} />
                <input className="border rounded px-2 py-1" placeholder="keep_last (N)" value={keepLast} onChange={(e)=>setKeepLast(e.target.value)} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button className="px-2 py-1 border rounded" onClick={runBulkDelete} disabled={!domain || busy}>Delete</button>
                <span className="text-[11px] text-gray-500">Provide one filter: IDs OR before_version OR before_date OR keep_last</span>
              </div>
            </div>
          </div>
        </div>

        {!!testOut && (
          <div className="mt-3 text-[11px]">
            <div className="flex items-center justify-between">
              <div className="font-medium">Test Result</div>
              <div className="flex items-center gap-2">
                <button
                  className="px-2 py-0.5 border rounded"
                  onClick={() => {
                    try {
                      const txt = JSON.stringify(testOut, null, 2);
                      navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(txt) : document.execCommand && document.execCommand('copy');
                      setMsg('Copied test JSON to clipboard');
                    } catch (e) {
                      setMsg(String(e?.message||e));
                    }
                  }}
                >Copy JSON</button>
                <button
                  className="px-2 py-0.5 border rounded"
                  title="Clear the current test result (no save)"
                  onClick={() => { setTestOut(null); }}
                >Clear</button>
              </div>
            </div>
            <div className="mb-1 text-gray-700">Type: {testOut.page_type||'-'} {testOut.meta && testOut.meta.title ? ('· '+testOut.meta.title) : ''}</div>
            <div className="mb-1 text-gray-700">Price: {(testOut.product && testOut.product.price) || '-'} {(testOut.product && testOut.product.currency) || ''} · SKU: {(testOut.product && testOut.product.sku) || '-'}</div>
            <div className="mb-1 text-gray-700">Variants: {Array.isArray(testOut.product && testOut.product.variants) ? testOut.product.variants.length : 0} · Docs: {Array.isArray(testOut.meta && testOut.meta.documents) ? testOut.meta.documents.length : 0}</div>
            {testOut?.meta?.config_used && (
              <div className="mb-1 text-gray-700">
                <span className="font-medium">Config used</span>:
                <span className="ml-2">v{testOut.meta.config_used.version ?? '-'}</span>
                <span className="ml-2">override: {testOut.meta.config_used.override_used? 'yes':'no'}</span>
                <span className="ml-2">force: {testOut.meta.config_used.force || '-'}</span>
                <span className="ml-2">path_rules: {testOut.meta.config_used.path_rules ?? 0}</span>
                <span className="ml-2">roots: {testOut.meta.config_used.content_roots ?? 0}</span>
                <span className="ml-2">exclude: {testOut.meta.config_used.content_exclude ?? 0}</span>
                <span className="ml-2">img_excl: {testOut.meta.config_used.images_exclude ?? 0}</span>
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-2">
              <div>
                <div className="font-medium mb-1">Pictures</div>
                {(() => {
                  try {
                    const raws = Array.isArray(testOut?.product?.images) ? testOut.product.images.slice(0, 24) : [];
                    const details = raws.map((raw) => {
                      const s = String(raw||'');
                      if (!s.trim()) return { raw: s, ok:false, reason:'empty' };
                      if (/^data:image\/svg\+xml;?utf8?$/i.test(s)) return { raw:s, ok:false, reason:'bare_svg_marker' };
                      if (/^https?:\/\/.+%3Csvg/i.test(s)) return { raw:s, ok:false, reason:'encoded_inline_svg' };
                      return { raw:s, ok:true };
                    });
                    const filtered = details.filter(d=>!d.ok);
                    const title = filtered.length ? ('Filtered images:\n' + filtered.map(d=>`- ${d.reason}: ${d.raw}`).join('\n')) : 'No filtering';
                    return (
                      <div className="mb-1 text-[10px] text-gray-600">
                        <span className="inline-flex items-center gap-1" title={title}>
                          <span className="inline-block bg-gray-100 border rounded px-1">valid: {details.filter(d=>d.ok).length}</span>
                          <span className="inline-block bg-gray-100 border rounded px-1">filtered: {filtered.length}</span>
                        </span>
                      </div>
                    );
                  } catch { return null; }
                })()}
                <div className="flex flex-wrap gap-2">
                  {Array.isArray(testOut?.product?.images) && testOut.product.images.slice(0, 24).map((raw, i) => {
                    const src = sanitizeImageSrc(raw);
                    if (!src) return (
                      <a key={i} href={String(raw||'')} target="_blank" rel="noreferrer" title={String(raw||'')}>
                        <span className="px-2 py-1 border rounded text-[10px] bg-gray-50 inline-block max-w-[10rem] truncate">open</span>
                      </a>
                    );
                    return (
                      <a key={i} href={src} target="_blank" rel="noreferrer">
                        <img src={src} alt="" className="w-16 h-16 object-cover rounded border" onError={(e)=>{ try{ e.currentTarget.outerHTML = `<a href="${src}" target="_blank" rel="noreferrer" class=\"inline-block\"><span class=\"px-2 py-1 border rounded text-[10px] bg-gray-50 inline-block max-w-[10rem] truncate\">open</span></a>`; }catch{} }} />
                      </a>
                    );
                  })}
                  {(!Array.isArray(testOut?.product?.images) || testOut.product.images.length === 0) && testOut?.meta?.og_image && (
                    <a href={testOut.meta.og_image} target="_blank" rel="noreferrer"><img src={testOut.meta.og_image} alt="" className="w-16 h-16 object-cover rounded border" /></a>
                  )}
                  {Array.isArray(testOut?.product?.images_local) && testOut.product.images_local.slice(0, 12).map((it, i) => {
                    const src = sanitizeImageSrc(it.download_url || it.url);
                    return (
                      <a key={i} href={src || (it.download_url||it.url)} target="_blank" rel="noreferrer" title={it.file || ''}>
                        {src ? (
                          <img src={src} alt="" className="w-16 h-16 object-cover rounded border" onError={(e)=>{ try{ e.currentTarget.outerHTML = `<a href=\"${src}\" target=\"_blank\" rel=\"noreferrer\" class=\"inline-block\"><span class=\"px-2 py-1 border rounded text-[10px] bg-gray-50 inline-block max-w-[10rem] truncate\">open</span></a>`; }catch{} }} />
                        ) : (
                          <span className="px-2 py-1 border rounded text-[10px] bg-gray-50 inline-block max-w-[10rem] truncate">open</span>
                        )}
                      </a>
                    );
                  })}
                </div>
                {Array.isArray(testOut?.meta?.documents) && testOut.meta.documents.length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium mb-1">Documents ({testOut.meta.documents.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {testOut.meta.documents.slice(0, 24).map((d, i) => {
                        const url = d?.url || d?.href || '';
                        const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url);
                        const name = (d?.text || d?.label || '') || (url.split('/').pop() || 'document');
                        return (
                          <a key={i} href={url} target="_blank" rel="noreferrer" title={name} className="inline-block">
                            {isImg ? (
                              <img src={url} alt="" className="w-16 h-16 object-cover rounded border" />
                            ) : (
                              <span className="px-2 py-1 border rounded text-[10px] bg-gray-50 inline-block max-w-[12rem] truncate">{name}</span>
                            )}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
                {Array.isArray(testOut?.product?.variants) && testOut.product.variants.length > 0 && (
                  <div className="mt-2">
                    <div className="font-medium mb-1">Variants ({testOut.product.variants.length})</div>
                    <div className="max-h-40 overflow-auto border rounded bg-white">
                      {testOut.product.variants.slice(0, 50).map((v, i) => (
                        <div key={i} className="px-2 py-1 border-b last:border-0 flex items-center gap-2">
                          {v.image && <img src={v.image} alt="" className="w-8 h-8 object-cover rounded border" />}
                          <div className="flex-1 truncate" title={v.title||''}>{v.title || '-'}</div>
                          <div className="text-gray-600 whitespace-nowrap">{v.sku || ''} {v.price? (' · '+v.price): ''}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {(() => {
                    try {
                      const entries = Object.entries(testOut?.meta || {}).filter(([k,v]) => ['string','number','boolean'].includes(typeof v));
                      if (!entries.length) return null;
                      return (
                        <div className="border rounded bg-white p-2">
                          <div className="font-medium mb-1">Meta</div>
                              <div className="space-y-1 text-[11px]">
                                {entries.slice(0, 100).map(([k,v]) => (
                                  <div key={k} className="flex gap-2 items-start">
                                    <div className="text-gray-600 min-w-[120px] truncate" title={k}>{k}</div>
                                    <div className="flex-1 min-w-0">
                                      {typeof v === 'string' && /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(v)
                                        ? <MaybeImagePreview url={v} />
                                        : <CollapsibleText value={v} />}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                    } catch { return null; }
                  })()}
                  {(() => {
                    try {
                      const entries = Object.entries(testOut?.product || {}).filter(([k,v]) => ['string','number','boolean'].includes(typeof v));
                      if (!entries.length) return null;
                      return (
                        <div className="border rounded bg-white p-2">
                          <div className="font-medium mb-1">Product</div>
                              <div className="space-y-1 text-[11px]">
                                {entries.slice(0, 100).map(([k,v]) => (
                                  <div key={k} className="flex gap-2 items-start">
                                    <div className="text-gray-600 min-w-[120px] truncate" title={k}>{k}</div>
                                    <div className="flex-1 min-w-0">
                                      {typeof v === 'string' && /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(v)
                                        ? <MaybeImagePreview url={v} />
                                        : <CollapsibleText value={v} />}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                    } catch { return null; }
                  })()}
                </div>
              </div>
              <div>
                <div className="font-medium mb-1">Full JSON</div>
                <div className="max-h-[28rem] overflow-auto border rounded bg-white p-2">
                  <pre className="text-[10px] whitespace-pre-wrap break-words">{JSON.stringify(testOut, null, 2)}</pre>
                </div>
                {(testOut?.meta?.sections?.product_information) && (
                  <div className="mb-2"><div className="font-medium mb-1">Product Information</div><div className="max-h-32 overflow-auto border rounded bg-white p-2 whitespace-pre-wrap break-words">{testOut.meta.sections.product_information}</div></div>
                )}
                {(testOut?.meta?.sections?.parameters_applications) && (
                  <div className="mb-2"><div className="font-medium mb-1">Parameters & Applications</div><div className="max-h-32 overflow-auto border rounded bg-white p-2 whitespace-pre-wrap break-words">{testOut.meta.sections.parameters_applications}</div></div>
                )}
                {(testOut?.meta?.sections?.technical_specifications) && (
                  <div className="mb-2"><div className="font-medium mb-1">Technical Specifications</div><div className="max-h-32 overflow-auto border rounded bg-white p-2 whitespace-pre-wrap break-words">{testOut.meta.sections.technical_specifications}</div></div>
                )}
                {Array.isArray(testOut?.meta?.documents) && testOut.meta.documents.length > 0 && (
                  <div className="mb-2">
                    <div className="font-medium mb-1">Documents</div>
                    <div className="space-y-1">
                      {testOut.meta.documents.slice(0, 20).map((d, i) => (
                        <div key={i} className="truncate">
                          <a className="text-blue-600 underline" href={d.url} target="_blank" rel="noreferrer">{d.text || d.label || d.url}</a>
                          <span className="text-gray-500 ml-1">({docName(d)})</span>
                          {!!d.download_url && (<a className="ml-2 text-[11px] text-gray-700 underline" href={d.download_url} target="_blank" rel="noreferrer">download</a>)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(testOut?.meta?.headings) && testOut.meta.headings.length > 0 && (
                  <div>
                    <div className="font-medium mb-1">Headings</div>
                    <div className="border rounded bg-white p-2 space-y-1 max-h-32 overflow-auto">
                      {testOut.meta.headings.map((h,i)=> (<div key={i}><span className="text-gray-600">H{h.level}:</span> {(h.items||[]).join(' · ')}</div>))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
