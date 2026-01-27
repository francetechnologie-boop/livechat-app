import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadModuleState, saveModuleState } from "@app-lib/uiState";

const tldToCCFromURLish = (urlish) => { if (!urlish) return null; try { const { hostname } = new URL(urlish); const tld = hostname.split(".").pop().toUpperCase(); const map = { UK: "GB", GB: "GB", FR: "FR", DE: "DE", ES: "ES", IT: "IT", PT: "PT", NL: "NL", BE: "BE", CH: "CH", AT: "AT", IE: "IE", DK: "DK", SE: "SE", NO: "NO", FI: "FI", PL: "PL", CZ: "CZ", SK: "SK", HU: "HU", RO: "RO", BG: "BG", GR: "GR", TR: "TR", RU: "RU", UA: "UA", US: "US", CA: "CA", AU: "AU", NZ: "NZ", JP: "JP", KR: "KR", CN: "CN", IN: "IN", BR: "BR", AR: "AR", MX: "MX", MA: "MA", TN: "TN", DZ: "DZ", SN: "SN", ZA: "ZA", EU: "EU", }; return map[tld] || null; } catch { return null; } };
const pickCountryCode = (info) => { const cc = info?.country_code; if (cc) return String(cc).toUpperCase(); const fromOrigin = tldToCCFromURLish(info?.origin); const fromPage = tldToCCFromURLish(info?.page_url); const fromPageLast = tldToCCFromURLish(info?.page_url_last); return (fromOrigin || fromPage || fromPageLast || "").toUpperCase(); };
const ccToFlag = (raw) => { if (!raw) return null; let cc = String(raw).trim().toUpperCase(); const remap = { UK: "GB", EL: "GR" }; const alpha3 = { GBR: "GB", FRA: "FR", DEU: "DE", ESP: "ES", ITA: "IT", USA: "US", CAN: "CA", AUS: "AU", NZL: "NZ" }; cc = remap[cc] || cc; if (/^[A-Z]{3}$/.test(cc)) cc = alpha3[cc] || cc.slice(0, 2); if (cc === "EU") { const A = 0x1f1e6; return String.fromCodePoint(A + ("E".charCodeAt(0) - 65), A + ("U".charCodeAt(0) - 65)); } if (!/^[A-Z]{2}$/.test(cc)) return null; const A = 0x1f1e6; return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65)); };
const timeAgo = (ts) => { if (!ts) return ""; const now = Date.now(); const d = Math.max(0, now - ts); const s = Math.floor(d / 1000); if (s < 5) return "à l’instant"; if (s < 60) return `il y a ${s}s`; const m = Math.floor(s / 60); if (m < 60) return `il y a ${m} min`; const h = Math.floor(m / 60); if (h < 24) return `il y a ${h} h`; const day = Math.floor(h / 24); return `il y a ${day} j`; };
const displayName = (info, vId) => { const f = (info?.customer_firstname || "").trim(); const l = (info?.customer_lastname || "").trim(); if (f || l) return `${f} ${l}`.trim(); if (info?.customer_email) return info.customer_email; return `Visiteur ${String(vId || '').slice(0, 6)}…`; };
const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };
const normalizeVisitorId = (id) => { if (id == null) return null; const s = String(id).trim(); return s ? s : null; };

const normEmail = (e) => {
  const s = String(e || '').trim().toLowerCase();
  return s && s.includes('@') ? s : (s || '');
};
const identityKeyOf = (info, vId) => {
  const idShop = (info?.id_shop ?? info?.shop_id ?? info?.idShop ?? null);
  const shopPrefix = (idShop != null && String(idShop).trim()) ? `shop:${String(idShop).trim()}|` : '';
  const customerId = (info?.customer_id ?? info?.customerId ?? info?.id_customer ?? null);
  if (customerId != null && String(customerId).trim()) return `${shopPrefix}cid:${String(customerId).trim()}`;
  const email = normEmail(info?.customer_email || info?.email || '');
  if (email) return `${shopPrefix}email:${email}`;
  return `vid:${String(vId || '').trim()}`;
};

