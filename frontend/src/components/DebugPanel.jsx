import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';

// Global error store attached to window for simplicity
function getStore() {
  if (typeof window === 'undefined') return { items: [], listeners: new Set() };
  if (!window.__DEBUG_ERRORS__) window.__DEBUG_ERRORS__ = [];
  if (!window.__DEBUG_ERR_LISTENERS__) window.__DEBUG_ERR_LISTENERS__ = new Set();
  return { items: window.__DEBUG_ERRORS__, listeners: window.__DEBUG_ERR_LISTENERS__ };
}

export function pushDebugError(payload) {
  try {
    const { items, listeners } = getStore();
    const item = {
      when: Date.now(),
      source: payload?.source || 'runtime',
      message: String(payload?.error || payload?.message || 'Error'),
      stack: String(payload?.stack || ''),
      file: payload?.file || '',
      line: payload?.line || 0,
      col: payload?.col || 0,
      raw: payload || null,
    };
    items.push(item);
    for (const fn of Array.from(listeners)) { try { fn(items.slice()); } catch {} }
  } catch {}
}

export function installGlobalErrorCapture() {
  try {
    if (typeof window === 'undefined') return;
    if (window.__DEBUG_CAPTURE_INSTALLED__) return;
    window.__DEBUG_CAPTURE_INSTALLED__ = true;
    window.addEventListener('error', (e) => {
      try {
        pushDebugError({
          source: 'window:error',
          error: e?.message || (e?.error && e.error.message) || 'Error',
          stack: e?.error && e.error.stack ? String(e.error.stack) : '',
          file: e?.filename || '',
          line: e?.lineno || 0,
          col: e?.colno || 0,
        });
      } catch {}
    });
    window.addEventListener('unhandledrejection', (e) => {
      try {
        const r = e?.reason;
        pushDebugError({
          source: 'unhandledrejection',
          error: (r && (r.message || r.toString && r.toString())) || 'Promise rejection',
          stack: r && r.stack ? String(r.stack) : '',
        });
      } catch {}
    });
  } catch {}
}

