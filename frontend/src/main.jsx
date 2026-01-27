import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Runtime guard to detect mixed frontend chunks (different index-<hash>.js files)
// and force a cache-busting reload once. This helps when a deploy leaves stale
// assets in caches or on disk and Vite chunks from different builds get mixed.
try {
  // Only in production builds
  if (import.meta && import.meta.env && import.meta.env.PROD) {
    const triedKey = '__chunk_mismatch_reload__';
    const hasTried = (() => { try { return sessionStorage.getItem(triedKey) === '1'; } catch { return false; } })();
    const markTried = () => { try { sessionStorage.setItem(triedKey, '1'); } catch {} };
    const noteReload = (reason) => {
      try {
        sessionStorage.setItem('__mix_chunks_reload_reason__', String(reason||''));
        sessionStorage.setItem('__mix_chunks_reload_at', String(Date.now()));
      } catch {}
    };
    const forceReload = (reason = 'chunk_mismatch') => {
      if (hasTried) return; // avoid infinite loops
      noteReload(reason);
      markTried();
      try { console.warn('[MixedChunks] reload due to', reason); } catch {}
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('_v', String(Date.now())); // cache buster
        window.location.replace(url.toString());
      } catch { try { window.location.reload(); } catch {} }
    };
    const getIndexHash = (u) => {
      try { const m = String(u || '').match(/\/assets\/index-([a-f0-9]+)\.[a-z0-9]+$/i); return m ? m[1] : null; } catch { return null; }
    };
    // Extract build-id style prefix from Vite output: assets/<buildId>/<chunk>
    // Examples: /assets/1764134759-nogit/mod-grabbing-sensorex-8c76347d.js
    const getBuildId = (u) => {
      try {
        const s = String(u || '');
        const m = s.match(/\/assets\/([^\/?#]+)\//i);
        // Ignore plain assets without a subdir (no build id)
        if (!m || !m[1]) return null;
        // Heuristic: treat names that look like chunk files (e.g., index-*.js) as non-build ids
        if (/^(index|vendor|module|mod)-[a-f0-9]{6,}\./i.test(m[1])) return null;
        return m[1];
      } catch { return null; }
    };
    const scanHashes = () => {
      try {
        const urls = [];
        document.querySelectorAll('script[src],link[href]').forEach((el) => {
          try { const u = el.src || el.href; if (u) urls.push(u); } catch {}
        });
        const hashes = new Set(urls.map(getIndexHash).filter(Boolean));
        const buildIds = new Set(urls.map(getBuildId).filter(Boolean));
        return { hashes, buildIds };
      } catch { return new Set(); }
    };
    const scanned = scanHashes();
    const hashes = scanned.hashes || new Set();
    const buildIds = scanned.buildIds || new Set();
    if (hashes.size > 1) {
      forceReload('multiple_index_hashes_at_boot');
    } else if (buildIds.size > 1) {
      forceReload('multiple_build_ids_at_boot');
    } else {
      // Observe late-loaded assets and reload if a different index-* hash appears
      try {
        const initial = Array.from(hashes)[0] || null;
        const initialBuild = Array.from(buildIds)[0] || null;
        const obs = new MutationObserver((mutList) => {
          for (const mut of mutList) {
            const nodes = [];
            try { if (mut.addedNodes) nodes.push(...mut.addedNodes); } catch {}
            try { if (mut.target) nodes.push(mut.target); } catch {}
            for (const n of nodes) {
              try {
                const u = (n && (n.src || n.href)) || '';
                const h = getIndexHash(u);
                if (h && initial && h !== initial) { obs.disconnect(); forceReload('index_hash_changed'); return; }
                const b = getBuildId(u);
                if (b && initialBuild && b !== initialBuild) { obs.disconnect(); forceReload('build_id_changed'); return; }
              } catch {}
              // Also check attribute changes on existing nodes
              try {
                if (n && n.querySelectorAll) {
                  n.querySelectorAll('script[src],link[href]').forEach((el) => {
                    const u2 = el.src || el.href; const h2 = getIndexHash(u2);
                    if (h2 && initial && h2 !== initial) { obs.disconnect(); forceReload('index_hash_changed_nested'); return; }
                    const b2 = getBuildId(u2);
                    if (b2 && initialBuild && b2 !== initialBuild) { obs.disconnect(); forceReload('build_id_changed_nested'); return; }
                  });
                }
              } catch {}
            }
          }
        });
        obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });
      } catch {}
    }
    // Emergency fallback: if a top-level ReferenceError indicates TDZ (e.g., mixed chunks), reload once.
    try {
      const onErr = (e) => {
        try {
          const msg = String(e && (e.message || (e.error && e.error.message) || ''));
          if (/(Cannot|can't) access .* before initialization/i.test(msg)) forceReload('tdz_reference_error');
        } catch {}
      };
      const onRej = (e) => {
        try {
          const r = e && e.reason; const msg = String((r && (r.message || (r.toString && r.toString()))) || '');
          if (/(Cannot|can't) access .* before initialization/i.test(msg)) forceReload('tdz_reference_rejection');
        } catch {}
      };
      window.addEventListener('error', onErr, { once: true });
      window.addEventListener('unhandledrejection', onRej, { once: true });
    } catch {}
  }
} catch {}

async function bootstrap() {
  // Hard-enforce DB-only sidebar: only seed initial tab if sidebar has items
  let hasSidebarItems = false;
  try {
    const params = new URLSearchParams();
    params.set('t', String(Date.now()));
    const res = await fetch('/api/sidebar/tree?' + params.toString(), { credentials: 'include' });
    if (res.ok) {
      const j = await res.json();
      hasSidebarItems = !!(j && Array.isArray(j.items) && j.items.length > 0);
    }
  } catch {}
  try {
    sessionStorage.setItem('app_has_sidebar', hasSidebarItems ? '1' : '0');
    const html = document.documentElement;
    if (html && html.setAttribute) html.setAttribute('data-has-sidebar', hasSidebarItems ? '1' : '0');
  } catch {}

  try {
    // Parse URL hash on first load; if none, default to Login
    const raw = String(window.location.hash || '').replace(/^#\/?/, '');
    if (raw) {
      const parts = raw.split('/').map(decodeURIComponent).filter(Boolean);
      const tab = parts[0] || 'login';
      sessionStorage.setItem('app_initial_tab', tab);
    } else {
      sessionStorage.setItem('app_initial_tab', 'login');
      if (window.location.hash !== '#/login') {
        window.location.replace('#/login');
      }
    }
  } catch {}

  const rootEl = document.getElementById('root')
  createRoot(rootEl).render(<App />)

  // If a cache-busting flag `_v` is present (added by mixed-chunk guard),
  // remove it from the URL to keep the address bar clean, without reloading.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('_v')) {
      url.searchParams.delete('_v');
      // Preserve hash and other parts; do not trigger a reload.
      window.history.replaceState(null, '', url.toString());
    }
  } catch {}
}

bootstrap()
