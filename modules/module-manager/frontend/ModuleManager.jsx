import React, { useEffect, useMemo, useState, useRef } from "react";

import { pushDebugError } from "../../../frontend/src/components/DebugPanel.jsx";
import { Icons } from "@shared-modules";

// Feature flag: enable Smart Sidebar Designer section
const MENU_BUILDER_ENABLED = true;

// Discover frontends for dynamic module rendering (Vite glob)
// From this file (modules/module-manager/frontend), '../../' points to modules/
const FRONTENDS = {
  ...import.meta.glob("../../*/frontend/index.js"),
  ...import.meta.glob("../../*/frontend/index.jsx"),
  ...import.meta.glob("../../*/frontend/index.ts"),
  ...import.meta.glob("../../*/frontend/index.tsx"),
};

// Advanced Module Manager: Menus Builder (Tree + DnD + Panels)
export default function ModuleManager() {
  // Breadcrumb
  useEffect(() => {
    try {
      window.dispatchEvent(
        new CustomEvent("app-breadcrumb", { detail: ["Module Manager"] })
      );
    } catch {}
  }, []);

  // Normalize legacy hashes like #/modules/<id> -> #/<id> for consistency
  useEffect(() => {
    try {
      const raw = String(window.location.hash || "");
      const m = raw.match(/^#\/modules\/(.*)$/);
      if (m && m[1]) {
        const next = `#/${m[1]}`;
        if (next !== raw) window.history.replaceState(null, "", next);
      }
    } catch {}
  }, []);

  // Modules list
  const [modules, setModules] = useState([]);
  // Library: DB-backed list of modules for Menus Builder
  const [modulesLibrary, setModulesLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [installerOpen, setInstallerOpen] = useState(false);
  const [installerData, setInstallerData] = useState(null);
  const [migrationsOpen, setMigrationsOpen] = useState(false);
  const [migrationsBusy, setMigrationsBusy] = useState(false);
  const [migrationsData, setMigrationsData] = useState(null);
  const [migrationsSummary, setMigrationsSummary] = useState({});
  const [scanBusy, setScanBusy] = useState(false);
  // Routes per module (API endpoints mounted)
  const [routesById, setRoutesById] = useState({}); // id -> [{path, methods}]
  const [openRoutes, setOpenRoutes] = useState({}); // id -> boolean
  const [diagById, setDiagById] = useState({}); // id -> diagnostics payload
  const [openDiag, setOpenDiag] = useState({}); // id -> boolean
  const fetchRoutesFor = async (id) => {
    if (!id) return [];
    try {
      const r = await fetch(`/api/module-manager/routes?id=${encodeURIComponent(id)}`, { credentials: 'include' });
      if (!r.ok) return [];
      const body = await r.json().catch(()=>({}));
      const items = Array.isArray(body.items) ? body.items : [];
      const entry = items.find((it) => it && (it.id === id || it.module === id));
      const routes = Array.isArray(entry?.routes) ? entry.routes : [];
      setRoutesById((prev) => ({ ...prev, [id]: routes }));
      return routes;
    } catch { return []; }
  };

  // Tree / builder state
  const [tree, setTree] = useState([]);
  const [treeFallback, setTreeFallback] = useState(false);
  const [treeCached, setTreeCached] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);
  const [flatIndex, setFlatIndex] = useState({}); // entry_id -> {level,parentId,label,hash,icon,logo,parentPath}
  const [allSubmenus, setAllSubmenus] = useState([]);
  const [allCustomLinks, setAllCustomLinks] = useState([]);
  const [renameNode, setRenameNode] = useState(null); // { entry_id, level, parentId, label, hash, icon, logo }
  const [editItem, setEditItem] = useState(null); // { entry_id, level, parentId, label, hash, icon, logo }
  const iconNames = useMemo(() => ["", ...Object.keys(Icons || {})], []);
  const moduleIdFor = (m) => {
    try {
      return (m && (m.id || m?.database?.record?.name || m.name || "")).toString();
    } catch { return ""; }
  };

  // Add forms
  const [showAddSubmenu, setShowAddSubmenu] = useState(false);
  const [newSubmenu, setNewSubmenu] = useState({
    label: "",
  });
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newCustom, setNewCustom] = useState({
    label: "",
    hash: "",
  });

  // Module generator (ZIP)
  const [gen, setGen] = useState({ name: "", id: "", category: "" });
  const [genBusy, setGenBusy] = useState(false);

  // Builder target (where left-panel Add buttons will add by default)
  const [builderTarget, setBuilderTarget] = useState({
    level: 0,
    parentId: null,
    parentLabel: "Racine",
  });

  // Select a target node (where the next added item will attach)
  const selectBuilderTarget = (node) => {
    try {
      if (!node) {
        setBuilderTarget({ level: 0, parentId: null, parentLabel: "Racine" });
        return;
      }
      const lvl = Number(node.level || 0);
      const label = node.label || node.entry_id || "?";
      setBuilderTarget({ level: Math.min(2, lvl + 1), parentId: node.entry_id, parentLabel: label });
    } catch {
      setBuilderTarget({ level: 0, parentId: null, parentLabel: "Racine" });
    }
  };

  // Toast (lightweight)
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = (text, type = "info") => {
    setToast({ text, type });
    try {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 3500);
    } catch {}
  };

  const updateMigrationsSummary = (id, payload) => {
    if (!id) return;
    setMigrationsSummary((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...(payload || {}) },
    }));
  };

  const openMigrations = async (id) => {
    try {
      if (!id) return;
      setMigrationsBusy(true);
      const r = await fetch(`/api/modules/${encodeURIComponent(id)}/migrations`, { credentials: 'include' });
      const { json, text } = await readResponseBody(r);
      const j = json || {};
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || text || `http_${r.status}`);
      const applied = Array.isArray(j?.applied) ? j.applied : [];
      const pending = Array.isArray(j?.pending) ? j.pending : [];
      updateMigrationsSummary(id, {
        module: j?.module || id,
        appliedCount: applied.length,
        pendingCount: pending.length,
        pendingList: pending,
      });
      setMigrationsData(j);
      setMigrationsOpen(true);
    } catch (e) {
      showToast(String(e?.message || e), 'error');
    } finally {
      setMigrationsBusy(false);
    }
  };

  // Hierarchy visualizer modal
  const [showHierarchy, setShowHierarchy] = useState(false);
  // Indented list view toggle
  // Menus Builder: show the tree as an indented list by default.
  // Persist the preference in localStorage so it sticks across sessions.
  const [indentView, setIndentView] = useState(() => {
    try {
      const v = localStorage.getItem('mm_indent_view');
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('mm_indent_view', indentView ? '1' : '0'); } catch {}
  }, [indentView]);
  const buildHierarchyData = (nodes) => {
    try {
      if (!Array.isArray(nodes)) return [];
      return nodes.map((n) => ({
        entry_id: n.entry_id,
        label: n.label || n.entry_id,
        hash: n.hash || "",
        icon: n.icon || null,
        logo: n.logo || null,
        children: buildHierarchyData(n.children || []),
      }));
    } catch { return []; }
  };
  const buildAscii = (nodes, prefix = "") => {
    const lines = [];
    const list = Array.isArray(nodes) ? nodes : [];
    list.forEach((n, i) => {
      const last = i === list.length - 1;
      const branch = last ? "└─" : "├─";
      const nextPrefix = prefix + (last ? "  " : "│ ");
      const label = (n?.label || n?.entry_id || "?") + (n?.entry_id ? ` (${n.entry_id})` : "");
      const hash = n?.hash ? ` — ${n.hash}` : "";
      lines.push(prefix + branch + " " + label + hash);
      if (n?.children && n.children.length) {
        lines.push(...buildAscii(n.children, nextPrefix));
      }
    });
    return lines;
  };

  // Hash navigation helper (forces handlers when hash is unchanged)
  const openHash = (h) => {
    try {
      if (!h) return;
      let toHash = String(h).trim();
      // Ensure a leading '#'
      if (!toHash.startsWith('#')) toHash = '#' + toHash;
      // Ensure canonical "#/" prefix (i.e., '#logs2' -> '#/logs2')
      toHash = toHash.replace(/^#(?!\/)/, '#/');
      // Collapse duplicate slashes after '#/'
      toHash = toHash.replace(/^#\/+/, '#/');
      if (window.location.hash !== toHash) {
        window.location.hash = toHash;
      } else {
        try {
          const ev = typeof HashChangeEvent !== 'undefined' ? new HashChangeEvent('hashchange') : new Event('hashchange');
          window.dispatchEvent(ev);
        } catch {
          try { window.dispatchEvent(new Event('hashchange')); } catch {}
        }
      }
    } catch {}
  };

  // Handle deep-linking to specific modules: supports both
  // new (#/<id>[/settings]) and legacy (#/modules/<id>[/settings]) patterns
  const [opened, setOpened] = useState(null); // { id, view: 'main'|'settings' }
  const [dyn, setDyn] = useState(null); // dynamically loaded module exports

  useEffect(() => {
    const parse = () => {
      try {
        const raw = String(window.location.hash || "").replace(/^#\/?/, "");
        const parts = raw.split("/").filter(Boolean);
        let id = null;
        let view = "main";
        if (parts[0] === "modules") {
          id = parts[1] || null;
          view = parts[2] === "settings" ? "settings" : "main";
        } else if (parts[0]) {
          id = parts[0];
          view = parts[1] === "settings" ? "settings" : "main";
        }
        // Only open the inline drawer for module settings. For the regular module
        // surface (view === 'main'), let the global app router render it under the
        // Modules tab to avoid embedding a module inside Module Manager.
        if (id && view === 'settings') setOpened({ id, view });
        else setOpened(null);
      } catch {}
    };
    parse();
    const onHash = () => parse();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Lazy-load dynamic module frontends when opening
  useEffect(() => {
    const load = async () => {
      try {
        if (!opened || !opened.id) {
          setDyn(null);
          return;
        }
        const candidates = [
          `../../${opened.id}/frontend/index.tsx`,
          `../../${opened.id}/frontend/index.ts`,
          `../../${opened.id}/frontend/index.js`,
        ];
        let mod = null;
        for (const k of candidates) {
          const imp = FRONTENDS[k];
          if (!imp) continue;
          try {
            mod = await imp();
            break;
          } catch {}
        }
        setDyn(mod || null);
      } catch {
        setDyn(null);
      }
    };
    load();
  }, [opened]);

  // Load modules
  const fetchModules = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resMounted] = await Promise.all([
        fetch('/api/module-manager/mounted', { credentials: 'include' })
      ]);

      // Prefer legacy endpoint, but fall back to server-level Module Manager list when missing.
      let res = await fetch("/api/modules", { credentials: 'include' });
      let j = null;
      if (!res.ok && res.status === 404) {
        res = await fetch("/api/module-manager/modules", { credentials: 'include' });
        if (!res.ok) throw new Error(await res.text());
        const alt = await res.json().catch(() => ({}));
        const items = Array.isArray(alt.items) ? alt.items : [];
        j = { modules: items.map((it) => ({ ...it, id: it.id || it.module_name })) };
      } else {
        if (!res.ok) throw new Error(await res.text());
        j = await res.json();
      }
      const mounted = (resMounted.ok ? await resMounted.json().catch(()=>({})) : {});
      const mountedSet = new Set(Array.isArray(mounted.items) ? mounted.items.map(it => (it && it.id) ? String(it.id) : '').filter(Boolean) : []);
      const list = Array.isArray(j.modules) ? j.modules : [];
      const withMounted = list.map(m => ({ ...m, mounted: mountedSet.has(m.id) }));
      setModules(withMounted);
      try {
        const mismatch = withMounted.some(m => (!!m.active) !== (!!m.mounted));
        setNeedsRestart(mismatch);
      } catch {}
    } catch (e) {
      setError(e?.message || "Impossible de charger les modules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModules();
  }, []);

  useEffect(() => {
    const loadMigrationsForList = async () => {
      const list = Array.isArray(modules) ? modules : [];
      for (const m of list) {
        const id = moduleIdFor(m);
        if (!id || migrationsSummary[id] || !m?.installed) continue;
        await fetchMigrationsSummary(id);
      }
    };
    loadMigrationsForList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modules]);

  // Load modules library for Menus Builder (from DB table)
  const fetchModulesLibrary = async () => {
    try {
      const r = await fetch('/api/sidebar/modules', { credentials: 'include' });
      if (r.ok) {
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items : [];
        setModulesLibrary(items);
        return;
      }
      // 404: build a minimal "modules library" from Module Manager list
      if (r.status === 404) {
        const rr = await fetch('/api/module-manager/modules', { credentials: 'include' });
        if (!rr.ok) { setModulesLibrary([]); return; }
        const jj = await rr.json().catch(() => ({}));
        const items = Array.isArray(jj.items) ? jj.items : [];
        setModulesLibrary(items.map((m) => {
          const id = m.id || m.module_name || '';
          return { id, entry_id: id ? `mod-${id}` : '', label: id || '', hash: id ? `#/${id}` : '' };
        }).filter((x) => x.id));
        return;
      }
      setModulesLibrary([]);
    } catch { setModulesLibrary([]); }
  };
  useEffect(() => { fetchModulesLibrary(); }, []);

  // Load full tree (level 0..2)
  const loadFullTree = async () => {
    setTreeLoading(true);
    try { setTreeFallback(false); } catch {}
    try { setTreeCached(false); } catch {}
    try {
      let sawFallback = false;
      let sawCached = false;
      const fetchLevel = async (level, parentId = null) => {
        const params = new URLSearchParams();
        params.set("level", String(level));
        if (parentId) params.set("parent_entry_id", parentId);
        const r = await fetch("/api/sidebar/tree?" + params.toString(), { credentials: 'include' });
        if (!r.ok) {
          // Treat 404 as an empty/fallback tree instead of surfacing an error
          if (r.status === 404) {
            try { setTreeFallback(true); } catch {}
            return [];
          }
          try { const t = await r.text(); pushDebugError({ source: "api:/api/sidebar/tree", error: 'HTTP ' + r.status + ': ' + t }); } catch { pushDebugError({ source: "api:/api/sidebar/tree", error: 'HTTP ' + r.status }); }
          throw new Error('sidebar_tree_http_' + r.status);
        }
        const j = await r.json();
        try {
          if (j && j.fallback) { sawFallback = true; setTreeFallback(true); }
          if (j && j.cached) { sawCached = true; setTreeCached(true); }
        } catch {}
        return Array.isArray(j.items) ? j.items : [];
      };
      // Also fetch raw entries (library) once
      let libRes;
      try {
        libRes = await fetch('/api/sidebar', { credentials: 'include' });
        if (!libRes.ok && libRes.status !== 404) {
          try { const t = await libRes.text(); pushDebugError({ source: 'api:/api/sidebar', error: 'HTTP ' + libRes.status + ': ' + t }); }
          catch { pushDebugError({ source: 'api:/api/sidebar', error: 'HTTP ' + libRes.status }); }
        }
      } catch (e) {
        try { pushDebugError({ source: 'api:/api/sidebar', error: String(e?.message || e) }); } catch {}
        libRes = new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const libJson = libRes.ok ? await libRes.json() : { items: [] };
      const library = Array.isArray(libJson.items) ? libJson.items : [];
      const L0 = await fetchLevel(0);
      const enrich = async (nodes, level) => {
        const out = [];
        for (const n of nodes) {
          const children =
            level < 2 ? await fetchLevel(level + 1, n.entry_id) : [];
          out.push({
            ...n,
            children: level < 2 ? await enrich(children, level + 1) : [],
          });
        }
        return out;
      };
      const full = await enrich(L0, 0);

      // If backend reports a fallback tree (DB issue), do not overwrite a previously loaded tree,
      // otherwise it looks like the user's settings were "lost".
      if (sawFallback && Array.isArray(tree) && tree.length) {
        showToast("DB indisponible — affichage conservé (ancien menu).", "warning");
        return;
      }
      if (sawCached) {
        showToast("DB indisponible — menu affiché depuis le cache serveur.", "info");
      }
      setTree(full);

      // We'll compute left-panel lists. Prefer server-side filtered endpoints
      // so type is respected (submenus vs liens), and only unattached items are shown.
      const list = [];
      const custom = [];
      const idx = {};
      const walk = (nodes, level, parents, parentId) => {
        for (const n of nodes) {
          const info = {
            entry_id: n.entry_id,
            label: n.label || n.entry_id,
            level,
            parentPath: parents.join(" / "),
            parentId: parentId || null,
            hash: n.hash || "",
            icon: n.icon || null,
            logo: n.logo || "",
          };
          idx[n.entry_id] = info;
          // Do not seed left panels from tree; left panels are library-only
          if (Array.isArray(n.children) && n.children.length)
            walk(n.children, level + 1, [...parents, info.label], n.entry_id);
        }
      };
      walk(full, 0, [], null);
      // Preferred: fetch explicit libraries (DB-filtered)
      try {
        const [subsRes, linksRes] = await Promise.all([
          fetch('/api/sidebar/submenus', { credentials: 'include' }),
          fetch('/api/sidebar/links', { credentials: 'include' }),
        ]);
        const isAuthFailure = (r) => r && (r.status === 401 || r.status === 403);
        // If endpoints are missing (404) or DB is unavailable (503), fall back to deriving from the generic library snapshot.
        // Do NOT fall back on auth failures; the library endpoints are admin-only.
        if (
          !isAuthFailure(subsRes) &&
          !isAuthFailure(linksRes) &&
          ((subsRes && !subsRes.ok) || (linksRes && !linksRes.ok))
        ) {
          throw new Error(`sidebar_library_endpoints_failed:${subsRes?.status || 'na'}:${linksRes?.status || 'na'}`);
        }
        if (subsRes && subsRes.ok) {
          const j = await subsRes.json();
          const arr = Array.isArray(j.items) ? j.items : [];
          for (const it of arr) {
            list.push({ entry_id: it.entry_id, label: it.label, level: 0, parentPath: '', parentId: null });
          }
        }
        if (linksRes && linksRes.ok) {
          const j = await linksRes.json();
          const arr = Array.isArray(j.items) ? j.items : [];
          for (const it of arr) {
            custom.push({ entry_id: it.entry_id, label: it.label, level: 0, parentPath: '', parentId: null, hash: it.hash, icon: it.icon || '', logo: it.logo || '' });
          }
        }
      } catch {
        // Fallback: derive from generic library snapshot if specific endpoints are unavailable
        const known = new Set((modules || []).map((m) => m && m.id).filter(Boolean));
        const isModuleHash = (h) => {
          const s = String(h || '');
          if (/^#?\/modules\//.test(s)) return true; // legacy
          const m = s.match(/^#?\/([^/]+)(?:\/|$)/);
          return !!(m && known.has(m[1]));
        };
        const seen = new Set();
        for (const it of library) {
          if (!it || it.attached !== false) continue; // only detached
          const key = `${it.entry_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!it.hash) {
            list.push({ entry_id: it.entry_id, label: it.label, level: 0, parentPath: '', parentId: null });
          } else if (!isModuleHash(it.hash)) {
            custom.push({ entry_id: it.entry_id, label: it.label, level: 0, parentPath: '', parentId: null, hash: it.hash, icon: it.icon || '', logo: it.logo || '' });
          }
        }
      }
      setAllSubmenus(list);
      setAllCustomLinks(custom);
      setFlatIndex(idx);
    } catch (e) {
      try { pushDebugError({ source: "ui:loadFullTree", error: String(e?.message || e) }); } catch {}
      showToast("Erreur de chargement de l'arborescence.", "error");
    } finally {
      setTreeLoading(false);
    }
  };

  const openInstallerLog = (payload) => {
    try {
      setInstallerData(payload || null);
      setInstallerOpen(true);
    } catch {}
  };

  const readResponseBody = async (r) => {
    const text = await r.text().catch(() => "");
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { text, json };
  };

  const fetchMigrationsSummary = async (id, { force = false } = {}) => {
    const key = String(id || "");
    if (!key) return null;
    if (!force && migrationsSummary[key]) return migrationsSummary[key];
    try {
      const r = await fetch(`/api/modules/${encodeURIComponent(key)}/migrations`, { credentials: "include" });
      const { json, text } = await readResponseBody(r);
      const j = json || {};
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || text || `http_${r.status}`);
      const applied = Array.isArray(j?.applied) ? j.applied : [];
      const pending = Array.isArray(j?.pending) ? j.pending : [];
      const summary = {
        module: j?.module || key,
        appliedCount: applied.length,
        pendingCount: pending.length,
        pendingList: pending,
      };
      updateMigrationsSummary(key, summary);
      return summary;
    } catch (e) {
      updateMigrationsSummary(key, { error: String(e?.message || e) });
      return null;
    }
  };

  const openSchemaDetails = async (moduleId, existingError) => {
    try {
      if (existingError) {
        openInstallerLog({ ok: false, action: "schema", module: moduleId, output: String(existingError) });
        return;
      }
      const r = await fetch(`/api/modules/${encodeURIComponent(moduleId)}/schema-report`, { credentials: "include" });
      const { json, text } = await readResponseBody(r);
      const j = json || {};
      openInstallerLog({
        ok: !!j?.ok,
        action: "schema-report",
        module: moduleId,
        message: j?.message || j?.error || (r.ok ? null : `http_${r.status}`),
        report: j || null,
        output: j?.install_error || text,
      });
    } catch (e) {
      openInstallerLog({ ok: false, action: "schema-report", module: moduleId, message: String(e?.message || e) });
    }
  };

  useEffect(() => {
    loadFullTree();
  }, []);

  // Builder add / delete / reorder
  const builderAdd = async (payload) => {
    try {
      const r = await fetch("/api/sidebar/tree/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || "add_failed");
      showToast("Ajouté", "success");
      await loadFullTree();
      try {
        window.dispatchEvent(new CustomEvent("sidebar:reload"));
      } catch {}
    } catch (e) {
      try { pushDebugError({ source: 'ui:/api/sidebar/tree/add', error: String(e?.message || e) }); } catch {}
      showToast(e?.message || "Erreur", "error");
    }
  };

  const saveRename = async () => {
    try {
      if (!renameNode || !renameNode.entry_id) {
        setRenameNode(null);
        return;
      }
      const body = {
        level: renameNode.level,
        parent_entry_id: renameNode.parentId || null,
        entry_id: renameNode.entry_id,
        label: renameNode.label || renameNode.entry_id,
        hash: renameNode.hash || "",
            icon: renameNode.icon || null,
            logo: renameNode.logo || null,
        type: 'update',
      };
      const r = await fetch("/api/sidebar/tree/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "update_failed");
      await loadFullTree();
      setRenameNode(null);
      showToast("Nom mis à jour", "success");
      try {
        window.dispatchEvent(new CustomEvent("sidebar:reload"));
      } catch {}
    } catch (e) {
      showToast(e?.message || "Erreur", "error");
      setRenameNode(null);
    }
  };

  const builderDelete = async (entry_id, level = null, parentId = null) => {
    try {
      if (!entry_id) return;
      const r = await fetch("/api/sidebar/tree/detach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({ entry_id, level: (level==null? null : Number(level)), parent_entry_id: (parentId==null? null : String(parentId)) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "detach_failed");
      await loadFullTree();
      showToast("Détaché", "success");
      try {
        window.dispatchEvent(new CustomEvent("sidebar:reload"));
      } catch {}
    } catch (e) {
      showToast(e?.message || "Erreur", "error");
    }
  };
  // Permanently delete a library entry (unattached submenu or custom link)
  const builderDestroy = async (entry_id) => {
    try {
      if (!entry_id) return;
      const r = await fetch('/api/sidebar/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ entry_id })
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || ('http_' + r.status));
      await loadFullTree();
      showToast('Supprimé', 'success');
      try { window.dispatchEvent(new CustomEvent('sidebar:reload')); } catch {}
    } catch (e) {
      try { pushDebugError({ source: 'ui:/api/sidebar/delete', error: String(e?.message || e) }); } catch {}
      showToast(e?.message || 'Erreur', 'error');
    }
  };

  const reorderLevel0 = async (order) => {
    try {
      const r = await fetch("/api/sidebar/tree/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({ order, level: 0, parent_entry_id: null }),
      });
      if (!r.ok) throw new Error("reorder_failed");
      showToast("Ordre enregistré", "success");
      await loadFullTree();
    } catch (e) {
      showToast(e?.message || "Erreur", "error");
    }
  };

  // Reorder any nested level (1 or 2) for a given parent
  const reorderLevel = async (level, parent_entry_id, order) => {
    try {
      const r = await fetch("/api/sidebar/tree/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'include',
        body: JSON.stringify({ order, level, parent_entry_id }),
      });
      if (!r.ok) throw new Error("reorder_failed");
      showToast("Ordre enregistré", "success");
      await loadFullTree();
      try { window.dispatchEvent(new CustomEvent("sidebar:reload")); } catch {}
    } catch (e) {
      showToast(e?.message || "Erreur", "error");
    }
  };

  // Drag-order helper: move an existing tree item before/after a sibling.
  const handleDropOrder = async (evt, { level, parentId, beforeId = null, afterId = null, siblings = [] }) => {
    try {
      evt.preventDefault(); evt.stopPropagation();
      const raw = evt.dataTransfer.getData(DND_MIME);
      if (!raw) return;
      const data = JSON.parse(raw);
      // If this is not a move of an existing tree node, fall back to add under parent
      if (!data || data.type !== 'tree-move') {
        await handleDropAdd(evt, { level, parentId });
        return;
      }
      const srcId = String(data.entry_id || '');
      if (!srcId) return;
      const bucket = Array.isArray(siblings) ? siblings.map(String) : [];
      // Build new order for the target bucket
      const base = bucket.filter((id) => id !== srcId);
      let idx = base.length;
      if (beforeId) {
        const i = base.indexOf(String(beforeId));
        idx = i >= 0 ? i : base.length;
      } else if (afterId) {
        const i = base.indexOf(String(afterId));
        idx = i >= 0 ? (i + 1) : base.length;
      }
      base.splice(idx, 0, srcId);

      // Reparent if necessary, then reorder
      const fromLevel = typeof data.fromLevel === 'number' ? data.fromLevel : null;
      const fromParentId = (data.fromParentId != null) ? String(data.fromParentId) : null;
      if (fromLevel !== level || fromParentId !== (parentId || null)) {
        const payload = buildAddPayloadFromDnd({ ...data, type: 'tree-move' }, level - 1, parentId || null);
        if (payload) await builderAdd(payload);
      }
      await reorderLevel(level, parentId || null, base);
      try { window.dispatchEvent(new CustomEvent('sidebar:reload')); } catch {}
    } catch (e) { showToast(e?.message || 'DnD: erreur', 'error'); }
  };

  // DnD from left panels to tree
  const DND_MIME = "application/x-module-manager";
  const buildAddPayloadFromDnd = (data, targetLevel, targetParentId) => {
    if (!data || !data.type) return null;
    let level = targetLevel == null ? 0 : Math.min(2, Number(targetLevel) + 1);
    const parent_entry_id = targetLevel == null ? null : targetParentId;
    if (data.type === 'tree-move') {
      return {
        level,
        parent_entry_id,
        entry_id: data.entry_id,
        label: data.label || data.entry_id,
        hash: data.hash || '',
        icon: data.icon || null,
        logo: data.logo || null,
        type: data.hash ? (data.hash.startsWith('#/') ? 'module' : 'lien') : 'sous-menu',
      };
    }
    if (data.type === "submenu") {
      return {
        level,
        parent_entry_id,
        entry_id: data.entry_id,
        label: data.label || data.entry_id,
        hash: "",
        icon: data.icon || null,
        logo: data.logo || null,
      };
    }
    if (data.type === "custom") {
      return {
        level,
        parent_entry_id,
        entry_id: data.entry_id,
        label: data.label || data.entry_id,
        hash: data.hash || "",
        icon: data.icon || null,
        logo: data.logo || null,
        // Explicitly tag as 'lien' so backend does not mis-infer 'module' for '#/' hashes
        type: 'lien',
      };
    }
    if (data.type === "module") {
      const entryId =
        data.entry_id || (data.moduleId ? `mod-${data.moduleId}` : "");
      return {
        level,
        parent_entry_id,
        entry_id: entryId,
        label: data.label || data.moduleId || entryId,
            hash: data.hash || (data.moduleId ? `#/${data.moduleId}` : ""),
        icon: data.icon || null,
        logo: data.logo || null,
      };
    }
    return null;
  };
  const handleDropAdd = async (evt, target) => {
    try {
      evt.preventDefault();
      evt.stopPropagation();
      const raw = evt.dataTransfer.getData(DND_MIME);
      if (!raw) return;
      const data = JSON.parse(raw);
      const payload = buildAddPayloadFromDnd(
        data,
        target?.level ?? null,
        target?.parentId ?? null
      );
      if (!payload) return;
      await builderAdd(payload);
    } catch (e) {
      showToast(e?.message || "Drag-and-drop: erreur", "error");
    }
  };

  // UI helpers
  const TreeItem = ({ n0, idx0, arr0 }) => {
    return (
      <li
        className="rounded border"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleDropAdd(e, { level: 0, parentId: n0.entry_id })}
        draggable
        onDragStart={(e) => {
          try {
            const payload = { type: 'tree-move', entry_id: n0.entry_id, label: n0.label, hash: n0.hash || '', icon: n0.icon || '', logo: n0.logo || '', fromLevel: 0, fromParentId: null };
            e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
          } catch {}
        }}
      >
        {/* drop zone: before this root item */}
        <div
          className="h-3 -mt-1 cursor-ns-resize opacity-40 hover:opacity-100 bg-indigo-300/60 border-t border-indigo-400"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDropOrder(e, { level: 0, parentId: null, beforeId: n0.entry_id, siblings: arr0.map((x) => x.entry_id) })}
        />
        <div className="flex items-center justify-between px-3 py-2">
          <div className="min-w-0 flex items-center gap-2">
            {/* Logo (if any), else icon preview */}
                    {n0.logo ? (
                      <img src={n0.logo} alt="logo" className="h-5 w-5 object-contain border rounded" />
                    ) : (
                      <span className="inline-flex items-center justify-center w-5 h-5 text-gray-600">
                {(() => {
                  const v = n0.icon || "";
                  const isUrl = /^\/?[\w\-\/%.]+\.(svg|png|jpg|jpeg)$/.test(v) || /^https?:/i.test(v) || /^data:/i.test(v);
                  if (isUrl) return <img src={v} alt="icon" className="h-4 w-4 object-contain border rounded" />;
                  if (Icons && v && Icons[v]) { const C = Icons[v]; return <C className="h-4 w-4" />; }
                  return <span className="inline-block h-4 w-4 rounded border border-gray-300 opacity-60"></span>;
                })()}
                      </span>
                    )}
            <div className="font-medium truncate">
              {renameNode && renameNode.entry_id === n0.entry_id ? (
                <input
                  autoFocus
                  className="rounded border px-2 py-1 text-sm"
                  value={renameNode.label}
                  onChange={(e) =>
                    setRenameNode((p) => ({ ...p, label: e.target.value }))
                  }
                  onBlur={saveRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveRename();
                    }
                    if (e.key === "Escape") {
                      setRenameNode(null);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="text-left"
                  title="Renommer"
                  onClick={() =>
                    setRenameNode({
                      entry_id: n0.entry_id,
                      level: 0,
                      parentId: null,
                      label: n0.label || n0.entry_id,
                      hash: n0.hash || "",
                      icon: n0.icon || null,
                      logo: n0.logo || null,
                    })
                  }
                >
                  {n0.label || n0.entry_id}
                </button>
              )}
              <span className="ml-2 text-xs text-gray-500">
                ({n0.entry_id})
              </span>
            </div>
            {n0.hash ? (
              <div className="text-xs text-gray-500 break-all truncate">
                {n0.hash}
              </div>
            ) : (
              <div className="text-xs text-gray-400">(Sous-menu)</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded border px-2 py-1 text-xs"
              onClick={async ()=>{ try { setScanBusy(true); await fetch('/api/modules/schema-scan', { method:'POST', credentials:'include' }); await fetchModules(); showToast('Schémas vérifiés', 'success'); } catch (e) { showToast(String(e?.message||e), 'error'); } finally { setScanBusy(false); } }}
              disabled={loading || scanBusy}
            >
              {scanBusy ? "Vérification..." : "Vérifier schémas"}
            </button>
            <button
              className={`rounded border px-2 py-1 text-xs ${builderTarget.parentId === n0.entry_id && builderTarget.level === 1 ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : ''}`}
              title="Définir comme cible (ajouter ici)"
              onClick={() => selectBuilderTarget({ level: 0, entry_id: n0.entry_id, label: n0.label })}
            >
              Cible
            </button>
            <button
              className="rounded border px-2 py-1 text-xs"
              onClick={() =>
                setEditItem({
                  entry_id: n0.entry_id,
                  level: 0,
                  parentId: null,
                  label: n0.label || n0.entry_id,
                  hash: n0.hash || "",
                  icon: n0.icon || "",
                  logo: n0.logo || "",
                })
              }
            >
              Éditer
            </button>
            <button
              className="rounded border px-2 py-1 text-xs text-red-700"
              title="Détacher de ce parent"
              onClick={() => builderDelete(n0.entry_id, 0, null)}
            >
              Détacher
            </button>
            <button
              className="rounded border px-2 py-1 text-xs"
              title="Monter"
              onClick={() => {
                if (idx0 <= 0) return;
                const arr = arr0.slice();
                const [m] = arr.splice(idx0, 1);
                arr.splice(idx0 - 1, 0, m);
                setTree(arr);
              }}
            >
              ↑
            </button>
            <button
              className="rounded border px-2 py-1 text-xs"
              title="Descendre"
              onClick={() => {
                if (idx0 >= arr0.length - 1) return;
                const arr = arr0.slice();
                const [m] = arr.splice(idx0, 1);
                arr.splice(idx0 + 1, 0, m);
                setTree(arr);
              }}
            >
              ↓
            </button>
          </div>
        </div>
        {/* drop zone: after this root item */}
        <div
          className="h-2 -mb-1 cursor-ns-resize opacity-0 hover:opacity-100 bg-indigo-200/60"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDropOrder(e, { level: 0, parentId: null, afterId: n0.entry_id, siblings: arr0.map((x) => x.entry_id) })}
        />
        {Array.isArray(n0.children) && n0.children.length > 0 && (
          <ul className="divide-y border-t tree-branch"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDropAdd(e, { level: 1, parentId: n0.entry_id })}
          >
            {n0.children.map((n1, idx1, arr1) => (
              <li
                key={n1.entry_id}
                className="px-3 py-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDropAdd(e, { level: 1, parentId: n0.entry_id })}
                draggable
                onDragStart={(e) => {
                  try {
                    const payload = { type: 'tree-move', entry_id: n1.entry_id, label: n1.label, hash: n1.hash || '', icon: n1.icon || '', logo: n1.logo || '', fromLevel: 1, fromParentId: n0.entry_id };
                    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
                  } catch {}
                }}
              >
                {/* drop zone: before this level-1 item */}
                <div
                  className="h-3 -mt-1 cursor-ns-resize opacity-40 hover:opacity-100 bg-indigo-300/60 border-t border-indigo-400"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDropOrder(e, { level: 1, parentId: n0.entry_id, beforeId: n1.entry_id, siblings: arr1.map((x) => x.entry_id) })}
                />
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex items-center gap-2">
                    {n1.logo ? (
                      <img src={n1.logo} alt="logo" className="h-5 w-5 object-contain border rounded" />
                    ) : (
                      <span className="inline-flex items-center justify-center w-5 h-5 text-gray-600">
                        {(() => {
                          const v = n1.icon || "";
                          const isUrl = /^\/?[\w\-\/%.]+\.(svg|png|jpg|jpeg)$/.test(v) || /^https?:/i.test(v) || /^data:/i.test(v);
                          if (isUrl) return <img src={v} alt="icon" className="h-4 w-4 object-contain border rounded" />;
                          if (Icons && v && Icons[v]) { const C = Icons[v]; return <C className="h-4 w-4" />; }
                          return <span className="inline-block h-4 w-4 rounded border border-gray-300 opacity-60"></span>;
                        })()}
                      </span>
                    )}
                    <div className="font-medium">
                      {renameNode && renameNode.entry_id === n1.entry_id ? (
                        <input
                          autoFocus
                          className="rounded border px-2 py-1 text-sm"
                          value={renameNode.label}
                          onChange={(e) =>
                            setRenameNode((p) => ({
                              ...p,
                              label: e.target.value,
                            }))
                          }
                          onBlur={saveRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveRename();
                            }
                            if (e.key === "Escape") {
                              setRenameNode(null);
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="text-left"
                          title="Renommer"
                          onClick={() =>
                            setRenameNode({
                              entry_id: n1.entry_id,
                              level: 1,
                              parentId: n0.entry_id,
                              label: n1.label || n1.entry_id,
                              hash: n1.hash || "",
                      icon: n1.icon || null,
                      logo: n1.logo || null,
                            })
                          }
                        >
                          {n1.label || n1.entry_id}
                        </button>
                      )}
                      <span className="ml-2 text-xs text-gray-500">
                        ({n1.entry_id})
                      </span>
                    </div>
                    {n1.hash ? (
                      <div className="text-xs text-gray-500 break-all truncate">
                        {n1.hash}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">(Sous-menu)</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className={`rounded border px-2 py-1 text-xs ${builderTarget.parentId === n1.entry_id && builderTarget.level === 2 ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : ''}`}
                      title="Définir comme cible (ajouter ici)"
                      onClick={() => selectBuilderTarget({ level: 1, entry_id: n1.entry_id, label: n1.label })}
                    >
                      Cible
                    </button>
                    <button
                      className="rounded border px-2 py-1 text-xs"
                      onClick={() =>
                        setEditItem({
                          entry_id: n1.entry_id,
                          level: 1,
                          parentId: n0.entry_id,
                          label: n1.label || n1.entry_id,
                          hash: n1.hash || "",
                          icon: n1.icon || "",
                          logo: n1.logo || "",
                        })
                      }
                    >
                      Éditer
                    </button>
                    <button
                      className="rounded border px-2 py-1 text-xs text-red-700"
                      title="Détacher de ce parent"
                      onClick={() => builderDelete(n1.entry_id, 1, n0.entry_id)}
                    >
                      Détacher
                    </button>
                    <button
                      className="rounded border px-2 py-1 text-xs"
                      title="Monter"
                      onClick={async () => {
                        if (idx1 <= 0) return;
                        const arr = arr1.slice();
                        const [m] = arr.splice(idx1, 1);
                        arr.splice(idx1 - 1, 0, m);
                        await reorderLevel(1, n0.entry_id, arr.map((x) => x.entry_id));
                      }}
                    >
                      ↑
                    </button>
                    <button
                      className="rounded border px-2 py-1 text-xs"
                      title="Descendre"
                      onClick={async () => {
                        if (idx1 >= arr1.length - 1) return;
                        const arr = arr1.slice();
                        const [m] = arr.splice(idx1, 1);
                        arr.splice(idx1 + 1, 0, m);
                        await reorderLevel(1, n0.entry_id, arr.map((x) => x.entry_id));
                      }}
                    >
                      ↓
                    </button>
                  </div>
                </div>
                {/* drop zone: after this level-1 item */}
                <div
                  className="h-2 -mb-1 cursor-ns-resize opacity-0 hover:opacity-100 bg-indigo-200/60"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDropOrder(e, { level: 1, parentId: n0.entry_id, afterId: n1.entry_id, siblings: arr1.map((x) => x.entry_id) })}
                />
                {Array.isArray(n1.children) && n1.children.length > 0 && (
                  <ul className="divide-y border-l tree-branch pl-4"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDropAdd(e, { level: 2, parentId: n1.entry_id })}
                  >
                    {n1.children.map((n2, idx2, arr2) => (
                      <li
                        key={n2.entry_id}
                        className="px-3 py-2"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleDropAdd(e, { level: 2, parentId: n1.entry_id })}
                        draggable
                        onDragStart={(e) => {
                          try {
                            const payload = { type: 'tree-move', entry_id: n2.entry_id, label: n2.label, hash: n2.hash || '', icon: n2.icon || '', logo: n2.logo || '', fromLevel: 2, fromParentId: n1.entry_id };
                            e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
                          } catch {}
                        }}
                      >
                        {/* drop zone: before this level-2 item */}
                        <div
                          className="h-3 -mt-1 cursor-ns-resize opacity-40 hover:opacity-100 bg-indigo-300/60 border-t border-indigo-400"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDropOrder(e, { level: 2, parentId: n1.entry_id, beforeId: n2.entry_id, siblings: arr2.map((x) => x.entry_id) })}
                        />
                        <div className="flex items-center justify-between">
                  <div className="min-w-0 flex items-center gap-2">
                    {n2.logo ? (
                      <img src={n2.logo} alt="logo" className="h-5 w-5 object-contain border rounded" />
                    ) : (
                      <span className="inline-flex items-center justify-center w-5 h-5 text-gray-600">
                        {(() => {
                          const v = n2.icon || "";
                          const isUrl = /^\/?[\w\-\/%.]+\.(svg|png|jpg|jpeg)$/.test(v) || /^https?:/i.test(v) || /^data:/i.test(v);
                          if (isUrl) return <img src={v} alt="icon" className="h-4 w-4 object-contain border rounded" />;
                          if (Icons && v && Icons[v]) { const C = Icons[v]; return <C className="h-4 w-4" />; }
                          return <span className="inline-block h-4 w-4 rounded border border-gray-300 opacity-60"></span>;
                        })()}
                      </span>
                    )}
                    <div className="font-medium">
                              {renameNode &&
                              renameNode.entry_id === n2.entry_id ? (
                                <input
                                  autoFocus
                                  className="rounded border px-2 py-1 text-sm"
                                  value={renameNode.label}
                                  onChange={(e) =>
                                    setRenameNode((p) => ({
                                      ...p,
                                      label: e.target.value,
                                    }))
                                  }
                                  onBlur={saveRename}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      saveRename();
                                    }
                                    if (e.key === "Escape") {
                                      setRenameNode(null);
                                    }
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="text-left"
                                  title="Renommer"
                                  onClick={() =>
                                    setRenameNode({
                                      entry_id: n2.entry_id,
                                      level: 2,
                                      parentId: n1.entry_id,
                                      label: n2.label || n2.entry_id,
                                      hash: n2.hash || "",
                                      icon: n2.icon || null,
                                      logo: n2.logo || null,
                                    })
                                  }
                                >
                                  {n2.label || n2.entry_id}
                                </button>
                              )}
                              <span className="ml-2 text-xs text-gray-500">
                                ({n2.entry_id})
                              </span>
                            </div>
                            {n2.hash ? (
                              <div className="text-xs text-gray-500 break-all truncate">
                                {n2.hash}
                              </div>
                            ) : (
                              <div className="text-xs text-gray-400">
                                (Sous-menu)
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="rounded border px-2 py-1 text-xs"
                              onClick={() =>
                                setEditItem({
                                  entry_id: n2.entry_id,
                                  level: 2,
                                  parentId: n1.entry_id,
                                  label: n2.label || n2.entry_id,
                                  hash: n2.hash || "",
                                  icon: n2.icon || "",
                                  logo: n2.logo || "",
                                })
                              }
                            >
                              Éditer
                            </button>
                            <button
                              className="rounded border px-2 py-1 text-xs text-red-700"
                              title="Détacher de ce parent"
                              onClick={() =>
                                builderDelete(n2.entry_id, 2, n1.entry_id)
                              }
                            >
                              Détacher
                            </button>
                            <button
                              className="rounded border px-2 py-1 text-xs"
                              title="Monter"
                              onClick={async () => {
                                if (idx2 <= 0) return;
                                const arr = arr2.slice();
                                const [m] = arr.splice(idx2, 1);
                                arr.splice(idx2 - 1, 0, m);
                                await reorderLevel(2, n1.entry_id, arr.map((x) => x.entry_id));
                              }}
                            >
                              ↑
                            </button>
                            <button
                              className="rounded border px-2 py-1 text-xs"
                              title="Descendre"
                              onClick={async () => {
                                if (idx2 >= arr2.length - 1) return;
                                const arr = arr2.slice();
                                const [m] = arr.splice(idx2, 1);
                                arr.splice(idx2 + 1, 0, m);
                                await reorderLevel(2, n1.entry_id, arr.map((x) => x.entry_id));
                              }}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                        {/* drop zone: after this level-2 item */}
                        <div
                          className="h-2 -mb-1 cursor-ns-resize opacity-0 hover:opacity-100 bg-indigo-200/60"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDropOrder(e, { level: 2, parentId: n1.entry_id, afterId: n2.entry_id, siblings: arr2.map((x) => x.entry_id) })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const appliedMigrations = Array.isArray(migrationsData?.applied) ? migrationsData.applied : [];
  const pendingMigrations = Array.isArray(migrationsData?.pending) ? migrationsData.pending : [];

  // Render
  return (
    // Avoid nested scroll containers; let the app shell panel handle scrolling
    <div className="h-full bg-white">
      {/* Builder UI intentionally hidden */}

      {/* Top: Modules control (install/activate/deactivate) */}
      <section className="mx-6 my-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Modules</h2>
          <div className="flex items-center gap-2">
            <button
              className="rounded border px-2 py-1 text-xs"
              onClick={async ()=>{ try { await fetch('/api/modules/refresh', { method:'POST', credentials:'include' }); } catch {}; await fetchModules(); }}
              disabled={loading}
            >
              {loading ? "Chargement." : "Rafraîchir"}
            </button>
            <button
              className="rounded border px-2 py-1 text-xs"
              onClick={async ()=>{ try { setScanBusy(true); await fetch('/api/modules/schema-scan', { method:'POST', credentials:'include' }); await fetchModules(); showToast('Schémas vérifiés', 'success'); } catch (e) { showToast(String(e?.message||e), 'error'); } finally { setScanBusy(false); } }}
              disabled={loading || scanBusy}
            >
              {scanBusy ? "Vérification..." : "Vérifier schémas"}
            </button>
          </div>
        </div>
        {needsRestart && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex items-start justify-between gap-3">
            <div>
              Modifications enregistrées. Un redémarrage du backend est requis pour appliquer le montage/démontage des routes.
            </div>
            <button className="text-xs rounded border px-2 py-0.5" onClick={()=>setNeedsRestart(false)}>OK</button>
          </div>
        )}
        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {String(error)}
          </div>
        )}
        {!modules || !modules.length ? (
          <div className="text-sm text-gray-500">Aucun module détecté.</div>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Nom</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Statut</th>
                  <th className="px-3 py-2">Monté</th>
                  <th className="px-3 py-2">Catégorie</th>
                  <th className="px-3 py-2">MCP Tools</th>
                  <th className="px-3 py-2">Profil</th>
                  <th className="px-3 py-2">Schema</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => {
                  const moduleId = moduleIdFor(m);
                  const migSummary = moduleId ? migrationsSummary[moduleId] : null;
                  const hasPendingMigrations = !!(migSummary && migSummary.pendingCount > 0);
                  return (
                    <tr key={m.id} className="border-t last:border-b">
                      <td className="px-3 py-2 font-medium text-gray-900">{m.name || m.id}</td>
                      <td className="px-3 py-2 text-gray-600">{m.id}</td>
                      <td className="px-3 py-2 text-gray-600">{m.version || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${m.installed ? (m.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200') : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                          {m.installed ? (m.active ? 'Actif' : 'Installé') : 'Non installé'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${m.mounted ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                          {m.mounted ? 'Oui' : 'Non'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{m.category || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${m.hasMcpTool ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                          {m.hasMcpTool ? 'Oui' : 'Non'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${m.hasProfil ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                          {m.hasProfil ? 'Oui' : 'Non'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {typeof m.schemaOk === 'boolean' ? (
                          <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${m.schemaOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                            {m.schemaOk ? 'OK' : (m.installError ? 'Erreur' : 'Échec')}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">n/a</span>
                        )}
                        {hasPendingMigrations && (
                          <div className="mt-1 text-[11px] text-amber-700">There are some pending migration</div>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          {!!m.installError && (
                            <div className="text-[10px] text-red-700 max-w-[200px] truncate" title={m.installError}>{m.installError}</div>
                          )}
                          {m.schemaOk === false && (
                            <button
                              className="text-[10px] px-2 py-0.5 border rounded"
                              title="Voir le détail de l'échec"
                              onClick={() => openSchemaDetails(moduleId, m.installError)}
                            >Détails</button>
                          )}
                          <button
                            className="text-[10px] px-2 py-0.5 border rounded"
                            onClick={async ()=>{
                              try {
                                setReportBusy(true);
                                const r = await fetch(`/api/modules/${encodeURIComponent(moduleId)}/schema-report`, { credentials:'include' });
                                const j = await r.json().catch(()=>({}));
                                if (!r.ok || j?.ok===false) throw new Error(j?.message || j?.error || 'schema_report_failed');
                                setReportData(j);
                                setReportOpen(true);
                              } catch (e) { alert(String(e?.message||e)); }
                              finally { setReportBusy(false); }
                            }}
                          >Rapport</button>
	                        <button
	                          className="text-[10px] px-2 py-0.5 border rounded"
	                          title="Exécuter l'installer du module (migrations) et afficher les migrations appliquées"
	                          onClick={async ()=>{
	                            try {
	                              setReportBusy(true);
	                              const r = await fetch(`/api/modules/${encodeURIComponent(moduleId)}/run-installer`, { method:'POST', credentials:'include' });
	                              const { json, text } = await readResponseBody(r);
	                              const j = json || {};
	                              if (!r.ok || j?.ok === false) {
	                                openInstallerLog({
	                                  ok: false,
	                                  action: "run-installer",
	                                  module: moduleId,
	                                  message: j?.message || j?.error || `http_${r.status}`,
	                                  output: j?.output || text,
	                                });
	                                throw new Error(j?.message || j?.error || 'installer_failed');
	                              }
	                              try {
	                                if (j?.migrations) {
	                                  setMigrationsData(j.migrations);
	                                  setMigrationsOpen(true);
	                                  updateMigrationsSummary(moduleId, {
	                                    appliedCount: Array.isArray(j.migrations?.applied) ? j.migrations.applied.length : undefined,
	                                    pendingCount: Array.isArray(j.migrations?.pending) ? j.migrations.pending.length : undefined,
	                                    pendingList: Array.isArray(j.migrations?.pending) ? j.migrations.pending : undefined,
	                                  });
	                                }
	                              } catch {}
	                              await fetchModules();
	                              showToast('Installer exécuté', 'success');
	                            } catch (e) {
	                              showToast(String(e?.message || e), 'error');
	                            }
	                            finally { setReportBusy(false); }
	                          }}
	                        >Migrer</button>
	                        <button
	                          className="text-[10px] px-2 py-0.5 border rounded"
	                          title="Lister les migrations disponibles / appliquées"
	                          disabled={migrationsBusy}
	                          onClick={() => openMigrations(moduleId)}
	                        >Migrations</button>
	                      </div>
	                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {!m.installed && (
                          <button
                            className="rounded bg-blue-600 px-2 py-1 text-xs text-white"
                            onClick={async () => {
                              try {
                                const id = moduleId;
                                const r = await fetch('/api/modules/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials:'include', body: JSON.stringify({ id }) });
                                const { json, text } = await readResponseBody(r);
                                const j = json || {};
                                if (!r.ok || j?.ok === false) {
                                  openInstallerLog({
                                    ok: false,
                                    action: "install",
                                    module: id,
                                    message: j?.message || j?.error || `http_${r.status}`,
                                    output: j?.output || text,
                                  });
                                  throw new Error(j?.message || j?.error || 'install_failed');
                                }
                                await fetchModules();
                                if (j?.installer?.ok) showToast('Module installé + migrations OK', 'success');
                                else if (j?.installer && j.installer.skipped) showToast('Module installé', 'success');
                                else {
                                  showToast('Module installé (installer à vérifier)', 'error');
                                  openInstallerLog({
                                    ok: false,
                                    action: "install",
                                    module: id,
                                    message: j?.installer?.error || 'installer_failed',
                                    output: j?.installer?.output || '',
                                    installer: j?.installer || null,
                                  });
                                }
                              } catch (e) { showToast(e?.message || 'Erreur', 'error'); }
                            }}
                          >Installer</button>
                        )}
                        {m.installed && !m.active && (
                          <button
                            className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
                            onClick={async () => {
                              try {
                                const r = await fetch('/api/modules/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials:'include', body: JSON.stringify({ id: moduleId }) });
                                if (!r.ok) throw new Error(await r.text());
                                await fetchModules();
                                showToast('Module activé', 'success');
                              } catch (e) { showToast(e?.message || 'Erreur', 'error'); }
                            }}
                          >Activer</button>
                        )}
                        {m.installed && m.active && (
                          <button
                            className="rounded bg-amber-600 px-2 py-1 text-xs text-white"
                            onClick={async () => {
                              try {
                                const r = await fetch('/api/modules/deactivate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials:'include', body: JSON.stringify({ id: moduleId }) });
                                if (!r.ok) throw new Error(await r.text());
                                await fetchModules();
                                showToast('Module désactivé', 'success');
                              } catch (e) { showToast(e?.message || 'Erreur', 'error'); }
                            }}
                          >Désactiver</button>
                        )}
                        {m.installed && (
                          <button
                            className="rounded border px-2 py-1 text-xs"
                            onClick={async () => {
                              try {
                                const r = await fetch('/api/modules/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials:'include', body: JSON.stringify({ id: moduleId }) });
                                if (!r.ok) throw new Error(await r.text());
                                await fetchModules();
                                showToast('Module désinstallé', 'success');
                              } catch (e) { showToast(e?.message || 'Erreur', 'error'); }
                            }}
                          >Désinstaller</button>
                        )}
                        <button
                          className="rounded border px-2 py-1 text-xs"
                          onClick={() => {
                            try {
                              const moduleName = (m && m.database && m.database.record && m.database.record.name) ? m.database.record.name : m.id;
                              const hash = (
                                moduleName === 'logs2' ? '#/logs2' :
                                moduleName === 'home-assistant' ? '#/home-assistant' :
                                moduleName === 'knowledge-base' ? '#/knowledge-base' :
                                moduleName === 'dev-manager' ? '#/dev-manager' : `#/${moduleName}`
                              );
                              openHash(hash);
                            } catch {
                              try { openHash(`#/${m.id}`); } catch {}
                            }
                          }}
                        >Ouvrir</button>
                        <button
                          className="rounded border px-2 py-1 text-xs"
                          onClick={() => openHash(`#/${m.id}/settings`)}
                        >Paramètres</button>
                        <button
                          className="rounded border px-2 py-1 text-xs"
                          onClick={async () => {
                            const id = moduleId;
                            try {
                              setOpenRoutes((s) => ({ ...s, [id]: !s[id] }));
                              if (!routesById[id]) await fetchRoutesFor(id);
                            } catch {}
                          }}
                        >Routes</button>
                        <button
                          className="rounded border px-2 py-1 text-xs"
                          title="Monter les routes de ce module (sans redémarrage)"
                          onClick={async ()=>{
                            try {
                              const id = moduleId;
                              const r = await fetch('/api/module-manager/mount', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ id, force: true }) });
                              const j = await r.json().catch(()=>({}));
                              if (!r.ok || j?.ok===false) { showToast(`Echec montage: ${String(j?.reason||j?.error||('HTTP '+r.status))}`, 'error'); return; }
                              showToast(j?.forced ? 'Routes remontées (force)' : 'Routes montées', 'success');
                              try { await fetchModules(); } catch {}
                              try { await fetchRoutesFor(id); setOpenRoutes((s)=>({ ...s, [id]: true })); } catch {}
                            } catch (e) { showToast(String(e?.message||e), 'error'); }
                          }}
                        >Monter routes</button>
                        <button
                          className="rounded border px-2 py-1 text-xs"
                          title="Diagnostiquer le montage des routes (import/export, erreurs)"
                          onClick={async ()=>{
                            try {
                              const id = moduleId;
                              const r = await fetch(`/api/module-manager/mount/diagnostics?id=${encodeURIComponent(id)}`, { credentials:'include' });
                              const j = await r.json().catch(()=>({}));
                              if (!r.ok || j?.ok===false) { showToast(String(j?.message||j?.error||('HTTP '+r.status)), 'error'); return; }
                              // Store diagnostics and open inline panel
                              setDiagById((prev)=>({ ...prev, [id]: j }));
                              setOpenDiag((prev)=>({ ...prev, [id]: true }));
                              // Also refresh inline route list for the module
                              try { await fetchRoutesFor(id); setOpenRoutes((s)=>({ ...s, [id]: true })); } catch {}
                            } catch (e) { showToast(String(e?.message||e), 'error'); }
                          }}
                        >Diag</button>
                        {openDiag[moduleId] && (
                          <div className="ml-2 mt-1 rounded border bg-white p-2 text-[11px] text-gray-800 max-w-full">
                            {(() => {
                              const id = moduleId;
                              const d = diagById[id] || {};
                              const lines = [];
                              lines.push(`module: ${id}`);
                              lines.push(`importable: ${d.importable ? 'yes' : 'no'}`);
                              if (Array.isArray(d.exports)) lines.push(`exports: ${d.exports.join(', ')}`);
                              if (d.importError && d.importError.message) lines.push(`importError: ${d.importError.message}`);
                              if (d.lastError && d.lastError.message) lines.push(`lastError: ${d.lastError.message}`);
                              lines.push(`routes (${Number(d.routesCount||0)}):`);
                              const routes = Array.isArray(d.routes) ? d.routes : [];
                              for (const r of routes) { lines.push(`  ${(Array.isArray(r.methods)&&r.methods.length?r.methods.join(',').toUpperCase():'GET')}  ${r.path}`); }
                              const text = lines.join('\n');
                              return (
                                <div>
                                  <div className="mb-1 flex items-center gap-2">
                                    <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>{ try { navigator.clipboard.writeText(text); showToast('Copié', 'info'); } catch (e) { showToast(String(e?.message||e), 'error'); } }}>Copier</button>
                                    <button className="px-2 py-0.5 border rounded bg-white" onClick={()=>{ try { const raw = JSON.stringify(d, null, 2); navigator.clipboard.writeText(raw); showToast('JSON copié', 'info'); } catch (e) { showToast(String(e?.message||e), 'error'); } }}>Copier JSON</button>
                                    <button className="px-2 py-0.5 border rounded bg-white" onClick={()=> setOpenDiag((s)=>({ ...s, [id]: false }))}>Fermer</button>
                                  </div>
                                  <pre className="whitespace-pre-wrap break-words max-h-60 overflow-auto bg-gray-50 p-2 border rounded">{text}</pre>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {openRoutes[moduleId] && (
                          <div className="ml-2 max-h-40 overflow-auto rounded border bg-gray-50 p-2 text-[11px] leading-5 text-gray-700">
                            {!routesById[moduleId] ? (
                              <div className="text-gray-500">Chargement…</div>
                            ) : (
                              <ul className="space-y-0.5">
                                {routesById[moduleId].length === 0 ? (
                                  <li className="text-gray-500">Aucune route détectée.</li>
                                ) : (
                                  routesById[moduleId].map((r, idx) => (
                                    <li key={idx} className="whitespace-nowrap">
                                      <span className="text-gray-600">{Array.isArray(r.methods) && r.methods.length ? r.methods.join(',').toUpperCase() : 'GET'}</span>
                                      <span className="mx-2 text-gray-400">—</span>
                                      <code className="text-gray-900">{r.path}</code>
                                    </li>
                                  ))
                                )}
                              </ul>
                            )}
                          </div>
                        )}
                        {/* Details drawer for quick introspection ("all tasks" approx.) */}
                        <details className="ml-2">
                          <summary className="cursor-pointer select-none text-xs text-gray-500">Détails</summary>
                          <div className="mt-2 rounded border bg-gray-50 p-2 text-[11px] leading-5 text-gray-700">
                            <div><span className="font-medium">Source:</span> {m.source || '—'}</div>
                            <div><span className="font-medium">Emplacements:</span> {Array.isArray(m.locations) && m.locations.length ? m.locations.join(', ') : '—'}</div>
                            {m.paths && (
                              <div className="mt-1">
                                <div className="font-medium">Chemins exposés:</div>
                                <pre className="mt-1 max-h-40 overflow-auto rounded bg-white p-2">{JSON.stringify(m.paths, null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        </details>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {toast && (
        <div className="fixed right-4 top-4 z-50">
          <div
            className={
              `rounded border px-4 py-2 text-sm shadow ` +
              (toast.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : toast.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-blue-200 bg-blue-50 text-blue-700")
            }
          >
            <div className="flex items-center gap-3">
              <div>{toast.text}</div>
              <button
                onClick={() => setToast(null)}
                className="rounded border border-transparent px-2 py-0.5 text-xs text-gray-500 hover:bg-white/50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Module view if deep-linked */}
      {opened && (
        <div className="mx-6 my-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Module:{" "}
              <span className="font-medium text-gray-900">{opened.id}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  opened.view === "main"
                    ? "bg-blue-600 text-white"
                    : "border border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
                onClick={() => {
                  try {
                    const moduleName = opened?.id;
                    const path = moduleName === 'logs2'
                      ? `#/logs2`
                      : (moduleName === 'home-assistant'
                        ? `#/home-assistant`
                        : (moduleName === 'knowledge-base'
                          ? `#/knowledge-base`
                          : (moduleName === 'dev-manager'
                            ? `#/dev-manager`
                            : `#/${moduleName}`)));
                    const url = new URL(path, window.location.href).href;
                    window.open(url, '_blank', 'noopener');
                  } catch {
                    try { const moduleName = opened?.id; window.open(moduleName === 'logs2' ? `#/logs2` : `#/${moduleName}`, '_blank'); } catch {}
                  }
                }}
              >
                Ouvrir
              </button>
              <button
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  opened.view === "settings"
                    ? "bg-blue-600 text-white"
                    : "border border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
                onClick={() => {
                  try {
                    const h = `#/${opened.id}/settings`;
                    if (window.location.hash !== h)
                      window.history.replaceState(null, "", h);
                  } catch {}
                }}
              >
                Réglages
              </button>
              <button
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  try {
                    const h = "#/modules";
                    if (window.location.hash !== h)
                      window.history.replaceState(null, "", h);
                    setOpened(null);
                  } catch {}
                }}
              >
                Retour
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white">
            {(() => {
              const mod = dyn || {};
              if (opened.view === "settings") {
                const Settings =
                  mod.Settings ||
                  mod.settings ||
                  mod.ModuleTemplateSettings ||
                  (mod.default && mod.default.Settings) ||
                  null;
                if (Settings) return <Settings />;
              } else {
                const Main =
                  mod.Main ||
                  mod.Module ||
                  mod.ModuleTemplate ||
                  (mod.default &&
                    (typeof mod.default === "function"
                      ? mod.default
                      : mod.default.Main)) ||
                  null;
                if (Main) return <Main />;
              }
              return (
                <div className="p-6 text-sm text-gray-600 space-y-3">
                  <div>Aucune vue frontend n'a été trouvée pour ce module.</div>
                  {opened?.id ? (
                    <div>
                      <button
                        type="button"
                        className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                        onClick={() => openHash(`#/${opened.id}`)}
                        title="Ouvrir en plein écran"
                      >
                        Ouvrir en plein écran
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Créer un module (ZIP) */}
      <div className="mx-6 mt-6 mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Créer un module (ZIP)</h2>
      </div>
      <div className="mx-6 mb-6 rounded border bg-white">
        <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
          <div>Créer un module (ZIP)</div>
        </div>
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <label className="text-xs text-gray-600">
              Nom du module
              <input className="mt-1 w-full rounded border px-2 py-1 text-sm" value={gen.name} onChange={(e)=> setGen((p)=>({ ...p, name: e.target.value }))} placeholder="ex: Logs2" />
            </label>
            <label className="text-xs text-gray-600">
              ID (optionnel)
              <input className="mt-1 w-full rounded border px-2 py-1 text-sm" value={gen.id} onChange={(e)=> setGen((p)=>({ ...p, id: e.target.value }))} placeholder="ex: mod-logs2" />
            </label>
            <label className="text-xs text-gray-600">
              Catégorie (optionnel)
              <input className="mt-1 w-full rounded border px-2 py-1 text-sm" value={gen.category} onChange={(e)=> setGen((p)=>({ ...p, category: e.target.value }))} placeholder="ex: AUTOMATIONS" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button className="rounded border px-2 py-1 text-sm" disabled={genBusy} onClick={async ()=>{
              if (!gen.name.trim()) { showToast('Renseignez un nom', 'error'); return; }
              setGenBusy(true);
              try {
                const r = await fetch('/api/modules/generate-zip', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ name: gen.name, id: gen.id || undefined, category: gen.category || undefined }) });
                if (r.status === 501) { showToast('ZIP indisponible (jszip non installé sur le serveur).', 'warning'); return; }
                if (!r.ok) throw new Error(await r.text() || 'Échec génération ZIP');
                const blob = await r.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `${(gen.id || gen.name).trim()}.zip`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                showToast('ZIP téléchargé — décompressez-le dans modules/', 'success');
              } catch (e) { showToast(e?.message || 'Erreur ZIP', 'error'); } finally { setGenBusy(false); }
            }}>
              {genBusy ? 'Génération…' : 'Télécharger (ZIP)'}
            </button>
          </div>
          <div className="text-xs text-gray-600 pt-1">Après génération locale, décompressez le ZIP dans <code>modules/</code> puis synchronisez/déployez.</div>
        </div>
      </div>

      {MENU_BUILDER_ENABLED && (<>
      {/* Smart Sidebar Designer */}
      <div className="mx-6 mt-4 mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-2">
          <span>Smart Sidebar Designer</span>
          {treeFallback && (
            <span className="inline-flex items-center rounded bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-medium" title="Fallback mode: DB unavailable">
              Fallback
            </span>
          )}
          {treeCached && (
            <span className="inline-flex items-center rounded bg-blue-100 text-blue-800 px-2 py-0.5 text-[10px] font-medium" title="Affichage depuis le cache (DB indisponible)">
              Cached
            </span>
          )}
        </h2>
      </div>
      <div className="mx-6 my-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Right: Tree */}
        <div className="rounded border bg-white md:order-2">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
            <div>Arborescence des menus</div>
          <div className="flex items-center gap-2">
            <button
              className="rounded border px-2 py-1 text-xs"
              title={indentView ? "Afficher en cartes" : "Afficher en liste indentée"}
              onClick={() => setIndentView((v) => !v)}
            >
              {indentView ? 'Vue cartes' : 'Vue indentée'}
            </button>
            <button
              className="rounded border px-2 py-1 text-xs"
              title="Visualiser la hiérarchie"
              onClick={() => setShowHierarchy(true)}
            >
              Visualiser
            </button>
            <button
              className="rounded border px-2 py-1 text-xs"
              title="Nettoyer et normaliser le JSON statique"
              onClick={async () => {
                try {
                  const r = await fetch('/api/sidebar/static/clean', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                    body: JSON.stringify({ normalize: true, dedupe: true })
                  });
                  const j = await r.json().catch(()=>({}));
                  if (!r.ok || !j.ok) throw new Error(j.error || 'clean_failed');
                  await loadFullTree();
                  showToast('Sidebar JSON nettoyé', 'success');
                  try { window.dispatchEvent(new CustomEvent('sidebar:reload')); } catch {}
                } catch (e) { showToast(String(e?.message||e), 'error'); }
              }}
            >Nettoyer JSON</button>
            <div className="hidden md:flex items-center text-[11px] text-gray-500 mr-2">
              Cible:
              <span className="ml-1 inline-flex items-center gap-1 rounded border px-2 py-0.5">
                {builderTarget.parentLabel || "Racine"}
                <span className="opacity-60">(niv. {builderTarget.level})</span>
                </span>
                <button
                  className="ml-2 rounded border px-1.5 py-0.5"
                  title="Réinitialiser la cible (Racine)"
                  onClick={() => setBuilderTarget({ level: 0, parentId: null, parentLabel: "Racine" })}
                >
                  Réinit.
                </button>
              </div>
              <button
                className="rounded border px-2 py-1 text-xs"
                onClick={() => {
                  try {
                    const order = tree.map((x) => x.entry_id);
                    reorderLevel0(order);
                  } catch {}
                }}
              >
                Enregistrer
              </button>
            </div>
          </div>
          <div
            className="p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDropAdd(e, { level: null, parentId: null })}
          >
            {!tree || !tree.length ? (
              <div className="text-sm text-gray-500">Aucune entrée</div>
            ) : (
              indentView ? (
                (() => {
                  const flat = [];
                  const walk = (nodes, level = 0, parentId = null) => {
                    for (const n of nodes || []) {
                      flat.push({
                        entry_id: n.entry_id,
                        label: n.label || n.entry_id,
                        hash: n.hash || '',
                        icon: n.icon || '',
                        logo: n.logo || '',
                        level,
                        parentId,
                      });
                      if (Array.isArray(n.children) && n.children.length) walk(n.children, level + 1, n.entry_id);
                    }
                  };
                  walk(tree, 0, null);
                  return (
                    <ul className="divide-y">
                      {flat.map((it) => (
                        <li key={it.entry_id} className="py-1.5">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0" style={{ paddingLeft: (it.level || 0) * 16 }}>
                              <div className="font-medium truncate flex items-center gap-2">
                                <span className="inline-flex items-center rounded bg-gray-100 text-gray-600 px-1.5 py-0.5 text-[10px]">L{it.level || 0}</span>
                                <span className="truncate">{it.label}</span>
                                <span className="ml-2 text-xs text-gray-500">({it.entry_id})</span>
                              </div>
                              {it.hash ? (
                                <div className="text-xs text-gray-500 break-all truncate">{it.hash}</div>
                              ) : (
                                <div className="text-xs text-gray-400">(Sous-menu)</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                className="rounded border px-2 py-1 text-xs"
                                title="Définir comme cible (ajouter ici)"
                                onClick={() => selectBuilderTarget({ level: it.level, entry_id: it.entry_id, label: it.label })}
                              >
                                Cible
                              </button>
                              <button
                                className="rounded border px-2 py-1 text-xs"
                                onClick={() => setEditItem({ entry_id: it.entry_id, level: it.level, parentId: it.parentId || null, label: it.label, hash: it.hash || '', icon: it.icon || '', logo: it.logo || '' })}
                              >
                                Éditer
                              </button>
                              <button
                                className="rounded border px-2 py-1 text-xs text-red-700"
                                title="Détacher de ce parent"
                                onClick={() => builderDelete(it.entry_id, it.level, it.parentId || null)}
                              >
                                Détacher
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  );
                })()
              ) : (
                <ul className="space-y-2">
                  {tree.map((n0, idx0, arr0) => (
                    <TreeItem key={n0.entry_id} n0={n0} idx0={idx0} arr0={arr0} />
                  ))}
                </ul>
              )
            )}
          </div>
        </div>

        {/* Left: Panels (Sous-menus, Liens personnalisés, Modules) */}
        <div className="flex flex-col gap-4 md:order-1">
          {/* Sous-menus */}
          <div className="rounded border bg-white">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
              <div>Éléments disponibles — Sous-menus</div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => setShowAddSubmenu((v) => !v)}
                >
                  {showAddSubmenu ? "Fermer" : "Ajouter"}
                </button>
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={loadFullTree}
                  disabled={treeLoading}
                >
                  {treeLoading ? "Chargement." : "Recharger"}
                </button>
              </div>
            </div>
            <div className="p-3">
              {showAddSubmenu && (
                <div className="mb-3 rounded border bg-gray-50 p-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                    {/* entry_id is generated server-side; no manual field */}
                    <label className="text-xs text-gray-600">
                      Label
                      <input
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                        value={newSubmenu.label}
                        onChange={(e) =>
                          setNewSubmenu((p) => ({
                            ...p,
                            label: e.target.value,
                          }))
                        }
                        placeholder="Nom du sous-menu"
                      />
                    </label>
                    {/** Icon/Logo optional fields removed — auto-managed later via Edit */}
                    <div className="md:col-span-3 flex justify-end gap-2">
                      <button
                        className="rounded border px-2 py-1 text-sm"
                        onClick={() => {
                          setShowAddSubmenu(false);
                          setNewSubmenu({ label: "" });
                        }}
                      >
                        Annuler
                      </button>
                      <button
                        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
                        onClick={async () => {
                          if (!newSubmenu.label) { showToast("Renseignez label", "error"); return; }
                          // Create in library only (detached)
                          try {
                            const r = await fetch('/api/sidebar/add', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ label: newSubmenu.label, hash: '', attached: false, type: 'sous-menu' })
                            });
                            const j = await r.json().catch(()=>({}));
                            if (!r.ok || !j.ok) throw new Error(j.message || j.error || `http_${r.status}`);
                            showToast('Ajouté', 'success');
                            await loadFullTree();
                            try { window.dispatchEvent(new CustomEvent('sidebar:reload')); } catch {}
                          } catch (e) { try { pushDebugError({ source:'ui:/api/sidebar/add', error:String(e?.message||e) }); } catch {}; showToast(e?.message || 'Erreur', 'error'); }
                          setNewSubmenu({ label: '' }); setShowAddSubmenu(false);
                        }}
                      >
                        Ajouter
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {!allSubmenus || !allSubmenus.length ? (
                <div className="text-sm text-gray-500">Aucun sous-menu</div>
              ) : (
                <ul className="space-y-2">
                  {allSubmenus.map((sm) => (
                    <li
                      key={sm.entry_id}
                      className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                      draggable
                      onDragStart={(e) => {
                        try {
                          e.dataTransfer.setData(
                            DND_MIME,
                            JSON.stringify({
                              type: "submenu",
                              entry_id: sm.entry_id,
                              label: sm.label,
                            })
                          );
                        } catch {}
                      }}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {sm.label}{" "}
                          <span className="ml-2 text-xs text-gray-500">
                            ({sm.entry_id})
                          </span>
                        </div>
                        {sm.parentPath && (
                          <div className="text-xs text-gray-500 truncate">
                            {sm.parentPath}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded border px-2 py-1 text-xs"
                          title="Ajouter ce sous-menu dans la cible sélectionnée"
                          onClick={async () => {
                            try {
                              const base = { type: 'submenu', entry_id: sm.entry_id, label: sm.label };
                              const payload = buildAddPayloadFromDnd(base, builderTarget.level - 1, builderTarget.parentId || null);
                              if (!payload) { showToast('Cible invalide', 'error'); return; }
                              await builderAdd(payload);
                            } catch (e) {
                              try { pushDebugError({ source:'ui:/api/sidebar/tree/add', error:String(e?.message||e) }); } catch {}
                              showToast(e?.message || 'Erreur', 'error');
                            }
                          }}
                        >
                          Ajouter ici
                        </button>
                        <button
                          className="rounded border px-2 py-1 text-xs"
                          onClick={() =>
                            setEditItem({
                              entry_id: sm.entry_id,
                              level: sm.level,
                              parentId: sm.parentId || null,
                              label: sm.label || sm.entry_id,
                              hash: "",
                              icon: "",
                            })
                          }
                        >
                          Éditer
                        </button>
                        <button
                          className="rounded border px-2 py-1 text-xs text-red-700"
                          title="Supprimer de la bibliothèque"
                          onClick={() => builderDestroy(sm.entry_id)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Liens personnalisés */}
          <div className="rounded border bg-white">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
              <div>Éléments disponibles — Liens personnalisés</div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => setShowAddCustom((v) => !v)}
                >
                  {showAddCustom ? "Fermer" : "Ajouter"}
                </button>
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={loadFullTree}
                  disabled={treeLoading}
                >
                  {treeLoading ? "Chargement." : "Recharger"}
                </button>
              </div>
            </div>
            <div className="p-3">
              {showAddCustom && (
                <div className="mb-3 rounded border bg-gray-50 p-3">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                    {/* entry_id is generated server-side; no manual field */}
                    <label className="text-xs text-gray-600">
                      Label
                      <input
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                        value={newCustom.label}
                        onChange={(e) =>
                          setNewCustom((p) => ({ ...p, label: e.target.value }))
                        }
                        placeholder="Nom du lien"
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      Hash / route
                      <input
                        className="mt-1 w-full rounded border px-2 py-1 text-sm"
                        value={newCustom.hash}
                        onChange={(e) =>
                          setNewCustom((p) => ({ ...p, hash: e.target.value }))
                        }
                        placeholder="#/<id> ou #/..."
                      />
                    </label>
                    {/** Icon/Logo optional fields removed — can be set later via Edit */}
                    <div className="md:col-span-4 flex justify-end gap-2">
                      <button
                        className="rounded border px-2 py-1 text-sm"
                        onClick={() => {
                          setShowAddCustom(false);
                          setNewCustom({ label: "", hash: "" });
                        }}
                      >
                        Annuler
                      </button>
                      <button
                        className="rounded border px-3 py-1.5 text-sm"
                        title="Ajouter ce lien dans la cible sélectionnée"
                        onClick={async () => {
                          if (!newCustom.label || !newCustom.hash) { showToast('Renseignez label et hash', 'error'); return; }
                          try {
                            const base = { type: 'custom', entry_id: '', label: newCustom.label, hash: newCustom.hash };
                            const payload = buildAddPayloadFromDnd(base, builderTarget.level - 1, builderTarget.parentId || null);
                            if (!payload) { showToast('Cible invalide', 'error'); return; }
                            await builderAdd(payload);
                            setShowAddCustom(false);
                            setNewCustom({ label: '', hash: '' });
                          } catch (e) {
                            try { pushDebugError({ source:'ui:/api/sidebar/tree/add', error:String(e?.message||e) }); } catch {}
                            showToast(e?.message || 'Erreur', 'error');
                          }
                        }}
                      >
                        Ajouter ici
                      </button>
                      <button
                        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
                        onClick={async () => {
                          if (!newCustom.label || !newCustom.hash) { showToast('Renseignez label et hash', 'error'); return; }
                          try {
                            const r = await fetch('/api/sidebar/add', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ label: newCustom.label, hash: newCustom.hash, attached: false, type: 'lien' })
                            });
                            const j = await r.json().catch(()=>({}));
                            if (!r.ok || !j.ok) throw new Error(j.message || j.error || `http_${r.status}`);
                            showToast('Ajouté', 'success');
                            await loadFullTree();
                            try { window.dispatchEvent(new CustomEvent('sidebar:reload')); } catch {}
                          } catch (e) { try { pushDebugError({ source:'ui:/api/sidebar/add', error:String(e?.message||e) }); } catch {}; showToast(e?.message || 'Erreur', 'error'); }
                          setNewCustom({ label: '', hash: '' }); setShowAddCustom(false);
                        }}
                      >
                        Ajouter (bibliothèque)
                      </button>
                    </div>
                    <div className="md:col-span-4 text-xs text-gray-500">
                      Cible: {builderTarget.parentLabel || "Racine"} (niveau{" "}
                      {builderTarget.level}).
                    </div>
                  </div>
                </div>
              )}

              {!allCustomLinks || !allCustomLinks.length ? (
                <div className="text-sm text-gray-500">
                  Aucun lien personnalisé
                </div>
              ) : (
                <ul className="space-y-2">
                  {allCustomLinks.map((ln) => (
                    <li
                      key={ln.entry_id}
                      className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                      draggable
                      onDragStart={(e) => {
                        try {
                          e.dataTransfer.setData(
                            DND_MIME,
                            JSON.stringify({
                              type: "custom",
                              entry_id: ln.entry_id,
                              label: ln.label,
                              hash: ln.hash,
                              icon: ln.icon,
                              logo: ln.logo,
                            })
                          );
                        } catch {}
                      }}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {ln.label}{" "}
                          <span className="ml-2 text-xs text-gray-500">
                            ({ln.entry_id})
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 break-all truncate">
                          {ln.hash}
                        </div>
                        {ln.parentPath && (
                          <div className="text-xs text-gray-500 truncate">
                            {ln.parentPath}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded border px-2 py-1 text-xs"
                          onClick={() =>
                            setEditItem({
                              entry_id: ln.entry_id,
                              level: ln.level,
                              parentId: ln.parentId || null,
                              label: ln.label || ln.entry_id,
                              hash: ln.hash || "",
                              icon: ln.icon || "",
                              logo: ln.logo || "",
                            })
                          }
                        >
                          Éditer
                        </button>
                        <button
                          className="rounded border px-2 py-1 text-xs text-red-700"
                          title="Supprimer de la bibliothèque"
                          onClick={() => builderDestroy(ln.entry_id)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Modules */}
          <div className="rounded border bg-white">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
              <div>Modules</div>
              <button
                className="rounded border px-2 py-1 text-xs"
                onClick={() => { fetchModules(); fetchModulesLibrary(); }}
                disabled={loading}
              >
                {loading ? "Chargement." : "Actualiser"}
              </button>
            </div>
            <div className="p-3">
              {!modulesLibrary || !modulesLibrary.length ? (
                <div className="text-sm text-gray-500">Aucun module</div>
              ) : (
                <ul className="space-y-2">
                  {modulesLibrary.map((m) => (
                    <li
                      key={m.id || m.entry_id || m.module_name}
                      className="flex items-center justify-between rounded border px-3 py-2 text-sm"
                      draggable
                      onDragStart={(e) => {
                        try {
                          e.dataTransfer.setData(
                            DND_MIME,
                            JSON.stringify({
                              type: "module",
                              moduleId: m.id || (m.entry_id ? String(m.entry_id).replace(/^mod-/, '') : ''),
                              label: m.label || m.name || m.id || (m.entry_id ? String(m.entry_id).replace(/^mod-/, '') : ''),
                              hash: m.hash || `#/${m.id || (m.entry_id ? String(m.entry_id).replace(/^mod-/, '') : '')}`,
                              entry_id: m.entry_id || (m.id ? `mod-${m.id}` : ''),
                            })
                          );
                        } catch {}
                      }}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {m.label || m.name || m.id}{" "}
                          <span className="ml-2 text-xs text-gray-500">
                            ({m.id || (m.entry_id ? String(m.entry_id).replace(/^mod-/, '') : '')})
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded border px-2 py-1 text-xs"
                          onClick={async () => {
                            const base = {
                              type: "module",
                              moduleId: m.id || (m.entry_id ? String(m.entry_id).replace(/^mod-/, '') : ''),
                              label: m.label || m.name || m.id || (m.entry_id ? String(m.entry_id).replace(/^mod-/, '') : ''),
                              hash: m.hash || `#/${m.id || (m.entry_id ? String(m.entry_id).replace(/^mod-/, '') : '')}`,
                              entry_id: m.entry_id || (m.id ? `mod-${m.id}` : ''),
                            };
                            const payload = buildAddPayloadFromDnd(
                              base,
                              builderTarget.level - 1,
                              builderTarget.parentId || null
                            );
                            await builderAdd(payload);
                          }}
                        >
                          Ajouter
                        </button>
                        {Array.isArray(m.routes) && m.routes.length ? (
                          <div className="ml-2 flex flex-wrap items-center gap-1 text-[11px] text-gray-600">
                            {m.routes.map((seg, i) => {
                              const mid = m.id || (m.entry_id ? String(m.entry_id).replace(/^mod-/, '') : '');
                              const routeHash = (!seg || seg === '/') ? `#/${mid}` : `#/${mid}/${seg}`;
                              const routeLabel = (!seg || seg === '/') ? '/' : `/${seg}`;
                              return (
                                <button
                                  key={`${mid}-${seg || 'root'}-${i}`}
                                  type="button"
                                  className="rounded border px-1.5 py-0.5 hover:bg-gray-50"
                                  title={`Créer un lien ${routeHash}`}
                                  onClick={async () => {
                                    const base = {
                                      type: 'lien',
                                      entry_id: '',
                                      label: `${m.label || mid} ${routeLabel}`.trim(),
                                      hash: routeHash,
                                      icon: m.icon || '',
                                      logo: m.logo || '',
                                    };
                                    const payload = buildAddPayloadFromDnd(
                                      base,
                                      builderTarget.level - 1,
                                      builderTarget.parentId || null
                                    );
                                    await builderAdd(payload);
                                  }}
                                >
                                  Créer {routeLabel}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      <EditModal
        editItem={editItem}
        setEditItem={setEditItem}
        iconNames={iconNames}
        onSaved={async () => {
          await loadFullTree();
          showToast("Entrée mise à jour", "success");
          try {
            window.dispatchEvent(new CustomEvent("sidebar:reload"));
          } catch {}
        }}
      />

      {/* Hierarchy visualizer modal */}
      {showHierarchy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowHierarchy(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-3xl max-h-[90vh] rounded-xl border bg-white shadow-lg flex flex-col">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 backdrop-blur px-4 py-3">
              <div className="font-semibold">Hiérarchie des menus (aperçu)</div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => {
                    try {
                      const data = buildHierarchyData(tree);
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = 'sidebar_hierarchy.json';
                      document.body.appendChild(a); a.click(); document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch {}
                  }}
                >
                  Télécharger JSON
                </button>
                <button className="rounded border px-2 py-1 text-xs" onClick={() => setShowHierarchy(false)}>Fermer</button>
              </div>
            </div>
            <div className="overflow-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-600 mb-1">JSON</div>
                <pre className="text-xs whitespace-pre-wrap rounded border p-3 bg-gray-50 overflow-auto" style={{maxHeight:'60vh'}}>
{(() => { try { return JSON.stringify(buildHierarchyData(tree), null, 2); } catch { return '[]'; } })()}
                </pre>
                <div className="mt-2">
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(buildHierarchyData(tree), null, 2)); showToast('JSON copié', 'success'); } catch {} }}
                  >Copier JSON</button>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Texte (arbre)</div>
                <pre className="text-xs whitespace-pre rounded border p-3 bg-gray-50 overflow-auto" style={{maxHeight:'60vh'}}>
{(() => { try { return buildAscii(tree, '').join('\n'); } catch { return ''; } })()}
                </pre>
                <div className="mt-2">
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => { try { navigator.clipboard.writeText(buildAscii(tree, '').join('\n')); showToast('Texte copié', 'success'); } catch {} }}
                  >Copier texte</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      </>) }

	      {/* Schema Report modal */}
	      {reportOpen && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center">
	          <div className="absolute inset-0 bg-black/30" onClick={()=>setReportOpen(false)} aria-hidden="true" />
	          <div className="relative w-full max-w-3xl max-h-[90vh] rounded-xl border bg-white shadow-lg flex flex-col">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 backdrop-blur px-4 py-3">
              <div className="font-semibold">Rapport de schéma {reportData?.module ? `- ${reportData.module}` : ''}</div>
              <div className="flex items-center gap-2">
                <button className="rounded border px-2 py-1 text-xs" onClick={()=>{ try { const txt = JSON.stringify(reportData || {}, null, 2); navigator.clipboard?.writeText(txt); showToast('Copié'); } catch {} }}>Copier</button>
                <button className="rounded border px-2 py-1 text-xs" onClick={()=>setReportOpen(false)}>Fermer</button>
              </div>
            </div>
            <div className="p-3 overflow-auto">
              {reportBusy ? (
                <div className="text-sm text-gray-600">Calcul en cours…</div>
              ) : (
                <pre className="text-xs whitespace-pre-wrap bg-gray-50 border rounded p-2">{JSON.stringify(reportData || {}, null, 2)}</pre>
              )}
            </div>
	          </div>
	        </div>
	      )}

	      {/* Migrations modal */}
	      {migrationsOpen && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center">
	          <div className="absolute inset-0 bg-black/30" onClick={()=>setMigrationsOpen(false)} aria-hidden="true" />
	          <div className="relative w-full max-w-3xl max-h-[90vh] rounded-xl border bg-white shadow-lg flex flex-col">
	            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 backdrop-blur px-4 py-3">
	              <div className="font-semibold">
	                Migrations {migrationsData?.module ? `- ${migrationsData.module}` : ''}
	              </div>
	              <div className="flex items-center gap-2">
	                <button
	                  className="rounded border px-2 py-1 text-xs"
	                  onClick={() => { try { const txt = JSON.stringify(migrationsData || {}, null, 2); navigator.clipboard?.writeText(txt); showToast('Copié'); } catch {} }}
	                >Copier</button>
	                <button className="rounded border px-2 py-1 text-xs" onClick={()=>setMigrationsOpen(false)}>Fermer</button>
	              </div>
	            </div>
	            <div className="p-3 overflow-auto">
	              {migrationsBusy ? (
	                <div className="text-sm text-gray-600">Chargement…</div>
	              ) : (
	                <div className="space-y-3">
	                  <div className="text-xs text-gray-700">
	                    <div><span className="font-semibold">Module name:</span> <span className="font-mono">{String(migrationsData?.module_name || '')}</span></div>
	                    <div><span className="font-semibold">Applied:</span> {appliedMigrations.length} • <span className="font-semibold">Pending:</span> {pendingMigrations.length}</div>
	                  </div>
	                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
	                    <div className="border rounded p-2 bg-gray-50">
	                      <div className="text-xs font-semibold mb-1">Applied</div>
	                      <pre className="text-[11px] whitespace-pre-wrap">{appliedMigrations.map((m)=>`${m.applied_at || ''}  ${m.filename || ''}`.trim()).join('\n') || '(none)'}</pre>
	                    </div>
	                    <div className="border rounded p-2 bg-gray-50">
	                      <div className="text-xs font-semibold mb-1">Pending</div>
	                      {pendingMigrations.length > 0 && (
	                        <div className="mb-1 text-xs text-amber-700">There are some pending migration</div>
	                      )}
	                      <pre className="text-[11px] whitespace-pre-wrap">{pendingMigrations.join('\n') || '(none)'}</pre>
	                    </div>
	                  </div>
	                </div>
	              )}
	            </div>
	          </div>
	        </div>
	      )}
	
	      {/* Installer output modal */}
	      {installerOpen && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center">
	          <div className="absolute inset-0 bg-black/30" onClick={()=>setInstallerOpen(false)} aria-hidden="true" />
          <div className="relative w-full max-w-3xl max-h-[90vh] rounded-xl border bg-white shadow-lg flex flex-col">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 backdrop-blur px-4 py-3">
              <div className="font-semibold">Installer log {installerData?.module ? `- ${installerData.module}` : ''}</div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => {
                    try {
                      const txt = JSON.stringify(installerData || {}, null, 2);
                      navigator.clipboard?.writeText(txt);
                      showToast('Copié');
                    } catch {}
                  }}
                >Copier</button>
                <button className="rounded border px-2 py-1 text-xs" onClick={()=>setInstallerOpen(false)}>Fermer</button>
              </div>
            </div>
            <div className="p-3 overflow-auto">
              <pre className="text-xs whitespace-pre-wrap bg-gray-50 border rounded p-2">{JSON.stringify(installerData || {}, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Edit modal
// Renders at the bottom of the tree view when `editItem` is set
// Includes icon picker suggestions from shared Icons
// Saves via the same /api/sidebar/tree/add endpoint
export function EditModal({ editItem, setEditItem, iconNames, onSaved }) {
  if (!editItem) return null;
  const logoSuggestionsByCategory = {
    Chatbots: [
      '/logos/chatbots/bot.svg',
      '/logos/chatbots/chat-bubbles.svg',
      '/logos/bolt.svg'
    ],
    Workflows: [
      '/logos/workflows/flow.svg',
      '/logos/workflows/nodes.svg'
    ],
    Files: [
      '/logos/files/file.svg',
      '/logos/files/folder.svg'
    ],
    Alerts: [
      '/logos/alerts/warning.svg',
      '/logos/alerts/bell.svg'
    ],
    DB: [
      '/logos/db/database.svg',
      '/logos/db/table.svg'
    ],
    Monitoring: [
      '/logos/monitoring/heartbeat.svg',
      '/logos/monitoring/trend-up.svg'
    ],
    Tools: [
      '/logos/tools/wrench.svg',
      '/logos/tools/gear.svg',
      '/logos/tools.svg'
    ],
    CRM: [
      '/logos/crm/users.svg',
      '/logos/crm/handshake.svg'
    ],
    Analytics: [
      '/logos/analytics/bar-chart.svg',
      '/logos/analytics/pie-chart.svg',
      '/logos/analytics.svg'
    ],
  };
  const save = async () => {
    try {
      const body = {
        level: editItem.level,
        parent_entry_id: editItem.parentId || null,
        entry_id: editItem.entry_id,
        label: editItem.label || editItem.entry_id,
        hash: editItem.hash || "",
        icon: editItem.icon || null,
        logo: editItem.logo || null,
        type: 'update',
      };
      const r = await fetch("/api/sidebar/tree/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "update_failed");
      await onSaved?.();
      try { window.dispatchEvent(new CustomEvent("sidebar:reload")); } catch {}
      setEditItem(null);
    } catch (e) {
      console.error(e);
      setEditItem(null);
    }
  };
  const SettingsHint = () => {
    try {
      const sx = String(editItem.hash || "");
      const m1 = sx.match(/^#?\/modules\/([^/]+)/);
      const m2 = sx.match(/^#?\/([^/]+)/);
      const id = (m1 && m1[1]) || (m2 && m2[1]) || null;
      if (!id) return null;
      return (
        <a
          href={`#/${encodeURIComponent(id)}/settings`}
          className="text-xs text-indigo-600 hover:underline"
          title="Ouvrir les réglages du module"
        >
          Ouvrir les réglages du module
        </a>
      );
    } catch {
      return null;
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={() => setEditItem(null)}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg max-h-[90vh] rounded-xl border bg-white shadow-lg flex flex-col">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 backdrop-blur px-4 py-3">
          <div className="font-semibold">Modifier l'entrée</div>
          <button
            className="rounded border px-2 py-1 text-sm"
            onClick={() => setEditItem(null)}
          >
            Fermer
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Identifiant (lecture seule)
          </div>
          <input
            value={editItem.entry_id}
            readOnly
            className="w-full rounded border px-2 py-1 text-sm bg-gray-50"
          />
          <label className="block text-sm text-gray-700">
            Label
            <input
              value={editItem.label}
              onChange={(e) =>
                setEditItem((p) => ({ ...p, label: e.target.value }))
              }
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-sm text-gray-700">
            Hash / route
            <input
              value={editItem.hash}
              onChange={(e) =>
                setEditItem((p) => ({ ...p, hash: e.target.value }))
              }
              placeholder="#/<id>[/...]"
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-sm text-gray-700">
            Icône
            <div className="mt-1 flex items-center gap-2">
              <select
                className="rounded border px-2 py-1 text-sm"
                value={editItem.icon || ""}
                onChange={(e) => setEditItem((p) => ({ ...p, icon: e.target.value || "", logo: "" }))}
              >
                {iconNames.map((n) => (
                  <option key={n} value={n}>
                    {n || "(aucune)"}
                  </option>
                ))}
              </select>
              <span className="inline-flex items-center justify-center w-5 h-5 text-gray-600">
                {Icons && editItem.icon && Icons[editItem.icon] ? (
                  (() => { const C = Icons[editItem.icon]; return <C className="h-4 w-4" />; })()
                ) : (
                  <span className="inline-block h-4 w-4 rounded border border-gray-300 opacity-60"></span>
                )}
              </span>
            </div>
            <div className="mt-2 text-xs text-gray-600">Icônes (aperçu)</div>
            <div className="grid grid-cols-8 gap-2 mt-1">
              {iconNames.filter(Boolean).map((name) => (
                <button
                  key={name}
                  type="button"
                  className="rounded border p-1 hover:bg-gray-50"
                  title={name}
                  onClick={() => setEditItem((p) => ({ ...p, icon: name, logo: "" }))}
                >
                  {Icons && Icons[name] ? (() => { const C = Icons[name]; return <C className="h-5 w-5" />; })() : (
                    <span className="inline-block h-5 w-5 rounded border border-gray-300 opacity-60"></span>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-1 text-xs text-gray-500">Choisir une icône (aperçu ci‑dessus) vide le champ Logo.</div>
          </label>
          <label className="block text-sm text-gray-700">
            Logo (URL)
            <div className="mt-1 flex items-center gap-2">
              <input
                value={editItem.logo || ""}
                onChange={(e) => setEditItem((p) => ({ ...p, logo: e.target.value }))}
                placeholder="https://.../logo.png"
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
              />
              {editItem.logo ? (
                <img src={editItem.logo} alt="logo" className="h-5 w-5 object-contain border rounded" />
              ) : (
                <span className="inline-block h-5 w-5 rounded border border-gray-300 opacity-60"></span>
              )}
            </div>
          </label>
          <div className="space-y-2">
            {Object.entries(logoSuggestionsByCategory).map(([cat, items]) => (
              <div key={cat}>
                <div className="mt-2 mb-1 text-xs font-medium text-gray-600">{cat}</div>
                <div className="grid grid-cols-8 gap-2">
                  {items.map((src) => (
                    <button key={src} type="button" className="rounded border p-1 hover:bg-gray-50" onClick={()=> setEditItem(p=>({ ...p, logo: src, icon: "" }))}>
                      <img src={src} alt={cat} className="h-7 w-7 object-contain" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="sticky bottom-0 z-10 flex items-center justify-between border-t bg-white/95 backdrop-blur pt-3 mt-3">
            <SettingsHint />
            <div className="flex items-center gap-2">
              <button
                className="rounded border px-2 py-1 text-sm"
                onClick={() => setEditItem(null)}
              >
                Annuler
              </button>
              <button
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
                onClick={save}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}