export function useErrorStore() {
  const [items, setItems] = useState(() => {
    try { return getStore().items.slice(); } catch { return []; }
  });
  useEffect(() => {
    const { listeners } = getStore();
    const fn = (arr) => setItems(arr);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return items;
}

function PanelUI({ onClose }) {
  const items = useErrorStore();
  const [build, setBuild] = useState(null);
  const [buildLog, setBuildLog] = useState('');
  const any = items && items.length > 0;
  const loadBuild = async () => {
    try {
      const b = await fetch('/__build.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
      setBuild(b);
    } catch {}
    try {
      const t = await fetch('/__build.log', { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '');
      setBuildLog(t);
    } catch {}
  };
  const copy = async () => {
    try {
      const payload = {
        errors: items,
        build,
        buildLog: buildLog && buildLog.slice(-5000),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        href: typeof location !== 'undefined' ? location.href : '',
        when: new Date().toISOString(),
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      alert('Debug details copied');
    } catch {}
  };
  return (
    <div style={{ position:'fixed', inset:0, zIndex: 9999, background:'rgba(0,0,0,0.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:'min(920px, 96vw)', maxHeight:'85vh', overflow:'auto', background:'#fff', borderRadius:12, boxShadow:'0 10px 30px rgba(0,0,0,0.2)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #e5e7eb' }}>
          <div style={{ fontWeight:600 }}>Debug Status</div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={loadBuild} style={{ fontSize:12, padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>Build info</button>
            <button onClick={copy} style={{ fontSize:12, padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>Copy details</button>
            <button onClick={onClose} style={{ fontSize:12, padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>Close</button>
          </div>
        </div>
        <div style={{ padding:16 }}>
          {!any && <div style={{ fontSize:13, color:'#374151' }}>No runtime errors captured.</div>}
          {any && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {items.slice(-50).reverse().map((it, idx) => (
                <div key={idx} style={{ border:'1px solid #fee2e2', background:'#fff1f2', color:'#991b1b', padding:12, borderRadius:8 }}>
                  <div style={{ fontWeight:600, marginBottom:4 }}>{it.source || 'error'} — {new Date(it.when).toLocaleString()}</div>
                  <div style={{ fontSize:13, whiteSpace:'pre-wrap' }}>{it.message}</div>
                  {it.stack ? <pre style={{ marginTop:8, fontSize:12, whiteSpace:'pre-wrap', color:'#6b7280' }}>{it.stack}</pre> : null}
                  {it.file ? <div style={{ fontSize:12, color:'#6b7280', marginTop:6 }}>at {it.file}{it.line?`:${it.line}`:''}{it.col?`:${it.col}`:''}</div> : null}
                </div>
              ))}
            </div>
          )}
          {build && (
            <div style={{ marginTop:16 }}>
              <div style={{ fontWeight:600, marginBottom:6 }}>Build</div>
              <pre style={{ fontSize:12, whiteSpace:'pre-wrap', color:'#374151', background:'#f9fafb', border:'1px solid #e5e7eb', padding:12, borderRadius:8 }}>{JSON.stringify(build, null, 2)}</pre>
            </div>
          )}
          {buildLog && (
            <div style={{ marginTop:16 }}>
              <div style={{ fontWeight:600, marginBottom:6 }}>Build log (tail)</div>
              <pre style={{ fontSize:12, whiteSpace:'pre-wrap', color:'#374151', background:'#f9fafb', border:'1px solid #e5e7eb', padding:12, borderRadius:8 }}>{buildLog}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DebugPanel() {
  const items = useErrorStore();
  const [open, setOpen] = useState(() => {
    try { return new URLSearchParams(location.search).has('debug'); } catch { return false; }
  });
  const has = items && items.length > 0;
  useEffect(() => {
    // Keyboard toggle: Ctrl+Shift+D
    const onKey = (e) => { try { if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) setOpen((v)=>!v); } catch {} };
    window.addEventListener('keydown', onKey);
    const onOpen = () => setOpen(true);
    window.addEventListener('debug:open', onOpen);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (typeof document === 'undefined') return null;
  return ReactDOM.createPortal(
    <>
      {has && !open && (
        <button onClick={() => setOpen(true)} title="Open debug" style={{ position:'fixed', top:8, right:8, zIndex:9998, background:'#fee2e2', color:'#991b1b', border:'1px solid #fecaca', borderRadius:9999, padding:'6px 10px', fontSize:12, boxShadow:'0 2px 6px rgba(0,0,0,0.15)' }}>
          Errors • {items.length}
        </button>
      )}
      {open && <PanelUI onClose={() => setOpen(false)} />}
    </>,
    document.body
  );
}

// A slim banner pinned to the top showing the most recent error.
export function DebugBanner() {
  const items = useErrorStore();
  const [hiddenAt, setHiddenAt] = useState(() => { try { const v = parseInt(sessionStorage.getItem("debug_banner_hidden_at")||"0",10); return isNaN(v)?0:v; } catch { return 0; } });
  if (!items || !items.length) return null;
  const last = items[items.length - 1] || {};
  // Only show if newer than last dismissal
  if ((last.when || 0) <= hiddenAt) return null;
  const msg = (last.message || '').toString();
  const src = (last.source || '').toString();
  const clickDetails = () => { try { window.dispatchEvent(new Event('debug:open')); } catch {}; };
  const hide = () => { const now = Date.now(); try { sessionStorage.setItem("debug_banner_hidden_at", String(now)); } catch {}; setHiddenAt(now); };
  return ReactDOM.createPortal(
    <div style={{position:'fixed', top:0, left:0, right:0, zIndex:9999}}>
      <div style={{display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderBottom:'1px solid #fecaca', background:'#fee2e2', color:'#7f1d1d'}}>
        <div style={{fontWeight:600, whiteSpace:'nowrap'}}>Erreur</div>
        <div style={{fontSize:13, overflow:'hidden', textOverflow:'ellipsis'}}>
          {src ? `[${src}] ` : ''}{msg}
        </div>
        <div style={{marginLeft:'auto', display:'flex', gap:8}}>
          <button onClick={clickDetails} style={{fontSize:12, padding:'4px 8px', border:'1px solid #fecaca', borderRadius:6, background:'#fff'}}>
            Détails
          </button>
          <button onClick={hide} style={{fontSize:12, padding:'4px 8px', border:'1px solid #fecaca', borderRadius:6, background:'#fff'}}>
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Build mismatch banner, shown when the mixed-chunk guard forced a reload.
export function BuildMismatchBanner() {
  const [info, setInfo] = useState(() => {
    try {
      const reason = sessionStorage.getItem('__mix_chunks_reload_reason__') || '';
      const when = parseInt(sessionStorage.getItem('__mix_chunks_reload_at__') || sessionStorage.getItem('__mix_chunks_reload_at') || '0', 10) || 0;
      return { reason, when };
    } catch { return { reason: '', when: 0 }; }
  });
  const [hiddenAt, setHiddenAt] = useState(() => { try { const v = parseInt(sessionStorage.getItem('__build_mismatch_banner_hidden_at')||'0',10); return isNaN(v)?0:v; } catch { return 0; } });
  useEffect(() => {
    // Refresh info in case other code writes after this component mounts
    const t = setInterval(() => {
      try {
        const reason = sessionStorage.getItem('__mix_chunks_reload_reason__') || '';
        const when = parseInt(sessionStorage.getItem('__mix_chunks_reload_at__') || sessionStorage.getItem('__mix_chunks_reload_at') || '0', 10) || 0;
        if (reason && when && (when !== info.when || reason !== info.reason)) setInfo({ reason, when });
      } catch {}
    }, 1500);
    return () => { try { clearInterval(t); } catch {} };
  }, [info.when, info.reason]);
  const { reason, when } = info || {};
  if (!reason || !when) return null;
  if (when <= hiddenAt) return null;
  const since = (() => { try { const d = new Date(when); return isFinite(d.getTime()) ? d.toLocaleString() : ''; } catch { return ''; } })();
  const friendly = (() => {
    const map = {
      multiple_index_hashes_at_boot: 'Mixed frontend chunks detected (index hash mismatch).',
      multiple_build_ids_at_boot: 'Mixed build IDs detected in assets/.',
      index_hash_changed: 'Index chunk changed after boot.',
      index_hash_changed_nested: 'Index chunk changed (nested).',
      build_id_changed: 'Build ID changed after boot.',
      build_id_changed_nested: 'Build ID changed (nested).',
      tdz_reference_error: 'Runtime TDZ ReferenceError detected.',
      tdz_reference_rejection: 'Promise rejection with TDZ ReferenceError detected.',
      chunk_mismatch: 'Mixed frontend chunks detected.',
    };
    return map[String(reason)] || String(reason);
  })();
  const dismiss = () => {
    const now = Date.now();
    try { sessionStorage.setItem('__build_mismatch_banner_hidden_at', String(now)); } catch {}
    setHiddenAt(now);
  };
  return ReactDOM.createPortal(
    <div style={{ position:'fixed', top:0, left:0, right:0, zIndex:9999 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderBottom:'1px solid #fde68a', background:'#fef3c7', color:'#7c2d12' }}>
        <div style={{ fontWeight:600, whiteSpace:'nowrap' }}>Build mismatch</div>
        <div style={{ fontSize:13, overflow:'hidden', textOverflow:'ellipsis' }}>
          {friendly} {since ? `(${since})` : ''} Page reloaded automatically.
        </div>
        <div style={{ marginLeft:'auto' }}>
          <button onClick={dismiss} style={{ fontSize:12, padding:'4px 8px', border:'1px solid #fde68a', borderRadius:6, background:'#fff' }}>Dismiss</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
