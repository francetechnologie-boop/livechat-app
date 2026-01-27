import React, { useEffect, useMemo, useState } from "react";
import { buildPrestaImportPayloadFromPrepared } from "./utils/prestaPayload.js";
import { loadModuleState, saveModuleState } from "@app-lib/uiState";
import CreateGrabbingButton from "./components/CreateGrabbingButton.jsx";
import PageExplorer from "./components/PageExplorer.jsx";
import SitemapsTree from "./components/SitemapsTree.jsx";
import DomainUrls from "./components/DomainUrls.jsx";
import PrestaReadyTransfers from "./components/PrestaReadyTransfers.jsx";
import DomainConfigMaker from "./components/DomainConfigMaker.jsx";
import TransferConfigMaker from "./components/TransferConfigMaker.jsx";
import PrestaDbConnection from "./components/PrestaDbConnection.jsx";


export default function Grabbing() {
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(() => {
    try {
      // Hash > module state
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').map(decodeURIComponent).filter(Boolean);
      if (parts[0] === 'automations' && parts[1] === 'grabbing' && parts[2]) return parts[2];
    } catch {}
    try { const st = loadModuleState('automations.grabbing'); return st.selected || ""; } catch { return ""; }
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [latest, setLatest] = useState([]);
  const [runBusy, setRunBusy] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [runOut, setRunOut] = useState(null);

  // Config unifiée (avec options downloadImages / downloadDocs)
  const [cfg, setCfg] = useState({
    email: "",
    password: "",
    signInUrl: "https://client.packeta.com/en/sign/in",
    listUrl: "https://client.packeta.com/en/packets/list",
    debug: false,
    includeEmail: true,
    deepEnrich: false,
    snapshotHtml: false,
    tableCsv: true,
    downloadImages: true,
    downloadDocs: true,
  });

  // Jerome states
  const [jeromeUrl, setJeromeUrl] = useState("");
  const [jeromeRunOut, setJeromeRunOut] = useState(null);
  const [jeromeLatest, setJeromeLatest] = useState([]);
  const [jeromeHistory, setJeromeHistory] = useState([]);
  const [prestaTransfers, setPrestaTransfers] = useState([]);
  // Section collapses (restore from module state)
  const [collapseDiscovery, setCollapseDiscovery] = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return typeof st.collapseDiscovery === 'boolean' ? st.collapseDiscovery : true; } catch { return true; }
  });
  const [collapsePrestaDb,   setCollapsePrestaDb]   = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return typeof st.collapsePrestaDb === 'boolean' ? st.collapsePrestaDb : true; } catch { return true; }
  });
  const [collapseExtractor,  setCollapseExtractor]  = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return typeof st.collapseExtractor === 'boolean' ? st.collapseExtractor : true; } catch { return true; }
  });
  const [collapseTransfers,  setCollapseTransfers]  = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return typeof st.collapseTransfers === 'boolean' ? st.collapseTransfers : true; } catch { return true; }
  });
  const [collapseDomainsCard, setCollapseDomainsCard] = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return typeof st.collapseDomainsCard === 'boolean' ? st.collapseDomainsCard : false; } catch { return false; }
  });
  const [domainsBusy, setDomainsBusy] = useState(false);
  const [domainsMsg, setDomainsMsg] = useState('');
  const [domainsNew, setDomainsNew] = useState({ domain: '', sitemap_url: '' });
  const [domainsAddBusy, setDomainsAddBusy] = useState(false);
  const [domainsOpenMap, setDomainsOpenMap] = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return st.domainsOpenMap && typeof st.domainsOpenMap === 'object' ? st.domainsOpenMap : {}; } catch { return {}; }
  }); // { [domain]: boolean }
  const [domainsSelMap, setDomainsSelMap] = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return st.domainsSelMap && typeof st.domainsSelMap === 'object' ? st.domainsSelMap : {}; } catch { return {}; }
  }); // { [domain]: { [sitemapUrl]: true } }
  const [domainsTreeOpen, setDomainsTreeOpen] = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return st.domainsTreeOpen && typeof st.domainsTreeOpen === 'object' ? st.domainsTreeOpen : {}; } catch { return {}; }
  }); // { [domain]: boolean }
  const [domainsCfgOpen, setDomainsCfgOpen] = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return st.domainsCfgOpen && typeof st.domainsCfgOpen === 'object' ? st.domainsCfgOpen : {}; } catch { return {}; }
  }); // { [domain]: boolean }
  const [domainsCfgText, setDomainsCfgText] = useState({}); // { [domain]: string(JSON) }
  const [domainsCfgBusy, setDomainsCfgBusy] = useState(false);
  const [domainsCfgMsg, setDomainsCfgMsg] = useState('');
  const [domainsCfgHistOpen, setDomainsCfgHistOpen] = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return st.domainsCfgHistOpen && typeof st.domainsCfgHistOpen === 'object' ? st.domainsCfgHistOpen : {}; } catch { return {}; }
  }); // { [domain]: boolean }
  const [domainsCfgHist, setDomainsCfgHist] = useState({}); // { [domain]: Array<{id,saved_at,config}> }

  // Domain Config Maker (global card)
  const [dcmCollapsed, setDcmCollapsed] = useState(() => {
    try { const st = loadModuleState('automations.grabbing'); return typeof st.dcmCollapsed === 'boolean' ? st.dcmCollapsed : false; } catch { return false; }
  });
  // Shared active domain persisted across reloads
  const [dcmDomain, setDcmDomain] = useState(() => {
    try { return localStorage.getItem('jerome_active_domain') || ''; } catch { return ''; }
  });
  const [dcmEditor, setDcmEditor] = useState('');
  const [dcmBusy, setDcmBusy] = useState(false);
  const [dcmMsg, setDcmMsg] = useState('');
  const [dcmHist, setDcmHist] = useState([]);
  const [dcmTestUrl, setDcmTestUrl] = useState('');
  const [dcmTestBusy, setDcmTestBusy] = useState(false);
  const [dcmTestOut, setDcmTestOut] = useState(null);
  const dcmParseJsonWithDetails = (text) => {
    // legacy strict parser: kept for fallback references (unused after auto-fix)
    try { return JSON.parse(text || '{}'); }
    catch (e) {
      try {
        const m = String(e?.message || '').match(/position\s+(\d+)/i);
        const pos = m ? Number(m[1]) : -1;
        if (pos >= 0) {
          let line = 1, col = 1;
          for (let i = 0; i < text.length && i < pos; i++) { if (text[i] === '\n') { line++; col = 1; } else { col++; } }
          throw new Error(`Invalid JSON at ${line}:${col} (pos ${pos})`);
        }
      } catch {}
      throw new Error('Invalid JSON');
    }
  };
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
  const dcmDocName = (d) => {
    try {
      const u = new URL(String(d?.url || d?.href || ''));
      const p = u.pathname || '';
      const base = p.split('/').filter(Boolean).pop() || '';
      return base || (d?.text || d?.label || '');
    } catch {
      try { const s = String(d?.url || d?.href || ''); return s.split('/').pop() || (d?.text || d?.label || ''); } catch { return d?.text || d?.label || ''; }
    }
  };
  const loadDcmConfig = async (dom) => {
    if (!dom) return;
    setDcmMsg(''); setDcmBusy(true);
    try {
      const r = await fetch(`/api/grabbings/jerome/domains/config?domain=${encodeURIComponent(dom)}`, { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setDcmMsg(j?.message||j?.error||'load_failed');
      else setDcmEditor(JSON.stringify(j.config||{}, null, 2));
    } catch (e) { setDcmMsg(String(e?.message||e)); }
    finally { setDcmBusy(false); }
  };
  // Persist active domain
  useEffect(() => {
    try { localStorage.setItem('jerome_active_domain', dcmDomain || ''); } catch {}
  }, [dcmDomain]);
  const saveDcmConfig = async () => {
    if (!dcmDomain) { setDcmMsg('Select a domain'); return; }
    setDcmMsg(''); setDcmBusy(true);
    try {
      let cfg = {};
      try {
        const fixed = dcmAutoFixJson(dcmEditor);
        if (fixed !== dcmEditor) { setDcmEditor(fixed); setDcmMsg('Auto-fixed JSON (quotes/comments/trailing commas removed).'); }
        cfg = dcmParseJsonWithDetails(fixed);
      }
      catch (e) { setDcmMsg(String(e?.message||e)); setDcmBusy(false); return; }
      const r = await fetch('/api/grabbings/jerome/domains/config', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: dcmDomain, config: cfg }) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setDcmMsg(j?.message||j?.error||'save_failed');
      else { setDcmMsg('Saved.'); await refreshDiscoverDomains(); await loadDcmHistory(dcmDomain); }
    } catch (e) { setDcmMsg(String(e?.message||e)); }
    finally { setDcmBusy(false); }
  };
  const loadDcmHistory = async (dom) => {
    if (!dom) return; setDcmMsg('');
    try {
      const r = await fetch(`/api/grabbings/jerome/domains/config/history?domain=${encodeURIComponent(dom)}`, { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setDcmHist(Array.isArray(j.items)? j.items: []);
    } catch {}
  };
  const revertDcm = async (id) => {
    if (!dcmDomain || !id) return;
    setDcmMsg(''); setDcmBusy(true);
    try {
      const r = await fetch('/api/grabbings/jerome/domains/config/revert', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: dcmDomain, id }) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setDcmMsg(j?.message||j?.error||'revert_failed');
      else { setDcmMsg('Reverted.'); await loadDcmConfig(dcmDomain); await loadDcmHistory(dcmDomain); }
    } catch (e) { setDcmMsg(String(e?.message||e)); }
    finally { setDcmBusy(false); }
  };

  const testDcmConfig = async (useEditor = true) => {
    if (!dcmTestUrl || !/^https?:\/\//i.test(dcmTestUrl)) { setDcmMsg('Enter a valid test URL'); return; }
    setDcmMsg(''); setDcmTestBusy(true); setDcmTestOut(null);
    try {
      const body = { url: dcmTestUrl, debug: true, preview: true };
      if (useEditor) {
        let cfg = {};
        try {
          const fixed = dcmAutoFixJson(dcmEditor);
          if (fixed !== dcmEditor) { setDcmEditor(fixed); setDcmMsg('Auto-fixed JSON (quotes/comments/trailing commas removed).'); }
          cfg = dcmParseJsonWithDetails(fixed);
        }
        catch (e) { setDcmMsg(String(e?.message||e)); setDcmTestBusy(false); return; }
        body.config_override = cfg;
      }
      const r = await fetch('/api/grabbings/jerome/page/explore', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) setDcmMsg(j?.message||j?.error||('HTTP_'+r.status));
      else setDcmTestOut(j);
    } catch (e) { setDcmMsg(String(e?.message||e)); }
    finally { setDcmTestBusy(false); }
  };

  // Discovery & queue (Jerome)
  const [discover, setDiscover] = useState({
    url: "",
    sameHostOnly: true,
    maxPages: 5,
    maxUrls: 20,
    classify: true,
    classifyLimit: 25,
    debug: false,
    useSitemap: true,
    includePatterns: "", // comma or newline separated
    excludePatterns: "",
    includeRegex: "",
    excludeRegex: "",
  });
  const [discoverOut, setDiscoverOut] = useState(null);
  const [sitemapOut, setSitemapOut] = useState(null);
  const [sitemapBusy, setSitemapBusy] = useState(false);
  const [discoverFilter, setDiscoverFilter] = useState("all"); // all | product | category | page
  const [discoverHistory, setDiscoverHistory] = useState([]);
  const [discoverSessions, setDiscoverSessions] = useState([]); // enriched list from DB (domain, counts)
  const [discoverStats, setDiscoverStats] = useState({ totals: { domains:0, sessions:0, urls:0 }, by_domain: [] });
  const [discoverDomains, setDiscoverDomains] = useState([]);
  const [discoverSel, setDiscoverSel] = useState({});
  // URL-keyed selection map for Discovery table
  const [discoverSelSet, setDiscoverSelSet] = useState({});
  const [queue, setQueue] = useState([]);
  const [prestaDb, setPrestaDb] = useState({ host:'', port:3306, user:'', password:'', database:'', table_prefix:'', default_category_id:0, default_lang_id:1, default_shop_ids:'1', default_tax_rules_group_id:0, default_manufacturer_id:0, default_supplier_id:0, default_active:true, default_visibility:'both' });
  const [prestaMsg, setPrestaMsg] = useState('');
  const [prestaProfiles, setPrestaProfiles] = useState([]);
  const [prestaActiveProfile, setPrestaActiveProfile] = useState('');
  const [prestaProfileName, setPrestaProfileName] = useState('');
  const [prestaShowPwd, setPrestaShowPwd] = useState(false);
  const [prestaDetailOpen, setPrestaDetailOpen] = useState(false);
  const [prestaDetail, setPrestaDetail] = useState(null);
  const [prestaProfilesOpen, setPrestaProfilesOpen] = useState(true);
  const [discoverAddMsg, setDiscoverAddMsg] = useState('');

  // Sélection courante
  const it = useMemo(() => (items || []).find((x) => x.id === sel), [items, sel]);

  // Load from backend
  const load = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/grabbings", { credentials: "include" });
      const j = await r.json();
      if (r.ok && j?.ok) {
        let list = Array.isArray(j.items) ? j.items : [];
        // Migration locale -> serveur (one-shot)
        try {
          if (!list.length) {
            const raw = localStorage.getItem("automation_grabbings");
            const local = JSON.parse(raw || "[]");
            if (Array.isArray(local) && local.length) {
              for (const it of local) {
                try {
                  await fetch("/api/grabbings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                      name: it.title || it.name || "Grabbing",
                      target: it.target || "",
                      options: it.packeta ? { packeta: it.packeta } : undefined,
                    }),
                  });
                } catch (e) {}
              }
              try {
                localStorage.removeItem("automation_grabbings");
              } catch (e) {}
              const r2 = await fetch("/api/grabbings", { credentials: "include" });
              const j2 = await r2.json();
              if (r2.ok && j2?.ok) list = Array.isArray(j2.items) ? j2.items : [];
            }
          }
        } catch (e) {}
        setItems(list);
        if (!sel && list && list.length) setSel(list[0].id);
      } else setMsg(j?.message || j?.error || "load_failed");
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  // Persist collapse/expand and domain UI maps
  useEffect(() => {
    try {
      saveModuleState('automations.grabbing', {
        collapseDiscovery,
        collapsePrestaDb,
        collapseExtractor,
        collapseTransfers,
        collapseDomainsCard,
        dcmCollapsed,
        domainsOpenMap,
        domainsSelMap,
        domainsTreeOpen,
        domainsCfgOpen,
        domainsCfgHistOpen,
      });
    } catch {}
  }, [
    collapseDiscovery,
    collapsePrestaDb,
    collapseExtractor,
    collapseTransfers,
    collapseDomainsCard,
    dcmCollapsed,
    domainsOpenMap,
    domainsSelMap,
    domainsTreeOpen,
    domainsCfgOpen,
    domainsCfgHistOpen,
  ]);
  // Persist selection and keep hash updated
  useEffect(() => {
    try { saveModuleState('automations.grabbing', { selected: sel || '' }); } catch {}
    try {
      const raw = String(window.location.hash || '').replace(/^#\/?/, '');
      const parts = raw.split('/').map(decodeURIComponent).filter(Boolean);
      if (parts[0] === 'automations' && parts[1] === 'grabbing') {
        const next = ['automations', 'grabbing'];
        if (sel) next.push(String(sel));
        const nextHash = '#' + '/' + next.join('/');
        if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash);
      }
    } catch {}
  }, [sel]);

  // React to restore broadcast (from App hashchange or login)
  useEffect(() => {
    const onRestore = (e) => {
      try {
        const mod = e?.detail?.modules?.['automations.grabbing'];
        if (!mod || typeof mod !== 'object') return;
        if (Object.prototype.hasOwnProperty.call(mod, 'selected')) setSel(mod.selected || '');
        if (Object.prototype.hasOwnProperty.call(mod, 'collapseDomainsCard')) setCollapseDomainsCard(!!mod.collapseDomainsCard);
        if (Object.prototype.hasOwnProperty.call(mod, 'collapseTransfers')) setCollapseTransfers(!!mod.collapseTransfers);
        if (Object.prototype.hasOwnProperty.call(mod, 'collapsePrestaDb')) setCollapsePrestaDb(!!mod.collapsePrestaDb);
        if (Object.prototype.hasOwnProperty.call(mod, 'collapseExtractor')) setCollapseExtractor(!!mod.collapseExtractor);
        if (Object.prototype.hasOwnProperty.call(mod, 'collapseDiscovery')) setCollapseDiscovery(!!mod.collapseDiscovery);
        if (Object.prototype.hasOwnProperty.call(mod, 'dcmCollapsed')) setDcmCollapsed(!!mod.dcmCollapsed);
        if (Object.prototype.hasOwnProperty.call(mod, 'domainsOpenMap') && typeof mod.domainsOpenMap === 'object') setDomainsOpenMap(mod.domainsOpenMap || {});
        if (Object.prototype.hasOwnProperty.call(mod, 'domainsSelMap') && typeof mod.domainsSelMap === 'object') setDomainsSelMap(mod.domainsSelMap || {});
        if (Object.prototype.hasOwnProperty.call(mod, 'domainsTreeOpen') && typeof mod.domainsTreeOpen === 'object') setDomainsTreeOpen(mod.domainsTreeOpen || {});
        if (Object.prototype.hasOwnProperty.call(mod, 'domainsCfgOpen') && typeof mod.domainsCfgOpen === 'object') setDomainsCfgOpen(mod.domainsCfgOpen || {});
        if (Object.prototype.hasOwnProperty.call(mod, 'domainsCfgHistOpen') && typeof mod.domainsCfgHistOpen === 'object') setDomainsCfgHistOpen(mod.domainsCfgHistOpen || {});
      } catch {}
    };
    window.addEventListener('app-restore', onRestore);
    return () => window.removeEventListener('app-restore', onRestore);
  }, []);

  // Update breadcrumb with deeper trail
  useEffect(() => {
    const base = ['Automation Suite', 'Grabbing'];
    const trail = sel ? [...base, 'Grabbings', String(sel)] : base;
    try { window.dispatchEvent(new CustomEvent('app-breadcrumb', { detail: trail })); } catch {}
  }, [sel]);

  const onCreate = async (it) => {
    setBusy(true);
    setMsg("");
    try {
      const body = {
        name: it.title || it.name || "Grabbing",
        target: it.target || "",
      };
      const r = await fetch("/api/grabbings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j?.ok === false)
        throw new Error(j?.message || j?.error || "create_failed");
      await load();
      setSel(j.item?.id || "");
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await fetch(`/api/grabbings/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      await load();
      const arr = (items || []).filter((x) => x.id !== id);
      if (sel === id) setSel(arr[0]?.id || "");
    } catch (e) {}
  };

  // Helpers
  const normalizeAscii = (s) =>
    (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const isPacketa = (it) => {
    if (it && it.options && it.options.packeta) return true;
    const t = normalizeAscii(String(it?.name || it?.title || "")).toLowerCase();
    return t.includes("zasil") || t.includes("packeta");
  };
  const isJerome = (it) => {
    if (it && it.options && it.options.jerome) return true;
    const t = normalizeAscii(String(it?.name || it?.title || "")).toLowerCase();
    return t.includes("jerome");
  };

  // Packeta: latest files
  const refreshLatest = async () => {
    try {
      const r = await fetch("/api/grabbings/packeta/latest", {
        credentials: "include",
      });
      const j = await r.json();
      if (r.ok && j?.ok) setLatest(Array.isArray(j.items) ? j.items : []);
    } catch (e) {}
  };
  useEffect(() => {
    if (sel) refreshLatest();
  }, [sel]);

  // Jerome: latest files
  const refreshLatestJerome = async () => {
    try {
      const r = await fetch("/api/grabbings/jerome/latest", {
        credentials: "include",
      });
      const j = await r.json();
      if (r.ok && j?.ok) setJeromeLatest(Array.isArray(j.items) ? j.items : []);
    } catch (e) {}
  };
  useEffect(() => {
    if (sel) refreshLatestJerome();
  }, [sel]);
  const refreshPrestaTransfers = async () => {
    try {
      const r = await fetch('/api/presta/transfers', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setPrestaTransfers(Array.isArray(j.items)? j.items: []);
    } catch (e) {}
  };
  useEffect(() => { refreshPrestaTransfers(); }, []);

  // Jerome: build history table by fetching JSON from latest files
  useEffect(() => {
    let aborted = false;
    const toAbs = (u, base) => {
      try {
        return new URL(u, base).toString();
      } catch (e) {
        return u;
      }
    };
    const loadHist = async () => {
      const files = (jeromeLatest || []).slice(0, 10);
      const rows = await Promise.all(
        files.map(async (f) => {
          try {
            const r = await fetch(f.download_url, { credentials: "include" });
            const data = await r.json();
            const productUrl = data?.page?.url || data?.meta?.url || "";
            const price = data?.product?.price || "";
            const currency = data?.product?.currency || "";
            const imgs = Array.isArray(data?.product?.images)
              ? data.product.images
              : [];
            const imgFirst = imgs.length ? toAbs(imgs[0], productUrl || undefined) : "";
            // documents
            const docsSrc = Array.isArray(data?.documents) ? data.documents : [];
            const docs = docsSrc
              .map((d) => {
                const u = toAbs(d?.url || "", productUrl || undefined);
                let label = (d?.text || "").trim();
                if (!label && u) {
                  try {
                    label = new URL(u).pathname.split("/").pop();
                  } catch (e) {
                    label = u;
                  }
                }
                return u ? { url: u, text: label || u } : null;
              })
              .filter(Boolean);
            // declinaison text
            let decl = "";
            try {
              const vars = data?.shopify?.product?.variants || [];
              if (Array.isArray(vars) && vars.length) {
                const names = vars
                  .map((v) => v?.title || v?.name || v?.sku || "")
                  .filter(Boolean);
                decl = names.slice(0, 3).join(", ");
                if (names.length > 3) decl += ` (+${names.length - 3} more)`;
              } else if (data?.product?.sku) {
                decl = `SKU: ${data.product.sku}`;
              }
            } catch (e) {}
            return {
              file: f.name,
              when: f.mtime,
              fileUrl: f.download_url,
              productUrl,
              imageUrl: imgFirst,
              price,
              currency,
              declinaison: decl || "-",
              documents: docs,
            };
          } catch (e) {
            return {
              file: f.name,
              when: f.mtime,
              fileUrl: f.download_url,
              productUrl: "",
              imageUrl: "",
              price: "",
              currency: "",
              declinaison: "-",
              documents: [],
            };
          }
        })
      );
      if (!aborted) setJeromeHistory(rows);
    };
    if (jeromeLatest && jeromeLatest.length) loadHist();
    else setJeromeHistory([]);
    return () => {
      aborted = true;
    };
  }, [jeromeLatest]);

  // Charger config Packeta quand la sélection change
  useEffect(() => {
    const current = (items || []).find((x) => x.id === sel);
    const p = (current && current.packeta) || {};
    setCfg((prev) => ({
      ...prev,
      email:
        p.email ||
        (current && current.options?.packeta?.email) ||
        "",
      password:
        p.password ||
        (current && current.options?.packeta?.password) ||
        "",
      signInUrl:
        p.signInUrl ||
        (current && current.options?.packeta?.signInUrl) ||
        "https://client.packeta.com/en/sign/in",
      listUrl:
        p.listUrl ||
        (current && current.options?.packeta?.listUrl) ||
        "https://client.packeta.com/en/packets/list",
    }));
  }, [sel, items]);

  const saveCfg = () => {
    const current = (items || []).find((x) => x.id === sel);
    if (!current) return;
    const nextOptions = {
      ...(current.options || {}),
      packeta: { ...(current.options?.packeta || {}), ...cfg },
    };
    fetch(`/api/grabbings/${encodeURIComponent(sel)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ options: nextOptions }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok)
          setItems((prev) => prev.map((x) => (x.id === sel ? j.item : x)));
      })
      .catch(() => {});
  };

  const runPacketa = async () => {
    setRunBusy(true);
    setRunOut(null);
    try {
      const body = {};
      if (cfg.email?.trim()) body.email = cfg.email.trim();
      if (cfg.password?.trim()) body.password = cfg.password.trim();
      if (cfg.signInUrl?.trim()) body.sign_in_url = cfg.signInUrl.trim();
      if (cfg.listUrl?.trim()) body.list_url = cfg.listUrl.trim();
      if (cfg.debug) body.debug = true;
      if (cfg.includeEmail) body.include_email = true;
      if (cfg.deepEnrich) body.deep_enrich = true;
      if (cfg.snapshotHtml) body.snapshot_html = true;
      if (cfg.tableCsv) body.table_csv = true;
      const r = await fetch("/api/grabbings/packeta/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json();
      setRunOut(j);
      if (r.ok && j?.ok) await refreshLatest();
    } catch (e) {
      setRunOut({ ok: false, error: String(e?.message || e) });
    } finally {
      setRunBusy(false);
    }
  };

  const cleanupCsvs = async () => {
    setCleanupBusy(true);
    try {
      const r = await fetch("/api/grabbings/packeta/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok || j?.ok === false) {
        setMsg(j?.message || j?.error || "cleanup_failed");
      } else {
        setMsg(`Removed ${j.removed_count || 0} CSV file(s).`);
        await refreshLatest();
      }
    } catch (e) {
      setMsg(String(e?.message || e));
    } finally {
      setCleanupBusy(false);
    }
  };

  const runJerome = async () => {
    setRunBusy(true);
    setJeromeRunOut(null);
    try {
      const current = (items || []).find((x) => x.id === sel);
      const url = (jeromeUrl?.trim()) || current?.target || "";
      if (!url) {
        setMsg("URL required");
        return;
      }
      const r = await fetch("/api/grabbings/jerome/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          url,
          debug: !!cfg?.debug,
          snapshot_html: !!cfg?.snapshotHtml,
          download_images: true,
          download_documents: true,
        }),
      });
      const j = await r.json();
      setJeromeRunOut(j);
      if (r.ok && j?.ok) await refreshLatestJerome();
    } catch (e) {
      setJeromeRunOut({ ok: false, error: String(e?.message || e) });
    } finally {
      setRunBusy(false);
    }
  };
  // Add a single URL to queue (from Product URL field)
  const addUrlToQueue = async () => {
    const url = (jeromeUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) { setMsg('Valid URL required'); return; }
    try {
      const r = await fetch('/api/grabbings/jerome/queue/add', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ urls: [url] }) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) { setMsg(j?.message || j?.error || 'queue_add_failed'); return; }
      setMsg('Added to queue.');
      await refreshQueue();
    } catch (e) { setMsg(String(e?.message || e)); }
  };

  const deleteHistoryRow = async (row) => {
    if (!row?.file) return;
    if (!window.confirm("Delete this history item?")) return;
    try {
      const r = await fetch(
        `/api/grabbings/jerome/file/${encodeURIComponent(row.file)}`,
        { method: "DELETE", credentials: "include" }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        alert(j?.message || j?.error || "delete_failed");
        return;
      }
      setJeromeHistory((prev) => (prev || []).filter((x) => x.file !== row.file));
      await refreshLatestJerome();
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  const runSitemapCount = async () => {
    setSitemapOut(null);
    setSitemapBusy(true);
    try {
      const base = (discover.url || "").trim() || (jeromeUrl || "").trim();
      if (!base) { setMsg('Parent URL required'); return; }
      const splitList = (s) => String(s||'').split(/[\n,]+/).map(x=>x.trim()).filter(Boolean);
      const body = {
        url: base,
        same_host_only: !!discover.sameHostOnly,
        include_patterns: splitList(discover.includePatterns),
        exclude_patterns: splitList(discover.excludePatterns),
        include_regex: splitList(discover.includeRegex),
        exclude_regex: splitList(discover.excludeRegex),
        max_sitemaps: 200,
        max_urls: Number(discover.maxUrls || 100),
      };
      const r = await fetch('/api/grabbings/jerome/sitemap/count', { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify(body) });
      const j = await r.json();
      setSitemapOut(j);
      if (!r.ok || j?.ok === false) setMsg(j?.message || j?.error || 'sitemap_failed');
      else {
        await refreshDiscoverStats();
        await refreshDiscoverDomains();
      }
    } catch (e) {
      setSitemapOut({ ok:false, error:String(e?.message||e) });
    } finally { setSitemapBusy(false); }
  };
  const pushHistoryToPresta = async (row) => {
    try {
      const rFile = await fetch(row.fileUrl, { credentials:'include' });
      const snap = await rFile.json();
      const data = buildPrestaImportPayloadFromPrepared(snap, row.url);
      const r = await fetch('/api/presta/products/import?debug=1', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ data, options: { id_shop:1, id_lang:1 }, source_file: row.file, debug: true }) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { alert(j?.message||j?.error||'import_failed'); return; }
      alert('Imported with id_product=' + j.id_product);
      await refreshPrestaTransfers();
    } catch (e) { alert(String(e?.message||e)); }
  };

  // Discover
  const runDiscover = async () => {
    setRunBusy(true);
    setDiscoverOut(null);
    try {
      const base = (discover.url || "").trim() || (jeromeUrl || "").trim();
      if (!base) {
        setMsg("Parent URL required");
        return;
      }
      // Parse list fields
      const splitList = (s) => String(s||'').split(/[\n,]+/).map(x=>x.trim()).filter(Boolean);
      const body = {
        url: base,
        same_host_only: !!discover.sameHostOnly,
        use_sitemap: !!discover.useSitemap,
        max_pages: Number(discover.maxPages || 5),
        max_urls: Number(discover.maxUrls || 100),
        classify: !!discover.classify,
        classify_limit: Number(discover.classifyLimit || 25),
        debug: !!discover.debug,
        include_patterns: splitList(discover.includePatterns),
        exclude_patterns: splitList(discover.excludePatterns),
        include_regex: splitList(discover.includeRegex),
        exclude_regex: splitList(discover.excludeRegex),
      };
      const r = await fetch("/api/grabbings/jerome/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json();
      setDiscoverOut(j);
      if (!r.ok || j?.ok === false)
        setMsg(j?.message || j?.error || "discover_failed");
      else {
        // Force a backend recompute to guarantee domain table is up-to-date
        try {
          const r2 = await fetch('/api/grabbings/jerome/discover/domains/recompute', { method:'POST', credentials:'include' });
          await r2.json().catch(()=>({}));
        } catch {}
        await refreshDiscoverHistory();
        await refreshDiscoverStats();
        await refreshDiscoverDomains();
      }
    } catch (e) {
      setDiscoverOut({ ok: false, error: String(e?.message || e) });
    } finally {
      setRunBusy(false);
    }
  };

  const refreshDiscoverHistory = async () => {
    try {
      const r = await fetch("/api/grabbings/jerome/discover/latest", {
        credentials: "include",
      });
      const j = await r.json();
      if (r.ok && j?.ok) {
        const list = Array.isArray(j.items) ? j.items : [];
        setDiscoverHistory(list);
        // If backend provided extended fields, surface them
        setDiscoverSessions(list.filter(it => it.domain !== undefined || it.url_count !== undefined));
      }
    } catch (e) {}
  };
  useEffect(() => {
    if (sel) refreshDiscoverHistory();
  }, [sel]);

  const refreshDiscoverStats = async () => {
    try {
      const r = await fetch('/api/grabbings/jerome/discover/stats', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setDiscoverStats({ totals: j.totals || { domains:0, sessions:0, urls:0 }, by_domain: Array.isArray(j.by_domain)? j.by_domain: [] });
    } catch (e) {}
  };
  useEffect(() => { refreshDiscoverStats(); }, []);

  const refreshDiscoverDomains = async () => {
    try {
      // Use canonical domains table (grabbing_jerome_domains) enriched with discovered stats
      const r = await fetch('/api/grabbings/jerome/domains', { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) setDiscoverDomains(Array.isArray(j.items)? j.items: []);
    } catch (e) {}
  };
  useEffect(() => { refreshDiscoverDomains(); }, []);
  useEffect(() => { if (sel) refreshDiscoverDomains(); }, [sel]);

  // Auto-select first domain on initial load when none stored/selected
  useEffect(() => {
    try {
      if (!dcmDomain && Array.isArray(discoverDomains) && discoverDomains.length > 0) {
        const first = String(discoverDomains[0]?.domain || '').trim();
        if (first) {
          setDcmDomain(first);
          try { localStorage.setItem('jerome_active_domain', first); } catch {}
        }
      }
    } catch {}
  }, [discoverDomains, dcmDomain]);

  // Page Explorer handled in its own component

  const loadDiscoveryFile = async (item) => {
    try {
      const r = await fetch(item.download_url, { credentials: "include" });
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : {}; } catch (e) {
        setDiscoverOut({ ok:false, error:'invalid_json', message:'Could not parse discovery file.' });
        return;
      }
      const urls = Array.isArray(data?.urls)
        ? data.urls
        : Array.isArray(data?.items)
        ? data.items
        : [];
      if (!r.ok) {
        setDiscoverOut({ ok:false, error:'http_'+r.status, message: (data && (data.message||data.error)) || text || 'load_failed' });
        return;
      }
      setDiscoverOut({ ok:true, base_url: data?.base_url || "", total_urls: urls.length, urls });
    } catch (e) {
      setDiscoverOut({ ok:false, error:'fetch_failed', message: String(e?.message || e) });
    }
  };

  const refreshQueue = async () => {
    try {
      const r = await fetch("/api/grabbings/jerome/queue", {
        credentials: "include",
      });
      const j = await r.json();
      if (r.ok && j?.ok) setQueue(Array.isArray(j.items) ? j.items : []);
    } catch (e) {}
  };
  useEffect(() => {
    if (sel) refreshQueue();
  }, [sel]);
  // Presta DB config load/save/test
  const loadPrestaDb = async () => {
    setPrestaMsg('');
    try {
      const r = await fetch('/api/admin/presta-db' + (prestaShowPwd? '?reveal=1':''), { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok && j.config) {
        const c = j.config;
        setPrestaDb(prev=>({
          ...prev,
          ...c,
          default_shop_ids: Array.isArray(c.default_shop_ids) ? c.default_shop_ids.join(',') : (c.default_shop_ids || prev.default_shop_ids)
        }));
      }
    } catch (e) {}
  };
  const loadPrestaProfiles = async () => {
    try {
      const r = await fetch('/api/admin/presta-db/profiles' + (prestaShowPwd? '?reveal=1':''), { credentials:'include' });
      const j = await r.json();
      if (r.ok && j?.ok) {
        setPrestaProfiles(Array.isArray(j.items)? j.items: []);
        setPrestaActiveProfile(j.active || '');
      }
    } catch (e) {}
  };
  useEffect(() => { loadPrestaDb(); loadPrestaProfiles(); }, []);
  const savePrestaDb = async () => {
    setPrestaMsg('');
    try {
      // Normalize shop ids; omit password if empty to preserve previous on server
      const payload = { ...prestaDb, default_lang_id: Number(prestaDb.default_lang_id||1), default_manufacturer_id: Number(prestaDb.default_manufacturer_id||0), default_supplier_id: Number(prestaDb.default_supplier_id||0), default_shop_ids: String(prestaDb.default_shop_ids||'1').split(',').map(s=>Number(s.trim())).filter(n=>!isNaN(n) && n>0) };
      if (!prestaShowPwd || !String(prestaDb.password||'').trim()) delete payload.password;
      const r = await fetch('/api/admin/presta-db', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) { setPrestaMsg(j?.message||j?.error||'save_failed'); return; }
      setPrestaMsg('Saved.');
    } catch (e) { setPrestaMsg(String(e?.message||e)); }
  };
  const showPrestaDetail = async () => {
    try {
      const r = await fetch('/api/admin/presta-db?reveal=1', { credentials:'include' });
      const j = await r.json();
      if (!r.ok || j?.ok === false) { setPrestaMsg(j?.message||j?.error||'detail_failed'); return; }
      setPrestaDetail(j.config || null);
      setPrestaDetailOpen(true);
    } catch (e) { setPrestaMsg(String(e?.message||e)); }
  };
  const togglePrestaDetail = async () => {
    if (prestaDetailOpen) {
      setPrestaDetailOpen(false);
      return;
    }
    if (!prestaDetail) await showPrestaDetail();
    else setPrestaDetailOpen(true);
  };
  const savePrestaProfile = async () => {
    setPrestaMsg('');
    const name = (prestaProfileName||'').trim();
    if (!name) { setPrestaMsg('Profile name required'); return; }
    try {
      const payload = { ...prestaDb, name, default_shop_ids: String(prestaDb.default_shop_ids||'1').split(',').map(s=>Number(s.trim())).filter(n=>!isNaN(n)&&n>0) };
      if (!prestaShowPwd || !String(prestaDb.password||'').trim()) delete payload.password;
      const r = await fetch('/api/admin/presta-db/profile', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setPrestaMsg(j?.message||j?.error||'profile_save_failed'); return; }
      setPrestaMsg('Profile saved');
      await loadPrestaProfiles();
    } catch (e) { setPrestaMsg(String(e?.message||e)); }
  };
  const selectPrestaProfile = async (name) => {
    try {
      const r = await fetch('/api/admin/presta-db/profile/select', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ name }) });
      const j = await r.json();
      if (!r.ok || j?.ok===false) { setPrestaMsg(j?.message||j?.error||'profile_select_failed'); return; }
      setPrestaActiveProfile(name);
      // Optionally load base config endpoint to populate fields
      await loadPrestaDb();
      await loadPrestaProfiles();
      setPrestaMsg('Profile activated');
    } catch (e) { setPrestaMsg(String(e?.message||e)); }
  };
  const deletePrestaProfile = async (name) => {
    if (!window.confirm(`Delete profile ${name}?`)) return;
    try {
      const r = await fetch(`/api/admin/presta-db/profile/${encodeURIComponent(name)}`, { method:'DELETE', credentials:'include' });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || j?.ok===false) { setPrestaMsg(j?.message||j?.error||'profile_delete_failed'); return; }
      setPrestaMsg('Profile deleted');
      await loadPrestaProfiles();
    } catch (e) { setPrestaMsg(String(e?.message||e)); }
  };
  const testPrestaDb = async () => {
    setPrestaMsg('');
    try {
      const testPayload = { ...prestaDb };
      if (!prestaShowPwd || !String(prestaDb.password||'').trim()) delete testPayload.password;
      const r = await fetch('/api/admin/presta-db/test', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(testPayload) });
      const j = await r.json();
      if (!r.ok || j?.ok === false) { setPrestaMsg(j?.message||j?.error||'test_failed'); return; }
      setPrestaMsg('Connection OK');
    } catch (e) { setPrestaMsg(String(e?.message||e)); }
  };

  const addSelectedToQueue = async () => {
    setDiscoverAddMsg('');
    const filtered = (discoverOut?.urls || [])
      .filter((u) => discoverFilter === 'all' ? true : String(u.type || '').toLowerCase().includes(discoverFilter))
      .slice(0, 200);
    const urls = filtered.map(u => u.url).filter(u => !!discoverSelSet[u]);
    if (!urls.length) {
      setDiscoverAddMsg('Select at least one URL');
      return;
    }
    try {
      const r = await fetch('/api/grabbings/jerome/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ urls }),
      });
      const j = await r.json();
      if (!r.ok || j?.ok === false) { setDiscoverAddMsg(j?.message || j?.error || 'queue_add_failed'); return; }
      setDiscoverAddMsg(`Added ${j.added_count || 0} URL(s) to queue.`);
      setDiscoverSelSet({});
      await refreshQueue();
    } catch (e) { setMsg(String(e?.message || e)); }
  };

  const removeFromQueue = async (id) => {
    try {
      const r = await fetch(`/api/grabbings/jerome/queue/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        setMsg(j?.message || j?.error || "queue_delete_failed");
        return;
      }
      await refreshQueue();
    } catch (e) {
      setMsg(String(e?.message || e));
    }
  };

  const deleteDiscoveryFile = async (item) => {
    if (!item?.name) return;
    if (!window.confirm("Delete this discovery file?")) return;
    try {
      const r = await fetch(
        `/api/grabbings/jerome/file/${encodeURIComponent(item.name)}`,
        { method: "DELETE", credentials: "include" }
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        alert(j?.message || j?.error || "delete_failed");
        return;
      }
      await refreshDiscoverHistory();
    } catch (e) {
      alert(String(e?.message || e));
    }
  };

  return (
    <div className="h-full w-full flex min-h-0">
      {/* Left: list */}
      <aside className="w-72 border-r bg-white p-3 flex flex-col relative z-10">
        <div className="text-sm font-semibold mb-2">Grabbings</div>
        <div className="flex-1 overflow-y-auto scroll-area">
          <div className="text-xs uppercase tracking-wide text-gray-400 mt-4 mb-1">
            Saved
          </div>
          <div className="mb-2 relative">
            <CreateGrabbingButton disabled={busy} onCreated={onCreate} />
            <button
              className="ml-2 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const body = {
                    name: "Zásilkovna",
                    target: "https://client.packeta.com/en/packets/list",
                    options: {
                      packeta: {
                        signInUrl: "https://client.packeta.com/en/sign/in",
                        listUrl: "https://client.packeta.com/en/packets/list",
                        email: "",
                        password: "",
                      },
                    },
                  };
                  const r = await fetch("/api/grabbings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(body),
                  });
                  const j = await r.json();
                  if (r.ok && j?.ok) {
                    await load();
                    if (j.item?.id) setSel(j.item.id);
                  } else alert(j?.message || j?.error || "create_failed");
                } catch (e) {
                  alert(String(e?.message || e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Preset Zásilkovna
            </button>
            <button
              className="ml-2 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const body = {
                    name: "Grabing Jerome",
                    target:
                      "https://stilcasashop.com/collections/contenitori-a-pedale/products/copia-del-pattumiere-a-pedale-30-lt-29xh-64-cm",
                    options: { jerome: { mode: "product" } },
                  };
                  const r = await fetch("/api/grabbings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(body),
                  });
                  const j = await r.json();
                  if (r.ok && j?.ok) {
                    await load();
                    if (j.item?.id) setSel(j.item.id);
                  } else alert(j?.message || j?.error || "create_failed");
                } catch (e) {
                  alert(String(e?.message || e));
                } finally {
                  setBusy(false);
                }
              }}
            >
          
            </button>
          </div>

          {(items || []).map((it) => (
            <div
              key={it.id}
              className={`flex items-center gap-2 px-2 py-1 rounded mb-1 hover:bg-gray-50 ${
                sel === it.id ? "bg-blue-50" : ""
              }`}
            >
              <button onClick={() => setSel(it.id)} className="flex-1 text-left">
                <div className="font-medium text-sm">
                  {it.name || it.title || it.id}
                </div>
                <div className="text-[11px] text-gray-500 truncate">
                  {it.target || "-"}
                </div>
              </button>
              <button
                className="text-[11px] px-1.5 py-0.5 border rounded"
                onClick={() => remove(it.id)}
                title="Delete"
              >
                Del
              </button>
            </div>
          ))}
          {(!items || !items.length) && (
            <div className="text-xs text-gray-500">No grabbings yet.</div>
          )}
        </div>
      </aside>

      <main className="flex-1 min-h-0 p-4" aria-label="Details">
        {!!msg && <div className="text-sm text-gray-600 mb-2">{msg}</div>}

        {!sel && <div className="text-sm text-gray-500">Select a grabbing from the list.</div>}

        {sel && it && (
          <div className="space-y-2">
            <div className="text-lg font-semibold">{it.name || it.title}</div>

            {/* Packeta section */}
            {isPacketa(it) && (
              <div className="mt-4 space-y-2">
                <div className="font-medium">Packeta (Zásilkovna)</div>
                <div className="text-xs text-gray-600">
                  Runs a headless browser to sign in and download the CSV from your account.
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-gray-600">Sign-in URL</div>
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={cfg.signInUrl}
                      onChange={(e) => setCfg({ ...cfg, signInUrl: e.target.value })}
                      placeholder="https://client.packeta.com/en/sign/in"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-600">Packets list URL</div>
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={cfg.listUrl}
                      onChange={(e) => setCfg({ ...cfg, listUrl: e.target.value })}
                      placeholder="https://client.packeta.com/en/packets/list"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-600">Email</div>
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={cfg.email}
                      onChange={(e) => setCfg({ ...cfg, email: e.target.value })}
                      placeholder="user@email"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-600">Password</div>
                    <input
                      type="password"
                      className="border rounded px-2 py-1 w-full"
                      value={cfg.password}
                      onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
                      placeholder="••••••"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button className="px-3 py-1.5 rounded border text-sm" onClick={saveCfg}>
                      Save settings
                    </button>
                    <button
                      className="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 text-sm"
                      onClick={runPacketa}
                      disabled={runBusy}
                    >
                      {runBusy ? "Running." : "Download CSV now"}
                    </button>
                    <button
                      className="px-3 py-1.5 rounded border text-sm"
                      onClick={cleanupCsvs}
                      disabled={cleanupBusy}
                    >
                      {cleanupBusy ? "Cleaning…" : "Clean up CSVs"}
                    </button>
                    {!!runOut && (
                      <span className="text-xs text-gray-600">
                        {runOut.ok ? "OK" : runOut.error || runOut.message || "failed"}
                      </span>
                    )}
                    {!!runOut?.download_url && (
                      <a
                        className="text-xs text-blue-600 underline"
                        href={runOut.download_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open latest
                      </a>
                    )}
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer select-none py-1">Advanced options</summary>
                    <div className="mt-1 space-y-1">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!cfg.tableCsv}
                          onChange={(e) => setCfg({ ...cfg, tableCsv: e.target.checked })}
                        />
                        <span>CSV from table (as displayed)</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!cfg.includeEmail}
                          onChange={(e) => setCfg({ ...cfg, includeEmail: e.target.checked })}
                        />
                        <span>Also merge E-mail into official export</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!cfg.deepEnrich}
                          onChange={(e) => setCfg({ ...cfg, deepEnrich: e.target.checked })}
                        />
                        <span>Deep enrich (open detail pages)</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!cfg.snapshotHtml}
                          onChange={(e) => setCfg({ ...cfg, snapshotHtml: e.target.checked })}
                        />
                        <span>Attach HTML snapshots (debug)</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!cfg.debug}
                          onChange={(e) => setCfg({ ...cfg, debug: e.target.checked })}
                        />
                        <span>Verbose logs (debug)</span>
                      </label>
                    </div>
                  </details>
                </div>

                <div>
                  {Boolean(runOut && runOut.login_ok) && (
                    <div className="text-xs text-green-700">Login status: OK</div>
                  )}
                  {Boolean(runOut && runOut.login_ok === false) && (
                    <div className="text-xs text-red-700">Login status: FAILED</div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-gray-600 mb-1">Latest downloads</div>
                  {(latest || []).slice(0, 10).map((f) => (
                    <div key={f.name} className="text-xs flex items-center gap-2">
                      <a
                        className="text-blue-600 underline"
                        href={f.download_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {f.name}
                      </a>
                      <span className="text-gray-500">({(f.size || 0).toLocaleString()} bytes)</span>
                      <span className="text-gray-400">{new Date(f.mtime).toLocaleString()}</span>
                    </div>
                  ))}
                  {(!latest || !latest.length) && (
                    <div className="text-xs text-gray-500">No files yet.</div>
                  )}
                </div>

                {!!runOut && (
                  <div className="mt-3">
                    <div className="text-xs text-gray-600 mb-1">Run log</div>
                    {(runOut.error || runOut.message) && (
                      <div className="text-xs text-red-600 mb-1">
                        {runOut.error || runOut.message}
                      </div>
                    )}
                    {Array.isArray(runOut.debug_urls) && runOut.debug_urls.length > 0 && (
                      <div className="text-[11px] text-gray-700 mb-1">
                        Debug artifacts:{" "}
                        {runOut.debug_urls.map((u, i) => (
                          <a
                            key={i}
                            className="text-blue-600 underline mr-2"
                            href={u}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {u.split("/").pop()}
                          </a>
                        ))}
                      </div>
                    )}
                    {Array.isArray(runOut.console) && runOut.console.length > 0 && (
                      <div className="text-[11px] text-gray-700 mb-1">
                        <div className="font-medium">Browser console</div>
                        <div className="max-h-40 overflow-auto border rounded bg-white">
                          {runOut.console.map((c, i) => (
                            <div
                              key={i}
                              className="px-2 py-0.5 border-b last:border-0 text-[11px]"
                            >
                              <span className="text-gray-500">[{c.type}]</span> {c.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {Array.isArray(runOut.net) && runOut.net.length > 0 && (
                      <div className="text-[11px] text-gray-700 mb-1">
                        <div className="font-medium">Network (export)</div>
                        <div className="max-h-40 overflow-auto border rounded bg-white">
                          {runOut.net.map((n, i) => (
                            <div
                              key={i}
                              className="px-2 py-0.5 border-b last:border-0 text-[11px] break-all"
                            >
                              {n.status} <span className="text-gray-500">{n.content_type || ""}</span>{" "}
                              {n.url}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="text-[11px] bg-gray-50 border rounded p-2 whitespace-pre-wrap">
                      {Array.isArray(runOut.steps) && runOut.steps.length ? (
                        runOut.steps.map((s, i) => <div key={i}>{i + 1}. {String(s)}</div>)
                      ) : (
                        <div>No step logs.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Jerome section */}
            {isJerome(it) && (
              <div className="mt-4 flex flex-col gap-3">
                {/* Domain State */}
                <div id="jerome-domains" className="space-y-2 border rounded p-3 bg-white">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">Domain State</div>
                    <div className="flex items-center gap-2">
                      <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=>setCollapseDomainsCard(v=>!v)}>
                        {collapseDomainsCard ? 'Expand' : 'Collapse'}
                      </button>
                      {/* removed: Refresh domains */}
                      {/* removed: Recompute totals */}
                      {/* removed: Backfill + Recompute */}
                    </div>
                  </div>
                  <div className={collapseDomainsCard ? 'hidden' : ''}>
                    {!!domainsMsg && <div className="text-[11px] text-gray-600">{domainsMsg}</div>}
                  {/* Add Domain */}
                  <div className="mb-2">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end text-[11px]">
                        <div className="md:col-span-3">
                          <div className="text-gray-600">Domain</div>
                          <input
                            className="border rounded px-2 py-1 w-full"
                            placeholder="example.com"
                            value={domainsNew.domain}
                            onChange={(e)=> setDomainsNew(v=>({ ...v, domain: e.target.value }))}
                          />
                        </div>
                        <div>
                          <button
                            className="px-2 py-1 border rounded whitespace-nowrap"
                            disabled={domainsAddBusy || !String(domainsNew.domain||'').trim()}
                            onClick={async()=>{
                              if (!String(domainsNew.domain||'').trim()) return;
                              setDomainsMsg(''); setDomainsAddBusy(true);
                              try {
                                const ac = new AbortController();
                                const t = setTimeout(() => { try { ac.abort(); } catch {} }, 15000);
                                const r = await fetch('/api/grabbings/jerome/discover/domains/add', {
                                  method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
                                  body: JSON.stringify({ domain: domainsNew.domain }), signal: ac.signal
                                });
                                clearTimeout(t);
                                const j = await r.json();
                                if (!r.ok || j?.ok===false) { setDomainsMsg(j?.message||j?.error||'add_failed'); }
                                else {
                                  const foundSm = j?.item?.sitemap_url ? ` Found sitemap: ${j.item.sitemap_url}.` : '';
                                  const dl = j?.downloaded ? ' Sitemap downloaded.' : '';
                                  setDomainsMsg(`Domain added.${foundSm}${dl}`);
                                  setDomainsNew({ domain:'', sitemap_url:'' });
                                  await refreshDiscoverDomains();
                                  await refreshDiscoverStats();
                                }
                              } catch (e) { setDomainsMsg(String(e?.message||e)); }
                              finally { setDomainsAddBusy(false); }
                            }}
                          >
                            {domainsAddBusy ? 'Adding…' : 'Add Domain'}
                          </button>
                        </div>
                      </div>
                    </div>
                    {!(discoverDomains||[]).length && (
                      <div className="text-xs text-gray-500">No domain data yet. Run Sitemap Count or Discovery.</div>
                    )}
                    {!!(discoverDomains||[]).length && (
                      <div className="overflow-auto">
                        <table className="min-w-full text-[11px]">
                          <thead className="bg-gray-50 text-gray-700">
                            <tr>
                              <th className="text-left px-2 py-1 border-b">Domain</th>
                              <th className="text-left px-2 py-1 border-b">Sitemaps</th>
                              <th className="text-left px-2 py-1 border-b">Sitemap URLs</th>
                              <th className="text-left px-2 py-1 border-b">Discovered URLs</th>
                              <th className="text-left px-2 py-1 border-b">Types</th>
                              <th className="text-left px-2 py-1 border-b">Updated</th>
                              <th className="text-left px-2 py-1 border-b">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {discoverDomains.slice(0, 100).map(d => (
                              <tr key={d.domain} className="border-b last:border-0">
                                <td className="px-2 py-1 whitespace-nowrap">{d.domain}</td>
                                <td className="px-2 py-1 align-top">
                                  <div className="max-w-[320px] truncate" title={d.sitemap_url}>
                                    {d.sitemap_url || ''}
                                  </div>
                                  <div className="mt-1">
                                    <button
                                      className="text-[11px] px-2 py-0.5 border rounded"
                                      onClick={()=> setDomainsOpenMap(m => ({ ...m, [d.domain]: !m[d.domain] }))}
                                    >
                                      {domainsOpenMap[d.domain] ? 'Hide sitemaps' : `Select sitemaps${Array.isArray(d.sitemaps)&&d.sitemaps.length? ` (${d.sitemaps.length})`: ''}`}
                                    </button>
                                  </div>
                                  {/* Always show all discovered sitemaps (read-only compact list) */}
                                  {Array.isArray(d.sitemaps) && d.sitemaps.length > 0 && (
                                    <div className="mt-1 max-h-24 overflow-auto border rounded p-1 bg-gray-50 text-[11px]">
                                      {Array.from(new Set([d.sitemap_url, ...d.sitemaps].filter(Boolean))).map((u) => (
                                        <div key={u} className="truncate" title={u}>{u}</div>
                                      ))}
                                    </div>
                                  )}
                                  {!!domainsOpenMap[d.domain] && (
                                    <div className="mt-1 max-h-36 overflow-auto border rounded p-1 bg-gray-50">
                                      {(() => {
                                        const arr = Array.isArray(d.sitemaps) ? d.sitemaps : [];
                                        const list = Array.from(new Set([d.sitemap_url, ...arr].filter(Boolean)));
                                        if (!list.length) return <div className="text-[11px] text-gray-500">No sitemaps known.</div>;
                                        const selectedFromDb = Array.isArray(d.selected_sitemaps) ? d.selected_sitemaps : [];
                                        const sel = domainsSelMap[d.domain] || selectedFromDb.reduce((acc,u)=>{ acc[u]=true; return acc; }, {});
                                        return (
                                          <div className="space-y-1">
                                            {list.map((u) => (
                                              <label key={u} className="flex items-center gap-2 text-[11px]">
                                                <input
                                                  type="checkbox"
                                                  checked={!!sel[u]}
                                                  onChange={(e)=> setDomainsSelMap(prev => {
                                                    const cur = { ...(prev[d.domain]||{}) };
                                                    if (e.target.checked) cur[u] = true; else delete cur[u];
                                                    return { ...prev, [d.domain]: cur };
                                                  })}
                                                />
                                                <span className="truncate" title={u}>{u}</span>
                                              </label>
                                            ))}
                                            <div className="flex items-center gap-2">
                                              <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=> setDomainsSelMap(prev => ({ ...prev, [d.domain]: (list.reduce((acc,u)=> { acc[u]=true; return acc; }, {})) }))}>Select all</button>
                                              <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=> setDomainsSelMap(prev => ({ ...prev, [d.domain]: {} }))}>Clear</button>
                                              <button
                                                className="text-[11px] px-2 py-0.5 border rounded"
                                                title="Fetch all child sitemaps from sitemap index"
                                                onClick={async()=>{
                                                  setDomainsMsg(''); setDomainsBusy(true);
                                                  try {
                                                    const url = (d.sitemap_url && d.sitemap_url.trim()) ? d.sitemap_url : `https://${d.domain}/sitemap_index.xml`;
                                                    const r = await fetch('/api/grabbings/jerome/sitemap/count', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ url, max_sitemaps: 10000 }) });
                                                    const j = await r.json();
                                                    if (!r.ok || j?.ok===false) { setDomainsMsg(j?.message||j?.error||'sitemap_fetch_failed'); }
                                                    else {
                                                      // Refresh domains and preselect all known sitemaps for this domain
                                                      await refreshDiscoverDomains();
                                                      const sArr = Array.isArray(j.sitemaps) ? j.sitemaps : [];
                                                      const nextSel = sArr.reduce((acc,u)=>{ acc[u]=true; return acc; }, {});
                                                      setDomainsSelMap(prev => ({ ...prev, [d.domain]: nextSel }));
                                                      // Auto-open panel so user sees them
                                                      setDomainsOpenMap(m => ({ ...m, [d.domain]: true }));
                                                      // Auto-save selection
                                                      try {
                                                        const r2 = await fetch('/api/grabbings/jerome/domains/select', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: d.domain, sitemaps: sArr }) });
                                                        const j2 = await r2.json();
                                                        if (!r2.ok || j2?.ok===false) {
                                                          setDomainsMsg(j2?.message||j2?.error||'save_failed');
                                                        } else {
                                                          setDomainsMsg(`Fetched ${sArr.length} sitemap(s). Selection saved.`);
                                                          await refreshDiscoverDomains();
                                                        }
                                                      } catch (e) { setDomainsMsg(String(e?.message||e)); }
                                                    }
                                                  } catch (e) { setDomainsMsg(String(e?.message||e)); }
                                                  finally { setDomainsBusy(false); }
                                                }}
                                              >Fetch all sitemaps</button>
                                              {/* Edit config and History removed from Domain State */}
                                              <button className="text-[11px] px-2 py-0.5 border rounded"
                                                onClick={async()=>{
                                                  const fallbackSel = (Array.isArray(d.selected_sitemaps) ? d.selected_sitemaps : []).reduce((acc,u)=>{ acc[u]=true; return acc; }, {});
                                                  const curSelMap = domainsSelMap[d.domain] || fallbackSel;
                                                  const chosen = Object.keys(curSelMap||{}).filter(Boolean);
                                                  if (!chosen.length) { setDomainsMsg('Select at least one sitemap.'); return; }
                                                  setDomainsMsg(''); setDomainsBusy(true);
                                                  try {
                                                    const r = await fetch('/api/grabbings/jerome/domains/select', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: d.domain, sitemaps: chosen }) });
                                                    const j = await r.json();
                                                    if (!r.ok || j?.ok===false) { setDomainsMsg(j?.message||j?.error||'save_failed'); }
                                                    else {
                                                      setDomainsMsg('Selection saved.');
                                                      // Sync local state so buttons reflect saved selection immediately
                                                      setDomainsSelMap(prev => ({ ...prev, [d.domain]: (chosen.reduce((acc,u)=>{ acc[u]=true; return acc; }, {})) }));
                                                      await refreshDiscoverDomains();
                                                    }
                                                  } catch (e) { setDomainsMsg(String(e?.message||e)); }
                                                  finally { setDomainsBusy(false); }
                                                }}
                                              >Save selection</button>
                                              <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=> setDomainsTreeOpen(prev => ({ ...prev, [d.domain]: !prev[d.domain] }))}>{domainsTreeOpen[d.domain] ? 'Hide tree' : 'View sitemap tree'}</button>
                                            </div>
                                            {/* Config view and history removed from Domain State */}
                                            {!!domainsTreeOpen[d.domain] && (
                                              <div className="mt-2">
                                                <SitemapsTree
                                                  domain={d.domain}
                                                  sitemapUrl={d.sitemap_url}
                                                  initialSelected={Object.keys(domainsSelMap[d.domain] || {})}
                                                  onSave={async (urls)=>{
                                                    setDomainsMsg(''); setDomainsBusy(true);
                                                    try {
                                                      const r = await fetch('/api/grabbings/jerome/domains/select', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: d.domain, sitemaps: urls }) });
                                                      const j = await r.json();
                                                      if (!r.ok || j?.ok===false) { setDomainsMsg(j?.message||j?.error||'save_failed'); }
                                                      else {
                                                        setDomainsMsg(`Saved ${urls.length} sitemap(s).`);
                                                        setDomainsSelMap(prev => ({ ...prev, [d.domain]: urls.reduce((acc,u)=>{ acc[u]=true; return acc; }, {}) }));
                                                        await refreshDiscoverDomains();
                                                      }
                                                    } catch (e) { setDomainsMsg(String(e?.message||e)); }
                                                    finally { setDomainsBusy(false); }
                                                  }}
                                                />
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  )}
                                </td>
                                <td className="px-2 py-1 whitespace-nowrap">{(d.sitemap_total_urls||0).toLocaleString()}</td>
                                <td className="px-2 py-1 whitespace-nowrap">{(d.total_discovered_urls||0).toLocaleString()}</td>
                                <td className="px-2 py-1 whitespace-nowrap">{Array.isArray(d.types)? d.types.join(', '): ''}</td>
                                <td className="px-2 py-1 whitespace-nowrap">{d.updated_at? new Date(d.updated_at).toLocaleString(): ''}</td>
                                <td className="px-2 py-1 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <button
                                      className="px-2 py-0.5 border rounded"
                                      disabled={domainsBusy}
                                      onClick={async()=>{
                                        if (!d?.domain) return;
                                        setDomainsMsg(''); setDomainsBusy(true);
                                        try {
                                          const selMap = domainsSelMap[d.domain] || {};
                                          const chosen = Object.keys(selMap).filter(Boolean);
                                          const body = chosen.length ? { domain: d.domain, sitemaps: chosen } : { domain: d.domain };
                                          const r = await fetch('/api/grabbings/jerome/discover/domains/extract', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body) });
                                          const j = await r.json();
                                          if (!r.ok || j?.ok===false) { setDomainsMsg(j?.message||j?.error||'extract_failed'); }
                                          else {
                                            const used = Array.isArray(j.sitemaps_used)? j.sitemaps_used.length : 0;
                                            const ins = Number(j.inserted||0);
                                            const tot = Number(j.total_urls||0);
                                            setDomainsMsg(`Sitemaps: ${used} · URLs: ${tot} (inserted ${ins})`);
                                            await refreshDiscoverDomains();
                                            await refreshDiscoverStats();
                                          }
                                        } catch (e) { setDomainsMsg(String(e?.message||e)); }
                                        finally { setDomainsBusy(false); }
                                      }}
                                    >
                                      Extract URLs
                                    </button>
                                    <button
                                      className="px-2 py-0.5 border rounded"
                                      disabled={domainsBusy}
                                      onClick={async()=>{
                                        if (!d?.domain) return;
                                        if (!window.confirm(`Delete domain "${d.domain}"?`)) return;
                                        setDomainsMsg(''); setDomainsBusy(true);
                                        try {
                                          const r = await fetch('/api/grabbings/jerome/discover/domains/delete', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ domain: d.domain }) });
                                          const j = await r.json();
                                          if (!r.ok || j?.ok===false) { setDomainsMsg(j?.message||j?.error||'delete_failed'); }
                                          else {
                                            setDomainsMsg('Domain deleted.');
                                            await refreshDiscoverDomains();
                                            await refreshDiscoverStats();
                                          }
                                        } catch (e) { setDomainsMsg(String(e?.message||e)); }
                                        finally { setDomainsBusy(false); }
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                </div>

              </div>

              <DomainConfigMaker activeDomain={dcmDomain} onChangeDomain={setDcmDomain} />

              {/* Domain URLs (placed below Domain State) */}
              <DomainUrls activeDomain={dcmDomain} onChangeDomain={setDcmDomain} overrideConfigText={dcmEditor} />

              {/* Transfer Config (per-domain/type) */}
              <TransferConfigMaker activeDomain={dcmDomain} onChangeDomain={setDcmDomain} />

                {/* PrestaShop Transfers (below Domain URLs + Transfer Config) */}
                <div id="jerome-transfers" className="space-y-2 border rounded p-3 bg-white">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">PrestaShop Transfers</div>
                    <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=>setCollapseTransfers(v=>!v)}>
                      {collapseTransfers ? 'Expand' : 'Collapse'}
                    </button>
                  </div>
                  <div className={collapseTransfers ? 'hidden' : ''}>
                    <PrestaReadyTransfers activeDomain={dcmDomain} onChangeDomain={setDcmDomain} />
                  </div>
                </div>

                                {/* URL Discovery removed */}


                <div id="jerome-presta-db" className="space-y-2 border rounded p-3 bg-white">
  <div className="flex items-center justify-between">
    <div className="font-medium">Presta DB Connection</div>
    <button className="text-[11px] px-2 py-0.5 border rounded" onClick={()=>setCollapsePrestaDb(v=>!v)}>
      {collapsePrestaDb ? 'Expand' : 'Collapse'}
    </button>
  </div>
  <div className={collapsePrestaDb ? 'hidden' : ''}>
    <PrestaDbConnection />
  </div>
</div>
                </div>
            )}
          </div>
  )}
      </main>
   </div>
  );
}