export default function ConversationList({ visitors = [], conversations = [], messages = [], selectedVisitor, setSelectedVisitor, visitorInfo = {}, onVisitorPatch = () => {}, }) {
  const selectedId = normalizeVisitorId(selectedVisitor);
  const [filterMode, setFilterMode] = useState(() => {
    try {
      const st = loadModuleState('conversation-list') || {};
      const mode = String(st.filterMode || '').trim();
      if (mode === 'active' || mode === 'all' || mode === 'online') return mode;
      // Backward compatibility with older saved state
      if (st.showActiveOnly === false) return 'all';
      return 'active';
    } catch {
      return 'active';
    }
  });
  const newUntilRef = useRef(new Map());
  const [, forceNow] = useState(Date.now());
  useEffect(() => {
    const now = Date.now();
    for (const id of visitors || []) { const vid = normalizeVisitorId(id); if (vid && !newUntilRef.current.has(vid)) newUntilRef.current.set(vid, now + 10000); }
    for (const c of conversations || []) { const vid = normalizeVisitorId(c?.visitor_id); if (vid && !newUntilRef.current.has(vid)) newUntilRef.current.set(vid, now + 10000); }
    for (const m of messages || []) { const vid = normalizeVisitorId(m?.visitorId ?? m?.visitor_id); if (vid && !newUntilRef.current.has(vid)) newUntilRef.current.set(vid, now + 10000); }
    for (const id of Object.keys(visitorInfo || {})) { const vid = normalizeVisitorId(id); if (vid && !newUntilRef.current.has(vid)) newUntilRef.current.set(vid, now + 10000); }
  }, [visitors, conversations, messages, visitorInfo]);
  useEffect(() => { const t = setInterval(() => forceNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { try { saveModuleState('conversation-list', { filterMode }); } catch {} }, [filterMode]);
  useEffect(() => {
    const onRestore = (e) => {
      try {
        const v = e?.detail?.modules?.['conversation-list']?.filterMode;
        if (v === 'active' || v === 'all' || v === 'online') setFilterMode(v);
      } catch {}
    };
    window.addEventListener('app-restore', onRestore);
    return () => window.removeEventListener('app-restore', onRestore);
  }, []);
  const allVisitorIds = useMemo(() => {
    const set = new Set();
    for (const id of visitors || []) { const vid = normalizeVisitorId(id); if (vid) set.add(vid); }
    for (const c of conversations || []) { const vid = normalizeVisitorId(c?.visitor_id); if (vid) set.add(vid); }
    for (const m of messages || []) { const vid = normalizeVisitorId(m?.visitorId ?? m?.visitor_id); if (vid) set.add(vid); }
    for (const id of Object.keys(visitorInfo || {})) { const vid = normalizeVisitorId(id); if (vid) set.add(vid); }
    return Array.from(set);
  }, [visitors, conversations, messages, visitorInfo]);
  const convoMap = useMemo(() => { const m = new Map(); for (const c of conversations || []) { const vId = normalizeVisitorId(c?.visitor_id); if (!vId) continue; const prev = m.get(vId); const curTs = Date.parse(c?.created_at || c?.last_seen || "") || 0; const prevTs = prev ? (Date.parse(prev?.created_at || prev?.last_seen || "") || 0) : -1; if (!prev || curTs >= prevTs) m.set(vId, c); } return m; }, [conversations]);
  const liveLastByVisitor = useMemo(() => { const map = new Map(); for (const msg of messages || []) { const vId = normalizeVisitorId(msg?.visitorId ?? msg?.visitor_id); if (!vId) continue; const prev = map.get(vId); if (!prev || (msg.timestamp || 0) > (prev.timestamp || 0)) { map.set(vId, msg); } } return map; }, [messages]);
  const lastVisitorMsgAt = useMemo(() => { const map = new Map(); for (const msg of messages || []) { if (!msg || msg.from !== "visitor") continue; const id = normalizeVisitorId(msg.visitorId ?? msg.visitor_id); if (!id) continue; const t = msg.timestamp || 0; if (!map.has(id) || t > (map.get(id) || 0)) map.set(id, t); } return map; }, [messages]);
  const rows = useMemo(() => {
    const list = [];
    for (const vId of allVisitorIds) {
      const info = visitorInfo[vId] || {};
      const cc = pickCountryCode(info);
      const flag = ccToFlag(cc) || "🌐";
      const fromDB = convoMap.get(vId) || null;
      const fromLive = liveLastByVisitor.get(vId) || null;
      const liveTime = fromLive?.timestamp || 0;
      const dbCreated = fromDB?.created_at ? Date.parse(fromDB.created_at) : 0;
      const dbSeen = fromDB?.last_seen ? Date.parse(fromDB.last_seen) : 0;
      const infoSeen = info?.last_seen ? Date.parse(info.last_seen) : 0;
      let lastWhen = Math.max(liveTime, dbCreated, dbSeen, infoSeen);
      if (!lastWhen && (dbSeen || dbCreated || infoSeen)) lastWhen = dbSeen || dbCreated || infoSeen;
      let lastText = ""; let lastSender = "";
      if (liveTime >= dbCreated) { lastText = fromLive?.message || ""; lastSender = fromLive?.from === "agent" ? "agent" : "visitor"; }
      else { lastText = fromDB?.content || ""; lastSender = fromDB?.sender === "agent" ? "agent" : "visitor"; }
      const lastVisitorTs = lastVisitorMsgAt.get(vId) || 0;
      const isNewVisitorMsg = lastVisitorTs && (Date.now() - lastVisitorTs < 10000);
      const lastSeenTs = info?.last_seen ? Date.parse(info.last_seen) : 0;
      const online = lastSeenTs && (Date.now() - lastSeenTs) < 120000;
      const archived = (info?.archived !== undefined) ? Boolean(info.archived) : Boolean(fromDB?.archived);
      // Initiated by visitor if last known sender is visitor or if we saw any visitor message live
      const initiated = (lastSender !== 'agent') || ((messages || []).some(m => normalizeVisitorId(m?.visitorId ?? m?.visitor_id) === vId && (m.from || m.sender) !== 'agent'));
      list.push({ vId, cc, flag, info, lastText, lastSender, lastWhen, hintUrl: info?.current_url || info?.page_url || info?.page_url_last || "", hintTitle: info?.title || "", isNew: (newUntilRef.current.get(vId) || 0) > Date.now(), isNewVisitorMsg, online, archived, initiated });
    }
    // Group by customer identity (shop+customer_id or shop+email) to avoid duplicate cards.
    const groups = new Map();
    for (const r of list) {
      const key = identityKeyOf(r.info, r.vId);
      const g = groups.get(key) || { key, ids: [], canonical: null, row: null };
      g.ids.push(r.vId);
      // Pick canonical as most-recent activity
      if (!g.row || (r.lastWhen || 0) >= (g.row.lastWhen || 0)) { g.row = r; g.canonical = r.vId; }
      groups.set(key, g);
    }

    let grouped = Array.from(groups.values()).map((g) => {
      const base = g.row || {};
      // Prefer a row that has a real identity (name/email) for display
      const best = (g.ids || []).map((id) => ({ id, info: visitorInfo[id] || {} })).find((x) => {
        const inf = x.info || {};
        const f = String(inf.customer_firstname || '').trim();
        const l = String(inf.customer_lastname || '').trim();
        const e = String(inf.customer_email || '').trim();
        return !!(f || l || e);
      });
      const bestInfo = best ? (best.info || {}) : (base.info || {});
      const anyOnline = (g.ids || []).some((id) => {
        const inf = visitorInfo[id] || {};
        const ts = inf?.last_seen ? Date.parse(inf.last_seen) : 0;
        return ts && (Date.now() - ts) < 120000;
      });
      const anyArchivedFalse = (g.ids || []).some((id) => {
        const inf = visitorInfo[id] || {};
        return inf?.archived === false;
      });
      const allArchivedTrue = (g.ids || []).length > 0 && (g.ids || []).every((id) => {
        const inf = visitorInfo[id] || {};
        return inf?.archived === true;
      });
      const archivedAgg = anyArchivedFalse ? false : allArchivedTrue ? true : Boolean(base.archived);
      const isNewAgg = (g.ids || []).some((id) => (newUntilRef.current.get(id) || 0) > Date.now());
      const isNewVisitorMsgAgg = (g.ids || []).some((id) => {
        const lastTs = lastVisitorMsgAt.get(id) || 0;
        return lastTs && (Date.now() - lastTs < 10000);
      });
      const initiatedAgg = (g.ids || []).some((id) => {
        const fromDB = convoMap.get(id) || null;
        const fromLive = liveLastByVisitor.get(id) || null;
        const lastSender = (fromLive?.timestamp || 0) >= (fromDB?.created_at ? Date.parse(fromDB.created_at) : 0)
          ? (fromLive?.from === 'agent' ? 'agent' : 'visitor')
          : (fromDB?.sender === 'agent' ? 'agent' : 'visitor');
        if (lastSender !== 'agent') return true;
        return (messages || []).some((m) => normalizeVisitorId(m?.visitorId ?? m?.visitor_id) === id && (m.from || m.sender) !== 'agent');
      });

      return {
        ...base,
        vId: g.canonical || base.vId,
        ids: g.ids || [],
        info: bestInfo,
        online: anyOnline || base.online,
        archived: archivedAgg,
        isNew: isNewAgg,
        isNewVisitorMsg: isNewVisitorMsgAgg,
        initiated: initiatedAgg,
      };
    });

    grouped.sort((a, b) => (b.lastWhen || 0) - (a.lastWhen || 0));

    const baseFiltered = (() => {
      if (filterMode === 'all') return grouped;
      if (filterMode === 'online') {
        return grouped.filter((r) => {
          const isArchived = (r.info?.archived !== undefined) ? r.info.archived : r.archived;
          return !!r.online && !isArchived;
        });
      }
      // filterMode === 'active'
      return grouped.filter((r) => {
        const isArchived = (r.info?.archived !== undefined) ? r.info.archived : r.archived;
        return ((r.online || r.lastWhen || (r.lastText && r.lastText.length > 0)) && !isArchived);
      });
    })();
    let filtered = baseFiltered;

    // Only show conversations initiated by visitor
    filtered = filtered.filter(r => r.initiated);

    // Ensure the selected visitor remains visible even if filtered out (e.g., archived/inactive).
    if (selectedId && !filtered.some(r => r.vId === selectedId)) {
      const row = grouped.find(r => r.vId === selectedId && r.initiated);
      // In "online" mode, only keep the selected row if it is online.
      if (row && (filterMode !== 'online' || row.online)) filtered = [row, ...filtered];
    }

    return filtered;
  }, [allVisitorIds, visitorInfo, convoMap, liveLastByVisitor, filterMode, selectedId, lastVisitorMsgAt, messages]);
  const archiveVisitor = async (visitorIdOrIds, archived) => {
    try {
      const ids = Array.isArray(visitorIdOrIds) ? visitorIdOrIds : [visitorIdOrIds];
      const vids = ids.map(normalizeVisitorId).filter(Boolean);
      if (!vids.length) return;
      await Promise.all(vids.map((vid) => (
        fetch(`/api/conversation-hub/visitors/${encodeURIComponent(vid)}/archive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived }),
        }).catch(() => null)
      )));
      for (const vid of vids) onVisitorPatch(vid, { archived, conversation_status: archived ? 'archived' : 'open' });
    } catch (err) {
      console.error('Unable to update archive state', err);
    }
  };
  const handleRowKey = (event, visitorId) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedVisitor(normalizeVisitorId(visitorId)); } };
  return (
    <section className="conversation-list">
      <header className="conversation-list__toolbar">
        <div className="conversation-list__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={filterMode === 'active'} className={`chip ${filterMode === 'active' ? 'chip--active' : ''}`} onClick={() => setFilterMode('active')}>Actives</button>
          <button type="button" role="tab" aria-selected={filterMode === 'online'} className={`chip ${filterMode === 'online' ? 'chip--active' : ''}`} onClick={() => setFilterMode('online')}>En ligne</button>
          <button type="button" role="tab" aria-selected={filterMode === 'all'} className={`chip ${filterMode === 'all' ? 'chip--active' : ''}`} onClick={() => setFilterMode('all')}>Toutes</button>
        </div>
        <span className="conversation-list__count">{rows.length} visiteurs</span>
      </header>
      <div className="conversation-list__body scroll-area" style={{ overflowY: 'auto' }}>
        {rows.length === 0 && (<div className="conversation-list__empty">Aucune conversation.</div>)}
        {rows.map((row) => { const isSelected = selectedId === row.vId; 
          const last3 = (messages || [])
            .filter((m) => {
              const vid = normalizeVisitorId(m?.visitorId ?? m?.visitor_id);
              if (!vid) return false;
              if (vid === row.vId) return true;
              const ids = Array.isArray(row.ids) ? row.ids : [];
              return ids.includes(vid);
            })
            .sort((a,b) => (b.timestamp||0) - (a.timestamp||0))
            .slice(0, 3);
          return (
          <article key={row.vId} role="button" tabIndex={0} onClick={() => setSelectedVisitor(row.vId)} onKeyDown={(event) => handleRowKey(event, row.vId)} className={`conversation-card${isSelected ? ' is-selected' : ''}${row.isNewVisitorMsg ? ' is-highlighted' : row.isNew ? ' is-fresh' : ''}`}>
            <div className="conversation-card__top">
              <div className="conversation-card__identity">
                <span className={`status-dot${row.online ? ' is-online' : ''}`} />
                <div>
                  <div className="conversation-card__name">{displayName(row.info, row.vId)}</div>
                  <div className="conversation-card__meta">
                    <span>{timeAgo(row.lastWhen) || 'il y a longtemps'}</span>
                    {Array.isArray(row.ids) && row.ids.length > 1 && <span className="badge badge--muted">{row.ids.length} sessions</span>}
                    {(row.info?.archived ?? row.archived) && <span className="badge badge--muted">Archive</span>}
                  </div>
                </div>
              </div>
              <div className="conversation-card__flag">
                <span className="flag-emoji">{row.flag}</span>
                <span>{row.cc || ''}</span>
              </div>
            </div>
            <div className="conversation-card__snippet">
              {last3.length > 0 ? (
                <div className="text-xs leading-snug space-y-0.5">
                  {last3.map((m, i) => {
                    const from = (m.from || m.sender) === 'agent' ? 'A' : 'V';
                    const txt = String(m.message || m.content || '').trim();
                    const short = txt.length > 80 ? txt.slice(0, 80) + '…' : txt;
                    return (
                      <div key={i} className="truncate">
                        <span className="font-medium">{from}:</span> {short || '(vide)'}
                      </div>
                    );
                  })}
                </div>
              ) : (
                row.lastText || 'Pas encore de message.'
              )}
            </div>
            {row.hintUrl && (<div className="conversation-card__context">{row.hintTitle ? `${row.hintTitle} • ` : ''}{hostOf(row.hintUrl) || row.hintUrl}</div>)}
            <div className="conversation-card__actions">
              {!row.archived ? (
                <button type="button" className="chip chip--outline" onClick={(event) => { event.stopPropagation(); archiveVisitor(row.ids?.length ? row.ids : row.vId, true); }}>Archiver</button>
              ) : (
                <button type="button" className="chip chip--outline" onClick={(event) => { event.stopPropagation(); archiveVisitor(row.ids?.length ? row.ids : row.vId, false); }}>Restaurer</button>
              )}
            </div>
          </article> ); })}
      </div>
    </section>
  );
}
